#!/usr/bin/env node
// Facial animation data (12 Nov 2026): the game's own face poses and the clips' facial curves, for src/rig/FaceAnimator.ts.
//
// How THE FINALS animates a face (read from the cooked assets, Season 12):
//  * The body clips (outfit idles, emotes) carry float curves named after face poses: Face_Blink, Face_LookLeft,
//    Face_JawOpen, Face_Happy... 189 of the 190 clip files animate them. They are just numbers over time; nothing in the
//    body skeleton moves because of them.
//  * Every head mesh (SK_Head_Face_NN_Base) runs a post-process AnimBlueprint, MABP_Head_Headmaster: copy the body's
//    pose AND curves (CopyPoseFromMesh), then a PoseBlendNode turns each curve into the weight of the same-named pose in
//    the head's PoseAsset, inside a "FacialAnimation" layer that a distance LOD switches off far from the camera (the
//    face only animates up close). Which PoseAsset is the head data asset's FaceRigPoseAsset (Face 18/21/22 reuse Face
//    15's, CNS reuses Face 08's, ...).
//  * The PoseAsset is ADDITIVE: each pose stores, per FACIAL_* bone, a local-space delta from the reference pose
//    (rotation, translation; scale stored as 0 = unchanged). Blink rotates the eyelid bones about 40 degrees; LookLeft
//    turns both eye bones; JawOpen drops the jaw and stretches the lips. The heads have no expression morph targets:
//    the face is moved by its ~300 FACIAL_* bones alone.
//
// This script writes, for an animations deployment (beside the clip set and props), a faces-N/ directory:
//  * poses/<PoseAsset>.json: per pose, the sparse FACIAL_* deltas in UE's own convention (cm, left-handed, bone-local).
//    The runtime converts them per bone, because the two head routes store bone axes differently (see FaceAnimator.ts).
//    Non-FACIAL tracks are dropped (they are capture noise on legs; the head component could not move the body anyway);
//    the largest dropped delta is reported.
//  * heads/<SK mesh>.json: which pose file the head uses, and the head's UE reference local of every driven bone, so the
//    runtime can check that the bones it drives really are those bones in the convention it assumes (else it leaves that
//    head still rather than distort it).
//  * curves/<clip source>.json: the clip's face curves, clamped to [0, 1] as the game's PoseBlendNode does (a Linear
//    alpha blend option clamps; negative look values do nothing), key-reduced (linear, 0.002), all-zero curves dropped,
//    names in the PoseAsset's spelling (UE FNames compare case-insensitively; misspelled curves such as Face_Suprise and
//    the cinematic Face_Cin_Pose_* match no pose and are dropped, as in the game).
//  * wraps/<cage>.json: each head wrap cage's skin (head-wrapped beards and balaclavas follow it; FaceWrap.ts).
//  * masks/<BWA>.json: the face masks items apply. An item whose definition sets bMaskOutFacialAnimation names a bone
//    weights asset (FaceAnimationWeights) that the head AnimBlueprint feeds to the FacialAnimation layer's dynamic bone
//    weights (Angelscript FacialAnimationMask): per FACIAL bone, how much of its facial motion survives (rotation and
//    translation weights). Helmets keep only the eyes (EyesOnly), a balaclava halves the lips and jaw (FaceMask).
//  * faces.json: the index (heads by mesh name, clip sources with curves, cage skins and masks by source path).
//
// Inputs (all offline, from scripts/anim-export runs; nothing touches the running game):
//   --json <dir>[,<dir>...]  AnimExport json-mode output holding the PoseAssets and head data assets (DA_*)
//   --refs <dir>             AnimExport export run whose requests listed the head meshes (mesh-SK_*.json)
//   --run <dir>              AnimExport export run of the clip sequences (anims/*.json with faceCurveValues)
//   --manifest <file>        the animations manifest the faces go with (only its clip sources get curve files)
//   --wraps <file> --cages <dir>  optional: the published head-wraps.json and AnimExport mesh-mode dumps of its cages
//   --masks <dir>            optional: AnimExport json-mode output holding the BWA_FaceJoints_* bone weights assets
//   --out <dir>              new directory (each run is kept); --activate adds `faces` to <out>/../manifest.json
// Usage (Git Bash or PowerShell, worktree root):
//   node scripts/anim-export/build-face.mjs --json scripts/generated/face-anim/json-2,scripts/generated/face-anim/json-3 \
//     --refs scripts/generated/face-anim/heads-ref --run scripts/generated/face-anim/run-1 \
//     --manifest public/animations/manifest.json --wraps scripts/generated/face-anim/head-wraps-c062af24.json \
//     --cages scripts/generated/face-anim/cages-all --masks scripts/generated/face-anim/json-bwa \
//     --out public/animations/faces-1 --activate
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1]]] : pairs, []));
for (const required of ["json", "refs", "run", "manifest", "out"]) if (!args[required]) throw new Error(`--${required} is required`);
const out = resolve(args.out);
if (existsSync(out)) throw new Error(`Output ${out} already exists; choose a new faces directory (runs are kept)`);

