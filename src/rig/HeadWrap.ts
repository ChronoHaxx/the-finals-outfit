// Head-component wrap: a customization part wrapped by the head (WrapDeformation.bIsWrapDeformed and
// bIsWrapDeformedByHeadComponent) follows the worn head. In the source each such part carries a cloth proxy whose
// vertices lie on the HeadMaster head's *_Wraps cage, and every face names its own cage with the same topology; the
// engine drives the proxy with the worn head's cage and the render mesh follows it (cloth mesh-to-mesh deformer).
// scripts/shader-probe/build-head-wraps.py writes those cages and proxies (head-wraps.json, converted GLB frame).
//
// Here each rest vertex binds to its nearest proxy triangle: the closest point's barycentric weights plus the
// remaining offset in that triangle's orthonormal frame. Evaluated on the reference cage this reproduces every
// vertex exactly; on a face's cage the vertex moves with its triangle. At rest here; while a clip animates the face,
// FaceWrap.ts moves the cage with the face's bones and the part is wrapped again on it (12 Nov 2026).
//
// The worn cage carries the head's own morph targets by name (default_ears/chin/nose/brows/face, head_neck_match),
// published as sparse deltas over reference vertices. The cage takes the same fitting morphs as the head (12 Oct
// 2026): with default_ears every face's cage ears converge to the head's width, and a cage left at rest let the
// morphed ears through tight balaclavas on narrow-eared faces (_docs/goal-100-2026-10-11/tight-headwear/). The
// HeadMaster reference stays at rest: the proxy is authored there.

export interface HeadWrapData {
  formatVersion: 1;
  contract: "finals-head-component-wrap-v1";
  reference: { source: string; positions: number[]; triangles: number[] };
  cages: Record<string, { positions: number[]; morphs?: Record<string, HeadWrapMorph> }>;
  heads: Record<string, string>;
  meshes: Record<string, { triangles: number[] }>;
}

export interface HeadWrapMorph { vertices: number[]; deltas: number[] }

export interface HeadWrapBinding { triangle: Uint32Array; weights: Float32Array; offset: Float32Array }

const pending = new Map<string, Promise<HeadWrapData | undefined>>();

