import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

// w95 stage 3 (2 Nov 2026): the statue heads' recovered manifest is a GENERIC root's masked clip - the
// pinned M_Face_Hardsurface neck-fade kept fraction (masked_contract.HEAD_NECK_FADE_PROGRAMS), with no
// skinSurface, no worldSurface and no surfaceKind. These tests pin that such a manifest renders on a head
// section exactly as the other qualified masked materials do: alpha hashing on the surface pass, the
// UV-only coverage shader on the shadow pass, and the manifest's own policy visible on the material.

const ORIGIN = "https://generic-masked-head.test/";
(globalThis as { window?: unknown }).window ??= { location: { href: ORIGIN } };
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

const NECK_FADE_POLICY =
  "Masked: the head's neck band fades by UV v (NeckTransition), kept where scalp hair-card coverage x Hair " +
  "Mask Amount reaches it; the spawned, undamaged state; dither through the compiled tail";
const shader = "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry geometry) {\n" +
  "  ReconstructedSurface surface;\n" +
  "  surface.opacity = clamp((0.978 - uv0.y) * 16.0, 0.0, 1.0);\n" +
  "  surface.baseColor = vec3(0.6); surface.normal = vec3(0.0, 0.0, 1.0); surface.roughness = 0.5;\n" +
  "  surface.metalness = 0.0; surface.specular = 0.5; surface.ao = 1.0;\n" +
  "  return surface;\n}\n";
const coverage = "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n" +
  "  ReconstructedSurface surface; surface.opacity = clamp((0.978 - uv0.y) * 16.0, 0.0, 1.0);\n" +
  "  return surface;\n}\n";
// The generic masked head manifest shape build-materials emits for the pinned neck-fade program.
const neckFadeHead = {
  formatVersion: 1, itemId: "neck-fade-test", shader: "surface.glsl", shaderSha256: sha(shader),
  requiredUvSets: [0], geometryDependentNormals: true, normalSpace: "tangent", twoSided: false,
  blendMode: "BLEND_Masked", genericRoot: "M_Face_Hardsurface", textures: [],
  maskedClip: {
    policy: NECK_FADE_POLICY,
    opacitySource: { slot: "t5", component: "w", sampleMode: "implicit", hairMaskAmount: 1.0 },
    neckFade: { hairMaskAmount: 1.0, neckTransition: 1.0, fade: [-30.30303, 28.636364],
                slot: "t5", component: "w", sampleMode: "implicit" },
  },
  coverageShader: "coverage.glsl", coverageShaderSha256: sha(coverage), coverageGeometryFields: [],
};
const ALPHA = "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);";
const UV_ONLY = "recoveredSurface(vRecoveredUv0, vRecoveredUv1).opacity";

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice(ORIGIN.length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "coverage.glsl") return new Response(coverage);
    return new Response("", { status: 404 });
  });
}

async function applied(name: string) {
  const loaded = await loadReconstructedMaterial(`${ORIGIN}${name}`);
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(mesh, undefined, {});
  const material = mesh.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return { mesh, material, fragment: s.fragmentShader };
}

test("a generic masked clip hashes its dithered kept fraction and casts UV-only coverage shadows", async t => {
  serve(t, { "head.json": neckFadeHead });
  const { mesh, material, fragment } = await applied("head.json");
  assert.equal(material.alphaHash, true);
  assert.equal(material.transparent, false);
  assert.equal(material.depthWrite, true);
  assert.ok(fragment.includes(ALPHA), "the surface pass multiplies the recovered kept fraction into the alpha");
  assert.ok(fragment.includes("recoveredSurface(vRecoveredUv0, vRecoveredUv1, recoveredGeometry)"));
  assert.equal(material.userData.coveragePolicy, NECK_FADE_POLICY);
  const depth = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
  assert.equal(depth.alphaHash, true);
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.fragmentShader.includes(UV_ONLY), "the shadow pass reads the UV-only coverage");
  assert.ok(s.fragmentShader.includes(coverage));
});

test("a generic masked clip still requires its validated UV-only coverage", async t => {
  serve(t, { "no-coverage.json": { ...neckFadeHead, coverageShader: undefined },
    "geometry-coverage.json": { ...neckFadeHead, coverageGeometryFields: ["position"] } });
  for (const name of ["no-coverage.json", "geometry-coverage.json"])
    await assert.rejects(loadReconstructedMaterial(`${ORIGIN}${name}`), /UV-only coverage/, name);
});

// --- the rig level: the masked head section inside a legacy-free skin pair -----------------------

const RIG_ORIGIN = "http://generic-masked-head-rig.test/";
const FACE_ID = "head-statue-01";
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Statue_01.SK_Head_Statue_01";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_Head_Statue_01.MI_Head_Statue_01";
const SHELL_MI = "/Game/Test/Heads/MI_Head_Statue_01_EyeShell.MI_Head_Statue_01_EyeShell";
const BODY_MI = "/Game/Test/Heads/MI_Statue_Body_01.MI_Statue_Body_01";

const rigFiles = new Map<string, string>();
(globalThis as { fetch?: unknown }).fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const body = rigFiles.get(url);
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: RIG_ORIGIN } };
(globalThis as { Image?: unknown }).Image = class {
  set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
  onerror?: () => void;
};
if (!(globalThis as { document?: unknown }).document)
  (globalThis as { document?: unknown }).document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
    createElement: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
  };

