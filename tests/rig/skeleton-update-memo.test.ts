import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { installSkeletonUpdateMemo } from "../../src/rig/SkeletonUpdateMemo";

// Skeleton update memo (21 Nov 2026, multi-character design Phase 1.4): three's Skeleton.update runs once per render()
// call; the memo skips it when every input is exactly as last time. Nothing may differ from an unmemoised update.

const reference = THREE.Skeleton.prototype.update; // three's own, captured before the patch
installSkeletonUpdateMemo();

function rig() {
  const root = new THREE.Bone(), child = new THREE.Bone();
  root.position.set(0, 1, 0); child.position.set(0, 0.5, 0);
  root.add(child);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([root, child]); // inverse binds from this rest pose
  skeleton.computeBoneTexture();
  return { root, child, skeleton };
}

/** What three's own update writes for the skeleton's current inputs. */
function expected(skeleton: THREE.Skeleton): Float32Array {
  const copy = new THREE.Skeleton(skeleton.bones, skeleton.boneInverses);
  reference.call(copy);
  return copy.boneMatrices!;
}

test("an update with unchanged bones and inverse binds is skipped: same matrices, no texture upload", () => {
  const { skeleton } = rig();
  skeleton.update();
  const version = skeleton.boneTexture!.version;
  const before = skeleton.boneMatrices!.slice();
  skeleton.update();
  skeleton.update();
  assert.equal(skeleton.boneTexture!.version, version);
  assert.deepEqual(skeleton.boneMatrices, before);
});

test("a moved bone recomputes, exactly as three's own update would", () => {
  const { root, child, skeleton } = rig();
  skeleton.update();
  const version = skeleton.boneTexture!.version;
  child.rotation.z = 0.7; root.position.x = 0.25;
  root.updateMatrixWorld(true);
  skeleton.update();
  assert.ok(skeleton.boneTexture!.version > version);
  assert.deepEqual(skeleton.boneMatrices!.subarray(0, 32), expected(skeleton).subarray(0, 32));
});

test("an inverse bind changed in place (calculateInverses) recomputes", () => {
  const { root, skeleton } = rig();
  root.position.y = 2; root.updateMatrixWorld(true);
  skeleton.update();
  const version = skeleton.boneTexture!.version;
  skeleton.calculateInverses(); // the bones are unchanged; only the inverse binds move
  skeleton.update();
  assert.ok(skeleton.boneTexture!.version > version);
  assert.deepEqual(skeleton.boneMatrices!.subarray(0, 32), expected(skeleton).subarray(0, 32));
});

test("a change too small for float32 still recomputes (inputs compare at full precision)", () => {
  const { child, skeleton } = rig();
  skeleton.update();
  const version = skeleton.boneTexture!.version;
  child.matrixWorld.elements[13] += 1e-12; // below float32 resolution at 1.5 m
  skeleton.update();
  assert.ok(skeleton.boneTexture!.version > version);
});

test("bones that alternate between two poses within a frame recompute each time (a still-pose draw mid-animation)", () => {
  const { root, child, skeleton } = rig();
  const posed = () => { child.rotation.z = 0.9; root.updateMatrixWorld(true); };
  const still = () => { child.rotation.z = 0; root.updateMatrixWorld(true); };
  posed(); skeleton.update(); const a = skeleton.boneMatrices!.slice(0, 32);
  still(); skeleton.update(); const b = skeleton.boneMatrices!.slice(0, 32);
  posed(); skeleton.update();
  assert.notDeepEqual(a, b);
  assert.deepEqual(skeleton.boneMatrices!.subarray(0, 32), a);
});
