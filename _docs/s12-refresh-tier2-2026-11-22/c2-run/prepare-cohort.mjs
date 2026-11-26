// s12-c2 (26 Nov 2026, S12 tier-2 refresh session for the coordinator; batch C wave C2, BATCH-C-PLAN.md): the 113 items
// whose visible parts show one of the five C2 meshes below (Shirt, Socks_Quarter, Pants, AssaultPants, TightTechPants).
// Copy of ../c1-run/prepare-cohort.mjs with NAME, the folder, the scope and the mesh list changed. The same two rules:
//  1. Scope: only the five meshes' slots are rebuilt and rebound (rebindKeptMaterials); other parts keep their bindings.
//  2. Drift: drift/v1 (map v1) has 96 identical and 17 (the starter Pants) differing only by an appended
//     Customization.Feature.MeshMergeModifiers TagOverride; each is admitted only when
//     scripts/shader-probe/merge-modifier-drift.mjs (PR #109) admits it, recorded per item (driftAdmission).
//  3. Proxy wraps (coordinator, 26 Nov, C2 only): a proxy-wrapped part without w80/w117 evidence also passes when the item
//     is already supported and the part is not a wave mesh (the 43 flag shirts' WornCape). Must-fail self-checks run
//     first; every part kept this way is recorded (proxyWrapKeptSupported).
// Also recorded per item, from the 17 Nov definitions: no Customization.Archetype.Light override sets materials (Pants_L
// is a C2 Light sibling). One that does stops the cohort.
//
// Run from the repo root (Git Bash or PowerShell), after PR #109 is in the root's checkout:
//   node --import tsx _docs/s12-refresh-tier2-2026-11-22/c2-run/prepare-cohort.mjs
// C2_OUT=<folder> writes the cohort and batch there instead (a dry run); the batch still names T's cohort path.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
// From the working directory (the root), not from this file, so a dry run from another checkout reads the root's resolver.
const RESOLVER = 'scripts/generated/catalog-public-worktree/src/rig/SourceAssembly.ts';
const RULE = 'scripts/shader-probe/merge-modifier-drift.mjs';
// C2_RULE=<file> reads the rule from another checkout (a dry run before #109 reaches the root); recorded under RULE.
const RULE_FILE = process.env.C2_RULE ?? RULE;
if (!fs.existsSync(RULE_FILE)) throw Error(`missing ${RULE_FILE}: this checkout needs PR #109 (merge-modifier drift rule)`);
const {resolveSourceOutfit, materialSlotOverride} = await import(pathToFileURL(path.resolve(RESOLVER)).href);
const {admitMergeModifierDrift} = await import(pathToFileURL(path.resolve(RULE_FILE)).href);
const NAME = 's12-c2';
const G = '_docs/goal-100-2026-10-11';
const T = '_docs/s12-refresh-tier2-2026-11-22/c2-run';
const HERE = path.dirname(fileURLToPath(import.meta.url));  // T's own files; the same folder in a root run
const OUT = process.env.C2_OUT ?? T;
const MEDIUM = ['Customization.Archetype.Medium'];
const LIGHT = 'Customization.Archetype.Light';
// The five batch C meshes of C2 (BATCH-C-PLAN.md "C2-C4": C2 is Shirt, Socks_Quarter, Pants, AssaultPants, TightTechPants).
const WAVE_MESHES = ['SK_Shirt_M', 'SK_Socks_Quarter_M', 'SK_Pants_M', 'SK_Military_AssaultPants_M',
  'SK_Streetwear_TightTechPants_M'];
