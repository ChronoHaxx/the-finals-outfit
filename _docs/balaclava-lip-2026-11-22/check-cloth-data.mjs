// Offline check of a head-wrapped part's cloth data (22 Nov 2026, balaclava lip; README.md beside this file).
// Reads what `AnimExport mesh` and `AnimExport json` dumped from the installed game's paks (read-only) and the face cage
// skin the viewer publishes, and reports:
//   1. the cloth proxy's own skin (PhysicalMeshData.BoneData) against the cage skin the viewer drives the proxy with;
//   2. the proxy around the mouth: which lip bones its vertices follow, and the triangles on the lower-lip centre;
//   3. the engine's own render-vertex binding (ClothMappingDataLODs): how it reproduces the render mesh, and how its
//      triangle choice compares with the closest-point rule the viewer's HeadWrap.ts uses.
//
// Usage (worktree root, Git Bash or PowerShell):
//   node _docs/balaclava-lip-2026-11-22/check-cloth-data.mjs \
//     --mesh <AnimExport mesh dump, path without .mesh.json> --package <AnimExport json dump of the same mesh> \
//     --cage-skin <faces wraps/SK_Head_HeadMaster_Base_Wraps.json, path or URL> [--out <report.json>]
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) =>
  a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["mesh", "package", "cage-skin"]) if (!args[required]) throw new Error(`--${required} is required`);
const json = async (p) => /^https?:/.test(p) ? (await fetch(p)).json() : JSON.parse(readFileSync(p, "utf8"));

// --- Inputs ---------------------------------------------------------------------------------------------------------
const header = JSON.parse(readFileSync(`${args.mesh}.mesh.json`, "utf8")), bin = readFileSync(`${args.mesh}.mesh.bin`);
const cloth = JSON.parse(readFileSync(`${args.mesh}.cloth.json`, "utf8"));
const array = (name) => { const a = header.arrays.find(x => x.name === name); return new Float32Array(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes)); };
const position = array("position");
const exports = await json(args.package);
const asset = exports.find(e => e.Type === "ClothingAssetCommon")?.Properties;
if (!asset) throw new Error("no ClothingAssetCommon in the package dump");
const lod = asset.LODData[0], pm = lod.PhysicalMeshData, used = asset.UsedBoneNames;
const embark = exports.find(e => e.Type === "EmbarkClothConfig")?.Properties ?? null;
const PV = pm.Vertices.map(v => [v.X, v.Y, v.Z]), tris = [];
for (let t = 0; t < pm.Indices.length; t += 3) tris.push([pm.Indices[t], pm.Indices[t + 1], pm.Indices[t + 2]]);
const cage = await json(args["cage-skin"]);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const report = { mesh: header.path, renderVertices: header.vertexCount, proxy: { vertices: PV.length, triangles: tris.length },
  clothLod: { bUseMultipleInfluences: lod.bUseMultipleInfluences, bSmoothTransition: lod.bSmoothTransition }, embark };

// --- 1. Proxy skin vs the cage skin ------------------------------------------------------------------------------------
// The published cage is in the GLB frame (metres, Y/Z swapped); the proxy in UE's (cm).
const cagePos = cage.positions, width = cage.influences ?? 4;
const proxyToCage = PV.map(v => {
  const p = [v[0] * 0.01, v[2] * 0.01, v[1] * 0.01];
  let best = Infinity, at = -1;
  for (let i = 0; i < cagePos.length / 3; i++) { const d = Math.hypot(cagePos[i * 3] - p[0], cagePos[i * 3 + 1] - p[1], cagePos[i * 3 + 2] - p[2]); if (d < best) { best = d; at = i; } }
  return { at, mm: best * 1000 };
});
const proxySkin = (k) => { const b = pm.BoneData[k], out = {};
  for (let j = 0; j < b.NumInfluences; j++) { const name = used[b[j ? `BoneIndices[${j}]` : "BoneIndices"] ?? 0]; out[name] = (out[name] ?? 0) + (b[j ? `BoneWeights[${j}]` : "BoneWeights"] ?? 0); }
  return out; };
const cageSkin = (v) => { const out = {};
  for (let k = 0; k < width; k++) { const w = cage.weights[v * width + k]; if (w > 0) { const name = cage.bones[cage.joints[v * width + k]]; out[name] = (out[name] ?? 0) + w; } }
  return out; };
let worstL1 = 0;
PV.forEach((_, k) => {
  const a = proxySkin(k), b = cageSkin(proxyToCage[k].at);
  let l1 = 0; for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) l1 += Math.abs((a[n] ?? 0) - (b[n] ?? 0));
  worstL1 = Math.max(worstL1, l1);
});
report.skin = { proxyOnCageWorstMm: +Math.max(...proxyToCage.map(x => x.mm)).toFixed(4), worstWeightL1: +worstL1.toFixed(3) };

