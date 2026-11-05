// The hue-keeping preview emission exposure (signed off 29 Oct 2026, _docs/goal-100-2026-10-11/signoffs-2026-10-29.json
// emissionHueKeepingExposure): an opt-in manifest field. Without it a recovered emission is added exactly as before (same
// GLSL, same program cache key); with it the emission's peak channel is capped at 1 with its hue kept; any other use fails
// closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://exposure.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([1, 2, 3, 255]);
const shader = "uniform sampler2D u_t0;\n";
const texture = {
  id: "tex", slot: "t0", file: "texture.bin", array: false, depth: 1, srgb: false, wrapS: "TA_Wrap", wrapT: "TA_Wrap",
  sha256: sha(pixel), mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
};
// A source-world deferred surface with a recovered emission (the attachment-family shape).
const emissive = {
  formatVersion: 1, itemId: "emissive-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  worldSurface: true, geometryFrame: "source-world", normalSpace: "tangent", twoSided: false, blendMode: "BLEND_Masked",
  textures: [texture], requiredGeometryFields: ["position", "normal", "view"], recoveredEmissive: true,
};
const hueKeeping = { ...emissive, itemId: "hue-keeping-test", emissiveExposure: "hue-keeping" };
const UNCHANGED = `
            #include <emissivemap_fragment>
            totalEmissiveRadiance += recovered.emissive;
          `;
const CAPPED = `
            #include <emissivemap_fragment>
            float recoveredEmissivePeak = max(max(recovered.emissive.r, recovered.emissive.g), recovered.emissive.b);
            totalEmissiveRadiance += recoveredEmissivePeak > 1.0 ? recovered.emissive / recoveredEmissivePeak : recovered.emissive;
          `;

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice("https://exposure.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "texture.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

async function compiled(name: string) {
  const loaded = await loadReconstructedMaterial(`https://exposure.test/${name}`);
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(m, undefined, { boundsOrigin: [0, 0, 150] });
  const material = m.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return { material, fragment: s.fragmentShader };
}

test("without the opt-in the recovered emission is added unchanged", async t => {
  serve(t, { "emissive.json": emissive });
  const { material, fragment } = await compiled("emissive.json");
  assert.ok(fragment.includes(UNCHANGED));
  assert.ok(!fragment.includes("recoveredEmissivePeak"));
  assert.ok(!material.customProgramCacheKey().includes("hue-keeping"));
  assert.equal(material.userData.emissiveExposurePolicy, undefined);
});

test("the hue-keeping exposure caps the peak channel at 1 and changes nothing else", async t => {
  serve(t, { "emissive.json": emissive, "hue.json": hueKeeping });
  const plain = await compiled("emissive.json");
  const capped = await compiled("hue.json");
  assert.ok(capped.fragment.includes(CAPPED));
  assert.equal(capped.fragment.replace(CAPPED, UNCHANGED), plain.fragment);
  assert.equal(capped.material.customProgramCacheKey(),
    plain.material.customProgramCacheKey().replace("emissive-test", "hue-keeping-test") + ":hue-keeping");
  assert.match(String(capped.material.userData.emissiveExposurePolicy), /hue-keeping/);
});

test("the GLSL cap keeps the hue: a mirror of the expression", () => {
  // The same arithmetic as CAPPED, on a strong LED glow (IVADA visor tint 0.386, 0.036, 0.054 x Brightness 10).
  const cap = (e: number[]) => { const peak = Math.max(...e); return peak > 1 ? e.map(c => c / peak) : e; };
  const glow = [3.86429, 0.36228, 0.54246];
  const out = cap(glow);
  assert.equal(Math.max(...out), 1);
  for (let i = 1; i < 3; i++) assert.ok(Math.abs(out[i] / out[0] - glow[i] / glow[0]) < 1e-12);
  assert.deepEqual(cap([0.5, 0.25, 0]), [0.5, 0.25, 0]);
});

test("the exposure outside a recovered deferred emission fails closed", async t => {
  const glass = {
    formatVersion: 1, itemId: "glass-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
    glassSurface: true, surfaceKind: "glass", normalSpace: "tangent", blendMode: "BLEND_TranslucentGreyTransmittance",
    twoSided: true, textures: [texture], recoveredEmissive: true, emissiveExposure: "hue-keeping",
  };
  const invalid: Record<string, unknown> = {
    "unknown.json": { ...emissive, emissiveExposure: "clamp" },
    "no-emission.json": { ...hueKeeping, recoveredEmissive: false },
    "glass.json": glass,
  };
  serve(t, invalid);
  for (const name of Object.keys(invalid))
    await assert.rejects(loadReconstructedMaterial(`https://exposure.test/${name}`), /emissive exposure/, name);
});