const ROT_EPS = 0.005, POS_EPS = 0.0005, SCALE_EPS = 1e-5; // degrees, cm: below this a pose leaves the bone alone
const CURVE_TOL = 0.002;
const round = (v, d) => +v.toFixed(d) || 0; // no "-0"

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path); else if (name.endsWith(".json")) yield path;
  }
}
const assetName = path => path?.split(/[./]/).filter(Boolean).at(-1) ?? null; // "/Game/.../X.X" -> "X"

// --- Head data assets: head mesh -> FaceRigPoseAsset ------------------------------------------------------------------
const poseAssets = new Map(); // name -> PoseContainer + path
const heads = new Map(); // SK mesh name -> { pose, da }
for (const dir of String(args.json).split(",")) for (const file of walk(resolve(dir))) {
  const name = basename(file, ".json");
  if (!/PoseAsset$/.test(name) && !/^DA_(Head|Heads|CNS)_/.test(name)) continue;
  for (const e of JSON.parse(readFileSync(file, "utf8"))) {
    if (e.Type === "PoseAsset") {
      if (!e.Properties?.bAdditivePose) throw new Error(`${e.Name} is not additive; the runtime only applies additive pose assets`);
      poseAssets.set(e.Name, { container: e.Properties.PoseContainer, path: relative(resolve(dir), file).replaceAll("\\", "/") });
    } else if (e.Type === "CharacterCustomizationItem") {
      const pose = assetName(e.Properties?.FaceRigPoseAsset?.AssetPathName);
      const mesh = (e.Properties?.VisualParts ?? []).find(p => p.bIsHeadMesh)?.SkeletalMesh?.AssetPathName;
      if (pose && mesh) heads.set(assetName(mesh), { pose, da: e.Name });
    }
  }
}

