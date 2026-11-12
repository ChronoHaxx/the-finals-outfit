import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  DEFAULT_LIGHTING, DEFAULT_LOBBY_HUE, DEFAULT_SUN_ELEVATION, KEY_POSITION, REVIEWED_RIMS, REVIEWED_SHADOW_FRUSTUM,
  RIM_MAX_GAIN, SUN_ELEVATION_MAX, SUN_ELEVATION_MIN, THEME_BACKGROUND, backdropCss, describeLighting, keyLightPosition,
  luminance, resolveBackdrop, rimLights, sanitizeLighting, shadowFrustum, snapFollow,
} from "../src/lib/stage-lighting";

// Viewer lighting options (11 Nov 2026). The defaults must reproduce the reviewed rig exactly; the chosen values must
// keep the character and its whole floor shadow inside the shadow map.

test("the defaults are the reviewed rig to the last bit", () => {
  assert.deepEqual(keyLightPosition(0, null), [2.5, 6, 4], "key light");
  assert.deepEqual(shadowFrustum(null, false), { ...REVIEWED_SHADOW_FRUSTUM }, "shadow camera");
  assert.deepEqual(rimLights(null), REVIEWED_RIMS.map(r => ({ ...r })), "Lobby rims");
  assert.equal(backdropCss("studio", "default"), THEME_BACKGROUND.studio);
  assert.equal(backdropCss("lobby", "default"), THEME_BACKGROUND.lobby);
  assert.equal(THEME_BACKGROUND.studio, "radial-gradient(ellipse 75% 65% at 50% 35%, #f0f3f7 0%, #dee4eb 55%, #c5cdd7 100%)");
  assert.equal(THEME_BACKGROUND.lobby, "radial-gradient(ellipse 70% 60% at 50% 38%, #1b2740 0%, #0a0e17 58%, #05060a 100%)");
  assert.deepEqual(sanitizeLighting(undefined), DEFAULT_LIGHTING);
});

test("azimuth alone turns the reviewed light as PR #37 did; a chosen height keeps its distance and bearing", () => {
  const pr37 = KEY_POSITION.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(90));
  assert.deepEqual(keyLightPosition(90, null), [pr37.x, pr37.y, pr37.z]);
  const atDefault = new THREE.Vector3(...keyLightPosition(0, DEFAULT_SUN_ELEVATION));
  assert.ok(atDefault.distanceTo(KEY_POSITION) < 1e-9, "the reviewed height, given as a number, is the same place");
  for (const [azimuth, elevation] of [[0, 10], [135, 45], [-60, 85]]) {
    const p = new THREE.Vector3(...keyLightPosition(azimuth, elevation));
    assert.ok(Math.abs(p.length() - KEY_POSITION.length()) < 1e-9, "same distance");
    assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.asin(p.y / p.length())) - elevation) < 1e-9, "the height asked for");
    const bearing = new THREE.Vector3(...keyLightPosition(azimuth, null));
    assert.ok(Math.abs(Math.atan2(p.x, p.z) - Math.atan2(bearing.x, bearing.z)) < 1e-9, "same compass bearing");
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
  for (let elevation = SUN_ELEVATION_MIN; elevation <= SUN_ELEVATION_MAX; elevation += 5) {
    for (const azimuth of [-150, -45, 0, 90, 180]) {
      for (const follow of [false, true]) {
        const f = shadowFrustum(elevation, follow);
        const light = new THREE.Vector3(...keyLightPosition(azimuth, elevation));
        const toLight = new THREE.Vector3(light.x, 0, light.z).normalize();
        const side = new THREE.Vector3(-toLight.z, 0, toLight.x);
        const e = THREE.MathUtils.degToRad(elevation);
        const points: THREE.Vector3[] = [];
        // Following, the body is up to half a grid step off the point the light looks at, in x and z.
        const offsets = follow ? [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => [x * 0.125, z * 0.125]) : [[0, 0]];
        for (const [dx, dz] of offsets)
        for (const along of [-1, 0, 1]) for (const height of [0, 1, 2.5]) for (const across of [-1.2, 0, 1.2]) {
          const caster = toLight.clone().multiplyScalar(along).addScaledVector(side, across).setY(height).add(new THREE.Vector3(dx, 0, dz));
          points.push(caster);
          // Where that point's shadow falls on the floor: straight down the beam.
          points.push(caster.clone().addScaledVector(toLight, -height / Math.tan(e)).setY(0));
        }
        assert.ok(inShadowMap(light, new THREE.Vector3(), f, points).every(Boolean), `sun ${azimuth}°/${elevation}°${follow ? " following" : ""}`);
        // The bias stays the reviewed 3.9 mm of depth however deep the frustum grows.
        const reviewed = REVIEWED_SHADOW_FRUSTUM.bias * (REVIEWED_SHADOW_FRUSTUM.far - REVIEWED_SHADOW_FRUSTUM.near);
        assert.ok(Math.abs(f.bias * (f.far - f.near) - reviewed) < 1e-12);
      }
    }
  }
});

