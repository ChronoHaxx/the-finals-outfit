// Export lists for the emote sounds of a clip set (21 Nov 2026), using scripts/anim-export/sound-cues.mjs:
//   node _docs/all-emotes-2026-11-21/sound-targets.mjs sounds --manifest <manifest> --seqs <json dir> --out <targets.txt>
//     the sound assets (SoundCue / MetaSoundSource / SoundWave) the clips' sound notifies name;
//   node _docs/all-emotes-2026-11-21/sound-targets.mjs waves --sounds <json dir of those assets> --out <targets.txt>
//     the SoundWaves those cues reach (export them with json mode and sound mode).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { packagePath, sequenceSoundNotifies, soundVariants } from "../../scripts/anim-export/sound-cues.mjs";

const [mode, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((pairs, arg, i, all) => arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const toUasset = objectPath => `${packagePath(objectPath)}.uasset`;
const targets = new Set();
if (mode === "sounds") {
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), "utf8"));
  const sources = new Set(manifest.clips.map(c => c.source.toLowerCase()));
  for (const file of walk(resolve(args.seqs)).filter(f => sources.has(basename(f, ".json").toLowerCase())))
    for (const notify of sequenceSoundNotifies(JSON.parse(readFileSync(file, "utf8")))) if (notify.sound) targets.add(toUasset(notify.sound));
} else if (mode === "waves") {
  for (const file of walk(resolve(args.sounds)).filter(f => f.endsWith(".json"))) {
    const exports = JSON.parse(readFileSync(file, "utf8"));
    const self = exports.find(e => e.Type === "SoundWave");
    if (self) { targets.add(`${file.replace(/\\/g, "/").split("/Discovery/Content/")[1] ? "Discovery/Content/" + file.replace(/\\/g, "/").split("/Discovery/Content/")[1].replace(/\.json$/, ".uasset") : ""}`); continue; }
    for (const v of soundVariants(exports).variants) if (v.waveRef) targets.add(toUasset(v.waveRef));
  }
  targets.delete("");
} else throw new Error("mode: sounds | waves");
writeFileSync(resolve(args.out), [...targets].sort().join("\n") + "\n");
console.log(`${targets.size} ${mode === "sounds" ? "sound assets" : "waves"} -> ${args.out}`);
