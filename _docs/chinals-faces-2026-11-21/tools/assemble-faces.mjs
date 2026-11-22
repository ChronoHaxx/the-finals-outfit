#!/usr/bin/env node
// The Chinals faces set (21 Nov 2026): the live global head rig byte for byte, plus the Chinals clips' face curves.
//
// Chinals mode plays its emotes on global heads, and compare-rigs.mjs found the Chinals face rig identical to the global
// one (the 25 shared pose files convert byte-identical; head bones within 0.0001 cm). So the heads, poses, cage skins
// and masks are copied from the live global faces set, and only the curves come from the Chinals clips (build-face.mjs
// output, which clamps, key-reduces and spells each curve as its pose). Copying instead of rebuilding keeps the files a
// Chinals visitor downloads identical to the ones the global mode serves for the same head.
//
// Usage (worktree root, any shell with Node):
//   node _docs/chinals-faces-2026-11-21/tools/assemble-faces.mjs --global <global faces dir> --curves <build-face output>
//     --from <URL the global set was fetched from> --out <new dir>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const k of ["global", "curves", "from", "out"]) if (!args[k]) throw new Error(`--${k} is required`);
const out = resolve(args.out);
if (existsSync(out)) throw new Error(`${out} exists; runs are kept`);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const globalDir = resolve(args.global), curvesDir = resolve(args.curves);
const globalIndex = read(join(globalDir, "faces.json")), built = read(join(curvesDir, "faces.json"));

const copy = (from, rel) => { mkdirSync(dirname(join(out, rel)), { recursive: true }); copyFileSync(join(from, rel), join(out, rel)); };
const rig = new Set([...Object.values(globalIndex.heads), ...Object.values(globalIndex.wraps ?? {}), ...Object.values(globalIndex.masks ?? {})]);
for (const rel of Object.values(globalIndex.heads)) rig.add(read(join(globalDir, rel)).pose);
for (const rel of rig) copy(globalDir, rel);
for (const source of built.curves) copy(curvesDir, `curves/${source}.json`);

const index = {
  formatVersion: 1, generatedAt: new Date().toISOString(), tool: "_docs/chinals-faces-2026-11-21/tools/assemble-faces.mjs",
  heads: globalIndex.heads, curves: built.curves, wraps: globalIndex.wraps ?? {}, masks: globalIndex.masks ?? {},
  report: {
    rig: { copiedFrom: args.from, generatedAt: globalIndex.generatedAt, files: rig.size },
    curves: { tool: built.tool, generatedAt: built.generatedAt, clipSources: built.report.clipSources,
      withCurves: built.report.withCurves, withoutCurves: built.report.withoutCurves, curveBytes: built.report.curveBytes,
      unmatchedCurves: built.report.unmatchedCurves },
  },
};
writeFileSync(join(out, "faces.json"), JSON.stringify(index, null, 2));
console.log(JSON.stringify({ out, rigFiles: rig.size, curves: built.curves.length, total: rig.size + built.curves.length + 1 }));
