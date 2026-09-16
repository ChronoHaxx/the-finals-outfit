// Freeze the 20 Medium Military Tactical Glove choices against current source definitions and the fresh,
// hash-verified mesh report. Run from the repository root after `prepare-tactical-gloves.py mesh`:
//   node --import tsx _docs/tactical-gloves-2026-09-13/freeze.mjs
//
// The validators below are exported pure functions so the negative contracts can be exercised with tiny
// synthetic data without the game assets; the source resolver is imported only when this file is main.
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const DIR = '_docs/tactical-gloves-2026-09-13';
// Metadata paths are as in the hoodie-freeze reference.
export const REFRESH = 'scripts/generated/shader-probe/catalog-refresh-20260912';
export const ASSEMBLY = 'public/models/reconstructed-assembly-v2';
export const SOURCE_MESH = '/Game/Discovery/Characters/Military/Assets/TacticalGloves/SK_Military_TacticalGloves_M.SK_Military_TacticalGloves_M';
export const MATERIAL_SLOT = 'TacticalGloves';
export const ITEM_SLOT = 'hands';
export const CONTEXT = 'Customization.Archetype.Medium';
export const EXPECTED_COUNT = 20;
export const MESH_REPORT = `${DIR}/mesh-report.json`;

export const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export function textFor(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

// Frozen evidence is append-only: an identical rerun is a no-op, any drift fails instead of overwriting.
export function writeFrozen(path, value) {
  const text = textFor(value);
  if (fs.existsSync(path)) {
    if (fs.readFileSync(path, 'utf8') !== text) throw new Error(`Preserve existing frozen output: ${path}`);
    return false;
  }
  fs.mkdirSync(nodePath.dirname(path), {recursive: true});
  fs.writeFileSync(path, text);
  return true;
}

export function assertCohort(cohort) {
  assert(Array.isArray(cohort?.items), 'cohort.items must be an array');
  assert.equal(cohort.items.length, EXPECTED_COUNT, `cohort must name ${EXPECTED_COUNT} choices`);
  const ids = cohort.items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'cohort ids must be unique');
  assert.equal(cohort.meshes.length, 1, 'cohort must name exactly one mesh');
  assert.equal(cohort.meshes[0], SOURCE_MESH, 'cohort mesh must be the tactical-glove skeletal mesh');
  for (const item of cohort.items)
    assert.equal(item.slot, ITEM_SLOT, `choice ${item.id} is not in the hands slot`);
}

export function assertMeshReport(report, inventory, shaFn = sha) {
  assert(report && typeof report === 'object', 'mesh report missing');
  assert(shaFn(report.glb) === report.sha256, 'mesh report GLB hash does not match the file');
  assert(shaFn(report.meshJson) === report.sourceDtoSha256, 'mesh report DTO hash does not match the file');
  assert(inventory.has(report.source), 'mesh source package is absent from the current inventory');
}

// Material slots come from the exported DTO, not from the ranking's possibly old root list.
export function sourceSlotsFromDto(dto) {
  assert(Array.isArray(dto?.sourceMaterials) && Array.isArray(dto?.materials), 'DTO material slots are missing');
  assert.equal(dto.sourceMaterials.length, dto.materials.length, 'DTO material slots are incomplete');
  const slots = dto.sourceMaterials.map((source, i) => ({slot: source.MaterialSlotName, material: dto.materials[i].path}));
  assert.equal(slots.length, 1, 'the tactical-glove mesh must export exactly one material slot');
  assert.equal(slots[0].slot, MATERIAL_SLOT, `the single material slot must be ${MATERIAL_SLOT}`);
  return slots;
}

export function assertCurrentDefinition(item, definition, current) {
  assert(current && current.status === 'ok', `fresh definition absent: ${item.id}`);
  assert.equal(current.package.sha256, definition.sourceSha256, `source package changed: ${item.id}`);
  assert(Array.isArray(current.exports), `decoded exports absent: ${item.id}`);
  const exported = current.exports.find(record => record.type === 'CharacterCustomizationItem');
  assert(exported, `decoded CharacterCustomizationItem absent: ${item.id}`);
  assert.deepEqual(exported.properties, definition.properties, `source properties changed: ${item.id}`);
  return exported.properties;
}

