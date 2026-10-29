import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/share-preview/src/index";
import { jpegSize, newId, validCode, type Env } from "../workers/share-preview/src/share";

// A minimal JPEG: SOI, an APP0 segment, a baseline frame header with the given size, a scan, EOI.
function jpeg(width: number, height: number, { frame = 0xc0, padTo = 0 } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, frame, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const body = [0xff, 0xd8, ...app0, ...sof, ...sos, 0x12, 0x34];
  while (body.length + 2 < padTo) body.push(0x00);
  return new Uint8Array([...body, 0xff, 0xd9]);
}

class MemoryKV {
  entries = new Map<string, { value: Uint8Array; metadata: unknown; ttl?: number }>();
  failPuts = false;
  async put(key: string, value: Uint8Array, options: { expirationTtl?: number; metadata?: unknown }) {
    if (this.failPuts) throw new Error("KV put failed: 429 Too Many Requests");
    this.entries.set(key, { value, metadata: options.metadata, ttl: options.expirationTtl });
  }
  async get(key: string) { return this.entries.get(key)?.value.slice().buffer ?? null; }
  async getWithMetadata(key: string) {
    const entry = this.entries.get(key);
    return entry ? { value: new Blob([entry.value]).stream(), metadata: entry.metadata } : { value: null, metadata: null };
  }
}

const APP = "https://chronohaxx.github.io/the-finals-outfit/";
function env(overrides: Partial<Env> = {}): Env & { SHARES: MemoryKV } {
  return { SHARES: new MemoryKV(), APP_URL: APP, ALLOWED_ORIGINS: "https://chronohaxx.github.io, http://127.0.0.1:5180",
    ...overrides } as unknown as Env & { SHARES: MemoryKV };
}
const BASE = "https://share.example.workers.dev";
const upload = (e: Env, body: Uint8Array, { code = "2.12a.3bc", origin = "https://chronohaxx.github.io" } = {}) =>
  worker.fetch(new Request(`${BASE}/api/share?o=${code}`, { method: "POST", body,
    headers: { Origin: origin, "Content-Type": "image/jpeg", "CF-Connecting-IP": "203.0.113.7" } }), e);

test("JPEG frame size is read from the first frame header, and malformed files are refused", () => {
  assert.deepEqual(jpegSize(jpeg(1200, 630)), { width: 1200, height: 630 });
  assert.deepEqual(jpegSize(jpeg(1200, 630, { frame: 0xc2 })), { width: 1200, height: 630 }); // progressive
  assert.equal(jpegSize(jpeg(1200, 630).slice(0, -2)), null); // no EOI
  assert.equal(jpegSize(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
  const scanFirst = jpeg(1200, 630);
  scanFirst.set([0xff, 0xda], 20); // replace the frame marker with a scan marker
  assert.equal(jpegSize(scanFirst), null);
  const overrun = jpeg(1200, 630);
  overrun.set([0xff, 0xff], 4); // APP0 length past the end of the file
  assert.equal(jpegSize(overrun), null);
});

test("outfit codes follow the app's short-link grammar", () => {
  for (const ok of ["2.", "2.12a", "2.12a.3bc.0zz9"]) assert.ok(validCode(ok), ok);
  for (const bad of [null, "", "1.12a", "2.1", "2.12a.", "2.ABC", "2.12a\"><script>", `2.${Array(41).fill("12a").join(".")}`])
    assert.ok(!validCode(bad), String(bad));
});

test("ids are 12 alphanumerics and do not repeat", () => {
  const ids = new Set(Array.from({ length: 2000 }, newId));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[0-9A-Za-z]{12}$/);
});

test("an allowed upload is stored with its code and a TTL, and its page carries the preview tags", async () => {
  const e = env();
  const response = await upload(e, jpeg(1200, 630));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://chronohaxx.github.io");
  const { url } = await response.json() as { url: string };
  const id = /\/s\/([0-9A-Za-z]{12})\?o=2\.12a\.3bc$/.exec(url)?.[1];
  assert.ok(id, url);
  const entry = e.SHARES.entries.get(`s:${id}`)!;
  assert.deepEqual(entry.metadata, { o: "2.12a.3bc" });
  assert.equal(entry.ttl, 365 * 24 * 3600);

  const page = await (await worker.fetch(new Request(url), e)).text();
  assert.match(page, new RegExp(`<meta property="og:image" content="${BASE}/i/${id}\\.jpg">`));
  assert.match(page, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(page, /location\.replace\("https:\/\/chronohaxx\.github\.io\/the-finals-outfit\/#\/\?o=2\.12a\.3bc"\)/);
  assert.doesNotMatch(page, /http-equiv="refresh"/);
  // Share pages are per-person redirects: kept out of search results, still read by link-preview bots.
  assert.match(page, /<meta name="robots" content="noindex">/);

  const image = await worker.fetch(new Request(`${BASE}/i/${id}.jpg`), e);
  assert.equal(image.headers.get("Content-Type"), "image/jpeg");
  assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), jpeg(1200, 630));
});

