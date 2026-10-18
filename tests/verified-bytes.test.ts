import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { VerifiedByteCache, normalizeSha256 } from "../src/lib/verified-bytes";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const gzip = (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes));
const view = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)];

function server(initial: Record<string, Uint8Array>) {
  const bodies = new Map(Object.entries(initial));
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const body = bodies.get(url);
    if (!body) throw new Error(`Asset download failed (404): ${url}`);
    return new Response(new Uint8Array(body));
  };
  return { bodies, calls, fetcher, count: (url: string) => calls.filter((c) => c === url).length };
}

test("concurrent identical requests share one download but never a buffer", async () => {
  const raw = new Uint8Array([1, 2, 3, 4]);
  const url = "https://assets.test/tex.bin";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const cache = new VerifiedByteCache(async () => {
    calls++;
    await gate;
    return new Response(gzip(raw));
  });
  const pending = [cache.load(url, sha(raw), "gzip"), cache.load(url, sha(raw), "gzip")];
  assert.equal(cache.stats().pending, 1);
  release();
  const [a, b] = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.notEqual(a, b);
  new Uint8Array(a).fill(0);
  assert.deepEqual(view(b), [1, 2, 3, 4]);
  const c = await cache.load(url, sha(raw), "gzip");
  new Uint8Array(c).fill(9);
  const d = await cache.load(url, sha(raw), "gzip");
  assert.equal(calls, 1);
  assert.deepEqual(view(d), [1, 2, 3, 4]);
  assert.deepEqual(cache.stats(), { entries: 1, bytes: 4, pending: 0,
    budgetBytes: 128 * 1024 * 1024, maxEntries: 512 });
});

test("the key is the normalised absolute URL, the normalised digest and the encoding", async () => {
  const raw = new Uint8Array([5, 6, 7]);
  const url = "https://assets.test/x.bin", other = "https://assets.test/y.bin";
  const s = server({ [url]: raw, [other]: raw });
  const cache = new VerifiedByteCache(s.fetcher);
  await cache.load(url, sha(raw), "identity");
  await cache.load(url, sha(raw).toUpperCase(), "identity");
  await cache.load("https://ASSETS.test/x.bin", sha(raw), "identity");
  assert.equal(s.count(url), 1);
  await cache.load(other, sha(raw), "identity");
  assert.equal(s.count(other), 1);
  s.bodies.set(url, gzip(raw));
  assert.deepEqual(view(await cache.load(url, sha(raw), "gzip")), [5, 6, 7]);
  assert.equal(s.count(url), 2);
  await assert.rejects(cache.load("x.bin", sha(raw), "identity"));
  await assert.rejects(cache.load(url, "abc", "identity"), /digest/);
  await assert.rejects(cache.load(url, sha(raw) + "0", "identity"), /digest/);
  await assert.rejects(cache.load(url, "g".repeat(64), "identity"), /digest/);
  assert.equal(s.calls.length, 3);
  assert.equal(normalizeSha256("AB".repeat(32)), "ab".repeat(32));
  assert.throws(() => normalizeSha256(` ${"ab".repeat(32)}`), /digest/);
});

test("wrong digests and failed downloads are not retained, so a later attempt recovers", async () => {
  const raw = new Uint8Array([9, 9, 9]);
  const url = "https://assets.test/shader.glsl";
  const s = server({ [url]: new Uint8Array([0]) });
  const cache = new VerifiedByteCache(s.fetcher);
  const failing = [cache.load(url, sha(raw), "identity"), cache.load(url, sha(raw), "identity")];
  for (const attempt of failing) await assert.rejects(attempt, /hash mismatch/);
  assert.equal(s.count(url), 1);
  assert.deepEqual([cache.stats().entries, cache.stats().bytes, cache.stats().pending], [0, 0, 0]);
  s.bodies.delete(url);
  await assert.rejects(cache.load(url, sha(raw), "identity"), /404/);
  assert.equal(cache.stats().pending, 0);
  s.bodies.set(url, raw);
  assert.deepEqual(view(await cache.load(url, sha(raw), "identity")), [9, 9, 9]);
  assert.equal(s.count(url), 3);
  assert.equal(cache.stats().entries, 1);
});

