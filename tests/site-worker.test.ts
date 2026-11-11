import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import worker, { Budget, resetBanCache } from "../workers/site/src/index";
import { MESH_PATH, cookieValue, ipPrefix, ipTag, mintSession, readSession, type DataPoint, type Env } from "../workers/site/src/gate";
import { step } from "../workers/site/src/budget";
import { detect, heavyClientsSql, mergeBans, offenders } from "../workers/site/src/detect";

const SECRET = "test-secret-0123456789";
const ORIGIN = "https://site.example.workers.dev";
const IP = "203.0.113.7";

class MemoryStorage {
  data = new Map<string, unknown>();
  alarm = 0;
  async get<T>(key: string) { return this.data.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async setAlarm(time: number) { this.alarm = time; }
  async deleteAll() { this.data.clear(); }
}

function harness(overrides: Partial<Env> = {}) {
  const points: DataPoint[] = [];
  const objects = new Map<string, Budget>();
  const kv = new Map<string, string>();
  let failBudget = false;
  const limiter = (allow: () => boolean) => ({ limit: async () => ({ success: allow() }) });
  const state = { sessionAllowed: true, ipAllowed: true };
  const env = {
    ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/m/models/cosmetics/hat.glb") return new Response("glTF-bytes", { headers: { "Content-Length": "10", "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=0" } });
      // Like not_found_handling: "single-page-application", a miss answers 200 with the app's page.
      if (path === "/m/models/fallback.glb") return new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(path === "/" || path === "/index.html" ? "<html>app</html>" : "missing", { status: path.startsWith("/m/") ? 404 : 200 });
    } },
    BANS: { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : null), put: async (key: string, value: string) => { kv.set(key, value); } },
    BUDGET: {
      idFromName: (name: string) => name,
      get: (name: unknown) => ({ fetch: async (input: string) => {
        if (failBudget) throw new Error("Durable Object quota exceeded");
        let object = objects.get(String(name));
        if (!object) objects.set(String(name), object = new Budget({ storage: new MemoryStorage() }, {}));
        return object.fetch(new Request(input));
      } }),
    },
    LOG: { writeDataPoint: (point: DataPoint) => { points.push(point); } },
    SESSION_LIMIT: limiter(() => state.sessionAllowed),
    IP_LIMIT: limiter(() => state.ipAllowed),
    MINT_LIMIT: limiter(() => true),
    SESSION_SECRET: SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    GATE_MODE: "enforce",
    ...overrides,
  } as unknown as Env;
  return { env, points, kv, state, objects, failBudget: (v: boolean) => { failBudget = v; } };
}

async function cookieFor(sid?: string, ttl = 3600) {
  return `tfo_m=${(await mintSession(SECRET, Date.now(), ttl, sid)).token}`;
}

