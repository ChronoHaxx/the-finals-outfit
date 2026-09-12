// Re-run the viewer's own resolver against a preview index and report the exact difference
// from the current index. Availability here means every active part has its preserved mesh
// and source material bindings on disk; fitting and appearance are decided elsewhere.
// Run with `node --import tsx` so the real source resolver can be imported.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { resolveSourceOutfit, resolveSourceRigParts } = await import(pathToFileURL(path.resolve('src/rig/SourceAssembly.ts')));

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const fail = message => { throw new Error(message); };
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
  return value;
};
const list = (name) => { const value = flag(name); return value ? value.split(',').filter(Boolean) : []; };

const previewDir = path.resolve(flag('preview', 'public/models/reconstructed-coverage-a-preview-v1'));
const baseDir = path.resolve(flag('base', 'public/models/reconstructed-assemblies-v1'));
const definitionsPath = flag('definitions', 'public/models/reconstructed-assembly-v2/customization.json');
const cohortPath = flag('cohort', 'scripts/generated/shader-probe/coverage-sprint-a-01/cohort.json');
const reportPath = path.resolve(flag('report', 'scripts/generated/shader-probe/coverage-sprint-a-integration-01/preview-coverage.json'));
const writeIndex = !argv.includes('--no-write-index');

const data = read(definitionsPath);
const catalog = new Map(read('src/data/items.json').map(item => [item.id, item]));
const previewAssets = read(path.join(previewDir, 'assets.json'));
const baseAssets = read(path.join(baseDir, 'assets.json'));
const cohort = read(cohortPath);

// Availability is only meaningful if the files behind it exist. Check each unique url once.
const checked = new Map();
const exists = (dir, url) => {
  const resolved = path.resolve(dir, url);
  if (!checked.has(resolved)) checked.set(resolved, fs.existsSync(resolved) && fs.statSync(resolved).isFile());
  return checked.get(resolved);
};
const dependencies = (dir, url, trail) => {
  const missing = exists(dir, url) ? [] : [`${trail}: ${url}`];
  if (missing.length || !url.endsWith('.json')) return missing;
  const file = path.resolve(dir, url), folder = path.dirname(file);
  let manifest;
  try { manifest = read(file); } catch (error) { return [`${trail}: unreadable ${url} (${error.message})`]; }
  if (!manifest?.shader || !Array.isArray(manifest.textures)) return missing;
  const files = [manifest.shader, ...(manifest.coverageShader ? [manifest.coverageShader] : []),
    ...manifest.textures.map(t => t.file)];
  return files.filter(f => !exists(folder, f)).map(f => `${trail}: ${url} -> ${f}`);
};

const resolveAll = (assets, dir) => {
  const items = [], ready = [], exceptions = [], broken = [];
  for (const [id, name] of Object.entries(data.catalog)) {
    const item = catalog.get(id);
    if (!item) continue;
    const definition = { ...data.definitions[name], id, formatVersion: 1 };
    const source = resolveSourceOutfit([definition], ['Customization.Archetype.Medium']).items[id];
    try {
      const parts = resolveSourceRigParts(source, assets);
      if (!parts.length) throw new Error('No visible source geometry');
      const missing = parts.flatMap(part => [
        ...dependencies(dir, part.url, `${id} part ${part.sourceIndex} mesh`),
        ...(part.bodyMaskUrl ? dependencies(dir, part.bodyMaskUrl, `${id} part ${part.sourceIndex} mask`) : []),
        ...(part.attachment ? dependencies(dir, part.attachment.bodyUrl, `${id} part ${part.sourceIndex} attachment`) : []),
        ...Object.entries(part.materials).flatMap(([slot, binding]) =>
          dependencies(dir, binding.url, `${id} part ${part.sourceIndex} material ${slot}`)),
      ]);
      if (missing.length) { broken.push({ id, missing }); exceptions.push({ id, reason: `Missing preserved files: ${missing[0]}` }); continue; }
      items.push(id);
      ready.push({ id, slot: item.slot, parts, source: source.source, fittingPending: true });
    } catch (error) {
      exceptions.push({ id, reason: error.message });
    }
  }
  return { items, ready, exceptions, broken };
};

const base = resolveAll(baseAssets, baseDir);
const preview = resolveAll(previewAssets, previewDir);
const baseIds = new Set(base.items), previewIds = new Set(preview.items);
const cohortIds = [...cohort.itemIds].sort();
const expected = [...new Set([...baseIds, ...cohortIds])].sort();
const missing = expected.filter(id => !previewIds.has(id));
const unexpected = preview.items.filter(id => !expected.includes(id)).sort();
const lost = base.items.filter(id => !previewIds.has(id)).sort();
const added = preview.items.filter(id => !baseIds.has(id)).sort();
const expectedIds = new Set(expected);

// The staged materials must be what makes the new items resolve, not a legacy fallback.
const staged = new Set(Object.entries(previewAssets.materials)
  .filter(([, url]) => url.startsWith('../reconstructed-coverage-a-v1/')).map(([key]) => key));
const bindings = preview.ready.filter(row => cohortIds.includes(row.id)).map(row => ({
  id: row.id, slot: row.slot,
  parts: row.parts.map(part => ({ sourceIndex: part.sourceIndex, sourceMesh: part.sourceMesh, url: part.url,
    bodyMaskUrl: part.bodyMaskUrl, attachmentSocket: part.attachment?.socket,
    materials: Object.fromEntries(Object.entries(part.materials).map(([slot, b]) =>
      [slot, { source: b.source, url: b.url, set: b.url.startsWith('../reconstructed-coverage-a-v1/') ? 'stage-a' : 'existing' }])) })),
}));
const withoutStaged = bindings.filter(row => !row.parts.some(part =>
  Object.values(part.materials).some(m => m.set === 'stage-a'))).map(row => row.id);

const report = {
  formatVersion: 1,
  meaning: 'Resolver availability against a preview index with every referenced local file verified. '
    + 'Fitting, combination behaviour and visual acceptance are not measured here.',
  context: ['Customization.Archetype.Medium'],
  preview: path.relative(process.cwd(), previewDir).replaceAll('\\', '/'),
  base: path.relative(process.cwd(), baseDir).replaceAll('\\', '/'),
  counts: { base: base.items.length, preview: preview.items.length, expected: expected.length,
    cohort: cohortIds.length, added: added.length, missing: missing.length, unexpected: unexpected.length,
    lost: lost.length, brokenDependencies: preview.broken.length, checkedFiles: checked.size,
    stagedMaterialKeys: staged.size },
  matchesExpectation: !missing.length && !unexpected.length && !lost.length,
  missing, unexpected, lost, added,
  cohortWithoutStagedMaterial: withoutStaged,
  brokenDependencies: preview.broken,
  baseExceptionsSample: base.exceptions.length, previewExceptions: preview.exceptions.length,
  newlyResolvedBindings: bindings,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
if (writeIndex) {
  const index = { formatVersion: 1, context: ['Customization.Archetype.Medium'],
    scope: read(path.join(baseDir, 'supported-items.json')).scope,
    items: preview.items, ready: preview.ready, exceptions: preview.exceptions };
  fs.writeFileSync(path.join(previewDir, 'supported-items.json'), JSON.stringify(index, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report.counts, matchesExpectation: report.matchesExpectation,
  missing, unexpected, lost, cohortWithoutStagedMaterial: withoutStaged }, null, 2));
if (!report.matchesExpectation) process.exitCode = 1;
