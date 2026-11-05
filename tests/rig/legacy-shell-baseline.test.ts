import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

// A face that keeps its legacy preview while that preview bakes its two translucent eye layers opaque (face 11,
// w104-legacy-shell-baseline, 2 Nov 2026: the cel eye shell is the composited eyeball and the eye edge solid grey,
// while every legacy-equivalent preview hides both at alpha 0). The pair's eye shell and eye edge bindings carry
// `invisibleShell` beside their kept legacy names: the rig stages the shared invisible-shell baseline for exactly
// those two fallbacks, keeps the legacy clone for every other section, still loads the legacy GLB, and refuses an
// invisible shell on any other slot or beside a recovered url. The legacy-free path is pinned by
// legacy-free-head.test.ts and is unchanged.

const ORIGIN = "http://legacy-shell-baseline.test/";
const FACE_ID = "head-face-11-base";
const LEGACY_URL = `${ORIGIN}models/heads/face-11.glb`;
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Face_11_Base.SK_Head_Face_11_Base";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_CelShaded_Head_Face_11_Base_Head.MI_CelShaded_Head_Face_11_Base_Head";
const SHELL_MI = "/Game/Test/Heads/MI_Character_CelShadedEyes_Face_11.MI_Character_CelShadedEyes_Face_11";
const EDGE_MI = "/Game/Test/Shared/M_lacrimal_fluid.M_lacrimal_fluid";
const LASHES_MI = "/Game/Test/Heads/MI_CelShaded_Head_Face_11_Base_Hair.MI_CelShaded_Head_Face_11_Base_Hair";

// The legacy preview's own materials, the opaque eye layers among them: distinctive colours prove the staging
// took the clone (or the baseline) the test names, never a silent third material.
const LEGACY_MATERIALS: Record<string, THREE.Color> = {
  "MI_CelShaded_Head_Face_11_Base_Head": new THREE.Color(0.25, 0.5, 0.75),
  "MI_Character_CelShadedEyes_Face_11": new THREE.Color(1, 0.1, 0.1),
  "M_lacrimal_fluid": new THREE.Color(0.8, 0.8, 0.8),
  "MI_CelShaded_Head_Face_11_Base_Hair": new THREE.Color(0.1, 0.2, 0.3),
};
const SLOTS = ["shader_head_shader", "shader_eyeshell_shader", "shader_eyeEdge_shader", "shader_eyelashes_shader"];

const files = new Map<string, string>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const body = files.get(String(input));
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };
(globalThis as { Image?: unknown }).Image = class {
  onerror?: () => void;
  set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
};
if (!(globalThis as { document?: unknown }).document)
  (globalThis as { document?: unknown }).document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
    createElement: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
  };

function serveMaterial(base: string, name: string): string {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${name}\n  return surface;\n}\n`;
  files.set(`${base}/materials/${name}.glsl`, shader);
  files.set(`${base}/materials/${name}.json`, JSON.stringify({ formatVersion: 1, itemId: name, shader: `${name}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0] }));
  return `${base}/materials/${name}.json`;
}

/** The pair as loadSourceSkinPair hands it to the rig: a legacy-preview face with recovered skin, the two declared
 *  invisible eye shells and one more legacy-backed section that must keep its legacy clone. */
function pair(name: string, change: (p: Record<string, any>) => void = () => {}) {
  const base = `${ORIGIN}${name}`;
  const value: Record<string, any> = {
    head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: `${base}/meshes/head.glb`, boundsOrigin: [0, -0.65, 166.17],
      materials: {
        shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI, legacyName: "MI_CelShaded_Head_Face_11_Base_Head",
          url: serveMaterial(base, "head") },
        shader_eyeshell_shader: { source: SHELL_MI, defaultSource: SHELL_MI,
          legacyName: "MI_Character_CelShadedEyes_Face_11", invisibleShell: true },
        shader_eyeEdge_shader: { source: EDGE_MI, defaultSource: EDGE_MI, legacyName: "M_lacrimal_fluid",
          invisibleShell: true },
        shader_eyelashes_shader: { source: LASHES_MI, defaultSource: LASHES_MI,
          legacyName: "MI_CelShaded_Head_Face_11_Base_Hair" },
      } },
    body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: `${base}/meshes/body.glb`, boundsOrigin: [0, -0.91, 83.8],
      materials: { BaseBody: { source: "/Game/Test/MI_Body.MI_Body", defaultSource: "/Game/Test/MI_Body.MI_Body",
        url: serveMaterial(base, "body") } } },
  };
  change(value);
  return value;
}

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
  return geometry;
}

