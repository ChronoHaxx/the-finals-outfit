import { test } from "node:test";
import assert from "node:assert/strict";
import { bakeRect, dilate, linearToSrgb } from "../src/lib/bake-image";

test("sRGB encoding follows the transfer curve and clamps", () => {
  assert.equal(linearToSrgb(0), 0);
  assert.equal(linearToSrgb(1), 1);
  assert.ok(Math.abs(linearToSrgb(0.5) - 0.7354) < 1e-3);
  assert.equal(linearToSrgb(0.002), 12.92 * 0.002);
  assert.equal(linearToSrgb(-1), 0);
  assert.equal(linearToSrgb(4), 1);
});

test("UV ranges inside the unit square bake 1:1; others fit the square and map back exactly", () => {
  assert.deepEqual(bakeRect([0, 0], [1, 1]), { offset: [0, 0], scale: [1, 1] });
  assert.deepEqual(bakeRect([0.2, 0.1], [0.9, 0.95]), { offset: [0, 0], scale: [1, 1] });
  const { offset, scale } = bakeRect([-1, 0], [1, 3]);
  const place = (u: number, v: number) => [u * scale[0] + offset[0], v * scale[1] + offset[1]];
  assert.deepEqual(place(-1, 0), [0, 0]);
  assert.deepEqual(place(1, 3), [1, 1]);
});

test("seam padding grows only outward, averages covered neighbours and stops when nothing is left to fill", () => {
  const w = 5, h = 5, channel = new Float32Array(w * h * 4), covered = new Uint8Array(w * h);
  const set = (x: number, y: number, v: number) => { covered[y * w + x] = 1; channel.set([v, v, v, 1], (y * w + x) * 4); };
  set(1, 2, 1);
  set(3, 2, 3);
  assert.equal(dilate([channel], covered, w, h, 1), 13);
  const at = (x: number, y: number) => channel[(y * w + x) * 4];
  assert.equal(at(1, 2), 1); // covered texels keep their value
  assert.equal(at(3, 2), 3);
  assert.equal(at(2, 1), 2); // touches both: their average
  assert.equal(at(0, 1), 1); // touches only the left texel
  assert.equal(at(4, 3), 3);
  assert.equal(at(0, 0), 0); // two rows away: not reached by one pass
  assert.equal(covered.reduce((n, c) => n + c, 0), 15);
  // A second pass fills the remaining columns' corners; a third finds nothing.
  assert.equal(dilate([channel], covered, w, h, 5), 10);
  assert.equal(covered.every(Boolean), true);
  assert.equal(at(0, 0), 1);
  assert.equal(at(2, 0), 2);
  assert.equal(dilate([channel], covered, w, h, 5), 0);
  assert.throws(() => dilate([new Float32Array(4)], covered, w, h, 1), /size mismatch/);
});
