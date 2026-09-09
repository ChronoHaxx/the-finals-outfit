import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ledPreviewCaptureTime } from "../scripts/lib/material-textures.mjs";

test("a blank default LED capture selects occupied frames only from its own track", async () => {
  // Two tracks across columns, three frames down rows. Track zero is blank,
  // partially lit, then fully lit; track one already has a visible first frame.
  const pixels = Buffer.from([
    0, 0, 255, 255,
    255, 0, 0, 0,
    255, 255, 0, 0,
  ]);
  const atlas = await sharp(pixels, { raw: { width: 4, height: 3, channels: 1 } }).png().toBuffer();
  const screen = { frameCount: 3, trackCount: 2, animationTrack: 0, animationSpeed: 10, captureTime: 0 };
  assert.equal(await ledPreviewCaptureTime(atlas, screen), 0.2);
  assert.equal(await ledPreviewCaptureTime(atlas, { ...screen, animationTrack: 1 }), 0);
  assert.equal(await ledPreviewCaptureTime(atlas, { ...screen, captureTime: 0.072 }), 0.072);
  assert.equal(await ledPreviewCaptureTime(atlas, { ...screen, animationSpeed: 0 }), 0);
});
