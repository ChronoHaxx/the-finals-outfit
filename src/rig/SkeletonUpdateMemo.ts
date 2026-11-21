import * as THREE from "three";

// Skip repeated bone-matrix updates (21 Nov 2026, multi-character design Phase 1.4).
//
// three recomputes a skeleton's bone matrices (each bone's world matrix times its inverse bind matrix) and re-uploads
// its bone texture once per skeleton per renderer.render() call: its per-object update map is keyed on
// info.render.frame, which counts render() calls, not screen frames. The still view renders the scene several times a
// frame (the main pass, the velocity pass, contact shadows), and every cosmetic has its own skeleton bound to the body's
// bones, so the same matrices were multiplied out and uploaded several times per frame (the profile in
// _docs/multi-character-2026-11-11: three's Skeleton.update was the largest single cost of a four-character frame).
//
// The memo skips an update whose inputs are exactly those the previous update of that skeleton used: every bone's world
// matrix and every inverse bind matrix, compared value by value at full (double) precision. boneMatrices and the bone
// texture then already hold the result, so nothing changes on screen. It is checked by content, not counted by frame,
// so any bone change between two draws of one frame (a still-pose draw mid-animation for the share card,
// RigAnimator.withStillPose) recomputes as before. (NaN never compares equal, so it always recomputes; a signed zero
// compares equal to zero, which no matrix product can tell apart on screen.)

interface Memo { world: Float64Array; inverse: Float64Array }
const memos = new WeakMap<THREE.Skeleton, Memo>();
const IDENTITY = new THREE.Matrix4().elements;

/** True when this skeleton's bones and inverse binds are exactly as at its last update; otherwise records them. */
export function skeletonInputsUnchanged(skeleton: THREE.Skeleton): boolean {
  const { bones, boneInverses } = skeleton;
  const size = bones.length * 16;
  let memo = memos.get(skeleton);
  let same = memo !== undefined && memo.world.length === size;
  if (!memo || memo.world.length !== size) {
    memo = { world: new Float64Array(size), inverse: new Float64Array(size) };
    memos.set(skeleton, memo);
  }
  const { world, inverse } = memo;
  for (let i = 0; i < bones.length; i++) {
    const w = bones[i] ? bones[i].matrixWorld.elements : IDENTITY; // as three's update treats a missing bone
    const v = boneInverses[i]?.elements ?? IDENTITY;
    for (let j = 0, k = i * 16; j < 16; j++, k++) {
      // Values before the first difference compared equal, so the memo already holds them; copy from there on.
      if (same && (world[k] !== w[j] || inverse[k] !== v[j])) same = false;
      if (!same) { world[k] = w[j]; inverse[k] = v[j]; }
    }
  }
  return same;
}

let installed = false;

/** Patch Skeleton.prototype.update once for the page: identical inputs skip the recompute and the texture upload. */
export function installSkeletonUpdateMemo(): void {
  if (installed) return;
  installed = true;
  const update = THREE.Skeleton.prototype.update;
  THREE.Skeleton.prototype.update = function memoizedSkeletonUpdate(this: THREE.Skeleton) {
    if (skeletonInputsUnchanged(this)) return;
    update.call(this);
  };
}
