// Freeze the 19 Medium Racing Glove choices against current source definitions and the preserved,
// hash-verified mesh report. Run from the repository root after `prepare-racing-gloves.py mesh`:
//   node --import tsx _docs/racing-gloves-2026-09-14/freeze.mjs
//
// The validators below are exported pure functions so the negative contracts can be exercised with tiny
// synthetic data without the game assets; the source resolver is imported only when this file is main.
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const DIR = '_docs/racing-gloves-2026-09-14';
// Metadata paths are as in the tactical-glove freeze reference.
export const REFRESH = 'scripts/generated/shader-probe/catalog-refresh-20260912';
export const ASSEMBLY = 'public/models/reconstructed-assembly-v2';
export const SOURCE_MESH = '/Game/Discovery/Characters/Racing/Assets/Gloves/SK_Racing_Gloves_M.SK_Racing_Gloves_M';
export const MATERIAL_SLOT = 'Gloves';
export const ITEM_SLOT = 'hands';
export const CONTEXT = 'Customization.Archetype.Medium';
export const EXPECTED_COUNT = 19;
export const MESH_REPORT = `${DIR}/mesh-report.json`;

export const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export function textFor(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

// '/Game/A/B/X.X' -> 'Discovery/Content/A/B/X.uasset'
export function packageOf(objectPath) {
  return 'Discovery/Content/' + objectPath.replace(/^\/Game\//, '').replace(/\.[^./]*$/, '') + '.uasset';
}

export const isSourceMesh = value => value === SOURCE_MESH || value === packageOf(SOURCE_MESH);

// Frozen evidence is append-only: an identical rerun is a no-op, any drift fails instead of overwriting.
// Every target is checked before the first write, so a drifting second file cannot leave a partial freeze.
export function writeFrozenSet(entries) {
  const texts = entries.map(([path, value]) => [path, textFor(value)]);
  for (const [path, text] of texts)
    if (fs.existsSync(path) && fs.readFileSync(path, 'utf8') !== text) throw new Error(`Preserve existing frozen output: ${path}`);
  return texts.map(([path, text]) => {
    if (fs.existsSync(path)) return false;
    fs.mkdirSync(nodePath.dirname(path), {recursive: true});
    fs.writeFileSync(path, text);
    return true;
  });
}

export function assertCohort(cohort) {
  assert(Array.isArray(cohort?.items), 'cohort.items must be an array');
  assert.equal(cohort.items.length, EXPECTED_COUNT, `cohort must name ${EXPECTED_COUNT} choices`);
  assert.equal(cohort.count, EXPECTED_COUNT, `cohort count must be ${EXPECTED_COUNT}`);
  const ids = cohort.items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'cohort ids must be unique');
  assert.deepEqual(cohort.meshes, [SOURCE_MESH], 'cohort must name exactly the racing-glove skeletal mesh');
  for (const item of cohort.items) {
    assert.equal(item.slot, ITEM_SLOT, `choice ${item.id} is not in the hands slot`);
    assert.equal(item.materials?.length, 1, `choice ${item.id} must name one ${MATERIAL_SLOT} material`);
  }
  assert.deepEqual([...new Set(cohort.items.flatMap(item => item.materials))].sort(), [...cohort.materials].sort(),
    'cohort material list differs from its choices');
}

export function assertMeshReport(report, inventory, shaFn = sha) {
  assert(report && typeof report === 'object', 'mesh report missing');
  assert(shaFn(report.glb) === report.sha256, 'mesh report GLB hash does not match the file');
  assert(shaFn(report.meshJson) === report.sourceDtoSha256, 'mesh report DTO hash does not match the file');
  assert(isSourceMesh(report.source), 'mesh report source is not the racing-glove skeletal mesh');
  assert(report.sourcePackageSha256, 'mesh report lacks the source package hash');
  assert.equal(report.verification?.passed, true, 'mesh report attribute verification did not pass');
  assert(report.bones, 'mesh report has no rest bones');
  assert(Number.isInteger(report.uvSets) && report.uvSets >= 1, 'mesh report records no original UV sets');
  assert(inventory.has(report.source), 'mesh source package is absent from the current inventory');
}

// Material slots come from the exported DTO, not from the ranking's possibly old root list.
export function sourceSlotsFromDto(dto) {
  assert(Array.isArray(dto?.sourceMaterials) && Array.isArray(dto?.materials), 'DTO material slots are missing');
  assert.equal(dto.sourceMaterials.length, dto.materials.length, 'DTO material slots are incomplete');
  const slots = dto.sourceMaterials.map((source, i) => ({slot: source.MaterialSlotName, material: dto.materials[i].path}));
  assert.equal(slots.length, 1, 'the racing-glove mesh must export exactly one material slot');
  assert.equal(slots[0].slot, MATERIAL_SLOT, `the single material slot must be ${MATERIAL_SLOT}`);
  return slots;
}

// The converted GLB must carry the same slots as the DTO it was verified against.
export function glbSlots(buffer) {
  assert(buffer.length >= 20 && buffer.toString('latin1', 0, 4) === 'glTF' && buffer.toString('latin1', 16, 20) === 'JSON',
    'converted mesh is not a binary glTF');
  const doc = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  return (doc.materials ?? []).map(m => ({slot: m.extras?.sourceSlot?.MaterialSlotName, material: m.extras?.sourceMaterial}));
}

// Package paths are located without regard to letter case: a saved definition may spell a folder
// differently from the latest archive and inventory. The match must be unique — two keys differing only
// in case (or a duplicated key) are ambiguous — and it only locates the record. The exact package hash and
// decoded properties are still compared, and the located key is never written back into any record.
export function foldedIndex(keys) {
  const index = new Map();
  for (const key of keys) {
    assert(typeof key === 'string' && key, 'package index keys must be nonempty strings');
    const folded = key.toLowerCase();
    index.set(folded, [...(index.get(folded) ?? []), key]);
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

export function assertDefinition(item, definition) {
  assert.equal(definition?.formatVersion, 1, `unsupported definition format: ${item.id}`);
  assert.equal(definition.id, item.id, `definition id changed: ${item.id}`);
  assert(typeof definition.source === 'string' && definition.source, `definition source missing: ${item.id}`);
  assert(definition.sourceSha256 && definition.properties && typeof definition.properties === 'object',
    `definition hash or properties missing: ${item.id}`);
}

export function assertCurrentDefinition(item, definition, current) {
  assert(current && current.status === 'ok', `fresh definition absent: ${item.id}`);
  assert.equal(current.package.sha256, definition.sourceSha256, `source package changed: ${item.id}`);
  assert(Array.isArray(current.exports), `decoded exports absent: ${item.id}`);
  const exported = current.exports.filter(record => record.type === 'CharacterCustomizationItem');
  assert.equal(exported.length, 1, `expected one decoded CharacterCustomizationItem: ${item.id}`);
  assert.deepEqual(exported[0].properties, definition.properties, `source properties changed: ${item.id}`);
  return exported[0].properties;
}

export function assertResolved(item, definition, resolved, slots) {
  assert(resolved && Array.isArray(resolved.parts), `resolved source outfit absent: ${item.id}`);
  assert(!resolved.hidden, `resolved choice is hidden: ${item.id}`);
  assert(!(definition.properties?.ActivatesMaterialParameters?.length), `material parameter rules are not admitted: ${item.id}`);
  assert(!(resolved.materialParameters?.length), `resolved material parameters are not admitted: ${item.id}`);
  const visible = resolved.parts.filter(part => !part.hidden);
  assert.equal(visible.length, 1, `expected exactly one visible part: ${item.id}`);
  const part = visible[0], p = part.definition ?? {};
  assert.equal(part.skeletalMesh, SOURCE_MESH, `visible part is not the racing-glove mesh: ${item.id}`);
  assert.equal(part.staticMesh, '', `static parts are not admitted: ${item.id}`);
  assert.equal(part.effect, '', `effects are not admitted: ${item.id}`);
  assert.deepEqual(part.unresolved ?? [], [], `unresolved part: ${item.id}`);
  assert(!p.bIsAttached, `attached parts are not admitted: ${item.id}`);
  assert(!p.bIsHeadMesh, `head-mesh parts are not admitted: ${item.id}`);
  assert(!p.bAttachToHeadMesh, `head-attached parts are not admitted: ${item.id}`);
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
  assert.deepEqual([...new Set(effectiveSlots.map(entry => entry.material))], item.materials,
    `effective resolved materials differ: ${item.id}`);
  return effectiveSlots;
}

async function main() {
  const {resolveSourceOutfit} = await import('../../src/rig/SourceAssembly.ts');
  const cohort = read(`${DIR}/cohort.json`);
  assertCohort(cohort);
  const records = fs.readFileSync(`${REFRESH}/opus-definitions-01/records.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(record => typeof record?.package?.path === 'string' && record.package.path);
  const archive = foldedIndex(records.map(record => record.package.path));
  const byPath = new Map(records.map(record => [record.package.path, record]));
  const identities = read(`${REFRESH}/opus-identity-01/item-identities.json`).identities;
  const inventory = new Set(read(`${REFRESH}/inventory-01/packages.json`));
  const inventoryIndex = foldedIndex(inventory);
  const meshReport = read(MESH_REPORT);
  assertMeshReport(meshReport, inventory);
  const dto = read(meshReport.meshJson);
  const slots = sourceSlotsFromDto(dto);
  assert.deepEqual(glbSlots(fs.readFileSync(meshReport.glb)), slots, 'converted GLB slots differ from the source DTO');

  // Validate the whole cohort and report every failure before any frozen JSON is written.
  const identityFor = item => identities.filter(record => JSON.stringify(record).includes(`"${item.id}"`));
  const items = [], failures = [];
  for (const item of cohort.items) {
    try {
      const file = `${ASSEMBLY}/items/${item.id}.json`;
      const definition = read(file);
      assertDefinition(item, definition);
      const sourceLookup = resolveDefinitionPackage(definition, archive, inventoryIndex, item.id);
      assertCurrentDefinition(item, definition, byPath.get(sourceLookup.archive));
      const outfit = resolveSourceOutfit([definition], [CONTEXT]);
      assert.deepEqual(outfit.unresolvedItems, [], `unresolved source item: ${item.id}`);
      const resolved = outfit.items[item.id];
      const effectiveSlots = assertResolved(item, definition, resolved, slots);
      const visible = resolved.parts.filter(part => !part.hidden);
      const identity = identityFor(item);
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
  lodSummary.morphNames = (lod.morphs ?? []).map(morph => morph.name);
  lodSummary.sectionRecords = lod.sections;
  const caseOnly = items.filter(item => !item.sourceLookup.exactCase).map(item => item.id);
  writeFrozenSet([
    [`${DIR}/resolved-cohort.json`, {...cohort, items, meshReport, sourceSlots: slots, lodSummary,
      compatibility: `All ${EXPECTED_COUNT} current source package hashes and decoded properties exactly equal the existing definitions (packages located by unique case-insensitive path; letter case differs only for ${JSON.stringify(caseOnly)}); each resolves one visible Medium part on the preserved, hash-verified racing-glove skeletal mesh with its effective ${MATERIAL_SLOT} material.`}],
    [`${DIR}/batch.json`, {cohort: `${DIR}/resolved-cohort.json`, ids: items.map(item => item.id)}],
  ]);
  console.log(JSON.stringify({items: items.length, slots, overriding: items.filter(item => item.overridesDefaultMaterial).length,
    caseOnlySourceLookups: caseOnly, fittingTags: [...new Set(items.flatMap(item => item.fittingTags))].sort(),
    identities: [...new Set(items.map(item => item.identity.matches ?? 1))]}));
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    const entry = fs.realpathSync(process.argv[1]);
    const self = fs.realpathSync(new URL(import.meta.url));
    return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
  } catch { return false; }
}

if (isMain()) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
