import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";
import { rebindSourceSkeleton } from "../../src/rig/SourceSkeleton.ts";
import type { SourceRigPart } from "../../src/rig/SourceAssembly.ts";

// An earring hangs off a bone the source HEAD owns; a lumbar prop hangs off a body bone an optional
// attachment mesh anchors on. The rig must resolve each inside the component that authored it and
// refuse anything else: no head equipped, a different head, or a same-named bone whose rest belongs
// to another component. Removing or replacing the head must take head-socketed items with it, so no
// attachment is left skinned to a bone that has left the scene.

const ORIGIN = "http://frames.test/";
const EARRING = "/Game/Test/SM_Earring.SM_Earring", BOOMBOX = "/Game/Test/SM_Boombox.SM_Boombox";
const HEAD = "/Game/Test/SK_Head.SK_Head", OTHER_HEAD = "/Game/Test/SK_Head_Other.SK_Head_Other";
const OPTIONAL = "/Game/Test/SK_Lumbar.SK_Lumbar";
const BODY_URL = `${ORIGIN}models/SK_Body_M.glb`;

const files = new Map<string, string>();
for (const id of ["earring", "boombox"]) {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${id}\n  return surface;\n}\n`;
  files.set(`${ORIGIN}materials/${id}.glsl`, shader);
  files.set(`${ORIGIN}materials/${id}.json`, JSON.stringify({ formatVersion: 1, itemId: id, shader: `${id}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0] }));
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const body = files.get(String(input));
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

function staticScene(name: string): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshStandardMaterial({ name });
  material.userData.sourceSlot = { MaterialSlotName: "Slot" };
  return new THREE.Group().add(new THREE.Mesh(geometry, material));
}

/** Place a bone by the world rest it must have, whatever its parents already are. */
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

const HEAD_REST = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0.01),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3)), new THREE.Vector3(1, 1, 1));
const PELVIS_REST = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.95, -0.02),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.05, 0.2)), new THREE.Vector3(1, 1, 1));
const EAR_REST = new THREE.Matrix4().compose(new THREE.Vector3(0.08, 1.7, 0),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -1.2, 0.4)), new THREE.Vector3(1, 1, 1));
const SOCKET_REST = EAR_REST.clone().multiply(new THREE.Matrix4().makeTranslation(0.002, -0.01, 0.003));
const LUMBAR_REST = PELVIS_REST.clone().multiply(new THREE.Matrix4().makeTranslation(0.06, -0.14, -0.1));

