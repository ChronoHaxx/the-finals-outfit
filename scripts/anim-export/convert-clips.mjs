#!/usr/bin/env node
// Showcase animation converter (5 Nov 2026): UE bone-local tracks from scripts/anim-export (AnimExport) -> compact
// three.js clips that drive the app's body skeleton (public/models/body/SK_Body_M.glb) directly.
//
// The mechanism, in one place:
//  * UE stores each bone's pose relative to its parent: translation (cm), rotation (quaternion), scale, in UE's
//    left-handed, Z-up frame. The body GLB came through Blender's UEFormat importer, which keeps every bone's axes
//    but mirrors Y to become right-handed and scales cm -> m. So a parent-relative transform converts per bone:
//    position (x, y, z) -> (x, -y, z) / 100, quaternion (x, y, z, w) -> (-x, y, -z, w) (mirroring flips the sign of
//    the rotation about every axis except the mirrored one).
//  * Only the root has a different parent frame (the armature node, Y-up): its GLB rest carries an extra rotation P.
//    P is measured, not assumed: P_j = D_rest_local_j * conv(U_rest_local_j)^-1 for every joint. It must be the
//    identity for every non-root joint, or this converter refuses (the relation would then need full retargeting).
//  * Bones the clip does not animate (the *_vpj volume joints) keep their rest pose; in the game a post-process
//    graph drives them (the app ports it: src/rig/DeformationRig.ts).
//  * Prop attach bones: emote props attach to prop_01 / weapon_root, which the body mesh does not have (they hang
//    under spine_03 through weapon_buffer in the master skeleton) but every emote animates. They are converted like
//    any other non-root bone and listed in the manifest (`attachBones`, rest pose included) so the app adds them as
//    plain nodes before binding. `componentSpace` is the root's frame fix: a node with that rotation under the
//    root's parent is UE component space, where a prop with no socket attaches.
//
// Usage (Git Bash or PowerShell, from the worktree root):
//   node scripts/anim-export/convert-clips.mjs --run scripts/generated/anim-export/run-b \
//     --body ../../../public/models/body/SK_Body_M.glb --out public/animations/set-1 [--clips scripts/anim-export/clips.json]
// The output directory must not exist yet (each run is kept). public/animations/manifest.json is then pointed at it.
// Clip lists from build-emote-catalog.mjs add, per clip, an `icon` (a thumbnail next to that clips.json, copied into
// the set's icons/) and `emote` details (name, rarity, season, props/effects the preview does not show), both carried
// into the manifest (--activate [--props <dir>] also points the app at the set and its props; --props also adds the
// bones the props' sockets need, so run build-props.mjs first). Several emotes may play one animation: it is converted once and its file shared. A clip that
// cannot be converted (an additive animation, a missing export) is left out and listed under `skipped`.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as THREE from "three";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["run", "body", "out"]) if (!args[required]) throw new Error(`--${required} is required`);
const run = resolve(args.run), out = resolve(args.out);
const clipsPath = resolve(args.clips ?? "scripts/anim-export/clips.json");
if (existsSync(out)) throw new Error(`Output ${out} already exists; choose a new set directory (runs are kept)`);

// Tolerances for dropping keys that linear interpolation reproduces. 0.1 degree at 1 m is 1.7 mm.
const ROT_TOL = THREE.MathUtils.degToRad(0.1), POS_TOL = 0.0001; // metres
const Q_SCALE = 32767, P_SCALE = 1e5; // quaternion components -> int16 range; metres -> 10 micrometre ints

// --- Driver skeleton from the GLB's JSON chunk (no mesh decoding needed) -------------------------------------------
const glb = readFileSync(resolve(args.body));
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("Body is not a GLB");
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
const nodeParent = new Map();
gltf.nodes.forEach((node, i) => (node.children ?? []).forEach(c => nodeParent.set(c, i)));
const localOf = (node) => {
  const m = new THREE.Matrix4();
  if (node.matrix) return m.fromArray(node.matrix);
  return m.compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
};
const joints = gltf.skins[0].joints.map(i => ({ index: i, name: gltf.nodes[i].name, local: localOf(gltf.nodes[i]) }));
const jointByName = new Map(joints.map(j => [j.name, j]));

