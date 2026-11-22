import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  BACKDROP_PRESETS, DEFAULT_LOOK, DEFAULT_SUN_ELEVATION, KEY_POSITION, LOBBY_BACKDROP, MAX_LIGHTS, REVIEWED_SHADOW_FRUSTUM,
  STUDIO_BACKDROP, STUDIO_RIG, SUN_HEIGHT_MAX, SUN_HEIGHT_MIN, backdropCss, backdropIsDark, describeLook, fullLookName,
  groupShadowFrustum, lightAngles, lobbyLook, movedLight, newLight, positionFrom, rotated, sanitizeLook, shadowFrustum, snapFollow,
  studioLook,
} from "../src/lib/stage-lighting";

// The viewer's scene settings (11-12 Nov 2026). The default must be the reviewed rig exactly; a chosen sun must keep the
// character and its whole floor shadow inside the shadow map; stored looks are checked field by field.

const KEY_DISTANCE = Math.hypot(...KEY_POSITION);

test("the default look is the reviewed Studio rig, number for number", () => {
  const look = studioLook();
  assert.deepEqual(look.lights.map(l => [l.id, l.color, l.intensity, l.position, l.enabled, l.castShadow]), [
    ["sun", "#ffffff", STUDIO_RIG.key, [2.5, 6, 4], true, true],
    ["rim", "#ffffff", STUDIO_RIG.rim, [-3, 4.5, -4], true, false],
  ], "key and rim, in the order they were mounted (no fill: the rig's fill is 0)");
  assert.deepEqual(look.hemisphere, { sky: "#e8edf4", ground: "#c4c8ce", intensity: STUDIO_RIG.hemi });
  assert.deepEqual(look.environment, { kind: "softbox", intensity: STUDIO_RIG.env, rotation: 0 });
  assert.deepEqual([look.toneMapping, look.exposure, look.contactShadow, look.floorShadow], ["neutral", STUDIO_RIG.exposure, true, false]);
  assert.equal(backdropCss(look.backdrop), "radial-gradient(ellipse 75% 65% at 50% 35%, #f0f3f7 0%, #dee4eb 55%, #c5cdd7 100%)");
  assert.equal(backdropCss(LOBBY_BACKDROP), "radial-gradient(ellipse 70% 60% at 50% 38%, #1b2740 0%, #0a0e17 58%, #05060a 100%)");
  assert.equal(backdropIsDark(STUDIO_BACKDROP), false, "dark chrome on the Studio backdrop, as before");
  assert.equal(backdropIsDark(LOBBY_BACKDROP), true);
  assert.deepEqual(shadowFrustum(DEFAULT_SUN_ELEVATION, KEY_DISTANCE, false), { ...REVIEWED_SHADOW_FRUSTUM });
  assert.deepEqual(sanitizeLook(undefined), look);
  assert.deepEqual(sanitizeLook(JSON.parse(JSON.stringify(DEFAULT_LOOK))), look, "survives storage unchanged");
  assert.equal(fullLookName(look), "Studio");
});

test("the Lobby look is the Lobby as shipped", () => {
  const look = lobbyLook();
  assert.deepEqual(look.lights.map(l => [l.color, l.intensity, l.position, l.castShadow]), [
    ["#fff3e2", 2.4, [3.5, 5, 5], false], ["#3f6dff", 2.8, [-5, 3.5, -4], false],
    ["#2f56ff", 1.3, [5, 2, -4], false], ["#cfe0ff", 0.35, [-3, 2, 3], false],
  ]);
  assert.deepEqual([look.toneMapping, look.exposure, look.environment.kind, look.environment.intensity, look.contactShadow],
    ["aces", 1.05, "room", 0.4, false]);
  assert.equal(fullLookName(look), "Lobby");
});

