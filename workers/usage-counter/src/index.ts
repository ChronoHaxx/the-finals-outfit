// usage-counter: one cookie-free event collector for the owner's apps (README.md). It turns small JSON batches into
// Workers Analytics Engine rows and keeps nothing else.
//
//   POST /e   body (text/plain): { app, schema, form_factor, build, events: [{ e, p? }, ...] }  ->  204
//
// Privacy, by construction:
// - No cookies are read or set. Nothing about the request is logged: no console output carries a header or the body,
//   and Workers Logs are off (wrangler.jsonc).
// - The IP address and user agent are read for one thing: the visitor hash on `app_loaded`, made with a random salt for
//   the UTC day and the app's name. The salt sits in KV and expires an hour after its day ends; after that no hash can
//   be tied to an address or to another day's hash. The address itself is never written anywhere.
// - Requests with Sec-GPC: 1 or DNT: 1 are dropped here as well as in the app.
//
// Defensibility: allowlisted origins only, a per-IP rate limit, obvious bots dropped, every value checked by pattern
// (schema.ts), at most 20 rows per request (Analytics Engine takes 25).

import { APPS, checkEvent, readEnvelope, type CheckedEvent, type Envelope } from "./schema";

export interface DataPoint { indexes?: string[]; blobs?: string[]; doubles?: number[] }
export interface Dataset { writeDataPoint(point: DataPoint): void }
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expiration?: number }): Promise<void>;
}
export interface RateLimit { limit(options: { key: string }): Promise<{ success: boolean }> }
export interface Env {
  EVENTS: Dataset;      // Analytics Engine dataset usage_events
  SALTS: KV;            // "salt:YYYY-MM-DD" -> 64 hex chars, expiring an hour after that day
  IP_LIMIT?: RateLimit; // requests per IP per minute (the key is held by the rate limiter, never stored)
}

export const MAX_BODY = 16 * 1024;
const DAY_MS = 86_400_000;
/** The salt outlives its day by this long, so a request that started at 23:59:59 still finds it. */
export const SALT_GRACE_S = 3600;
const BOT = /bot|crawl|spider|slurp|headless|preview|fetch|curl|wget|python|httpclient|monitor/i;

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayEnd = (day: string) => Date.parse(`${day}T00:00:00Z`) + DAY_MS;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");

// Salts this instance has read from KV (never ones it only wrote: another instance may have won that race).
const cache = new Map<string, string>();
export const clearSaltCache = () => cache.clear();

/** The day's salt: from memory, else KV, else made now. The cron makes tomorrow's at midday, so making one here only
 *  happens on a fresh deployment's first day. */
export async function saltFor(env: Env, day: string): Promise<string> {
  const known = cache.get(day);
  if (known) return known;
  const stored = await env.SALTS.get(`salt:${day}`);
  if (stored) {
    if (cache.size > 2) cache.clear();
    cache.set(day, stored);
    return stored;
  }
  return writeSalt(env, day);
}

async function writeSalt(env: Env, day: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.SALTS.put(`salt:${day}`, salt, { expiration: Math.floor(dayEnd(day) / 1000) + SALT_GRACE_S });
  return salt;
}

/** 64 bits of SHA-256(salt | app | IP | user agent). The app is in it, so one person's hashes on two apps differ. */
export async function visitorHash(salt: string, app: string, ip: string, userAgent: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${app}|${ip}|${userAgent}`));
  return hex(digest).slice(0, 16);
}

/** One dataset row. Fixed columns, so every app's rows query the same way:
 *  index1 app · blob1 event · blob2 form factor · blob3 build (both empty for a "minimal" app) · blob4 visitor (the
 *  app's visitor event only) · blob5-8 properties. */
export function row(envelope: Envelope, event: CheckedEvent, visitor: string): DataPoint {
  return { indexes: [envelope.app], blobs: [event.event, envelope.form_factor, envelope.build, visitor, ...event.values], doubles: [1] };
}

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function collect(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/e") return empty(404);
  if (request.method === "OPTIONS") return empty(204);
  if (request.method !== "POST") return empty(405);
  if (request.headers.get("Sec-GPC") === "1" || request.headers.get("DNT") === "1") return empty(204);
  const userAgent = request.headers.get("User-Agent") ?? "";
  if (!userAgent || BOT.test(userAgent)) return empty(204);
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (env.IP_LIMIT && !(await env.IP_LIMIT.limit({ key: ip || "unknown" })).success) return empty(429);

  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY) return empty(413);
  const text = await request.text();
  if (text.length > MAX_BODY) return empty(413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return empty(400); }
  const envelope = readEnvelope(body, request.headers.get("Origin"));
  if (!envelope) return empty(403);

  const checked = envelope.events.map(raw => checkEvent(envelope.app, raw)).filter((e): e is CheckedEvent => e !== null);
  // Only the app's one per-page-load event carries the visitor hash (its visitorEvent: app_loaded for every app so far).
  const visitorEvent = APPS[envelope.app].visitorEvent;
  let visitor = "";
  if (visitorEvent && checked.some(e => e.event === visitorEvent) && ip)
    visitor = await visitorHash(await saltFor(env, utcDay(now)), envelope.app, ip, userAgent);
  for (const event of checked) env.EVENTS.writeDataPoint(row(envelope, event, event.event === visitorEvent ? visitor : ""));
  return empty(204);
}

/** Daily cron: make sure today's and tomorrow's salts exist, so every instance reads the same one from midnight. */
export async function prepareSalts(env: Env, now = Date.now()): Promise<void> {
  for (const day of [utcDay(now), utcDay(now + DAY_MS)])
    if (!(await env.SALTS.get(`salt:${day}`))) await writeSalt(env, day);
}

export default {
  fetch: (request: Request, env: Env) => collect(request, env),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) => ctx.waitUntil(prepareSalts(env)),
};
