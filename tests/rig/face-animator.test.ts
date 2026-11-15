import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { bindHead, convertRotation, convertTranslation, headKey, maskWeights, poseHead, poseWeights, recordRest,
  sampleCurve, type FaceCurves } from "../../src/rig/FaceAnimator.ts";
import { FaceCage, type FaceWrapSkin } from "../../src/rig/FaceWrap.ts";
import { applyHeadWrap, bindHeadWrap } from "../../src/rig/HeadWrap.ts";

// Facial animation (12 Nov 2026): the maths of FaceAnimator.ts / FaceWrap.ts against hand-computed results.

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const sameQuat = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-6) => Math.abs(Math.abs(a.dot(b)) - 1) <= eps;
const ueQuat = (axis: [number, number, number], degrees: number) => // a UE (left-handed, cm) rotation as [x, y, z, w]
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(degrees)).toArray();

/** A head: a body "head" bone (S axes), FACIAL bones under it (S, or P for source extension bones). */
function head(bones: { name: string; parent?: string; source?: boolean; position?: number[]; quaternion?: number[] }[]) {
  const root = new THREE.Bone(); root.name = "head";
  const byName = new Map<string, THREE.Bone>([["head", root]]);
  for (const b of bones) {
    const bone = new THREE.Bone(); bone.name = b.name;
    if (b.position) bone.position.fromArray(b.position);
    if (b.quaternion) bone.quaternion.fromArray(b.quaternion);
    if (b.source) bone.userData.sourceBoneExtension = true;
    byName.get(b.parent ?? "head")!.add(bone);
    byName.set(b.name, bone);
  }
  root.updateMatrixWorld(true);
  const all = [...byName.values()];
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = "Face_01_Base_LOD0";
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(all));
  return { mesh, bones: byName };
}

test("a curve is linear between its keys and held at both ends", () => {
  const curve: [number[], number[]] = [[2, 6, 10], [0, 1, 0.5]];
  assert.equal(sampleCurve(curve, 0), 0);
  assert.equal(sampleCurve(curve, 4), 0.5);
  assert.equal(sampleCurve(curve, 8), 0.75);
  assert.equal(sampleCurve(curve, 99), 0.5);
});

test("crossfading clips blend their curves by weight; over-full weights normalise; the result is clamped", () => {
  const clip = (value: number): FaceCurves => ({ formatVersion: 1, source: "", frames: 2, frameTime: 1,
    curves: { Face_Blink: [[0, 1], [value, value]] } });
  const curves = new Map([["a", clip(1)], ["b", clip(0)], ["c", clip(0.6)]]);
  assert.equal(poseWeights([{ source: "a", time: 0, weight: 0.5 }, { source: "b", time: 0, weight: 0.5 }], curves).get("Face_Blink"), 0.5);
  // A clip without curves holds its share of the face at rest.
  assert.equal(poseWeights([{ source: "a", time: 0, weight: 0.3 }, { source: "none", time: 0, weight: 0.7 }], curves).get("Face_Blink"), 0.3);
  // Total weight 2 (three's PropertyMixer normalises): (1 + 0.6) / 2.
  assert.ok(near(poseWeights([{ source: "a", time: 0, weight: 1 }, { source: "c", time: 0, weight: 1 }], curves).get("Face_Blink")!, 0.8));
  const loud = new Map([["x", { ...clip(1), curves: { Face_Blink: [[0, 1], [1.4, 1.4]] as [number[], number[]] } }]]);
  assert.equal(poseWeights([{ source: "x", time: 0, weight: 1 }], loud).get("Face_Blink"), 1);
});

test("the head key is the source mesh name, or the legacy GLB's section name without its LOD suffix", () => {
  const { mesh } = head([]);
  assert.equal(headKey([mesh]), "SK_Face_01_Base");
  mesh.userData.sourceMesh = "/Game/Discovery/Characters/Heads/Face_01/Base/SK_Head_Face_01_Base.SK_Head_Face_01_Base";
  assert.equal(headKey([mesh]), "SK_Head_Face_01_Base");
});