// --- Pose files ---------------------------------------------------------------------------------------------------------
const toDegrees = q => 2 * Math.acos(Math.min(1, Math.abs(q.W))) * 180 / Math.PI;
const poseFiles = new Map(); // pose asset -> { names, bones: Set }
let droppedNonFacial = { degrees: 0, cm: 0, at: "" }, scaleDeltas = 0;
mkdirSync(join(out, "poses"), { recursive: true });
for (const asset of new Set([...heads.values()].map(h => h.pose))) {
  const entry = poseAssets.get(asset);
  if (!entry) throw new Error(`Pose asset ${asset} (a head's FaceRigPoseAsset) is not in the --json dumps`);
  const { container } = entry;
  const names = container.PoseFNames;
  const bones = [], boneIndex = new Map(), deltas = names.map(() => []);
  container.TrackPoseInfluenceIndices.forEach((influence, track) => {
    const bone = container.Tracks[track];
    for (const { PoseIndex: pose, BoneTransformIndex: slot } of influence.Influences) {
      const x = container.Poses[pose].LocalSpacePose[slot];
      const degrees = toDegrees(x.Rotation), cm = Math.hypot(x.Translation.X, x.Translation.Y, x.Translation.Z);
      const scale = Math.max(Math.abs(x.Scale3D.X), Math.abs(x.Scale3D.Y), Math.abs(x.Scale3D.Z));
      if (degrees < ROT_EPS && cm < POS_EPS && scale < SCALE_EPS) continue;
      if (!/^FACIAL_/i.test(bone)) {
        if (degrees + cm > droppedNonFacial.degrees + droppedNonFacial.cm) droppedNonFacial = { degrees, cm, at: `${asset} ${names[pose]} ${bone}` };
        continue;
      }
      if (!boneIndex.has(bone)) { boneIndex.set(bone, bones.length); bones.push(bone); }
      const q = [x.Rotation.X, x.Rotation.Y, x.Rotation.Z, x.Rotation.W];
      if (q[3] < 0) q.forEach((v, i) => q[i] = -v); // one hemisphere: the runtime blends components
      const row = [boneIndex.get(bone), ...q.map(v => round(v, 6)), round(x.Translation.X, 4), round(x.Translation.Y, 4), round(x.Translation.Z, 4)];
      if (scale >= SCALE_EPS) { scaleDeltas++; row.push(round(x.Scale3D.X, 5), round(x.Scale3D.Y, 5), round(x.Scale3D.Z, 5)); }
      deltas[pose].push(row);
    }
  });
  writeFileSync(join(out, "poses", `${asset}.json`), JSON.stringify({ formatVersion: 1, name: asset, source: entry.path,
    // Each delta row: [bone index, qx, qy, qz, qw, tx, ty, tz (, sx, sy, sz)], UE bone-local, cm; scale additive (0 = none).
    poses: names, bones, deltas }));
  poseFiles.set(asset, { names, bones: new Set(bones) });
  console.log(`${asset}: ${names.length} poses, ${bones.length} FACIAL bones, ${deltas.reduce((n, d) => n + d.length, 0)} deltas`);
}

// --- Head files ---------------------------------------------------------------------------------------------------------
mkdirSync(join(out, "heads"), { recursive: true });
const headIndex = {};
for (const [mesh, { pose, da }] of [...heads].sort()) {
  const refPath = join(resolve(args.refs), `mesh-${mesh}.json`);
  if (!existsSync(refPath)) { console.warn(`skip head ${mesh}: no reference skeleton in --refs`); continue; }
  const refBones = JSON.parse(readFileSync(refPath, "utf8")).bones;
  // FNames compare case-insensitively: Face 32's pose asset spells its tracks facial_c_forehead, its mesh FACIAL_C_Forehead.
  const byName = new Map(refBones.map(r => [r.name.toLowerCase(), r]));
  const ref = {};
  let missing = 0;
  for (const bone of poseFiles.get(pose).bones) {
    const b = byName.get(bone.toLowerCase());
    if (!b) { missing++; continue; } // a pose bone this head lacks: the runtime skips it
    ref[bone] = [refBones[b.parent]?.name ?? null, ...b.t.map(v => round(v, 4)), ...b.r.map(v => round(v, 6))];
  }
  writeFileSync(join(out, "heads", `${mesh}.json`), JSON.stringify({ formatVersion: 1, mesh, dataAsset: da,
    pose: `poses/${pose}.json`, // [parent, tx, ty, tz, qx, qy, qz, qw]: the head's UE reference local of each driven bone
    ref }));
  headIndex[mesh] = `heads/${mesh}.json`;
  console.log(`${mesh.padEnd(26)} -> ${pose}${missing ? ` (${missing} pose bones not on this head)` : ""}`);
}

