// Freeze one ordinary multipart family from its schemaVersion 2 manifest (see multipart-family.md). An opt-in sibling
// of freeze-family.mjs, whose pure exports it reuses unchanged: package lookup, current-definition equality, GLB
// slot/morph checks, the write-once frozen set and the baseline derived through the product resolver. Run from the
// repository root after `prepare-multipart-family.py --request R preflight`:
//   node --import tsx scripts/shader-probe/freeze-multipart-family.mjs --manifest M               # writes once
//   node --import tsx scripts/shader-probe/freeze-multipart-family.mjs --manifest M --verify-only # read-only replay
import fs from 'node:fs';
import nodePath from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {CONTEXT, INDEX_FILES, FITTED_MODE, fittedTags, read, sha, textFor, manifestSha, writeFrozenSet, packageOf, foldedIndex,
  resolveDefinitionPackage, assertCurrentDefinition, assertDefinition, isFittingTags, sourceSlotsFromDto, glbDocument, glbSlots,
  morphNamesFromDto, assertGlbMorphs, deriveBaseline, parseArgs} from './freeze-family.mjs';
import {FIELD as REUSE, validateComponentReuse, assertComponentReuse} from './multipart-active-reuse.mjs';
import {FIELD as MATERIAL_REUSE, validateMaterialReuse, assertMaterialReuse} from './multipart-material-reuse.mjs';

export const COMPOSITION = 'per-component-union';
export const FACT_KEYS = ['vertices', 'triangles', 'uvSets', 'bones', 'materialSections', 'maxInfluences'];
// Mesh swaps for other archetypes never match the Medium context; every other part rule is out of this slice.
export const OTHER_ARCHETYPES = ['Customization.Archetype.Light', 'Customization.Archetype.Heavy'];
const PATH = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/;
const MESH = /^\/Game\/(?:[A-Za-z0-9_-]+\/)+([A-Za-z0-9_-]+)\.\1$/;
const PATH_KEYS = ['docs', 'work', 'runtime', 'preview', 'active', 'sourceIndex', 'catalog', 'resolver', 'refresh'];
const OUTPUT_ROOTS = {docs: '_docs/', work: 'scripts/generated/shader-probe/', runtime: 'public/models/', preview: 'public/models/'};
const INPUTS = ['active', 'sourceIndex', 'catalog', 'resolver', 'refresh'];
const FIELDS = {
  manifest: [['id', 'schemaVersion', 'paths', 'itemSlot', 'components', 'fittingTags', 'coverage'], ['marker', REUSE, MATERIAL_REUSE]],
  paths: [[...PATH_KEYS, 'appUrl', 'metadata'], []],
  request: [['sourceIndex', 'source', 'slot'], []],
  component: [['sourceIndex', 'source', 'slot', 'sha256', 'sourcePackageSha256', 'sourceDtoSha256', 'facts', 'morphNames'], []],
  facts: [FACT_KEYS, []],
};
const short = source => source.split('.').at(-1);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function fields(value, key, label) {
  const [required, optional] = FIELDS[key];
  assert(isObject(value), `manifest ${label} must be an object`);
  const missing = required.filter(k => !(k in value)), unknown = Object.keys(value).filter(k => !required.includes(k) && !optional.includes(k));
  assert(!missing.length && !unknown.length, `manifest ${label}: missing ${JSON.stringify(missing.sort())}, unsupported ${JSON.stringify(unknown.sort())}`);
}
function text(value, label, pattern) {
  assert(typeof value === 'string' && value && value === value.trim() && (!pattern || pattern.test(value)), `manifest ${label} is not valid: ${JSON.stringify(value)}`);
  return value;
}
function repoPath(value, label) {
  assert(!text(value, label, PATH).split('/').some(part => part === '.' || part === '..'), `manifest ${label} must be an explicit repository-relative path`);
  return value;
}
function uniqueTexts(value, label) {
  assert(Array.isArray(value) && value.every(v => typeof v === 'string' && v && v === v.trim()) && new Set(value).size === value.length,
    `manifest ${label} must be a list of unique nonempty strings`);
}
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