// --- 2. The mouth ---------------------------------------------------------------------------------------------------
const top = (skin) => Object.entries(skin).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, w]) => `${n}:${w.toFixed(2)}`).join(" ");
const upperLip = PV.map((_, k) => k).filter(k => Object.keys(proxySkin(k)).some(n => /LipUpper/i.test(n) && proxySkin(k)[n] > 0.05));
const lowerCentre = PV.map((_, k) => k).find(k => (proxySkin(k).FACIAL_C_LipLower1 ?? 0) > 0.4);
report.mouth = {
  upperLipVertices: upperLip.map(k => ({ k, skin: top(proxySkin(k)) })),
  lowerLipCentre: lowerCentre === undefined ? null : { k: lowerCentre, skin: top(proxySkin(lowerCentre)),
    triangles: tris.filter(t => t.includes(lowerCentre)).map(t => t.map(k => `${k}(${top(proxySkin(k)).split(" ")[0]})`).join(" ")) },
};

// --- 3. The engine's binding ----------------------------------------------------------------------------------------
// Vertex normals: the normalised sum of the unit normals of the proxy triangles around each vertex.
const N = PV.map(() => [0, 0, 0]);
for (const [a, b, c] of tris) { const u = unit(cross(sub(PV[b], PV[a]), sub(PV[c], PV[a]))); for (const v of [a, b, c]) for (let j = 0; j < 3; j++) N[v][j] += u[j]; }
for (let i = 0; i < N.length; i++) N[i] = unit(N[i]);
const renderAt = (v) => [position[v * 3], position[v * 3 + 1], position[v * 3 + 2]];
const evaluate = (bd, idx) => [0, 1, 2].map(j => bd[0] * (PV[idx[0]][j] + N[idx[0]][j] * bd[3]) + bd[1] * (PV[idx[1]][j] + N[idx[1]][j] * bd[3]) + bd[2] * (PV[idx[2]][j] + N[idx[2]][j] * bd[3]));
// p = sum_k w_k (P_k + d N_k): p lies on the triangle offset by d along its normals (a cubic in d); smallest |d| root.
function project(p, t) {
  const [A, B, C] = t.map(i => PV[i]), [NA, NB, NC] = t.map(i => N[i]);
  const f = d => { const a = add(A, NA, d), b = add(B, NB, d), c = add(C, NC, d); return dot(cross(sub(b, a), sub(c, a)), sub(p, a)); };
  const roots = []; let pd = -50, pf = f(pd);
  for (let s = 1; s <= 4000; s++) { const d = -50 + s * 0.025, fd = f(d);
    if (pf * fd < 0) { let lo = pd, hi = d, fl = pf; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, fm = f(m); if (fl * fm <= 0) hi = m; else { lo = m; fl = fm; } } roots.push((lo + hi) / 2); }
    pd = d; pf = fd; }
  const d = roots.reduce((m, r) => Math.abs(r) < Math.abs(m) ? r : m, Infinity);
  const a = add(A, NA, d), b = add(B, NB, d), c = add(C, NC, d), n = cross(sub(b, a), sub(c, a)), nn = dot(n, n);
  const w1 = dot(cross(sub(p, a), sub(c, a)), n) / nn, w2 = dot(cross(sub(b, a), sub(p, a)), n) / nn;
  return [1 - w1 - w2, w1, w2, d];
}
function closestPoint(p, a, b, c) { // Ericson 5.1.5, as HeadWrap.ts
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc); return add(add(a, ab, vb * den), ac, vc * den);
}
const key = t => [...t].sort((x, y) => x - y).join("-");
let count = 0, sumErr = 0, worstErr = 0, planeWorst = 0, solveWorst = 0, same = 0, ties = 0, other = 0, outside = 0;
for (const s of cloth.sections) s.mapping.forEach((m, k) => {
  const v = s.baseVertex + k, p = renderAt(v), t = m.i.slice(0, 3); count++;
  const e = Math.hypot(...sub(evaluate(m.p, t), p)); sumErr += e; worstErr = Math.max(worstErr, e);
  if (Math.min(m.p[0], m.p[1], m.p[2]) < -1e-4) outside++;
  const [A, B, C] = t.map(i => PV[i]), fn = unit(cross(sub(B, A), sub(C, A))), d = dot(sub(p, A), fn); // plane projection
  planeWorst = Math.max(planeWorst, Math.hypot(...sub(sub(p, [0, 1, 2].map(j => m.p[0] * A[j] + m.p[1] * B[j] + m.p[2] * C[j])), fn.map(x => x * d))));
  const mine = project(p, t); solveWorst = Math.max(solveWorst, ...[0, 1, 2, 3].map(j => Math.abs(mine[j] - m.p[j])));
  const dist = tris.map(tri => Math.hypot(...sub(p, closestPoint(p, ...tri.map(i => PV[i]))))), min = Math.min(...dist);
  const game = dist[tris.findIndex(tri => key(tri) === key(t))];
  if (key(tris[dist.indexOf(min)]) === key(t)) same++; else if (game - min < 1e-5) ties++; else other++;
});
report.binding = {
  renderVerticesMapped: count, sections: cloth.sections.map(s => ({ section: s.section, vertices: s.numVertices, mapping: s.mapping.length })),
  reproducedWithSmoothNormals: { meanCm: +(sumErr / count).toExponential(2), worstCm: +worstErr.toExponential(2) },
  planeProjectionWorstCm: +planeWorst.toFixed(4),
  ownSolveOnGameTriangleWorst: +solveWorst.toExponential(2),
  weightsOutsideTriangle: outside,
  triangleChoice: { closestPointSame: same, closestPointTiesOtherOrder: ties, different: other },
};
console.log(JSON.stringify(report, null, 1));
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
