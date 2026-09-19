import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  OCCLUDED, NORMAL_VISIBLE, OBLIQUE_VISIBLE, FOOTPRINT_VISIBLE, OCCLUSION_DEFAULTS,
  viewDirections, createOcclusionTest, restoreHiddenTexels, combineCandidate,
} from "../scripts/shader-probe/coverage-projection.mjs";

// ---- synthetic geometry: a garment band revolved around the y axis (metres) ----
// Closed profile loop (r, y), clockwise: inner lining up, rounded top hem, outer wall down,
// rounded bottom hem. Revolving it gives a welded closed shell with zero boundary edges, like
// the Starter Pants waistband. Each triangle stores the outward normal of the shell material.
const RI = .16, RO = .17, TOP = .20, BOTTOM = -.30, HEM = (RO - RI) / 2;
function bandProfile(steps = 12) {
  const loop = [[RI, BOTTOM], [RI, TOP]];
  for (let s = 1; s < steps; s++) { const a = Math.PI - Math.PI * s / steps; loop.push([RI + HEM + HEM * Math.cos(a), TOP + HEM * Math.sin(a)]); }
  loop.push([RO, TOP], [RO, BOTTOM]);
  for (let s = 1; s < steps; s++) { const a = -Math.PI * s / steps; loop.push([RO - HEM - HEM * Math.cos(a), BOTTOM + HEM * Math.sin(a)]); }
  return loop;
}
// A fractional phase keeps test samples off facet edges, where a brute-force caster is ill-conditioned.
function revolve(loop, segments = 96, phase = .37) {
  const triangles = [], at = ([r, y], k) => { const t = 2 * Math.PI * (k + phase) / segments; return [r * Math.cos(t), y, r * Math.sin(t)]; };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dr = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dr, dy);
    const [nr, ny] = [-dy / len, dr / len]; // clockwise loop: outward from the material
    for (let k = 0; k < segments; k++) {
      const tm = 2 * Math.PI * (k + phase + .5) / segments, normal = [nr * Math.cos(tm), ny, nr * Math.sin(tm)];
      const p = [at(a, k), at(b, k), at(b, k + 1), at(a, k + 1)];
      triangles.push({ v: [p[0], p[1], p[2]], normal }, { v: [p[0], p[2], p[3]], normal });
    }
  }
  return triangles;
}
const BAND = revolve(bandProfile());
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const vec = p => Array.isArray(p) ? p : [p.x, p.y, p.z];
// Double-sided Moller-Trumbore; returns crossings with t in [near, far].
function crossings(triangles, origin, direction, near = 0, far = Infinity) {
  const o = vec(origin), d = vec(direction), out = [];
  for (const tri of triangles) {
    const e1 = sub(tri.v[1], tri.v[0]), e2 = sub(tri.v[2], tri.v[0]), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(o, tri.v[0]), u = dot(s, p) / det; if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det; if (t >= near && t <= far) out.push({ t, normal: tri.normal });
  }
  return out;
}
// The unchanged generator predicate, as an oracle for the "before" state.
function previousPolicyHides(triangles, p, n) {
  const origin = p.map((x, i) => x - .04 * n[i]);
  return crossings(triangles, origin, n, 0, .08).some(hit => dot(hit.normal, n) > .25);
}
const occlusion = triangles => createOcclusionTest((o, d) => crossings(triangles, o, d).length > 0);
const classify = (triangles, p, n) => occlusion(triangles).classify({ x: p[0], y: p[1], z: p[2] }, { x: n[0], y: n[1], z: n[2] });
const visibleAlong = (triangles, p, direction) => crossings(triangles, p, direction).length === 0;

test("view directions: the normal first, then rings at the recorded tilts", () => {
  const dirs = viewDirections();
  assert.equal(dirs.length, 1 + OCCLUSION_DEFAULTS.tiltDegrees.length * OCCLUSION_DEFAULTS.azimuths);
  assert.deepEqual(dirs[0], [0, 0, 1]);
  for (const [i, d] of dirs.entries()) {
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
    const tilt = i === 0 ? 0 : OCCLUSION_DEFAULTS.tiltDegrees[Math.floor((i - 1) / OCCLUSION_DEFAULTS.azimuths)];
    assert.ok(Math.abs(d[2] - Math.cos(tilt * Math.PI / 180)) < 1e-12);
  }
});

