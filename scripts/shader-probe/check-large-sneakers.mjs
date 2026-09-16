// Independent checks of the Large Sneakers additive preview; reads only, writes one report.
// node scripts/shader-probe/check-large-sneakers.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const DOCS = '_docs/large-sneakers-2026-09-13', WORK = 'scripts/generated/shader-probe/large-sneakers-v1';
const ACTIVE = 'public/models/reconstructed-assemblies-v1', PREVIEW = 'public/models/reconstructed-large-sneakers-preview-v1';
const RUNTIME = 'public/models/reconstructed-large-sneakers-v1';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const failures = [], report = {};
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
const URL_KEYS = new Set(['url', 'bodyMaskUrl', 'bodyUrl']);
const resolveUrls = (value, folder, key) => {
  if (typeof value === 'string') return URL_KEYS.has(key) ? path.resolve(folder, value) : value;
  if (Array.isArray(value)) return value.map(v => resolveUrls(v, folder));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveUrls(v, folder, k)]));
  return value;
};
const resolveAssets = (doc, folder) => ({ ...resolveUrls(doc, folder),
  materials: Object.fromEntries(Object.entries(doc.materials).map(([k, v]) => [k, path.resolve(folder, v)])),
  ...(doc.materialVariants ? { materialVariants: Object.fromEntries(Object.entries(doc.materialVariants).map(([k, v]) => [k, path.resolve(folder, v)])) } : {}) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Frozen active/product files.
const frozen = read(`${DOCS}/frozen-baseline.json`);
report.frozenBaseline = Object.entries(frozen.hashes).map(([file, digest]) => ({ file, unchanged: check(sha(file) === digest, `Protected file changed: ${file}`) }));

// 2. Additive assets index.
const cohort = read(`${DOCS}/resolved-cohort.json`), preview = read(`${PREVIEW}/preview.json`);
const implemented = preview.implemented, deferred = cohort.items.map(i => i.id).filter(id => !implemented.includes(id));
const active = Object.fromEntries(['assets.json', 'skin-pairs.json', 'supported-items.json'].map(f => [f, read(`${ACTIVE}/${f}`)]));
const next = Object.fromEntries(['assets.json', 'skin-pairs.json', 'supported-items.json'].map(f => [f, read(`${PREVIEW}/${f}`)]));
const a = resolveAssets(active['assets.json'], ACTIVE), b = resolveAssets(next['assets.json'], PREVIEW);
for (const field of ['meshes', 'materials', 'materialVariants']) {
  for (const [key, value] of Object.entries(a[field] ?? {})) check(same(value, b[field]?.[key]), `Baseline ${field} binding changed: ${key}`);
}
for (const key of Object.keys(a)) if (!['meshes', 'materials', 'materialVariants'].includes(key)) check(same(a[key], b[key]), `Baseline assets field changed: ${key}`);
const addedMeshes = Object.keys(b.meshes).filter(k => !(k in a.meshes)), addedMaterials = Object.keys(b.materials).filter(k => !(k in a.materials));
const expectedMaterials = [...new Set(cohort.items.filter(i => implemented.includes(i.id)).flatMap(i => i.materials))].sort();
check(same(addedMeshes, cohort.meshes), 'Added meshes are not exactly the Large Sneakers mesh');
check(same([...addedMaterials].sort(), expectedMaterials), 'Added materials are not exactly the implemented choices\' materials');
check(addedMaterials.every(k => typeof next['assets.json'].materials[k] === 'string'), 'assets.materials values must be URL strings');
const mesh = next['assets.json'].meshes[cohort.meshes[0]];
check(sha(path.resolve(PREVIEW, mesh.url)) === mesh.sha256, 'Mesh binding hash differs from its file');
check(same(mesh.slots, cohort.sourceSlots), 'Mesh binding slots differ from the source DTO');
report.assets = { addedMeshes, addedMaterials: addedMaterials.length, mesh: { url: mesh.url, sha256: mesh.sha256, bodyMaskUrl: mesh.bodyMaskUrl, bodyMaskUvTiles: mesh.bodyMaskUvTiles } };
check(same(resolveUrls(active['skin-pairs.json'], ACTIVE), resolveUrls(next['skin-pairs.json'], PREVIEW)), 'Skin pairs changed');

// 3. Supported items and resolver delta.
const sa = active['supported-items.json'], sb = next['supported-items.json'];
check(same(sb.items, [...sa.items, ...implemented]), 'Advertised items are not baseline plus implemented');
const readyA = new Map(sa.ready.map(r => [r.id, r])), readyB = new Map(sb.ready.map(r => [r.id, r]));
for (const [id, row] of readyA) check(same(resolveUrls(row, ACTIVE), resolveUrls(readyB.get(id), PREVIEW)), `Baseline ready entry changed: ${id}`);
check(same([...readyB.keys()].filter(id => !readyA.has(id)), implemented), 'New ready entries are not exactly implemented');
check(sa.exceptions.filter(e => !implemented.includes(e.id)).length === sb.exceptions.length, 'Exceptions changed beyond implemented');
const before = new Set(read(`${WORK}/resolver/before.json`).ready.map(r => r.id)), after = new Set(read(`${WORK}/resolver/after.json`).ready.map(r => r.id));
const gained = [...after].filter(id => !before.has(id)), lost = [...before].filter(id => !after.has(id));
check(same(gained.sort(), [...implemented].sort()) && !lost.length, 'Resolver delta is not exactly the implemented IDs');
const unadvertised = [...after].filter(id => !sb.items.includes(id));
check(same(unadvertised, ['medieval-knightpantsnoskirt-cotton-ultimate']), 'Unadvertised structurally ready set changed');
for (const id of implemented) {
  const row = readyB.get(id), item = cohort.items.find(i => i.id === id);
  check(row.parts.length === 1 && row.parts[0].sourceMesh === cohort.meshes[0], `Unexpected parts: ${id}`);
  check(same(Object.values(row.parts[0].materials).map(m => m.source), item.materials), `Unexpected material binding: ${id}`);
  check(!!row.parts[0].bodyMaskUrl, `No body coverage: ${id}`);
}
report.supported = { before: sa.items.length, after: sb.items.length, structuralBefore: before.size, structuralAfter: after.size, gained, lost, unadvertised };

// 4. Every referenced file exists.
const urls = new Set();
const collect = (value, key) => {
  if (typeof value === 'string') { if (URL_KEYS.has(key)) urls.add(value); return; }
  if (Array.isArray(value)) value.forEach(v => collect(v)); else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, k));
};
collect(next['assets.json']); collect(next['skin-pairs.json']); collect(sb);
Object.values(next['assets.json'].materials).forEach(u => urls.add(u)); Object.values(next['assets.json'].materialVariants ?? {}).forEach(u => urls.add(u));
const missing = [...urls].filter(u => !fs.statSync(path.resolve(PREVIEW, u), { throwIfNoEntry: false })?.isFile());
check(!missing.length, `Missing referenced files: ${missing.slice(0, 5)}`);
for (const key of addedMaterials) {
  const file = path.resolve(PREVIEW, next['assets.json'].materials[key]), manifest = read(file), folder = path.dirname(file);
  check(`/Game/${''}`.length && key.endsWith('.' + manifest.sourceInstance), `Material manifest instance differs: ${key}`);
  for (const name of [manifest.shader, ...manifest.textures.map(t => t.file)]) check(fs.existsSync(path.join(folder, name)), `Missing material payload ${name}`);
}
report.references = { urls: urls.size, missing: missing.length };

