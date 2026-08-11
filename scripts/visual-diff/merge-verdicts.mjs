// Merge a batch of vision-judge verdicts into the persistent census ledger.
// Usage: node scripts/visual-diff/merge-verdicts.mjs <batch.json> [rev-label]
//   batch.json = [{id, score, category, issue, fixableInRepo}, ...]
// Ledger: scripts/visual-diff/verdicts.generated.json  { <id>: {score, category, issue, fixable, rev, at} }
// (tracked in git — renders live in the ignored visual-diff/, but the verdicts must survive)
// Re-merging an id overwrites its verdict (that is the point: re-judge after a fix).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SD = dirname(fileURLToPath(import.meta.url));
const LEDGER = resolve(SD, "verdicts.generated.json");
const [batchFile, rev = "census"] = process.argv.slice(2);
if (!batchFile) throw new Error("usage: merge-verdicts.mjs <batch.json> [rev-label]");

const batch = JSON.parse(readFileSync(batchFile, "utf8"));
mkdirSync(dirname(LEDGER), { recursive: true });
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
let n = 0;
for (const v of Array.isArray(batch) ? batch : []) {
  if (!v || typeof v.id !== "string" || typeof v.score !== "number") continue;
  ledger[v.id] = {
    score: v.score,
    category: v.category ?? "other",
    issue: v.issue ?? "",
    fixable: v.fixableInRepo ?? v.fixable ?? "none",
    rev,
    at: new Date().toISOString().slice(0, 16),
  };
  n++;
}
writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const all = Object.values(ledger);
const scores = all.map((v) => v.score).filter((s) => s >= 0).sort((a, b) => a - b);
console.log(
  `merged ${n} verdicts (${all.length} total; median ${scores[Math.floor(scores.length / 2)] ?? "-"}; pass>=75: ${scores.filter((s) => s >= 75).length}/${scores.length})`,
);