const CONFIG = {
  scope: 's12-c2: batch C wave C2: the 113 items that show one of the five batch C meshes (Shirt, Socks_Quarter, Pants, ' +
         'AssaultPants, TightTechPants). Their Season 12 meshes changed UVs or UV sets, so the material instances bound to ' +
         'those meshes\' slots are rebuilt from the 17 Nov build and rebound (rebindKeptMaterials); other parts keep their ' +
         'active bindings. The meshes and masks go through the refresh patch (scripts/body-types/make-refresh-patch.py)',
  meaning: 'attached-route rebuild of kept materials on map v1: every C2 material item stays advertised and differs only ' +
           'by its rebound materials; merge-modifier drift admitted per item by the option A rule; visual and human ' +
           'acceptance remain separate.',
  extra: {partHideActivations: 'pending-mask',
          attachmentLightVariant: 'authored', attachmentCameraOrigin: [0, 1.72, 1.3], emissiveExposure: 'hue-keeping',
          replaceMaterials: true, layeredSubsurface: true, skinDiscardCoverageEquivalence: true},
  withParameters: true, faceParameters: true,
  plan: ['scripts/generated/shader-probe/tools/5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap',
         'scripts/shader-probe/s12-definition-drift.py',
         'scripts/shader-probe/view_layout.py',
         'scripts/shader-probe/view_layout_c838d617.json',
         `${G}/signoffs-2026-11-11.json`,
         'scripts/shader-probe/refresh-s12-definitions.py',
         'scripts/shader-probe/material_inputs.py',
         'scripts/shader-probe/surface_emission_programs.json',
         '_docs/season12-import-2026-10-28/import-plan-v2.json',
         `${G}/w80-wrap-preflight/probe.py`,
         `${G}/w80-wrap-preflight/report.json`,
         `${G}/w82-sweep-neutral-drift.json`,
         'scripts/shader-probe/proxy_wrap.py',
         'scripts/shader-probe/prepare-large-sneakers.py',
         'scripts/shader-probe/prepare-accessories.py',
         'scripts/shader-probe/prepare-accessory-defaults.py',
         'scripts/shader-probe/prepare-attached-batch.py',
         'scripts/shader-probe/build-part-hide-masks.py',
         'scripts/shader-probe/amend-preview-masks.py',
         'scripts/shader-probe/build-assembly-assets.py',
         'scripts/shader-probe/build-materials.py',
         'scripts/shader-probe/sm5_slice.py',
         'scripts/shader-probe/check-webgl.mjs',
         'scripts/shader-probe/check-material-batch.py',
         `${G}/signoffs-2026-10-12.json`,
         `${G}/signoffs-2026-10-22.json`,
         `${G}/w83-identity-fix/relink.py`,
         `${G}/w83-identity-fix/receipt.json`,
         `${G}/signoffs-2026-10-29.json`,
         `${G}/signoffs-2026-11-04.json`,
         `${G}/w117-proxy-weight-transfer/preflight.py`,
         `${G}/w117-proxy-weight-transfer/preflight-v1/report.json`,
         `${G}/w117-proxy-weight-transfer/preflight-v1/summary.json`,
         'scripts/shader-probe/proxy_weight_transfer.py',
         'scripts/shader-probe/vertex_interpolants.py',
         'scripts/shader-probe/surface_emission_contract.py',
         'scripts/shader-probe/quad_translation.py',
         'scripts/shader-probe/test_translation.py'],
};
const own = name => [`${T}/${name}`, path.join(HERE, name)];  // [recorded key, file to read]
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const screen = read(`${G}/screen-v37.json`), byId = new Map(screen.rows.map(r => [r.id, r]));
const catalogItems = new Map(read('scripts/generated/catalog-public-worktree/src/data/items.json').map(i => [i.id, i]));
const wrapEvidence = new Map(read(`${G}/w80-wrap-preflight/report.json`).items.map(i => [i.id, i]));
const transferEvidence = new Map(read(`${G}/w117-proxy-weight-transfer/preflight-v1/report.json`).items.map(i => [i.id, i]));
const passing = (evidence, id, v) => (evidence.get(id)?.components ?? []).some(c => c.pass === true && (c.method ?? 'agreement') === 'agreement' &&
  c.source === v.SkeletalMesh?.AssetPathName && c.proxy === v.WrapDeformation.OptionalWrapDeformerMesh?.AssetPathName);
const wrapAdmitted = (id, v) => passing(wrapEvidence, id, v) || passing(transferEvidence, id, v);
const drift = read(own('drift/v1/drift.json')[1]).items;
const neutralDrift = new Set(read(own('neutral-drift.json')[1]));  // c2: no Slots/AudioTags drift; list empty
const NEUTRAL_KEYS = new Set(['Slots', 'AudioTags']);
const season12 = new Set(JSON.stringify(read('_docs/season12-import-2026-10-28/import-plan-v2.json')).match(/"(?:id|itemId)":"[^"]+"/g)
  .map(m => m.split(':"')[1].slice(0, -1)));