// Exact schemaVersion 2 fields: the same accept/reject rules as prepare-multipart-family.py validate_manifest.
export function validateManifest(doc, pinned = true) {
  fields(doc, 'manifest', 'manifest');
  text(doc.id, 'id', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(doc.schemaVersion === 2, 'manifest schemaVersion must be 2 (multipart); one-mesh families use freeze-family.mjs');
  if ('marker' in doc) repoPath(doc.marker, 'marker');
  const p = doc.paths;
  fields(p, 'paths', 'paths');
  for (const key of PATH_KEYS) repoPath(p[key], `paths.${key}`);
  let url = null;
  try { url = new URL(text(p.appUrl, 'paths.appUrl')); } catch (error) { if (error instanceof assert.AssertionError) throw error; }
  const loopback = url && (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  assert(loopback && url.protocol === 'http:' && !url.username && !url.password && !p.appUrl.includes('?') && !p.appUrl.includes('#')
    && url.port !== '0', `manifest paths.appUrl must be a plain HTTP loopback URL: ${JSON.stringify(p.appUrl)}`);
  for (const [key, root] of Object.entries(OUTPUT_ROOTS)) assert(p[key].startsWith(root), `manifest paths.${key} must be an isolated folder under ${root}`);
  assert(p.active.startsWith('public/models/'), 'manifest paths.active must be an index folder under public/models/');
  assert(p.catalog.endsWith('.json') && p.resolver.split('/').at(-1) === 'SourceAssembly.ts',
    'manifest paths.catalog must be a JSON catalog and paths.resolver the product SourceAssembly.ts');
  uniqueTexts(p.metadata, 'paths.metadata');
  p.metadata.forEach((value, i) => assert(repoPath(value, `paths.metadata[${i}]`).endsWith('.json') && value !== p.catalog,
    `manifest paths.metadata[${i}] must be a catalog metadata JSON file other than the catalog`));
  const outputs = Object.keys(OUTPUT_ROOTS), inputs = [...INPUTS.map(k => p[k]), ...p.metadata];
  outputs.forEach((key, i) => [...outputs.slice(i + 1).map(k => p[k]), ...inputs].forEach(other =>
    assert(!overlaps(p[key], other), `manifest paths.${key} overlaps ${other}; outputs must be separate folders`)));
  text(doc.itemSlot, 'itemSlot', /^[A-Za-z][A-Za-z0-9]*$/);
  const components = doc.components;
  assert(Array.isArray(components) && components.length >= 2, 'manifest components must list at least two source mesh components; one mesh is schemaVersion 1');
  components.forEach((c, i) => {
    const label = `components[${i}]`;
    fields(c, pinned ? 'component' : 'request', label);
    assert(Number.isInteger(c.sourceIndex) && c.sourceIndex >= 0, `manifest ${label}.sourceIndex must be a source part index`);
    if (i) assert(c.sourceIndex > components[i - 1].sourceIndex, `manifest components must be unique and in ascending source part order: ${label}`);
    text(c.source, `${label}.source`, MESH);
    text(c.slot, `${label}.slot`);
    if (!pinned) return;
    text(c.sha256, `${label}.sha256`, /^[0-9a-f]{64}$/);
    text(c.sourcePackageSha256, `${label}.sourcePackageSha256`, /^(?:[0-9A-F]{64}|[0-9a-f]{64})$/);
    text(c.sourceDtoSha256, `${label}.sourceDtoSha256`, /^[0-9a-f]{64}$/);
    fields(c.facts, 'facts', `${label}.facts`);
    for (const [key, value] of Object.entries(c.facts)) assert(Number.isInteger(value) && value >= 1, `manifest ${label}.facts.${key} must be a positive integer`);
    assert.equal(c.facts.materialSections, 1, `manifest ${label}.facts.materialSections must be 1: one material slot per component`);
    uniqueTexts(c.morphNames, `${label}.morphNames`);
  });
  for (const [key, fold] of [['source', v => v], ['source', v => short(v).toLowerCase()], ['slot', v => v]]) {
    const values = components.map(c => fold(c[key]));
    assert.equal(new Set(values).size, values.length, `manifest components repeat a ${key}; item-level overrides and per-component files must be unambiguous`);
  }
  uniqueTexts(doc.fittingTags, 'fittingTags');
  const coverage = doc.coverage;
  assert(isObject(coverage) && ['derived', 'conservative-shared-uv', 'none', FITTED_MODE].includes(coverage.mode), 'manifest coverage.mode is not supported');
  const expected = coverage.mode === 'none' ? ['mode', 'reason'] : ['composition', 'mode'];
  assert.deepEqual(Object.keys(coverage).sort(), expected, `manifest coverage for mode ${coverage.mode} takes exactly ${expected}`);
  if (coverage.mode === 'none') text(coverage.reason, 'coverage.reason');
  else assert.equal(coverage.composition, COMPOSITION, `manifest coverage.composition must be ${COMPOSITION}`);
  if (coverage.mode === FITTED_MODE) fittedTags(doc.fittingTags);
  if (REUSE in doc) validateComponentReuse(doc, pinned);
  if (MATERIAL_REUSE in doc) validateMaterialReuse(doc, pinned);
  return doc;
}

export function familyConfig(raw) {
  const m = validateManifest(raw), p = m.paths;
  return {...m, manifestSha256: manifestSha(raw), marker: m.marker ?? `shader-probe/prepare-multipart-family/${m.id}`,
    meshReport: `${p.docs}/mesh-report.json`,
    outputs: {cohort: `${p.docs}/resolved-cohort.json`, batch: `${p.docs}/batch.json`, baseline: `${p.docs}/adapter-baseline.json`},
    // Same order as prepare-multipart-family.py _baseline_files; deriveBaseline hashes exactly these.
    baselineFiles: [...INDEX_FILES.map(name => `${p.active}/${name}`), p.catalog, ...p.metadata, p.resolver]};
}

export function assertCohort(cohort, cfg) {
  assert(Array.isArray(cohort?.items) && cohort.items.length > 0, 'cohort.items must be a nonempty array');
  assert.equal(cohort.count, cohort.items.length, 'cohort count must equal its choices');
  const ids = cohort.items.map(item => item.id);
  assert(ids.every(id => typeof id === 'string' && id) && new Set(ids).size === ids.length, 'cohort ids must be unique');
  assert.deepEqual(cohort.meshes, cfg.components.map(c => c.source), 'cohort must name exactly the manifest components in source part order');
  assert(!cohort.attached, 'cohort must not be an attached family');
  for (const item of cohort.items) {
    assert.equal(item.slot, cfg.itemSlot, `choice ${item.id} is not in the ${cfg.itemSlot} slot`);
    assert(Array.isArray(item.materials) && item.materials.length === cfg.components.length && item.materials.every(m => typeof m === 'string' && m),
      `choice ${item.id} must name one material per component, in component order`);
  }
  assert.deepEqual([...new Set(cohort.items.flatMap(item => item.materials))].sort(), [...(cohort.materials ?? [])].sort(), 'cohort material list differs from its choices');
}

// One pinned report per component, checked like v1's single report plus the manifest source pins.
export function assertMeshReports(doc, inventory, cfg, shaFn = sha) {
  assert(doc?.formatVersion === 2 && Array.isArray(doc.components) && doc.components.length === cfg.components.length,
    'mesh-report.json must hold one report per manifest component');
  return cfg.components.map((c, i) => {
    const report = doc.components[i], label = `component ${c.sourceIndex} ${short(c.source)}`;
    assert(shaFn(report.glb) === report.sha256 && shaFn(report.meshJson) === report.sourceDtoSha256, `${label}: report no longer matches its GLB/DTO`);
    assert.deepEqual([report.sha256, report.sourceDtoSha256, report.sourcePackageSha256], [c.sha256, c.sourceDtoSha256, c.sourcePackageSha256],
      `${label}: report is not the manifest pinned conversion/source`);
    assert(report.source === c.source || report.source === packageOf(c.source), `${label}: report source is not the component`);
    assert.equal(report.verification?.passed, true, `${label}: attribute verification did not pass`);
    for (const [key, expected] of Object.entries(c.facts)) {
      const value = Array.isArray(report[key]) ? report[key].length : report[key];
      assert(Number.isInteger(value) && value === expected, `${label}: ${key} ${JSON.stringify(value)} is not the manifest ${expected}`);
    }
    assert(inventory.has(packageOf(c.source)), `${label}: source package is absent from the current inventory`);
    return report;
  });
}

// Every part must be a declared component, in order; each binds its one slot through an explicit item override.
export function assertResolved(item, definition, resolved, cfg) {
  assert(resolved && Array.isArray(resolved.parts), `resolved source outfit absent: ${item.id}`);
  assert(!resolved.hidden, `resolved choice is hidden: ${item.id}`);
  assert(!(definition.properties?.ActivatesMaterialParameters?.length) && !(resolved.materialParameters?.length),
    `material parameter overlays are not admitted: ${item.id}`);
  const found = resolved.parts.map(part => [part.sourceIndex, part.skeletalMesh || part.staticMesh || part.effect || '(no mesh)']);
  assert.deepEqual(found, cfg.components.map(c => [c.sourceIndex, c.source]),
    `resolved parts ${JSON.stringify(found)} are not exactly the manifest components (missing, extra or reordered): ${item.id}`);
  const overrides = (definition.properties?.MaterialOverrides ?? []).map(entry => entry?.Key);
  const slots = cfg.components.map(c => c.slot);
  assert.equal(new Set(overrides).size, overrides.length, `repeated material override keys ${JSON.stringify(overrides)}: ${item.id}`);
  for (const key of overrides) assert(slots.includes(key), `material override ${key} matches no component slot: ${item.id}`);
  for (const slot of slots) assert(overrides.includes(slot), `slot ${slot} has no explicit override (default-only binding): ${item.id}`);
  return resolved.parts.map((part, i) => {
    const c = cfg.components[i], p = part.definition ?? {}, label = `part ${part.sourceIndex} ${short(c.source)}: ${item.id}`;
    assert(!part.hidden, `hidden parts are out of scope: ${label}`);
    assert(part.staticMesh === '' && part.effect === '', `static or effect parts are not admitted: ${label}`);
    assert.deepEqual([part.unresolved ?? [], part.rules ?? []], [[], []], `unresolved or matched part rules are not admitted: ${label}`);
    assert(!p.bIsAttached && !p.bIsHeadMesh && !p.bAttachToHeadMesh && !p.OptionalAttachmentMesh?.AssetPathName, `attached or head parts are not admitted: ${label}`);
    assert(!p.LogicModules?.length, `logic modules are not admitted: ${label}`);
    const wrap = p.WrapDeformation ?? {};
    assert(!wrap.bIsWrapDeformed && !wrap.bIsWrapDeformedByHeadComponent && !wrap.OptionalWrapDeformerMesh?.AssetPathName, `wrap deformation is not admitted: ${label}`);
    for (const [field, identity] of [['LocalPosition', 0], ['LocalRotation', 0], ['LocalScale', 1]])
      for (const value of Object.values(p[field] ?? {})) assert.equal(value, identity, `nonidentity ${field}: ${label}`);
    (p.TagOverrides ?? []).forEach((rule, k) => assert(rule.MatchingTags?.length && rule.MatchingTags.every(tag => OTHER_ARCHETYPES.includes(tag)),
      `TagOverrides[${k}] ${JSON.stringify(rule.MatchingTags)} is a conditional part rule (hide/swap/material/offset); out of scope: ${label}`));
    const material = part.materials?.[c.slot];
    assert.equal(material, item.materials[i], `effective ${c.slot} material ${material} is not the cohort's ${item.materials[i]}: ${label}`);
    return {sourceIndex: part.sourceIndex, mesh: c.source, binding: 'explicit-override', slots: [{slot: c.slot, material}]};
  });
}

export function resolveChoice(item, definition, resolveSourceOutfit, cfg) {
  assertDefinition(item, definition, cfg);
  const outfit = resolveSourceOutfit([definition], [CONTEXT]);
  assert.deepEqual(outfit.unresolvedItems, [], `unresolved source item: ${item.id}`);
  const resolved = outfit.items[item.id];
  const effectiveParts = assertResolved(item, definition, resolved, cfg);
  assert(isFittingTags(outfit.fittingTags, cfg), `resolved fitting tags ${JSON.stringify(outfit.fittingTags)} are not exactly ${JSON.stringify(cfg.fittingTags)}: ${item.id}`);
  return {outfit, resolved, effectiveParts};
}

// Frozen cohort and batch from current source, or throw listing every failing choice. Reads only.
export function frozenCohort(cfg, resolver) {
  const p = cfg.paths, cohort = read(`${p.docs}/cohort.json`);
  assertCohort(cohort, cfg);
  const active = read(`${p.active}/assets.json`);
  // Opt-in: exactly the pinned components may already be active (re-derived here); everything else stays new.
  const reuse = cfg[REUSE] ? assertComponentReuse(cfg, cohort) : null, kept = new Set(reuse ? Object.keys(reuse.entries) : []);
  // Opt-in on top: exactly the pinned material bindings (re-derived from today's bundle bytes) may already be active.
  const materials = cfg[MATERIAL_REUSE] ? assertMaterialReuse(cfg, cohort) : null, keptMaterials = materials?.kept ?? new Set();
  const reused = [...cohort.meshes.filter(m => m in active.meshes && !kept.has(m)), ...cohort.materials.filter(m => m in active.materials && !keptMaterials.has(m))];
  assert.deepEqual(reused, [], `already-active mesh/material reuse is not supported by schemaVersion 2: ${JSON.stringify(reused)}`);
  const records = fs.readFileSync(`${p.refresh}/opus-definitions-01/records.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(record => typeof record?.package?.path === 'string' && record.package.path);
  const archive = foldedIndex(records.map(record => record.package.path)), byPath = new Map(records.map(r => [r.package.path, r]));
  const identities = read(`${p.refresh}/opus-identity-01/item-identities.json`).identities;
  const inventory = new Set(read(`${p.refresh}/inventory-01/packages.json`));
  const reports = assertMeshReports(read(cfg.meshReport), inventory, cfg);
  const sourceSlots = [], lodSummaries = [];
  cfg.components.forEach((c, i) => {
    const view = {mesh: {slot: c.slot, morphNames: c.morphNames}}, report = reports[i];
    const dto = read(report.meshJson), glb = glbDocument(fs.readFileSync(report.glb));
    const slots = sourceSlotsFromDto(dto, view);
    assert.deepEqual(glbSlots(glb), slots, `converted GLB slots differ from the source DTO: ${short(c.source)}`);
    const morphNames = morphNamesFromDto(dto, view);
    assertGlbMorphs(glb, morphNames, report);
    if (kept.has(c.source)) {
      assert.equal(report.sha256, reuse.entries[c.source].sha256, `the fresh conversion of ${short(c.source)} is not the active GLB`);
      assert.deepEqual(slots, reuse.entries[c.source].slots, `the fresh source slot/default of ${short(c.source)} is not the active entry's`);
    }
    sourceSlots.push(slots);
    lodSummaries.push({source: c.source, morphNames, sectionRecords: dto.lods[0].sections});
  });
  const items = [], failures = [], inventoryIndex = foldedIndex(inventory);
  for (const item of cohort.items) {
    try {
      const file = `${p.sourceIndex}/items/${item.id}.json`, definition = read(file);
      const sourceLookup = resolveDefinitionPackage(definition, archive, inventoryIndex, item.id);
      assertCurrentDefinition(item, definition, byPath.get(sourceLookup.archive));
      const {outfit, resolved, effectiveParts} = resolveChoice(item, definition, resolver.resolveSourceOutfit, cfg);
      const identity = identities.filter(record => JSON.stringify(record).includes(`"${item.id}"`));
      items.push({...item, definition, definitionSha256: definition.sourceSha256, definitionFileSha256: sha(file),
        identity: identity.length === 1 ? identity[0] : {matches: identity.length}, sourceLookup, resolved, fittingTags: outfit.fittingTags,
        effectiveSlots: effectiveParts.flatMap(part => part.slots), effectiveParts,
        overridesDefaultMaterial: effectiveParts.some((part, i) => part.slots[0].material !== sourceSlots[i][0].material)});
    } catch (error) {
      failures.push(`${item.id}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`Cohort validation failed; nothing was frozen:\n${failures.join('\n')}`);
  return {
    cohort: {...cohort, manifestSha256: cfg.manifestSha256, context: CONTEXT, items, meshReports: reports, sourceSlots, lodSummaries,
      compatibility: `All ${items.length} current source package hashes and decoded properties exactly equal the existing definitions; each resolves exactly the ${cfg.components.length} manifest components on Medium, every slot bound by an explicit item override, and activates exactly ${JSON.stringify(cfg.fittingTags)}.`},
    batch: {cohort: cfg.outputs.cohort, ids: items.map(item => item.id), manifestSha256: cfg.manifestSha256},
    reuse: reuse?.receipt ?? null,
    materialReuse: materials?.receipt ?? null,
  };
}

export async function runFreeze({manifestPath, verifyOnly = false, resolver}) {
  const cfg = familyConfig(read(manifestPath));
  resolver ??= await import(pathToFileURL(nodePath.resolve(cfg.paths.resolver)).href);
  const {cohort, batch, reuse, materialReuse} = frozenCohort(cfg, resolver);
  if (verifyOnly) {
    for (const [path, value] of [[cfg.outputs.cohort, cohort], [cfg.outputs.batch, batch]]) {
      assert(fs.existsSync(path), `saved frozen output missing: ${path}`);
      assert.equal(fs.readFileSync(path, 'utf8'), textFor(value), `current source or resolver differs from the saved frozen choices: ${path}`);
    }
    assert(fs.existsSync(cfg.outputs.baseline) && read(cfg.outputs.baseline).manifestSha256 === cfg.manifestSha256,
      'adapter-baseline.json is missing or was frozen for a different manifest');
    assert.deepEqual(read(cfg.outputs.baseline)[REUSE], cfg[REUSE], `adapter-baseline.json was not frozen with exactly this manifest ${REUSE} receipt`);
    assert.deepEqual(read(cfg.outputs.baseline)[MATERIAL_REUSE], cfg[MATERIAL_REUSE], `adapter-baseline.json was not frozen with exactly this manifest ${MATERIAL_REUSE} receipt`);
    return {verified: cfg.id, items: batch.ids.length, written: []};
  }
  const baseline = reuse ? {...deriveBaseline(cfg, resolver), [REUSE]: reuse, ...(materialReuse ? {[MATERIAL_REUSE]: materialReuse} : {})} : deriveBaseline(cfg, resolver);
  const pinned = read(`${cfg.paths.docs}/frozen-baseline.json`).hashes;
  assert.deepEqual(baseline.hashes, pinned, 'the active files changed since preflight pinned frozen-baseline.json');
  const written = writeFrozenSet([[cfg.outputs.cohort, cohort], [cfg.outputs.batch, batch], [cfg.outputs.baseline, baseline]]);
  return {frozen: cfg.id, items: batch.ids.length, counts: baseline.counts, written: written.every(Boolean) ? Object.values(cfg.outputs) : []};
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    const entry = fs.realpathSync(process.argv[1]), self = fs.realpathSync(new URL(import.meta.url));
    return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
  } catch { return false; }
}

if (isMain()) {
  Promise.resolve().then(() => runFreeze(parseArgs(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
