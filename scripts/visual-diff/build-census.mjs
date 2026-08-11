// Build the full-catalog verification list: every renderable item (3D model OR 2D decal),
// as [id, slot] pairs grouped by slot (keeps camera setup coherent and judge batches homogeneous).
// Usage: node scripts/visual-diff/build-census.mjs   -> writes census-list.generated.json
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SD = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(resolve(SD, "../../src/data/items.json"), "utf8"));

const renderable = items.filter((i) => i.model || i.decal);
const bySlot = new Map();
for (const i of renderable) {
  const g = bySlot.get(i.slot) ?? [];
  g.push(i.id);
  bySlot.set(i.slot, g);
}
const list = [];
for (const slot of [...bySlot.keys()].sort()) {
  for (const id of bySlot.get(slot).sort()) list.push([id, slot]);
}
writeFileSync(resolve(SD, "census-list.generated.json"), JSON.stringify(list, null, 0) + "\n");
const counts = Object.fromEntries([...bySlot.entries()].map(([s, g]) => [s, g.length]));
console.log(`census: ${list.length} renderables (of ${items.length} items)`);
console.log(JSON.stringify(counts, null, 1));
const skipped = items.filter((i) => !i.model && !i.decal);
console.log(`not renderable (no model, no decal): ${skipped.length}`);
