// bake-all.mjs — run bake-composite over every catalog piece (all skins), with the
// streak-free per-base-material defaults. Pieces without a layered Skins/ structure are
// skipped gracefully. Local only (writes public/models/cosmetics/*.webp; does NOT publish).
//
//   node scripts/bake-all.mjs            # all pieces
//   node scripts/bake-all.mjs --from=80  # resume from index 80
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const mbp = JSON.parse(readFileSync(resolve(SCRIPT_DIR, "model-by-piece.generated.json"), "utf8"));
const FROM = Number((process.argv.find((a) => a.startsWith("--from=")) ?? "--from=0").slice(7));

// Only garment-style pieces can have the layered material; skip obvious non-garments to save time.
const SKIP = /(^|\/)(hair|hairs|head|heads|face|beard|facialhair|watch|nail|earring|glasses|mask|attachment|attachments|bodycosmetic)/i;
const keys = Object.keys(mbp).filter((k) => !SKIP.test(k));

console.log(`bake-all: ${keys.length} candidate pieces (from index ${FROM})`);
const summary = { baked: [], skipped: [], failed: [] };
for (let i = FROM; i < keys.length; i++) {
  const key = keys[i];
  const r = spawnSync(process.execPath, ["scripts/bake-composite.mjs", `--piece=${key}`, "--skin=all", "--force"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300000,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const m = /\((\d+) skins\)/.exec(out);
  if (r.status === 0 && m && Number(m[1]) > 0) {
    summary.baked.push({ key, skins: Number(m[1]) });
    console.log(`[${i + 1}/${keys.length}] OK   ${key}  (${m[1]} skins)`);
  } else if (/no matching skins|no asset-sources entry|not in model-by-piece/.test(out)) {
    summary.skipped.push(key);
    console.log(`[${i + 1}/${keys.length}] skip ${key}  (not layered)`);
  } else {
    summary.failed.push({ key, err: out.trim().split("\n").slice(-1)[0]?.slice(0, 120) });
    console.log(`[${i + 1}/${keys.length}] FAIL ${key}`);
  }
}
const totalSkins = summary.baked.reduce((a, b) => a + b.skins, 0);
console.log(`\nDONE: ${summary.baked.length} pieces baked (${totalSkins} skins), ${summary.skipped.length} skipped, ${summary.failed.length} failed`);
writeFileSync(resolve(SCRIPT_DIR, "bake-all.report.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`report -> scripts/bake-all.report.json`);
