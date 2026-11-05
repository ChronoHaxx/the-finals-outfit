import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CharacterRig, legacyEquivalentHeadBaseline } from "../../src/rig/CharacterRig.ts";

// A face the catalog has no legacy preview of (Face 28/30/31/32, w91-head-skin, 2 Nov 2026) renders through its source
// skin pair alone. Its pair names the legacy-equivalent baseline: the double-sided base under every recovered layer and
// the invisible eye shells that every legacy preview carries. These tests pin that the rig builds exactly that baseline,
// fetches no legacy file, and refuses any mix of a legacy preview with a legacy-free pair.

const ORIGIN = "http://legacy-free-head.test/";
const FACE_ID = "head-face-28-base";
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Face_28.SK_Head_Face_28";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_Head_Face_28_Base_Head.MI_Head_Face_28_Base_Head";
const SHELL_MI = "/Game/Test/Heads/MI_Head_Face_28_Base_EyeShell.MI_Head_Face_28_Base_EyeShell";
const BODY_MI = "/Game/Test/Heads/MI_Body_Face_28_Base.MI_Body_Face_28_Base";

// The eye shell / eye edge material of every legacy face preview: one definition, identical in all 22 active pairs'
// legacy GLBs (w91-head-skin census).
const LEGACY_SHELL = { name: "MI_Head_Face_03_Base_EyeShell", alphaCutoff: 0.5, alphaMode: "MASK", doubleSided: true,
  pbrMetallicRoughness: { baseColorFactor: [0.800000011920929, 0.800000011920929, 0.800000011920929, 0], metallicFactor: 0,
    roughnessFactor: 0.5 } };

const files = new Map<string, string>();
const requests: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  const body = files.get(url);
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

function serveMaterial(base: string, name: string, extra: Record<string, unknown> = {}): string {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${name}\n  return surface;\n}\n`;
  files.set(`${base}/materials/${name}.glsl`, shader);
  files.set(`${base}/materials/${name}.json`, JSON.stringify({ formatVersion: 1, itemId: name, shader: `${name}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0], ...extra }));
  return `${base}/materials/${name}.json`;
}

/** The pair as loadSourceSkinPair hands it to the rig: absolute URLs, a head with a recovered layer and an eye shell. */
function pair(name: string, change: (p: Record<string, any>) => void = () => {}) {
  const base = `${ORIGIN}${name}`;
  const value: Record<string, any> = {
    head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: `${base}/meshes/head.glb`, boundsOrigin: [0, -0.65, 166.17],
      previewBaseline: "legacy-equivalent-v1",
      materials: {
        shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI, url: serveMaterial(base, "head") },
        shader_eyeshell_shader: { source: SHELL_MI, defaultSource: SHELL_MI, invisibleShell: true },
      } },
    body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: `${base}/meshes/body.glb`, boundsOrigin: [0, -0.91, 83.8],
      materials: { BaseBody: { source: BODY_MI, defaultSource: BODY_MI, url: serveMaterial(base, "body") } } },
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

