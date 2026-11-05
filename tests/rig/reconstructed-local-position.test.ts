// The base-pass vertex interpolators' local position (2 Nov 2026, w115; scripts/shader-probe/vertex_interpolants.py):
// a program whose vertex shader passes the raw local position through reads it as geometry.localPosition. Only the
// generic geometry route supplies it, from the untouched position attribute in source centimetres and axes; any other
// route, or a manifest without the vertex record, fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://local.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const shader = "struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 localPosition; };\n" +
  "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry geometry) {\n" +
  "  ReconstructedSurface surface;\n  surface.baseColor = fract(geometry.localPosition * 0.01);\n  return surface;\n}\n";
const record = { lanes: { "v2.z": ["localPosition", "x"] }, vertexComputed: {}, materialBuffers: { vertex: 4, pixel: 3 } };
const generic = {
  formatVersion: 1, itemId: "local-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  geometryDependentNormals: true, normalSpace: "tangent", twoSided: false, blendMode: "BLEND_Opaque", textures: [],
  requiredGeometryFields: ["handedness", "localPosition", "normal", "position", "tangent", "view"],
  vertexInterpolants: record,
};

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice("https://local.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    return new Response("", { status: 404 });
  });
}

async function compiled(name: string) {
  const loaded = await loadReconstructedMaterial(`https://local.test/${name}`);
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(mesh);
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  (mesh.material as THREE.MeshPhysicalMaterial).onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return s;
}

test("the generic route passes the raw position attribute through and converts it to source centimetres", async t => {
  serve(t, { "local.json": generic });
  const { vertexShader, fragmentShader } = await compiled("local.json");
  assert.ok(vertexShader.includes("varying vec3 vRecoveredLocalPosition;"));
  assert.ok(vertexShader.includes("vRecoveredLocalPosition = position;"));
  // Copied in the uv chunk, before morphs and skinning write `transformed`.
  assert.ok(vertexShader.indexOf("vRecoveredLocalPosition = position;") < vertexShader.indexOf("#include <skinning_vertex>"));
  assert.ok(fragmentShader.includes("recoveredGeometry.localPosition = vRecoveredLocalPosition.xzy * 100.0;"));
});

test("a program without the field keeps its shaders free of the local position", async t => {
  const { vertexInterpolants: _, ...plain } = generic;
  serve(t, { "plain.json": { ...plain, requiredGeometryFields: ["handedness", "normal", "position", "tangent", "view"] } });
  const { vertexShader, fragmentShader } = await compiled("plain.json");
  assert.ok(!vertexShader.includes("vRecoveredLocalPosition"));
  assert.ok(!fragmentShader.includes("vRecoveredLocalPosition"));
});

// A masked cut-out whose clip reads the local position (M_FurShells): its shadow coverage takes it as a third argument.
const coverage = "struct ReconstructedCoverageGeometry { vec3 localPosition; };\n" +
  "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedCoverageGeometry geometry) {\n" +
  "  ReconstructedSurface surface;\n  surface.opacity = fract(geometry.localPosition.x * 0.01);\n  return surface;\n}\n";
const cutout = { ...generic, blendMode: "BLEND_Masked", coverageShader: "coverage.glsl", coverageShaderSha256: sha(coverage),
  coverageGeometryFields: ["localPosition"],
  maskedClip: { policy: "local-position cut-out", cutout: true, slots: [], geometryFields: ["localPosition"] } };

async function shadow(t: TestContext, manifests: Record<string, unknown>, name: string) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const file = String(input).slice("https://local.test/".length);
    if (file in manifests) return new Response(JSON.stringify(manifests[file]));
    if (file === "surface.glsl") return new Response(shader);
    if (file === "coverage.glsl") return new Response(coverage);
    return new Response("", { status: 404 });
  });
  const loaded = await loadReconstructedMaterial(`https://local.test/${name}`);
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(mesh);
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  mesh.customDepthMaterial!.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return s;
}

