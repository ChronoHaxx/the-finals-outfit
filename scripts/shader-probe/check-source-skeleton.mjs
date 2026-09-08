// Accessory branches must preserve their source bind, follow the posed driver,
// and remain detached until the complete assembly is committed.
import assert from "node:assert/strict";
import * as THREE from "three";
import { rebindSourceSkeleton } from "../../src/rig/SourceSkeleton.ts";

function bone(name, parent, position, rotation = [0, 0, 0]) {
  const result = new THREE.Bone();
  result.name = name;
  result.position.fromArray(position);
  result.rotation.set(...rotation);
  parent.add(result);
  return result;
}
function close(actual, expected) {
  const error = Math.max(...actual.elements.map((value, index) => Math.abs(value - expected.elements[index])));
  assert(error < 1e-10, `Matrix error ${error}`);
}
const sourceRoot = new THREE.Group(), driverRoot = new THREE.Group();
const sourcePelvis = bone("pelvis", sourceRoot, [.2, 1.1, -.1]);
const bag = bone("bag", sourcePelvis, [.1, -.2, .15], [.2, .1, .3]);
const strap = bone("strap", bag, [.03, .05, -.02], [.1, 0, .2]);
sourceRoot.updateMatrixWorld(true);
const source = new THREE.Skeleton([sourcePelvis, bag, strap]);
const driverPelvis = bone("pelvis", driverRoot, [.2, 1.1, -.1], [Math.PI / 2, 0, 0]);
driverRoot.updateMatrixWorld(true);
const rest = driverPelvis.matrixWorld.clone().invert();
driverPelvis.rotation.z += .4;
driverRoot.updateMatrixWorld(true);
const driver = new Map([["pelvis", driverPelvis]]), inverses = new Map([["pelvis", rest]]);
const recovered = rebindSourceSkeleton(source, driver, inverses);
assert.equal(driverPelvis.children.length, 0, "Staging mutated the active body");
assert.equal(recovered.attachments.length, 1);
assert.notEqual(recovered.skeleton.bones[1], bag);
assert.equal(recovered.skeleton.bones[2].parent, recovered.skeleton.bones[1]);
for (const { parent, root } of recovered.attachments) parent.add(root);
driverRoot.updateMatrixWorld(true);
const deformation = driverPelvis.matrixWorld.clone().multiply(rest);
for (let i = 0; i < recovered.skeleton.bones.length; i++) {
  close(recovered.skeleton.bones[i].matrixWorld.clone().multiply(recovered.skeleton.boneInverses[i]), deformation);
}
driverPelvis.rotation.z -= .4;
driverRoot.updateMatrixWorld(true);
for (let i = 0; i < source.bones.length; i++) {
  close(recovered.skeleton.bones[i].matrixWorld.clone().multiply(recovered.skeleton.boneInverses[i]), new THREE.Matrix4());
  if (i) close(recovered.skeleton.bones[i].matrixWorld, source.bones[i].matrixWorld);
}
for (const { root } of recovered.attachments) root.removeFromParent();
assert.equal(driverPelvis.children.length, 0);
assert.throws(() => rebindSourceSkeleton(source, new Map(), new Map()), /no supported body ancestor/);
assert.equal(driverPelvis.children.length, 0);
source.dispose(); recovered.skeleton.dispose();
console.log("Accessory bone staging, hierarchy, posed-driver attachment, bind restoration and cleanup passed");
