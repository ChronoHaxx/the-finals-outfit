import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

// loadReconstructedMaterial resolves against the page URL; every URL below is already absolute.
(globalThis as { window?: unknown }).window ??= { location: { href: "https://assets.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([10, 20, 30, 255]);
const shader = "uniform sampler2D u_t0;\n";

function manifest(options: { mipWidth?: number; mipBytes?: number; shaderSha256?: string } = {}) {
  return {
    formatVersion: 1, itemId: "cache-test", shader: "surface.glsl",
    shaderSha256: options.shaderSha256 ?? sha(shader), requiredUvSets: [0],
    textures: [{
      id: "tex", slot: "t0", file: "tex.rgba.gz.bin", array: false, depth: 1, srgb: false,
      wrapS: "TA_Wrap", wrapT: "TA_Wrap", sha256: sha(pixel).toUpperCase(),
      mips: [{ width: options.mipWidth ?? 1, height: 1, offset: 0, bytes: options.mipBytes ?? 4 }],
    }],
  };
}

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, base: string, manifests: Record<string, unknown>) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const name = url.slice(base.length);
    if (url.startsWith(base) && name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (url === base + "surface.glsl") return new Response(shader);
    if (url === base + "tex.rgba.gz.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
  return (name: string) => calls.filter((url) => url === base + name).length;
}

function mesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

const textureOf = (m: THREE.Mesh) => (m.material as THREE.Material).userData.tex as THREE.CompressedTexture;
const mipData = (texture: THREE.CompressedTexture) => texture.mipmaps![0].data as Uint8Array;

test("repeat loads reuse verified bytes, refetch the manifest and own their textures", async (t) => {
  const base = "https://assets.test/reuse/";
  const count = serve(t, base, { "a.json": manifest() });
  const first = await loadReconstructedMaterial(base + "a.json");
  const second = await loadReconstructedMaterial(base + "a.json");
  assert.equal(count("a.json"), 2);
  assert.equal(count("surface.glsl"), 1);
  assert.equal(count("tex.rgba.gz.bin"), 1);

  const a = mesh(), b = mesh();
  first.apply(a);
  second.apply(b);
  const ta = textureOf(a), tb = textureOf(b);
  assert.ok(ta.isTexture && tb.isTexture);
  assert.notEqual(ta, tb);
  assert.notEqual(mipData(ta).buffer, mipData(tb).buffer);
  mipData(ta).fill(0);
  assert.deepEqual([...mipData(tb)], [...pixel]);

  let disposed = 0;
  tb.addEventListener("dispose", () => { disposed++; });
  first.dispose();
  assert.equal(disposed, 0);
  const third = await loadReconstructedMaterial(base + "a.json");
  const c = mesh();
  third.apply(c);
  assert.deepEqual([...mipData(textureOf(c))], [...pixel]);
  assert.equal(count("tex.rgba.gz.bin"), 1);
  second.dispose();
  assert.equal(disposed, 1);
  third.dispose();
});

test("cached texture bytes still fail an invalid layout on every load", async (t) => {
  const base = "https://assets.test/layout/";
  const count = serve(t, base, { "good.json": manifest(), "bad.json": manifest({ mipWidth: 2, mipBytes: 8 }) });
  (await loadReconstructedMaterial(base + "good.json")).dispose();
  await assert.rejects(loadReconstructedMaterial(base + "bad.json"), /Invalid recovered texture length/);
  assert.equal(count("tex.rgba.gz.bin"), 1);
  (await loadReconstructedMaterial(base + "good.json")).dispose();
  assert.equal(count("tex.rgba.gz.bin"), 1);
});

test("a changed shader digest is refetched and verified rather than served from the cache", async (t) => {
  const base = "https://assets.test/digest/";
  const count = serve(t, base, { "good.json": manifest(), "stale.json": manifest({ shaderSha256: sha("other") }) });
  (await loadReconstructedMaterial(base + "good.json")).dispose();
  await assert.rejects(loadReconstructedMaterial(base + "stale.json"), /hash mismatch/);
  assert.equal(count("surface.glsl"), 2);
  (await loadReconstructedMaterial(base + "good.json")).dispose();
  assert.equal(count("surface.glsl"), 2);
});
