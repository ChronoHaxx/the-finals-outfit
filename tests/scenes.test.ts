import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAMERA, SCENES, SCENE_ID, plateScale, sceneById, sceneUrl, wrapAngle } from "../src/lib/scenes";
import { DEFAULT_LOOK, describeLook, isDefaultLook, menuS12Look, sanitizeLook, studioLook } from "../src/lib/stage-lighting";
import { mergedLook } from "../src/lib/lighting-store";

// In-game scene backdrops (15 Nov 2026). A scene id lives in the look's backdrop; it must survive storage, survive an
// older build that does not know it, and never touch the default look.

test("the default look has no scene, and still compares equal to itself after storage", () => {
  assert.equal(DEFAULT_LOOK.backdrop.scene, undefined);
  assert.equal("scene" in sanitizeLook(JSON.parse(JSON.stringify(DEFAULT_LOOK))).backdrop, false,
    "no `scene` key appears on a look that had none");
  assert.ok(isDefaultLook(sanitizeLook(undefined)));
});

test("scene ids are unique, well formed, and each scene's camera is the viewer's default camera", () => {
  const ids = SCENES.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scene of SCENES) {
    assert.match(scene.id, SCENE_ID);
    assert.deepEqual(scene.camera, { ...DEFAULT_CAMERA }, `${scene.id}: a plate is right only from the camera it was made from`);
    assert.equal(scene.fallback.scene, undefined, `${scene.id}: the fallback is plain colours`);
    if (scene.kind === "plate") assert.ok(scene.plate?.file && scene.plate.width > 0 && scene.plate.height > 0);
  }
});

test("a known scene id is kept through storage", () => {
  const look = studioLook();
  look.backdrop = { ...SCENES[0].fallback, scene: SCENES[0].id };
  const stored = JSON.parse(JSON.stringify(mergedLook({}, look)));
  assert.equal(sanitizeLook(stored).backdrop.scene, SCENES[0].id);
  assert.match(describeLook(sanitizeLook(stored)), new RegExp(SCENES[0].label));
});

test("an unknown but well-formed scene id (a newer build's) is kept, not dropped; garbage is dropped", () => {
  const look = sanitizeLook({ ...studioLook(), backdrop: { ...studioLook().backdrop, scene: "s99-future-arena" } });
  assert.equal(look.backdrop.scene, "s99-future-arena", "kept for a build that knows it");
  assert.equal(sceneById(look.backdrop.scene), null, "this build shows the colours instead");
  assert.match(describeLook(look), /newer version/);
  for (const bad of ["", "UPPER", "../x", "a".repeat(41), 7, null, { id: "x" }])
    assert.equal(sanitizeLook({ ...studioLook(), backdrop: { ...studioLook().backdrop, scene: bad } }).backdrop.scene, undefined, String(bad));
});

test("an older build's write keeps the scene id it does not know (the store merges unknown fields back)", () => {
  // What this build stored: a scene. What an older build writes: its look, which has no `scene` field at all.
  const stored = { ...studioLook(), backdrop: { ...studioLook().backdrop, scene: "s12-menu" } };
  const olderLook = studioLook(); // no scene field
  const written = mergedLook(stored, olderLook) as { backdrop: { scene?: string } };
  assert.equal(written.backdrop.scene, "s12-menu");
});

test("plate zoom is a pure scale about the centre: 1 at the plate's own field, tan ratio otherwise", () => {
  assert.equal(plateScale(35, 35), 1);
  assert.ok(Math.abs(plateScale(17.5, 35) - Math.tan(17.5 * Math.PI / 360) ** -1 * Math.tan(35 * Math.PI / 360)) < 1e-12);
  assert.ok(plateScale(20, 35) > 1.7 && plateScale(20, 35) < 1.8);
});

test("the turntable angle wraps into (-pi, pi] and never returns -0", () => {
  assert.equal(wrapAngle(0), 0);
  assert.ok(Object.is(wrapAngle(-0), 0));
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-Math.PI) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(7) - (7 - 2 * Math.PI)) < 1e-12);
});

test("scene files resolve against the scenes base", () => {
  assert.equal(sceneUrl("s12-tunnel/plate-v1.webp", "https://host/scenes/"), "https://host/scenes/s12-tunnel/plate-v1.webp");
  assert.equal(sceneUrl("/a.webp", "https://host/x/"), "https://host/x/a.webp");
});

test("the Season 12 menu look carries its scene and survives storage unchanged", () => {
  const look = menuS12Look();
  assert.equal(look.backdrop.scene, "s12-menu");
  assert.deepEqual(sanitizeLook(JSON.parse(JSON.stringify(look))), look);
  assert.equal(isDefaultLook(look), false);
});