// --- Curve files --------------------------------------------------------------------------------------------------------
const canonical = new Map([...poseFiles.values()].flatMap(p => p.names.map(n => [n.toLowerCase(), n])));
const manifest = JSON.parse(readFileSync(resolve(args.manifest), "utf8"));
const sources = [...new Set(manifest.clips.map(c => c.source).filter(Boolean))].sort();
function reduce(values) {
  // Greedy, as convert-clips.mjs: extend each segment while every skipped frame is reproduced by linear interpolation.
  const keys = [0];
  let start = 0;
  for (let end = 2; end < values.length; end++) {
    let ok = true;
    for (let k = start + 1; k < end && ok; k++)
      ok = Math.abs(values[start] + (values[end] - values[start]) * (k - start) / (end - start) - values[k]) <= CURVE_TOL;
    if (!ok) { keys.push(end - 1); start = end - 1; }
  }
  if (values.length > 1) keys.push(values.length - 1);
  return keys;
}
mkdirSync(join(out, "curves"), { recursive: true });
const curveIndex = [], unmatched = new Map(), noFace = [];
let curveBytes = 0;
for (const source of sources) {
  const path = join(resolve(args.run), "anims", `${source}.json`);
  if (!existsSync(path)) { noFace.push(`${source} (not exported)`); continue; }
  const anim = JSON.parse(readFileSync(path, "utf8"));
  if (!anim.faceCurveValues) throw new Error(`${source}: the export run has no faceCurveValues (rebuild AnimExport)`);
  const frameTime = anim.length / (anim.frames - 1) / (anim.rateScale || 1); // as convert-clips.mjs
  const curves = {};
  for (const [name, raw] of Object.entries(anim.faceCurveValues)) {
    const pose = canonical.get(name.toLowerCase());
    if (!pose || pose === "Pose_0") { unmatched.set(name, (unmatched.get(name) ?? 0) + 1); continue; }
    if (raw.length !== anim.frames) throw new Error(`${source} ${name}: ${raw.length} samples for ${anim.frames} frames`);
    const values = raw.map(v => Math.min(1, Math.max(0, v)));
    if (values.every(v => v < 1e-4)) continue;
    if (curves[pose]) throw new Error(`${source}: two curves name ${pose}`);
    const keys = reduce(values);
    curves[pose] = [keys, keys.map(k => round(values[k], 4))];
  }
  if (!Object.keys(curves).length) { noFace.push(source); continue; }
  const text = JSON.stringify({ formatVersion: 1, source, frames: anim.frames, frameTime: round(frameTime, 8), curves });
  writeFileSync(join(out, "curves", `${source}.json`), text);
  curveBytes += text.length;
  curveIndex.push(source);
}

// --- Wrap cage skins (optional: --wraps <head-wraps.json> --cages <AnimExport mesh-mode dir>) ----------------------------
// Beards, balaclavas and mouth scarves are wrapped by the head: in the game they follow the head's *_Wraps cage, a
// skinned mesh that the facial poses move like the face. The viewer's HeadWrap.ts places them on the worn face's cage at
// rest; with each cage's skin weights here, FaceAnimator moves the cage with the face and the wrap follows (else a smile
// pushes the cheeks through a balaclava and an open jaw drops the lip through a beard). Written in the published
// head-wraps.json vertex order (the reference cage's), matched by position in its GLB frame (UE (X, Z, Y) * 0.01).
const wrapIndex = {};
if (args.wraps && args.cages) {
  const wraps = JSON.parse(readFileSync(resolve(args.wraps), "utf8"));
  mkdirSync(join(out, "wraps"), { recursive: true });
  for (const [cage, { positions }] of Object.entries(wraps.cages)) {
    const name = assetName(cage);
    const dump = join(resolve(args.cages), `Discovery/Content${cage.replace(/^\/Game/, "").replace(/\.[^./]+$/, "")}.mesh.json`);
    if (!existsSync(dump)) { console.warn(`skip cage ${name}: no mesh dump`); continue; }
    const header = JSON.parse(readFileSync(dump, "utf8"));
    const bin = readFileSync(dump.replace(/\.mesh\.json$/, ".mesh.bin"));
    const array = (key, Type) => { const a = header.arrays.find(x => x.name === key); return new Type(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes)); };
    // Every influence when the dump has them (MeshDump.cs jointsAll: up to 8 on the cages), else the top four.
    const width = header.influencesPerVertex ?? 4, all = width > 4 ? "All" : "";
    const position = array("position", Float32Array), joints = array(`joints${all}`, Uint16Array), weights = array(`weights${all}`, Float32Array);
    const n = positions.length / 3, dumped = position.length / 3;
    const bones = [], boneIndex = new Map(), skinJoints = [], skinWeights = [];
    let worst = 0;
    for (let v = 0; v < n; v++) {
      let best = -1, bestD = Infinity;
      for (let u = 0; u < dumped; u++) { // GLB frame: UE (X, Z, Y) cm -> m
        const d = Math.hypot(position[u * 3] / 100 - positions[v * 3], position[u * 3 + 2] / 100 - positions[v * 3 + 1], position[u * 3 + 1] / 100 - positions[v * 3 + 2]);
        if (d < bestD) { bestD = d; best = u; }
      }
      worst = Math.max(worst, bestD);
      for (let k = 0; k < width; k++) {
        const w = weights[best * width + k], bone = header.bones[joints[best * width + k]].name;
        if (!(w > 0)) { skinJoints.push(0); skinWeights.push(0); continue; }
        if (!boneIndex.has(bone)) { boneIndex.set(bone, bones.length); bones.push(bone); }
        skinJoints.push(boneIndex.get(bone)); skinWeights.push(round(w, 4));
      }
    }
    if (worst > 1e-5) throw new Error(`cage ${name}: the dump's vertices miss the published cage by ${(worst * 1000).toFixed(3)} mm`);
    writeFileSync(join(out, "wraps", `${name}.json`), JSON.stringify({ formatVersion: 1, cage, positions,
      // Per cage vertex (published order), `influences` slots: indices into bones, weights (renormalised, zero-padded).
      bones, influences: width, joints: skinJoints, weights: skinWeights }));
    wrapIndex[cage] = `wraps/${name}.json`;
  }
  console.log(`${Object.keys(wrapIndex).length} wrap cage skins`);
}