test("uploads are refused for a foreign origin, a wrong size, a bad code, too many bytes, or when disabled", async () => {
  const e = env();
  assert.equal((await upload(e, jpeg(1200, 630), { origin: "https://evil.example" })).status, 403);
  assert.equal((await upload(e, jpeg(1200, 631))).status, 415);
  assert.equal((await upload(e, new TextEncoder().encode("GIF89a"))).status, 415);
  assert.equal((await upload(e, jpeg(1200, 630), { code: "2.12a%22%3E" })).status, 400);
  assert.equal((await upload(e, jpeg(1200, 630, { padTo: 250_001 }))).status, 413);
  assert.equal((await upload(env({ UPLOADS_DISABLED: "1" }), jpeg(1200, 630))).status, 503);
  assert.equal(e.SHARES.entries.size, 0);
});

test("the rate limit and a failed write (the daily quota) both refuse without storing", async () => {
  let calls = 0;
  const limited = env({ UPLOAD_LIMIT: { limit: async ({ key }) => ({ success: key === "203.0.113.7" && ++calls <= 2 }) } });
  assert.equal((await upload(limited, jpeg(1200, 630))).status, 201);
  assert.equal((await upload(limited, jpeg(1200, 630))).status, 201);
  assert.equal((await upload(limited, jpeg(1200, 630))).status, 429);
  const full = env();
  full.SHARES.failPuts = true;
  assert.equal((await upload(full, jpeg(1200, 630))).status, 503);
});

test("a preflight from an allowed origin is answered without storing anything", async () => {
  const e = env();
  const response = await worker.fetch(new Request(`${BASE}/api/share?o=2.12a`, { method: "OPTIONS",
    headers: { Origin: "http://127.0.0.1:5180", "Access-Control-Request-Method": "POST" } }), e);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST");
});

test("an expired link still opens its outfit with the generic card; the stored code wins over the link's", async () => {
  const e = env();
  const expired = await (await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA?o=2.12a`), e)).text();
  assert.doesNotMatch(expired, /og:image/);
  assert.match(expired, /<meta name="twitter:card" content="summary">/);
  assert.match(expired, /<meta name="robots" content="noindex">/);
  assert.match(expired, /#\/\?o=2\.12a"\)/);

  const { url } = await (await upload(e, jpeg(1200, 630), { code: "2.12a" })).json() as { url: string };
  const id = /\/s\/(\w{12})/.exec(url)![1];
  const swapped = await (await worker.fetch(new Request(`${BASE}/s/${id}?o=2.zzz`), e)).text();
  assert.match(swapped, /#\/\?o=2\.12a"\)/);
  assert.doesNotMatch(swapped, /2\.zzz/);

  const junk = await (await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA?o=%22%3E%3Cscript%3E`), e)).text();
  assert.doesNotMatch(junk, /<script>"/);
  assert.match(junk, /location\.replace\("https:\/\/chronohaxx\.github\.io\/the-finals-outfit\/"\)/);
});

test("anything else redirects to the builder, and only GET reads", async () => {
  const e = env();
  const root = await worker.fetch(new Request(`${BASE}/`), e);
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("Location"), APP);
  assert.equal((await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA`, { method: "DELETE" }), e)).status, 405);
  assert.equal((await worker.fetch(new Request(`${BASE}/i/nope.jpg`), e)).status, 302);
});
