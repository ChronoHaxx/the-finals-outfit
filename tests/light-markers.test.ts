import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  DEFAULT_LOOK, FULL_LOOKS, KEY_POSITION, MARKER_CENTRE, MARKER_RADIUS, MAX_LIGHTS, describeLook, directionOnDome,
  domeSide, fullLookName, heightRange, isHex, lightAngles, lightTowards, markerPosition, menuS12Look, sanitizeLook,
  studioLook,
} from "../src/lib/stage-lighting";
import { OVERLAY_LAYER, withoutOverlays } from "../src/rig/ViewerOverlay";

// 21 Nov 2026 (community request): more ready-made looks, light markers in the 3D view and dragging them. The default
// Studio look stays the reviewed rig (tests/stage-lighting.test.ts); these check the new looks, the drag geometry and
// that a capture camera can never see the markers.

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("every ready-made look is a valid look that survives storage unchanged and is recognised by name", () => {
  const labels = FULL_LOOKS.map(f => f.label);
  for (const wanted of ["Studio", "Lobby", "Season 12 menu", "Dramatic", "Cool", "Warm", "Fullbright", "Nighttime"])
    assert.ok(labels.includes(wanted), `${wanted} is offered`);
  assert.equal(new Set(labels).size, labels.length, "labels are unique");
  assert.equal(new Set(FULL_LOOKS.map(f => JSON.stringify(sanitizeLook(f.look())))).size, FULL_LOOKS.length,
    "no two looks are the same data (the button's name would be ambiguous)");
  for (const full of FULL_LOOKS) {
    const look = full.look();
    assert.deepEqual(sanitizeLook(JSON.parse(JSON.stringify(look))), look, `${full.label}: nothing is clamped or dropped`);
    assert.equal(fullLookName(look), full.label);
    assert.ok(look.lights.length <= MAX_LIGHTS);
    assert.ok(look.lights.filter(l => l.role === "sun").length <= 1, `${full.label}: one sun at most`);
    for (const l of look.lights) {
      assert.ok(isHex(l.color), `${full.label} ${l.id} colour`);
      const { height } = lightAngles(l.position);
      const [min, max] = heightRange(l);
      assert.ok(height >= min - 1e-9 && height <= max + 1e-9, `${full.label} ${l.id} height ${height} within its slider`);
    }
    assert.ok(describeLook(look).length > 0);
  }
  assert.deepEqual(studioLook(), sanitizeLook(DEFAULT_LOOK), "the default is still Studio");
});

test("the Season 12 menu look: the menu's measured lights in front of the menu stage", () => {
  const look = menuS12Look();
  assert.equal(look.backdrop.scene, "s12-menu");
  const angles = Object.fromEntries(look.lights.map(l => {
    const a = lightAngles(l.position);
    return [l.id, [Math.round(a.bearing), Math.round(a.height), l.color]];
  }));
  assert.deepEqual(angles, {
    sun: [54, 54, "#ffeee3"], // the 5600 K key, upper right
    "blue-side": [-116, 9, "#007bff"], // the strong blue spot, behind on the left
    back: [-155, 8, "#edf3f9"], // the white point light behind on the left
    "under-fill": [0, -21, "#dadaff"], // the weak fill from below in front
  });
  const intensity = Object.fromEntries(look.lights.map(l => [l.id, l.intensity]));
  assert.ok(intensity["blue-side"] > intensity.back && intensity.back > intensity.sun && intensity.sun > intensity["under-fill"],
    "the measured order at the chest: blue, back light, key, under fill");
});

test("Fullbright has no lights and no shadows; a look without lights still stores and describes", () => {
  const look = FULL_LOOKS.find(f => f.label === "Fullbright")!.look();
  assert.deepEqual(look.lights, []);
  assert.equal(look.contactShadow, false);
  assert.equal(sanitizeLook({ ...look }).lights.length, 0, "an empty list is kept, not refilled with Studio's lights");
  assert.match(describeLook(look), /^0 lights/);
});

test("a marker sits on the dome along its light's direction", () => {
  for (const l of FULL_LOOKS.flatMap(f => f.look().lights)) {
    const p = markerPosition(l);
    const offset = [p[0] - MARKER_CENTRE[0], p[1] - MARKER_CENTRE[1], p[2] - MARKER_CENTRE[2]];
    assert.ok(near(Math.hypot(...offset), MARKER_RADIUS), "on the sphere");
    const a = lightAngles(offset), b = lightAngles(l.position);
    assert.ok(near(a.bearing, b.bearing, 1e-6) && near(a.height, b.height, 1e-6), "the light's own direction");
  }
});

