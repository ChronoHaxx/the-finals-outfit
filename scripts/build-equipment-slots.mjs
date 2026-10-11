// Rebuild only from extracted game Slots, never garment names. No assets are copied.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/items.json'), 'utf8'));
const definitions = path.resolve(process.argv[2] ?? path.join(root, 'public/models/reconstructed-assembly-v2/items'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [], missing = [];
for (const item of catalog) {
  const file = path.join(definitions, `${item.id}.json`);
  if (!fs.existsSync(file)) { missing.push(item.id); continue; }
  const bytes = fs.readFileSync(file), definition = JSON.parse(bytes);
  const slots = definition.properties?.Slots;
  if (!Array.isArray(slots) || !slots.every(s => typeof s === 'string' && s.startsWith('EBodySlot::')))
    throw new Error(`Invalid source Slots: ${item.id}`);
  rows.push({ id: item.id, slot: item.slot, slots: [...new Set(slots)], definitionSha256: sha(bytes),
    source: definition.source, sourceSha256: definition.sourceSha256, propertiesSha256: definition.propertiesSha256 });
}
const fullBody = rows.filter(r => r.slots.includes('EBodySlot::BodyUpper') && r.slots.includes('EBodySlot::BodyLower'));
const relevant = new Set(fullBody.flatMap(r => r.slots));
const inputSha256 = sha(JSON.stringify(rows.map(r => [r.id, r.slot, r.definitionSha256])));
const data = { version: 1, policy: 'source-full-body-occupancy-v1', inputSha256,
  fullBody: fullBody.map(r => r.id).sort(),
  slotsByItem: Object.fromEntries(rows.flatMap(r => {
    const slots = r.slots.filter(s => relevant.has(s));
    return slots.length ? [[r.id, slots]] : [];
  })) };
fs.writeFileSync(path.join(root, 'src/data/source-equipment-slots.json'), JSON.stringify(data) + '\n');
const report = { inputSha256, catalogItems: catalog.length, definitions: rows.length, missing,
  multipleSourceSlots: rows.filter(r => r.slots.length > 1).length,
  fullBodyItems: fullBody.length, relevantItemCount: Object.keys(data.slotsByItem).length,
  policy: data.policy, fullBody, sourceDefinitions: rows };
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ inputSha256, catalogItems: catalog.length, definitions: rows.length, missing,
  multipleSourceSlots: report.multipleSourceSlots, fullBodyItems: fullBody.length, relevantItemCount: report.relevantItemCount }));
