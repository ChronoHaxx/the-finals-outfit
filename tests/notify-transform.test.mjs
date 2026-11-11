import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { notifyTransform } from "../scripts/anim-export/notify-transform.mjs";

// The emote spawn notify's RelativeTransform in the app's frame (10 Nov 2026). Values are real notifies: the football
// (scale 0.16), the office chair (90 degrees about UE X), the Dragon Boat drum (offset + yaw + scale, no socket).

const mirror = new THREE.Matrix4().makeScale(1, -1, 1);
const ueMatrix = ({ Translation: t = { X: 0, Y: 0, Z: 0 }, Rotation: r = { X: 0, Y: 0, Z: 0, W: 1 }, Scale3D: s = { X: 1, Y: 1, Z: 1 } }) =>
  new THREE.Matrix4().compose(new THREE.Vector3(t.X / 100, t.Y / 100, t.Z / 100), new THREE.Quaternion(r.X, r.Y, r.Z, r.W), new THREE.Vector3(s.X, s.Y, s.Z));
const appMatrix = ({ translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1] } = {}) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...translation), new THREE.Quaternion(...rotation), new THREE.Vector3(...scale));
const close = (a, b, eps = 1e-6) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < eps);

test("identity parts are left out, and an all-identity transform is no transform", () => {
  assert.equal(notifyTransform(undefined), undefined);
  assert.equal(notifyTransform({ Rotation: { X: 0, Y: 0, Z: 0, W: 1 } }), undefined, "Recard's identity rotation");
  assert.equal(notifyTransform({ Rotation: { X: 0, Y: 0, Z: 0, W: 0 } }), undefined, "a zero-length quaternion reads as identity");
  assert.equal(notifyTransform({ Scale3D: { X: 1, Y: 1, Z: 1 }, Translation: { X: 0, Y: 0, Z: 0 } }), undefined);
  assert.deepEqual(notifyTransform({ Scale3D: { X: 0.16, Y: 0.16, Z: 0.16 } }), { scale: [0.16, 0.16, 0.16] }, "the football");
});

test("each part converts with the per-axis mirror: translation (x,-y,z)/100, rotation (-x,y,-z,w), scale as is", () => {
  const chair = notifyTransform({ Rotation: { X: 0.70710677, Y: 0, Z: 0, W: 0.70710677 } });
  assert.deepEqual(chair, { rotation: [-0.7071068, 0, 0, 0.7071068] });
  const drum = notifyTransform({ Translation: { X: 2, Y: 56.4, Z: 0 }, Rotation: { X: 0, Y: 0, Z: 0.744, W: 0.668 }, Scale3D: { X: 0.765, Y: 0.765, Z: 0.765 } });
  assert.deepEqual(drum.translation, [0.02, -0.564, 0]);
  assert.ok(Math.abs(Math.hypot(...drum.rotation) - 1) < 1e-6, "normalized");
  assert.deepEqual(drum.scale, [0.765, 0.765, 0.765]);
});

test("the converted transform is the mirror conjugate M X M of the UE one, non-uniform scale and negative scale included", () => {
  for (const rt of [
    { Translation: { X: 2, Y: 56.4, Z: 0 }, Rotation: { X: 0, Y: 0, Z: 0.7441732, W: 0.6679867 }, Scale3D: { X: 0.765, Y: 0.765, Z: 0.765 } },
    { Translation: { X: -63, Y: 8.5, Z: 0 }, Scale3D: { X: 0.4, Y: 0.4, Z: 0.35 } }, // RainCoat soil: non-uniform
    { Translation: { X: -100, Y: 0, Z: 0 }, Scale3D: { X: -1, Y: -1, Z: -1 } }, // global Rocking Chair gun: a point flip
    { Translation: { X: 4, Y: 21.5, Z: -1 }, Rotation: { X: -0.378, Y: 0.327, Z: -0.566, W: 0.655 }, Scale3D: { X: 0.7, Y: 0.7, Z: 0.7 } },
  ]) {
    const expected = mirror.clone().multiply(ueMatrix(rt)).multiply(mirror);
    // A UE rotation component is unit only up to the export's rounding; normalize as the converter does.
    const r = rt.Rotation ? new THREE.Quaternion(rt.Rotation.X, rt.Rotation.Y, rt.Rotation.Z, rt.Rotation.W).normalize() : null;
    const normalizedExpected = mirror.clone().multiply(ueMatrix({ ...rt, ...(r ? { Rotation: { X: r.x, Y: r.y, Z: r.z, W: r.w } } : {}) })).multiply(mirror);
    assert.ok(close(appMatrix(notifyTransform(rt)), normalizedExpected), JSON.stringify(rt));
    assert.ok(r || close(appMatrix(notifyTransform(rt)), expected));
  }
});