/** A body driver, and the source head's own bones rebound onto it exactly as stageSourceSkin does. */
function harness({ bodyEarBone = false }: { bodyEarBone?: boolean } = {}) {
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  const pelvis = bone("pelvis", PELVIS_REST, driverRoot);
  const head = bone("head", HEAD_REST, driverRoot);
  // A body bone that happens to share the head component's bone name, at a different rest.
  const strayEar = bodyEarBone
    ? bone("FACIAL_L_Ear", EAR_REST.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.05, 0)), head)
    : undefined;
  root.updateMatrixWorld(true);
  const driverBones = [driverRoot, pelvis, head, ...(strayEar ? [strayEar] : [])];
  const bonesByName = new Map(driverBones.map(b => [b.name, b]));
  const bodyRestInverses = new Map(driverBones.map(b => [b.name, b.matrixWorld.clone().invert()]));

  // The source head's own skeleton: its shared bones match the body, its ear bone is its own.
  const sourceRoot = bone("root", new THREE.Matrix4());
  const sourceHead = bone("head", HEAD_REST, sourceRoot);
  const sourceEar = bone("FACIAL_L_Ear", EAR_REST, sourceHead);
  sourceRoot.updateMatrixWorld(true);
  const sourceBones = [sourceRoot, sourceHead, sourceEar];
  const rebound = rebindSourceSkeleton(new THREE.Skeleton(sourceBones,
    sourceBones.map(b => b.matrixWorld.clone().invert())), bonesByName, bodyRestInverses);
  for (const { parent, root: branch } of rebound.attachments) parent.add(branch);
  root.updateMatrixWorld(true);
  const headBones = new Map(rebound.skeleton.bones.map((b, i) => [b.name, { bone: b, restInverse: rebound.skeleton.boneInverses[i] }]));

  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  body.userData.sourceBody = true;
  body.userData.sourceBodyUrl = BODY_URL;
  const bodyScene = new THREE.Group().add(body);
  const rig = new CharacterRig({ loadAsync: async (url: string) =>
    ({ scene: staticScene(String(url)) }) } as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>; bodyRestInverses: Map<string, THREE.Matrix4>;
    bodyScene: THREE.Object3D; sourceHead: { id: string; sourceMesh: string; bones: typeof headBones } | null;
    equipped: Map<string, { id: string; scene: THREE.Object3D; meshes: THREE.SkinnedMesh[]; statics: THREE.Mesh[] }>;
  };
  internals.skeleton = new THREE.Skeleton(driverBones);
  internals.bonesByName = bonesByName;
  internals.bodyRestInverses = bodyRestInverses;
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  const equipHead = () => {
    internals.sourceHead = { id: "head-face-01-base", sourceMesh: HEAD, bones: headBones };
    internals.equipped.set("face", { id: "head-face-01-base", scene: new THREE.Group(), meshes: [], statics: [] });
  };
  return { rig, internals, root, pelvis, head, headBones, equipHead };
}

const earringPart = (component: Partial<{ source: string; bone: string; bodyBone: boolean; parentRest: number[] }> = {}): SourceRigPart => ({
  sourceIndex: 0, sourceMesh: EARRING, url: `${ORIGIN}meshes/earring.glb`,
  materials: { Slot: { url: `${ORIGIN}materials/earring.json`, source: "/Game/Test/MI.MI" } },
  attachment: { bodyUrl: BODY_URL, socket: "earring_01_l", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    frame: { kind: "head-component", components: [{ source: HEAD, sourceSha256: "head-sha", bone: "FACIAL_L_Ear",
      bodyBone: false, parentRest: EAR_REST.toArray(), rest: SOCKET_REST.toArray(), restScale: [1, 1, 1], ...component }] } },
});

const boomboxPart = (component: Partial<{ bone: string }> = {}): SourceRigPart => ({
  sourceIndex: 0, sourceMesh: BOOMBOX, url: `${ORIGIN}meshes/boombox.glb`,
  materials: { Slot: { url: `${ORIGIN}materials/boombox.json`, source: "/Game/Test/MI2.MI2" } },
  attachment: { bodyUrl: BODY_URL, socket: "lumbar_attachment_jj", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    frame: { kind: "optional-mesh", component: { source: OPTIONAL, sourceSha256: "lumbar-sha", bone: "pelvis",
      bodyBone: true, parentRest: PELVIS_REST.toArray(), rest: LUMBAR_REST.toArray(), restScale: [1, 1, 1], ...component } } },
});

const equip = (rig: CharacterRig, slot: string, id: string, parts: SourceRigPart[]) =>
  rig.equipSourceItems([{ id, slot: slot as never, url: parts[0].url, sourceParts: parts }]);

function attachedMesh(root: THREE.Object3D): THREE.SkinnedMesh | undefined {
  return root.getObjectsByProperty("isSkinnedMesh", true)
    .find(o => o.userData.sourceStaticAttachment) as THREE.SkinnedMesh | undefined;
}

