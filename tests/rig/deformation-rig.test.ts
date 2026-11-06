import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformationRig } from "../../src/rig/DeformationRig";
import { BODY_GLB, hasBody, loadBodySkeleton } from "./body-skeleton-fixture";

// The ported deformation rig (showcase animation, 5 Nov 2026) on the real body skeleton, read from the GLB (node rest
// pose + inverse bind matrices). Skipped when the extracted body is absent (a fresh worktree); BODY_GLB overrides.
const skip = hasBody() ? false : `no body GLB at ${BODY_GLB}`;
const deg = (a: THREE.Quaternion, b: THREE.Quaternion) => THREE.MathUtils.radToDeg(a.angleTo(b));

test("at the bind pose the rig leaves every joint in place, except the game's absolute left thigh roll", { skip }, async () => {
  const { root } = await loadBodySkeleton();
  const rig = DeformationRig.find(root)!;
  assert.equal(rig.driven.length, 26);
  const rest = new Map(rig.driven.map(b => [b, { p: b.position.clone(), q: b.quaternion.clone() }]));
  rig.apply();
  for (const [bone, pose] of rest) {
    assert.ok(Number.isFinite(bone.quaternion.w) && Number.isFinite(bone.position.x), `${bone.name} finite`);
    assert.ok(pose.p.distanceTo(bone.position) < 1e-5, `${bone.name} stays put`);
    if (bone.name === "thigh_roll_vpj_l") {
      // The game's rule sets this joint's local rotation outright (its right twin multiplies its bind rotation), so at
      // rest it sits at identity, 11 degrees off its bind rotation; reproduced as is.
      assert.ok(deg(bone.quaternion, new THREE.Quaternion()) < 0.01);
      assert.ok(Math.abs(deg(pose.q, bone.quaternion) - 11.13) < 0.05);
    } else assert.ok(deg(pose.q, bone.quaternion) < 0.05, `${bone.name}: ${deg(pose.q, bone.quaternion)} deg`);
  }
});

test("a hand twisted about the forearm spreads 20/50/80/100% down the twist joints, and restore is exact", { skip }, async () => {
  const { root, bone } = await loadBodySkeleton();
  const rig = DeformationRig.find(root)!;
  const still = rig.driven.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
  for (const s of ["l", "r"]) {
    const hand = bone(`hand_${s}`), bind = hand.quaternion.clone();
    const rest = [1, 2, 3, 4].map(i => bone(`lowerarm_vpj_0${i}_${s}`).quaternion.clone());
    hand.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(hand.position.clone().normalize(), Math.PI / 2));
    rig.apply();
    const twist = [1, 2, 3, 4].map((i, k) => deg(rest[k], bone(`lowerarm_vpj_0${i}_${s}`).quaternion));
    [18, 45, 72, 90].forEach((expected, k) => assert.ok(Math.abs(twist[k] - expected) < 0.5, `${s} vpj_0${k + 1}: ${twist[k]}`));
    hand.quaternion.copy(bind);
  }
  rig.restore();
  rig.driven.forEach((b, i) => {
    assert.deepEqual(b.position.toArray(), still[i][0].toArray());
    assert.deepEqual(b.quaternion.toArray(), still[i][1].toArray());
    assert.deepEqual(b.scale.toArray(), still[i][2].toArray());
  });
});

test("a bent elbow pushes its volume joint out by the game's 0.1 cm per degree; the other way it stays", { skip }, async () => {
  const { root, bone } = await loadBodySkeleton();
  const rig = DeformationRig.find(root)!;
  const lower = bone("lowerarm_l"), elbow = bone("elbow_vpj_l"), bind = lower.quaternion.clone(), rest = elbow.position.clone();
  // The rig reads the bend as the forearm's UE yaw (about UE +Z = three -Z), clamped to 0..180 degrees.
  lower.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), Math.PI / 2));
  rig.apply();
  assert.ok(Math.abs(elbow.position.distanceTo(rest) - Math.SQRT2 * 0.09) < 1e-3, `moved ${elbow.position.distanceTo(rest)} m`);
  lower.quaternion.copy(bind).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  rig.apply();
  assert.ok(elbow.position.distanceTo(rest) < 1e-6, "hyperextension is clamped to zero");
});

test("solving the same pose twice gives bit-identical joints (a paused frame stays still)", { skip }, async () => {
  const { root, bone } = await loadBodySkeleton();
  const rig = DeformationRig.find(root)!;
  bone("hand_l").quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 0.9, 0.1).normalize(), 1.1));
  bone("lowerarm_l").quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), 1.2));
  bone("thigh_r").quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9));
  rig.apply();
  const first = rig.driven.map(b => [...b.position.toArray(), ...b.quaternion.toArray()]);
  for (let i = 0; i < 3; i++) rig.apply();
  assert.deepEqual(rig.driven.map(b => [...b.position.toArray(), ...b.quaternion.toArray()]), first);
});