test("covered interior under a closed lined shell stays hidden", () => {
  assert.equal(BAND.length % 2, 0);
  const p = [.15, 0, 0], n = [1, 0, 0]; // 1 cm beneath the lining, far from both hems
  assert.ok(previousPolicyHides(BAND, p, n));
  assert.equal(classify(BAND, p, n), OCCLUDED);
  // Also under a different azimuth of the revolved shell, with a tilted normal.
  const q = [0, -.1, .15], m = unit([0, .3, 1]);
  assert.ok(previousPolicyHides(BAND, q, m));
  assert.equal(classify(BAND, q, m), OCCLUDED);
});

test("skin above a rounded closed hem is restored when a tilted normal line reaches the hem", () => {
  // Fitted body inside the band; the sample is 1 cm above the hem's top, in a concave region
  // whose normal tilts down toward the garment (a lumbar-like profile).
  const p = [.15, .215, 0], n = unit([1, -1, 0]);
  assert.ok(previousPolicyHides(BAND, p, n), "precondition: the previous policy hides this sample");
  assert.ok(visibleAlong(BAND, p, [1, 0, 0]), "ground truth: a level view sees this sample past the hem");
  assert.equal(classify(BAND, p, n), OBLIQUE_VISIBLE);
});

test("skin on the viewer side of a hem embedded beneath unfitted skin is restored", () => {
  // Unfitted body (radius .175) outside the band's outer wall: the hem lies under the skin and
  // the sample sits above it with an upward-tilted normal (the top of a buttock-like bulge).
  const p = [.175, .207, 0], n = unit([1, .5, 0]);
  assert.ok(previousPolicyHides(BAND, p, n), "precondition: the inward half of the line reaches the hem");
  assert.ok(!crossings(BAND, p, n, 0, .04).length, "that hit is beneath the skin, not over it");
  assert.ok(visibleAlong(BAND, p, [1, 0, 0]), "ground truth: a level view sees this sample");
  assert.equal(classify(BAND, p, n), NORMAL_VISIBLE);
});

test("interior coverage survives only when evaluated on the fitted body", () => {
  // The same body texel before and after a push-inside morph of 2.5 cm.
  const unfitted = [.175, 0, 0], fitted = [.15, 0, 0], n = [1, 0, 0];
  assert.ok(previousPolicyHides(BAND, unfitted, n), "the previous policy hides the unfitted poke-through");
  assert.equal(classify(BAND, unfitted, n), NORMAL_VISIBLE, "unfitted geometry would expose the interior");
  assert.equal(classify(BAND, fitted, n), OCCLUDED, "fitted runtime geometry keeps it hidden");
  // Above the hem the morph has no effect and the texel stays restored in both states.
  assert.equal(classify(BAND, [.175, .207, 0], unit([1, .5, 0])), NORMAL_VISIBLE);
});

test("rays start at the rendered skin: only sheets at or in front of it occlude", () => {
  assert.equal(OCCLUSION_DEFAULTS.surfaceTolerance, 0);
  const p = [RI + .0005, 0, 0], n = [1, 0, 0]; // skin inside the lining's material: the outer wall is in front
  assert.equal(classify(BAND, p, n), OCCLUDED);
  const single = [{ v: [[.15, -1, -1], [.15, 1, -1], [.15, 0, 2]], normal: [1, 0, 0] }];
  assert.equal(classify(single, [.1495, 0, 0], n), OCCLUDED, "skin just beneath a single sheet");
  assert.equal(classify(single, [.15, 0, 0], n), OCCLUDED, "an exactly coincident sheet still occludes");
  assert.equal(classify(single, [.1505, 0, 0], n), NORMAL_VISIBLE, "a sheet 0.5 mm behind the skin cannot occlude it");
});

