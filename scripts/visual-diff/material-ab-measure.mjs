import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const cohort = JSON.parse(readFileSync(resolve(root, "scripts/material-ab-cohort.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(root, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((item) => [item.id, item]));
const out = resolve(root, "visual-diff/out/ab");

async function raw(path) {
  const image = sharp(path);
  const meta = await image.metadata();
  const data = await image.raw().toBuffer();
  return { width: meta.width, height: meta.height, data };
}

const results = [];
for (const entry of cohort) {
  const before = await raw(join(out, `${entry.id}.before.png`));
  const after = await raw(join(out, `${entry.id}.after.png`));
  const sameSize = before.width === after.width && before.height === after.height;
  if (!sameSize) {
    results.push({ id: entry.id, category: entry.category, before: [before.width, before.height], after: [after.width, after.height], valid: false });
    continue;
  }
  let sum = 0;
  let changed = 0;
  let visibleChanged = 0;
  const pixels = before.width * before.height;
  for (let i = 0; i < before.data.length; i += 3) {
    const dr = Math.abs(before.data[i] - after.data[i]);
    const dg = Math.abs(before.data[i + 1] - after.data[i + 1]);
    const db = Math.abs(before.data[i + 2] - after.data[i + 2]);
    const max = Math.max(dr, dg, db);
    sum += dr + dg + db;
    if (max > 0) changed++;
    if (max >= 5) visibleChanged++;
  }
  results.push({
    id: entry.id,
    category: entry.category,
    slot: byId.get(entry.id)?.slot,
    before: [before.width, before.height],
    after: [after.width, after.height],
    valid: true,
    meanAbsRgb: Number((sum / (pixels * 3)).toFixed(2)),
    changedPixelsPct: Number((100 * changed / pixels).toFixed(2)),
    visibleChangedPixelsPct: Number((100 * visibleChanged / pixels).toFixed(2)),
  });
}
const report = { generatedAt: new Date().toISOString(), results };
writeFileSync(resolve(out, "measurements.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
