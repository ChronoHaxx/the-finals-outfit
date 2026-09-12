import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { attachSourceStatic, sourceAttachmentRest } from "../../src/rig/SourceAttachment.ts";
import { resolveSourceRigParts, type AssemblyAssets, type SourceOutfit } from "../../src/rig/SourceAssembly.ts";

// A source static attachment carries the authored UE local transform relative to a body socket:
// FTransform applies scale, then rotation, then translation, converted to the GLB axes (X, Z, Y).
// Positive scales, uniform or not, must apply once at rest, follow the socket rigidly when it moves
// and transform normals by the inverse transpose. Mirrored, singular and nonfinite ones must fail.
// Expected values are composed here from that order and axis mapping. Only the rotation
// convention, already established by the attached source hair, is taken from the implementation.

type Vec3 = [number, number, number];
const MESH = "/Game/Test/SM_Mask.SM_Mask", MI = "/Game/Test/MI_Mask.MI_Mask";
const SOCKET = new THREE.Matrix4().compose(new THREE.Vector3(0.02, 1.61, -0.03),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.8, 0.2)), new THREE.Vector3(1, 1, 1));
const attachment = (scale: Vec3, sourceRestMatrix = SOCKET.toArray()) => ({ bodyUrl: "body.glb", socket: "head",
  sourceRestMatrix, position: [-163.35, -39.89, 4.2] as Vec3, rotation: [-90, 22.41, -7.49] as Vec3, scale });

function expectedRest(a: ReturnType<typeof attachment>): THREE.Matrix4 {
  const rotation = sourceAttachmentRest({ ...a, sourceRestMatrix: new THREE.Matrix4().toArray(), position: [0, 0, 0], scale: [1, 1, 1] });
  const [px, py, pz] = a.position, [sx, sy, sz] = a.scale;
  return new THREE.Matrix4().fromArray(a.sourceRestMatrix).multiply(new THREE.Matrix4().makeTranslation(px / 100, pz / 100, py / 100))
    .multiply(rotation).multiply(new THREE.Matrix4().makeScale(sx, sz, sy));
}

const NORMALS = [[0.3, 0.5, 0.81], [-0.7, 0.1, 0.7], [0, -0.6, 0.8]].map(n => new THREE.Vector3(...n).normalize());
function section(shared?: THREE.BufferGeometry): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  if (shared) for (const name of ["position", "normal", "tangent"]) geometry.setAttribute(name, shared.getAttribute(name));
  else {
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0.05, 0.1, 0.02, -0.04, 0.12, 0.08, 0.01, -0.07, 0.1], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(NORMALS.flatMap(n => n.toArray()), 3));
    geometry.setAttribute("tangent", new THREE.Float32BufferAttribute(NORMALS.flatMap((n, i) =>
      [...new THREE.Vector3(1, 0, 0).cross(n).normalize().toArray(), i === 1 ? -1 : 1]), 4));
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  new THREE.Group().add(mesh);
  return mesh;
}

function driver() {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "head";
  SOCKET.decompose(bone.position, bone.quaternion, bone.scale);
  root.add(bone); root.updateMatrixWorld(true);
  return { root, bone, inverse: bone.matrixWorld.clone().invert() };
}

// What three.js draws for one vertex: CPU skinning of the position, and the skinned normal and
// tangent exactly as its shader chunks form them (camera at the origin, so view = identity).
function drawn(mesh: THREE.SkinnedMesh, index: number) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry, bone = mesh.skeleton.bones[0];
  const position = mesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(g.getAttribute("position"), index))
    .applyMatrix4(mesh.matrixWorld);
  const skin = new THREE.Matrix3().setFromMatrix4(mesh.bindMatrixInverse.clone()
    .multiply(bone.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0])).multiply(mesh.bindMatrix));
  const normal = new THREE.Vector3().fromBufferAttribute(g.getAttribute("normal"), index).applyMatrix3(skin)
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
  const tangent = new THREE.Vector3().fromBufferAttribute(g.getAttribute("tangent") as THREE.BufferAttribute, index)
    .applyMatrix3(skin).transformDirection(mesh.matrixWorld);
  return { position, normal, tangent };
}

function assertClose(actual: THREE.Vector3, expected: THREE.Vector3, tolerance: number, label: string) {
  assert.ok(actual.distanceTo(expected) < tolerance, `${label}: ${actual.toArray()} != ${expected.toArray()}`);
}

function checkVertices(mesh: THREE.SkinnedMesh, source: THREE.Mesh, a: ReturnType<typeof attachment>, bone: THREE.Bone,
  inverse: THREE.Matrix4, label: string) {
  const total = bone.matrixWorld.clone().multiply(inverse).multiply(expectedRest(a));
  const g = source.geometry;
  for (let i = 0; i < 3; i++) {
    const got = drawn(mesh, i);
    assertClose(got.position, new THREE.Vector3().fromBufferAttribute(g.getAttribute("position"), i).applyMatrix4(total), 1e-6, `${label} position ${i}`);
    assertClose(got.normal, new THREE.Vector3().fromBufferAttribute(g.getAttribute("normal"), i)
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(total)), 2e-6, `${label} normal ${i}`);
    assertClose(got.tangent, new THREE.Vector3().fromBufferAttribute(g.getAttribute("tangent") as THREE.BufferAttribute, i)
      .transformDirection(total), 2e-6, `${label} tangent ${i}`);
  }
}