test("turning the reviewed sun keeps the reviewed shadow camera; moving a light keeps its distance", () => {
  for (const degrees of [-170, -90, 45, 180]) {
    const { height, distance } = lightAngles(rotated(KEY_POSITION, degrees));
    assert.deepEqual(shadowFrustum(height, distance, false), { ...REVIEWED_SHADOW_FRUSTUM }, `turned ${degrees}°`);
  }
  assert.ok(Math.abs(lightAngles(KEY_POSITION).bearing - 32.005) < 0.001, "the reviewed sun stands 32° to the right");
  const moved = movedLight(studioLook().lights[0], { height: 20 });
  assert.ok(Math.abs(lightAngles(moved.position).distance - KEY_DISTANCE) < 1e-9);
  assert.ok(Math.abs(lightAngles(moved.position).height - 20) < 1e-9);
  assert.ok(Math.abs(lightAngles(moved.position).bearing - lightAngles(KEY_POSITION).bearing) < 1e-9, "same bearing");
  for (const [b, h] of [[0, 30], [135, -20], [-90, 85]]) {
    const back = lightAngles(positionFrom(b, h, 5));
    assert.ok(Math.abs(back.bearing - b) < 1e-9 && Math.abs(back.height - h) < 1e-9 && Math.abs(back.distance - 5) < 1e-9);
  }
});

/** Project points through a shadow camera set up as three does for a directional light at `light` aimed at `target`. */
function inShadowMap(light: THREE.Vector3, target: THREE.Vector3, f: ReturnType<typeof shadowFrustum>, points: THREE.Vector3[]) {
  const camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far);
  camera.position.copy(light); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return points.map(p => {
    const ndc = p.clone().project(camera);
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1;
  });
}

test("every chosen sun keeps a 2.5 m caster within 1 m, and the tip of its floor shadow, inside the shadow map", () => {
  for (const distance of [KEY_DISTANCE, Math.hypot(3.5, 5, 5), 7]) {
    for (let elevation = SUN_HEIGHT_MIN; elevation <= SUN_HEIGHT_MAX; elevation += 5) {
      for (const bearing of [-150, -45, 0, 90, 180]) {
        for (const follow of [false, true]) {
          const f = shadowFrustum(elevation, distance, follow);
          const offset = new THREE.Vector3(follow ? 0.125 : 0, 0, follow ? -0.125 : 0); // the body off the snap point
          const light = new THREE.Vector3(...positionFrom(bearing, elevation, distance));
          const toLight = new THREE.Vector3(light.x, 0, light.z).normalize();
          const side = new THREE.Vector3(-toLight.z, 0, toLight.x);
          const e = THREE.MathUtils.degToRad(elevation);
          const points: THREE.Vector3[] = [];
          for (const along of [-1, 0, 1]) for (const height of [0, 1, 2.5]) for (const across of [-1.2, 0, 1.2]) {
            const caster = toLight.clone().multiplyScalar(along).addScaledVector(side, across).setY(height).add(offset);
            points.push(caster, caster.clone().addScaledVector(toLight, -height / Math.tan(e)).setY(0));
          }
          assert.ok(inShadowMap(light, new THREE.Vector3(), f, points).every(Boolean),
            `sun ${bearing}°/${elevation}° at ${distance.toFixed(2)} m${follow ? " following" : ""}`);
          const reviewed = REVIEWED_SHADOW_FRUSTUM.bias * (REVIEWED_SHADOW_FRUSTUM.far - REVIEWED_SHADOW_FRUSTUM.near);
          assert.ok(Math.abs(f.bias * (f.far - f.near) - reviewed) < 1e-12, "bias stays 3.9 mm of depth");
        }
      }
    }
  }
});

test("the reviewed frustum would cut a low sun's shadow short (why it grows)", () => {
  const light = new THREE.Vector3(...positionFrom(32, 10, KEY_DISTANCE));
  const tip = new THREE.Vector3(-light.x, 0, -light.z).normalize().multiplyScalar(2.5 / Math.tan(THREE.MathUtils.degToRad(10)));
  assert.deepEqual(inShadowMap(light, new THREE.Vector3(), { ...REVIEWED_SHADOW_FRUSTUM }, [new THREE.Vector3(0, 2.5, 0), tip]),
    [false, false]);
});

