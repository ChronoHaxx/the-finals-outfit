// Offline census of the player-number route (src/rig/PlayerNumber.ts) over an asset index's recovered programs.
// Reads public files only; writes nothing unless --out is given.
//
//   node --import tsx scripts/check-player-number.mjs [--index public/models/reconstructed-assemblies-v1/assets.json]
//        [--only names.json]   restrict to these material keys (a JSON array or an object keyed by MI name)
//        [--authored a.json]   {MI name: {decalNumber}} from the MI exports, to cross-check the detected number
//        [--out report.json]
//
// For every material manifest whose program binds a T_Decal_NumbersAtlas_* texture it reports whether the route
// found the atlas arithmetic, the number it found, and (with --authored) whether that equals the item's DecalNumber
// (master default 32). A rewrite is also run, so an unmatched expression fails here rather than in the browser.
//
// Behaviour (22 Nov 2026): for each site the original folded expressions and the rewritten ones are evaluated over a
// grid of decal-local u (float32, Direct3D max/min) and compared with the game's assembly (referenceAtlasU):
// the original must print its authored number, and the rewrite must print 0, 5, 7, 10, 32, 99 and the authored number
// exactly as the game does. A site that differs is reported as "behaviour" and fails the run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluatePlayerNumberNode, findPlayerNumberSites, playerNumberLanes, referenceAtlasU, rewritePlayerNumberGlsl }
  from "../src/rig/PlayerNumber.ts";

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

const U_GRID = Array.from({ length: 41 }, (_, i) => -0.05 + i * 0.0275); // past both edges of the decal
const NUMBERS = [0, 5, 7, 10, 32, 99];
function behaviour(glsl, program) {
  const failures = [];
  const rewritten = rewritePlayerNumberGlsl(glsl, program);
  for (const site of program.sites) {
    for (const u of U_GRID) {
      const original = evaluatePlayerNumberNode(glsl, site.atlasNode, { [site.uNode]: u });
      if (original !== referenceAtlasU(u, program.authored))
        failures.push(`original ${site.atlasNode} u=${u}: ${original} != ${referenceAtlasU(u, program.authored)}`);
      for (const n of [...NUMBERS, program.authored]) {
        const live = evaluatePlayerNumberNode(rewritten, site.atlasNode, { [site.uNode]: u }, playerNumberLanes(n));
        if (live !== referenceAtlasU(u, n)) failures.push(`N=${n} ${site.atlasNode} u=${u}: ${live} != ${referenceAtlasU(u, n)}`);
      }
    }
  }
  return failures;
}

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
  const failures = behaviour(glsl, program);
  let coverageSites = 0;
  if (manifest.coverageShader) {
    const coverage = readFileSync(resolve(dirname(manifestPath), manifest.coverageShader), "utf8");
    const covered = findPlayerNumberSites(coverage);
    if (covered) { failures.push(...behaviour(coverage, covered).map((f) => `coverage ${f}`)); coverageSites = covered.sites.length; }
  }
  rows.push({ name, status: failures.length ? "behaviour" : "matched", authored: program.authored, sites: program.sites.length,
    coverageSites, failures: failures.slice(0, 5), expected, agrees: expected === undefined ? undefined : expected === program.authored });
}

const count = (predicate) => rows.filter(predicate).length;
const summary = {
  index: indexPath,
  manifests: rows.length,
  withAtlas: count((r) => r.status !== "no-atlas" && r.status !== "missing-manifest"),
  matched: count((r) => r.status === "matched"),
  behaviour: count((r) => r.status === "behaviour"),
  unmatched: count((r) => r.status === "unmatched"),
  disagreesWithAuthored: count((r) => r.agrees === false),
  missingManifest: count((r) => r.status === "missing-manifest"),
};
console.log(JSON.stringify(summary, null, 2));
for (const row of rows.filter((r) => r.status === "unmatched" || r.status === "behaviour" || r.agrees === false)) {
  console.log(`${row.status}${row.agrees === false ? " DISAGREES" : ""}: ${row.name} found=${row.authored ?? "-"} expected=${row.expected ?? "-"}`);
  for (const failure of row.failures ?? []) console.log(`  ${failure}`);
}
const out = option("--out");
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
if (summary.disagreesWithAuthored || summary.behaviour) process.exitCode = 1;
