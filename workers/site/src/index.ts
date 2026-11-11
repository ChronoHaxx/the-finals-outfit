// The site Worker: serves the app and gates its 3D meshes. See README.md for the design and its limits.
//
//   /m/**.glb         a mesh, only for a same-origin fetch carrying a valid session cookie, within the rate limits and
//                     the session's budget. Every request is logged for detection (detect.ts).
//   POST /api/session exchanges a Turnstile token for a session cookie (HttpOnly, Path=/m/, a few hours).
//   anything else     the app's static files. wrangler.jsonc only runs this script first for /m/* and /api/*, so the
//                     app itself is served as static assets, which Workers Free does not count or limit.

import { Budget } from "./budget";
import { detect, digest } from "./detect";
import {
  COOKIE, MESH_PATH, MESH_STORE, STORE_PREFIX, cookieValue, ipTag, json, meshStorePath, mintSession, readSession,
  sessionCookie, setting, type Env,
} from "./gate";

export { Budget };

interface Context { waitUntil(promise: Promise<unknown>): void }
const TURNSTILE_ACTION = "mesh-session";

let banCache: { at: number; keys: Set<string> } | null = null;
async function banned(env: Env, keys: string[]): Promise<boolean> {
  const now = Date.now();
  if (!banCache || now - banCache.at > 60_000) {
    let list: Record<string, number> | null = null;
    try { list = (await env.BANS.get("bans", "json")) as Record<string, number> | null; } catch { /* keep serving */ }
    banCache = { at: now, keys: new Set(Object.entries(list ?? {}).filter(([, until]) => until > now).map(([key]) => key)) };
  }
  return keys.some(key => banCache!.keys.has(key));
}
export const resetBanCache = () => { banCache = null; };

// Fails open: a Durable Object outage or exhausted quota must not take every mesh down with it.
async function take(env: Env, name: string, limit: number, windowSeconds: number) {
  try {
    const stub = env.BUDGET.get(env.BUDGET.idFromName(name));
    const response = await stub.fetch(`https://budget/take?limit=${limit}&window=${Math.ceil(windowSeconds)}`);
    if (response.ok) return { ...(await response.json() as { ok: boolean; used: number; resetAt: number }), error: false };
  } catch { /* fall through */ }
  return { ok: true, used: 0, resetAt: 0, error: true };
}

function client(request: Request) {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  return { ip: request.headers.get("CF-Connecting-IP") ?? "0.0.0.0", country: cf?.country ?? request.headers.get("CF-IPCountry") ?? "" };
}

async function verifyTurnstile(env: Env, token: string, ip: string, hostname: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const result = (await response.json()) as { success?: boolean; hostname?: string; action?: string };
    return result.success === true && (env.TURNSTILE_HOSTNAME_CHECK === "0" || result.hostname === hostname)
      && (!result.action || result.action === TURNSTILE_ACTION);
  } catch {
    return false;
  }
}

async function session(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405, { Allow: "POST" });
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") !== "same-origin")
    return json({ error: "cross-site" }, 403);
  const { ip, country } = client(request);
  const tag = await ipTag(env.SESSION_SECRET, ip);
  const log = (event: string, sid: string, reason: string) =>
    env.LOG?.writeDataPoint({ indexes: [sid || tag], blobs: [event, sid, tag, country, url.pathname, reason], doubles: [0] });
  if (env.MINT_LIMIT && !(await env.MINT_LIMIT.limit({ key: tag })).success) {
    log("refuse", "", "session-rate");
    return json({ error: "rate" }, 429, { "Retry-After": "60" });
  }
  if (await banned(env, [`ip:${tag}`])) {
    log("refuse", "", "blocked");
    return json({ error: "blocked" }, 403);
  }
  let token: unknown;
  try { token = ((await request.json()) as { token?: unknown })?.token; } catch { /* bad body */ }
  if (typeof token !== "string" || !token || token.length > 2048) return json({ error: "bad request" }, 400);
  if (!(await verifyTurnstile(env, token, ip, url.hostname))) {
    log("refuse", "", "check");
    return json({ error: "check" }, 403);
  }
  const daily = await take(env, `i:${tag}`, setting(env.SESSIONS_PER_IP_PER_DAY, 12), 86_400);
  if (!daily.ok) {
    log("refuse", "", "daily");
    return json({ error: "daily" }, 429, { "Retry-After": String(Math.max(60, Math.ceil((daily.resetAt - Date.now()) / 1000))) });
  }
  const ttl = setting(env.SESSION_HOURS, 6) * 3600;
  const minted = await mintSession(env.SESSION_SECRET, Date.now(), ttl);
  log("session", minted.sid, "");
  return json({ expiresAt: minted.exp * 1000, meshes: setting(env.MESHES_PER_SESSION, 300) }, 200,
    { "Set-Cookie": sessionCookie(minted.token, ttl) });
}

