// The attachment-family cut-out (29 Oct 2026, w85, decision #14 playerNamePlaceholder; scripts/shader-probe/
// attachment_family_contract.py FAMILY_CUTOUT_POLICY): a family world surface whose masked clip reads no dither keeps
// or discards each fragment exactly, so it rides the existing alpha-hash surface and UV-only shadow coverage. Only that
// pairing is admitted on the worldSurface route; every other masked clip there still fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://cutout.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([1, 2, 3, 255]);
const shader = "uniform sampler2D u_t0;\n";
const coverage = "uniform sampler2D u_t0;\nReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) { ReconstructedSurface s; s.opacity = 1.0; return s; }\n";
const texture = {
  id: "tex", slot: "t0", file: "texture.bin", array: false, depth: 1, srgb: false, wrapS: "TA_Clamp", wrapT: "TA_Clamp",
  sha256: sha(pixel), mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
};
// The attachment-family manifest shape (source-world deferred surface, BLEND_Masked).
const family = {
  formatVersion: 1, itemId: "family-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  worldSurface: true, geometryFrame: "source-world", normalSpace: "tangent", twoSided: false, blendMode: "BLEND_Masked",
  surfaceKind: "attachment-family", attachmentFamily: true, textures: [texture],
  requiredGeometryFields: ["position", "normal", "view"],
};
const cutout = {
  ...family, itemId: "cutout-test",
  maskedClip: { policy: "Masked cut-out; test", cutout: true, opacitySource: { slot: "t0", texture: "/Game/T.0" } },
  coverageShader: "coverage.glsl", coverageShaderSha256: sha(coverage), coverageGeometryFields: [],
};
const ALPHA = "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);";
const UV_ONLY = "recoveredSurface(vRecoveredUv0, vRecoveredUv1).opacity";

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice("https://cutout.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "coverage.glsl") return new Response(coverage);
    if (name === "texture.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

async function applied(name: string) {
  const loaded = await loadReconstructedMaterial(`https://cutout.test/${name}`);
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(mesh, undefined, { boundsOrigin: [0, 0, 150] });
  const material = mesh.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return { mesh, material, fragment: s.fragmentShader };
}

test("a family surface without a masked clip stays opaque, as before", async t => {
  serve(t, { "family.json": family });
  const { mesh, material, fragment } = await applied("family.json");
  assert.equal(material.alphaHash, false);
  assert.ok(!fragment.includes(ALPHA));
  assert.equal(mesh.customDepthMaterial, undefined);
});

test("the family cut-out hashes its exact 0/1 opacity and casts UV-only coverage shadows", async t => {
  serve(t, { "cutout.json": cutout });
  const { mesh, material, fragment } = await applied("cutout.json");
  assert.equal(material.alphaHash, true);
  assert.ok(fragment.includes(ALPHA));
  assert.equal(material.userData.coveragePolicy, "Masked cut-out; test");
  const depth = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
  assert.equal(depth.alphaHash, true);
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.fragmentShader.includes(UV_ONLY));
  assert.ok(s.fragmentShader.includes(coverage));
});

// 29 Oct 2026 (w87 Feather): a dithered family tail's kept fraction names its authored channel.
const keptFraction = {
  ...cutout, itemId: "kept-fraction-test",
  maskedClip: { policy: "Authored opacity mask; test", opacitySource: { slot: "t0", component: "w", texture: "/Game/T.0" } },
};

test("a dithered family tail hashes its kept fraction on the same UV-only paths", async t => {
  serve(t, { "kept.json": keptFraction });
  const { mesh, material, fragment } = await applied("kept.json");
  assert.equal(material.alphaHash, true);
  assert.ok(fragment.includes(ALPHA));
  assert.equal(material.userData.coveragePolicy, "Authored opacity mask; test");
  const depth = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.fragmentShader.includes(UV_ONLY));
});

// 2 Nov 2026 (w113 blank-face LED head): the bare neck fade of a family head program has no texture at all.
const bareNeckFade = {
  ...cutout, itemId: "bare-neck-fade-test",
  maskedClip: { policy: "Masked: the head's neck band fades by UV v; test", neckFade: { slot: null, fade: [-30.3, 28.6] } },
};

test("a family head's bare neck fade hashes its UV-only kept fraction", async t => {
  serve(t, { "neck.json": bareNeckFade });
  const { mesh, material, fragment } = await applied("neck.json");
  assert.equal(material.alphaHash, true);
  assert.ok(fragment.includes(ALPHA));
  const depth = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.fragmentShader.includes(UV_ONLY));
});

test("a neck fade that names a texture slot is not the bare route", async t => {
  serve(t, { "neck-slot.json": { ...bareNeckFade, maskedClip: { ...bareNeckFade.maskedClip, neckFade: { slot: "t0", fade: [-30.3, 28.6] } } } });
  await assert.rejects(loadReconstructedMaterial("https://cutout.test/neck-slot.json"), /masked clip contract/);
});

test("every other masked clip on the world route still fails closed", async t => {
  const invalid: Record<string, unknown> = {
    "not-cutout.json": { ...cutout, maskedClip: { ...cutout.maskedClip, cutout: undefined } },
    "not-family.json": { ...cutout, attachmentFamily: undefined },
    "other-kind.json": { ...cutout, surfaceKind: "hair" },
    "skin.json": { ...cutout, skinSurface: true },
    "no-policy.json": { ...cutout, maskedClip: { cutout: true, opacitySource: { slot: "t0" } } },
  };
  serve(t, invalid);
  for (const name of Object.keys(invalid))
    await assert.rejects(loadReconstructedMaterial(`https://cutout.test/${name}`), /masked clip contract|skin/, name);
});

test("the cut-out still requires its validated UV-only coverage", async t => {
  serve(t, { "no-coverage.json": { ...cutout, coverageShader: undefined },
    "geometry-coverage.json": { ...cutout, coverageGeometryFields: ["position"] } });
  for (const name of ["no-coverage.json", "geometry-coverage.json"])
    await assert.rejects(loadReconstructedMaterial(`https://cutout.test/${name}`), /UV-only coverage/, name);
});
