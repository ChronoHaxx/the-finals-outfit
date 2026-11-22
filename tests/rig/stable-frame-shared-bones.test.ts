import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StableFrameState } from "../../src/rig/StableFrameState";

// 21 Nov 2026 (multi-character Phase 1.4): every cosmetic's skeleton is bound to the body's bones, so the still view now
// records each bone once per capture instead of once per skinned mesh, and refreshes only bones outside the scene.
// A bone turn must still register however many meshes share the bone, and whether the bone is inside the scene or not.

const renderer = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap }, getClearColor: (c: THREE.Color) => c.set(0),
  getClearAlpha: () => 0 } as unknown as THREE.WebGLRenderer;

function skinned(bones: THREE.Bone[]) {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1), count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton(bones)); // its own skeleton over the shared bones, as a rebound cosmetic has
  return mesh;
}

test("bones shared by a body and its cosmetics: a turn of any shared bone still registers, and settles", () => {
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const root = new THREE.Bone(), arm = new THREE.Bone(), hand = new THREE.Bone();
  root.add(arm); arm.add(hand); arm.position.y = 0.5; hand.position.y = 0.4;
  const body = skinned([root, arm, hand]);
  body.add(root);
  scene.add(body, skinned([root, arm]), skinned([arm, hand]), skinned([hand]));
  const state = new StableFrameState();
  const capture = () => state.capture(scene, camera, renderer, camera);
  capture();
  assert.equal(capture().changed, "", "settled");
  for (const bone of [root, arm, hand]) {
    bone.rotation.z += 0.3;
    const result = capture();
    assert.deepEqual([result.changed !== "", result.reprojectable], [true, true], `turn of ${bone === root ? "root" : bone === arm ? "arm" : "hand"}`);
    assert.equal(capture().changed, "", "settles after the turn");
  }
  // Removing the mesh that first recorded the shared bones is a structure change, never silently skipped.
  scene.remove(scene.children[1]);
  assert.equal(capture().reprojectable, false, "mesh removed");
});

test("a bone outside the scene is still refreshed and recorded: moving its unrendered parent registers", () => {
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const rig = new THREE.Group(), bone = new THREE.Bone(); // the skeleton's root is never added to the scene
  rig.add(bone);
  const mesh = skinned([bone]);
  scene.add(mesh);
  const state = new StableFrameState();
  const capture = () => state.capture(scene, camera, renderer, camera);
  capture();
  assert.equal(capture().changed, "", "settled");
  rig.position.x = 0.5; // no updateMatrixWorld: the capture must refresh the bone itself
  const result = capture();
  assert.deepEqual([result.changed, result.reprojectable], ["geometry", true], "unrendered parent moved");
  assert.equal(bone.matrixWorld.elements[12], 0.5, "the bone's world matrix was refreshed");
  assert.equal(capture().changed, "", "settles");
});