// --- UE reference pose of the same mesh, and the per-joint frame check ----------------------------------------------
const ueMesh = JSON.parse(readFileSync(join(run, "mesh-SK_Body_M.json"), "utf8"));
const ueRef = new Map(ueMesh.bones.map(b => [b.name, b]));
const convT = t => new THREE.Vector3(t[0] / 100, -t[1] / 100, t[2] / 100);
const convQ = q => new THREE.Quaternion(-q[0], q[1], -q[2], q[3]).normalize();
const convM = (t, q) => new THREE.Matrix4().compose(convT(t), convQ(q), new THREE.Vector3(1, 1, 1));
const frameFix = new Map(); // joint name -> P (Matrix4), identity omitted
let worstNonRoot = 0, worstNonRootName = "";
for (const joint of joints) {
  const ref = ueRef.get(joint.name);
  if (!ref) throw new Error(`Driver joint ${joint.name} has no UE reference bone`);
  const P = joint.local.clone().multiply(convM(ref.t, ref.r).invert());
  const identityError = Math.max(...P.elements.map((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0))));
  const isRoot = !jointByName.has(gltf.nodes[nodeParent.get(joint.index)]?.name);
  if (isRoot) {
    // The root may carry the armature's axis change, but only as a rigid rotation.
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    P.decompose(p, q, s);
    if (p.length() > 1e-5 || Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) > 1e-4)
      throw new Error(`Root joint ${joint.name} frame fix is not a pure rotation`);
    frameFix.set(joint.name, new THREE.Matrix4().makeRotationFromQuaternion(q));
  } else if (identityError > worstNonRoot) { worstNonRoot = identityError; worstNonRootName = joint.name; }
}
if (worstNonRoot > 2e-4) throw new Error(`Joint ${worstNonRootName} does not follow the per-bone mirror relation (error ${worstNonRoot})`);
const roots = [...frameFix.keys()];

// --- Prop attach bones (from the master skeleton; each must hang under a body joint or another attach bone) ----------
// Always weapon_buffer > weapon_root / prop_01 (most props hang there). With --props <dir> (build-props.mjs output, run
// first), also every other master-skeleton bone a shown prop's socket names (directly, or as a skeleton socket's bone)
// that the body lacks, with its missing ancestors, parent first. Without that, such a prop fell back to the character
// origin (10 Nov 2026: a Terracotta flower box on weapon_belt_01, the Botanist's props on ik_hand_l and
// weapon_dynamic_part_attach_01). A bone under the root needs no frame fix of its own: the root's GLB local is
// P * conv(UE local), so P is a left factor and every child of the root converts plainly (pelvis passes the check above).
const BASE_ATTACH_BONES = ["weapon_buffer", "weapon_root", "prop_01"];
const masterBones = JSON.parse(readFileSync(join(run, "skeleton.json"), "utf8")).bones;
const masterIndex = new Map(masterBones.map((b, i) => [b.name.toLowerCase(), i]));
const socketBones = new Set();
if (args.props) {
  const propsManifest = JSON.parse(readFileSync(join(resolve(args.props), "props.json"), "utf8"));
  for (const windows of Object.values(propsManifest.emotes ?? {}))
    for (const w of windows) if (w.shown && w.socket) socketBones.add(propsManifest.sockets?.[w.socket]?.bone ?? w.socket);
}
const ATTACH_BONES = [];
for (const name of [...BASE_ATTACH_BONES, ...[...socketBones].sort()]) {
  const index = masterIndex.get(name.toLowerCase());
  if (index === undefined) {
    if (BASE_ATTACH_BONES.includes(name)) throw new Error(`Attach bone ${name} is not in the master skeleton`);
    console.warn(`Prop socket ${name} is not a master-skeleton bone; its props stay at the character origin`);
    continue;
  }
  const chain = [];
  for (let i = index; i >= 0 && !jointByName.has(masterBones[i].name); i = masterBones[i].parent ?? -1) chain.unshift(masterBones[i].name);
  for (const bone of chain) if (!ATTACH_BONES.includes(bone)) ATTACH_BONES.push(bone);
}
const attachBones = ATTACH_BONES.map(name => {
  const ref = masterBones[masterIndex.get(name.toLowerCase())];
  const parent = masterBones[ref.parent]?.name;
  if (!jointByName.has(parent) && !ATTACH_BONES.includes(parent)) throw new Error(`Attach bone ${name} hangs under ${parent}, which the body lacks`);
  return { name, parent, ref, local: convM(ref.t, ref.r) };
});
console.log(`Driver: ${joints.length} joints; mirror relation holds for every non-root joint (max element error ${worstNonRoot.toExponential(2)}); root frame fix on ${roots.join(", ")}`);

// --- Key reduction ---------------------------------------------------------------------------------------------------
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
function reduce(count, error) {
  // Greedy: extend each segment while every skipped frame is reproduced by interpolating its end keys.
  const keys = [0];
  let start = 0;
  for (let end = 2; end < count; end++) {
    let ok = true;
    for (let k = start + 1; k < end && ok; k++) ok = error(start, end, k);
    if (!ok) { keys.push(end - 1); start = end - 1; }
  }
  if (count > 1) keys.push(count - 1);
  return keys;
}
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();

