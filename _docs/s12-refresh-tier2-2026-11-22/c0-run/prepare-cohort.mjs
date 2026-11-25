// s12-c0 (25 Nov 2026, S12 tier-2 refresh session for the coordinator; batch C wave C0, BATCH-C-PLAN.md): the 43
// BasicTshirt items. Copy of _docs/goal-100-2026-10-11/w177-panning-contract/prepare-cohort.mjs (see its header for the
// chain back to w152) with NAME, the folder, the scope, the drift sources and the plan list changed (map v1 and the View
// layout gate instead of the 12.00 map), plus one opt-in: rebindKeptMaterials names every material the items bind, so
// the batch rebuilds them from the 17 Nov build and rebinds them (the w107 route, prepare-accessory-defaults.py
// stage_index) instead of keeping the live 6 Nov builds. The Season 12 T-shirt's UVs changed, so its materials must be
// rebuilt from the same build. Fresh drift c0-run/drift/v1 (map v1): 43 identical, so the neutral list is empty.
//
// Run from the repo root (Git Bash or PowerShell):
//   node --import tsx _docs/s12-refresh-tier2-2026-11-22/c0-run/prepare-cohort.mjs
// C0_OUT=<folder> writes the cohort and batch there instead (a dry run); the batch still names T's cohort path.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
// From the working directory (the root), not from this file, so a dry run from another checkout reads the root's resolver.
const RESOLVER = 'scripts/generated/catalog-public-worktree/src/rig/SourceAssembly.ts';
const {resolveSourceOutfit, materialSlotOverride} = await import(pathToFileURL(path.resolve(RESOLVER)).href);
const NAME = 's12-c0';
const G = '_docs/goal-100-2026-10-11';
const T = '_docs/s12-refresh-tier2-2026-11-22/c0-run';
const HERE = path.dirname(fileURLToPath(import.meta.url));  // T's own files; the same folder in a root run
const OUT = process.env.C0_OUT ?? T;
const TEE = '/Game/Discovery/Characters/Casual/Assets/BasicTshirt/SK_Casual_BasicTshirt_M.SK_Casual_BasicTshirt_M';
const CONFIG = {
  scope: 's12-c0: batch C wave C0, the 43 BasicTshirt items (the starting outfit T-shirt). The Season 12 T-shirt mesh ' +
         '(s12-bodytype-refresh-v1, package byte-identical on 17 Nov) changed its UVs, so its 43 material instances are ' +
         'rebuilt from the 17 Nov build and rebound (rebindKeptMaterials); the mesh and its body mask are repointed by the ' +
         'refresh patch (scripts/body-types/make-refresh-patch.py), not by this batch',
  meaning: 'attached-route rebuild of kept materials on map v1: every T-shirt item stays advertised and differs only by ' +
           'its rebound material; visual and human acceptance remain separate.',
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
const neutralDrift = new Set(read(own('neutral-drift.json')[1]));  // c0: fresh drift v1, 43 identical; neutral list empty
const NEUTRAL_KEYS = new Set(['Slots', 'AudioTags']);
const season12 = new Set(JSON.stringify(read('_docs/season12-import-2026-10-28/import-plan-v2.json')).match(/"(?:id|itemId)":"[^"]+"/g)
  .map(m => m.split(':"')[1].slice(0, -1)));
const driftOk = id => season12.has(id) || drift[id]?.status === 'identical' || (drift[id]?.status === 'differs' && neutralDrift.has(id) &&
  (drift[id].keys ?? []).length > 0 && drift[id].keys.every(k => NEUTRAL_KEYS.has(k)));
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
const faces = Object.fromEntries(Object.keys(pairs).map(f => [f, read(`public/models/reconstructed-assembly-v2/items/${f}.json`)]));
const rows = [], skipped = [], rebind = new Set();
for (const id of read(own('ids.json')[1])) {
  if (!driftOk(id)) { skipped.push({id, reason: `Season 12 drift: ${JSON.stringify(drift[id] ?? null)}`}); continue; }
  const r = {name: catalogItems.get(id)?.name ?? id, slot: catalogItems.get(id)?.slot ?? null}, definition = read(`public/models/reconstructed-assembly-v2/items/${id}.json`);
  if ((definition.properties.VisualParts || []).some(v => proxyWrapped(v) && !wrapAdmitted(id, v))) { skipped.push({id, reason: 'proxy wrap without passing evidence'}); continue; }
  let resolved;
  try { resolved = resolveSourceOutfit([definition], ['Customization.Archetype.Medium']).items[id]; }
  catch (e) { skipped.push({id, reason: String(e.message ?? e)}); continue; }
  const visible = resolved.parts.filter(p => !p.hidden);
  const row = {id, name: r.name, slot: r.slot, definitionSource: definition.source, definitionSha256: definition.sourceSha256,
    meshes: [...new Set(visible.flatMap(p => [p.skeletalMesh, p.staticMesh]).filter(Boolean))], resolved, definition};
  // C0 scope guard: every visible part is the kept T-shirt mesh; each of its slots binds the item's override, else the
  // mesh default, exactly as the source stage's effectiveMaterials plan does (case-folded slot names).
  for (const p of visible) {
    const mesh = p.skeletalMesh ?? p.staticMesh;
    if (mesh !== TEE) throw Error(`${id}: shows ${mesh}; C0 rebinds the T-shirt's materials only`);
    const slots = active.meshes[mesh].slots, names = slots.map(s => s.slot);
    for (const s of slots) rebind.add(materialSlotOverride(p.materials ?? {}, s.slot, names) ?? s.material);
  }
  row.faceParameters = Object.fromEntries(Object.entries(faces).map(([face, faceDefinition]) => [face,
    resolveSourceOutfit([faceDefinition, definition], ['Customization.Archetype.Medium']).materialParameters.filter(p => p.itemId === id)]));
  rows.push(row);
}
const notActive = [...rebind].filter(s => !(s in active.materials));
if (notActive.length) throw Error(`Not bound by the active index, so nothing to rebind: ${notActive}`);
const out = `${OUT}/cohort-v1.json`;
if (fs.existsSync(out)) throw Error('Preserve the cohort');
const inputs = [...CONFIG.plan.map(p => [p, p]),
  ...['scripts/generated/catalog-public-worktree/src/data/items.json',
      'scripts/generated/catalog-public-worktree/src/data/reconstruction-reviews.json',
      'public/models/reconstructed-assemblies-v1/supported-items.json',
      'public/models/reconstructed-assemblies-v1/skin-pairs.json',
      'public/models/reconstructed-assemblies-v1/assets.json', RESOLVER].map(p => [p, p]),
  own('ids.json'), own('drift/v1/drift.json'), own('neutral-drift.json'), own('prepare-cohort.mjs')];
fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(out, JSON.stringify({at: new Date().toISOString(), scope: CONFIG.scope,
  inputs: Object.fromEntries(inputs.map(([key, file]) => [key, sha(file)])), items: rows, skipped}, null, 1) + '\n');
const params = rows.filter(r => r.resolved.materialParameters?.length).map(r => r.id);
const batch = `${OUT}/batch-attached.json`;
if (fs.existsSync(batch)) throw Error('Preserve the batch');
fs.writeFileSync(batch, JSON.stringify({formatVersion: 1, cohort: `${T}/cohort-v1.json`, effectiveMaterials: true,
  parameterOverlays: true, meaning: CONFIG.meaning, name: NAME, nullColourDefault: true, ...(CONFIG.extra ?? {}),
  rebindKeptMaterials: [...rebind].sort(),
  ids: rows.filter(r => CONFIG.withParameters || !params.includes(r.id)).map(r => r.id)}, null, 1) + '\n');
console.log(JSON.stringify({batch: NAME, rows: rows.length, withParameters: params, batchIds: rows.length,
  rebindKeptMaterials: rebind.size, activeAssetsSha256: sha('public/models/reconstructed-assemblies-v1/assets.json'),
  skipped}, null, 1));
