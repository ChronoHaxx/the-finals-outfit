// Focused tests for the audit's pure logic: what goes in the manifest, what the first
// cohort selects, when recorded evidence stops being valid, and how observations become
// separate states. Run with:
//
//   node --test scripts/shader-probe/catalog-audit-core.test.mjs
//
// (scripts/test.mjs only discovers tests/ and scripts/lib/, and this audit owns neither.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from './catalog-audit-core.mjs';

test('measured cameras retain off-axis wrists and large targets at all capture angles', () => {
  const rotations = [0, Math.PI, 0.7];
  const boxes = [
    { framing: 'hands', min: [0.527, 1.124, -0.072], max: [0.583, 1.177, -0.001] },
    { framing: 'head', min: [-0.12, 1.54, -0.13], max: [0.12, 1.91, 0.13] },
    { framing: 'outerwear', min: [-1.2, -0.2, -0.7], max: [1.4, 2.2, 0.4] },
  ];
  for (const bounds of boxes) {
    const [, cy, distance] = core.fitAuditCamera(bounds, { framing: bounds.framing }).split(',').map(Number);
    for (const angle of rotations) for (const x of [bounds.min[0], bounds.max[0]])
      for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const rx = x * Math.cos(angle) + z * Math.sin(angle);
        const rz = -x * Math.sin(angle) + z * Math.cos(angle);
        const depth = distance - rz;
        assert(depth > 0);
        const halfY = depth * Math.tan(28 * Math.PI / 360);
        assert(Math.abs(rx) <= halfY * 1600 / 1100 / 1.49, `Cropped X: ${bounds.framing}`);
        assert(Math.abs(y - cy) <= halfY / 1.49, `Cropped Y: ${bounds.framing}`);
      }
  }
});

const items = JSON.parse(fs.readFileSync('src/data/items.json', 'utf8'));
const index = JSON.parse(fs.readFileSync('public/models/reconstructed-assemblies-v1/supported-items.json', 'utf8')
  .replace(/^﻿/, ''));
const catalog = new Map(items.map(i => [i.id, i]));
const rows = core.buildManifest({
  items, sourceItems: index.items, sourceExceptions: index.exceptions, assetExists: () => true,
});
const row = (id) => rows.find(r => r.id === id);

// Three real choices, one per rendering path, so the classification is tested against the
// catalog that actually ships rather than a fixture that agrees with the code.
const LEGACY = 'streetwear-baseballcap-cotton-black';
const SOURCE = 'casual-basictshirt-cotton-dissun';
const OVERLAY = 'bodycosmetics-tattoos-dragon-01'; // decal composited onto the body skin

test('manifest holds every catalog choice, including decal, source-only and unrenderable rows', () => {
  assert.equal(rows.length, items.length);
  assert.equal(new Set(rows.map(r => r.id)).size, items.length);
  assert.deepEqual(rows.map(r => r.id), [...rows.map(r => r.id)].sort()); // deterministic order

  assert.equal(row(LEGACY).declaredPath, 'legacy-mesh');
  assert.equal(row(SOURCE).declaredPath, 'source-assembly');
  assert.equal(row(OVERLAY).declaredPath, 'decal');
  assert.deepEqual(row(OVERLAY).decalTargets, ['body', 'head']); // this tattoo composites onto both

  // A reconstructed choice the catalog has no mesh for is still eligible: it renders only
  // through the source path.
  const sourceOnly = rows.filter(r => r.declaredPath === 'source-assembly' && !r.gltfPath);
  assert.ok(sourceOnly.length >= 1);
  assert.ok(sourceOnly.every(r => r.eligible));

  // A row with neither a model nor a decal is unrenderable and says so.
  const unrenderable = rows.filter(r => r.declaredPath === 'none');
  assert.ok(unrenderable.length >= 1);
  assert.ok(unrenderable.every(r => !r.eligible && r.ineligibleReasons.length));
});

test('a required asset that is missing locally makes a choice ineligible, not a capture', () => {
  const missing = core.buildManifest({
    items: [catalog.get(LEGACY)], assetExists: (p) => !p.endsWith('.glb'),
  })[0];
  assert.equal(missing.eligible, false);
  assert.match(missing.ineligibleReasons[0], /required asset missing/);
});

