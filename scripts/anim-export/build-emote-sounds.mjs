#!/usr/bin/env node
// Emote sounds for the showcase viewer (12 Nov 2026): sounds.json (every emote animation's sound cues, keyed like
// props.json by AnimSequence name) plus one AAC file per SoundWave, for src/rig/EmoteSounds.ts. How the game's notifies,
// cues, MetaSounds and waves relate is in sound-cues.mjs.
//
// Inputs, all offline reads of the installed game made with AnimExport (never the running game):
//   --manifest   the animations manifest.json the sounds are for (its clips' `source` sequences)
//   --seqs       json mode output of those AnimSequence packages
//   --sounds     json mode output of the sound assets the notifies name (SoundCue / MetaSoundSource / SoundWave)
//   --wave-json  json mode output of the SoundWaves the cues reach (Volume, Pitch, bLooping, Duration, NumChannels)
//   --waves      sound mode output of the same SoundWaves (their cooked Bink Audio, <name>.binka)
// Tools: vgmstream-cli decodes Bink Audio to WAV (FModel keeps a copy in its .data folder), ffmpeg encodes AAC-LC in
// MP4 (.m4a). AAC because every browser's decodeAudioData takes it (Safari's Opus support is still partial); the MP4
// edit list marks the encoder's priming samples, so decoders trim them and a cue starts on its first real sample.
//
// Output: a NEW directory (runs are kept) holding sounds.json and the .m4a files, published as one folder of the
// animations deployment; the manifest's `sounds` names it. A report goes beside it (<out>.report.json).
//
// Usage (Git Bash, worktree root; Windows paths for node):
//   node scripts/anim-export/build-emote-sounds.mjs --manifest <manifest.json> --seqs <dir> --sounds <dir> \
//     --wave-json <dir> --waves <dir> --vgmstream <vgmstream-cli.exe> --out <new dir> [--ffmpeg ffmpeg] [--bitrate 128]
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildCue, packagePath, sequenceSoundNotifies, soundVariants } from "./sound-cues.mjs";

const run = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["manifest", "seqs", "sounds", "wave-json", "waves", "vgmstream", "out"])
  if (!args[required]) throw new Error(`--${required} is required`);
const out = resolve(args.out);
if (existsSync(out)) throw new Error(`Output ${out} already exists; choose a new directory (runs are kept)`);
const ffmpeg = args.ffmpeg ?? "ffmpeg", bitrate = Number(args.bitrate ?? 128);

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const readJson = file => JSON.parse(readFileSync(file, "utf8"));
const manifest = readJson(resolve(args.manifest));
const sequences = new Map(walk(resolve(args.seqs)).filter(f => f.endsWith(".json")).map(f => [basename(f, ".json").toLowerCase(), f]));
const packageJson = (dir, objectPath) => {
  const file = join(resolve(dir), `${packagePath(objectPath)}.json`);
  if (!existsSync(file)) throw new Error(`No exported JSON for ${objectPath} (${file})`);
  return readJson(file);
};

// --- Cues per emote animation ---------------------------------------------------------------------------------------
const sources = [...new Set(manifest.clips.map(c => c.source).filter(Boolean))].sort();
const clipLength = new Map(manifest.clips.map(c => [c.source, c.duration]));
const soundCache = new Map(); // sound object path -> variants
const waves = new Map(); // wave name -> { ref, volume, pitch, loop, duration, channels }
const emotes = {}, skipped = {}, failures = [];
for (const source of sources) {
  const file = sequences.get(source.toLowerCase());
  if (!file) throw new Error(`No exported JSON for sequence ${source}`);
  const cues = [];
  for (const notify of sequenceSoundNotifies(readJson(file))) {
    if (notify.kind === "voice") { (skipped[source] ??= []).push({ at: +notify.start.toFixed(4), vocalization: notify.vocalization }); continue; }
    if (!notify.sound) { failures.push(`${source}: ${notify.type} at ${notify.start} has no Sound`); continue; }
    let sound = soundCache.get(notify.sound);
    if (!sound) {
      try { sound = soundVariants(packageJson(args.sounds, notify.sound)); } catch (error) { failures.push(`${source}: ${notify.sound}: ${error.message}`); continue; }
      for (const v of sound.variants) v.waveRef ??= notify.sound; // a notify naming a SoundWave directly
      soundCache.set(notify.sound, sound);
    }
    for (const v of sound.variants) {
      const known = waves.get(v.wave);
      if (known && packagePath(known.ref).toLowerCase() !== packagePath(v.waveRef).toLowerCase())
        throw new Error(`Two waves named ${v.wave}: ${known.ref} and ${v.waveRef}`);
      if (!known) {
        const exports = packageJson(args["wave-json"], v.waveRef);
        const p = exports.find(e => e.Type === "SoundWave")?.Properties ?? {};
        waves.set(v.wave, { ref: v.waveRef, volume: p.Volume ?? 1, pitch: p.Pitch ?? 1, loop: !!p.bLooping,
          duration: p.Duration ?? null, channels: p.NumChannels ?? null });
      }
    }
    cues.push(buildCue(notify, sound, name => waves.get(name)));
  }
  if (cues.length) emotes[source] = cues;
}
if (failures.length) throw new Error(`Unresolved sounds:\n  ${failures.join("\n  ")}`);

