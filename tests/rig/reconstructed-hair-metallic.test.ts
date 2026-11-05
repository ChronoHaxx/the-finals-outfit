// hair-metallic runtime branches of loadReconstructedMaterial (scripts/shader-probe/hair_metallic_contract.py,
// 22 Oct 2026): the M_Hair_Metallic DefaultLit kind keeps the hair kind's coverage and shadow handling but
// never the Karis hair lighting; its coverage may read the vertex colour, which the shadow pass must supply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://hairmetallic.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([1, 2, 3, 255]);
const texture = {
  id: "tex", slot: "t2", file: "texture.bin", array: false, depth: 1, srgb: false, wrapS: "TA_Wrap", wrapT: "TA_Wrap",
  sha256: sha(pixel), mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
};
// The emitted shape of a hair-metallic slice: the world geometry struct with the vertex colour.
const surfaceShader = "uniform highp sampler2D u_t2;\n"
  + "struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness;"
  + " vec3 objectPosition; vec4 color; };\n"
  + "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry geometry) {\n"
  + "  ReconstructedSurface surface;\n"
  + "  vec4 n0 = texture(u_t2, vec2(uv0.x, uv0.y));\n"
  + "  surface.baseColor = vec3(n0.x * geometry.color.x);\n"
  + "  surface.normal = vec3(0.0, 0.0, 1.0);\n"
  + "  surface.roughness = n0.y;\n"
  + "  surface.metalness = geometry.color.x;\n"
  + "  surface.specular = 0.5;\n"
  + "  surface.ao = 1.0;\n"
  + "  surface.opacity = n0.z;\n"
  + "  return surface;\n"
  + "}\n";
const coverageShader = "uniform highp sampler2D u_t2;\n"
  + "struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness;"
  + " vec3 objectPosition; vec4 color; };\n"
  + "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry geometry) {\n"
  + "  ReconstructedSurface surface;\n"
  + "  surface.opacity = texture(u_t2, vec2(uv0.x, uv0.y)).z * geometry.color.x;\n"
  + "  return surface;\n"
  + "}\n";
const metallicHair = {
  formatVersion: 1, itemId: "hair-metallic-test", shader: "surface.glsl", shaderSha256: sha(surfaceShader),
  requiredUvSets: [0], surfaceKind: "hair-metallic", worldSurface: true, geometryFrame: "source-world",
  normalSpace: "tangent", requiresVertexColor: true, requiredGeometryFields: ["color"],
  coverageGeometryFields: [], coverageShader: "coverage.glsl", coverageShaderSha256: sha(coverageShader),
  blendMode: "BLEND_Masked", shadingModel: "MSM_DefaultLit", twoSided: true, textures: [texture],
};

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = String(input);
    const name = url.slice("https://hairmetallic.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(surfaceShader);
    if (name === "coverage.glsl") return new Response(coverageShader);
    if (name === "texture.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

function hairMesh(withColor = true) {
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  if (withColor) {
    const count = g.getAttribute("position").count;
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 4).fill(0.5), 4));
  }
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}

async function compiled(name: string) {
  const loaded = await loadReconstructedMaterial(`https://hairmetallic.test/${name}`);
  const m = hairMesh();
  loaded.apply(m, undefined, { boundsOrigin: [0, 0, 0] });
  const material = m.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  const shadow = m.customDepthMaterial as THREE.MeshDepthMaterial;
  const depth = shadow ? { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader,
    fragmentShader: THREE.ShaderLib.depth.fragmentShader } : null;
  shadow?.onBeforeCompile(depth as never, {} as THREE.WebGLRenderer);
  return { mesh: m, material, fragment: s.fragmentShader, vertex: s.vertexShader,
    depth: depth ? { vertex: depth.vertexShader, fragment: depth.fragmentShader } : null };
}

const OPACITY = "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);";
const COLOR_INPUT = "recoveredGeometry.color = vRecoveredColor;";