test("poses compose like UE's additive pose asset: in pose order, R = nlerp(I, delta, w) * R, translations add", () => {
  const { mesh, bones } = head([{ name: "FACIAL_C_Jaw", position: [0, -0.05, 0.02] }]);
  const ref = { FACIAL_C_Jaw: ["head", 0, 5, 2, 0, 0, 0, 1] as [string, number, number, number, number, number, number, number] };
  const d1 = ueQuat([0, 0, 1], 30), d2 = ueQuat([1, 0, 0], 20);
  const poses = { formatVersion: 1 as const, name: "PA", poses: ["Face_A", "Face_B"], bones: ["FACIAL_C_Jaw"],
    deltas: [[[0, ...d1, 1, 0, 0]], [[0, ...d2, 0, 2, 0]]] };
  const bound = bindHead("SK_Test", [mesh], { formatVersion: 1, mesh: "SK_Test", pose: "", ref }, poses);
  poseHead(bound, new Map([["Face_A", 1], ["Face_B", 0.5]]));
  // By hand, in the app's S axes (UE (x, y, z, w) -> (-x, y, -z, w); cm (x, y, z) -> m (x, -y, z)).
  const a = new THREE.Quaternion(-d1[0], d1[1], -d1[2], d1[3]), b = new THREE.Quaternion(-d2[0], d2[1], -d2[2], d2[3]);
  const half = new THREE.Quaternion(b.x * 0.5, b.y * 0.5, b.z * 0.5, b.w * 0.5 + 0.5).normalize();
  const expected = half.multiply(a);
  const jaw = bones.get("FACIAL_C_Jaw")!;
  assert.ok(sameQuat(jaw.quaternion, expected), `${jaw.quaternion.toArray()} vs ${expected.toArray()}`);
  assert.ok(near(jaw.position.x, 0.01) && near(jaw.position.y, -0.05 - 0.01) && near(jaw.position.z, 0.02),
    jaw.position.toArray().join());
  // No pose weighted: every bone back at rest.
  assert.equal(poseHead(bound, new Map()), false);
  assert.ok(sameQuat(jaw.quaternion, new THREE.Quaternion()) && near(jaw.position.y, -0.05));
});

test("a source FACIAL root (P axes) under the body head (S) binds with the measured FacialRoot numbers", () => {
  // Face 01's FacialRoot: the legacy GLB rest (S) and the source rest (S * Rx(+90)), as read from both routes.
  const legacy = new THREE.Quaternion(0.5695, 0.4191, -0.5695, 0.4191).normalize();
  const source = new THREE.Quaternion(0.6991, -0.1063, -0.6991, -0.1063).normalize();
  const ue = [-legacy.x, legacy.y, -legacy.z, legacy.w]; // S is its own inverse
  assert.ok(sameQuat(convertRotation("S", ue[0], ue[1], ue[2], ue[3]), legacy));
  const ref = { FACIAL_C_FacialRoot: ["head", 2, 3, 4, ...ue] as [string, number, number, number, number, number, number, number] };
  const pose = { formatVersion: 1 as const, name: "PA", poses: ["Face_A"], bones: ["FACIAL_C_FacialRoot"],
    deltas: [[[0, ...ueQuat([0, 1, 0], 10), 0, 0, 0]]] };
  const at = convertTranslation("S", 2, 3, 4).toArray();
  const ok = head([{ name: "FACIAL_C_FacialRoot", source: true, position: at, quaternion: source.toArray() }]);
  assert.equal(bindHead("SK_Test", [ok.mesh], { formatVersion: 1, mesh: "", pose: "", ref }, pose).bones.length, 1);
  // Two degrees off its reference: the head is refused (left still), not distorted.
  const off = source.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(2)));
  const bad = head([{ name: "FACIAL_C_FacialRoot", source: true, position: at, quaternion: off.toArray() }]);
  assert.throws(() => bindHead("SK_Test", [bad.mesh], { formatVersion: 1, mesh: "", pose: "", ref }, pose), /rests 2\.\d+ deg/);
  // Hanging from another bone than the reference says: refused.
  const moved = head([{ name: "FACIAL_C_Other" }, { name: "FACIAL_C_FacialRoot", parent: "FACIAL_C_Other", source: true }]);
  assert.throws(() => bindHead("SK_Test", [moved.mesh], { formatVersion: 1, mesh: "", pose: "", ref }, pose), /hangs under/);
});