test("a local-position cut-out's shadow coverage reads the same untouched position attribute", async t => {
  const { vertexShader, fragmentShader } = await shadow(t, { "cutout.json": cutout }, "cutout.json");
  assert.ok(vertexShader.includes("varying vec3 vRecoveredLocalPosition;"));
  assert.ok(vertexShader.includes("vRecoveredLocalPosition = position;"));
  assert.ok(vertexShader.indexOf("vRecoveredLocalPosition = position;") < vertexShader.indexOf("#include <skinning_vertex>"));
  assert.ok(fragmentShader.includes("recoveredSurface(vRecoveredUv0, vRecoveredUv1, ReconstructedCoverageGeometry(vRecoveredLocalPosition.xzy * 100.0))"));
});

test("a coverage geometry field fails closed unless the surface itself reads the recorded local position", async t => {
  const { vertexInterpolants: _, ...unrecorded } = cutout;
  await assert.rejects(shadow(t, { "plain.json": { ...unrecorded, requiredGeometryFields: ["handedness", "normal", "position", "tangent", "view"] } },
    "plain.json"), /validated UV-only coverage/);
});

// (w115 part 2) the shell offset: worldNormal x floor(uv0.y) x Length (M_FurShells), applied after skinning in both passes.
const shellOffset = { value: ["mul", ["floor", ["uv", 0, "y"]], ["const", 0.318]] };
const lodOffset = { value: ["add", ["mul", ["add", ["mul", ["color", "y"], ["const", 2]], ["const", -1]], ["const", 0.5]], ["const", 1]] };

test("a shell offset moves each layer along the skinned normal in both the surface and the shadow pass", async t => {
  const { vertexShader } = await shadow(t, { "shell.json": { ...cutout, vertexOffset: shellOffset } }, "shell.json");
  const line = "transformed += normalize( objectNormal ) * ( (floor(uv.y) * (0.317999989)) ) * 0.01;";
  assert.ok(vertexShader.includes(line));
  assert.ok(vertexShader.indexOf(line) > vertexShader.indexOf("#include <skinning_vertex>"));
  assert.ok(vertexShader.includes("#include <skinnormal_vertex>"));  // the depth pass computes the skinned normal itself
  serve(t, { "shell.json": { ...cutout, vertexOffset: shellOffset } });
  const loaded = await loadReconstructedMaterial("https://local.test/shell.json");
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  (mesh.geometry as THREE.BufferGeometry).computeTangents();
  loaded.apply(mesh);
  const material = mesh.material as THREE.Material;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.vertexShader.includes(line));
  assert.ok(material.customProgramCacheKey().includes(":offset:(floor(uv.y) * (0.317999989))"));
});

test("a vertex-colour offset declares the colour attribute itself", async t => {
  const { vertexShader } = await shadow(t, { "lod.json": { ...cutout, vertexOffset: lodOffset } }, "lod.json");
  assert.ok(vertexShader.includes("attribute vec4 color;"));
  assert.ok(vertexShader.includes("vec4 recoveredOffsetColor = vec4( color );"));
  assert.ok(vertexShader.includes("recoveredOffsetColor.y"));
});

test("a vertex offset fails closed off the masked generic route or with an unknown expression", async t => {
  const { maskedClip: _, coverageShader: __, coverageShaderSha256: ___, coverageGeometryFields: ____, ...unmasked } = cutout;
  serve(t, { "unmasked.json": { ...unmasked, vertexOffset: shellOffset },
             "unknown.json": { ...cutout, vertexOffset: { value: ["sin", ["uv", 0, "y"]] } } });
  await assert.rejects(loadReconstructedMaterial("https://local.test/unmasked.json"), /Unsupported recovered vertex offset contract/);
  await assert.rejects(loadReconstructedMaterial("https://local.test/unknown.json"), /Unsupported recovered vertex offset expression/);
});

test("the local position fails closed without its vertex record or off the generic route", async t => {
  const { vertexInterpolants: _, ...unrecorded } = generic;
  serve(t, { "unrecorded.json": unrecorded,
             "world.json": { ...generic, geometryDependentNormals: undefined, worldSurface: true, geometryFrame: "source-world" } });
  await assert.rejects(compiled("unrecorded.json"), /Unsupported recovered local position contract/);
  await assert.rejects(compiled("world.json"), /Unsupported recovered local position contract/);
});