function serveRigMaterial(base: string, name: string, manifest: Record<string, unknown> = {}): string {
  rigFiles.set(`${base}/materials/${name}.glsl`, shader);
  rigFiles.set(`${base}/materials/${name}.coverage.glsl`, coverage);
  rigFiles.set(`${base}/materials/${name}.json`, JSON.stringify({ ...neckFadeHead, itemId: name,
    shader: `${name}.glsl`, shaderSha256: sha(shader), coverageShader: `${name}.coverage.glsl`,
    coverageShaderSha256: sha(coverage), ...manifest }));
  return `${base}/materials/${name}.json`;
}

const pair = () => {
  const base = `${RIG_ORIGIN}pair`;
  return {
    head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: `${base}/meshes/head.glb`, boundsOrigin: [0, -0.65, 166.17],
      previewBaseline: "legacy-equivalent-v1",
      materials: {
        shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI, url: serveRigMaterial(base, "head") },
        shader_eyeshell_shader: { source: SHELL_MI, defaultSource: SHELL_MI, invisibleShell: true },
      } },
    body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: `${base}/meshes/body.glb`, boundsOrigin: [0, -0.91, 83.8],
      materials: { BaseBody: { source: BODY_MI, defaultSource: BODY_MI, url: serveRigMaterial(base, "body") } } },
  } as never;
};

const bone = (name: string, matrix: THREE.Matrix4, parent?: THREE.Bone) => {
  const created = new THREE.Bone();
  created.name = name;
  parent?.updateWorldMatrix(true, false);
  (parent ? matrix.clone().premultiply(parent.matrixWorld.clone().invert()) : matrix)
    .decompose(created.position, created.quaternion, created.scale);
  parent?.add(created);
  created.updateWorldMatrix(true, false);
  return created;
};
const HEAD_REST = new THREE.Matrix4().makeTranslation(0, 1.6, 0.01);

function surface(triangles: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corners = Array.from({ length: triangles }, (_, t) => [t, 0, 0, t + 0.01, 0, 0, t, 0.01, 0]).flat();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(Array(triangles * 3).fill([0, 0, 1]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(Array(triangles).fill([0, 0, 1, 0, 0, 1]).flat(), 2));
  geometry.setIndex([...Array(triangles * 3).keys()]);
  geometry.computeTangents();  // geometry-dependent recovered surfaces need the original tangents
  return geometry;
}

/** A multi-primitive head GLB as three's GLTFLoader hands it to the rig: a group of skinned meshes, one
 *  per material section, each with a SINGLE material (never a material array). */
function headGltf(): THREE.Group {
  const geometry = surface(2);
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(Array(6).fill([1, 0, 0, 0]).flat(), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array(6).fill([1, 0, 0, 0]).flat(), 4));
  const group = new THREE.Group();
  const root = bone("root", new THREE.Matrix4());
  const head = bone("head", HEAD_REST, root);
  group.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([root, head], [root, head].map(b => b.matrixWorld.clone().invert()));
  for (const slot of ["shader_head_shader", "shader_eyeshell_shader"]) {
    const material = new THREE.MeshStandardMaterial({ name: `source-${slot}` });
    material.userData.sourceSlot = { MaterialSlotName: slot };
    const mesh = new THREE.SkinnedMesh(geometry.clone(), material);
    mesh.bind(skeleton, mesh.bindMatrix);
    group.add(mesh);
  }
  return group;
}

function harness(bodyUrl: string) {
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  bone("head", HEAD_REST, driverRoot);
  root.updateMatrixWorld(true);
  const driverBones = [driverRoot, ...driverRoot.children as THREE.Bone[]];
  const body = new THREE.SkinnedMesh(surface(1), new THREE.MeshStandardMaterial({ name: "legacy-body" }));
  body.userData.sourceBody = true;
  body.userData.sourceBodyUrl = bodyUrl;
  const bodyScene = new THREE.Group().add(body);
  const rig = new CharacterRig({ loadAsync: async () => ({ scene: headGltf() }) } as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>;
    bodyRestInverses: Map<string, THREE.Matrix4>; bodyScene: THREE.Object3D;
  };
  internals.skeleton = new THREE.Skeleton(driverBones);
  body.bind(internals.skeleton);
  internals.bonesByName = new Map(driverBones.map(b => [b.name, b]));
  internals.bodyRestInverses = new Map(driverBones.map(b => [b.name, b.matrixWorld.clone().invert()]));
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  return { rig, root };
}

test("stageSourceSkin renders the masked generic head with its dithered, alpha-hashed coverage", async () => {
  const value = pair();
  const { rig, root } = harness(value.body.url);
  assert.equal(await rig.equipSourceItems([{ id: FACE_ID, slot: "face" as never, url: "",
    sourceSkinPair: value } as never]), true);
  const head = (root.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[])
    .find(o => o.userData.sourceMesh === HEAD_MESH) as THREE.SkinnedMesh;
  const material = (Array.isArray(head.material) ? head.material[0] : head.material) as THREE.MeshStandardMaterial;
  assert.equal(material.userData.reconstructed, true);
  assert.equal(material.userData.skinSurface ?? false, false);
  assert.equal(material.alphaHash, true);
  assert.equal(material.userData.coveragePolicy, NECK_FADE_POLICY);
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  assert.ok(s.fragmentShader.includes(ALPHA));
  const depth = head.customDepthMaterial as THREE.MeshDepthMaterial;
  assert.ok(depth, "the masked head casts coverage shadows");
  const shadow = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader,
    fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(shadow as never, {} as THREE.WebGLRenderer);
  assert.ok(shadow.fragmentShader.includes(UV_ONLY));
  assert.ok(shadow.fragmentShader.includes(coverage));
});