/** The release's head wraps, or undefined when the release publishes none (head-wrapped parts then refuse). */
export function loadHeadWraps(baseUrl: string): Promise<HeadWrapData | undefined> {
  const url = `${baseUrl}/head-wraps.json`;
  let request = pending.get(url);
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Head wrap data request failed (${response.status})`);
      let data: HeadWrapData;
      try { data = await response.json(); } catch { return undefined; } // an SPA fallback page: no file published
      if (data?.formatVersion !== 1 || data.contract !== "finals-head-component-wrap-v1" || !data.reference
        || !data.cages || !data.heads || !data.meshes) throw new Error("Invalid head wrap data");
      return data;
    })();
    request.catch(() => pending.delete(url));
    pending.set(url, request);
  }
  return request;
}

/** The cage the worn head drives a part with, morphed by the head's active fitting morphs (names the cage does not
 *  carry are ignored, as on the head), or an error naming what is missing. */
export function headWrapInputs(data: HeadWrapData, mesh: string, head: string | undefined, morphs: Iterable<string> = []) {
  const proxy = data.meshes[mesh];
  if (!proxy) throw new Error(`No head wrap proxy for ${mesh}`);
  if (!head) throw new Error("A head-wrapped part requires a preserved source head");
  const cageSource = data.heads[head];
  const cage = cageSource ? data.cages[cageSource] : undefined;
  if (!cage) throw new Error(`No head wrap cage for ${head}`);
  const n = data.reference.positions.length;
  if (cage.positions.length !== n || n % 3 || proxy.triangles.length % 3
    || proxy.triangles.some(i => !Number.isInteger(i) || i < 0 || i * 3 >= n)) throw new Error("Invalid head wrap cage");
  const active = [...new Set(morphs)].filter(name => Object.hasOwn(cage.morphs ?? {}, name)).sort();
  let target: number[] = cage.positions;
  if (active.length) {
    target = cage.positions.slice();
    for (const name of active) {
      const { vertices, deltas } = cage.morphs![name];
      if (!Array.isArray(vertices) || !Array.isArray(deltas) || deltas.length !== vertices.length * 3
        || vertices.some(i => !Number.isInteger(i) || i < 0 || i * 3 >= n)) throw new Error(`Invalid head wrap morph ${name}`);
      vertices.forEach((v, k) => { for (let j = 0; j < 3; j++) target[v * 3 + j] += deltas[k * 3 + j]; });
    }
  }
  return { reference: data.reference.positions, target, triangles: proxy.triangles, morphs: active };
}

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const at = (p: ArrayLike<number>, i: number): Vec => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];

/** Orthonormal frame of one triangle: first edge, in-plane normal, face normal. */
function frame(cage: ArrayLike<number>, triangles: ArrayLike<number>, t: number): [Vec, Vec, Vec, Vec, Vec, Vec] {
  const a = at(cage, triangles[t * 3]), b = at(cage, triangles[t * 3 + 1]), c = at(cage, triangles[t * 3 + 2]);
  const e1 = unit(sub(b, a)), n = unit(cross(sub(b, a), sub(c, a))), e2 = cross(n, e1);
  return [a, b, c, e1, e2, n];
}

/** Closest point on triangle abc to p, as barycentric weights (Ericson, Real-Time Collision Detection 5.1.5). */
function closest(p: Vec, a: Vec, b: Vec, c: Vec): Vec {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return [1 - v - w, v, w];
}

const blend = (w: Vec, a: Vec, b: Vec, c: Vec): Vec =>
  [w[0] * a[0] + w[1] * b[0] + w[2] * c[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1], w[0] * a[2] + w[1] * b[2] + w[2] * c[2]];

/** Bind rest positions (xyz triples) to the nearest proxy triangle of the reference cage. */
export function bindHeadWrap(positions: ArrayLike<number>, reference: ArrayLike<number>, triangles: ArrayLike<number>): HeadWrapBinding {
  const count = positions.length / 3, tris = triangles.length / 3;
  const frames = Array.from({ length: tris }, (_, t) => frame(reference, triangles, t));
  const centres = frames.map(([a, b, c]) => blend([1 / 3, 1 / 3, 1 / 3], a, b, c));
  const triangle = new Uint32Array(count), weights = new Float32Array(count * 3), offset = new Float32Array(count * 3);
  const nearest: { t: number; d: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = at(positions, i);
    // Exact point-triangle distance over the few triangles with the nearest centres.
    nearest.length = 0;
    for (let t = 0; t < tris; t++) {
      const q = sub(p, centres[t]), d = dot(q, q);
      if (nearest.length < 8) { nearest.push({ t, d }); nearest.sort((x, y) => x.d - y.d); }
      else if (d < nearest[7].d) { nearest[7] = { t, d }; nearest.sort((x, y) => x.d - y.d); }
    }
    let best = -1, bestD = Infinity, bestW: Vec = [1, 0, 0];
    for (const { t } of nearest) {
      const [a, b, c] = frames[t], w = closest(p, a, b, c), q = sub(p, blend(w, a, b, c)), d = dot(q, q);
      if (d < bestD) { bestD = d; best = t; bestW = w; }
    }
    const [a, b, c, e1, e2, n] = frames[best], r = sub(p, blend(bestW, a, b, c));
    triangle[i] = best;
    weights.set(bestW, i * 3);
    offset.set([dot(r, e1), dot(r, e2), dot(r, n)], i * 3);
  }
  return { triangle, weights, offset };
}

/** Every triangle's frame (frame()) packed as a, b, c, e1, e2, n: 18 numbers per triangle. */
function frames(cage: ArrayLike<number>, triangles: ArrayLike<number>): Float64Array {
  const tris = triangles.length / 3, out = new Float64Array(tris * 18);
  for (let t = 0; t < tris; t++) {
    const [a, b, c, e1, e2, n] = frame(cage, triangles, t);
    out.set(a, t * 18); out.set(b, t * 18 + 3); out.set(c, t * 18 + 6);
    out.set(e1, t * 18 + 9); out.set(e2, t * 18 + 12); out.set(n, t * 18 + 15);
  }
  return out;
}

/** Rest positions (and optionally normals/tangents, rotated with their triangle) on the target cage.
 *  (12 Nov 2026) Allocation-free per vertex: the facial animation re-wraps beards (37k vertices) every frame. The
 *  arithmetic is the earlier per-vertex tuple code's, operation for operation, so the result is bit-identical
 *  (tests/rig/face-animator.test.ts compares it with that code). */
export function applyHeadWrap(binding: HeadWrapBinding, target: ArrayLike<number>, reference: ArrayLike<number>,
  triangles: ArrayLike<number>, positions: Float32Array | number[], directions: (Float32Array | number[])[] = [],
  stride: number[] = []): void {
  const after = frames(target, triangles), before = frames(reference, triangles);
  const { triangle, weights, offset } = binding, count = triangle.length;
  for (let i = 0; i < count; i++) {
    const f = triangle[i] * 18, w0 = weights[i * 3], w1 = weights[i * 3 + 1], w2 = weights[i * 3 + 2];
    const k0 = offset[i * 3], k1 = offset[i * 3 + 1], k2 = offset[i * 3 + 2];
    for (let j = 0; j < 3; j++) {
      // blend(w, a, b, c) + k0 e1 + k1 e2 + k2 n, left to right as before
      const o = w0 * after[f + j] + w1 * after[f + 3 + j] + w2 * after[f + 6 + j];
      positions[i * 3 + j] = o + k0 * after[f + 9 + j] + k1 * after[f + 12 + j] + k2 * after[f + 15 + j];
    }
    for (let index = 0; index < directions.length; index++) {
      const v = directions[index], s = stride[index] ?? 3, p = i * s;
      const d0 = v[p], d1 = v[p + 1], d2 = v[p + 2];
      // local = (d . f1, d . f2, d . fn) in the reference frame, then rebuilt in the target frame
      const l0 = d0 * before[f + 9] + d1 * before[f + 10] + d2 * before[f + 11];
      const l1 = d0 * before[f + 12] + d1 * before[f + 13] + d2 * before[f + 14];
      const l2 = d0 * before[f + 15] + d1 * before[f + 16] + d2 * before[f + 17];
      for (let j = 0; j < 3; j++) v[p + j] = l0 * after[f + 9 + j] + l1 * after[f + 12 + j] + l2 * after[f + 15 + j];
    }
  }
}