// The 17 Nov CharacterCustomizationItem properties the drift gate read (s12-definition-drift.py's own pick). Not in git:
// RUN.md copies drift/v1/extract from the tier-2 worktree; each file used is recorded by sha256 in the cohort's inputs.
if (!fs.existsSync(own('drift/v1/extract/source-run.json')[1])) throw Error(`missing ${T}/drift/v1/extract: copy it first (RUN.md step 1)`);
const extractUsed = [];
const freshProperties = definition => {
  const name = `drift/v1/extract/${path.parse(definition.source).name}.properties.json`;
  const [key, file] = own(name);
  if (!fs.existsSync(file)) return undefined;
  extractUsed.push([key, file]);
  return read(file).find(e => e && typeof e === 'object' && e.type === 'CharacterCustomizationItem')?.properties;
};
const resolveMedium = definition => resolveSourceOutfit([definition], MEDIUM);
// Returns {ok, how, ...verdict}; `how` names the admitting route for the report.
const admitDrift = (id, definition, fresh) => {
  if (season12.has(id)) return {ok: true, how: 'season12-import'};
  const d = drift[id];
  if (d?.status === 'identical') return {ok: true, how: 'identical'};
  if (d?.status === 'differs' && neutralDrift.has(id) && (d.keys ?? []).length > 0 && d.keys.every(k => NEUTRAL_KEYS.has(k)))
    return {ok: true, how: 'neutral-keys', keys: d.keys};
  if (!fresh) return {ok: false, how: 'no-17nov-properties', drift: d ?? null};
  return {how: 'merge-modifier-only', ...admitMergeModifierDrift(d, definition, fresh, resolveMedium)};
};
for (const p of ['scripts/generated/catalog-public-worktree/src/data/items.json',
                 'scripts/generated/catalog-public-worktree/src/data/reconstruction-reviews.json',
                 'public/models/reconstructed-assemblies-v1/supported-items.json',
                 'public/models/reconstructed-assemblies-v1/skin-pairs.json',
                 'public/models/reconstructed-assemblies-v1/assets.json'])
  if (!fs.existsSync(p)) throw Error(`missing screen input ${p}`);
const proxyWrapped = v => !!v.WrapDeformation?.bIsWrapDeformed &&
  !(v.WrapDeformation.bIsWrapDeformedByHeadComponent && !v.WrapDeformation.OptionalWrapDeformerMesh?.AssetPathName);