test("the reviewed frustum would cut a low sun's shadow short (why it grows)", () => {
  const light = new THREE.Vector3(...keyLightPosition(0, 10));
  const tip = new THREE.Vector3(-light.x, 0, -light.z).normalize().multiplyScalar(2.5 / Math.tan(THREE.MathUtils.degToRad(10)));
  assert.deepEqual(inShadowMap(light, new THREE.Vector3(), { ...REVIEWED_SHADOW_FRUSTUM }, [new THREE.Vector3(0, 2.5, 0), tip]),
    [false, false]);
});

test("following snaps the body to a 0.25 m grid within ±3 m", () => {
  assert.deepEqual(snapFollow(0.1, -0.13), [0, -0.25]);
  assert.deepEqual(snapFollow(7, -9), [3, -3]);
  assert.deepEqual(snapFollow(NaN, Infinity), [0, 0]);
  assert.ok(!Object.is(snapFollow(-0.01, 0)[0], -0), "no negative zero");
});

test("rim hues hold the shipped brightness, capped where a hue reads darker than the blue", () => {
  const near = rimLights(DEFAULT_LOBBY_HUE);
  for (const [i, rim] of near.entries()) {
    const a = new THREE.Color(rim.color), b = new THREE.Color(REVIEWED_RIMS[i].color);
    assert.ok(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.02, "the default hue is the shipped colour");
    assert.ok(Math.abs(rim.intensity - REVIEWED_RIMS[i].intensity) < 0.05);
  }
  const shipped = REVIEWED_RIMS.map(r => luminance(new THREE.Color(r.color)) * r.intensity);
  for (let hue = 0; hue < 360; hue += 15) {
    rimLights(hue).forEach((rim, i) => {
      const lit = luminance(new THREE.Color(rim.color)) * rim.intensity;
      assert.ok(rim.intensity <= REVIEWED_RIMS[i].intensity * RIM_MAX_GAIN + 1e-9, `hue ${hue}: gain capped`);
      assert.ok(lit <= shipped[i] * 1.02, `hue ${hue}: never brighter than shipped`);
      // Below the cap the match is exact (up to the hex rounding of the colour).
      if (rim.intensity < REVIEWED_RIMS[i].intensity * RIM_MAX_GAIN - 1e-9) assert.ok(Math.abs(lit / shipped[i] - 1) < 0.02, `hue ${hue}`);
    });
  }
  const yellow = rimLights(60)[0];
  assert.ok(yellow.intensity < 1, "yellow is turned well down: it reads ~5x brighter at the same intensity");
});

test("stored settings are checked field by field; a stale backdrop falls back without losing the rest", () => {
  assert.deepEqual(sanitizeLighting({ sunAzimuth: 400, sunElevation: 3, floorShadow: "yes", lobbyHue: -1, backdrop: 5 }), DEFAULT_LIGHTING);
  const look = sanitizeLighting({ sunAzimuth: 44.6, sunElevation: 20, floorShadow: true, lobbyHue: 360,
    backdrop: { studio: "removed-later", lobby: "black" }, future: 1 });
  assert.deepEqual(look, { sunAzimuth: 45, sunElevation: 20, floorShadow: true, lobbyHue: 0,
    backdrop: { studio: "default", lobby: "black" } });
  assert.equal(resolveBackdrop("studio", "removed-later").id, "default");
  assert.equal(resolveBackdrop("studio", "studio").id, "default", "a theme's own gradient is its default");
  assert.equal(backdropCss("studio", "black"), "#000000");
  assert.match(backdropCss("lobby", "studio"), /^radial-gradient\(ellipse 70% 60% at 50% 38%, #f0f3f7 0%, #dee4eb 58%, #c5cdd7 100%\)$/);
  assert.equal(describeLighting(look), "Sun 45° / 20° high · floor shadow · rim 0° · Black");
});
