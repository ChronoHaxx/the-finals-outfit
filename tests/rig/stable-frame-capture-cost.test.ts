import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StableFrameState } from "../../src/rig/StableFrameState";
import { StableCamera } from "../../src/rig/StableCamera";

// 21 Nov 2026 (integrated-GPU report, _docs/igpu-perf-2026-11-21). The stable-frame capture runs every frame. The
// default head is seven skinned sections on one 323-bone skeleton; recording that skeleton once per section, and
// recomputing every bone's parent chain, made the capture the largest cost of a moving frame, and the still path ran
// it twice. These tests pin what the cheaper capture must still see.

const renderer = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap }, getClearColor: (c: THREE.Color) => c.set(0),
  getClearAlpha: () => 0 } as unknown as THREE.WebGLRenderer;

const record = (s: StableFrameState) => (s as unknown as { values: unknown[] }).values;
function sameRecord(a: StableFrameState, b: StableFrameState, message: string) {
  const x = record(a), y = record(b);
  assert.equal(y.length, x.length, `${message}: length`);
  const at = x.findIndex((v, i) => !Object.is(v, y[i]));
  assert.equal(at, -1, `${message}: first difference at ${at}`);
}

function skinnedGeometry() {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1), count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
  return geometry;
}

/** A head: `sections` skinned meshes bound to one shared skeleton of a three-bone chain. */
function head(sections = 3) {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene(), rig = new THREE.Group();
  const root = new THREE.Bone(), neck = new THREE.Bone(), jaw = new THREE.Bone();
  root.add(neck); neck.add(jaw); rig.add(root); scene.add(rig);
  const skeleton = new THREE.Skeleton([root, neck, jaw]);
  const meshes = Array.from({ length: sections }, () => {
    const mesh = new THREE.SkinnedMesh(skinnedGeometry(), new THREE.MeshBasicMaterial());
    rig.add(mesh); mesh.bind(skeleton);
    return mesh;
  });
  const state = new StableFrameState();
  const capture = () => state.capture(scene, camera, renderer, camera);
  capture();
  assert.equal(capture().changed, "", "settled");
  return { camera, scene, rig, root, neck, jaw, skeleton, meshes, state, capture };
}

test("a shared skeleton is recorded once, and its bones still count for every section", () => {
  const one = head(1), seven = head(7);
  // Each extra section adds its own record (object, material, geometry, bind matrices), not the skeleton's bones again:
  // the same for a long skeleton as for a short one.
  const perSection = (f: ReturnType<typeof head>, g: ReturnType<typeof head>) => (record(g.state).length - record(f.state).length) / 6;
  const extraBones = (b: ReturnType<typeof head>) => {
    let tip = b.jaw;
    const bones = [...b.skeleton.bones];
    for (let i = 0; i < 40; i++) { const next = new THREE.Bone(); tip.add(next); tip = next; bones.push(next); }
    for (const mesh of b.meshes) mesh.bind(new THREE.Skeleton(bones), mesh.bindMatrix);
    // All sections on one skeleton again (bind made one each above).
    const shared = b.meshes[0].skeleton;
    for (const mesh of b.meshes) mesh.bind(shared, mesh.bindMatrix);
    b.capture(); return b;
  };
  const short = perSection(one, seven);
  const long = perSection(extraBones(head(1)), extraBones(head(7)));
  assert.equal(long, short, `a section adds ${short} values whatever the skeleton's length`);
  // A bone turn is seen, and stays a reprojectable (transform) change.
  seven.jaw.rotation.x += 0.2;
  const turn = seven.capture();
  assert.deepEqual([turn.changed !== "", turn.reprojectable, seven.capture().changed], [true, true, ""], "jaw turn, then settled");
  // A changed bind pose (bone inverse) is seen and is not a transform.
  seven.skeleton.boneInverses[2].elements[12] += 0.01;
  const inverse = seven.capture();
  assert.deepEqual([inverse.changed, inverse.reprojectable], ["geometry", false], "bone inverse edit");
});

