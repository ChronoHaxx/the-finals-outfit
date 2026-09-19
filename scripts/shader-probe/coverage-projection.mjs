// Pure geometry for the optional --fitted-occlusion coverage policy. No imports:
// build-companion-masks.mjs passes this source into its browser page through a blob URL
// and node --test imports it directly.
//
// The existing projection hides a body sample when the line along its normal crosses an
// aligned garment face within 4 cm on EITHER side, on the unfitted body. For garments
// authored against a push-inside fitting morph, the unfitted body lies outside the garment
// near its edge, so that line can reach a hem lying beneath the skin, or a hem below a
// tilted normal, although no garment surface covers the sample in the rendered, fitted body.
// Hiding such a sample opens a hole that the garment does not fill.
//
// This policy only restores texels. On the fitted posed geometry (the runtime morph state),
// a texel the existing policy hides stays hidden only if the garment occludes its body
// samples along the normal and along every fixed oblique view direction. Occlusion is
// directional: only surfaces at or in front of the skin count, crossed in either face
// orientation. It uses no garment topology, so closed, welded, lined and rounded hems behave
// like open ones. It is a derived preview heuristic, not recovered game culling.
//
// A mask texel is not a point. The runtime discards every body fragment whose UV falls in a
// hidden texel's cell, on every body triangle crossing that cell. Where a garment edge crosses a
// cell, its centre can be covered while part of the cell is exposed skin, so a texel is also
// restored when an exposed point lies anywhere in its cell (see restoreHiddenTexels).

export const OCCLUSION_POLICY = "fitted-occlusion";

export const OCCLUSION_DEFAULTS = Object.freeze({
  tiltDegrees: Object.freeze([30, 60]), // view rings around the body normal, plus the normal itself
  azimuths: 8,                          // directions per ring, evenly spaced around the normal
  surfaceTolerance: 0,                  // metres beneath the skin where rays start; 0 = the rendered skin point
});

// Restoration codes. FOOTPRINT_VISIBLE is added to the ray code when only a texel footprint
// vertex, not the texel centre, was found exposed.
export const OCCLUDED = 0, NORMAL_VISIBLE = 1, OBLIQUE_VISIBLE = 2, FOOTPRINT_VISIBLE = 4;

// Unit directions in a local frame whose z axis is the body normal: the normal first, then
// each ring in order. Deterministic, so recorded statistics are reproducible.
export function viewDirections(options = {}) {
  const { tiltDegrees, azimuths } = { ...OCCLUSION_DEFAULTS, ...options };
  const out = [[0, 0, 1]];
  for (const tilt of tiltDegrees) {
    const c = Math.cos(tilt * Math.PI / 180), s = Math.sin(tilt * Math.PI / 180);
    for (let k = 0; k < azimuths; k++)
      out.push([s * Math.cos(2 * Math.PI * k / azimuths), s * Math.sin(2 * Math.PI * k / azimuths), c]);
  }
  return out;
}

// castAny(origin, direction) -> true when the half-line origin + t * direction, t >= 0,
// crosses any garment face of the item (either orientation). Arguments are reused between calls.
// With surfaceTolerance 0 the half-line starts on the rendered skin: a garment sheet behind the
// skin cannot hide it, while a sheet in front of it or exactly coincident (t = 0) still does.
export function createOcclusionTest(castAny, options = {}) {
  const { surfaceTolerance } = { ...OCCLUSION_DEFAULTS, ...options };
  const local = viewDirections(options);
  const origin = { x: 0, y: 0, z: 0 }, direction = { x: 0, y: 0, z: 0 };
  const stats = { samples: 0, rays: 0, normalVisible: 0, obliqueVisible: 0 };
  return {
    stats,
    // OCCLUDED, NORMAL_VISIBLE (the normal ray escapes: skin outside the garment there) or
    // OBLIQUE_VISIBLE (only a tilted view escapes, e.g. past a hem). normal must be unit length.
    classify(point, normal) {
      stats.samples++;
      // Deterministic orthonormal basis around the normal (Duff et al. 2017).
      const sign = normal.z >= 0 ? 1 : -1, a = -1 / (sign + normal.z), b = normal.x * normal.y * a;
      const tx = 1 + sign * normal.x * normal.x * a, ty = sign * b, tz = -sign * normal.x;
      const sx = b, sy = sign + normal.y * normal.y * a, sz = -normal.y;
      origin.x = point.x - surfaceTolerance * normal.x;
      origin.y = point.y - surfaceTolerance * normal.y;
      origin.z = point.z - surfaceTolerance * normal.z;
      for (let k = 0; k < local.length; k++) {
        const [u, v, w] = local[k];
        direction.x = u * tx + v * sx + w * normal.x;
        direction.y = u * ty + v * sy + w * normal.y;
        direction.z = u * tz + v * sz + w * normal.z;
        stats.rays++;
        if (castAny(origin, direction)) continue;
        if (k === 0) { stats.normalVisible++; return NORMAL_VISIBLE; }
        stats.obliqueVisible++; return OBLIQUE_VISIBLE;
      }
      return OCCLUDED;
    },
  };
}