function meshRequest(path: string, { cookie, site = "same-origin", method = "GET" }: { cookie?: string; site?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": IP };
  if (site) headers["Sec-Fetch-Site"] = site;
  if (cookie) headers.Cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

const HAT = "/m/models/cosmetics/hat.glb";
beforeEach(() => resetBanCache());

test("session tokens round-trip and refuse tampering, expiry and malformed input", async () => {
  const now = Date.UTC(2026, 10, 5);
  const { token, sid, exp } = await mintSession(SECRET, now, 3600);
  assert.deepEqual(await readSession(SECRET, token, now), { sid, exp });
  assert.equal(await readSession("other-secret", token, now), null);
  assert.equal(await readSession(SECRET, token, (exp + 1) * 1000), null, "expired");
  const [v, s, e, sig] = token.split(".");
  assert.equal(await readSession(SECRET, [v, s, String(Number(e) + 3600), sig].join("."), now), null, "extended expiry");
  assert.equal(await readSession(SECRET, [v, s, e, sig.slice(0, -2) + (sig.endsWith("A") ? "BB" : "AA")].join("."), now), null);
  for (const bad of [null, "", "v1.x.1.y", "v2." + token.slice(3), token + ".extra", "v1.!!!!!!!!!!!!!!!!!!!!!!.1.abc"])
    assert.equal(await readSession(SECRET, bad, now), null, String(bad));
  assert.equal(cookieValue(`a=1; tfo_m=${token}; b=2`, "tfo_m"), token);
});

test("IP keys group IPv6 by /64 and are salted tags, never raw addresses", async () => {
  assert.equal(ipPrefix("203.0.113.7"), "203.0.113.7");
  assert.equal(ipPrefix("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipPrefix("2001:0DB8:85a3:0000:0000:8a2e:0370:7334"), "2001:db8:85a3:0::/64");
  assert.equal(await ipTag(SECRET, "2001:db8::1"), await ipTag(SECRET, "2001:db8::ffff:1"));
  const tag = await ipTag(SECRET, IP);
  assert.match(tag, /^[0-9a-f]{16}$/);
  assert.notEqual(tag, await ipTag("other-secret", IP));
});

test("mesh paths are .glb files under /m/ with no dot or empty segments", () => {
  for (const ok of ["/m/models/cosmetics/hat.glb", "/m/models/reconstructed-assembly-v2/a_b-c.1/x.glb"]) assert.ok(MESH_PATH.test(ok), ok);
  for (const bad of ["/m/../secret.glb", "/m/a/./b.glb", "/m/a/../b.glb", "/m/a//b.glb", "/m/a.bin", "/m/.glb", "/x/a.glb", "/m/a.glb/"])
    assert.ok(!MESH_PATH.test(bad), bad);
});

test("the budget counts within a window and starts again after it", () => {
  let s = { count: 0, resetAt: 0 };
  for (let i = 1; i <= 3; i++) { const r = step(s, 3, 1000, 10); assert.ok(r.ok); s = r.state; assert.equal(s.count, i); }
  assert.equal(step(s, 3, 1000, 500).ok, false);
  const later = step(s, 3, 1000, 1010);
  assert.ok(later.ok && later.fresh);
  assert.equal(later.state.count, 1);
});

test("a same-origin fetch with a valid session gets the mesh, privately cached and logged", async () => {
  const h = harness();
  const response = await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "glTF-bytes");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=31536000, immutable");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  const row = h.points.at(-1)!;
  assert.equal(row.blobs![0], "mesh");
  assert.equal(row.blobs![4], HAT);
  assert.equal(row.doubles![0], 10);
  assert.ok(!row.blobs!.includes(IP), "raw IP is never logged");
});

test("the gate refuses other sites, missing sessions, bad paths and banned addresses", async () => {
  const h = harness();
  const cookie = await cookieFor();
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie, site: "cross-site" }), h.env)).status, 403);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie, site: null }), h.env)).status, 403, "curl sends no Sec-Fetch-Site");
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie, site: "none" }), h.env)).status, 403, "typed into the address bar");
  const noSession = await worker.fetch(meshRequest(HAT), h.env);
  assert.equal(noSession.status, 401);
  assert.deepEqual(await noSession.json(), { error: "session" });
  assert.equal((await worker.fetch(meshRequest("/m/models/../x.glb", { cookie }), h.env)).status, 404);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie, method: "POST" }), h.env)).status, 405);
  assert.equal((await worker.fetch(meshRequest("/m/models/nothing.glb", { cookie }), h.env)).status, 404);
  const fallback = await worker.fetch(meshRequest("/m/models/fallback.glb", { cookie }), h.env);
  assert.equal(fallback.status, 404, "the app page standing in for a missing mesh is a 404");
  assert.equal(fallback.headers.get("Content-Type"), "application/json");

  h.kv.set("bans", JSON.stringify({ [`ip:${await ipTag(SECRET, IP)}`]: Date.now() + 60_000 }));
  resetBanCache();
  const blocked = await worker.fetch(meshRequest(HAT, { cookie }), h.env);
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "blocked" });
  assert.deepEqual(h.points.filter(p => p.blobs![0] === "refuse").map(p => p.blobs![5]),
    ["cross-site", "cross-site", "cross-site", "session", "blocked"]);
});

test("expired bans are ignored and session bans apply", async () => {
  const h = harness();
  const sid = "AAAAAAAAAAAAAAAAAAAAAA";
  h.kv.set("bans", JSON.stringify({ [`ip:${await ipTag(SECRET, IP)}`]: Date.now() - 1, [`sid:${sid}`]: Date.now() + 60_000 }));
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env)).status, 200);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie: await cookieFor(sid) }), h.env)).status, 403);
});

