// Pure pieces of the site Worker: session tokens, client keys and the mesh gate's checks. No Workers-only imports, so
// the Node tests (tests/site-worker.test.ts) exercise the same code that runs at the edge.

export interface RateLimit { limit(options: { key: string }): Promise<{ success: boolean }> }
export interface Fetcher { fetch(request: Request): Promise<Response> }
export interface KV {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
export interface DataPoint { indexes?: string[]; blobs?: string[]; doubles?: number[] }
export interface Dataset { writeDataPoint(point: DataPoint): void }
export interface BudgetStub { fetch(input: string): Promise<Response> }
export interface BudgetNamespace { idFromName(name: string): unknown; get(id: unknown): BudgetStub }

export interface Env {
  ASSETS: Fetcher;            // the app build plus /m/** meshes (wrangler.jsonc "assets")
  BANS: KV;                   // one key, "bans": { "<ip:tag | sid:id>": <banned-until ms> }
  BUDGET: BudgetNamespace;    // Durable Object counting meshes per session and sessions per IP
  LOG?: Dataset;              // Analytics Engine: one row per mesh request, session and refusal
  SESSION_LIMIT?: RateLimit;  // meshes per session per minute
  IP_LIMIT?: RateLimit;       // meshes per IP per minute
  MINT_LIMIT?: RateLimit;     // new sessions per IP per minute
  SESSION_SECRET: string;     // secret: signs session cookies and salts the IP tags
  TURNSTILE_SECRET: string;   // secret: the Turnstile widget's secret key
  MESH_STORE: string;         // secret: the unlisted asset folder holding the meshes (see meshStorePath)
  GATE_MODE?: string;         // "enforce" (default) or "log": serve everything, record what would be refused
  TURNSTILE_HOSTNAME_CHECK?: string; // "0" skips the hostname match (only for Turnstile's test keys in local dev)
  SESSION_HOURS?: string;
  MESHES_PER_SESSION?: string;
  SESSIONS_PER_IP_PER_DAY?: string;
  // Detection (scheduled handler); unset ACCOUNT_ID or ANALYTICS_TOKEN switches it off.
  ACCOUNT_ID?: string;
  ANALYTICS_TOKEN?: string;   // secret: API token with Account Analytics Read
  LOG_DATASET?: string;
  DISCORD_WEBHOOK_URL?: string; // secret
  ALERT_MESHES_PER_HOUR?: string;
  ALERT_REFUSALS_PER_HOUR?: string;
  BAN_HOURS?: string;
}

export const COOKIE = "tfo_m";
// Every segment starts with a word character or "-", so none can be "." or ".." or empty.
export const MESH_PATH = /^\/m\/[\w-][\w.-]*(?:\/[\w-][\w.-]*)*\.glb$/;

// Meshes are not uploaded under /m/. They sit in an unlisted folder, "/_<MESH_STORE>/", named by a secret that no
// client ever sees. Static assets are matched by Cloudflare's own path handling, which can resolve spellings such as
// /%6d/… or //m/… without running this script. With the meshes stored elsewhere, such a spelling of /m/ finds nothing.
// Every "/_*" request runs this script (wrangler.jsonc) and is refused, so the folder is reachable only through the
// ASSETS binding.
export const MESH_STORE = /^[0-9a-f]{32,64}$/;
export const STORE_PREFIX = "/_";
export const meshStorePath = (store: string, meshPath: string) => `${STORE_PREFIX}${store}/${meshPath.slice("/m/".length)}`;

export function setting(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export const newSessionId = () => base64url(crypto.getRandomValues(new Uint8Array(16)));
const SESSION_ID = /^[A-Za-z0-9_-]{22}$/;

// A session cookie is "v1.<sid>.<expiry seconds>.<HMAC>": tamper-evident, self-expiring, no server-side lookup.
export async function mintSession(secret: string, nowMs: number, ttlSeconds: number, sid = newSessionId()) {
  const exp = Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
  const body = `v1.${sid}.${exp}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return { token: `${body}.${base64url(sig)}`, sid, exp };
}

export async function readSession(secret: string, token: string | null, nowMs: number): Promise<{ sid: string; exp: number } | null> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 4 || parts[0] !== "v1" || !SESSION_ID.test(parts[1]) || !/^\d{1,12}$/.test(parts[2])) return null;
  const sig = fromBase64url(parts[3]);
  if (!sig || sig.length !== 32) return null;
  // crypto.subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(parts.slice(0, 3).join("."))))) return null;
  const exp = Number(parts[2]);
  return exp * 1000 > nowMs ? { sid: parts[1], exp } : null;
}

export function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

// One key per IPv4 address, and per /64 for IPv6 (one home connection usually owns a whole /64).
export function ipPrefix(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [], back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Raw addresses are never stored: logs, bans and rate-limit keys use a salted 64-bit tag.
export async function ipTag(secret: string, ip: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`ip|${ipPrefix(ip)}`)));
  return [...sig.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${token}; Path=/m/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Strict`;
}

export const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...headers } });
