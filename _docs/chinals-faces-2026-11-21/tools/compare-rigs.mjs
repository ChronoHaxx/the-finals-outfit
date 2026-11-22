#!/usr/bin/env node
// Does the Chinals face rig match the global one the site drives? (21 Nov 2026)
//
// The Chinals emotes play on GLOBAL heads (Chinals mode has no Chinals cosmetics), so their Face_* curves weight the
// GLOBAL PoseAssets. That reproduces the Chinals game only if each Chinals PoseAsset equals the same-named global one
// and the heads' FACIAL bones rest where the global heads' do.
//
// The Chinals head data assets have no FaceRigPoseAsset field (UE 5.3 build): each head instead runs its own AnimBP,
// MABP_Head_Face_NN_Base, whose PoseBlendNode names the pose asset. Global moved that choice onto the data asset and
// shares one AnimBP. So this script gives build-face.mjs a synthetic data asset per head carrying GLOBAL's head -> pose
// mapping, which makes it convert the Chinals PoseAssets and head skeletons with exactly the code that built the live
// files, then compares the result with the live global faces set file by file.
//
// Usage (worktree root, any shell with Node):
//   node _docs/chinals-faces-2026-11-21/tools/compare-rigs.mjs --global <global faces dir> --json <Chinals json dir>
//     --refs <Chinals head refs run> --run <Chinals clip run> --manifest <Chinals manifest> --work <new dir>
// Writes <work>/head-map/, <work>/chinals-rig-faces/ (build-face output) and <work>/compare.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const k of ["global", "json", "refs", "run", "manifest", "work"]) if (!args[k]) throw new Error(`--${k} is required`);
const work = resolve(args.work);
if (existsSync(work)) throw new Error(`${work} exists; runs are kept`);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const globalDir = resolve(args.global);
const globalIndex = read(join(globalDir, "faces.json"));

// --- Global's head -> pose mapping as synthetic data assets ------------------------------------------------------------
// Only heads whose global pose asset also exists in the Chinals build (Face 24's and Face 32's are newer).
const chinalsPoses = new Set();
const walk = dir => { for (const n of readdirSync(dir, { withFileTypes: true })) n.isDirectory() ? walk(join(dir, n.name))
  : n.name.endsWith("PoseAsset.json") && chinalsPoses.add(n.name.replace(/\.json$/, "")); };