// Re-evaluates the texels the existing policy hid in one pose. Coordinates are UV * resolution,
// so texel (x, y) is sampled for UVs in its closed cell [x, x + 1] x [y, y + 1]. A texel is restored
// when ANY body surface mapped to it is visible, so shared/mirrored UVs stay conservative.
// triangleUv(tri) -> three [u, v] pairs; classify(tri, barycentric weights) -> OCCLUDED | NORMAL_VISIBLE | OBLIQUE_VISIBLE.
//
// Pass 1, centres: every hidden texel centre on each triangle containing it, as the generator rasterises.
// Pass 2, footprints: for a hidden texel still unrestored, the vertices of each triangle-cell intersection
// polygon, including triangles that do not contain the centre: cell corners inside the triangle, triangle
// vertices inside the cell and triangle edges crossing cell edges. For one view direction, the exposed part
// of that convex polygon is bounded by the garment silhouette seen along it. Where the silhouette is straight
// at texel scale, that part is the polygon cut by a half-plane, which is non-empty only if it holds a vertex.
// Vertices are shared by neighbouring cells, so each is classified once per triangle.
//
// Band: pass 2 starts at hidden texels with a visible or restored 8-neighbour, and every texel it restores
// queues its hidden 8-neighbours. The closed cells meeting a connected exposed region of a UV chart are
// 8-connected. Once one of them is visible or restored, which holds whenever the region contains any texel
// centre or reaches skin the previous policy left visible, the flood reaches every other one through
// neighbours it restores. Hidden texels surrounded by centre-occluded hidden texels cost no extra rays.
// Missed: exposed pockets holding no texel centre with every surrounding texel hidden (sub-texel pinholes),
// and a silhouette corner inside a cell whose exposed wedge holds no polygon vertex.
//
// Linear sampling: a LINEAR sample at uv q equals the area of the unit square centred on q lying over hidden
// cells. When q is exposed and the hidden cells nearby lie beyond a straight silhouette, that area is below
// one half, so the fragment is kept at the base mip level too. Mipmapped minification is not covered.
export function restoreHiddenTexels({ width, height, resolution, hidden, triangleCount, triangleUv, classify }) {
  const restored = new Uint8Array(width * height), texelUv = new Float64Array(triangleCount * 6);
  const head = new Int32Array(width * height).fill(-1); // hidden texel -> triangles meeting its cell (linked list)
  let owner = new Int32Array(1 << 16), next = new Int32Array(1 << 16), links = 0;
  const link = (i, tri) => {
    if (links === owner.length) {
      const grow = array => { const out = new Int32Array(array.length * 2); out.set(array); return out; };
      owner = grow(owner); next = grow(next);
    }
    owner[links] = tri; next[links] = head[i]; head[i] = links++;
  };
  let evaluatedTexels = 0;
  for (let tri = 0; tri < triangleCount; tri++) {
    const [[ax, ay], [bx, by], [cx, cy]] = triangleUv(tri).map(([u, v]) => [u * resolution, v * resolution]);
    texelUv.set([ax, ay, bx, by, cx, cy], tri * 6);
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-8) continue;
    const wa = (px, py) => ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
    const wb = (px, py) => ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
    // Closed cells meeting the triangle: bounding box, then no edge function is negative at all four corners.
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)) - 1), x1 = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)) - 1), y1 = Math.min(height - 1, Math.floor(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (!hidden[i] || restored[i]) continue;
      const a00 = wa(x, y), a10 = wa(x + 1, y), a01 = wa(x, y + 1), a11 = wa(x + 1, y + 1);
      const b00 = wb(x, y), b10 = wb(x + 1, y), b01 = wb(x, y + 1), b11 = wb(x + 1, y + 1);
      if (Math.max(a00, a10, a01, a11) < 0 || Math.max(b00, b10, b01, b11) < 0
        || Math.min(a00 + b00, a10 + b10, a01 + b01, a11 + b11) > 1) continue;
      link(i, tri);
      const wA = wa(x + .5, y + .5), wB = wb(x + .5, y + .5), wC = 1 - wA - wB;
      if (Math.min(wA, wB, wC) < 0) continue;
      evaluatedTexels++;
      restored[i] = classify(tri, [wA, wB, wC]);
    }
  }

  const memo = new Map(), radix = Math.max(width, height) + 2;
  let footprintPoints = 0;
  // kind 0: cell corner (a, b); 1: triangle vertex a; 2..7: an edge crossing grid line a on one axis.
  const probe = (tri, kind, a, b, weights) => {
    const key = ((tri * 8 + kind) * radix + a) * radix + b;
    let code = memo.get(key);
    if (code === undefined) { memo.set(key, code = classify(tri, weights)); footprintPoints++; }
    return code;
  };
  const footprint = (tri, x, y) => {
    const o = tri * 6, u = [texelUv[o], texelUv[o + 2], texelUv[o + 4]], v = [texelUv[o + 1], texelUv[o + 3], texelUv[o + 5]];
    const den = (v[1] - v[2]) * (u[0] - u[2]) + (u[2] - u[1]) * (v[0] - v[2]);
    for (const [px, py] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
      const wa = ((v[1] - v[2]) * (px - u[2]) + (u[2] - u[1]) * (py - v[2])) / den;
      const wb = ((v[2] - v[0]) * (px - u[2]) + (u[0] - u[2]) * (py - v[2])) / den, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < 0) continue;
      const code = probe(tri, 0, px, py, [wa, wb, wc]);
      if (code) return code;
    }
    for (let j = 0; j < 3; j++) {
      if (u[j] < x || u[j] > x + 1 || v[j] < y || v[j] > y + 1) continue;
      const code = probe(tri, 1, j, 0, [+(j === 0), +(j === 1), +(j === 2)]);
      if (code) return code;
    }
    for (const [edge, j, k] of [[0, 0, 1], [1, 0, 2], [2, 1, 2]]) for (const axis of [0, 1]) {
      const along = axis ? v : u, across = axis ? u : v, low = axis ? y : x, span = axis ? x : y;
      for (const line of [low, low + 1]) {
        if (along[j] === along[k] || (along[j] - line) * (along[k] - line) > 0) continue;
        const t = (line - along[j]) / (along[k] - along[j]), at = across[j] + t * (across[k] - across[j]);
        if (at < span || at > span + 1) continue;
        const w = [0, 0, 0]; w[j] = 1 - t; w[k] = t;
        const code = probe(tri, 2 + edge * 2 + axis, line, 0, w);
        if (code) return code;
      }
    }
    return OCCLUDED;
  };

  const pending = i => hidden[i] && !restored[i];
  const around = (i, visit) => { // 8-neighbours inside the image; stops when visit returns true
    const x = i % width, y = (i - x) / width;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++)
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++)
        if ((nx !== x || ny !== y) && visit(ny * width + nx)) return true;
    return false;
  };
  const queued = new Uint8Array(width * height), queue = [];
  for (let i = 0; i < restored.length; i++)
    if (pending(i) && around(i, n => !pending(n))) { queued[i] = 1; queue.push(i); }
  const footprintSeedTexels = queue.length;
  let footprintEvaluatedTexels = 0;
  while (queue.length) {
    const i = queue.pop(), x = i % width, y = (i - x) / width;
    footprintEvaluatedTexels++;
    let code = OCCLUDED;
    for (let l = head[i]; l >= 0 && !code; l = next[l]) code = footprint(owner[l], x, y);
    if (!code) continue;
    restored[i] = code | FOOTPRINT_VISIBLE;
    around(i, n => { if (pending(n) && !queued[n]) { queued[n] = 1; queue.push(n); } });
  }

  let normalRestored = 0, obliqueRestored = 0, footprintRestored = 0;
  for (const code of restored) {
    if ((code & 3) === NORMAL_VISIBLE) normalRestored++; else if ((code & 3) === OBLIQUE_VISIBLE) obliqueRestored++;
    if (code & FOOTPRINT_VISIBLE) footprintRestored++;
  }
  return { restored, evaluatedTexels, normalRestored, obliqueRestored,
    footprintSeedTexels, footprintEvaluatedTexels, footprintPoints, footprintRestored };
}

