import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

// (w98b cel family, decision #2) The face-11 cel BODY job is an ATTACHMENT-FAMILY worldSurface manifest
// (the f07d11d2 program, byte-identical to the head's; its clip is the outfit's SHOW_INDEX body-hide domain,
// excluded by build-materials' FAMILY_BODY_HIDE route exactly as the M_Skin body route excludes its native
// opacity). The runtime's body-hide masks and decal patching must reach that recovered family body exactly
// as they reach the w95 generic-root body (tests/rig/generic-body-hide.test.ts) and every M_Skin body.

const ORIGIN = "http://family-body-hide.test/";
const FACE_ID = "head-face-11-base";
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Face_11.SK_Head_Face_11";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_CelShaded_Head_Face_11_Base_Head.MI_CelShaded_Head_Face_11_Base_Head";
const SHELL_MI = "/Game/Test/Heads/MI_Character_CelShadedEyes_Face_11.MI_Character_CelShadedEyes_Face_11";
const BODY_MI = "/Game/Test/Heads/MI_CelShaded_Head_Face_11_Base_Body.MI_CelShaded_Head_Face_11_Base_Body";

const files = new Map<string, string>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const body = files.get(url);
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

// A DOM just good enough for the body-hide compose (an Image that loads, a canvas that accepts draws)
// and for three's ImageLoader (an img element whose load listener fires), so texture loads resolve.
const fakeCtx = () => ({ globalCompositeOperation: "", fillStyle: "", drawImage() {}, fillRect() {} });
const fakeImg = () => {
  const listeners: Record<string, (() => void)[]> = {};
  return { naturalWidth: 64, naturalHeight: 64, crossOrigin: "", src: "",
    addEventListener(ev: string, fn: () => void) { (listeners[ev] ??= []).push(fn); if (ev === "load") queueMicrotask(() => fn()); },
    removeEventListener() {} };
};
(globalThis as { Image?: unknown }).Image = class {
  naturalWidth = 64; naturalHeight = 64; crossOrigin = "";
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
};
if (!(globalThis as { document?: unknown }).document)
  (globalThis as { document?: unknown }).document = {
    createElementNS: () => fakeImg(),
    createElement: (tag: string) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => fakeCtx() } : fakeImg()),
  };

function serveMaterial(base: string, name: string, extra: Record<string, unknown> = {}): string {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${name}\n  return surface;\n}\n`;
  files.set(`${base}/materials/${name}.glsl`, shader);
  files.set(`${base}/materials/${name}.json`, JSON.stringify({ formatVersion: 1, itemId: name, shader: `${name}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0], ...extra }));
  return `${base}/materials/${name}.json`;
}

/** The pair as loadSourceSkinPair hands it to the rig; the body's recovered manifest is an attachment-family
 * worldSurface surface (the cel body job's manifest shape, without its textures). */
function pair(name: string) {
  const base = `${ORIGIN}${name}`;
  const bodyFields = {
    worldSurface: true, geometryFrame: "source-world", normalSpace: "tangent", twoSided: true,
    blendMode: "BLEND_Masked", surfaceKind: "attachment-family", attachmentFamily: true,
    requiredGeometryFields: ["position", "normal", "view", "faceSign"],
  };
  return {
    head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: `${base}/meshes/head.glb`, boundsOrigin: [0, -0.65, 166.17],
      previewBaseline: "legacy-equivalent-v1",
      materials: {
        shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI, url: serveMaterial(base, "head") },
        shader_eyeshell_shader: { source: SHELL_MI, defaultSource: SHELL_MI, invisibleShell: true },
      } },
    body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: `${base}/meshes/body.glb`, boundsOrigin: [0, -0.91, 83.8],
      materials: { BaseBody: { source: BODY_MI, defaultSource: BODY_MI, url: serveMaterial(base, "body", bodyFields) } } },
  } as never;
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

function surface(triangles: number, tangents = false): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corners = Array.from({ length: triangles }, (_, t) => [t, 0, 0, t + 0.01, 0, 0, t, 0.01, 0]).flat();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(Array(triangles * 3).fill([0, 0, 1]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(Array(triangles).fill([0, 0, 1, 0, 0, 1]).flat(), 2));
  // The family worldSurface route is geometry-dependent (it needs the source mesh's own tangents).
  if (tangents) geometry.setAttribute("tangent", new THREE.Float32BufferAttribute(Array(triangles * 3).fill([1, 0, 0]).flat(), 3));
  geometry.setIndex([...Array(triangles * 3).keys()]);
  return geometry;
}

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
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  bone("head", HEAD_REST, driverRoot);
  root.updateMatrixWorld(true);
  const driverBones = [driverRoot, ...driverRoot.children as THREE.Bone[]];
  const legacyBody = new THREE.MeshStandardMaterial({ name: "legacy-body" });
  const body = new THREE.SkinnedMesh(surface(1, true), legacyBody);
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

const faceItem = (value: unknown) => ({ id: FACE_ID, slot: "face" as never, url: "", sourceSkinPair: value as never });

interface RigInternals {
  decals: { whenBodyHidesReady(): Promise<void>; set(slot: string, decal: { layers: unknown[] }): Promise<void> };
  bodyHideUrls: Map<string, string[]>;
  refreshBodyHides(): void;
}

test("a family worldSurface recovered body inside a skin pair receives the body-hide masks and decal patching", async () => {
  const value = pair("bodyhide");
  const { rig, root } = harness(value.body.url);
  assert.equal(await rig.equipSourceItems([faceItem(value)]), true);
  const body = (root.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[])
    .find(o => o.userData.sourceBody) as THREE.SkinnedMesh;
  const material = body.material as THREE.MeshStandardMaterial;
  // The staged body is the pair's recovered ATTACHMENT-FAMILY worldSurface material, not the skin route's.
  assert.equal(material.userData.reconstructed, true);
  assert.equal(material.userData.skinSurface ?? false, false);
  assert.equal(material.userData.surfaceKind, "attachment-family");

  // A garment's body-hide mask reaches the recovered family body exactly as it would an M_Skin body.
  const internals = rig as unknown as RigInternals;
  internals.bodyHideUrls.set("upperBody", [`${ORIGIN}models/garment.bodymask.png`]);
  internals.refreshBodyHides();
  await internals.decals.whenBodyHidesReady();
  assert.equal(material.userData.decalPatched, true);

  // A decal layer (a body paint) rides the same patch on the family body.
  await internals.decals.set("bodyPaint", { layers: [{ target: "body", colorUrl: `${ORIGIN}models/paint.png` }] });

  const shader = { uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader as never, undefined as never);
  assert.match(shader.fragmentShader, /uniform sampler2D uBodyHide;/);
  assert.match(shader.fragmentShader, /bodyHide\.r > 0\.5/);
  assert.match(shader.fragmentShader, /discard;/);
  assert.match(shader.fragmentShader, /uDecalC0/);
  // The patch composes with the recovered family surface instead of replacing it.
  assert.match(shader.fragmentShader, /recoveredSurface\(vRecoveredUv0/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb = recovered\.baseColor;/);
  assert.match(shader.fragmentShader, /float metalnessFactor = recovered\.metalness;/);
});