test("positive authored scales apply once at rest and follow a moving socket with exact normals", () => {
  for (const scale of [[1.0540297, 1.0540297, 1.0540297], [0.97, 1.02, 0.97], [0.83286804, 0.83286804, 0.8029805]] as Vec3[]) {
    const { root, bone, inverse } = driver(), source = section(), a = attachment(scale);
    const originalPositions = [...(source.geometry.getAttribute("position").array as Float32Array)];
    const mesh = attachSourceStatic(source, a, bone, inverse);
    assert.deepEqual(mesh.userData.sourceAttachmentScale, [scale[0], scale[2], scale[1]]);
    assert.deepEqual([...(source.geometry.getAttribute("position").array as Float32Array)], originalPositions, "source vertices untouched");
    checkVertices(mesh, source, a, bone, inverse, `rest ${scale}`);
    bone.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, -0.4, 1.1)));
    bone.position.add(new THREE.Vector3(0.1, -0.05, 0.2));
    root.updateMatrixWorld(true);
    checkVertices(mesh, source, a, bone, inverse, `moved ${scale}`);
  }
});

test("sections sharing vertex attributes are each scaled once", () => {
  const { bone, inverse } = driver(), first = section(), second = section(first.geometry), a = attachment([0.9314869, 0.9314869, 0.90159935]);
  const meshes = [attachSourceStatic(first, a, bone, inverse), attachSourceStatic(second, a, bone, inverse)];
  for (const [i, mesh] of meshes.entries()) checkVertices(mesh, first, a, bone, inverse, `section ${i}`);
});

test("unit scale keeps the existing rigid binding and the loaded geometry", () => {
  const { bone, inverse } = driver(), source = section(), a = attachment([1, 1, 1]), geometry = source.geometry;
  const mesh = attachSourceStatic(source, a, bone, inverse);
  assert.equal(mesh.geometry, geometry);
  assert.deepEqual(mesh.matrix.elements, sourceAttachmentRest(a).elements);
  assert.deepEqual(mesh.bindMatrix.elements, sourceAttachmentRest(a).elements);
  assert.equal(mesh.userData.sourceAttachmentScale, undefined);
  checkVertices(mesh, source, a, bone, inverse, "unit");
});

test("mirrored, singular, nonfinite and non-rigid socket transforms are rejected", () => {
  const { bone, inverse } = driver();
  for (const scale of [[-1, 1, 1], [1, 0, 1], [1, 1, Number.NaN]] as Vec3[])
    assert.throws(() => attachSourceStatic(section(), attachment(scale), bone, inverse), /Invalid source attachment frame/);
  const stretched = SOCKET.clone().multiply(new THREE.Matrix4().makeScale(2, 1, 1)).toArray();
  assert.throws(() => attachSourceStatic(section(), attachment([1, 1, 1], stretched), bone, inverse), /Invalid source attachment frame/);
  const projective = new THREE.Matrix4().identity();
  projective.elements[3] = 0.25;
  assert.throws(() => attachSourceStatic(section(), attachment([1, 1, 1], projective.toArray()), bone, inverse), /Invalid source attachment frame/);
});

test("the resolver passes positive authored scales and rejects mirrored or singular ones", () => {
  const assets: AssemblyAssets = { formatVersion: 1, meshes: { [MESH]: { url: "mask.glb", kind: "static", slots: [{ slot: "Mask", material: MI }] } },
    materials: { [MI]: "mask.json" }, attachmentBody: { source: "body", url: "body.glb", restBones: { head: SOCKET.toArray() } } };
  const item = (X: number, Y: number, Z: number): SourceOutfit["items"][string] => ({ source: "DA_Mask", hidden: false, materialParameters: [],
    parts: [{ sourceIndex: 0, staticMesh: MESH, skeletalMesh: "", effect: "", hidden: false, rules: [], unresolved: [], materials: {},
      definition: { StaticMesh: { AssetPathName: MESH }, SkeletalMesh: { AssetPathName: "" }, Effect: { AssetPathName: "" }, TagOverrides: [],
        bIsAttached: true, AttachmentSocket: "head", LocalPosition: { X: -163.35, Y: -39.89, Z: 4.2 },
        LocalRotation: { Pitch: -90, Yaw: 22.41, Roll: -7.49 }, LocalScale: { X, Y, Z } } }] });
  for (const scale of [[1, 1, 1], [0.92576265, 0.92576265, 0.92576265], [0.97, 1.02, 0.97]] as Vec3[]) {
    const [part] = resolveSourceRigParts(item(...scale), assets);
    assert.deepEqual(part.attachment?.scale, scale);
    assert.deepEqual(part.attachment?.position, [-163.35, -39.89, 4.2]);
  }
  for (const scale of [[-1, 1, 1], [1, 0, 1], [1, 1, Number.POSITIVE_INFINITY]] as Vec3[])
    assert.throws(() => resolveSourceRigParts(item(...scale), assets), /Unsupported source attachment transform/);
});