test("rate limits answer 429 with Retry-After", async () => {
  const h = harness();
  h.state.sessionAllowed = false;
  const response = await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
  h.state.sessionAllowed = true; h.state.ipAllowed = false;
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env)).status, 429);
});

test("a spent session budget clears the cookie so the app passes a new check", async () => {
  const h = harness({ MESHES_PER_SESSION: "2" } as Partial<Env>);
  const cookie = await cookieFor();
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie }), h.env)).status, 200);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie }), h.env)).status, 200);
  const spent = await worker.fetch(meshRequest(HAT, { cookie }), h.env);
  assert.equal(spent.status, 401);
  assert.deepEqual(await spent.json(), { error: "budget" });
  assert.match(spent.headers.get("Set-Cookie")!, /^tfo_m=; Path=\/m\/; Max-Age=0;/);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env)).status, 200, "a new session has its own budget");
});

test("a Durable Object failure serves the mesh (fail open) and records it", async () => {
  const h = harness();
  h.failBudget(true);
  assert.equal((await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env)).status, 200);
  assert.ok(h.points.some(p => p.blobs![0] === "refuse" && p.blobs![5] === "budget-unavailable"));
});

test("log mode serves everything but records what enforcing would refuse", async () => {
  const h = harness({ GATE_MODE: "log" });
  const response = await worker.fetch(meshRequest(HAT, { site: null }), h.env);
  assert.equal(response.status, 200);
  assert.deepEqual(h.points.map(p => [p.blobs![0], p.blobs![5]]), [["refuse", "cross-site"], ["refuse", "session"], ["mesh", "log-mode"]]);
});

test("the app's own files pass straight through and unknown API paths are 404", async () => {
  const h = harness();
  assert.equal(await (await worker.fetch(new Request(`${ORIGIN}/`), h.env)).text(), "<html>app</html>");
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/other`), h.env)).status, 404);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubTurnstile(result: Record<string, unknown>) {
  const calls: FormData[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    calls.push(init!.body as FormData);
    return Response.json(result);
  }) as typeof fetch;
  return calls;
}

const sessionRequest = (body: unknown, { origin = ORIGIN, site = "same-origin" } = {}) =>
  new Request(`${ORIGIN}/api/session`, { method: "POST", body: JSON.stringify(body),
    headers: { Origin: origin, "Sec-Fetch-Site": site, "Content-Type": "application/json", "CF-Connecting-IP": IP } });

test("a passed Turnstile check mints an HttpOnly session cookie scoped to /m/", async () => {
  const h = harness();
  const calls = stubTurnstile({ success: true, hostname: "site.example.workers.dev", action: "mesh-session" });
  const response = await worker.fetch(sessionRequest({ token: "turnstile-token" }), h.env);
  assert.equal(response.status, 200);
  assert.equal(calls[0].get("secret"), "turnstile-secret");
  assert.equal(calls[0].get("remoteip"), IP);
  const cookie = response.headers.get("Set-Cookie")!;
  assert.match(cookie, /^tfo_m=v1\.[\w-]{22}\.\d+\.[\w-]{43}; Path=\/m\/; Max-Age=21600; HttpOnly; Secure; SameSite=Strict$/);
  const body = await response.json() as { expiresAt: number; meshes: number };
  assert.equal(body.meshes, 300);
  assert.ok(Math.abs(body.expiresAt - (Date.now() + 6 * 3600_000)) < 5000);
  // The minted cookie opens the gate.
  const mesh = await worker.fetch(meshRequest(HAT, { cookie: cookie.split(";")[0] }), h.env);
  assert.equal(mesh.status, 200);
});

test("session minting refuses failed checks, other hostnames and actions, other origins and bad bodies", async () => {
  const h = harness();
  stubTurnstile({ success: false });
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 403);
  stubTurnstile({ success: true, hostname: "evil.example", action: "mesh-session" });
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 403);
  stubTurnstile({ success: true, hostname: "site.example.workers.dev", action: "other" });
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 403);
  stubTurnstile({ success: true, hostname: "site.example.workers.dev" });
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }, { origin: "https://evil.example" }), h.env)).status, 403);
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }, { site: "cross-site" }), h.env)).status, 403);
  assert.equal((await worker.fetch(sessionRequest({}), h.env)).status, 400);
  assert.equal((await worker.fetch(sessionRequest({ token: "x".repeat(3000) }), h.env)).status, 400);
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/session`), h.env)).status, 405);
});