async function mesh(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method" }, 405, { Allow: "GET, HEAD" });
  if (!MESH_PATH.test(url.pathname)) return json({ error: "not found" }, 404);
  const enforce = env.GATE_MODE !== "log";
  const { ip, country } = client(request);
  const tag = await ipTag(env.SESSION_SECRET, ip);
  const log = (event: string, sid: string, reason: string, bytes = 0) =>
    env.LOG?.writeDataPoint({ indexes: [sid || tag], blobs: [event, sid, tag, country, url.pathname, reason], doubles: [bytes] });
  // Every refusal is logged; in "log" mode nothing is refused, so the log shows what enforcing would have done.
  const refuse = (status: number, reason: string, sid = "", headers: Record<string, string> = {}) => {
    log("refuse", sid, reason);
    return enforce ? json({ error: reason }, status, headers) : null;
  };
  let refused: Response | null;

  // Browsers always send Sec-Fetch-Site; "same-origin" means the app itself asked (not another site, not the address bar).
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin" && (refused = refuse(403, "cross-site"))) return refused;
  if (await banned(env, [`ip:${tag}`]) && (refused = refuse(403, "blocked"))) return refused;
  const current = await readSession(env.SESSION_SECRET, cookieValue(request.headers.get("Cookie"), COOKIE), Date.now());
  if (!current && (refused = refuse(401, "session"))) return refused;
  const sid = current?.sid ?? "";
  if (sid && await banned(env, [`sid:${sid}`]) && (refused = refuse(403, "blocked", sid))) return refused;
  const slow = { "Retry-After": "30" };
  if (sid && env.SESSION_LIMIT && !(await env.SESSION_LIMIT.limit({ key: sid })).success
    && (refused = refuse(429, "rate", sid, slow))) return refused;
  if (env.IP_LIMIT && !(await env.IP_LIMIT.limit({ key: tag })).success && (refused = refuse(429, "rate", sid, slow))) return refused;
  if (sid) {
    const budget = await take(env, `s:${sid}`, setting(env.MESHES_PER_SESSION, 300), setting(env.SESSION_HOURS, 6) * 3600);
    if (budget.error) log("refuse", sid, "budget-unavailable"); // served anyway (fail open), but visible
    // Spent: drop the cookie so the app passes a fresh check for a new session.
    if (!budget.ok && (refused = refuse(401, "budget", sid, { "Set-Cookie": sessionCookie("", 0) }))) return refused;
  }

  // The file lives in the unlisted store folder, never at /m/ itself (gate.ts, meshStorePath).
  const asset = await env.ASSETS.fetch(new Request(new URL(meshStorePath(env.MESH_STORE, url.pathname), "https://assets.local"),
    { method: request.method, headers: { Accept: "model/gltf-binary", "Sec-Fetch-Mode": "cors" } }));
  // A missing file can come back as the app's index.html (single-page-application fallback): that is a 404 here.
  if (!asset.ok || (asset.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html")) {
    await asset.body?.cancel();
    const missing = asset.ok || asset.status === 404;
    return json({ error: missing ? "not found" : "unavailable" }, missing ? 404 : 502);
  }
  log("mesh", sid, enforce ? "" : "log-mode", Number(asset.headers.get("Content-Length")) || 0);
  const headers = new Headers(asset.headers);
  // The browser may keep it (immutable release paths); shared caches may not, or they would serve it ungated.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(asset.body, { status: asset.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // The unlisted mesh store is reachable only through the ASSETS binding, never by URL, whatever the spelling.
    if (url.pathname.startsWith(STORE_PREFIX)) return json({ error: "not found" }, 404);
    // Secrets arrive with the first deploy; without them the gate answers plainly instead of throwing on every mesh.
    if ((url.pathname === "/api/session" || url.pathname.startsWith("/m/"))
      && ((env.SESSION_SECRET ?? "").length < 16 || !env.TURNSTILE_SECRET || !MESH_STORE.test(env.MESH_STORE ?? "")))
      return json({ error: "not configured" }, 503, { "Retry-After": "300" });
    if (url.pathname === "/api/session") return session(request, env, url);
    if (url.pathname.startsWith("/m/")) return mesh(request, env, url);
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: { cron: string }, env: Env, ctx: Context): Promise<void> {
    ctx.waitUntil(controller.cron === "0 8 * * *" ? digest(env) : detect(env));
  },
};