// --- Clips -----------------------------------------------------------------------------------------------------------
const config = JSON.parse(readFileSync(clipsPath, "utf8"));
const sourceRun = JSON.parse(readFileSync(join(run, "source-run.json"), "utf8"));
mkdirSync(out, { recursive: true });
const manifestClips = [], skipped = [];
const converted = new Map(); // source -> manifest fields of its converted file (shared by every clip that plays it)
const sharedFiles = config.clips.length !== new Set(config.clips.map(c => c.source)).size;
const extras = clip => {
  const fields = {};
  if (clip.icon) {
    mkdirSync(join(out, "icons"), { recursive: true });
    copyFileSync(resolve(dirname(clipsPath), clip.icon), join(out, "icons", basename(clip.icon)));
    fields.icon = `icons/${basename(clip.icon)}`;
  }
  if (clip.emote) fields.emote = clip.emote;
  return fields;
};
for (const clip of config.clips) {
  const done = converted.get(clip.source);
  if (done) {
    manifestClips.push({ id: clip.id, label: clip.label, kind: clip.kind, loop: clip.kind === "idle", ...done, ...extras(clip) });
    continue;
  }
  const animPath = join(run, "anims", `${clip.source}.json`);
  if (!existsSync(animPath)) { skipped.push({ id: clip.id, source: clip.source, reason: "not in the exporter run" }); console.warn(`skip ${clip.id}: not exported`); continue; }
  const anim = JSON.parse(readFileSync(animPath, "utf8"));
  if (anim.additive !== "AAT_None") {
    skipped.push({ id: clip.id, source: clip.source, reason: `additive (${anim.additive})` });
    console.warn(`skip ${clip.id}: additive ${anim.additive}`);
    continue;
  }
  const frames = anim.frames, frameTime = anim.length / (frames - 1) / (anim.rateScale || 1);
  const tracksByName = new Map(anim.bones.map(b => [b.name, b]));
  const q = [], p = [];
  let keyCount = 0, rootTravel = 0, loopSeam = 0;
  for (const joint of [...joints, ...attachBones]) {
    const track = tracksByName.get(joint.name);
    if (!track) continue; // not animated by this clip (vpj volume joints): stays at rest
    const ref = ueRef.get(joint.name) ?? joint.ref, fix = frameFix.get(joint.name);
    const quats = [], positions = [];
    for (let f = 0; f < frames; f++) {
      const t = track.t ? track.t.slice(f * 3, f * 3 + 3) : ref.t;
      const r = track.r ? track.r.slice(f * 4, f * 4 + 4) : ref.r;
      const m = convM(t, r);
      if (fix) m.premultiply(fix);
      const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scale = new THREE.Vector3();
      m.decompose(pos, rot, scale);
      if (quats.length && quats[quats.length - 1].dot(rot) < 0) rot.set(-rot.x, -rot.y, -rot.z, -rot.w); // one hemisphere
      quats.push(rot); positions.push(pos);
    }
    if (clip.kind === "idle") loopSeam = Math.max(loopSeam, angle(quats[0], quats[frames - 1]));
    // Rotation: always a track (every animated bone).
    const qKeys = reduce(frames, (a, b, k) => angle(tmpQ.slerpQuaternions(quats[a], quats[b], (k - a) / (b - a)), quats[k]) <= ROT_TOL);
    q.push([joint.name, qKeys, qKeys.flatMap(k => quats[k].toArray().map(v => Math.round(v * Q_SCALE)))]);
    keyCount += qKeys.length;
    // Translation: only where it moves, or where it differs from the driver's rest (keeps the clip exact and small).
    const rest = new THREE.Vector3().setFromMatrixPosition(joint.local);
    const moves = positions.some(v => v.distanceTo(positions[0]) > POS_TOL) || positions[0].distanceTo(rest) > POS_TOL;
    if (moves) {
      const pKeys = reduce(frames, (a, b, k) => tmpV.lerpVectors(positions[a], positions[b], (k - a) / (b - a)).distanceTo(positions[k]) <= POS_TOL);
      p.push([joint.name, pKeys, pKeys.flatMap(k => positions[k].toArray().map(v => Math.round(v * P_SCALE)))]);
      keyCount += pKeys.length;
      if (joint.name === "root") rootTravel = Math.max(...positions.map(v => v.distanceTo(positions[0])));
    }
  }
  // The emote's prop clock: PropAnimSequenceTime is the explicit time its props' AnimBlueprints evaluate their own
  // sequence at (a SequenceEvaluator reading PropAnimTime). Kept as [frame keys, seconds], linear, 1 ms tolerance.
  // Matched case-insensitively, as UE FNames are: Death_00 names it "propanimsequencetime" (until 11 Nov 2026 its wings
  // fell back to the spawn clock).
  const clock = Object.entries(anim.curveValues ?? {}).find(([name]) => name.toLowerCase() === "propanimsequencetime")?.[1];
  let propTime;
  if (clock?.length === frames && clock.some(v => Math.abs(v - clock[0]) > 1e-4)) {
    const keys = reduce(frames, (a, b, k) => Math.abs(clock[a] + (clock[b] - clock[a]) * (k - a) / (b - a) - clock[k]) <= 1e-3);
    propTime = [keys, keys.map(k => +clock[k].toFixed(4))];
  }
  const record = {
    formatVersion: 1, id: clip.id, label: clip.label, kind: clip.kind, loop: clip.kind === "idle",
    source: anim.name, frames, frameTime, duration: frameTime * (frames - 1),
    qScale: Q_SCALE, pScale: P_SCALE, q, p, ...(propTime ? { propTime } : {}),
    // Recorded for later work; not played: facial expression curves and gameplay/FX notifies.
    curves: anim.curves, notifies: anim.notifies.map(n => n.name).filter(Boolean),
  };
  // Shared animations are named after their source sequence; a clip list without sharing keeps one file per id.
  const file = `${sharedFiles ? anim.name : clip.id}.json`, text = JSON.stringify(record);
  writeFileSync(join(out, file), text);
  const fields = { duration: +record.duration.toFixed(3),
    file, bytes: text.length, rotationTracks: q.length, translationTracks: p.length, keys: keyCount, source: anim.name,
    rootTravelMetres: +rootTravel.toFixed(4), ...(clip.kind === "idle" ? { loopSeamDegrees: +THREE.MathUtils.radToDeg(loopSeam).toFixed(3) } : {}) };
  converted.set(clip.source, fields);
  manifestClips.push({ id: clip.id, label: clip.label, kind: clip.kind, loop: record.loop, ...fields, ...extras(clip) });
  console.log(`${clip.id.padEnd(16)} ${String(frames).padStart(4)} frames ${record.duration.toFixed(2).padStart(6)} s  ${q.length} rot / ${p.length} pos tracks  ${keyCount} keys  ${(text.length / 1024).toFixed(0)} KB  root travel ${(rootTravel * 100).toFixed(1)} cm`
    + (clip.kind === "idle" ? `  loop seam ${THREE.MathUtils.radToDeg(loopSeam).toFixed(2)} deg` : ""));
}

