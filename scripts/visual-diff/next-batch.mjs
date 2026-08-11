// Print the next batch of census items that still need a vision verdict (or need re-judging).
// Usage: node scripts/visual-diff/next-batch.mjs [n=20] [slot]
//   - skips ids already in the ledger (visual-diff/audit/verdicts.generated.json)
//   - skips ids with no render on disk (visual-diff/audit/<id>.render.png) — render first
//   - optional slot filter keeps judge batches homogeneous
// Output: JSON array of [id, slot] + a human line with remaining counts.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SD = dirname(fileURLToPath(import.meta.url));
const AUDIT = resolve(SD, "../../visual-diff/audit");
const LEDGER = resolve(SD, "verdicts.generated.json");
const list = JSON.parse(readFileSync(resolve(SD, "census-list.generated.json"), "utf8"));
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};

const n = Number(process.argv[2] ?? 20);
const slotFilter = process.argv[3];

const pending = list.filter(([id, slot]) => !ledger[id] && (!slotFilter || slot === slotFilter));
const ready = pending.filter(([id]) => existsSync(resolve(AUDIT, `${id}.render.png`)));
console.log(JSON.stringify(ready.slice(0, n)));
console.error(
  `pending(unjudged): ${pending.length}  rendered&ready: ${ready.length}  unrendered: ${pending.length - ready.length}  ledger: ${Object.keys(ledger).length}/${list.length}`,
);
