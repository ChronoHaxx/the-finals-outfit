// Stage an animations deployment that is a superset of the live one (21 Nov 2026, the Season 1-2 emotes).
//
//   node _docs/all-emotes-2026-11-21/stage-superset.mjs --live <staged copy of the live host> --new <dir> --out <new dir>
//     [--hold <held.json>]
//
// <live> must be byte-identical to the live host (check with verify-hosted.mjs first). <new> holds the additions:
// set-new/ (convert-clips output: manifest + clip files + icons/), props-new/ (build-props), faces-2/ (build-face --from,
// already a superset of faces-1) and sounds-new/ (build-emote-sounds), plus emotes-1/clips.json (the catalog entries,
// including the ones that reuse a live clip file).
// The output keeps every live file at its path, byte for byte, and adds set-6/ (set-5 + new clips + new icons),
// props-10/, faces-2/ and sounds-2/; the manifest points at them. Where the live set already has a file, an actor,
// a sound entry or a clip id, the live one is kept and any difference is reported. Clip ids never change.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["live", "new", "out"]) if (!args[required]) throw new Error(`--${required} is required`);
const live = resolve(args.live), add = resolve(args.new), out = resolve(args.out);
if (existsSync(out)) throw new Error(`${out} exists; choose a new directory`);
const read = file => JSON.parse(readFileSync(file, "utf8"));
const report = { keptLive: [], differences: [] };
const manifest = read(join(live, "manifest.json"));
const base = manifest.base.replace(/\/$/, "");
if (base !== "set-5" || manifest.props !== "props-9/props.json" || manifest.faces !== "faces-1/faces.json" || manifest.sounds !== "sounds-1/sounds.json")
  throw new Error("The live manifest is not the one this script was written for (set-5, props-9, faces-1, sounds-1)");

cpSync(live, out, { recursive: true });
/** Copy every file of `from` into `to`, keeping an existing file (and reporting a different one). */
function addFiles(from, to, label) {
  mkdirSync(to, { recursive: true });
  let added = 0;
  for (const name of readdirSync(from, { withFileTypes: true })) {
    if (name.isDirectory()) { added += addFiles(join(from, name.name), join(to, name.name), `${label}/${name.name}`); continue; }
    if (name.name === "manifest.json" || name.name === "props.json" || name.name === "sounds.json") continue;
    const target = join(to, name.name);
    if (existsSync(target)) {
      report.keptLive.push(`${label}/${name.name}`);
      if (!readFileSync(target).equals(readFileSync(join(from, name.name)))) report.differences.push(`${label}/${name.name}`);
      continue;
    }
    cpSync(join(from, name.name), target);
    added++;
  }
  return added;
}

// --- Clips: set-6 = set-5 + the new files ---------------------------------------------------------------------------
cpSync(join(live, "set-5"), join(out, "set-6"), { recursive: true });
const clipFiles = addFiles(join(add, "set-new"), join(out, "set-6"), "set-6")
  // The catalog's icons, also for the entries that reuse a live clip file (convert-clips copied only its own clips').
  + addFiles(join(add, "emotes-1", "icons"), join(out, "set-6", "icons"), "set-6/icons");
const fresh = read(join(add, "set-new", "manifest.json"));
for (const key of ["driver", "componentSpace", "tolerances", "attachBones"])
  if (JSON.stringify(fresh[key]) !== JSON.stringify(manifest[key])) throw new Error(`set-new's ${key} differs from the live manifest's`);
const catalog = read(join(add, "emotes-1", "clips.json")).clips;
const byId = new Map(manifest.clips.map(c => [c.id, c]));
const freshById = new Map(fresh.clips.map(c => [c.id, c]));
let replaced = 0, appended = 0;
for (const entry of catalog) {
  const old = byId.get(entry.id);
  if (old) {
    // A live "unlisted" clip that an item turns out to play: same id and file, now with the item's name and icon.
    if (!old.emote?.unlisted && old.emote) throw new Error(`${entry.id} is already a listed emote on the live host`);
    if (old.source.toLowerCase() !== entry.source.toLowerCase()) throw new Error(`${entry.id}: live source ${old.source}, catalog ${entry.source}`);
    Object.assign(old, { label: entry.label, icon: entry.icon, emote: entry.emote });
    replaced++;
  } else {
    const clip = freshById.get(entry.id);
    if (!clip) throw new Error(`${entry.id}: not converted in set-new`);
    manifest.clips.push(clip);
    appended++;
  }
}
const emotesLast = [...manifest.clips.filter(c => c.kind !== "emote"), ...manifest.clips.filter(c => c.kind === "emote")];
manifest.clips = emotesLast;