// --- Audio: Bink Audio -> WAV (vgmstream) -> AAC-LC .m4a (ffmpeg) ---------------------------------------------------
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "emote-sounds-"));
const files = {};
const queue = [...waves.entries()].sort(([a], [b]) => a.localeCompare(b));
async function convert([name, wave]) {
  const binka = join(resolve(args.waves), `${packagePath(wave.ref)}.binka`);
  if (!existsSync(binka)) throw new Error(`No exported audio for ${wave.ref} (${binka})`);
  const wav = join(scratch, `${name}.wav`), m4a = join(out, `${name}.m4a`);
  await run(args.vgmstream, ["-o", wav, binka]);
  const kbps = wave.channels === 1 ? bitrate / 2 : bitrate;
  // bitexact + no metadata: the same input encodes to the same bytes, so an unchanged wave dedupes on upload.
  await run(ffmpeg, ["-v", "error", "-y", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-c:a", "aac", "-b:a", `${kbps}k`, m4a]);
  const { stdout } = await run(ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-show_entries",
    "format=duration", "-of", "csv=p=0", m4a]).catch(() => ({ stdout: "" }));
  rmSync(wav);
  files[name] = { file: `${name}.m4a`, bytes: statSync(m4a).size, duration: wave.duration && +wave.duration.toFixed(4),
    channels: wave.channels, ...(stdout.trim() ? { encodedDuration: +Number(stdout.trim()).toFixed(4) } : {}) };
}
try {
  await Promise.all(Array.from({ length: 4 }, async () => { for (let next; (next = queue.shift());) await convert(next); }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// --- sounds.json + report --------------------------------------------------------------------------------------------
// Encoded minus source length (the MP4 edit list should make it ~0: priming trimmed, no padding), for the report.
const encodedDrift = Object.entries(files).map(([name, f]) => (f.encodedDuration ?? NaN) - (waves.get(name).duration ?? NaN)).filter(Number.isFinite);
const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
  .map(([name, { encodedDuration, ...f }]) => [name, f])); // encodedDuration is for the report only
writeFileSync(join(out, "sounds.json"), JSON.stringify({
  formatVersion: 1,
  comment: "Generated by scripts/anim-export/build-emote-sounds.mjs: each emote animation's sound cues (keyed by AnimSequence, as props.json) and one AAC file per SoundWave. Cue times are seconds into the clip.",
  generatedAt: new Date().toISOString(),
  files: sortedFiles,
  emotes,
  ...(Object.keys(skipped).length ? { skipped } : {}),
}, null, 1));

const cueList = Object.entries(emotes).flatMap(([source, cues]) => cues.map(c => ({ source, ...c })));
// Windows that stop their sound before it would end by itself (the stop and its fade are audible there).
const cut = cueList.filter(c => c.kind === "window" && c.variants.some(v => !v.loop
  && c.duration < (files[v.wave].duration ?? Infinity) / (Array.isArray(v.rate) ? v.rate[1] : v.rate) - 0.05));
const bytes = Object.values(files).reduce((s, f) => s + f.bytes, 0);
const seconds = [...waves.values()].reduce((s, w) => s + (w.duration ?? 0), 0);
const report = {
  sequences: sources.length, withSound: Object.keys(emotes).length, silent: sources.filter(s => !emotes[s]),
  cues: cueList.length, byKind: cueList.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {}),
  syncLoops: cueList.filter(c => c.attack).length, randomCues: cueList.filter(c => c.variants.length > 1).length,
  skippedVocalizations: Object.values(skipped).flat().length,
  waves: waves.size, audioSeconds: +seconds.toFixed(1), bytes, megabytes: +(bytes / 1048576).toFixed(2), bitrate,
  windowsCuttingTheirSound: cut.map(c => `${c.source} @${c.start}: window ${c.duration}s, ${c.sound}`),
  clipEndsBeforeWindow: cueList.filter(c => c.kind === "window" && c.start + c.duration > (clipLength.get(c.source) ?? Infinity) + 1e-3).map(c => `${c.source} @${c.start}`),
  encodedDurationMinusSource: { checked: encodedDrift.length, min: Math.min(...encodedDrift), max: Math.max(...encodedDrift) },
};
writeFileSync(`${out}.report.json`, JSON.stringify(report, null, 1));
console.log(`${report.withSound}/${report.sequences} animations with sound, ${report.cues} cues (${JSON.stringify(report.byKind)}), ` +
  `${report.waves} waves, ${report.audioSeconds} s of audio, ${report.megabytes} MB at ${bitrate} kbps`);
console.log(`silent: ${report.silent.join(", ") || "none"}; voice notifies skipped: ${report.skippedVocalizations}; windows cutting their sound: ${cut.length}`);
console.log(`encoded minus source duration: ${report.encodedDurationMinusSource.min.toFixed(4)}..${report.encodedDurationMinusSource.max.toFixed(4)} s; report: ${out}.report.json`);
