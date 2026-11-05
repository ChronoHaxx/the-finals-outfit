import { test } from "node:test";
import assert from "node:assert/strict";
import { bakeRect, dilate, linearToSrgb, uvTiles } from "../src/lib/bake-image";

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

// UV quads (two triangles each, their own four vertices) for the tile split tests.
function layout(quads: [number, number, number, number][]) {
  const uvs: number[] = [], indices: number[] = [];
  for (const [u0, v0, u1, v1] of quads) {
    const base = uvs.length / 2;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { uvs, indices };
}
const place = (t: { offset: [number, number]; scale: [number, number] }, u: number, v: number) =>
  [u * t.scale[0] + t.offset[0], v * t.scale[1] + t.offset[1]];

test("islands in different whole UV tiles bake one image per tile, one texel per tile texel", () => {
  // The long coat's layout in miniature: islands in u tiles -1, 0 and 1.
  const { uvs, indices } = layout([[0.2, 0.1, 0.8, 0.9], [-0.9, 0.05, -0.3, 0.95], [1.1, 0.2, 1.7, 0.6], [-0.5, 0.3, -0.1, 0.4]]);
  const { tiles, tileOf, note } = uvTiles(indices, uvs);
  assert.equal(note, undefined);
  assert.deepEqual(tiles.map(t => t.tile), [[-1, 0], [0, 0], [1, 0]]);
  assert.deepEqual(tiles.map(t => t.scale), [[1, 1], [1, 1], [1, 1]]);
  assert.deepEqual(tiles.map(t => t.offset), [[1, 0], [0, 0], [-1, 0]]);
  assert.deepEqual([...tileOf!], [1, 1, 0, 0, 2, 2, 0, 0]);
  // Each island lands inside its own image.
  assert.deepEqual(place(tiles[0], -0.9, 0.05).map(x => +x.toFixed(6)), [0.1, 0.05]);
  assert.deepEqual(place(tiles[2], 1.7, 0.6).map(x => +x.toFixed(6)), [0.7, 0.6]);
});

test("a section in one tile keeps the single-image bake exactly", () => {
  const inside = layout([[0.1, 0.1, 0.4, 0.5], [0.5, 0.2, 0.9, 0.9]]);
  assert.deepEqual(uvTiles(inside.indices, inside.uvs), { tiles: [{ tile: [0, 0], offset: [0, 0], scale: [1, 1] }], tileOf: null });
  // Wholly in tile (1, 0): fitted as bakeRect fits it.
  const offset = layout([[1.2, 0.1, 1.6, 0.5], [1.7, 0.3, 1.9, 0.8]]);
  const single = uvTiles(offset.indices, offset.uvs);
  assert.equal(single.tileOf, null);
  assert.deepEqual(single.tiles[0], { tile: [1, 0], ...bakeRect([1.2, 0.1], [1.9, 0.8]) });
  assert.deepEqual(uvTiles([], []), { tiles: [{ tile: [0, 0], offset: [0, 0], scale: [1, 1] }], tileOf: null });
});

test("an island poking past its tile widens that tile's image; joined triangles stay one island", () => {
  // Hair cards reaching v = 1.002, beside an island in the next tile.
  const { uvs, indices } = layout([[0.1, 0.2, 0.3, 1.002], [1.2, 0.1, 1.4, 0.3]]);
  const { tiles, tileOf } = uvTiles(indices, uvs);
  assert.deepEqual(tiles.map(t => t.tile), [[0, 0], [1, 0]]);
  assert.deepEqual(place(tiles[0], 0.3, 1.002).map(x => +x.toFixed(9)), [0.3, 1]);
  assert.deepEqual([...tileOf!], [0, 0, 1, 1]);
  // Two triangles sharing vertices across u = 1 are one island: no split.
  const joined = uvTiles([0, 1, 2, 1, 3, 2], [0.6, 0.1, 1.2, 0.1, 0.6, 0.5, 1.3, 0.5]);
  assert.equal(joined.tileOf, null);
  assert.deepEqual(joined.tiles[0], { tile: [0, 0], ...bakeRect([0.6, 0.1], [1.3, 0.5]) });
});

test("the split is refused when one tile's image would cover another tile's islands, or past the tile cap", () => {
  // The tile-0 island reaches u = 1.3 and its image would also draw the tile-1 island at u 1.1-1.25.
  const overlap = layout([[0.4, 0.1, 1.3, 0.5], [1.1, 0.6, 1.25, 0.9]]);
  const refused = uvTiles(overlap.indices, overlap.uvs);
  assert.equal(refused.tileOf, null);
  assert.match(refused.note!, /would also cover another tile's islands/);
  assert.deepEqual(refused.tiles[0].scale, bakeRect([0.4, 0.1], [1.3, 0.9]).scale);
  const three = layout([[0.1, 0.1, 0.2, 0.2], [1.1, 0.1, 1.2, 0.2], [2.1, 0.1, 2.2, 0.2]]);
  assert.match(uvTiles(three.indices, three.uvs, 2).note!, /3 UV tiles \(more than 2\)/);
  assert.equal(uvTiles(three.indices, three.uvs).tiles.length, 3);
});