// 5. CPU/GPU parity for exactly the staged materials.
const cpu = read(`${WORK}/validation-implemented/translation-checks.json`), gpu = read(`${WORK}/validation-implemented/webgl-checks.json`);
const gpuRun = read(`${WORK}/validation/webgl-run.json`);
check(sha(`${WORK}/validation/webgl-checks.json`) === gpuRun.checksSha256 && sha(`${WORK}/validation/translation-fixtures.json`) === gpuRun.fixturesSha256, 'GPU run does not belong to current fixtures');
for (const row of cpu) { const g = gpu.find(x => x.itemId === row.itemId); check(g && !g.error && g.cases === row.cases && row.cases > 0, `CPU/GPU mismatch ${row.itemId}`); }
report.shaders = { materials: cpu.length, cpuCases: cpu.reduce((s, r) => s + r.cases, 0), gpuCases: gpu.reduce((s, r) => s + r.cases, 0),
  maxGpuError: Math.max(...gpu.map(r => r.maxAbsoluteError)), gpuResult: gpuRun.result };

// 6. Coverage: both poses, tiles, mask pixels, and containment in the taller Tactical Boots mask.
const derived = read(`${RUNTIME}/coverage/derived-coverage.json`), record = derived.records[0];
check(same(record.poseCounts.map(p => p.pose), ['a', 'idle']) && same(record.uvTiles, [2, 1]) && same(mesh.bodyMaskUvTiles, [2, 1]), 'Coverage poses/tiles unexpected');
const mask = async file => { const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const sneakers = await mask(`${RUNTIME}/coverage/${record.file}`), boots = await mask('public/models/reconstructed-tactical-boots-v1/coverage/SK_Military_TacticalBoots_M.bodymask.png');
let on = 0, insideBoots = 0, bootsOn = 0; const tiles = [{}, {}];
for (let y = 0; y < sneakers.info.height; y++) for (let x = 0; x < sneakers.info.width; x++) {
  const i = (y * sneakers.info.width + x) * sneakers.info.channels;
  if (boots.data[i] > 0) bootsOn++;
  if (!sneakers.data[i]) continue;
  on++; if (boots.data[i] > 0) insideBoots++;
  const t = tiles[x < sneakers.info.height ? 0 : 1];
  t.pixels = (t.pixels ?? 0) + 1; t.minX = Math.min(t.minX ?? x, x); t.maxX = Math.max(t.maxX ?? x, x); t.minY = Math.min(t.minY ?? y, y); t.maxY = Math.max(t.maxY ?? y, y);
}
check(on === record.coveredPixels, 'Mask pixel count differs from its record');
report.coverage = { file: record.file, sha256: record.sha256, poseCounts: record.poseCounts, coveredTriangles: record.coveredTriangles, pixels: on,
  tiles, bootsPixels: bootsOn, insideTacticalBootsMask: insideBoots, insideFraction: insideBoots / on, bodySha256: derived.bodySha256 };

// 7. Dispositions.
const audit = read(`${WORK}/surface-audit.json`), errors = read(`${RUNTIME}/staging/build-errors.json`);
const byMaterial = Object.fromEntries(cohort.items.map(i => [i.id, i.materials[0]]));
report.dispositions = cohort.items.map(i => {
  const instance = byMaterial[i.id].split('.').pop(), row = audit.find(r => r.instance === instance);
  return { id: i.id, status: implemented.includes(i.id) ? 'implemented' : 'deferred', material: byMaterial[i.id], root: row.root,
    blockers: [...new Set([...row.blockers, ...errors.filter(e => e.instance === instance).map(e => e.error)])],
    ...(row.discardAlphaNeutral ? { opacityEvidence: { alpha: row.discardAlphaRanges, clip: row.clipTail } } : {}) };
});
check(report.dispositions.filter(d => d.status === 'deferred').every(d => d.blockers.length), 'A deferred choice lacks a blocker');
report.counts = { cohort: cohort.items.length, implemented: implemented.length, deferred: deferred.length };
report.failures = failures;
fs.writeFileSync(`${DOCS}/opus-check.json`, JSON.stringify({ at: new Date().toISOString(), passed: !failures.length, ...report }, null, 2) + '\n');
console.log(JSON.stringify({ passed: !failures.length, failures, counts: report.counts, supported: report.supported, coverage: { ...report.coverage, tiles: report.coverage.tiles }, shaders: report.shaders }, null, 1));
process.exitCode = failures.length ? 1 : 0;