test('surface production is classified from the catalog bindings', () => {
  // The cap carries a baked binding AND a binding with nothing but a family name: the flat
  // untextured brim edge in its render is that second binding, and the manifest says so.
  assert.deepEqual(core.materialKinds(catalog.get(LEGACY)), ['baked', 'bare']);
  assert.deepEqual(core.materialKinds(catalog.get(SOURCE)), ['baked']);
  assert.deepEqual(core.materialKinds(catalog.get(OVERLAY)), ['decal']);
  assert.equal(core.familyKey(catalog.get(SOURCE)), 'mesh:models/cosmetics/casual-basic-tshirt.glb');
  assert.ok(row(SOURCE).familySize > 1); // siblings share the mesh and differ by material
});

test('the first cohort is deterministic, and mixed across slot, path and material', () => {
  const a = core.selectCohort(rows, { size: 64, seed: 'current-catalog-audit-01' });
  const b = core.selectCohort(rows, { size: 64, seed: 'current-catalog-audit-01' });
  assert.deepEqual(a.selectedIds, b.selectedIds);
  assert.equal(a.selectedIds.length, 64);
  assert.notDeepEqual(core.selectCohort(rows, { size: 64, seed: 'other' }).selectedIds, a.selectedIds);

  const chosen = a.selected;
  assert.equal(new Set(chosen.map(r => r.slot)).size, new Set(rows.map(r => r.slot)).size);
  assert.ok(chosen.some(r => r.sourceEnabled), 'reconstructed controls');
  assert.ok(chosen.filter(r => r.declaredPath === 'legacy-mesh').length >= 20, 'non-source legacy choices');
  assert.ok(chosen.filter(r => r.declaredPath === 'decal').length >= 6, 'decals');
  assert.ok(chosen.some(r => r.declaredPath === 'source-assembly' && !r.gltfPath), 'source-only choice');
  assert.ok(chosen.some(r => r.slot === 'face') && chosen.some(r => r.slot === 'hair'), 'face and hair');
  // Variant sets: at least one mesh family contributes siblings that differ only by material.
  const perFamily = new Map();
  for (const r of chosen) perFamily.set(r.familyKey, (perFamily.get(r.familyKey) ?? 0) + 1);
  assert.ok([...perFamily.values()].some(n => n >= 3));
  assert.ok(chosen.every(r => r.reasons.length), 'every pick records why it was picked');
  assert.ok(chosen.every(r => r.eligible), 'never selects a structurally unrenderable row');
});

test('capture order groups by base and framing so a camera move is not paid twice', () => {
  const ordered = core.captureOrder(core.selectCohort(rows, { size: 64 }).selected);
  const keys = ordered.map(r => `${core.baseKeyFor(r)}|${core.framingFor(r)}`);
  assert.deepEqual(keys, [...keys].sort()); // contiguous runs, not interleaved
  assert.equal(core.baseKeyFor(row(OVERLAY)), 'skin'); // body decals are judged on bare skin
  assert.equal(core.baseKeyFor(row(LEGACY)), 'reference');
});

test('the control render is the same base with the audited slot empty', () => {
  const bases = { reference: { face: 'f', hair: 'h', upperBody: 'u' }, skin: { face: 'f', hair: 'h' } };
  const base = core.baseFor(row(SOURCE), bases);
  assert.equal(base.key, 'reference');
  assert.equal('upperBody' in base.slots, false);
  assert.deepEqual(core.baseFor(row(OVERLAY), bases).slots, { face: 'f', hair: 'h' });
});

test('the fingerprint changes when anything that can change the picture changes', () => {
  const config = { fov: 28, pose: 'a' };
  const digests = { catalog: 'aaa', renderer: { viewer: 'bbb' }, tools: { runner: 'ccc' }, activeIndex: { 'a.json': 'ddd' } };
  const base = core.globalFingerprint({ config, digests });
  assert.equal(base, core.globalFingerprint({ config: { pose: 'a', fov: 28 }, digests }), 'key order is irrelevant');
  for (const mutate of [
    d => ({ ...d, catalog: 'zzz' }),
    d => ({ ...d, renderer: { viewer: 'zzz' } }),
    d => ({ ...d, tools: { runner: 'zzz' } }),
    d => ({ ...d, activeIndex: { 'a.json': 'zzz' } }),
  ]) assert.notEqual(core.globalFingerprint({ config, digests: mutate(digests) }), base);
  assert.notEqual(core.globalFingerprint({ config: { ...config, fov: 35 }, digests }), base);

  // Per item: its own asset content and the base/framing it was captured under.
  const item = core.itemFingerprint(base, 'asset-1', { base: 'reference', framing: 'head' });
  assert.equal(item, core.itemFingerprint(base, 'asset-1', { base: 'reference', framing: 'head' }));
  assert.notEqual(item, core.itemFingerprint(base, 'asset-2', { base: 'reference', framing: 'head' }));
  assert.notEqual(item, core.itemFingerprint(base, 'asset-1', { base: 'skin', framing: 'head' }));
});