// --- Props: props-10 = props-9 + new actors -------------------------------------------------------------------------
cpSync(join(live, "props-9"), join(out, "props-10"), { recursive: true });
const propFiles = addFiles(join(add, "props-new"), join(out, "props-10"), "props-10");
const props = read(join(live, "props-9", "props.json")), newProps = read(join(add, "props-new", "props.json"));
if (JSON.stringify(props.sockets) !== JSON.stringify(newProps.sockets)) {
  for (const [name, socket] of Object.entries(newProps.sockets)) {
    if (!(name in props.sockets)) props.sockets[name] = socket;
    else if (JSON.stringify(props.sockets[name]) !== JSON.stringify(socket)) report.differences.push(`props socket ${name}`);
  }
}
for (const [actor, entry] of Object.entries(newProps.actors)) {
  if (actor in props.actors) { report.keptLive.push(`props actor ${actor}`); continue; }
  props.actors[actor] = entry;
}
for (const [source, windows] of Object.entries(newProps.emotes)) {
  if (source in props.emotes) throw new Error(`props.json already has emote ${source}`);
  props.emotes[source] = windows;
}
props.skipped = [...props.skipped, ...newProps.skipped.filter(s => !props.skipped.some(t => JSON.stringify(t) === JSON.stringify(s)))];
props.approximateMaterials = [...props.approximateMaterials, ...newProps.approximateMaterials.filter(s => !props.approximateMaterials.some(t => JSON.stringify(t) === JSON.stringify(s)))];
props.generatedAt = new Date().toISOString();
props.additions = [...(props.additions ?? []), { from: "props-new", builtAt: newProps.generatedAt, actors: Object.keys(newProps.actors).length, emotes: Object.keys(newProps.emotes).length }];
writeFileSync(join(out, "props-10", "props.json"), JSON.stringify(props, null, 2));

// --- Faces: faces-2 is already the superset ---------------------------------------------------------------------------
cpSync(join(add, "faces-2"), join(out, "faces-2"), { recursive: true });

// --- Sounds: sounds-2 = sounds-1 + new waves and emotes ----------------------------------------------------------------
cpSync(join(live, "sounds-1"), join(out, "sounds-2"), { recursive: true });
const soundFiles = addFiles(join(add, "sounds-new"), join(out, "sounds-2"), "sounds-2");
const sounds = read(join(live, "sounds-1", "sounds.json")), newSounds = read(join(add, "sounds-new", "sounds.json"));
for (const [wave, entry] of Object.entries(newSounds.files)) {
  if (wave in sounds.files) { if (JSON.stringify(sounds.files[wave]) !== JSON.stringify(entry)) report.differences.push(`sounds file ${wave}`); continue; }
  sounds.files[wave] = entry;
}
for (const [source, cues] of Object.entries(newSounds.emotes)) {
  if (source in sounds.emotes) { report.keptLive.push(`sounds emote ${source}`); if (JSON.stringify(sounds.emotes[source]) !== JSON.stringify(cues)) report.differences.push(`sounds emote ${source}`); continue; }
  sounds.emotes[source] = cues;
}
for (const [source, list] of Object.entries(newSounds.skipped ?? {})) sounds.skipped[source] ??= list;
sounds.generatedAt = new Date().toISOString();
writeFileSync(join(out, "sounds-2", "sounds.json"), JSON.stringify(sounds, null, 2));

// --- Manifest -----------------------------------------------------------------------------------------------------------
Object.assign(manifest, { generatedAt: new Date().toISOString(), base: "set-6/", props: "props-10/props.json", faces: "faces-2/faces.json", sounds: "sounds-2/sounds.json" });
manifest.additions = [...(manifest.additions ?? []), { date: "2026-11-21", what: "Season 1-2 emote items (DA_InGameEmote_*)", replacedUnlisted: replaced, appended,
  held: args.hold ? read(resolve(args.hold)).map(h => h.id) : [] }];
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
const summary = { clips: manifest.clips.length, replacedUnlisted: replaced, appended, newClipFiles: clipFiles, newPropFiles: propFiles, newSoundFiles: soundFiles,
  keptLive: report.keptLive.length, differences: report.differences };
writeFileSync(`${out}.stage-report.json`, JSON.stringify({ ...summary, keptLiveList: report.keptLive }, null, 2));
console.log(JSON.stringify(summary, null, 2));