// ---- raster, shared UVs, pose union and subset ----
const W = 8, H = 4, RES = 4;
const fullSquare = [[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]]; // covers tile 0 (x < 4)
function hiddenTile0() { const h = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) h[y * W + x] = 255; return h; }
const raster = (hidden, uvs, classify, size = { width: W, height: H, resolution: RES }) =>
  restoreHiddenTexels({ ...size, hidden, triangleCount: uvs.length, triangleUv: tri => uvs[tri], classify });

test("restore raster evaluates only previously hidden texels", () => {
  const hidden = hiddenTile0(); hidden[0] = 0;
  let calls = 0;
  const { restored, evaluatedTexels, footprintSeedTexels } = raster(hidden, fullSquare, () => { calls++; return OBLIQUE_VISIBLE; });
  assert.equal(calls, 15); assert.equal(evaluatedTexels, 15);
  assert.equal(footprintSeedTexels, 0, "nothing left hidden, so no footprint pass");
  assert.equal(restored[0], 0, "a visible texel is never evaluated");
  for (let y = 0; y < H; y++) for (let x = 4; x < W; x++) assert.equal(restored[y * W + x], 0, "texels outside every triangle are untouched");
});

test("shared UVs: a texel is restored when any mapped surface is visible", () => {
  const hidden = hiddenTile0();
  const leftVisibleColumn = w => { // mirrored surface: visible only where u < .25
    const u = w[0] * 0 + w[1] * 1 + w[2] * 0; return u < .25 ? OBLIQUE_VISIBLE : OCCLUDED; };
  // Triangles 0-1: first side, covered. Triangles 2-3: the mirrored side sharing the same UVs.
  const { restored } = raster(hidden, [...fullSquare, ...fullSquare], (tri, w) => tri === 2 ? leftVisibleColumn(w) : OCCLUDED);
  const candidate = combineCandidate(hidden, [restored]);
  for (let y = 0; y < H; y++) {
    assert.equal(candidate.pixels[y * W], restored[y * W] ? 0 : 255);
    assert.equal(candidate.pixels[y * W + 1], 255, "a cell that only borders the exposed region is not eroded");
    assert.equal(candidate.pixels[y * W + 3], 255, "surfaces covered on both sides stay hidden");
  }
  assert.ok(candidate.restoredPixels > 0);
});

test("candidate is a subset of the previous mask; either pose restores; interior untouched", () => {
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = 4096, previous = new Uint8Array(n), a = new Uint8Array(n), idle = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    previous[i] = rand() < .6 ? 255 : 0;
    const code = () => rand() < .1 ? (1 + (rand() < .5)) | (rand() < .3 ? FOOTPRINT_VISIBLE : 0) : 0;
    a[i] = code(); idle[i] = code();
  }
  const c = combineCandidate(previous, [a, idle]);
  let kept = 0, footprintOnly = 0;
  for (let i = 0; i < n; i++) {
    if (c.pixels[i]) assert.equal(previous[i], 255, "never hides previously visible skin");
    if (previous[i] && !a[i] && !idle[i]) { assert.equal(c.pixels[i], 255); kept++; }
    if (previous[i] && (a[i] || idle[i])) assert.equal(c.pixels[i], 0);
    const onlyFootprint = previous[i] && (a[i] || idle[i]) && [a[i], idle[i]].every(x => !x || x & FOOTPRINT_VISIBLE);
    footprintOnly += onlyFootprint;
    assert.equal(c.diagnostic[i * 4 + 2], c.pixels[i] || (onlyFootprint ? 128 : 0));
  }
  assert.equal(c.footprintOnlyRestoredPixels, footprintOnly);
  assert.equal(c.candidatePixels, kept);
  assert.equal(c.previousPixels - c.candidatePixels, c.restoredPixels);
  assert.equal(c.normalRestoredPixels + c.obliqueOnlyRestoredPixels, c.restoredPixels);
  const none = combineCandidate(previous, [new Uint8Array(n), new Uint8Array(n)]);
  assert.deepEqual(none.pixels, previous, "all-occluded evaluation reproduces the previous mask exactly");
});