/** The preserved source head: a recovered head section and an eye shell section, as the converted GLB names them. */
function headGltf(): THREE.Group {
  const geometry = surface(2);
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(Array(6).fill([1, 0, 0, 0]).flat(), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array(6).fill([1, 0, 0, 0]).flat(), 4));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const sections = ["shader_head_shader", "shader_eyeshell_shader"].map(slot => {
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

function harness(bodyUrl: string) {
  const loads: string[] = [];
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  bone("head", HEAD_REST, driverRoot);
  root.updateMatrixWorld(true);
  const driverBones = [driverRoot, ...driverRoot.children as THREE.Bone[]];
  const legacyBody = new THREE.MeshStandardMaterial({ name: "legacy-body" });
  const body = new THREE.SkinnedMesh(surface(1), legacyBody);
  body.userData.sourceBody = true;
  body.userData.sourceBodyUrl = bodyUrl;
  const bodyScene = new THREE.Group().add(body);
  const rig = new CharacterRig({ loadAsync: async (url: string) => {
    loads.push(String(url));
    return { scene: headGltf() };
  } } as never, root);
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
  return { rig, root, loads };
}

const faceItem = (value: unknown, url = "") => ({ id: FACE_ID, slot: "face" as never, url, sourceSkinPair: value as never });

test("the invisible shell is exactly the material GLTFLoader builds from the legacy shell definition", async () => {
  const gltf = { asset: { version: "2.0" }, materials: [LEGACY_SHELL] };
  const legacy = await new Promise<THREE.MeshStandardMaterial>((resolve, reject) => new GLTFLoader().parse(JSON.stringify(gltf), "",
    parsed => parsed.parser.getDependency("material", 0).then(resolve, reject), reject));
  const built = legacyEquivalentHeadBaseline({ source: SHELL_MI, defaultSource: SHELL_MI, invisibleShell: true });
  for (const key of ["opacity", "alphaTest", "transparent", "metalness", "roughness", "side", "depthWrite", "vertexColors"] as const)
    assert.equal(built[key], legacy[key], key);
  assert.deepEqual(built.color.toArray(), legacy.color.toArray());
  assert.deepEqual(built.emissive.toArray(), legacy.emissive.toArray());
  assert.equal(built.map, null);
  assert.equal(built.name, "MI_Head_Face_28_Base_EyeShell");
});

test("a legacy-free head loads no legacy preview and builds the shared baseline", async () => {
  const value = pair("baseline");
  const { rig, root, loads } = harness(value.body.url);
  assert.equal(await rig.equipSourceItems([faceItem(value)]), true);
  assert.deepEqual(loads, [value.head.url], "only the preserved source head is loaded");
  const head = root.getObjectsByProperty("isSkinnedMesh", true).find(o => o.userData.sourceMesh === HEAD_MESH) as THREE.SkinnedMesh;
  const [recovered, shell] = head.material as THREE.MeshStandardMaterial[];
  assert.equal(recovered.userData.reconstructed, true);
  assert.equal(recovered.side, THREE.DoubleSide, "the head takes the legacy previews' double-sided base");
  assert.equal(recovered.userData.previewMaterialFallback, false);
  assert.equal(shell.userData.previewMaterialFallback, true);
  assert.equal(shell.userData.sourceMaterial, SHELL_MI);
  assert.equal(shell.opacity, 0);
  assert.equal(shell.alphaTest, 0.5);
  assert.equal(rig.equippedItemId("face" as never), FACE_ID);
});

test("a legacy preview and a legacy-free pair never mix", async () => {
  const free = pair("mixed-free");
  await assert.rejects(harness(free.body.url).rig.equipSourceItems([faceItem(free, `${ORIGIN}models/face-28.glb`)]),
    /preview baseline does not match/);
  const legacy = pair("mixed-legacy", p => {
    delete p.head.previewBaseline;
    p.head.materials.shader_head_shader.legacyName = "MI_Head_Face_28_Base_Head";
  });
  await assert.rejects(harness(legacy.body.url).rig.equipSourceItems([faceItem(legacy)]), /preview baseline does not match/);
  const spelling = pair("mixed-spelling", p => { p.head.previewBaseline = "legacy-equivalent"; });
  await assert.rejects(harness(spelling.body.url).rig.equipSourceItems([faceItem(spelling)]), /preview baseline does not match/);
});

test("a legacy-free head refuses a legacy name, an unexplained gap or a shell outside the eye layers", async () => {
  const cases: [string, (p: Record<string, any>) => void][] = [
    ["named", p => { p.head.materials.shader_head_shader.legacyName = "MI_Head_Face_28_Base_Head"; }],
    ["gap", p => { delete p.head.materials.shader_eyeshell_shader.invisibleShell; }],
    ["recovered-shell", p => { p.head.materials.shader_head_shader.invisibleShell = true; }],
  ];
  for (const [name, change] of cases) {
    const value = pair(`refuse-${name}`, change);
    await assert.rejects(harness(value.body.url).rig.equipSourceItems([faceItem(value)]),
      /Missing exact head preview material/, name);
  }
});

test("a legacy-free head skin must bring the source neck coverage", async () => {
  const value = pair("no-neck", p => {
    p.head.materials.shader_head_shader.url = serveMaterial(`${ORIGIN}no-neck`, "bare-skin", { skinSurface: true });
  });
  const { rig } = harness(value.body.url);
  await assert.rejects(rig.equipSourceItems([faceItem(value)]), /requires the source neck coverage/);
  assert.equal(rig.equippedItemId("face" as never), undefined);
});

test("a legacy-free face with no neck-fade coverage takes the body-hide delete branch", async () => {
  // The statue-shaped case (w93 hardsurface face pairs): a legacy-free face has no legacy preview to
  // derive a .bodymask.png URL from, and a hardsurface head carries no neck-fade coverage at all. The
  // commit must keep the delete branch (the head-neck-match morph already pulls the body's neck inside
  // the head) instead of registering a mask URL built from the absent legacy preview.
  const value = pair("no-coverage");
  const { rig } = harness(value.body.url);
  const item = { ...faceItem(value) } as Record<string, unknown>;
  delete item.url;
  assert.equal(await rig.equipSourceItems([item as never]), true);
  assert.equal(rig.equippedItemId("face" as never), FACE_ID);
  assert.equal((rig as unknown as { bodyHideUrls: Map<string, string[]> }).bodyHideUrls.has("face"), false,
    "a legacy-free face must not register a legacy bodymask");
});