// previous: final existing-policy mask (A and idle intersection, 0/255). restoredByPose: restored arrays
// from restoreHiddenTexels. The candidate hides a texel only if the previous mask hid it and no pose restored
// it, so it is a subset by construction. diagnostic is RGBA: R restored because a normal ray was
// unobstructed in some pose, G restored by an oblique view in some pose, B 255 still hidden,
// B 128 restored only through texel footprint vertices (no pose restored its centre).
export function combineCandidate(previous, restoredByPose) {
  const pixels = new Uint8Array(previous.length), diagnostic = new Uint8ClampedArray(previous.length * 4);
  let previousPixels = 0, candidatePixels = 0, normalRestoredPixels = 0, obliqueRestoredPixels = 0, footprintOnlyRestoredPixels = 0;
  for (let i = 0; i < previous.length; i++) {
    diagnostic[i * 4 + 3] = 255;
    if (!previous[i]) continue;
    previousPixels++;
    let normal = false, oblique = false, centre = false;
    for (const restored of restoredByPose) {
      const code = restored[i];
      normal ||= (code & 3) === NORMAL_VISIBLE; oblique ||= (code & 3) === OBLIQUE_VISIBLE;
      centre ||= code !== OCCLUDED && !(code & FOOTPRINT_VISIBLE);
    }
    if (normal) { diagnostic[i * 4] = 255; normalRestoredPixels++; }
    if (oblique) { diagnostic[i * 4 + 1] = 255; if (!normal) obliqueRestoredPixels++; }
    if (normal || oblique) { if (!centre) { diagnostic[i * 4 + 2] = 128; footprintOnlyRestoredPixels++; } continue; }
    pixels[i] = 255; diagnostic[i * 4 + 2] = 255; candidatePixels++;
  }
  return { pixels, diagnostic, previousPixels, candidatePixels, restoredPixels: previousPixels - candidatePixels,
    normalRestoredPixels, obliqueOnlyRestoredPixels: obliqueRestoredPixels, footprintOnlyRestoredPixels };
}