/** The preserved source head: one skinned section per pair slot, as the converted GLB names them. */
function headGltf(): THREE.Group {
  const geometry = surface(SLOTS.length);
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(
    Array(SLOTS.length * 3).fill([1, 0, 0, 0]).flat(), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(
    Array(SLOTS.length * 3).fill([1, 0, 0, 0]).flat(), 4));
  SLOTS.forEach((_, i) => geometry.addGroup(i * 3, 3, i));
  const sections = SLOTS.map(slot => {
    const material = new THREE.MeshStandardMaterial({ name: `source-${slot}` });
    material.userData.sourceSlot = { MaterialSlotName: slot };
    return material;
  });
  const group = new THREE.Group();
  const root = bone("root", new THREE.Matrix4());
  const head = bone("head", HEAD_REST, root);
  group.add(root);
  group.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(geometry, sections);
  mesh.bind(new THREE.Skeleton([root, head], [root, head].map(b => b.matrixWorld.clone().invert())));
  group.add(mesh);
  return group;
}

/** The legacy preview GLB: one material per legacy name, each with the distinctive colour it is staged by. */
function legacyGltf(): THREE.Group {
  const group = new THREE.Group();
  for (const [name, color] of Object.entries(LEGACY_MATERIALS))
    group.add(new THREE.Mesh(surface(1), new THREE.MeshStandardMaterial({ name, color })));
  return group;
}

function harness(bodyUrl: string) {
  const loads: string[] = [];
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
  const rig = new CharacterRig({ loadAsync: async (url: string) => {
    loads.push(String(url));
    return { scene: String(url) === LEGACY_URL ? legacyGltf() : headGltf() };
  } } as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>;
    bodyRestInverses: Map<string, THREE.Matrix4>; bodyScene: THREE.Object3D; bodyHideUrls: Map<string, string[]>;
  };
  internals.skeleton = new THREE.Skeleton(driverBones);
  body.bind(internals.skeleton);
  internals.bonesByName = new Map(driverBones.map(b => [b.name, b]));
  internals.bodyRestInverses = new Map(driverBones.map(b => [b.name, b.matrixWorld.clone().invert()]));
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  return { rig, root, loads };
}

const faceItem = (value: unknown, url = LEGACY_URL) =>
  ({ id: FACE_ID, slot: "face" as never, url, sourceSkinPair: value as never });

const headMaterials = (root: THREE.Group) => {
  const head = root.getObjectsByProperty("isSkinnedMesh", true)
    .find(o => o.userData.sourceMesh === HEAD_MESH) as THREE.SkinnedMesh;
  const bySlot = new Map((head.material as THREE.MeshStandardMaterial[]).map(material =>
    [(material.userData.sourceSlot as { MaterialSlotName: string }).MaterialSlotName, material]));
  return { head, bySlot };
};

