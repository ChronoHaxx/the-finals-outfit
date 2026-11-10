import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StableFrameState } from "../../src/rig/StableFrameState";

// 6 Nov 2026 (hair motion vectors): the accumulator's High quality reprojects the history through a change only when
// every input that changed was a transform: the sampling camera's matrices, an object's world matrix or a bone's
// (including a skinned mesh's bind matrices, which three's attached bind mode recomputes from its world matrix). Any
// other change cannot be followed by motion vectors and must still restart from a fresh frame.

const renderer = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap }, getClearColor: (c: THREE.Color) => c.set(0),
  getClearAlpha: () => 0 } as unknown as THREE.WebGLRenderer;

function fixture() {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene(), parent = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ alphaHash: true });
  material.userData.reconstructed = true;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1), count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
  const bone = new THREE.Bone(), skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  skinned.add(bone); skinned.bind(new THREE.Skeleton([bone]));
  parent.add(card, skinned); scene.add(parent);
  const state = new StableFrameState();
  state.capture(scene, camera, renderer);
  assert.equal(state.capture(scene, camera, renderer).changed, "", "settled");
  return { camera, scene, parent, card, bone, material, state, capture: () => state.capture(scene, camera, renderer) };
}

test("camera, object, bone and parent turns are reprojectable changes", () => {
  // The accumulator passes its retained sampling camera; here the camera itself samples.
  const f2 = fixture();
  f2.camera.position.x += 0.1;
  let result = f2.state.capture(f2.scene, f2.camera, renderer, f2.camera);
  assert.equal(result.reprojectable, true, "camera move");
  f2.state.capture(f2.scene, f2.camera, renderer, f2.camera);
  f2.card.position.y += 0.2; result = f2.state.capture(f2.scene, f2.camera, renderer, f2.camera);
  assert.deepEqual([result.changed, result.reprojectable], ["scene", true], "object move");
  f2.bone.rotation.z += 0.3; result = f2.state.capture(f2.scene, f2.camera, renderer, f2.camera);
  assert.deepEqual([result.changed, result.reprojectable], ["geometry", true], "bone turn");
  // Turning the parent moves the skinned mesh's world matrix, and with it bindMatrixInverse (attached bind mode).
  f2.parent.rotation.y += 0.4; result = f2.state.capture(f2.scene, f2.camera, renderer, f2.camera);
  assert.deepEqual([result.changed, result.reprojectable], ["scene", true], "parent turn");
});

test("material, visibility and structure changes are not reprojectable, even alongside a transform", () => {
  const f = fixture();
  const capture = () => f.state.capture(f.scene, f.camera, renderer, f.camera);
  capture();
  f.material.color.setRGB(0.2, 0.9, 0.4);
  assert.deepEqual([capture().reprojectable, f.state.firstOther.startsWith("material")], [false, true], "material colour");
  f.material.opacity = 0.5; f.card.position.x += 0.1;
  assert.equal(capture().reprojectable, false, "coverage change with an object move");
  f.card.visible = false;
  assert.equal(capture().reprojectable, false, "visibility");
  f.card.visible = true; capture();
  f.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
  assert.equal(capture().reprojectable, false, "a new object");
  assert.deepEqual(capture(), { changed: "", masked: true, additive: false, reprojectable: false }, "no change is not a reprojection");
});
