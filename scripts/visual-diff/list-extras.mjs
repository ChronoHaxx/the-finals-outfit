import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync("scripts/asset-sources.generated.json", "utf8"));
let n = 0;
for (const a of j.assets) {
  if (!a.extraParts) continue;
  n++;
  console.log(a.src);
  for (const e of a.extraParts) console.log("    + " + e);
}
console.log("--- pieces with extraParts: " + n);