const pairs = read('public/models/reconstructed-assemblies-v1/skin-pairs.json').items;
const active = read('public/models/reconstructed-assemblies-v1/assets.json');
const WAVE = new Map(WAVE_MESHES.map(name => {
  const keys = Object.keys(active.meshes).filter(k => k.endsWith(`/${name}.${name}`));
  if (keys.length !== 1) throw Error(`${name}: ${keys.length} active mesh entries`);
  return [keys[0], name];
}));
// Proxy-wrap guard (coordinator, 26 Nov, C2 only). The inherited guard refuses a proxy-wrapped part without w80/w117
// evidence for this item id. A part also passes when (a) the item is already in the active supported-items and (b) the
// part's mesh is not one of the wave's meshes: the wave rebinds only its own meshes' slots, so that part's mesh, wrap and
// material stay exactly as the wave that admitted them left them (the 43 flag shirts' WornCape, flag-shirts-v1). Every
// part that passes this way is recorded on its row (proxyWrapKept) and in the cohort's proxyWrapKeptSupported.
const activeSupported = new Set(read('public/models/reconstructed-assemblies-v1/supported-items.json').items);
const partMesh = v => v.SkeletalMesh?.AssetPathName || v.StaticMesh?.AssetPathName || null;
const wrapVerdict = (id, parts, kept) => {
  for (const [n, v] of parts.entries()) {
    if (!proxyWrapped(v) || wrapAdmitted(id, v)) continue;
    const mesh = partMesh(v);
    if (activeSupported.has(id) && mesh && !WAVE.has(mesh)) {
      kept.push({part: n, mesh, proxy: v.WrapDeformation.OptionalWrapDeformerMesh?.AssetPathName || null});
      continue;
    }
    return `proxy wrap without passing evidence (part ${n}, ${mesh}: ${!activeSupported.has(id) ? 'item not supported'
      : 'a wave mesh'})`;
  }
  return null;
};
{ // Must-fail checks before any row: the branch refuses a wave mesh and an unsupported item, and admits only the rest.
  const wrapped = mesh => ({SkeletalMesh: {AssetPathName: mesh}, WrapDeformation: {bIsWrapDeformed: true,
    bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: {AssetPathName: '/Game/SelfCheck/SK_Proxy.SK_Proxy'}}});
  const supportedId = [...activeSupported][0], other = '/Game/SelfCheck/SK_Other_M.SK_Other_M';
  const waveMesh = [...WAVE.keys()][0];
  const check = (id, mesh, expectAdmit) => {
    const kept = [], verdict = wrapVerdict(id, [wrapped(mesh)], kept);
    if ((verdict === null) !== expectAdmit) throw Error(`proxy-wrap self-check failed: ${id} ${mesh} ${verdict}`);
  };
  check(supportedId, waveMesh, false);                 // a wrapped part on a wave mesh: refused
  check('__selfcheck-not-supported__', other, false);  // an item not yet supported: refused
  check(supportedId, other, true);                     // supported, outside the wave: admitted (and recorded)
}
const faces = Object.fromEntries(Object.keys(pairs).map(f => [f, read(`public/models/reconstructed-assembly-v2/items/${f}.json`)]));
const rows = [], skipped = [], rebind = new Set(), lightMaterialOverrides = [];
for (const id of read(own('ids.json')[1])) {
  const definition = read(`public/models/reconstructed-assembly-v2/items/${id}.json`);
  const fresh = freshProperties(definition);
  const admission = admitDrift(id, definition, fresh);
  if (!admission.ok) { skipped.push({id, reason: `Season 12 drift: ${JSON.stringify(drift[id] ?? null)}`, driftAdmission: admission}); continue; }
  // The plan's Light-sibling condition, on the 17 Nov definition: a Light override must not set materials.
  for (const [n, part] of (fresh?.VisualParts ?? []).entries())
    for (const [k, o] of (part.TagOverrides ?? []).entries())
      if ((o.MatchingTags ?? []).includes(LIGHT) && (o.bOverrideMaterials || (o.MaterialOverrides ?? []).length))
        lightMaterialOverrides.push(`${id} part ${n} override ${k}`);
  const r = {name: catalogItems.get(id)?.name ?? id, slot: catalogItems.get(id)?.slot ?? null};
  const proxyWrapKept = [], wrapRefusal = wrapVerdict(id, definition.properties.VisualParts || [], proxyWrapKept);
  if (wrapRefusal) { skipped.push({id, reason: wrapRefusal}); continue; }
  let resolved;
  try { resolved = resolveMedium(definition).items[id]; }
  catch (e) { skipped.push({id, reason: String(e.message ?? e)}); continue; }
  const visible = resolved.parts.filter(p => !p.hidden);
  const row = {id, name: r.name, slot: r.slot, definitionSource: definition.source, definitionSha256: definition.sourceSha256,
    meshes: [...new Set(visible.flatMap(p => [p.skeletalMesh, p.staticMesh]).filter(Boolean))], resolved, definition,
    driftAdmission: admission, ...(proxyWrapKept.length ? {proxyWrapKept} : {})};
  // C2 scope: each visible part on one of the five meshes binds the item's override for each slot, else the mesh default,
  // exactly as the source stage's effectiveMaterials plan does (case-folded slot names). Other parts are left as bound.
  const waveParts = visible.filter(p => WAVE.has(p.skeletalMesh || p.staticMesh));
  if (!waveParts.length) throw Error(`${id}: shows none of the five C2 meshes (${row.meshes})`);
  for (const p of waveParts) {
    const mesh = p.skeletalMesh || p.staticMesh;
    const slots = active.meshes[mesh].slots, names = slots.map(s => s.slot);
    for (const s of slots) rebind.add(materialSlotOverride(p.materials ?? {}, s.slot, names) ?? s.material);
  }
  row.waveMeshes = [...new Set(waveParts.map(p => WAVE.get(p.skeletalMesh || p.staticMesh)))];
  row.otherMeshes = row.meshes.filter(m => !WAVE.has(m));
  row.faceParameters = Object.fromEntries(Object.entries(faces).map(([face, faceDefinition]) => [face,
    resolveSourceOutfit([faceDefinition, definition], MEDIUM).materialParameters.filter(p => p.itemId === id)]));
  rows.push(row);
}
if (lightMaterialOverrides.length) throw Error(`A 17 Nov Light override sets materials; the plan says use it, so stop: ${lightMaterialOverrides}`);
const notActive = [...rebind].filter(s => !(s in active.materials));
if (notActive.length) throw Error(`Not bound by the active index, so nothing to rebind: ${notActive}`);
const admitted = rows.filter(r => r.driftAdmission.how === 'merge-modifier-only');
const mergeModifierAdmitted = {count: admitted.length, rule: RULE, ruleSha256: sha(RULE_FILE), context: MEDIUM,
  items: admitted.map(r => ({id: r.id, appended: r.driftAdmission.appended, resolvedEqual: r.driftAdmission.resolvedEqual}))};
