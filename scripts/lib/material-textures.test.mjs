import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildSourceMaterialBinding } from "./material-textures.mjs";

test("LED source binding keeps its own atlas/ramp and converts its own BC5 normal", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "finals-effect-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dumpRoot = join(root, "Content", "Discovery", "Characters");
  const textures = join(root, "Content", "Discovery", "Textures");
  mkdirSync(dumpRoot, { recursive: true }); mkdirSync(textures, { recursive: true });
  const png = (name, pixel) => sharp(Buffer.from(pixel), { raw: { width: 1, height: 1, channels: 4 } }).png().toFile(join(textures, name + ".png"));
  await Promise.all([png("Atlas", [240, 0, 0, 255]), png("Ramp", [255, 160, 0, 255]), png("Normal", [128, 192, 0, 37])]);
  const mi = { family: "led", doubleSided: false, vectors: {}, scalars: {
    Brightness: 25, FrameCount: 16, TrackCount: 8, AnimationTrack: 2, AnimationSpeed: 10,
    UVScale: 0.54, UVOffsetV: -0.08, IconCaptureTime: 0,
  }, textures: { Animation: "/Game/Discovery/Textures/Atlas.Atlas", ColorRamp: "/Game/Discovery/Textures/Ramp.0", Normal: "/Game/Discovery/Textures/Normal.0" } };
  const modelsRoot = join(root, "public", "models");
  const result = await buildSourceMaterialBinding(mi, { dumpRoot, modelsRoot });
  assert.equal(result.doubleSided, false);
  assert.equal(result.ledScreen.frameCount, 16);
  assert.equal(result.ledScreen.trackCount, 8);
  assert.equal(result.ledScreen.animationTrack, 2);
  assert.equal(result.ledScreen.captureTime, 0);
  assert.notEqual(result.ledScreen.animation, result.ledScreen.colorRamp);
  const normal = await sharp(readFileSync(join(root, "public", result.ledScreen.normal))).raw().toBuffer();
  assert.equal(normal[0], 128); assert.equal(normal[1], 63);
  assert.ok(normal[2] > 230, "normal Z is reconstructed instead of copying blue=0");
  const second = await buildSourceMaterialBinding(mi, { dumpRoot, modelsRoot });
  assert.deepEqual(second, result, "copy paths are reproducible and content-addressed");
});

test("glass maps linear ColorTint and clamps opacity without claiming missing sidedness", async () => {
  const result = await buildSourceMaterialBinding({ family: "glass", vectors: { ColorTint: { r: 1, g: 0, b: 0 } }, scalars: { Opacity: 0.65, Roughness: 0.45 }, textures: {} }, { dumpRoot: "/missing/Content/Discovery/Characters", modelsRoot: "/missing/models" });
  assert.deepEqual(result, { family: "glass", glass: { color: "#ff0000", opacity: 0.65, roughness: 0.45 } });
});