test("a head socket resolves inside the equipped source head and lands on its own bone", async () => {
  const { rig, root, equipHead, headBones } = harness();
  equipHead();
  assert.equal(rig.sourceHeadComponentKey(), `head-face-01-base|${HEAD}`);
  assert.equal(await equip(rig, "earrings", "earring-01", [earringPart()]), true);
  const mesh = attachedMesh(root);
  assert.ok(mesh, "the earring is attached");
  assert.equal(mesh.userData.sourceStaticAttachment, "earring_01_l");
  assert.deepEqual(mesh.userData.sourceAttachmentComponent, ["head-component", "FACIAL_L_Ear"]);
  assert.equal(mesh.skeleton.bones[0], headBones.get("FACIAL_L_Ear")!.bone, "it follows the head's own ear bone");
  root.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const drawn = mesh.applyBoneTransform(0, new THREE.Vector3(0, 0, 0)).applyMatrix4(mesh.matrixWorld);
  const expected = new THREE.Vector3().setFromMatrixPosition(SOCKET_REST);
  assert.ok(drawn.distanceTo(expected) < 1e-6, `rest placement ${drawn.toArray()} != ${expected.toArray()}`);
});

test("a head-socketed item follows the head, not the body, when the two move apart", async () => {
  const { rig, root, equipHead, headBones, head } = harness();
  equipHead();
  await equip(rig, "earrings", "earring-01", [earringPart()]);
  const mesh = attachedMesh(root)!;
  const ear = headBones.get("FACIAL_L_Ear")!.bone;
  head.rotation.z += 0.4;
  ear.position.y += 0.03; // the head component's own bone, as a jiggle-driven pose would move it
  root.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const drawn = mesh.applyBoneTransform(0, new THREE.Vector3(0, 0, 0)).applyMatrix4(mesh.matrixWorld);
  const expected = new THREE.Vector3().setFromMatrixPosition(ear.matrixWorld.clone()
    .multiply(headBones.get("FACIAL_L_Ear")!.restInverse).multiply(SOCKET_REST));
  assert.ok(drawn.distanceTo(expected) < 1e-6, `posed placement ${drawn.toArray()} != ${expected.toArray()}`);
});

test("without a source head, or with a different one, the head socket fails closed", async () => {
  const missing = harness();
  await assert.rejects(equip(missing.rig, "earrings", "earring-01", [earringPart()]),
    /No active source head component carries socket earring_01_l/);
  assert.equal(attachedMesh(missing.root), undefined);
  assert.equal(missing.rig.equippedItemId("earrings" as never), undefined);

  const other = harness();
  other.equipHead();
  await assert.rejects(equip(other.rig, "earrings", "earring-01", [earringPart({ source: OTHER_HEAD })]),
    /No active source head component carries socket earring_01_l/);
  assert.equal(attachedMesh(other.root), undefined);
});

test("a body bone of the same name cannot stand in for the head component's own bone", async () => {
  const { rig, root, equipHead, internals } = harness({ bodyEarBone: true });
  equipHead();
  // The shared name makes the rebind reuse the body bone, whose rest is a different component's.
  assert.equal(internals.sourceHead!.bones.get("FACIAL_L_Ear")!.bone, internals.bonesByName.get("FACIAL_L_Ear"));
  await assert.rejects(equip(rig, "earrings", "earring-01", [earringPart()]),
    /Source attachment socket bone is not the head component's: FACIAL_L_Ear/);
  assert.equal(attachedMesh(root), undefined);
  // A resolved shared-body flag also requires the active head to use that exact driver bone.
  // Source-rest disagreement is rejected earlier by the resolver (source-attachment-frames tests).
  const original = internals.sourceHead!.bones.get("FACIAL_L_Ear")!;
  internals.sourceHead!.bones.set("FACIAL_L_Ear", { ...original, bone: original.bone.clone(false) });
  await assert.rejects(equip(rig, "earrings", "earring-01", [earringPart({ bodyBone: true })]),
    /Source attachment socket bone is not the head component's: FACIAL_L_Ear/);
});

test("a socket bone the head does not have fails closed", async () => {
  const { rig, root, equipHead } = harness();
  equipHead();
  await assert.rejects(equip(rig, "earrings", "earring-01", [earringPart({ bone: "FACIAL_R_Ear" })]),
    /Source attachment socket bone is missing: FACIAL_R_Ear/);
  assert.equal(attachedMesh(root), undefined);
});

test("an optional attachment mesh socket resolves on the body and needs no head", async () => {
  const { rig, root, pelvis, internals } = harness();
  assert.equal(rig.sourceHeadComponentKey(), undefined);
  // The viewer's driver may use different bind axes from the preserved source skeleton. The
  // resolver has validated the source anchor; the live driver inverse must cancel its own axes.
  pelvis.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3));
  root.updateMatrixWorld(true);
  internals.bodyRestInverses.set("pelvis", pelvis.matrixWorld.clone().invert());
  assert.equal(await equip(rig, "lowerBack", "boombox", [boomboxPart()]), true);
  const mesh = attachedMesh(root)!;
  assert.equal(mesh.skeleton.bones[0], pelvis, "it rides the preserved body's own pelvis");
  assert.deepEqual(mesh.userData.sourceAttachmentComponent, ["optional-mesh", "pelvis"]);
  root.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const drawn = mesh.applyBoneTransform(0, new THREE.Vector3(0, 0, 0)).applyMatrix4(mesh.matrixWorld);
  assert.ok(drawn.distanceTo(new THREE.Vector3().setFromMatrixPosition(LUMBAR_REST)) < 1e-6, "rest placement");
});