// ---- finite texel footprint (analytic exposure in texel units: p = UV * RES) ----
const texelPoint = (uvs, tri, w) => [0, 1].map(axis => RES * (w[0] * uvs[tri][0][axis] + w[1] * uvs[tri][1][axis] + w[2] * uvs[tri][2][axis]));
const hiddenAfter = (hidden, restored) => hidden.map((h, i) => h && !restored[i] ? 255 : 0);
// Old behaviour: a texel is restored only when its centre is exposed on a triangle containing it.
function centreOnly(hidden, uvs, exposed) {
  const out = new Uint8Array(hidden.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!hidden[y * W + x]) continue;
    const q = [x + .5, y + .5];
    if (uvs.some((uv, tri) => { const w = weightsIn(uv, q); return w && exposed(tri, q); })) out[y * W + x] = OBLIQUE_VISIBLE;
  }
  return out;
}
function weightsIn(uv, [px, py]) {
  const [[ax, ay], [bx, by], [cx, cy]] = uv.map(([u, v]) => [u * RES, v * RES]), den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
  return Math.min(wa, wb, 1 - wa - wb) >= -1e-12 ? [wa, wb, 1 - wa - wb] : null;
}
// GL sampling of a 0/255 mask at texel-unit point q: nearest cell, and LINEAR with clamp-to-edge.
const nearest = (mask, [qx, qy]) => mask[Math.floor(qy) * W + Math.floor(qx)] / 255;
function linear(mask, [qx, qy]) {
  const fx = qx - .5, fy = qy - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (x, y) => mask[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] / 255;
  return (1 - tx) * (1 - ty) * at(x0, y0) + tx * (1 - ty) * at(x0 + 1, y0) + (1 - tx) * ty * at(x0, y0 + 1) + tx * ty * at(x0 + 1, y0 + 1);
}

test("texel footprint: a covered centre with an exposed corner is restored; centre-only is not", () => {
  // A straight hem crosses tile 0: skin with x + y < 2.6 is exposed, on both body triangles.
  const exposed = (tri, [px, py]) => px + py < 2.6;
  const hidden = hiddenTile0();
  const { restored, footprintRestored } = raster(hidden, fullSquare, (tri, w) => exposed(tri, texelPoint(fullSquare, tri, w)) ? OBLIQUE_VISIBLE : OCCLUDED);
  const old = centreOnly(hidden, fullSquare, exposed);
  for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) {
    const i = y * W + x;
    assert.equal(!!restored[i], x + y <= 2, `cell (${x}, ${y}) meets the exposed half-plane exactly when x + y <= 2`);
    assert.equal(!!old[i], x + y <= 1, `centre-only restores (${x}, ${y}) only when its centre is exposed`);
    if (x + y === 2) assert.ok(restored[i] & FOOTPRINT_VISIBLE, "restored through a corner, not the covered centre");
  }
  assert.equal(footprintRestored, 3);
  // Rendering check on every exposed fragment of tile 0: nothing is discarded by nearest or LINEAR
  // sampling of the new mask, while the centre-only mask discards some.
  const now = hiddenAfter(hidden, restored), before = hiddenAfter(hidden, old);
  let oldNearest = 0, oldLinear = 0;
  for (let sy = 0; sy < 64; sy++) for (let sx = 0; sx < 64; sx++) {
    const q = [(sx + .5) / 16, (sy + .5) / 16];
    if (!exposed(0, q)) continue;
    assert.equal(nearest(now, q), 0); assert.ok(linear(now, q) <= .5, `LINEAR discards exposed q = ${q}`);
    oldNearest += nearest(before, q) > .5; oldLinear += linear(before, q) > .5;
  }
  assert.ok(oldNearest > 0 && oldLinear > 0, "the centre-only mask discards exposed skin at the hem");
});

