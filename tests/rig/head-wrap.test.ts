import assert from "node:assert/strict";
import test from "node:test";
import { applyHeadWrap, bindHeadWrap, headWrapInputs, type HeadWrapData } from "../../src/rig/HeadWrap.ts";

// Two triangles of a small cage patch and a few points above, beside and below them.
const CAGE = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.2];
const TRIS = [0, 1, 2, 1, 3, 2];
const POINTS = [0.2, 0.2, 0.05, 0.7, 0.6, -0.03, 1.4, 0.5, 0.1, -0.2, -0.1, 0.02];

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-6) =>
  Array.from(a).every((v, i) => Math.abs(v - b[i]) <= eps);

test("evaluated on the reference cage the wrap reproduces every rest vertex", () => {
  const binding = bindHeadWrap(POINTS, CAGE, TRIS);
  const out = [...POINTS];
  applyHeadWrap(binding, CAGE, CAGE, TRIS, out);
  assert.ok(close(out, POINTS), JSON.stringify(out));
});

test("a translated cage carries the part with it", () => {
  const moved = CAGE.map((v, i) => v + [0.01, -0.02, 0.005][i % 3]);
  const binding = bindHeadWrap(POINTS, CAGE, TRIS);
  const out = [...POINTS];
  applyHeadWrap(binding, moved, CAGE, TRIS, out);
  assert.ok(close(out, POINTS.map((v, i) => v + [0.01, -0.02, 0.005][i % 3])), JSON.stringify(out));
});

test("a rigidly rotated cage rotates positions and directions with it", () => {
  const rot = (x: number, y: number, z: number) => [-y, x, z]; // 90 degrees about Z
  const turn = (v: number[]) => v.flatMap((_, i) => i % 3 ? [] : rot(v[i], v[i + 1], v[i + 2]));
  const binding = bindHeadWrap(POINTS, CAGE, TRIS);
  const out = [...POINTS], normals = [0, 0, 1, 1, 0, 0, 0, 1, 0, 0.6, 0.8, 0];
  applyHeadWrap(binding, turn(CAGE), CAGE, TRIS, out, [normals]);
  assert.ok(close(out, turn(POINTS), 1e-5), JSON.stringify(out));
  assert.ok(close(normals, turn([0, 0, 1, 1, 0, 0, 0, 1, 0, 0.6, 0.8, 0]), 1e-5), JSON.stringify(normals));
});

test("a part needs its proxy, a source head and that head's cage", () => {
  const data: HeadWrapData = { formatVersion: 1, contract: "finals-head-component-wrap-v1",
    reference: { source: "ref", positions: CAGE, triangles: TRIS }, cages: { cage: { positions: CAGE } },
    heads: { head: "cage" }, meshes: { mesh: { triangles: TRIS } } };
  assert.deepEqual(headWrapInputs(data, "mesh", "head").triangles, TRIS);
  assert.throws(() => headWrapInputs(data, "other", "head"), /No head wrap proxy/);
  assert.throws(() => headWrapInputs(data, "mesh", undefined), /requires a preserved source head/);
  assert.throws(() => headWrapInputs(data, "mesh", "legacy"), /No head wrap cage/);
  assert.throws(() => headWrapInputs({ ...data, meshes: { mesh: { triangles: [0, 1, 9] } } }, "mesh", "head"), /Invalid head wrap cage/);
});

test("the worn cage takes the head's active fitting morphs; the reference stays at rest", () => {
  const morphs = { default_ears: { vertices: [3], deltas: [0.002, 0, 0] }, default_chin: { vertices: [0, 1], deltas: [0, 0, 0.01, 0, 0, 0.02] } };
  const data: HeadWrapData = { formatVersion: 1, contract: "finals-head-component-wrap-v1",
    reference: { source: "ref", positions: CAGE, triangles: TRIS }, cages: { cage: { positions: CAGE, morphs } },
    heads: { head: "cage" }, meshes: { mesh: { triangles: TRIS } } };
  const rest = headWrapInputs(data, "mesh", "head");
  assert.equal(rest.target, CAGE);
  assert.deepEqual(rest.morphs, []);
  const ears = headWrapInputs(data, "mesh", "head", new Set(["default_ears", "hat_covers_head"]));
  assert.deepEqual(ears.morphs, ["default_ears"]);
  assert.equal(ears.reference, CAGE);
  assert.ok(close(ears.target, CAGE.map((v, i) => i === 9 ? v + 0.002 : v)), JSON.stringify(ears.target));
  assert.deepEqual(CAGE, [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.2], "the published cage is not mutated");
  const both = headWrapInputs(data, "mesh", "head", ["default_chin", "default_ears"]);
  assert.ok(close(both.target, [0, 0, 0.01, 1, 0, 0.02, 0, 1, 0, 1.002, 1, 0.2]), JSON.stringify(both.target));
  // A part follows the morphed cage: a vertex bound near the moved corner moves with it.
  const binding = bindHeadWrap(POINTS, CAGE, TRIS), out = [...POINTS];
  applyHeadWrap(binding, ears.target, CAGE, TRIS, out);
  assert.ok(!close(out, POINTS), "the morph moves the wrapped part");
});

test("malformed cage morphs are refused", () => {
  const data = (morph: { vertices: number[]; deltas: number[] }): HeadWrapData => ({ formatVersion: 1,
    contract: "finals-head-component-wrap-v1", reference: { source: "ref", positions: CAGE, triangles: TRIS },
    cages: { cage: { positions: CAGE, morphs: { default_ears: morph } } }, heads: { head: "cage" }, meshes: { mesh: { triangles: TRIS } } });
  assert.throws(() => headWrapInputs(data({ vertices: [4], deltas: [0, 0, 0] }), "mesh", "head", ["default_ears"]), /Invalid head wrap morph/);
  assert.throws(() => headWrapInputs(data({ vertices: [1], deltas: [0, 0] }), "mesh", "head", ["default_ears"]), /Invalid head wrap morph/);
  // An inactive malformed morph is not read.
  assert.doesNotThrow(() => headWrapInputs(data({ vertices: [4], deltas: [0] }), "mesh", "head", []));
});
