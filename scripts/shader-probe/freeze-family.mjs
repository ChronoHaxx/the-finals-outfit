// Freeze one ordinary single-mesh family from its manifest: current source definitions, the pinned mesh report,
// the manifest fitting tags and the active baseline derived once from the current indexes and resolver. Run from
// the repository root after `prepare-family.py --manifest M mesh`:
//   node --import tsx scripts/shader-probe/freeze-family.mjs --manifest M               # writes the frozen set once
//   node --import tsx scripts/shader-probe/freeze-family.mjs --manifest M --verify-only # read-only source replay
//
// Validators are pure exports so synthetic contracts run without game assets; the resolver named by the
// manifest is imported only when running. The manifest validator mirrors prepare-family.py exactly.
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const CONTEXT = 'Customization.Archetype.Medium';
export const INDEX_FILES = ['assets.json', 'skin-pairs.json', 'supported-items.json'];
const FIELDS = {
  manifest: [['id', 'schemaVersion', 'paths', 'mesh', 'fittingTags', 'coverage'], ['marker', 'activeMeshReuse']],
  paths: [['docs', 'work', 'runtime', 'preview', 'active', 'sourceIndex', 'catalog', 'resolver', 'refresh', 'appUrl'], []],
  mesh: [['source', 'slot', 'itemSlot', 'sha256', 'facts', 'morphNames'], []],
  'mesh.facts': [['vertices', 'triangles', 'uvSets', 'bones', 'materialSections'], []],
};
const OUTPUT_ROOTS = {docs: '_docs/', work: 'scripts/generated/shader-probe/', runtime: 'public/models/', preview: 'public/models/'};
const INPUTS = ['active', 'sourceIndex', 'catalog', 'resolver', 'refresh'];
export const FITTED_MODE = 'fitted-conservative-shared-uv';
const COVERAGE_MODES = ['derived', 'conservative-shared-uv', 'none', FITTED_MODE];
const PATH = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/;
// The only tag groups build-companion-masks.mjs --fitted-occlusion accepts; matched as the full string.
const FITTED_TAG = /^Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch)\.[A-Za-z0-9_]+$/;
// The manifest's source tags the fitted generator can apply, in manifest order (prepare-family.py fitted_tags).
export function fittedTags(tags) {
  const applied = tags.filter(tag => FITTED_TAG.test(tag));
  assert(applied.length, `coverage.mode ${FITTED_MODE} needs a Customization.Shape.(PushInsideClothes|ShrinkWrap|HeadNeckMatch) fitting tag; the manifest has ${JSON.stringify(tags)}`);
  return applied;
}

export const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const textFor = value => JSON.stringify(value, null, 2) + '\n';
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
export const manifestSha = raw => crypto.createHash('sha256').update(canonical(raw), 'utf8').digest('hex');

function fields(value, key) {
  const [required, optional] = FIELDS[key];
  assert(value && typeof value === 'object' && !Array.isArray(value), `manifest ${key} must be an object`);
  const missing = required.filter(k => !(k in value)), unknown = Object.keys(value).filter(k => !required.includes(k) && !optional.includes(k));
  assert(!missing.length && !unknown.length, `manifest ${key}: missing ${JSON.stringify(missing.sort())}, unsupported ${JSON.stringify(unknown.sort())}`);
}
function text(value, label, pattern) {
  assert(typeof value === 'string' && value && value === value.trim() && (!pattern || pattern.test(value)),
    `manifest ${label} is not valid: ${JSON.stringify(value)}`);
  return value;
}
function uniqueTexts(value, label) {
  assert(Array.isArray(value) && value.every(v => typeof v === 'string' && v && v === v.trim()) && new Set(value).size === value.length,
    `manifest ${label} must be a list of unique nonempty strings`);
}
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