test("hair-metallic keeps hair coverage and shadows without the Karis hair lighting", async t => {
  serve(t, { "metallic.json": metallicHair });
  const { material, fragment, vertex, depth, mesh } = await compiled("metallic.json");
  // The surface pass: vertex colour in, coverage out, the source world frame, DoubleSide, alpha hashing.
  assert.ok(vertex.includes("attribute vec4 color;"));
  assert.ok(vertex.includes("vRecoveredColor = color;"));
  assert.ok(fragment.includes("varying vec4 vRecoveredColor;"));
  assert.ok(fragment.includes(COLOR_INPUT));
  assert.ok(fragment.includes(OPACITY));
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.alphaHash, true);
  assert.equal(material.transparent, false);
  assert.equal(material.userData.surfaceKind, "hair-metallic");
  assert.equal(material.userData.hairLightingPolicy, undefined);
  // The generic lit path, never the hair kind's strand/Karis lighting.
  for (const token of ["hairTangent", "hairScatter", "recoveredStrand", "recoveredHairFacingNormal"])
    assert.ok(!fragment.includes(token), token);
  assert.ok(!fragment.includes("strand"));
  // The shadow pass: alpha hashing with the same coverage shader, single-sided synthetic geometry input.
  assert.ok(mesh.customDepthMaterial && mesh.customDistanceMaterial);
  assert.ok((mesh.customDepthMaterial as THREE.MeshDepthMaterial).alphaHash);
  assert.ok(depth!.fragment.includes("recoveredSurface(vRecoveredUv0, vRecoveredUv1, g).opacity"));
  // The real vertex colour is always declared for the metallic kind, so the synthetic geometry input
  // carries the mesh's own colour whether or not this coverage reads it.
  assert.ok(depth!.vertex.includes("attribute vec4 color;"));
  // Program keys stay distinct from the hair kind.
  assert.ok(material.customProgramCacheKey().endsWith(":false:hair-metallic"));
  assert.ok((mesh.customDepthMaterial as THREE.MeshDepthMaterial).customProgramCacheKey().endsWith(":hair-metallic"));
});

test("hair-metallic coverage may read the vertex colour; the shadow pass supplies the real colour", async t => {
  serve(t, { "color-coverage.json": { ...metallicHair, coverageGeometryFields: ["color"] } });
  const { mesh, depth } = await compiled("color-coverage.json");
  assert.ok(depth!.vertex.includes("attribute vec4 color;"));
  assert.ok(depth!.vertex.includes("vRecoveredColor = color;"));
  assert.ok(depth!.fragment.includes("varying vec4 vRecoveredColor;"));
  assert.ok(depth!.fragment.includes("1.0, vec3(0.0), vRecoveredColor);"));
  assert.ok((mesh.customDepthMaterial as THREE.MeshDepthMaterial).customProgramCacheKey().endsWith(":hair-metallic"));
});

test("hair-metallic fails closed outside its contract", async t => {
  serve(t, {
    "no-coverage.json": { ...metallicHair, coverageShader: undefined, coverageShaderSha256: undefined },
    "view-coverage.json": { ...metallicHair, coverageGeometryFields: ["view"] },
    "color-and-view.json": { ...metallicHair, coverageGeometryFields: ["color", "view"] },
  });
  for (const name of ["no-coverage.json", "view-coverage.json", "color-and-view.json"])
    await assert.rejects(loadReconstructedMaterial(`https://hairmetallic.test/${name}`), /UV-only coverage/, name);
  serve(t, { "strand.json": { ...metallicHair, normalSpace: "strand-tangent" },
             "no-vertex-colour.json": { ...metallicHair, requiresVertexColor: false } });
  await assert.rejects(compiled("strand.json"), /metallic hair requires the original RGBA vertex masks/);
  await assert.rejects(compiled("no-vertex-colour.json"), /metallic hair requires the original RGBA vertex masks/);
  // A mesh without the 4-component colour attribute is refused too.
  serve(t, { "metallic.json": metallicHair });
  const loaded = await loadReconstructedMaterial("https://hairmetallic.test/metallic.json");
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const plain = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  await assert.rejects(async () => loaded.apply(plain, undefined, { boundsOrigin: [0, 0, 0] }),
    /metallic hair requires the original RGBA vertex masks/);
});