test("dragging: the point under the pointer on the half the marker was picked up on; past the rim it slides round", () => {
  const camera: [number, number, number] = [0, 1, 3.6];
  const towards = (p: readonly number[]) => [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]] as [number, number, number];
  // Straight at the centre: the near half is the point facing the camera, the far half the one behind.
  assert.deepEqual(directionOnDome(camera, towards(MARKER_CENTRE), "near").map(v => Math.round(v * 1e9) / 1e9), [0, 0, 1]);
  assert.deepEqual(directionOnDome(camera, towards(MARKER_CENTRE), "far").map(v => Math.round(v * 1e9) / 1e9), [0, 0, -1]);
  // A ray through a marker's own place gives that marker's direction back, front and back.
  for (const [bearing, height] of [[30, 40], [-150, 20], [120, -10]]) {
    const light = lightTowards(studioLook().lights[1], directionFrom(bearing, height));
    const p = markerPosition(light);
    const side = domeSide(light, camera);
    assert.equal(side, Math.abs(bearing) < 90 ? "near" : "far");
    const d = directionOnDome(camera, towards(p), side);
    const a = lightAngles(d);
    assert.ok(near(a.bearing, bearing, 1e-6) && near(a.height, height, 1e-6), `${bearing}/${height}: ${a.bearing}/${a.height}`);
  }
  // A ray that misses the sphere: the outline point nearest it (perpendicular to the view, on the pointer's side).
  const miss = directionOnDome(camera, [1, 0, -3.6], "near");
  assert.ok(near(Math.hypot(...miss), 1));
  assert.ok(miss[0] > 0.9, `slides to the right-hand rim: ${miss}`);
  assert.ok(Math.abs(new THREE.Vector3(...miss).dot(new THREE.Vector3(...towards(MARKER_CENTRE)).normalize())) < 0.3,
    "on the rim, about side-on to the camera");
});

test("a dragged light keeps its distance, stays within its slider's heights, and keeps its bearing straight up", () => {
  const sun = studioLook().lights[0];
  const distance = lightAngles(sun.position).distance;
  const moved = lightTowards(sun, directionFrom(-100, 30));
  assert.ok(near(lightAngles(moved.position).distance, distance));
  assert.ok(near(lightAngles(moved.position).bearing, -100, 1e-6) && near(lightAngles(moved.position).height, 30, 1e-6));
  assert.ok(near(lightAngles(lightTowards(sun, directionFrom(10, -40)).position).height, 10), "the sun stops at 10° up");
  assert.ok(near(lightAngles(lightTowards(sun, [0, 1, 0]).position).height, 85), "and at 85°");
  assert.ok(near(lightAngles(lightTowards(sun, [0, 1, 0]).position).bearing, lightAngles(KEY_POSITION).bearing, 1e-6),
    "straight up keeps the bearing");
  const rim = studioLook().lights[1];
  assert.ok(near(lightAngles(lightTowards(rim, directionFrom(0, -80)).position).height, -45), "other lights stop at -45°");
  const { position, ...rest } = lightTowards(rim, directionFrom(45, 10));
  const { position: _p, ...before } = rim;
  assert.deepEqual(rest, before, "only the position changes");
  assert.ok(position.every(Number.isFinite));
});

test("a capture camera copied from the live one cannot see the markers; the live one can", () => {
  const live = new THREE.PerspectiveCamera();
  live.layers.enable(OVERLAY_LAYER);
  const marker = new THREE.Object3D();
  marker.layers.set(OVERLAY_LAYER);
  const character = new THREE.Object3D();
  assert.equal(live.layers.test(marker.layers), true);
  const capture = withoutOverlays(live.clone());
  assert.equal(capture.layers.test(marker.layers), false, "not in a screenshot");
  assert.equal(capture.layers.test(character.layers), true, "the character still is");
  assert.equal(live.layers.test(marker.layers), true, "the live view is untouched");
  assert.equal(new THREE.PerspectiveCamera().layers.test(marker.layers), false, "a new camera (the share card's) never sees them");
});

function directionFrom(bearing: number, height: number): [number, number, number] {
  const b = THREE.MathUtils.degToRad(bearing), h = THREE.MathUtils.degToRad(height);
  return [Math.cos(h) * Math.sin(b), Math.sin(h), Math.cos(h) * Math.cos(b)];
}