test('a resume reuses unchanged evidence and refuses everything else', () => {
  const record = {
    captureStatus: 'captured', fingerprint: 'fp-1',
    views: core.REQUIRED_VIEWS.map(view => ({ view, file: `items/headwear/a.${view}.png` })),
    controlViews: core.REQUIRED_VIEWS.map(view => ({ view, file: `controls/fp/a.${view}.png` })),
  };
  const onDisk = new Set([...record.views, ...record.controlViews].map(v => v.file));
  const exists = (f) => onDisk.has(f);

  assert.deepEqual(core.isResumable(record, 'fp-1', exists), { resume: true, reason: 'unchanged since capture' });
  assert.equal(core.isResumable(record, 'fp-2', exists).resume, false);           // snapshot moved
  assert.match(core.isResumable(record, 'fp-2', exists).reason, /snapshot changed/);
  assert.equal(core.isResumable(record, 'fp-1', () => false).resume, false);      // captures deleted
  assert.equal(core.isResumable({ ...record, captureStatus: 'failed' }, 'fp-1', exists).resume, false);
  assert.equal(core.isResumable(undefined, 'fp-1', exists).resume, false);        // never captured
  assert.equal(core.isResumable({ ...record, views: record.views.slice(0, 1) }, 'fp-1', exists).resume, false);
  assert.equal(core.isResumable({ ...record, controlViews: [] }, 'fp-1', exists).resume, false);
  assert.equal(core.isResumable({ ...record, views: [] }, 'fp-1', exists).resume, false);
  const withHashes = { ...record, imageDigests: Object.fromEntries([...onDisk].map(file => [file, 'image-sha'])) };
  assert.equal(core.isResumable(withHashes, 'fp-1', exists, () => 'image-sha').resume, true);
  assert.equal(core.isResumable(withHashes, 'fp-1', exists, () => 'changed-image-sha').resume, false);
});

test('evidence becomes separate states, and a screenshot is never an acceptance', () => {
  const views = [{ view: 'front' }, { view: 'back' }, { view: 'oblique' }];
  const visible = core.classifyEvidence(row(LEGACY), {
    attached: true, groupVisible: true, visibleMeshes: 2, changedFraction: 0.05,
    changeThreshold: 0.0002, views,
  });
  assert.equal(visible.targetEvidence, 'confirmed-visible');
  assert.equal(visible.captureStatus, 'captured');
  assert.equal(visible.visualReview, 'pending');
  assert.equal(visible.outfitAcceptance, 'pending');

  // Equipped but suppressed — a headwear item hides the source hair assembly.
  assert.equal(core.classifyEvidence(row(LEGACY), {
    attached: true, groupVisible: false, visibleMeshes: 0, changedFraction: 0.05,
    changeThreshold: 0.0002, views,
  }).targetEvidence, 'attached-not-visible');

  // Attached, on screen, but the picture is identical to the control: not evidence of the item.
  assert.equal(core.classifyEvidence(row(LEGACY), {
    attached: true, groupVisible: true, visibleMeshes: 1, changedFraction: 0.00001,
    changeThreshold: 0.0002, views,
  }).targetEvidence, 'attached-no-pixel-change');

  // The base outfit renders fine and the item never attached: still not a success.
  const missing = core.classifyEvidence(row(LEGACY), { attached: false, changedFraction: 0, changeThreshold: 0.0002, views });
  assert.equal(missing.targetEvidence, 'not-attached');
  assert.equal(missing.observedPath, 'none');

  // No views at all is a failed capture, whatever else was observed.
  assert.equal(core.classifyEvidence(row(LEGACY), { attached: true, groupVisible: true, visibleMeshes: 1 }).captureStatus, 'failed');
});