const sha = buf => createHash("sha256").update(buf).digest("hex");
const containers = sourceRun.sourceContainers ?? [];
const manifest = {
  formatVersion: 1, generatedAt: new Date().toISOString(), tool: "scripts/anim-export/convert-clips.mjs",
  defaultIdle: config.defaultIdle,
  source: {
    exporterRun: relative(process.cwd(), run).replaceAll("\\", "/"), mappingSha256: sourceRun.mappingSha256,
    parserVersion: sourceRun.parserVersion, containers: containers.length,
    newestContainerUtc: containers.map(c => c.lastWriteTimeUtc).sort().at(-1),
  },
  driver: { glb: basename(args.body), sha256: sha(glb), joints: joints.length, mirrorRelationMaxError: worstNonRoot, rootFrameFix: roots },
  attachBones: attachBones.map(({ name, parent, local }) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(p, q, s);
    return { name, parent, position: p.toArray().map(v => +v.toFixed(6)), quaternion: q.toArray().map(v => +v.toFixed(7)) };
  }),
  componentSpace: { under: roots[0], quaternion: new THREE.Quaternion().setFromRotationMatrix(frameFix.get(roots[0])).toArray().map(v => +v.toFixed(7)) },
  tolerances: { rotationDegrees: 0.1, translationMetres: POS_TOL },
  ...(config.rarityOrder ? { rarityOrder: config.rarityOrder } : {}),
  clips: manifestClips,
  ...(skipped.length ? { skipped } : {}),
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifestClips.length} clips (${converted.size} animation files) to ${out}; skipped ${skipped.length}`);
// --activate: point the app's manifest (one level up, public/animations/manifest.json) at this set. Earlier sets
// stay on disk; only this pointer file is replaced. --props <dir> (a build-props.mjs output next to the set) adds the
// emote props manifest to the pointer.
if ("activate" in args) {
  const pointer = join(dirname(out), "manifest.json");
  const props = args.props ? `${basename(resolve(args.props))}/props.json` : undefined;
  if (props && !existsSync(join(dirname(out), props))) throw new Error(`--props: ${props} not found next to the set`);
  writeFileSync(pointer, JSON.stringify({ ...manifest, base: `${basename(out)}/`, ...(props ? { props } : {}) }, null, 2));
  console.log(`Activated: ${pointer} -> ${basename(out)}/`);
}