test("a decompression failure is not retained and a valid gzip later loads", async () => {
  const raw = new Uint8Array(16).fill(7);
  const url = "https://assets.test/tex.rgba.gz.bin";
  const s = server({ [url]: raw });
  const cache = new VerifiedByteCache(s.fetcher);
  await assert.rejects(cache.load(url, sha(raw), "gzip"));
  assert.deepEqual([cache.stats().entries, cache.stats().pending], [0, 0]);
  s.bodies.set(url, gzip(raw));
  assert.deepEqual(view(await cache.load(url, sha(raw), "gzip")), [...raw]);
  assert.equal(s.count(url), 2);
});

test("retained bytes stay within the budget, evicting the least recently used", async () => {
  const urls = ["a", "b", "c"].map((name) => `https://assets.test/${name}.bin`);
  const bodies = urls.map((_, i) => new Uint8Array(4).fill(i + 1));
  const s = server(Object.fromEntries(urls.map((url, i) => [url, bodies[i]])));
  const cache = new VerifiedByteCache(s.fetcher, { budgetBytes: 10 });
  const load = (i: number) => cache.load(urls[i], sha(bodies[i]), "identity");
  await load(0);
  await load(1);
  assert.deepEqual([cache.stats().entries, cache.stats().bytes], [2, 8]);
  await load(0); // hit: a becomes the most recently used
  await load(2); // 12 bytes > 10: b is evicted
  assert.deepEqual([cache.stats().entries, cache.stats().bytes], [2, 8]);
  await load(0);
  await load(2);
  assert.deepEqual([s.count(urls[0]), s.count(urls[2])], [1, 1]);
  assert.deepEqual(view(await load(1)), [2, 2, 2, 2]);
  assert.equal(s.count(urls[1]), 2);
  assert.ok(cache.stats().bytes <= 10);
});

test("the entry cap evicts independently of the byte budget", async () => {
  const urls = ["a", "b", "c"].map((name) => `https://assets.test/cap-${name}.bin`);
  const bodies = urls.map((_, i) => new Uint8Array([i]));
  const s = server(Object.fromEntries(urls.map((url, i) => [url, bodies[i]])));
  const cache = new VerifiedByteCache(s.fetcher, { maxEntries: 2 });
  for (const i of [0, 1, 2]) await cache.load(urls[i], sha(bodies[i]), "identity");
  assert.deepEqual([cache.stats().entries, cache.stats().bytes], [2, 2]);
  await cache.load(urls[0], sha(bodies[0]), "identity");
  assert.equal(s.count(urls[0]), 2);
});

test("a payload larger than the budget is verified and returned but never retained", async () => {
  const small = new Uint8Array([1, 1, 1, 1]), big = new Uint8Array(8).fill(3);
  const smallUrl = "https://assets.test/small.bin", bigUrl = "https://assets.test/big.bin";
  const s = server({ [smallUrl]: small, [bigUrl]: big });
  const cache = new VerifiedByteCache(s.fetcher, { budgetBytes: 4 });
  await cache.load(smallUrl, sha(small), "identity");
  const [x, y] = await Promise.all([cache.load(bigUrl, sha(big), "identity"), cache.load(bigUrl, sha(big), "identity")]);
  assert.equal(s.count(bigUrl), 1);
  assert.notEqual(x, y);
  assert.deepEqual(view(x), [...big]);
  assert.deepEqual([cache.stats().entries, cache.stats().bytes], [1, 4]);
  await cache.load(bigUrl, sha(big), "identity");
  await cache.load(smallUrl, sha(small), "identity");
  assert.deepEqual([s.count(bigUrl), s.count(smallUrl)], [2, 1]);
});

test("cache bounds must be positive integers", () => {
  const fetcher = async () => new Response("");
  assert.throws(() => new VerifiedByteCache(fetcher, { budgetBytes: 0 }), /bounds/);
  assert.throws(() => new VerifiedByteCache(fetcher, { maxEntries: 1.5 }), /bounds/);
});
