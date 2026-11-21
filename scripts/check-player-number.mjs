// Offline census of the player-number route (src/rig/PlayerNumber.ts) over an asset index's recovered programs.
// Reads public files only; writes nothing unless --out is given.
//
//   node --import tsx scripts/check-player-number.mjs [--index public/models/reconstructed-assemblies-v1/assets.json]
//        [--only names.json]   restrict to these material keys (a JSON array or an object keyed by MI name)
//        [--authored a.json]   {MI name: {decalNumber}} from the MI exports, to cross-check the detected number
//        [--out report.json]
//
// For every material manifest whose program binds a T_Decal_NumbersAtlas_* texture it reports whether the route
// found the lanes, the number it found, and (with --authored) whether that equals the item's DecalNumber (master
// default 32). A rewrite is also run, so an unmatched lane count fails here rather than in the browser.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findPlayerNumberSites, rewritePlayerNumberGlsl } from "../src/rig/PlayerNumber.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const indexPath = resolve(option("--index", "public/models/reconstructed-assemblies-v1/assets.json"));
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const onlyPath = option("--only");
const only = onlyPath ? new Set(Object.keys(JSON.parse(readFileSync(onlyPath, "utf8")))) : undefined;
const authoredPath = option("--authored");
const authored = authoredPath ? JSON.parse(readFileSync(authoredPath, "utf8")) : undefined;

const rows = [];
const seen = new Set();
for (const [key, manifestUrl] of Object.entries(index.materials)) {
  const name = key.split(".").pop();
  if (only && !only.has(name) && !only.has(key)) continue;
  if (typeof manifestUrl !== "string") continue;
  const manifestPath = resolve(dirname(indexPath), manifestUrl);
  if (seen.has(manifestPath)) continue;
  seen.add(manifestPath);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { rows.push({ name, status: "missing-manifest" }); continue; }
  const atlases = (manifest.textures ?? []).map((t) => t.source ?? "").filter((s) => /NumbersAtlas/i.test(s));
  if (!atlases.length) { rows.push({ name, status: "no-atlas" }); continue; }
  const glsl = readFileSync(resolve(dirname(manifestPath), manifest.shader), "utf8");
  const program = findPlayerNumberSites(glsl);
  const expected = authored ? (authored[name]?.decalNumber ?? 32) : undefined;
  if (!program) { rows.push({ name, status: "unmatched", expected, atlases }); continue; }
  rewritePlayerNumberGlsl(glsl, program);
  if (manifest.coverageShader) {
    const coverage = readFileSync(resolve(dirname(manifestPath), manifest.coverageShader), "utf8");
    const covered = findPlayerNumberSites(coverage);
    if (covered) rewritePlayerNumberGlsl(coverage, covered);
  }
  rows.push({ name, status: "matched", authored: program.authored, sites: program.sites.length, expected,
    agrees: expected === undefined ? undefined : expected === program.authored });
}

const count = (predicate) => rows.filter(predicate).length;
const summary = {
  index: indexPath,
  manifests: rows.length,
  withAtlas: count((r) => r.status !== "no-atlas" && r.status !== "missing-manifest"),
  matched: count((r) => r.status === "matched"),
  unmatched: count((r) => r.status === "unmatched"),
  disagreesWithAuthored: count((r) => r.agrees === false),
  missingManifest: count((r) => r.status === "missing-manifest"),
};
console.log(JSON.stringify(summary, null, 2));
for (const row of rows.filter((r) => r.status === "unmatched" || r.agrees === false))
  console.log(`${row.status}${row.agrees === false ? " DISAGREES" : ""}: ${row.name} found=${row.authored ?? "-"} expected=${row.expected ?? "-"}`);
const out = option("--out");
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
if (summary.disagreesWithAuthored) process.exitCode = 1;