const keptRows = rows.filter(r => r.proxyWrapKept);
const proxyWrapKeptSupported = {count: keptRows.length,
  rule: 'proxy-wrapped part kept as admitted: the item is in the active supported-items and the part is not a wave mesh',
  items: keptRows.map(r => ({id: r.id, parts: r.proxyWrapKept}))};
const out = `${OUT}/cohort-v1.json`;
if (fs.existsSync(out)) throw Error('Preserve the cohort');
const inputs = [...CONFIG.plan.map(p => [p, p]),
  ...['scripts/generated/catalog-public-worktree/src/data/items.json',
      'scripts/generated/catalog-public-worktree/src/data/reconstruction-reviews.json',
      'public/models/reconstructed-assemblies-v1/supported-items.json',
      'public/models/reconstructed-assemblies-v1/skin-pairs.json',
      'public/models/reconstructed-assemblies-v1/assets.json', RESOLVER].map(p => [p, p]), [RULE, RULE_FILE],
  own('ids.json'), own('drift/v1/drift.json'), own('neutral-drift.json'), own('prepare-cohort.mjs'), ...extractUsed];
fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(out, JSON.stringify({at: new Date().toISOString(), scope: CONFIG.scope,
  inputs: Object.fromEntries(inputs.map(([key, file]) => [key, sha(file)])), mergeModifierAdmitted, proxyWrapKeptSupported,
  items: rows, skipped}, null, 1) + '\n');
const params = rows.filter(r => r.resolved.materialParameters?.length).map(r => r.id);
const batch = `${OUT}/batch-attached.json`;
if (fs.existsSync(batch)) throw Error('Preserve the batch');
fs.writeFileSync(batch, JSON.stringify({formatVersion: 1, cohort: `${T}/cohort-v1.json`, effectiveMaterials: true,
  parameterOverlays: true, meaning: CONFIG.meaning, name: NAME, nullColourDefault: true, ...(CONFIG.extra ?? {}),
  rebindKeptMaterials: [...rebind].sort(),
  ids: rows.filter(r => CONFIG.withParameters || !params.includes(r.id)).map(r => r.id)}, null, 1) + '\n');
const count = key => Object.fromEntries([...new Set(rows.map(r => r.driftAdmission[key]))].map(v => [v, rows.filter(r => r.driftAdmission[key] === v).length]));
console.log(JSON.stringify({batch: NAME, rows: rows.length, driftAdmission: count('how'),
  mergeModifierAdmitted: admitted.length, proxyWrapKeptSupported: keptRows.length, withParameters: params, batchIds: rows.length,
  rebindKeptMaterials: rebind.size, itemsWithOtherParts: rows.filter(r => r.otherMeshes.length).length,
  activeAssetsSha256: sha('public/models/reconstructed-assemblies-v1/assets.json'), skipped}, null, 1));
