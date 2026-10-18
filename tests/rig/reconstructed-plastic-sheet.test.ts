// PlasticSheet runtime branches of loadReconstructedMaterial (scripts/shader-probe/plastic_sheet_contract.py; review fix,
// 17 Oct 2026): the parametric opacity and generic face sign refusals, and the GLSL the geometry route emits with and
// without the face sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://plastic.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([1, 2, 3, 255]);
const shader = "uniform sampler2D u_t0;\n";
const texture = {
  id: "tex", slot: "t0", file: "texture.bin", array: false, depth: 1, srgb: false, wrapS: "TA_Wrap", wrapT: "TA_Wrap",
  sha256: sha(pixel), mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
};
const GEOMETRY_FIELDS = ["position", "tangent", "normal", "view", "handedness"];
// An ordinary generic geometry root (no face sign, no parametric opacity).
const geometry = {
  formatVersion: 1, itemId: "geometry-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  geometryDependentNormals: true, normalSpace: "tangent", twoSided: true, blendMode: "BLEND_Opaque", textures: [texture],
  requiredGeometryFields: GEOMETRY_FIELDS,
};
const POLICY = "PlasticSheet test coverage policy";
// A two-sided PlasticSheet manifest: parametric opacity and the rasterizer face sign.
const plastic = {
  ...geometry, itemId: "plastic-test", blendMode: "BLEND_Masked", parametricOpacity: { policy: POLICY, fields: ["OpacityMain"] },
  twoSidedSign: { policy: "pins" }, requiredGeometryFields: [...GEOMETRY_FIELDS, "faceSign"],
};
// A one-sided PlasticSheet program reads no face sign.
const oneSided = { ...plastic, itemId: "plastic-one-sided-test", twoSided: false, requiredGeometryFields: GEOMETRY_FIELDS };
const glass = {
  formatVersion: 1, itemId: "glass-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  glassSurface: true, surfaceKind: "glass", normalSpace: "tangent", blendMode: "BLEND_TranslucentGreyTransmittance",
  twoSided: true, textures: [texture],
};

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = String(input);
    const name = url.slice("https://plastic.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "texture.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

function mesh() {
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}

async function compiled(name: string) {
  const loaded = await loadReconstructedMaterial(`https://plastic.test/${name}`);
  const m = mesh();
  loaded.apply(m);
  const material = m.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return { mesh: m, material, fragment: s.fragmentShader };
}

const without = (value: Record<string, unknown>, key: string) => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

test("parametric opacity outside the generic Masked geometry route fails closed", async t => {
  const invalid: Record<string, unknown> = {
    "glass.json": { ...glass, parametricOpacity: { policy: POLICY } },
    "masked-clip.json": { ...plastic, maskedClip: { policy: "masked", opacitySource: { slot: "t0", component: "w" } } },
    "surface-kind.json": { ...plastic, surfaceKind: "teeth" },
    "opaque.json": { ...plastic, blendMode: "BLEND_Opaque" },
    "translucent.json": { ...plastic, blendMode: "BLEND_Translucent" },
    "no-blend.json": without(plastic, "blendMode"),
    "no-policy.json": { ...plastic, parametricOpacity: {} },
    "numeric-policy.json": { ...plastic, parametricOpacity: { policy: 7 } },
    "no-geometry.json": without(plastic, "geometryDependentNormals"),
    "world.json": { ...plastic, worldSurface: true },
  };
  serve(t, invalid);
  for (const name of Object.keys(invalid))
    await assert.rejects(loadReconstructedMaterial(`https://plastic.test/${name}`), /parametric opacity contract/, name);
});

test("a generic face sign without the geometry route fails closed", async t => {
  const invalid: Record<string, unknown> = {
    "no-geometry.json": { ...without(geometry, "geometryDependentNormals"), requiredGeometryFields: ["faceSign"] },
    "world.json": { ...geometry, worldSurface: true, requiredGeometryFields: [...GEOMETRY_FIELDS, "faceSign"] },
  };
  serve(t, invalid);
  for (const name of Object.keys(invalid))
    await assert.rejects(loadReconstructedMaterial(`https://plastic.test/${name}`), /face sign contract/, name);
});

// The generic geometry block exactly as the code before the PlasticSheet contract emitted it.
const PRE_CONTRACT_GEOMETRY = `
              // Differentiate a reflected view-space surface in source centimetres.
              // Positions and tangent vectors share one frame; retain interpolated
              // vector lengths, since the source differentiates their curvature.
              ReconstructedGeometry recoveredGeometry;
              recoveredGeometry.position = vec3(-vViewPosition.x, vViewPosition.y, -vViewPosition.z) * 100.0;
              recoveredGeometry.tangent = vec3(vTangent.x, -vTangent.y, vTangent.z);
              recoveredGeometry.normal = vec3(vNormal.x, -vNormal.y, vNormal.z);
              recoveredGeometry.view = -recoveredGeometry.position;
              recoveredGeometry.handedness = -vRecoveredHandedness;
            `;
const UNFLIP = `
              #ifdef FLIP_SIDED
                float recoveredUnflip = -1.0;
              #else
                float recoveredUnflip = 1.0;
              #endif`;
const FACE_SIGN = "recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * recoveredUnflip;";
const OPACITY = "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);";

test("the unflip and face sign are emitted only for a program that reads the face sign", async t => {
  serve(t, { "geometry.json": geometry, "plastic.json": plastic, "one-sided.json": oneSided });
  const ordinary = await compiled("geometry.json");
  const twoSided = await compiled("plastic.json");
  const single = await compiled("one-sided.json");

  // An ordinary geometry manifest: the pre-contract block, no unflip, no face sign, no opacity.
  assert.ok(ordinary.fragment.includes(PRE_CONTRACT_GEOMETRY));
  for (const token of ["recoveredUnflip", "faceSign", "FLIP_SIDED", OPACITY])
    assert.ok(!ordinary.fragment.includes(token), token);
  assert.equal(ordinary.material.alphaHash, false);
  assert.equal(ordinary.material.userData.coveragePolicy, undefined);

  // Two-sided PlasticSheet: the unflip block, the unflipped frame, the face sign and the parametric opacity.
  assert.ok(twoSided.fragment.includes(UNFLIP));
  assert.ok(twoSided.fragment.includes("recoveredGeometry.tangent = vec3(vTangent.x, -vTangent.y, vTangent.z) * recoveredUnflip;"));
  assert.ok(twoSided.fragment.includes("recoveredGeometry.normal = vec3(vNormal.x, -vNormal.y, vNormal.z) * recoveredUnflip;"));
  assert.ok(twoSided.fragment.includes(FACE_SIGN));
  assert.ok(twoSided.fragment.includes(OPACITY));
  // Those insertions are the only difference from the ordinary geometry fragment.
  const stripped = twoSided.fragment.replace(UNFLIP, "").replace(`\n              ${FACE_SIGN}`, "")
    .replaceAll(" * recoveredUnflip;", ";").replace(`\n            ${OPACITY}`, "\n            ");
  assert.equal(stripped, ordinary.fragment);

  // One-sided PlasticSheet: parametric opacity, but no unflip and no face sign.
  assert.ok(single.fragment.includes(PRE_CONTRACT_GEOMETRY));
  assert.ok(single.fragment.includes(OPACITY));
  for (const token of ["recoveredUnflip", "faceSign", "FLIP_SIDED"]) assert.ok(!single.fragment.includes(token), token);
  assert.equal(single.fragment.replace(`\n            ${OPACITY}`, "\n            "), ordinary.fragment);

  // Runtime state: alpha hashing with the manifest policy, depth written, no UV-only shadow coverage.
  for (const { material, mesh: m } of [twoSided, single]) {
    assert.equal(material.alphaHash, true);
    assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);
    assert.equal(material.userData.coveragePolicy, POLICY);
    assert.equal(m.customDepthMaterial, undefined);
    assert.equal(m.customDistanceMaterial, undefined);
  }
  assert.equal(twoSided.material.side, THREE.DoubleSide);
  assert.equal(single.material.side, THREE.FrontSide);
  // Separate programs: the cache key carries the parametric and face sign flags.
  const keys = [ordinary, twoSided, single].map(({ material }) => material.customProgramCacheKey());
  assert.ok(keys[0].endsWith(":false:false"));
  assert.ok(keys[1].endsWith(":true:true"));
  assert.ok(keys[2].endsWith(":true:false"));
});

test("cubemap glass keeps its own face sign and never the generic unflip", async t => {
  serve(t, { "cubemap.json": { ...glass, geometryFrame: "source-world", recoveredEmissive: true,
    requiredGeometryFields: ["position", "normal", "view", "faceSign"] } });
  const { fragment } = await compiled("cubemap.json");
  assert.ok(fragment.includes("recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * glassUnflip;"));
  assert.ok(!fragment.includes("recoveredUnflip"));
});