export function assertResolved(item, definition, resolved, slots) {
  assert(resolved && Array.isArray(resolved.parts), `resolved source outfit absent: ${item.id}`);
  assert(!(definition.properties?.ActivatesMaterialParameters?.length), `material parameter rules are not admitted: ${item.id}`);
  assert(!(resolved.materialParameters?.length), `resolved material parameters are not admitted: ${item.id}`);
  const visible = resolved.parts.filter(part => !part.hidden);
  assert.equal(visible.length, 1, `expected exactly one visible part: ${item.id}`);
  const part = visible[0], p = part.definition ?? {};
  assert.equal(part.skeletalMesh, SOURCE_MESH, `visible part is not the tactical-glove mesh: ${item.id}`);
  assert.equal(part.staticMesh, '', `static parts are not admitted: ${item.id}`);
  assert.equal(part.effect, '', `effects are not admitted: ${item.id}`);
  assert.deepEqual(part.unresolved ?? [], [], `unresolved part: ${item.id}`);
  assert(!p.bIsAttached, `attached parts are not admitted: ${item.id}`);
  assert(!p.bIsHeadMesh, `head-mesh parts are not admitted: ${item.id}`);
  assert(!p.bAttachToHeadMesh, `head-attached parts are not admitted: ${item.id}`);
  assert(!p.OptionalAttachmentMesh?.AssetPathName, `optional attachment meshes are not admitted: ${item.id}`);
  assert(!p.LogicModules?.length, `logic modules are not admitted: ${item.id}`);
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
  const fresh = new Map(fs.readFileSync(`${REFRESH}/opus-definitions-01/records.jsonl`, 'utf8').trim().split('\n')
    .map(JSON.parse).map(record => [record.package.path, record]));
  const identities = read(`${REFRESH}/opus-identity-01/item-identities.json`).identities;
  const inventory = new Set(read(`${REFRESH}/inventory-01/packages.json`));
  const meshReport = read(MESH_REPORT);
  assertMeshReport(meshReport, inventory);
  const dto = read(meshReport.meshJson);
  const slots = sourceSlotsFromDto(dto);

  const identityFor = item => identities.filter(record => JSON.stringify(record).includes(`"${item.id}"`));
  const items = cohort.items.map(item => {
    const file = `${ASSEMBLY}/items/${item.id}.json`;
    const definition = read(file);
    assert.equal(definition.id, item.id, `definition id changed: ${item.id}`);
    assert(inventory.has(definition.source), `definition package absent from inventory: ${item.id}`);
    assertCurrentDefinition(item, definition, fresh.get(definition.source));
    const resolved = resolveSourceOutfit([definition], [CONTEXT]).items[item.id];
    const effectiveSlots = assertResolved(item, definition, resolved, slots);
    const visible = resolved.parts.filter(part => !part.hidden);
    const identity = identityFor(item);
    return {...item, definition, definitionSha256: definition.sourceSha256, definitionFileSha256: sha(file),
      identity: identity.length === 1 ? identity[0] : {matches: identity.length}, resolved, effectiveSlots,
      effectiveParts: [{sourceIndex: visible[0].sourceIndex, mesh: visible[0].skeletalMesh, slots: effectiveSlots}],
      overridesDefaultMaterial: effectiveSlots.some((entry, i) => entry.material !== slots[i].material)};
  });

  const lod = dto.lods[0];
  const lodSummary = Object.fromEntries(Object.entries(lod)
    .map(([key, value]) => [key, Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value) : value]));
  lodSummary.morphNames = (lod.morphs ?? []).map(morph => morph.name);
  lodSummary.sectionRecords = lod.sections;
  writeFrozen(`${DIR}/resolved-cohort.json`, {...cohort, items, meshReport, sourceSlots: slots, lodSummary,
    compatibility: `All ${EXPECTED_COUNT} current source package hashes and decoded properties exactly equal the existing definitions; each resolves one visible Medium part on the fresh, hash-verified tactical-glove skeletal mesh with its explicit ${MATERIAL_SLOT} override.`});
  writeFrozen(`${DIR}/batch.json`, {cohort: `${DIR}/resolved-cohort.json`, ids: items.map(item => item.id)});
  console.log(JSON.stringify({items: items.length, slots, overriding: items.filter(item => item.overridesDefaultMaterial).length,
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