test("a section moved to another skeleton, or the skeleton's first section removed, is seen", () => {
  const f = head(3);
  const other = new THREE.Skeleton([...f.skeleton.bones], f.skeleton.boneInverses.map(m => m.clone()));
  f.meshes[1].bind(other, f.meshes[1].bindMatrix);
  assert.notEqual(f.capture().changed, "", "rebound to another skeleton");
  assert.equal(f.capture().changed, "", "settled");
  // The section that recorded the shared skeleton goes: the next one records it, and bone turns are still seen.
  f.rig.remove(f.meshes[0]);
  assert.notEqual(f.capture().changed, "", "first section removed");
  assert.equal(f.capture().changed, "", "settled");
  f.skeleton.boneInverses[1].elements[13] += 0.01; // read only through the skeleton (the bones are shared with `other`)
  assert.equal(f.capture().changed, "geometry", "the shared skeleton is still recorded");
});

test("in-scene bones are not recomputed per bone; bones outside the scene still are", () => {
  const f = head(2);
  let calls = 0;
  for (const bone of f.skeleton.bones) {
    const original = bone.updateWorldMatrix.bind(bone);
    bone.updateWorldMatrix = (...args: Parameters<THREE.Object3D["updateWorldMatrix"]>) => { calls++; original(...args); };
  }
  f.capture();
  assert.equal(calls, 0, "the forced scene update already made in-scene bones current");

  // A skeleton whose bones live outside the rendered subtree (the reason the per-bone update exists).
  const outside = new THREE.Group(), bone = new THREE.Bone();
  outside.add(bone);
  const mesh = new THREE.SkinnedMesh(skinnedGeometry(), new THREE.MeshBasicMaterial());
  f.scene.add(mesh); mesh.bind(new THREE.Skeleton([bone]));
  f.capture(); f.capture();
  outside.position.x += 0.3; // only the outside root moved: nothing in the scene graph changed
  assert.deepEqual([f.capture().changed, f.capture().changed], ["geometry", ""], "the outside bone's move is seen");
});

test("re-recording the sampling camera equals a full second capture", () => {
  // Both states see the same frames; after each capture the sampling camera is reset to the exact pose (what the
  // accumulator's still path does): A captures everything again, B re-records only the camera.
  const f = head(2);
  const a = new StableFrameState(), b = new StableFrameState();
  const damped = new StableCamera(), exact = new StableCamera();
  const width = 800, height = 600;
  const step = (name: string, move: () => void) => {
    move();
    damped.select(f.camera, width, height);
    const ra = a.capture(f.scene, f.camera, renderer, damped), rb = b.capture(f.scene, f.camera, renderer, damped);
    assert.deepEqual(rb, ra, `${name}: same capture result`);
    exact.clear(); exact.select(f.camera, width, height);
    a.capture(f.scene, f.camera, renderer, exact);
    b.recordSamplingCamera(f.camera, exact);
    sameRecord(a, b, name);
  };
  step("first", () => {});
  step("sub-pixel camera move (damped)", () => { f.camera.position.x += 1e-6; f.camera.updateMatrixWorld(); });
  step("bone turn", () => { f.jaw.rotation.y += 0.1; });
  step("camera move", () => { f.camera.position.z += 0.5; f.camera.updateMatrixWorld(); });
  step("material edit", () => { (f.meshes[0].material as THREE.MeshBasicMaterial).color.setRGB(1, 0, 0); });
  step("still", () => {});
});

test("re-recording the camera keeps the capture's own result and diagnostics", () => {
  const f = head(1);
  const damped = new StableCamera();
  f.jaw.rotation.z += 0.1;
  (f.meshes[0].material as THREE.MeshBasicMaterial).opacity = 0.5;
  damped.select(f.camera, 800, 600);
  const result = f.state.capture(f.scene, f.camera, renderer, damped);
  const first = f.state.firstOther;
  assert.ok(first.startsWith("material"), first);
  f.camera.position.x += 2; f.camera.updateMatrixWorld();
  damped.clear(); damped.select(f.camera, 800, 600);
  f.state.recordSamplingCamera(f.camera, damped);
  assert.equal(f.state.firstOther, first);
  assert.deepEqual([result.changed !== "", result.reprojectable], [true, false]);
  // The next capture compares against the re-recorded camera: the move is already recorded, so nothing changed.
  assert.equal(f.state.capture(f.scene, f.camera, renderer, damped).changed, "");
});