test("a face mask scales each bone's motion: listed weight, else the nearest listed FACIAL ancestor's; masks take the minimum", () => {
  const { mesh, bones } = head([{ name: "FACIAL_C_Jaw" }, { name: "FACIAL_C_LowerLip", parent: "FACIAL_C_Jaw" },
    { name: "FACIAL_L_Eye" }]);
  const zero = [0, 0, 0, 1];
  const ref = Object.fromEntries([["FACIAL_C_Jaw", "head"], ["FACIAL_C_LowerLip", "FACIAL_C_Jaw"], ["FACIAL_L_Eye", "head"]]
    .map(([name, parent]) => [name, [parent, 0, 0, 0, ...zero]])) as Record<string, [string, number, number, number, number, number, number, number]>;
  const turn = ueQuat([1, 0, 0], 40);
  const pose = { formatVersion: 1 as const, name: "PA", poses: ["Face_A"], bones: ["FACIAL_C_Jaw", "FACIAL_C_LowerLip", "FACIAL_L_Eye"],
    deltas: [[[0, ...turn, 0, 0, 4], [1, ...turn, 0, 0, 0], [2, ...turn, 0, 0, 0]]] };
  const bound = bindHead("SK_Test", [mesh], { formatVersion: 1, mesh: "", pose: "", ref }, pose);
  const faceMask = { formatVersion: 1 as const, name: "M1", source: "m1", bones: { FACIAL_C_Jaw: [0.5, 0.25] as [number, number], FACIAL_L_Eye: [1, 1] as [number, number] } };
  const eyesOnly = { formatVersion: 1 as const, name: "M2", source: "m2", bones: { FACIAL_C_Jaw: [0, 0] as [number, number], FACIAL_L_Eye: [1, 1] as [number, number] } };
  const one = maskWeights(bound, [faceMask])!;
  assert.deepEqual([...one], [0.5, 0.25, 0.5, 0.25, 1, 1]); // the lip inherits the jaw's weights
  assert.deepEqual([...maskWeights(bound, [faceMask, eyesOnly])!], [0, 0, 0, 0, 1, 1]);
  assert.equal(maskWeights(bound, []), null);
  poseHead(bound, new Map([["Face_A", 1]]), undefined, one);
  const d = new THREE.Quaternion(-turn[0], turn[1], -turn[2], turn[3]);
  const halfway = new THREE.Quaternion(d.x * 0.5, d.y * 0.5, d.z * 0.5, d.w * 0.5 + 0.5).normalize();
  assert.ok(sameQuat(bones.get("FACIAL_C_Jaw")!.quaternion, halfway));
  assert.ok(near(bones.get("FACIAL_C_Jaw")!.position.z, 0.25 * 0.04));
  assert.ok(sameQuat(bones.get("FACIAL_L_Eye")!.quaternion, d)); // weight 1: untouched
});

test("the wrap cage follows FACIAL bones relative to the head: skinning by the face, never by the head's own motion", () => {
  const { mesh, bones } = head([{ name: "FACIAL_C_Jaw", position: [0, -0.04, 0.03] }]);
  bones.get("head")!.position.set(0, 1.6, 0);
  mesh.updateMatrixWorld(true);
  mesh.skeleton.calculateInverses();
  mesh.bind(mesh.skeleton);
  const rest = recordRest([mesh]);
  const positions = [0, 1.52, 0.1, 0, 1.7, 0.08, 0.02, 1.55, 0.09];
  const skin: FaceWrapSkin = { formatVersion: 1, cage: "cage", positions, bones: ["FACIAL_C_Jaw", "head"], influences: 2,
    joints: [0, 1, 1, 0, 0, 1], weights: [1, 0, 1, 0, 0.5, 0.5] };
  const cage = new FaceCage(skin, [mesh], rest);
  cage.update();
  assert.ok(Array.from(cage.displace(positions)).every((v, i) => near(v, positions[i], 1e-6)), "identity at rest");
  // Open the jaw 20 degrees: the jaw vertex moves as linear blend skinning moves it (bone now * inverse bind).
  const jaw = bones.get("FACIAL_C_Jaw")!;
  jaw.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(20));
  mesh.updateMatrixWorld(true);
  const skinMatrix = jaw.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[1]);
  const lbs = new THREE.Vector3(0, 1.52, 0.1).applyMatrix4(skinMatrix);
  cage.update();
  const moved = cage.displace(positions);
  assert.ok(near(moved[0], lbs.x, 1e-6) && near(moved[1], lbs.y, 1e-6) && near(moved[2], lbs.z, 1e-6), `${[...moved].slice(0, 3)} vs ${lbs.toArray()}`);
  assert.deepEqual([...moved.slice(3, 6)].map(v => +v.toFixed(6)), [0, 1.7, 0.08]); // on the head: the part's own skinning moves it
  const half = new THREE.Vector3(0.02, 1.55, 0.09).applyMatrix4(skinMatrix).add(new THREE.Vector3(0.02, 1.55, 0.09)).multiplyScalar(0.5);
  assert.ok(near(moved[6], half.x, 1e-6) && near(moved[7], half.y, 1e-6) && near(moved[8], half.z, 1e-6));
  // The head turning (the body's animation) adds nothing: the jaw at rest, the head rotated -> the cage at rest.
  jaw.quaternion.identity();
  bones.get("head")!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  cage.update();
  assert.ok(Array.from(cage.displace(positions)).every((v, i) => near(v, positions[i], 1e-6)));
});

