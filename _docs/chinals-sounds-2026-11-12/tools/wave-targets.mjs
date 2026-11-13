#!/usr/bin/env node
// Chinals emote sounds (12 Nov 2026): the SoundWave packages the exported sound assets can reach, for the probe's
// json and sound passes over the waves. Deliberately over-inclusive (every SoundWave reference anywhere in the
// package, plus the package itself when it is a SoundWave): an extra wave exported costs nothing, and the exact
// resolution happens later in build-emote-sounds.mjs, which throws on any graph it does not reproduce.
//
// Usage: node wave-targets.mjs <json-sound dir> <targets-sounds.txt> <out targets-waves.txt>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, targets, out] = process.argv.slice(2);
if (!out) throw new Error("usage: wave-targets.mjs <json-sound dir> <targets-sounds.txt> <out targets-waves.txt>");
const pkg = objectPath => objectPath.replace(/^\/Game\//, "Discovery/Content/").replace(/\.[^./]+$/, "") + ".uasset";
const waves = new Set(), report = [];
for (const target of readFileSync(targets, "utf8").split(/\r?\n/).filter(Boolean)) {
  const file = join(dir, target.replace(/\.uasset$/, ".json"));
  if (!existsSync(file)) { report.push({ target, error: "no JSON" }); continue; }
  const exports = JSON.parse(readFileSync(file, "utf8"));
  const found = new Set();
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (typeof node.ObjectName === "string" && node.ObjectName.startsWith("SoundWave'") && node.ObjectPath) found.add(pkg(node.ObjectPath));
    if (node.SoundWaveAssetPtr?.AssetPathName) found.add(pkg(node.SoundWaveAssetPtr.AssetPathName));
    Object.values(node).forEach(visit);
  };
  visit(exports);
  if (exports.some(e => e.Type === "SoundWave")) found.add(target);
  found.forEach(w => waves.add(w));
  report.push({ target: target.split("/").at(-1), types: [...new Set(exports.map(e => e.Type))].join(","), waves: found.size });
}
writeFileSync(out, [...waves].sort().join("\n") + "\n");
console.table(report);
console.log(`${waves.size} waves -> ${out}`);
