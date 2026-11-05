import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

// The scalp-stubble skin coverage (w61): a manifest may now carry
// skinCoverage: "neck-fade-stubble" exactly as the w53 space-brain manifest does (it keeps
// skinSurface and its own UV-only coverage shader), and the runtime treats it exactly like the
// existing "neck-fade" coverage: alpha hashing, the source neck-fade opacity policy, and no second
// hard alpha cutoff in the rig. Every other spelling still throws, and a coverage without a skin
// surface still throws.

(globalThis as { window?: unknown }).window ??= { location: { href: "https://assets.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([10, 20, 30, 255]);
const shader = "uniform sampler2D u_t0;\n";
const coverage = "float stubble(float fade) { return 1.0; }\n";

function coverageManifest(skinCoverage: "neck-fade" | "neck-fade-stubble" | "bogus" | "none",
  skinSurface = true) {
  return {
    formatVersion: 1, itemId: "coverage-test", shader: "surface.glsl",
    shaderSha256: sha(shader), requiredUvSets: [0],
    ...(skinSurface ? { skinSurface: true } : {}),
    ...(skinCoverage === "none" ? {} : { skinCoverage }),
    coverageShader: "coverage.glsl", coverageShaderSha256: sha(coverage), coverageGeometryFields: [],
    textures: [{
      id: "tex", slot: "t0", file: "tex.rgba.gz.bin", array: false, depth: 1, srgb: false,
      wrapS: "TA_Wrap", wrapT: "TA_Wrap", sha256: sha(pixel).toUpperCase(),
      mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
    }],
  };
}

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  const base = "https://assets.test/coverage/";
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice(base.length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "coverage.glsl") return new Response(coverage);
    if (name === "tex.rgba.gz.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
  return loadReconstructedMaterial(base + "a.json");
}

function mesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute("tangent", new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

const apply = async (loader: ReturnType<typeof loadReconstructedMaterial>) => {
  const target = mesh();
  (await loader).apply(target, undefined, { boundsOrigin: [0, 0, 0] });
  return target.material as THREE.Material;
};

test("the neck-fade-stubble coverage is admitted and behaves like the neck-fade coverage", async (t) => {
  const material = await apply(serve(t, { "a.json": coverageManifest("neck-fade-stubble") }));
  assert.equal(material.userData.skinCoverage, "neck-fade-stubble");
  assert.equal(material.alphaHash, true);
  assert.ok(material.userData.skinOpacityPolicy);
});

test("the existing neck-fade coverage loads exactly as before", async (t) => {
  const material = await apply(serve(t, { "a.json": coverageManifest("neck-fade") }));
  assert.equal(material.userData.skinCoverage, "neck-fade");
  assert.equal(material.alphaHash, true);
});

test("an unknown coverage spelling, or a coverage without a skin surface, is refused", async (t) => {
  await assert.rejects(apply(serve(t, { "a.json": coverageManifest("bogus") })),
    /Unsupported recovered skin coverage/);
  await assert.rejects(apply(serve(t, { "a.json": coverageManifest("neck-fade-stubble", false) })),
    /Unsupported recovered skin coverage/);
});
