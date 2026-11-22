import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

// Multi-character design Phase 1.5 (21 Nov 2026): a legacy head static (glasses, a mask, a hat, an earring) is socketed
// on a bone with an offset computed at equip time. That offset used the bone's live world matrix, so it baked in where
// the character stood (its placement) and the pose it was in (mid-emote). Several characters stand turned, and an
// item can be swapped while an emote plays: the same item must end up in the same place on the character, in rig
// space, however the character stands and whatever it is doing when the item goes on.

(globalThis as { window?: unknown }).window ??= { location: { href: "http://head-static-placement.test/" } };
globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
// Engine bones carry arbitrary rest rotations (the reason head statics counter the bone's rotation).
const NECK_REST = at(0, 1.5, 0, 0.1, 0.2, 0.3);
const HEAD_REST = at(0, 1.6, 0.01, 0.4, -1.3, 0.2);
const EARLOBE_REST = at(0.075, 1.62, 0, -0.5, 0.9, 1.1);

const bone = (name: string, world: THREE.Matrix4, parent?: THREE.Object3D) => {
  const created = new THREE.Bone();
  created.name = name;
  parent?.updateWorldMatrix(true, false);
  (parent ? world.clone().premultiply(parent.matrixWorld.clone().invert()) : world)
    .decompose(created.position, created.quaternion, created.scale);
  parent?.add(created);
  created.updateWorldMatrix(true, false);
  return created;
};

/** An origin-authored static as a legacy GLB carries it: a dequantisation wrapper around a placed, turned node. */
function staticGltf(variant: number): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-4, 2, 8, 4, 2, 8, 0, 5 + variant, 10], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.set(1 + variant, 1, -1); mesh.rotation.set(0.1, 0.25 * variant, -0.05);
  const wrapper = new THREE.Group(); wrapper.scale.setScalar(0.01); // centre ~ (0, 0.03, 0.09): near the ground, socketed
  wrapper.add(mesh);
  return new THREE.Group().add(wrapper);
}

function harness(withFace: boolean) {
  const root = new THREE.Group();
  const rootBone = bone("root", new THREE.Matrix4());
  const neck = bone("neck_01", NECK_REST, rootBone);
  const head = bone("head", HEAD_REST, neck);
  root.add(rootBone);
  root.updateMatrixWorld(true);
  const driverBones = [rootBone, neck, head];
  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  const bodyScene = new THREE.Group().add(body);
  let variant = 0;
  const rig = new CharacterRig({ loadAsync: async () => ({ scene: staticGltf(variant++ % 2) }) } as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>; bodyRestInverses: Map<string, THREE.Matrix4>;
    bodyScene: THREE.Object3D; equipped: Map<string, { id: string; scene: THREE.Object3D; meshes: THREE.SkinnedMesh[]; statics: THREE.Mesh[] }>;
  };
  internals.skeleton = new THREE.Skeleton(driverBones);
  body.bind(internals.skeleton);
  internals.bonesByName = new Map(driverBones.map(b => [b.name, b]));
  internals.bodyRestInverses = new Map(driverBones.map(b => [b.name, b.matrixWorld.clone().invert()]));
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  if (withFace) {
    // A legacy head: its own armature copy (static while still), a facial earlobe bone on it, and eyes skinned to the
    // driver's head. While animating, the rig hangs the facial branch from the driver's head (setAnimationPins).
    const faceScene = new THREE.Group();
    root.add(faceScene);
    const ownHead = bone("head", HEAD_REST, faceScene);
    const earlobe = bone("FACIAL_L_Earlobe", EARLOBE_REST, ownHead);
    const eyes = new THREE.BufferGeometry();
    eyes.setAttribute("position", new THREE.Float32BufferAttribute([-0.04, 1.65, 0.08, -0.02, 1.67, 0.09, 0.03, 1.66, 0.085], 3));
    eyes.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(Array(3).fill([0, 0, 0, 0]).flat(), 4));
    eyes.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array(3).fill([1, 0, 0, 0]).flat(), 4));
    const eye = new THREE.SkinnedMesh(eyes, new THREE.MeshStandardMaterial({ name: "MI_Eye" }));
    eye.name = "eye";
    faceScene.add(eye);
    root.updateMatrixWorld(true);
    eye.bind(new THREE.Skeleton([head, earlobe]));
    internals.equipped.set("face", { id: "face", scene: faceScene, meshes: [eye], statics: [] });
  }
  const [neckRest, headRest] = [neck.quaternion.clone(), head.quaternion.clone()];
  const pose = (on: boolean) => {
    neck.quaternion.copy(neckRest);
    head.quaternion.copy(headRest);
    if (on) {
      neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.2, 0.1)));
      head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.6, 0.25)));
    }
    root.updateMatrixWorld(true);
  };
  const place = (turned: boolean) => {
    root.position.set(turned ? 2.5 : 0, 0, turned ? -1.75 : 0);
    root.rotation.set(0, turned ? 2.2 : 0, 0);
    root.updateMatrixWorld(true);
  };
  /** The equipped static's matrix relative to the rig root. */
  const rigMatrix = (slot: string) => {
    root.updateMatrixWorld(true);
    const mesh = internals.equipped.get(slot)!.statics[0];
    assert.ok(mesh, `${slot} was socketed on a bone`);
    return root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  };
  return { rig, root, head, rigMatrix, pose, place };
}