test("sessions per address are capped per day", async () => {
  const h = harness({ SESSIONS_PER_IP_PER_DAY: "2" } as Partial<Env>);
  stubTurnstile({ success: true, hostname: "site.example.workers.dev" });
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 200);
  assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 200);
  const third = await worker.fetch(sessionRequest({ token: "t" }), h.env);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("Retry-After")) > 80_000);
});

test("detection bans heavy addresses and sessions once, keeps live bans and drops expired ones", () => {
  const found = offenders([
    { prefix: "ip", kind: "meshes", limit: 300, rows: [{ who: "aa", country: "GB", n: 900 }, { who: "bb", country: "US", n: 120 }] },
    { prefix: "sid", kind: "meshes", limit: 300, rows: [{ who: "S1", country: "GB", n: 301 }] },
    { prefix: "ip", kind: "refusals", limit: 600, rows: [{ who: "aa", country: "GB", n: 700 }] },
  ]);
  assert.deepEqual(found.map(o => [o.key, o.n]), [["ip:aa", 900], ["sid:S1", 301]]);
  const now = 1_000_000;
  const merged = mergeBans({ "ip:old": now - 1, "sid:S1": now + 5 }, found, now, 3600_000);
  assert.deepEqual(merged.bans, { "sid:S1": now + 5, "ip:aa": now + 3600_000 });
  assert.deepEqual(merged.added.map(o => o.key), ["ip:aa"]);
  assert.ok(merged.changed);
  assert.match(heavyClientsSql("tfo_mesh_log", "blob3", "mesh"), /SUM\(_sample_interval\) AS n FROM tfo_mesh_log WHERE blob1 = 'mesh'/);
});

test("the detection run queries Analytics Engine, stores bans and posts to Discord without mentions", async () => {
  const kv = new Map<string, string>();
  const posted: { url: string; body: string; auth?: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), body = String(init?.body);
    posted.push({ url, body, auth: (init?.headers as Record<string, string>)?.Authorization });
    if (url.includes("analytics_engine")) {
      const rows = body.includes("blob3 AS who") && body.includes("'mesh'") ? [{ who: "abc", country: "DE", n: 5000 }] : [];
      return Response.json({ data: rows });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const env = { ACCOUNT_ID: "acct", ANALYTICS_TOKEN: "tok", DISCORD_WEBHOOK_URL: "https://discord.example/hook",
    BANS: { get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null), put: async (k: string, v: string) => { kv.set(k, v); } } } as unknown as Env;
  const { added } = await detect(env, 1_000, fetcher);
  assert.deepEqual(added.map(o => o.key), ["ip:abc"]);
  assert.deepEqual(Object.keys(JSON.parse(kv.get("bans")!)), ["ip:abc"]);
  assert.equal(posted.filter(p => p.url.includes("analytics_engine")).length, 3);
  assert.ok(posted.every(p => !p.url.includes("analytics_engine") || p.auth === "Bearer tok"));
  const discord = JSON.parse(posted.find(p => p.url === "https://discord.example/hook")!.body);
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  assert.match(discord.content, /ip:abc.*DE: 5000/);
  // The same offender on the next run is already banned: no second alert.
  posted.length = 0;
  await detect(env, 2_000, fetcher);
  assert.equal(posted.filter(p => p.url.includes("discord")).length, 0);
});

test("detection is off without an account id and token", async () => {
  const env = { BANS: { get: async () => null, put: async () => assert.fail("no write") } } as unknown as Env;
  assert.deepEqual(await detect(env, 0, (async () => assert.fail("no query")) as typeof fetch), { added: [] });
});

test("without its secrets the gate answers 503 instead of throwing, and the app's files still load", async () => {
  for (const missing of [{ SESSION_SECRET: "" }, { SESSION_SECRET: "short" }, { TURNSTILE_SECRET: "" }]) {
    const h = harness(missing as Partial<Env>);
    const mesh = await worker.fetch(meshRequest(HAT, { cookie: await cookieFor() }), h.env);
    assert.equal(mesh.status, 503);
    assert.deepEqual(await mesh.json(), { error: "not configured" });
    assert.equal((await worker.fetch(sessionRequest({ token: "t" }), h.env)).status, 503);
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/`), h.env)).status, 200);
  }
});