test('overlay evidence is decided by texture, compositor and pixels — not by a clean page', () => {
  const views = [{ view: 'front' }];
  const decal = (extra) => core.classifyEvidence(row(OVERLAY), {
    decalTexturesRequested: ['dragon.webp'], decalAppliedTargets: ['body', 'head'], changeThreshold: 0.0002, views, ...extra,
  });
  assert.equal(decal({ decalTexturesFetched: ['dragon.webp'], decalPatchedMaterials: 1, changedFraction: 0.004 })
    .targetEvidence, 'confirmed-visible');
  assert.equal(decal({ decalTexturesFetched: ['dragon.webp'], decalPatchedMaterials: 0, changedFraction: 0.004 })
    .targetEvidence, 'texture-fetched-not-composited');
  assert.equal(decal({ decalTexturesFetched: [], decalPatchedMaterials: 1, changedFraction: 0.004 })
    .targetEvidence, 'not-applied');
  assert.equal(decal({ decalTexturesFetched: ['dragon.webp'], decalPatchedMaterials: 1, changedFraction: 0 })
    .targetEvidence, 'applied-no-pixel-change');
  assert.equal(decal({ decalTexturesFetched: ['dragon.webp'], decalPatchedMaterials: 1, changedFraction: null })
    .targetEvidence, 'applied-no-pixel-evidence');
});

test('tint-only nails need the nail compositor and a pixel change, not an invented texture', () => {
  const nail = row('bodycosmetics-nails-alfaacta-01');
  assert.equal(nail.decalTintOnly, true);
  const evidence = { decalPatchedMaterials: 1, decalAppliedTargets: ['nails'], changedFraction: 0.02,
    changeThreshold: 0.0002, views: core.REQUIRED_VIEWS.map(view => ({ view })) };
  assert.equal(core.classifyEvidence(nail, evidence).targetEvidence, 'confirmed-visible');
  assert.equal(core.classifyEvidence(nail, { ...evidence, decalAppliedTargets: ['body'] }).targetEvidence, 'not-applied');
  assert.equal(core.classifyEvidence(nail, { ...evidence, changedFraction: 0 }).targetEvidence, 'applied-no-pixel-change');
  assert.equal(core.classifyEvidence(nail, { ...evidence, views: evidence.views.slice(0, 1) }).captureStatus, 'failed');
});

test('an enabled source choice does not require its unused legacy GLB', () => {
  const [source] = core.buildManifest({ items: [catalog.get(SOURCE)], sourceItems: [SOURCE], assetExists: () => false });
  assert.equal(source.eligible, true);
  assert.equal(source.declaredPath, 'source-assembly');
});

test('a source choice that falls back to the legacy path is recorded, not hidden', () => {
  const fellBack = core.classifyEvidence(row(SOURCE), {
    attached: true, sourceAssembly: false, groupVisible: true, visibleMeshes: 1,
    changedFraction: 0.1, changeThreshold: 0.0002, views: [{ view: 'front' }],
  });
  assert.equal(fellBack.observedPath, 'legacy-mesh');
  assert.match(fellBack.notes[0], /catalog declares source-assembly; the rig used legacy-mesh/);
  const onPath = core.classifyEvidence(row(SOURCE), {
    attached: true, sourceAssembly: true, groupVisible: true, visibleMeshes: 1,
    changedFraction: 0.1, changeThreshold: 0.0002, views: [{ view: 'front' }],
  });
  assert.deepEqual(onPath.notes, []);
});

test('interaction requirements stay pending, and family size stays prospective', () => {
  const upper = core.interactionRequirements('upperBody').map(i => i.name);
  assert.deepEqual(upper, ['coat-over-shirt', 'sleeves-vs-gloves']);
  assert.deepEqual(core.interactionRequirements('feet').map(i => i.name), ['pants-vs-boots']);
  assert.deepEqual(core.interactionRequirements('headwear').map(i => i.name), ['headwear-vs-hair']);
  assert.ok(['upperBody', 'outerwear', 'hands', 'lowerBody', 'feet', 'headwear', 'hair', 'wrist', 'facewear', 'eyes']
    .flatMap(core.interactionRequirements).every(i => i.status === 'pending'));

  const gain = core.prospectiveFamilyGain(row(SOURCE), rows);
  assert.equal(gain.untestedSiblings, gain.catalogChoicesInFamily - 1);
  assert.match(gain.meaning, /prospective/);
});

test('the results summary never reports a visual acceptance', () => {
  const summary = core.resultsSummary([
    { captureStatus: 'captured', targetEvidence: 'confirmed-visible', observedPath: 'legacy-mesh', renderClean: true },
    { captureStatus: 'unsupported', targetEvidence: 'not-applicable', observedPath: 'none', renderClean: null, errors: ['x'] },
  ]);
  assert.equal(summary.items, 2);
  assert.equal(summary.byCaptureStatus.captured, 1);
  assert.equal(summary.byCaptureStatus.unsupported, 1);
  assert.equal(summary.visuallyAccepted, 0);
  assert.match(summary.meaning, /No item here is visually accepted/);
});