walk(resolve(args.json));
mkdirSync(join(work, "head-map"), { recursive: true });
const skippedHeads = [];
const entries = Object.entries(globalIndex.heads).flatMap(([mesh, file]) => {
  const pose = read(join(globalDir, file)).pose.replace(/^poses\//, "").replace(/\.json$/, "");
  if (!chinalsPoses.has(pose)) { skippedHeads.push(`${mesh} (${pose} is not in the Chinals build)`); return []; }
  return { Type: "CharacterCustomizationItem", Name: `GlobalMapping_${mesh}`, Properties: {
    FaceRigPoseAsset: { AssetPathName: `/Game/GlobalMapping/${pose}.${pose}` },
    VisualParts: [{ bIsHeadMesh: true, SkeletalMesh: { AssetPathName: `/Game/GlobalMapping/${mesh}.${mesh}` } }] } };
});
writeFileSync(join(work, "head-map", "DA_Head_GlobalMapping.json"), JSON.stringify(entries, null, 1));

const built = join(work, "chinals-rig-faces");
execFileSync(process.execPath, ["scripts/anim-export/build-face.mjs", "--json", `${resolve(args.json)},${join(work, "head-map")}`,
  "--refs", resolve(args.refs), "--run", resolve(args.run), "--manifest", resolve(args.manifest), "--out", built],
  { stdio: ["ignore", "ignore", "inherit"] });

// --- Compare ---------------------------------------------------------------------------------------------------------
// Degrees between two unit quaternions (sign-agnostic). Not 2·acos(a·b): acos is ill-conditioned near 1, so the files'
// 6-decimal rounding alone would read as ~0.17 degrees. With a·b >= 0, |a-b| = 2 sin(phi/2) and |a+b| = 2 cos(phi/2) for
// the 4D angle phi, and the rotation angle is 2 phi = 4 atan2(|a-b|, |a+b|).
const angle = (a, b) => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const minus = Math.hypot(...a.map((v, i) => v - s * b[i])), plus = Math.hypot(...a.map((v, i) => v + s * b[i]));
  return 4 * Math.atan2(minus, plus) * 180 / Math.PI;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const report = { poses: {}, heads: {}, skippedHeads, missingInChinals: [] };
for (const file of readdirSync(join(globalDir, "poses"))) {
  const g = read(join(globalDir, "poses", file));
  if (!existsSync(join(built, "poses", file))) { report.missingInChinals.push(`poses/${file}`); continue; }
  const c = read(join(built, "poses", file));
  const r = { poseNamesEqual: JSON.stringify(g.poses) === JSON.stringify(c.poses), globalOnlyPoses: g.poses.filter(p => !c.poses.includes(p)),
    chinalsOnlyPoses: c.poses.filter(p => !g.poses.includes(p)), bones: [g.bones.length, c.bones.length],
    deltas: [0, 0], onlyGlobal: 0, onlyChinals: 0, maxDegrees: 0, maxCm: 0, worst: "" };
  for (const [gp, name] of g.poses.entries()) {
    const cp = c.poses.indexOf(name);
    const rows = (pose, data) => new Map((pose < 0 ? [] : data.deltas[pose]).map(row => [data.bones[row[0]], row]));
    const gr = rows(gp, g), cr = rows(cp, c);
    r.deltas[0] += gr.size; r.deltas[1] += cr.size;
    for (const [bone, row] of gr) {
      const other = cr.get(bone);
      if (!other) { r.onlyGlobal++; continue; }
      const deg = angle(row.slice(1, 5), other.slice(1, 5)), cm = dist(row.slice(5, 8), other.slice(5, 8));
      if (deg > r.maxDegrees) { r.maxDegrees = deg; r.worst = `${name} ${bone} ${deg.toFixed(4)} deg`; }
      r.maxCm = Math.max(r.maxCm, cm);
    }
    for (const bone of cr.keys()) if (!gr.has(bone)) r.onlyChinals++;
  }
  r.maxDegrees = +r.maxDegrees.toFixed(5); r.maxCm = +r.maxCm.toFixed(5);
  report.poses[file.replace(/\.json$/, "")] = r;
}
for (const [mesh, file] of Object.entries(globalIndex.heads)) {
  const g = read(join(globalDir, file));
  if (!existsSync(join(built, file))) { report.missingInChinals.push(file); continue; }
  const c = read(join(built, file));
  let maxCm = 0, maxDegrees = 0, parentDiffers = 0, onlyGlobal = 0;
  for (const [bone, gr] of Object.entries(g.ref)) {
    const cr = c.ref[bone];
    if (!cr) { onlyGlobal++; continue; }
    if (cr[0] !== gr[0]) parentDiffers++;
    maxCm = Math.max(maxCm, dist(gr.slice(1, 4), cr.slice(1, 4)));
    maxDegrees = Math.max(maxDegrees, angle(gr.slice(4, 8), cr.slice(4, 8)));
  }
  report.heads[mesh] = { pose: g.pose === c.pose ? g.pose : `${g.pose} vs ${c.pose}`, bones: Object.keys(g.ref).length,
    onlyGlobal, parentDiffers, maxCm: +maxCm.toFixed(5), maxDegrees: +maxDegrees.toFixed(5) };
}
const builtIndex = read(join(built, "faces.json"));
report.curves = { withCurves: builtIndex.report.withCurves, withoutCurves: builtIndex.report.withoutCurves,
  unmatchedCurves: builtIndex.report.unmatchedCurves };
writeFileSync(join(work, "compare.json"), JSON.stringify(report, null, 2));
const poses = Object.values(report.poses), heads = Object.values(report.heads);
console.log(JSON.stringify({
  poseAssets: poses.length, poseNamesAllEqual: poses.every(p => p.poseNamesEqual),
  maxPoseDegrees: Math.max(...poses.map(p => p.maxDegrees)), maxPoseCm: Math.max(...poses.map(p => p.maxCm)),
  bonesOnlyInOne: poses.reduce((n, p) => n + p.onlyGlobal + p.onlyChinals, 0),
  heads: heads.length, maxHeadCm: Math.max(...heads.map(h => h.maxCm)), maxHeadDegrees: Math.max(...heads.map(h => h.maxDegrees)),
  headParentsDiffer: heads.reduce((n, h) => n + h.parentDiffers, 0), skippedHeads, missingInChinals: report.missingInChinals,
  curves: report.curves,
}, null, 2));