// Exact schemaVersion 1 fields and types, the same rules as prepare-family.py validate_manifest.
export function validateManifest(doc) {
  fields(doc, 'manifest');
  text(doc.id, 'id', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(doc.schemaVersion === 1, 'manifest schemaVersion must be 1');
  if ('marker' in doc)
    assert(!text(doc.marker, 'marker', PATH).split('/').some(part => part === '.' || part === '..'), 'manifest marker must not contain . or .. segments');
  const paths = doc.paths;
  fields(paths, 'paths');
  for (const key of FIELDS.paths[0].filter(k => k !== 'appUrl').sort()) {
    text(paths[key], `paths.${key}`, PATH);
    assert(!paths[key].split('/').some(part => part === '.' || part === '..'), `manifest paths.${key} must be an explicit repository-relative path`);
  }
  let url = null;
  try { url = new URL(text(paths.appUrl, 'paths.appUrl')); } catch (error) { if (error instanceof assert.AssertionError) throw error; }
  const loopback = url && (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  assert(loopback && url.protocol === 'http:' && !url.username && !url.password && !paths.appUrl.includes('?') && !paths.appUrl.includes('#')
    && url.port !== '0', `manifest paths.appUrl must be a plain HTTP loopback URL: ${JSON.stringify(paths.appUrl)}`);
  for (const [key, root] of Object.entries(OUTPUT_ROOTS))
    assert(paths[key].startsWith(root), `manifest paths.${key} must be an isolated folder under ${root}`);
  assert(paths.active.startsWith('public/models/'), 'manifest paths.active must be an index folder under public/models/');
  assert(paths.catalog.endsWith('.json') && paths.resolver.split('/').at(-1) === 'SourceAssembly.ts',
    'manifest paths.catalog must be a JSON catalog and paths.resolver the product SourceAssembly.ts');
  const outputs = Object.keys(OUTPUT_ROOTS);
  outputs.forEach((key, i) => [...outputs.slice(i + 1), ...INPUTS].forEach(other =>
    assert(!overlaps(paths[key], paths[other]), `manifest paths.${key} overlaps paths.${other}; outputs must be separate folders`)));
  const mesh = doc.mesh;
  fields(mesh, 'mesh');
  text(mesh.source, 'mesh.source', /^\/Game\/(?:[A-Za-z0-9_-]+\/)+([A-Za-z0-9_-]+)\.\1$/);
  text(mesh.slot, 'mesh.slot');
  text(mesh.itemSlot, 'mesh.itemSlot', /^[A-Za-z][A-Za-z0-9]*$/);
  text(mesh.sha256, 'mesh.sha256', /^[0-9a-f]{64}$/);
  fields(mesh.facts, 'mesh.facts');
  for (const [key, value] of Object.entries(mesh.facts))
    assert(Number.isInteger(value) && value >= 1, `manifest mesh.facts.${key} must be a positive integer`);
  assert.equal(mesh.facts.materialSections, 1, 'manifest mesh.facts.materialSections must be 1: one material per mesh');
  uniqueTexts(mesh.morphNames, 'mesh.morphNames');
  uniqueTexts(doc.fittingTags, 'fittingTags');
  const coverage = doc.coverage;
  assert(coverage && typeof coverage === 'object' && COVERAGE_MODES.includes(coverage.mode), `manifest coverage.mode must be one of ${COVERAGE_MODES}`);
  const expected = coverage.mode === 'none' ? ['mode', 'reason'] : ['mode'];
  assert.deepEqual(Object.keys(coverage).sort(), expected, `manifest coverage for mode ${coverage.mode} takes exactly ${expected}`);
  if (coverage.mode === 'none') text(coverage.reason, 'coverage.reason');
  if (coverage.mode === FITTED_MODE) fittedTags(doc.fittingTags);
  if ('activeMeshReuse' in doc) validateActiveReuse(doc);
  return doc;
}

// Opt-in activeMeshReuse, the same rules as family_active_reuse.py validate/derive_pin/require_new.
export const REUSE_POLICY = 'exact-active-entry-v1';
const REUSE_PINS = ['entrySha256', 'glbSha256', 'maskSha256'];
const present = v => !(v === undefined || v === null || v === false || v === 0 || v === ''
  || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length));
function validateActiveReuse(doc) {
  const value = doc.activeMeshReuse;
  assert(value && typeof value === 'object' && !Array.isArray(value)
    && canonical(Object.keys(value).sort()) === canonical(['policy', ...REUSE_PINS].sort()), 'activeMeshReuse: must be an object with exactly policy and the pins');
  assert.equal(value.policy, REUSE_POLICY, `activeMeshReuse: unsupported policy; only ${REUSE_POLICY}`);
  assert(REUSE_PINS.every(k => typeof value[k] === 'string' && /^[0-9a-f]{64}$/.test(value[k])), 'activeMeshReuse: pins must be lowercase sha256 hex');
  assert.equal(value.glbSha256, doc.mesh.sha256, 'activeMeshReuse: glbSha256 must equal mesh.sha256');
  assert(['derived', 'conservative-shared-uv'].includes(doc.coverage.mode), `activeMeshReuse: coverage.mode ${doc.coverage.mode} is deferred`);
}
function indexFile(root, url, label) {
  assert(typeof url === 'string' && url && url === url.trim() && !url.startsWith('/') && !/[:\\?#]/.test(url),
    `activeMeshReuse: the active entry ${label} is not an index-relative URL`);
  const path = nodePath.posix.normalize(`${root}/${url}`);
  assert(path.startsWith('public/'), `activeMeshReuse: the active entry ${label} resolves outside public/`);
  assert(fs.existsSync(path) && fs.statSync(path).isFile(), `activeMeshReuse: the active ${label} file is missing: ${path}`);
  return path;
}
// The whole-entry pin text, shared with family_active_reuse.py canonical: canonical() with JSON.stringify numbers
// (1.0 -> 1, -0 -> 0, 1e-7 -> 1e-7), refusing what the two parsers cannot share instead of rounding or dropping it.
// Integer, string and array entries hash exactly as before.
export function entryCanonical(value, at = 'entry') {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assert(!/\p{Cs}/u.test(value), `activeMeshReuse: the active entry string at ${at} holds a lone surrogate`);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
      `activeMeshReuse: the active entry number at ${at} is non-finite or beyond +-(2**53-1); Python cannot hash it identically`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v, i) => entryCanonical(v, `${at}[${i}]`)).join(',')}]`;
  assert(value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `activeMeshReuse: the active entry value at ${at} is not JSON data`);
  return `{${Object.keys(value).sort().map(key => `${entryCanonical(key, `${at} key`)}:${entryCanonical(value[key], `${at}.${key}`)}`).join(',')}}`;
}
export const entrySha = entry => crypto.createHash('sha256').update(entryCanonical(entry), 'utf8').digest('hex');
export function activeReusePin(cfg, readFn = read, shaFn = sha) {
  const entry = readFn(`${cfg.paths.active}/assets.json`)?.meshes?.[cfg.mesh.source];
  assert(entry && typeof entry === 'object' && !Array.isArray(entry), `activeMeshReuse: ${cfg.mesh.source} has no active entry to reuse`);
  assert(entry.kind === 'skeletal' && Array.isArray(entry.slots) && entry.slots.length === 1, 'activeMeshReuse: the active entry must be one skeletal mesh with one slot');
  assert(['bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource'].every(k => present(entry[k])), 'activeMeshReuse: the active entry lacks complete body coverage; defer it');
  const glb = indexFile(cfg.paths.active, entry.url, 'url'), mask = indexFile(cfg.paths.active, entry.bodyMaskUrl, 'bodyMaskUrl');
  assert.equal(entry.sha256, shaFn(glb), 'activeMeshReuse: the active entry sha256 does not describe its GLB bytes');
  return {policy: REUSE_POLICY, entrySha256: entrySha(entry), glbSha256: shaFn(glb), maskSha256: shaFn(mask)};
}
// Freeze re-derives the pins from the current active files and admits only new materials and unindexed choices.
// A preflight pin saved before extraction must be the manifest pin; accepted pre-hardening evidence has none.
export function assertActiveReuse(cfg, cohort, readFn = read, shaFn = sha) {
  const pin = activeReusePin(cfg, readFn, shaFn), p = cfg.paths;
  const early = readFn(`${p.docs}/frozen-baseline.json`).activeMeshReuse;
  if (early !== undefined)
    assert.deepEqual({policy: early?.policy, ...Object.fromEntries(REUSE_PINS.map(k => [k, early?.[k]])), source: early?.source},
      {...cfg.activeMeshReuse, source: cfg.mesh.source}, 'activeMeshReuse: the manifest pins are not the early preflight pin of frozen-baseline.json');
  assert.deepEqual(pin, cfg.activeMeshReuse, 'activeMeshReuse: the active entry, GLB or mask changed since preflight');
  const active = new Set(Object.keys(readFn(`${p.active}/assets.json`).materials ?? {}).map(k => k.toLowerCase()));
  const reused = [...new Set(cohort.items.flatMap(item => item.materials))].filter(m => active.has(m.toLowerCase()));
  assert.deepEqual(reused, [], `activeMeshReuse: material reuse is out of scope; already active: ${reused}`);
  const supported = readFn(`${p.active}/supported-items.json`), pairs = readFn(`${p.active}/skin-pairs.json`);
  const taken = cohort.items.map(item => item.id).filter(id => (supported.items ?? []).includes(id) || Object.hasOwn(pairs.items ?? {}, id));
  assert.deepEqual(taken, [], `activeMeshReuse: candidates are already advertised or skin-paired: ${taken}`);
  return pin;
}

export function familyConfig(raw) {
  const m = validateManifest(raw), p = m.paths;
  return {...m, manifestSha256: manifestSha(raw), marker: m.marker ?? `shader-probe/prepare-family/${m.id}`,
    meshReport: `${p.docs}/mesh-report.json`,
    outputs: {cohort: `${p.docs}/resolved-cohort.json`, batch: `${p.docs}/batch.json`, baseline: `${p.docs}/adapter-baseline.json`},
    baselineFiles: [...INDEX_FILES.map(name => `${p.active}/${name}`), p.catalog]};
}

// '/Game/A/B/X.X' -> 'Discovery/Content/A/B/X.uasset'
export const packageOf = objectPath => 'Discovery/Content/' + objectPath.replace(/^\/Game\//, '').replace(/\.[^./]*$/, '') + '.uasset';
const tagsOf = properties => properties?.ActivatesTags === undefined ? [] : properties.ActivatesTags;
// Exactly the manifest tags in any order; an absent list is the empty set, duplicates and extras are drift.
export const isFittingTags = (tags, cfg) => Array.isArray(tags) && tags.every(tag => typeof tag === 'string')
  && canonical([...tags].sort()) === canonical([...cfg.fittingTags].sort());

// Frozen evidence is written once: all targets absent, or all identical (no-op). Any drift or a partial earlier
// freeze fails before the first write; the preflight frozen-baseline.json is never a target.
export function writeFrozenSet(entries) {
  const texts = entries.map(([path, value]) => [path, textFor(value)]);
  for (const [path] of texts)
    assert.notEqual(nodePath.basename(path), 'frozen-baseline.json', `Preserve the preflight evidence: ${path}`);
  const existing = texts.filter(([path]) => fs.existsSync(path));
  for (const [path, text] of existing)
    if (fs.readFileSync(path, 'utf8') !== text) throw new Error(`Preserve existing frozen output: ${path}`);
  if (existing.length === texts.length) return texts.map(() => false);
  if (existing.length) throw new Error(`Partial earlier freeze; preserve and inspect: ${existing.map(([path]) => path).join(', ')}`);
  for (const [path, text] of texts) {
    fs.mkdirSync(nodePath.dirname(path), {recursive: true});
    fs.writeFileSync(path + '.tmp', text);
  }
  for (const [path] of texts) fs.renameSync(path + '.tmp', path);
  return texts.map(() => true);
}

export function assertCohort(cohort, cfg) {
  assert(Array.isArray(cohort?.items) && cohort.items.length > 0, 'cohort.items must be a nonempty array');
  assert.equal(cohort.count, cohort.items.length, 'cohort count must equal its choices');
  const ids = cohort.items.map(item => item.id);
  assert(ids.every(id => typeof id === 'string' && id) && new Set(ids).size === ids.length, 'cohort ids must be unique');
  assert.deepEqual(cohort.meshes, [cfg.mesh.source], 'cohort must name exactly the manifest skeletal mesh');
  assert(!cohort.attached, 'cohort must not be an attached family');
  for (const item of cohort.items) {
    assert.equal(item.slot, cfg.mesh.itemSlot, `choice ${item.id} is not in the ${cfg.mesh.itemSlot} slot`);
    assert(Array.isArray(item.materials) && item.materials.length === 1, `choice ${item.id} must name one ${cfg.mesh.slot} material`);
  }
  assert.deepEqual([...new Set(cohort.items.flatMap(item => item.materials))].sort(), [...(cohort.materials ?? [])].sort(),
    'cohort material list differs from its choices');
}

const counted = value => Array.isArray(value) ? value.length : value;

export function assertMeshReport(report, inventory, cfg, shaFn = sha) {
  assert(report && typeof report === 'object', 'mesh report missing');
  assert(shaFn(report.glb) === report.sha256, 'mesh report GLB hash does not match the file');
  assert(shaFn(report.meshJson) === report.sourceDtoSha256, 'mesh report DTO hash does not match the file');
  assert.equal(report.sha256, cfg.mesh.sha256, 'mesh report GLB is not the manifest pinned conversion');
  assert(report.source === cfg.mesh.source || report.source === packageOf(cfg.mesh.source), 'mesh report source is not the manifest mesh');
  assert(report.sourcePackageSha256, 'mesh report lacks the source package hash');
  assert.equal(report.verification?.passed, true, 'mesh report attribute verification did not pass');
  for (const [key, expected] of Object.entries(cfg.mesh.facts)) {
    const value = key === 'bones' || key === 'materialSections' ? counted(report[key]) : report[key];
    assert(Number.isInteger(value) && value === expected, `mesh report ${key} ${JSON.stringify(value)} is not the manifest ${expected}`);
  }
  assert(inventory.has(packageOf(cfg.mesh.source)), 'mesh source package is absent from the current inventory');
}

export function sourceSlotsFromDto(dto, cfg) {
  assert(Array.isArray(dto?.sourceMaterials) && Array.isArray(dto?.materials), 'DTO material slots are missing');
  assert.equal(dto.sourceMaterials.length, dto.materials.length, 'DTO material slots are incomplete');
  const slots = dto.sourceMaterials.map((source, i) => ({slot: source.MaterialSlotName, material: dto.materials[i].path}));
  assert.equal(slots.length, 1, 'the manifest mesh must export exactly one material slot');
  assert.equal(slots[0].slot, cfg.mesh.slot, `the single material slot must be ${cfg.mesh.slot}`);
  return slots;
}

export function glbDocument(buffer) {
  assert(buffer.length >= 20 && buffer.toString('latin1', 0, 4) === 'glTF' && buffer.toString('latin1', 16, 20) === 'JSON',
    'converted mesh is not a binary glTF');
  return JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
}
export const glbSlots = doc => (doc.materials ?? []).map(m => ({slot: m.extras?.sourceSlot?.MaterialSlotName, material: m.extras?.sourceMaterial}));

export function morphNamesFromDto(dto, cfg) {
  const lod = dto?.lods?.[0];
  assert(lod && typeof lod === 'object', 'DTO has no LOD0');
  const names = (lod.morphs ?? []).map(morph => morph?.name);
  assert(names.every(name => typeof name === 'string' && name) && new Set(names).size === names.length,
    `DTO morph names are missing or not unique: ${JSON.stringify(names)}`);
  assert.deepEqual(names, cfg.mesh.morphNames, 'DTO morphs are not the manifest original morphs');
  return names;
}

export function assertGlbMorphs(doc, names, report) {
  const recorded = Array.isArray(report?.morphs) ? report.morphs.map(m => m?.name ?? m) : report?.morphs;
  if (Array.isArray(recorded)) assert.deepEqual(recorded, names, 'mesh report morphs differ from the source DTO');
  else assert(Number.isInteger(recorded) && recorded === names.length, 'mesh report morph count differs from the source DTO');
  const meshes = (doc.meshes ?? []).filter(mesh => mesh.primitives?.length);
  assert(meshes.length, 'converted mesh has no primitives');
  for (const mesh of meshes) {
    assert.deepEqual(mesh.extras?.targetNames ?? [], names, 'converted GLB morph target names differ from the source DTO');
    for (const primitive of mesh.primitives)
      assert((primitive.targets ?? []).length === names.length && (primitive.targets ?? []).every(t => 'POSITION' in t),
        'converted GLB primitive morph targets differ from the source DTO');
  }
  assert([...meshes, ...(doc.nodes ?? [])].every(owner => (owner.weights ?? []).every(weight => weight === 0)),
    'converted GLB activates morph targets by default');
}

// Counts as the source-index loader sees them, plus structural readiness through the product resolver: a source
// catalog choice is structurally ready when its Medium resolution has visible parts the active assets fully bind.
export function deriveBaseline(cfg, resolver, readFn = read, shaFn = sha) {
  const p = cfg.paths;
  const supported = readFn(`${p.active}/supported-items.json`), skinPairs = readFn(`${p.active}/skin-pairs.json`);
  const catalog = readFn(p.catalog), assets = readFn(`${p.active}/assets.json`), source = readFn(`${p.sourceIndex}/catalog.json`);
  assert(Array.isArray(supported?.items) && skinPairs?.items && typeof skinPairs.items === 'object' && Array.isArray(catalog)
    && assets?.meshes && source?.formatVersion === 1 && Array.isArray(source.items), 'active index or catalog has an unexpected shape');
  const ids = new Set(catalog.map(item => item.id)), advertised = new Set(supported.items);
  const indexed = new Set([...advertised, ...Object.keys(skinPairs.items)].filter(id => ids.has(id)));
  const ready = [];
  for (const id of [...new Set(source.items)].sort()) {
    const item = resolver.resolveSourceOutfit([readFn(`${p.sourceIndex}/items/${id}.json`)], [CONTEXT]).items[id];
    if (!item || item.hidden) continue;
    try { if (resolver.resolveSourceRigParts(item, assets).length) ready.push(id); } catch { /* not structurally ready */ }
  }
  return {manifestSha256: cfg.manifestSha256, context: CONTEXT,
    hashes: Object.fromEntries(cfg.baselineFiles.map(file => [file, shaFn(file)])),
    counts: {advertised: advertised.size, indexed: indexed.size, catalog: ids.size, structural: ready.length},
    unadvertisedStructurallyReady: ready.filter(id => !advertised.has(id))};
}

// Package paths are located case-insensitively but uniquely; exact hash and decoded properties are still compared.
export function foldedIndex(keys) {
  const index = new Map();
  for (const key of keys) {
    assert(typeof key === 'string' && key, 'package index keys must be nonempty strings');
    index.set(key.toLowerCase(), [...(index.get(key.toLowerCase()) ?? []), key]);
  }
  return index;
}
export function lookupPackage(index, path, label) {
  assert(typeof path === 'string' && path, `${label}: source package path missing`);
  const matches = index.get(path.toLowerCase()) ?? [];
  assert(matches.length, `${label}: source package absent: ${path}`);
  assert.equal(matches.length, 1, `${label}: ambiguous source package ${path}: ${matches.join(', ')}`);
  return matches[0];
}
export function resolveDefinitionPackage(definition, archive, inventory, label) {
  const archivePath = lookupPackage(archive, definition?.source, `${label} archive`);
  const inventoryPath = lookupPackage(inventory, definition.source, `${label} inventory`);
  assert.equal(archivePath, inventoryPath, `${label}: archive and inventory disagree on the source package`);
  return {archive: archivePath, inventory: inventoryPath, exactCase: archivePath === definition.source};
}

export function assertDefinition(item, definition, cfg) {
  assert.equal(definition?.formatVersion, 1, `unsupported definition format: ${item.id}`);
  assert.equal(definition.id, item.id, `definition id changed: ${item.id}`);
  assert(typeof definition.source === 'string' && definition.source, `definition source missing: ${item.id}`);
  assert(definition.sourceSha256 && definition.properties && typeof definition.properties === 'object', `definition hash or properties missing: ${item.id}`);
  assert(isFittingTags(tagsOf(definition.properties), cfg),
    `activated tags ${JSON.stringify(definition.properties.ActivatesTags)} are not exactly ${JSON.stringify(cfg.fittingTags)}: ${item.id}`);
}

export function assertCurrentDefinition(item, definition, current) {
  assert(current && current.status === 'ok', `fresh definition absent: ${item.id}`);
  assert.equal(current.package.sha256, definition.sourceSha256, `source package changed: ${item.id}`);
  assert(Array.isArray(current.exports), `decoded exports absent: ${item.id}`);
  const exported = current.exports.filter(record => record.type === 'CharacterCustomizationItem');
  assert.equal(exported.length, 1, `expected one decoded CharacterCustomizationItem: ${item.id}`);
  assert.deepEqual(exported[0].properties, definition.properties, `source properties changed: ${item.id}`);
}

export function assertResolved(item, definition, resolved, slots, cfg) {
  assert(resolved && Array.isArray(resolved.parts), `resolved source outfit absent: ${item.id}`);
  assert(!resolved.hidden, `resolved choice is hidden: ${item.id}`);
  assert(!(definition.properties?.ActivatesMaterialParameters?.length), `material parameter rules are not admitted: ${item.id}`);
  assert(!(resolved.materialParameters?.length), `resolved material parameters are not admitted: ${item.id}`);
  const visible = resolved.parts.filter(part => !part.hidden);
  assert.equal(visible.length, 1, `expected exactly one visible part: ${item.id}`);
  const part = visible[0], p = part.definition ?? {};
  assert.equal(part.skeletalMesh, cfg.mesh.source, `visible part is not the manifest mesh: ${item.id}`);
  assert.equal(part.staticMesh, '', `static parts are not admitted: ${item.id}`);
  assert.equal(part.effect, '', `effects are not admitted: ${item.id}`);
  assert.deepEqual(part.unresolved ?? [], [], `unresolved part: ${item.id}`);
  assert(!p.bIsAttached && !p.bIsHeadMesh && !p.bAttachToHeadMesh, `attached or head parts are not admitted: ${item.id}`);
  assert(!p.OptionalAttachmentMesh?.AssetPathName, `optional attachment meshes are not admitted: ${item.id}`);
  assert(!p.LogicModules?.length, `logic modules are not admitted: ${item.id}`);
  const wrap = p.WrapDeformation ?? {};
  assert(!wrap.bIsWrapDeformed && !wrap.bIsWrapDeformedByHeadComponent && !wrap.OptionalWrapDeformerMesh?.AssetPathName,
    `wrap deformation is not admitted: ${item.id}`);
  for (const value of Object.values(p.LocalPosition ?? {})) assert.equal(value, 0, `nonidentity local position: ${item.id}`);
  for (const value of Object.values(p.LocalRotation ?? {})) assert.equal(value, 0, `nonidentity local rotation: ${item.id}`);
  for (const value of Object.values(p.LocalScale ?? {})) assert.equal(value, 1, `nonidentity local scale: ${item.id}`);
  for (const slot of Object.keys(part.materials ?? {}))
    assert(slots.some(entry => entry.slot === slot), `override names an absent slot: ${item.id}:${slot}`);
  const effectiveSlots = slots.map(entry => ({...entry, material: part.materials?.[entry.slot] ?? entry.material}));
  assert.deepEqual([...new Set(effectiveSlots.map(entry => entry.material))], item.materials, `effective resolved materials differ: ${item.id}`);
  return effectiveSlots;
}

export function resolveChoice(item, definition, slots, resolveSourceOutfit, cfg) {
  assertDefinition(item, definition, cfg);
  const outfit = resolveSourceOutfit([definition], [CONTEXT]);
  assert.deepEqual(outfit.unresolvedItems, [], `unresolved source item: ${item.id}`);
  const resolved = outfit.items[item.id];
  const effectiveSlots = assertResolved(item, definition, resolved, slots, cfg);
  assert(isFittingTags(outfit.fittingTags, cfg),
    `resolved fitting tags ${JSON.stringify(outfit.fittingTags)} are not exactly ${JSON.stringify(cfg.fittingTags)}: ${item.id}`);
  return {outfit, resolved, effectiveSlots, visible: resolved.parts.filter(part => !part.hidden)};
}

// The frozen cohort and batch from current source, or throw listing every failing choice. Reads only.
export function frozenCohort(cfg, resolver) {
  const p = cfg.paths, cohort = read(`${p.docs}/cohort.json`);
  assertCohort(cohort, cfg);
  const records = fs.readFileSync(`${p.refresh}/opus-definitions-01/records.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(record => typeof record?.package?.path === 'string' && record.package.path);
  const archive = foldedIndex(records.map(record => record.package.path));
  const byPath = new Map(records.map(record => [record.package.path, record]));
  const identities = read(`${p.refresh}/opus-identity-01/item-identities.json`).identities;
  const inventory = new Set(read(`${p.refresh}/inventory-01/packages.json`));
  const meshReport = read(cfg.meshReport);
  assertMeshReport(meshReport, inventory, cfg);
  const dto = read(meshReport.meshJson), glb = glbDocument(fs.readFileSync(meshReport.glb));
  const slots = sourceSlotsFromDto(dto, cfg);
  assert.deepEqual(glbSlots(glb), slots, 'converted GLB slots differ from the source DTO');
  const morphNames = morphNamesFromDto(dto, cfg);
  assertGlbMorphs(glb, morphNames, meshReport);
  const items = [], failures = [], inventoryIndex = foldedIndex(inventory);
  for (const item of cohort.items) {
    try {
      const file = `${p.sourceIndex}/items/${item.id}.json`, definition = read(file);
      assertDefinition(item, definition, cfg);
      const sourceLookup = resolveDefinitionPackage(definition, archive, inventoryIndex, item.id);
      assertCurrentDefinition(item, definition, byPath.get(sourceLookup.archive));
      const {outfit, resolved, effectiveSlots, visible} = resolveChoice(item, definition, slots, resolver.resolveSourceOutfit, cfg);
      const identity = identities.filter(record => JSON.stringify(record).includes(`"${item.id}"`));
      items.push({...item, definition, definitionSha256: definition.sourceSha256, definitionFileSha256: sha(file),
        identity: identity.length === 1 ? identity[0] : {matches: identity.length}, sourceLookup, resolved,
        fittingTags: outfit.fittingTags, effectiveSlots,
        effectiveParts: [{sourceIndex: visible[0].sourceIndex, mesh: visible[0].skeletalMesh, slots: effectiveSlots}],
        overridesDefaultMaterial: effectiveSlots.some((entry, i) => entry.material !== slots[i].material)});
    } catch (error) {
      failures.push(`${item.id}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`Cohort validation failed; nothing was frozen:\n${failures.join('\n')}`);
  const lod = dto.lods[0];
  const lodSummary = Object.fromEntries(Object.entries(lod)
    .map(([key, value]) => [key, Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value) : value]));
  lodSummary.morphNames = morphNames;
  lodSummary.sectionRecords = lod.sections;
  const caseOnly = items.filter(item => !item.sourceLookup.exactCase).map(item => item.id);
  return {
    cohort: {...cohort, manifestSha256: cfg.manifestSha256, context: CONTEXT, items, meshReport, sourceSlots: slots, lodSummary,
      compatibility: `All ${items.length} current source package hashes and decoded properties exactly equal the existing definitions (case-only lookups: ${JSON.stringify(caseOnly)}); each resolves one visible Medium part on the pinned ${cfg.mesh.slot} mesh with its effective material and activates exactly ${JSON.stringify(cfg.fittingTags)}; the converted mesh keeps the DTO morphs ${JSON.stringify(morphNames)} with no default weights.`},
    batch: {cohort: cfg.outputs.cohort, ids: items.map(item => item.id), manifestSha256: cfg.manifestSha256},
  };
}

export async function runFreeze({manifestPath, verifyOnly = false, resolver}) {
  const cfg = familyConfig(read(manifestPath));
  resolver ??= await import(pathToFileURL(nodePath.resolve(cfg.paths.resolver)).href);
  const {cohort, batch} = frozenCohort(cfg, resolver);
  if (verifyOnly) {
    // Replays current source and resolver against the saved choices; the active index is not consulted.
    for (const [path, value] of [[cfg.outputs.cohort, cohort], [cfg.outputs.batch, batch]]) {
      assert(fs.existsSync(path), `saved frozen output missing: ${path}`);
      assert.equal(fs.readFileSync(path, 'utf8'), textFor(value), `current source or resolver differs from the saved frozen choices: ${path}`);
    }
    assert(fs.existsSync(cfg.outputs.baseline) && read(cfg.outputs.baseline).manifestSha256 === cfg.manifestSha256,
      'adapter-baseline.json is missing or was frozen for a different manifest');
    assert.deepEqual(read(cfg.outputs.baseline).activeMeshReuse, cfg.activeMeshReuse, 'adapter-baseline.json does not carry this activeMeshReuse pin');
    return {verified: cfg.id, items: batch.ids.length, written: []};
  }
  const baseline = deriveBaseline(cfg, resolver);
  if (cfg.activeMeshReuse) baseline.activeMeshReuse = assertActiveReuse(cfg, cohort);
  const written = writeFrozenSet([[cfg.outputs.cohort, cohort], [cfg.outputs.batch, batch], [cfg.outputs.baseline, baseline]]);
  return {frozen: cfg.id, items: batch.ids.length, counts: baseline.counts, unadvertisedStructurallyReady: baseline.unadvertisedStructurallyReady,
    written: written.every(Boolean) ? Object.values(cfg.outputs) : []};
}

export function parseArgs(argv) {
  const args = {verifyOnly: false};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest' && argv[i + 1] && !args.manifestPath) args.manifestPath = argv[++i];
    else if (argv[i] === '--verify-only' && !args.verifyOnly) args.verifyOnly = true;
    else throw new Error(`Unexpected argument ${argv[i]}; usage: freeze-family.mjs --manifest PATH [--verify-only]`);
  }
  if (!args.manifestPath) throw new Error('usage: freeze-family.mjs --manifest PATH [--verify-only]');
  return args;
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