test("a declared face stages the invisible shells beside the legacy clones and still loads the legacy preview", async () => {
  const value = pair("baseline");
  const { rig, root, loads } = harness(value.body.url);
  assert.equal(await rig.equipSourceItems([faceItem(value)]), true);
  assert.ok(loads.includes(LEGACY_URL), "the legacy GLB is still loaded for the face's other legacy sections");
  assert.ok(loads.includes(value.head.url), "the preserved source head is loaded");
  const { head, bySlot } = headMaterials(root);
  assert.equal((head.material as THREE.Material[]).length, SLOTS.length);
  // The recovered head skin keeps the legacy clone under the reconstructed surface.
  const recoveredHead = bySlot.get("shader_head_shader")!;
  assert.equal(recoveredHead.userData.reconstructed, true);
  assert.equal(recoveredHead.userData.previewMaterialFallback, false);
  assert.equal(recoveredHead.userData.sourceMaterial, HEAD_MI);
  // Exactly the two declared eye layers take the invisible-shell baseline.
  for (const [slot, source] of [["shader_eyeshell_shader", SHELL_MI], ["shader_eyeEdge_shader", EDGE_MI]] as const) {
    const material = bySlot.get(slot)!;
    assert.equal(material.userData.previewMaterialFallback, true, slot);
    assert.equal(material.userData.sourceMaterial, source, slot);
    assert.equal(material.opacity, 0, slot);
    assert.equal(material.alphaTest, 0.5, slot);
    assert.equal(material.side, THREE.DoubleSide, slot);
    assert.deepEqual(material.color.toArray(), [Math.fround(0.8), Math.fround(0.8), Math.fround(0.8)], slot);
  }
  // Every other section keeps its legacy clone: the lashes read the legacy GLB material exactly.
  const lashes = bySlot.get("shader_eyelashes_shader")!;
  assert.equal(lashes.userData.previewMaterialFallback, true);
  assert.equal(lashes.name, "MI_CelShaded_Head_Face_11_Base_Hair");
  assert.deepEqual(lashes.color.toArray(), LEGACY_MATERIALS["MI_CelShaded_Head_Face_11_Base_Hair"].toArray());
  assert.equal(lashes.opacity, 1, "the legacy clone is not the invisible baseline");
  // The face keeps its legacy body-mask convention.
  assert.deepEqual((rig as unknown as { bodyHideUrls: Map<string, string[]> }).bodyHideUrls.get("face"),
    [`${ORIGIN}models/heads/face-11.bodymask.png`]);
  assert.equal(rig.equippedItemId("face" as never), FACE_ID);
});

test("a legacy-preview face refuses an invisible shell outside the two eye layers or beside a recovered url", async () => {
  const cases: [string, (p: Record<string, any>) => void][] = [
    ["other-slot", p => { p.head.materials.shader_eyelashes_shader.invisibleShell = true; }],
    ["recovered-shell", p => { p.head.materials.shader_eyeshell_shader.url = serveMaterial(`${ORIGIN}recovered`, "shell"); }],
    ["missing-clone", p => { p.head.materials.shader_eyelashes_shader.legacyName = "MI_Not_In_The_Preview"; }],
  ];
  for (const [name, change] of cases) {
    const value = pair(`refuse-${name}`, change);
    await assert.rejects(harness(value.body.url).rig.equipSourceItems([faceItem(value)]),
      /Missing exact head preview material/, name);
  }
});

test("an undeclared legacy-preview face keeps staging its legacy clones exactly as before", async () => {
  const value = pair("undeclared", p => {
    for (const slot of ["shader_eyeshell_shader", "shader_eyeEdge_shader"]) delete p.head.materials[slot].invisibleShell;
  });
  const { rig, root, loads } = harness(value.body.url);
  assert.equal(await rig.equipSourceItems([faceItem(value)]), true);
  assert.ok(loads.includes(LEGACY_URL));
  const { bySlot } = headMaterials(root);
  for (const [slot, legacyName] of [["shader_eyeshell_shader", "MI_Character_CelShadedEyes_Face_11"],
    ["shader_eyeEdge_shader", "M_lacrimal_fluid"]] as const) {
    const material = bySlot.get(slot)!;
    assert.equal(material.userData.previewMaterialFallback, true, slot);
    assert.equal(material.name, legacyName, `${slot} lost its legacy clone`);
    assert.equal(material.opacity, 1, `${slot} staged an invisible shell without the declaration`);
    assert.deepEqual(material.color.toArray(), LEGACY_MATERIALS[legacyName].toArray(), slot);
  }
});