test("an optional-mesh frame without a resolved body anchor fails closed", async () => {
  const { rig, root } = harness();
  const part = boomboxPart();
  part.attachment!.frame = { kind: "optional-mesh", component: { source: OPTIONAL, sourceSha256: "lumbar-sha",
    bone: "pelvis", bodyBone: false, parentRest: PELVIS_REST.toArray(),
    rest: LUMBAR_REST.toArray(), restScale: [1, 1, 1] } };
  await assert.rejects(equip(rig, "lowerBack", "boombox", [part]),
    /Source attachment socket bone is missing: pelvis/);
  assert.equal(attachedMesh(root), undefined);
});

test("removing or replacing the head takes head-socketed items with it and leaves no attachment behind", async () => {
  const { rig, root, equipHead } = harness();
  equipHead();
  await equip(rig, "earrings", "earring-01", [earringPart()]);
  await equip(rig, "lowerBack", "boombox", [boomboxPart()]);
  assert.equal(rig.equippedItemId("earrings" as never), "earring-01");
  rig.unequip("face" as never);
  assert.equal(rig.sourceHeadComponentKey(), undefined);
  assert.equal(rig.equippedItemId("earrings" as never), undefined, "the earring left with its head");
  assert.equal(rig.equippedItemId("lowerBack" as never), "boombox", "a body-anchored prop stays");
  const remaining = root.getObjectsByProperty("isSkinnedMesh", true)
    .filter(o => o.userData.sourceStaticAttachment === "earring_01_l");
  assert.deepEqual(remaining, [], "no earring mesh is left skinned to a departed head bone");
});

test("an earring can be equipped again after the head is replaced", async () => {
  const { rig, root, equipHead } = harness();
  equipHead();
  await equip(rig, "earrings", "earring-01", [earringPart()]);
  rig.unequip("face" as never);
  equipHead();
  assert.equal(await equip(rig, "earrings", "earring-01", [earringPart()]), true);
  assert.equal(rig.equippedItemId("earrings" as never), "earring-01");
  assert.equal(root.getObjectsByProperty("isSkinnedMesh", true)
    .filter(o => o.userData.sourceStaticAttachment === "earring_01_l").length, 1, "exactly one earring mesh");
});

test("a cancelled head-socketed load attaches nothing", async () => {
  const { rig, root, equipHead } = harness();
  equipHead();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await rig.equipSourceItems([{ id: "earring-01", slot: "earrings" as never,
    url: `${ORIGIN}meshes/earring.glb`, sourceParts: [earringPart()] }], [], controller.signal), false);
  assert.equal(attachedMesh(root), undefined);
  assert.equal(rig.equippedItemId("earrings" as never), undefined);
});