// Squads (22 Nov 2026, multi-character Phase 2): one shadow camera fitted to a group.
test("a group of one gets the one character's frustum, aimed at where it stands", () => {
  for (const [bearing, elevation] of [[32, DEFAULT_SUN_ELEVATION], [-120, 25], [90, 70]]) {
    const sun = positionFrom(bearing, elevation, KEY_DISTANCE);
    for (const spot of [{ x: 0, z: 0 }, { x: -1, z: 0.4 }]) {
      const fit = groupShadowFrustum(sun, [spot]), single = shadowFrustum(elevation, KEY_DISTANCE, false);
      // (The group reads the sun's height back from its position: equal up to the last bit.)
      for (const key of Object.keys(single) as (keyof typeof single)[])
        assert.ok(Math.abs(fit.frustum[key] - single[key]) < 1e-9, `${key} at ${bearing}°/${elevation}°`);
      assert.deepEqual(fit.centre, [spot.x, spot.z]);
    }
  }
  assert.deepEqual(groupShadowFrustum(KEY_POSITION, [{ x: 0, z: 0 }]).frustum, { ...REVIEWED_SHADOW_FRUSTUM }, "the reviewed rig unchanged");
});

test("every contestant of a group, and its floor shadow's tip, is inside the fitted shadow map for any sun", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 60; trial++) {
    const spots = Array.from({ length: 2 + (trial % 3) }, () => ({ x: (random() - 0.5) * 4, z: (random() - 0.5) * 3 }));
    for (const elevation of [SUN_HEIGHT_MIN, 25, 52, 85]) {
      const bearing = random() * 360 - 180, distance = [KEY_DISTANCE, 7, 9][trial % 3];
      const sun = positionFrom(bearing, elevation, distance);
      const { frustum, centre } = groupShadowFrustum(sun, spots);
      const target = new THREE.Vector3(centre[0], 0, centre[1]);
      const light = target.clone().add(new THREE.Vector3(...sun));
      const toLight = new THREE.Vector3(sun[0], 0, sun[2]).normalize();
      const side = new THREE.Vector3(-toLight.z, 0, toLight.x);
      const e = THREE.MathUtils.degToRad(elevation);
      const points: THREE.Vector3[] = [];
      for (const spot of spots) for (const along of [-1, 0, 1]) for (const height of [0, 1, 2.5]) for (const across of [-1.2, 0, 1.2]) {
        const caster = toLight.clone().multiplyScalar(along).addScaledVector(side, across).setY(height).add(new THREE.Vector3(spot.x, 0, spot.z));
        points.push(caster, caster.clone().addScaledVector(toLight, -height / Math.tan(e)).setY(0));
      }
      const inside = inShadowMap(light, target, frustum, points);
      assert.ok(inside.every(Boolean), `trial ${trial}, sun ${bearing.toFixed(0)}°/${elevation}°: ${inside.filter(v => !v).length} points outside`);
      const reviewed = REVIEWED_SHADOW_FRUSTUM.bias * (REVIEWED_SHADOW_FRUSTUM.far - REVIEWED_SHADOW_FRUSTUM.near);
      assert.ok(Math.abs(frustum.bias * (frustum.far - frustum.near) - reviewed) < 1e-12, "bias stays 3.9 mm of depth");
    }
  }
});

test("a group's shadow map is only as wide as the group: two side by side widen it by their spacing", () => {
  const sun = positionFrom(0, 40, KEY_DISTANCE); // sun straight ahead: x runs across the beam
  const single = shadowFrustum(40, KEY_DISTANCE, false); // fitted (not the reviewed height)
  const pair = groupShadowFrustum(sun, [{ x: -0.5, z: 0 }, { x: 0.5, z: 0 }]).frustum;
  assert.ok(Math.abs((pair.right - pair.left) - (single.right - single.left + 1)) < 1e-9, "1 m wider");
  assert.ok(Math.abs(pair.top - single.top) < 1e-9 && Math.abs(pair.bottom - single.bottom) < 1e-9, "no taller");
  // One behind the other along the beam: as wide as one, taller by the depth step seen from the sun.
  const file = groupShadowFrustum(sun, [{ x: 0, z: -0.5 }, { x: 0, z: 0.5 }]).frustum;
  assert.ok(Math.abs((file.right - file.left) - (single.right - single.left)) < 1e-9, "no wider");
  const e = THREE.MathUtils.degToRad(40);
  assert.ok(Math.abs((file.top - file.bottom) - (single.top - single.bottom + Math.sin(e))) < 1e-9, "taller by 1 m · sin e");
});