test("texel footprint: a partial cell whose centre lies on a covered triangle is restored", () => {
  // Exposed skin triangles 2-3 meet covered triangles 0-1 along a hem from (0, 1.85) to (4, 2.25) in texels.
  // Cells (0, 1) and (1, 1) have covered centres, yet the exposed triangles reach into their top edge.
  const p = (x, y) => [x / RES, y / RES];
  const uvs = [[p(0, 0), p(4, 0), p(4, 2.25)], [p(0, 0), p(4, 2.25), p(0, 1.85)],
    [p(0, 1.85), p(4, 2.25), p(4, 4)], [p(0, 1.85), p(4, 4), p(0, 4)]];
  const exposed = tri => tri >= 2, hidden = hiddenTile0();
  const { restored } = raster(hidden, uvs, tri => exposed(tri) ? NORMAL_VISIBLE : OCCLUDED);
  const old = centreOnly(hidden, uvs, exposed);
  for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) {
    const i = y * W + x, partial = y === 1 && x <= 1;
    assert.equal(!!restored[i], y >= 2 || partial, `cell (${x}, ${y})`);
    assert.equal(!!old[i], y >= 2, `centre-only cell (${x}, ${y})`);
    if (partial) assert.equal(restored[i], NORMAL_VISIBLE | FOOTPRINT_VISIBLE);
  }
});

test("footprint band: floods along an exposed sliver from a visible texel, never into deep cover", () => {
  // A 16 x 8 grid whose tile 0 (x < 8) is hidden. Only a 0.2-texel sliver around y = 4 is exposed: it
  // contains no texel centre, so pass 1 restores nothing and the flood must start at the visible x = 8 column.
  const size = { width: 16, height: 8, resolution: 8 }, uvs = fullSquare;
  const hidden = new Uint8Array(16 * 8); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hidden[y * 16 + x] = 255;
  const evaluatedAt = new Set();
  const result = raster(hidden, uvs, (tri, w) => {
    const [px, py] = [0, 1].map(axis => 8 * (w[0] * uvs[tri][0][axis] + w[1] * uvs[tri][1][axis] + w[2] * uvs[tri][2][axis]));
    evaluatedAt.add(`${px},${py}`);
    return py > 3.9 && py < 4.1 ? OBLIQUE_VISIBLE : OCCLUDED;
  }, size);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
    assert.equal(!!result.restored[y * 16 + x], y === 3 || y === 4, `cell (${x}, ${y})`);
  assert.equal(result.evaluatedTexels, 64 + 8, "every centre once, the 8 on the shared diagonal once per triangle");
  assert.equal(result.footprintSeedTexels, 8, "seeds: the hidden column next to visible texels");
  // Rows 2-5 (neighbours of restored rows) plus the rest of the seed column; rows 0-1 and 6-7 of x < 7 are skipped.
  assert.equal(result.footprintEvaluatedTexels, 4 * 8 + 4);
  for (const key of evaluatedAt) {
    const [px, py] = key.split(",").map(Number);
    if (Number.isInteger(px) || Number.isInteger(py)) // footprint points lie on cell edges; centres never do
      assert.ok(px >= 7 || (py >= 2 && py <= 6), `no footprint ray deep inside the covered region: ${key}`);
  }
  assert.ok(result.footprintPoints < 64 * 4, "shared footprint vertices are classified once");
});

const referenceGenerator = new URL("../reference/build-companion-masks.mjs", import.meta.url);
// Source comparison probe: runs only beside reference/ in the isolated workspace; skipped when integrated.
test("source probe: default generator path is the reference generator with additions only",
  { skip: !existsSync(referenceGenerator) && "reference/ generator not present" }, () => {
  const reference = readFileSync(referenceGenerator, "utf8").split(/\r?\n/);
  const edited = readFileSync(new URL("../scripts/shader-probe/build-companion-masks.mjs", import.meta.url), "utf8").split(/\r?\n/);
  let j = 0; const added = [];
  for (const line of edited) { if (j < reference.length && line === reference[j]) j++; else added.push(line); }
  assert.equal(j, reference.length, `reference line ${j + 1} was changed or removed: ${reference[j]}`);
  // Every added executable statement is either a declaration derived from the new flags or
  // lives inside a block guarded by them.
  const text = added.join("\n");
  assert.match(text, /const fittedOcclusion = process\.argv\.includes\("--fitted-occlusion"\)/);
  assert.match(text, /if \(fittedOcclusion\) await page\.evaluate/);
  assert.match(text, /if \(fittedOcclusion && existsSync\(output\)\)\n\s+throw/, "an existing output path is always refused");
  assert.match(text, /const occlusionPolicy = window\.__coveragePolicy \?\? null/);
  assert.ok(!/--conservative-openings|opening-clearance/.test(text), "rejected policies are not reintroduced");
});
