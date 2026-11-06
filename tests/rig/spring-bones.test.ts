import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SpringBones } from "../../src/rig/SpringBones";

// A body bone with a three-bone jiggle chain hanging off it (UE bones run along +X), plus a facial bone that must
// never be swung.
function chain() {
  const root = new THREE.Group(), pelvis = new THREE.Bone();
  pelvis.name = "pelvis";
  root.add(pelvis);
  const bones = ["tail_00_JJRoot", "tail_01_JJ", "tail_02_JJ"].map(name => { const b = new THREE.Bone(); b.name = name; return b; });
  bones[0].position.set(0, 0, -0.1);
  bones[0].quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // points backwards (-Z)
  bones[1].position.set(0.15, 0, 0);
  bones[2].position.set(0.15, 0, 0);
  pelvis.add(bones[0]); bones[0].add(bones[1]); bones[1].add(bones[2]);
  const facial = new THREE.Bone();
  facial.name = "FACIAL_C_Jaw_jj";
  pelvis.add(facial);
  root.updateMatrixWorld(true);
  return { root, pelvis, bones, facial };
}
const tip = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());

test("only jiggle chains are collected, facial bones never", () => {
  const { root } = chain();
  const springs = new SpringBones();
  springs.rebuild(root);
  assert.equal(springs.count, 3);
});

test("a turned parent leaves the chain lagging, then it settles back near its rest direction", () => {
  const { root, pelvis, bones } = chain();
  const springs = new SpringBones();
  springs.rebuild(root);
  for (let i = 0; i < 120; i++) springs.update(1 / 60); // settle under gravity first
  root.updateMatrixWorld(true);
  const settled = tip(bones[2]);
  // Where a rigid chain's tip goes when the pelvis (at the origin) turns 45 degrees about Y.
  const expected = settled.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  pelvis.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4); // a sudden 45 degree turn
  root.updateMatrixWorld(true);
  springs.update(1 / 60);
  root.updateMatrixWorld(true);
  const lagging = tip(bones[2]);
  assert.ok(lagging.distanceTo(settled) < lagging.distanceTo(expected), "one step after the turn the tip trails behind");
  for (let i = 0; i < 240; i++) { springs.update(1 / 60); root.updateMatrixWorld(true); }
  // The chain should end near the turned rest, sagging a little under gravity.
  assert.ok(tip(bones[2]).distanceTo(expected) < 0.03, `settles within 3 cm, got ${tip(bones[2]).distanceTo(expected)}`);
});

test("a chain driven into the body is held outside the capsule it started outside of", () => {
  // Capsule pelvis (origin) -> spine_01 (0.3 m up), radius 0.13 (+0.02 tail radius). A one-bone charm hangs from a
  // holder 18 cm to the side, pointing away (+X) at rest. Turning the holder aims the charm diagonally into the body:
  // a free spring would settle its tail 8 cm from the axis.
  const root = new THREE.Group(), pelvis = new THREE.Bone(), spine = new THREE.Bone(), holder = new THREE.Bone();
  const charm = new THREE.Bone(), tip = new THREE.Bone();
  pelvis.name = "pelvis"; spine.name = "spine_01"; holder.name = "holder"; charm.name = "charm_jj"; tip.name = "charm_end";
  spine.position.set(0, 0.3, 0);
  holder.position.set(0.18, 0.15, 0);
  tip.position.set(0.15, 0, 0);
  root.add(pelvis); pelvis.add(spine, holder); holder.add(charm); charm.add(tip);
  root.updateMatrixWorld(true);
  const springs = new SpringBones();
  springs.rebuild(root);
  holder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(153.4));
  let deepest = Infinity;
  for (let i = 0; i < 180; i++) {
    springs.update(1 / 60);
    root.updateMatrixWorld(true);
    const p = tip.getWorldPosition(new THREE.Vector3());
    deepest = Math.min(deepest, Math.hypot(p.x, p.z));
  }
  assert.ok(deepest >= 0.13, `the tail stays outside the 0.13 m capsule, deepest ${deepest.toFixed(3)} m`);
});

test("reset restores every authored rotation exactly", () => {
  const { root, pelvis, bones } = chain();
  const authored = bones.map(b => b.quaternion.toArray());
  const springs = new SpringBones();
  springs.rebuild(root);
  pelvis.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8);
  for (let i = 0; i < 30; i++) { springs.update(1 / 60); root.updateMatrixWorld(true); }
  assert.notDeepEqual(bones[1].quaternion.toArray(), authored[1]);
  springs.reset();
  assert.deepEqual(bones.map(b => b.quaternion.toArray()), authored);
  assert.equal(springs.count, 0);
});

test("orbiting the viewer swings a chain like turning the character, then it settles back", () => {
  const { root, bones } = chain();
  const springs = new SpringBones();
  springs.rebuild(root);
  for (let i = 0; i < 180; i++) { springs.update(1 / 60); root.updateMatrixWorld(true); } // settle under gravity
  const rest = tip(bones[2]);
  // A quick quarter-second orbit of 45 degrees (the game: the character turns 45 degrees the other way).
  let widest = 0;
  for (let i = 0; i < 15; i++) {
    springs.turn(THREE.MathUtils.degToRad(3));
    springs.update(1 / 60);
    root.updateMatrixWorld(true);
    widest = Math.max(widest, tip(bones[2]).distanceTo(rest));
  }
  assert.ok(widest > 0.05, `the tip swings out, widest ${widest.toFixed(3)} m`);
  for (let i = 0; i < 300; i++) { springs.update(1 / 60); root.updateMatrixWorld(true); }
  assert.ok(tip(bones[2]).distanceTo(rest) < 0.01, `and settles back, ${tip(bones[2]).distanceTo(rest).toFixed(4)} m`);
  // No turn, no swing: a still chain stays put.
  const still = tip(bones[2]);
  springs.turn(0);
  for (let i = 0; i < 30; i++) { springs.update(1 / 60); root.updateMatrixWorld(true); }
  assert.ok(tip(bones[2]).distanceTo(still) < 1e-3);
});
