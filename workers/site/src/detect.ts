// Mass-download detection, run by the cron triggers in wrangler.jsonc.
//
// Every mesh request, session and refusal is one Analytics Engine row (index.ts):
//   blob1 event ("mesh" | "session" | "refuse"), blob2 session id, blob3 IP tag, blob4 country, blob5 path,
//   blob6 refusal reason, double1 bytes served.
// Every 10 minutes the last hour is summed per IP tag and per session. Anything over the thresholds is banned for
// BAN_HOURS (the "bans" key in KV, which the gate re-reads every minute) and reported to the Discord webhook. A daily
// digest posts the totals. Analytics Engine samples heavy traffic, so counts are SUM(_sample_interval), not COUNT().

import { setting, type Env } from "./gate";

type Row = Record<string, string | number>;
export type Query = (sql: string) => Promise<Row[]>;

export function analyticsQuery(env: Env, fetcher: typeof fetch = fetch): Query | null {
  if (!env.ACCOUNT_ID || !env.ANALYTICS_TOKEN) return null;
  return async (sql) => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      { method: "POST", headers: { Authorization: `Bearer ${env.ANALYTICS_TOKEN}` }, body: sql });
    if (!response.ok) throw new Error(`Analytics Engine query failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return ((await response.json()) as { data?: Row[] }).data ?? [];
  };
}

const dataset = (env: Env) => {
  const name = env.LOG_DATASET ?? "tfo_mesh_log";
  if (!/^\w+$/.test(name)) throw new Error("LOG_DATASET must be a plain identifier");
  return name;
};

export const heavyClientsSql = (table: string, column: "blob2" | "blob3", event: "mesh" | "refuse") =>
  `SELECT ${column} AS who, blob4 AS country, SUM(_sample_interval) AS n FROM ${table} ` +
  `WHERE blob1 = '${event}' AND ${column} != '' AND timestamp > NOW() - INTERVAL '1' HOUR ` +
  `GROUP BY who, country ORDER BY n DESC LIMIT 25 FORMAT JSON`;

export interface Offender { key: string; kind: string; n: number; country: string }

export function offenders(rows: { prefix: "ip" | "sid"; kind: string; limit: number; rows: Row[] }[]): Offender[] {
  const found = new Map<string, Offender>();
  for (const group of rows)
    for (const row of group.rows) {
      const n = Number(row.n), who = String(row.who ?? "");
      if (!who || !(n > group.limit)) continue;
      const key = `${group.prefix}:${who}`;
      const seen = found.get(key);
      if (!seen || n > seen.n) found.set(key, { key, kind: group.kind, n: Math.round(n), country: String(row.country ?? "") });
    }
  return [...found.values()];
}

/** Adds bans, drops expired ones, and returns the list to store plus which offenders are new. */
export function mergeBans(current: Record<string, number> | null, found: Offender[], nowMs: number, banMs: number) {
  const bans: Record<string, number> = {};
  for (const [key, until] of Object.entries(current ?? {})) if (typeof until === "number" && until > nowMs) bans[key] = until;
  const added = found.filter(o => !(o.key in bans));
  for (const o of added) bans[o.key] = nowMs + banMs;
  const changed = added.length > 0 || Object.keys(bans).length !== Object.keys(current ?? {}).length;
  return { bans, added, changed };
}

export async function notify(env: Env, content: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  // allowed_mentions: none, so a crafted value can never ping anyone.
  await fetcher(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }) });
}

export async function detect(env: Env, nowMs = Date.now(), fetcher: typeof fetch = fetch) {
  const query = analyticsQuery(env, fetcher);
  if (!query) return { added: [] as Offender[] };
  const table = dataset(env);
  const meshLimit = setting(env.ALERT_MESHES_PER_HOUR, 300), refusalLimit = setting(env.ALERT_REFUSALS_PER_HOUR, 600);
  const [byIp, bySession, refusedByIp] = await Promise.all([
    query(heavyClientsSql(table, "blob3", "mesh")),
    query(heavyClientsSql(table, "blob2", "mesh")),
    query(heavyClientsSql(table, "blob3", "refuse")),
  ]);
  const found = offenders([
    { prefix: "ip", kind: "meshes from one address", limit: meshLimit, rows: byIp },
    { prefix: "sid", kind: "meshes in one session", limit: meshLimit, rows: bySession },
    { prefix: "ip", kind: "refused requests from one address", limit: refusalLimit, rows: refusedByIp },
  ]);
  const banMs = setting(env.BAN_HOURS, 24) * 3600_000;
  const { bans, added, changed } = mergeBans((await env.BANS.get("bans", "json")) as Record<string, number> | null, found, nowMs, banMs);
  if (changed) await env.BANS.put("bans", JSON.stringify(bans));
  if (added.length)
    await notify(env, [`**Mesh gate: ${added.length} new ban(s) for ${setting(env.BAN_HOURS, 24)} h**`,
      ...added.map(o => `- \`${o.key}\` ${o.country || "??"}: ${o.n} ${o.kind} in the last hour`),
      "Unban: remove the key from the `bans` KV entry (workers/site/README.md)."].join("\n"), fetcher);
  return { added };
}

export async function digest(env: Env, fetcher: typeof fetch = fetch): Promise<string | null> {
  const query = analyticsQuery(env, fetcher);
  if (!query) return null;
  const table = dataset(env);
  const [events, top] = await Promise.all([
    query(`SELECT blob1 AS event, blob6 AS reason, SUM(_sample_interval) AS n, SUM(_sample_interval * double1) AS bytes ` +
      `FROM ${table} WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY event, reason ORDER BY n DESC LIMIT 30 FORMAT JSON`),
    query(`SELECT blob3 AS who, blob4 AS country, SUM(_sample_interval) AS n FROM ${table} WHERE blob1 = 'mesh' ` +
      `AND timestamp > NOW() - INTERVAL '1' DAY GROUP BY who, country ORDER BY n DESC LIMIT 5 FORMAT JSON`),
  ]);
  const lines = ["**Mesh gate, last 24 h**",
    ...events.map(r => `- ${r.event}${r.reason ? ` (${r.reason})` : ""}: ${Math.round(Number(r.n))}` +
      (r.event === "mesh" ? `, ${(Number(r.bytes) / 1e6).toFixed(0)} MB` : "")),
    "Top addresses by meshes:", ...top.map(r => `- \`ip:${r.who}\` ${r.country || "??"}: ${Math.round(Number(r.n))}`)];
  const text = lines.join("\n");
  await notify(env, text, fetcher);
  return text;
}