// --- Face masks (optional: --masks <json-mode dir with the BWA_FaceJoints_* bone weights assets) ----------------------
// Only FACIAL bones are kept (the layer only moves those); keyed in the runtime by the definition's soft object path.
const maskIndex = {};
if (args.masks) {
  mkdirSync(join(out, "masks"), { recursive: true });
  for (const file of walk(resolve(args.masks))) {
    const asset = JSON.parse(readFileSync(file, "utf8")).find(e => e.Type === "BoneWeightsAsset");
    if (!asset) continue;
    const name = asset.Name, source = `${asset.Package}.${name}`;
    const bones = {};
    for (const { Key, Value } of asset.Properties.BoneWeightInfos ?? [])
      if (/^FACIAL_/i.test(Key)) bones[Key] = [round(Value.RotationWeight ?? 1, 4), round(Value.TranslationWeight ?? 1, 4)];
    if (!Object.keys(bones).length) continue;
    writeFileSync(join(out, "masks", `${name}.json`), JSON.stringify({ formatVersion: 1, name, source,
      skeleton: asset.Properties.Skeleton?.ObjectPath ?? null,
      // FACIAL bone -> [rotation weight, translation weight]: how much of the bone's facial motion the mask keeps.
      bones }));
    maskIndex[source] = `masks/${name}.json`;
  }
  console.log(`${Object.keys(maskIndex).length} face masks`);
}

const index = {
  formatVersion: 1, generatedAt: new Date().toISOString(), tool: "scripts/anim-export/build-face.mjs",
  heads: headIndex, curves: curveIndex, wraps: wrapIndex, masks: maskIndex,
  report: {
    poseAssets: poseFiles.size, heads: Object.keys(headIndex).length, clipSources: sources.length, withCurves: curveIndex.length,
    withoutCurves: noFace, curveBytes, scaleDeltas,
    droppedNonFacialMax: { degrees: round(droppedNonFacial.degrees, 3), cm: round(droppedNonFacial.cm, 4), at: droppedNonFacial.at },
    unmatchedCurves: Object.fromEntries([...unmatched].sort()),
  },
};
writeFileSync(join(out, "faces.json"), JSON.stringify(index, null, 2));
console.log(JSON.stringify(index.report, null, 2));
if ("activate" in args) {
  const pointer = join(dirname(out), "manifest.json");
  const current = JSON.parse(readFileSync(pointer, "utf8"));
  writeFileSync(pointer, JSON.stringify({ ...current, faces: `${basename(out)}/faces.json` }, null, 2));
  console.log(`Activated: ${pointer} -> ${basename(out)}/faces.json`);
}