// The head wrap before its allocation-free rewrite (12 Nov 2026), kept verbatim as the reference.
type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const at = (p: ArrayLike<number>, i: number): Vec => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
function frame(cage: ArrayLike<number>, triangles: ArrayLike<number>, t: number): [Vec, Vec, Vec, Vec, Vec, Vec] {
  const a = at(cage, triangles[t * 3]), b = at(cage, triangles[t * 3 + 1]), c = at(cage, triangles[t * 3 + 2]);
  const e1 = unit(sub(b, a)), n = unit(cross(sub(b, a), sub(c, a))), e2 = cross(n, e1);
  return [a, b, c, e1, e2, n];
}
const blend = (w: Vec, a: Vec, b: Vec, c: Vec): Vec =>
  [w[0] * a[0] + w[1] * b[0] + w[2] * c[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1], w[0] * a[2] + w[1] * b[2] + w[2] * c[2]];
function referenceApply(binding: ReturnType<typeof bindHeadWrap>, target: ArrayLike<number>, reference: ArrayLike<number>,
  triangles: ArrayLike<number>, positions: Float32Array, directions: Float32Array[] = [], stride: number[] = []): void {
  const tris = triangles.length / 3;
  const after = Array.from({ length: tris }, (_, t) => frame(target, triangles, t));
  const before = Array.from({ length: tris }, (_, t) => frame(reference, triangles, t));
  const count = binding.triangle.length;
  for (let i = 0; i < count; i++) {
    const t = binding.triangle[i], [a, b, c, e1, e2, n] = after[t];
    const w: Vec = [binding.weights[i * 3], binding.weights[i * 3 + 1], binding.weights[i * 3 + 2]];
    const o = blend(w, a, b, c), k = [binding.offset[i * 3], binding.offset[i * 3 + 1], binding.offset[i * 3 + 2]];
    for (let j = 0; j < 3; j++) positions[i * 3 + j] = o[j] + k[0] * e1[j] + k[1] * e2[j] + k[2] * n[j];
    const [, , , f1, f2, fn] = before[t];
    directions.forEach((v, index) => {
      const s = stride[index] ?? 3, d: Vec = [v[i * s], v[i * s + 1], v[i * s + 2]];
      const local: Vec = [dot(d, f1), dot(d, f2), dot(d, fn)];
      for (let j = 0; j < 3; j++) v[i * s + j] = local[0] * e1[j] + local[1] * e2[j] + local[2] * n[j];
    });
  }
}

test("the allocation-free head wrap is bit-identical to the code it replaced (still renders cannot change)", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cage = Array.from({ length: 40 * 3 }, () => random() * 0.3 - 0.15);
  const triangles = Array.from({ length: 30 * 3 }, () => Math.floor(random() * 40));
  const target = cage.map(v => v + (random() - 0.5) * 0.01);
  const rest = new Float32Array(Array.from({ length: 300 * 3 }, () => random() * 0.3 - 0.15));
  const binding = bindHeadWrap(rest, cage, triangles);
  const normals = new Float32Array(Array.from({ length: 300 * 3 }, () => random() - 0.5));
  const tangents = new Float32Array(Array.from({ length: 300 * 4 }, () => random() - 0.5));
  const mine = [rest.slice(), normals.slice(), tangents.slice()], theirs = [rest.slice(), normals.slice(), tangents.slice()];
  applyHeadWrap(binding, target, cage, triangles, mine[0], [mine[1], mine[2]], [3, 4]);
  referenceApply(binding, target, cage, triangles, theirs[0], [theirs[1], theirs[2]], [3, 4]);
  for (let k = 0; k < 3; k++) assert.deepEqual(mine[k], theirs[k]);
});