test("following snaps the body to a 0.25 m grid within ±3 m", () => {
  assert.deepEqual(snapFollow(0.1, -0.13), [0, -0.25]);
  assert.deepEqual(snapFollow(7, -9), [3, -3]);
  assert.deepEqual(snapFollow(NaN, Infinity), [0, 0]);
  assert.ok(!Object.is(snapFollow(-0.01, 0)[0], -0), "no negative zero");
});

test("stored looks are checked field by field; nothing bad gets through, the rest still applies", () => {
  const look = sanitizeLook({
    version: 2, future: 1,
    lights: [
      { id: "sun", role: "sun", color: "#FF8800", intensity: 99, position: [0, 5, 5], enabled: true, castShadow: true },
      { id: "x", role: "sun", color: "red", intensity: -1, position: [0, 0, 0] }, // no usable position: dropped
      { id: "y", role: "sun", color: "#00ff00", intensity: 2, position: [1, 1, 1], castShadow: true }, // a second sun
      { id: "y", color: "#0000ff", intensity: 1, position: [1, 2, 3] }, // a repeated id
    ],
    hemisphere: { sky: "nope", intensity: 1 },
    environment: { kind: "space", rotation: 400 },
    toneMapping: "filmic", exposure: 9, floorShadow: true,
    backdrop: { inner: "#123456", ellipse: "url(evil)" },
  });
  assert.deepEqual(look.lights.map(l => [l.id, l.role, l.color, l.intensity, l.castShadow]), [
    ["sun", "sun", "#ff8800", 10, true], ["y", "light", "#00ff00", 2, false], ["y-2", "light", "#0000ff", 1, false],
  ]);
  assert.equal(look.hemisphere.sky, "#e8edf4");
  assert.deepEqual(look.environment, { kind: "softbox", intensity: STUDIO_RIG.env, rotation: 180 });
  assert.deepEqual([look.toneMapping, look.exposure, look.floorShadow], ["neutral", 3, true]);
  assert.deepEqual(look.backdrop, { ...STUDIO_BACKDROP, inner: "#123456" });
  assert.equal("future" in look, false);
});

test("PR #40's first settings become a look: sun, floor and Studio backdrop carried over", () => {
  const look = sanitizeLook({ sunAzimuth: 30, sunElevation: 20, floorShadow: true, lobbyHue: 0, backdrop: { studio: "black", lobby: "white" } });
  const sun = lightAngles(look.lights[0].position);
  assert.ok(Math.abs(sun.height - 20) < 1e-9 && Math.abs(sun.bearing - (lightAngles(KEY_POSITION).bearing + 30)) < 1e-9);
  assert.equal(look.floorShadow, true);
  assert.equal(backdropCss(look.backdrop), "#000000");
  assert.deepEqual(sanitizeLook({ sunAzimuth: 45 }).lights[0].position, rotated(KEY_POSITION, 45), "height untouched: exact turn");
});

test("added lights get free ids up to the cap; presets and descriptions read sensibly", () => {
  const lights = studioLook().lights;
  const added = newLight(lights);
  assert.equal(added.id, "light-3");
  assert.equal(newLight([...lights, added]).id, "light-4");
  assert.ok(MAX_LIGHTS >= lobbyLook().lights.length + 1);
  assert.equal(BACKDROP_PRESETS.filter(p => backdropCss(p.backdrop) === backdropCss(STUDIO_BACKDROP)).length, 1);
  assert.equal(describeLook(studioLook()), "2 lights · sun 32° / 52° · Studio grey");
  const custom = studioLook(); custom.floorShadow = true; custom.lights[1].enabled = false; custom.backdrop = { ...custom.backdrop, inner: "#111111", middle: "#111111", outer: "#111111" };
  assert.equal(describeLook(custom), "1 light · sun 32° / 52° · floor shadow · #111111");
  assert.equal(fullLookName(custom), null);
  assert.ok(Math.abs(lightAngles(KEY_POSITION).height - DEFAULT_SUN_ELEVATION) < 1e-12);
});
