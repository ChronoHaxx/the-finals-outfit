// Offline import: public MediaWiki namespace 3002 query/revisions snapshots and
// the user's existing ST_CustomizationItems.json export. No live wiki dependency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [wikiDirectory, localizationFile] = process.argv.slice(2);
if (!wikiDirectory || !localizationFile) throw new Error('Usage: node scripts/import-wiki-catalog.mjs <wiki-pages-directory> <ST_CustomizationItems.json>');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/items.json'), 'utf8'));
const localized = JSON.parse(fs.readFileSync(localizationFile, 'utf8'))[0].StringTable.KeysToEntries;
const idKey = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const nameKey = s => s.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const names = new Map(Object.entries(localized).filter(([key]) => key.endsWith('_ITEM'))
  .map(([key, name]) => [idKey(key.replace(/^ID_CUSTOMIZATION_/, '').replace(/_ITEM$/, '')), name]));
const types = {
  hair: ['HAIR'], facialHair: ['FACIAL HAIR'], face: ['FACE'], eyes: ['EYES'],
  headwear: ['HEADWEAR'], facewear: ['FACEWEAR'], eyewear: ['FACEWEAR'],
  upperBody: ['UPPER BODY'], outerwear: ['UPPER BODY'], lowerBody: ['LOWER BODY'],
  hands: ['HANDS'], feet: ['FEET'], upperBack: ['UPPER BACK', 'PET', 'CROSSBODY'],
  lowerBack: ['LOWER BACK'], wrist: ['WRIST', 'WATCH'], nailPolish: ['NAILS'],
  blush: ['FACE PAINT'], tattoo: ['TATTOO'], earrings: ['EARS'], bodyPaint: ['BODY PAINT'],
};
const pages = [];
let rawCount = 0;
for (const file of fs.readdirSync(wikiDirectory).filter(f => /^\d+\.json$/.test(f)).sort()) {
  const response = JSON.parse(fs.readFileSync(path.join(wikiDirectory, file), 'utf8'));
  rawCount += response.query?.pages?.length ?? 0;
  for (const page of response.query?.pages ?? []) {
    const revision = page.revisions?.[0];
    const text = revision?.slots?.main?.content ?? '';
    if (!/^\s*{{Cosmetic\s*[\n|]/i.test(text)) continue;
    const fields = {};
    for (const match of text.matchAll(/^\s*\|\s*(\w+)\s*=([^\n]*)/gm)) fields[match[1]] = match[2].trim();
    if (!fields.Name || !fields.Type) continue;
    pages.push({ pageId: page.pageid, revisionId: revision.revid, ...fields });
  }
}
// The wiki template treats omitted/blank flags as false. Unknown spellings are
// excluded here instead of silently treating malformed metadata as released.
const visible = p => [p.IsUnreleased, p.IsHidden].every(v => v == null || /^(?:|0|No)$/i.test(v));
const overrides = JSON.parse(fs.readFileSync(path.join(root, 'src/data/wiki-catalog-overrides.json'), 'utf8'));
const outputPath = path.join(root, 'src/data/wiki-catalog.json');
const previous = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')).items : {};
const candidates = [];
const excluded = [];
for (const item of catalog) {
  const gameName = names.get(idKey(item.id));
  const override = overrides[item.id];
  const established = previous[item.id];
  const pageId = override?.pageId ?? established?.pageId;
  const matches = pages.filter(p => types[item.slot]?.includes(p.Type) &&
    (pageId ? p.pageId === pageId : gameName && nameKey(p.Name) === nameKey(gameName)));
  if (matches.length !== 1 || !visible(matches[0])) {
    excluded.push({ id: item.id, reason: !matches.length ? 'unmatched' : matches.length > 1 ? 'ambiguous' : 'wiki-hidden-or-unreleased' });
    continue;
  }
  const p = matches[0];
  candidates.push({ id: item.id, name: p.Name, pageId: p.pageId, revisionId: p.revisionId,
    method: override ? 'reviewed-icon-match' : established?.method ?? 'exact-localized-name', isHidden: false, isUnreleased: false });
}
const pageCounts = new Map();
for (const c of candidates) pageCounts.set(c.pageId, (pageCounts.get(c.pageId) ?? 0) + 1);
const accepted = candidates.filter(c => {
  if (pageCounts.get(c.pageId) === 1) return true;
  const owners = candidates.filter(other => other.pageId === c.pageId
    && (previous[other.id]?.pageId === other.pageId || overrides[other.id]?.pageId === other.pageId));
  if (owners.length > 1) throw new Error(`Conflicting reviewed identities for wiki page ${c.pageId}`);
  if (owners.length === 1 && owners[0].id === c.id) return true;
  excluded.push({ id: c.id, reason: 'multiple-game-items-for-wiki-page' });
  return false;
});
const snapshot = JSON.parse(fs.readFileSync(path.join(wikiDirectory, '../wiki-snapshot.json'), 'utf8'));
// Some namespace pages are redirects or lack the cosmetic template.
if (!snapshot.complete || rawCount !== snapshot.count) throw new Error('Incomplete wiki snapshot');
const output = { schemaVersion: 1, retrievedAt: snapshot.at, source: 'https://www.thefinals.wiki/',
  items: Object.fromEntries(accepted.map(({ id, ...entry }) => [id, entry])) };
fs.writeFileSync(path.join(root, 'src/data/wiki-catalog.json'), JSON.stringify(output, null, 2) + '\n');
const reportDirectory = path.join(root, 'scripts/generated');
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, 'wiki-catalog-unmatched.json'), JSON.stringify(excluded, null, 2));
console.log(JSON.stringify({ wikiPages: snapshot.count, publicItems: accepted.length, developerOnly: excluded.length,
  bySlot: Object.fromEntries(Object.keys(types).map(slot => [slot, accepted.filter(c => catalog.find(i => i.id === c.id)?.slot === slot).length])) }, null, 2));