function assertSameMatrix(actual: THREE.Matrix4, expected: THREE.Matrix4, label: string) {
  const worst = Math.max(...actual.elements.map((v, i) => Math.abs(v - expected.elements[i])));
  assert.ok(worst < 1e-9, `${label}: differs by ${worst.toExponential(2)}`);
}

const SLOTS = ["eyewear", "facewear", "headwear", "earrings"] as const;

/** Equip one item under the given conditions, then return the character to the origin and rest and read the result. */
async function equipUnder(slot: string, conditions: { turned?: boolean; posed?: boolean; withFace?: boolean; earlier?: string }) {
  const h = harness(conditions.withFace ?? false);
  if (conditions.earlier) await h.rig.equip({ id: "earlier", slot: conditions.earlier, url: "earlier.glb" } as never);
  h.place(conditions.turned ?? false);
  if (conditions.posed) { h.rig.setAnimationPins(true); h.pose(true); }
  await h.rig.equip({ id: slot, slot, url: `${slot}.glb` } as never);
  if (conditions.posed) { h.pose(false); h.rig.setAnimationPins(false); }
  h.place(false);
  return h.rigMatrix(slot);
}

test("at the origin and at rest, a head static keeps its authored orientation and sits at the bone plus its offset", async () => {
  const h = harness(false);
  await h.rig.equip({ id: "glasses", slot: "eyewear", url: "glasses.glb" } as never);
  const authored = staticGltf(0);
  authored.updateMatrixWorld(true);
  const mesh = authored.children[0].children[0];
  const [p, q] = [new THREE.Vector3(), new THREE.Quaternion()];
  h.rigMatrix("eyewear").decompose(p, q, new THREE.Vector3());
  const [ap, aq] = [new THREE.Vector3(), new THREE.Quaternion()];
  mesh.matrixWorld.decompose(ap, aq, new THREE.Vector3());
  assert.ok(q.angleTo(aq) < 1e-9, "authored orientation kept");
  assert.ok(p.distanceTo(ap.add(new THREE.Vector3().setFromMatrixPosition(HEAD_REST))) < 1e-9, "bone + offset");
});

for (const slot of SLOTS) {
  test(`${slot} on the driver's head: equipped turned, mid-emote, or both, lands where an equip at the origin does`, async () => {
    const reference = await equipUnder(slot, {});
    assertSameMatrix(await equipUnder(slot, { turned: true }), reference, "turned");
    assertSameMatrix(await equipUnder(slot, { posed: true }), reference, "mid-emote");
    assertSameMatrix(await equipUnder(slot, { turned: true, posed: true }), reference, "turned and mid-emote");
  });
}

test("with a head: glasses anchored on the eyes and an earring on the earlobe are placement and pose independent", async () => {
  for (const slot of ["eyewear", "earrings"]) {
    const reference = await equipUnder(slot, { withFace: true });
    assertSameMatrix(await equipUnder(slot, { withFace: true, turned: true }), reference, `${slot} turned`);
    assertSameMatrix(await equipUnder(slot, { withFace: true, posed: true }), reference, `${slot} mid-emote`);
    assertSameMatrix(await equipUnder(slot, { withFace: true, turned: true, posed: true }), reference, `${slot} turned and mid-emote`);
  }
});

test("glasses swapped mid-emote after others were worn at rest still find the eyes (no stale eye bounds)", async () => {
  const reference = await equipUnder("eyewear", { withFace: true, earlier: "eyewear" });
  assertSameMatrix(await equipUnder("eyewear", { withFace: true, earlier: "eyewear", posed: true }), reference, "swapped mid-emote");
});
