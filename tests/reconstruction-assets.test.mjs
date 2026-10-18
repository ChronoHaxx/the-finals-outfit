import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectReconstructionAssetRefs, collectAssetCompanions, RECONSTRUCTION_ROOTS } from '../scripts/lib/reconstruction-assets.mjs';
import { planAssetShards, readAssetGraph } from '../scripts/lib/asset-shards.mjs';

test('default staging includes optional eye index and dependencies, while old releases stay valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'finals-release-eyes-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value); };
  try {
    for (const path of RECONSTRUCTION_ROOTS)
      put(path, path.endsWith('.json') ? { formatVersion: 1, items: [] } : 'fixture');
    const prior = collectReconstructionAssetRefs(root);
    const eyeIndex = 'models/reconstructed-assemblies-v1/face-cosmetics.json';
    assert.equal(prior.has(eyeIndex), false);
    const slots = { shader_eyeLeft_shader: { material: '../eye/eye.json' }, shader_eyeRight_shader: { material: '../eye/eye.json' } };
    put(eyeIndex, { formatVersion: 1, items: { eye: { slots } } });
    put('models/eye/eye.json', { recoveredEmissive: true, shader: 'eye.glsl', textures: [{ file: 'eye.rgba.gz.bin' }] });
    put('models/eye/eye.glsl', 'fixture');
    put('models/eye/eye.rgba.gz.bin', 'fixture');
    const next = collectReconstructionAssetRefs(root);
    assert.equal(next.size, prior.size + 4);
    assert.ok(next.has(eyeIndex));
    assert.ok(next.has('models/eye/eye.rgba.gz.bin'));
    put(eyeIndex, { formatVersion: 2, items: {} });
    assert.throws(() => collectReconstructionAssetRefs(root), /Invalid source face cosmetics index/);
    // The runtime refuses an item without recipient slots, so the release must too.
    put(eyeIndex, { formatVersion: 1, items: { eye: { material: '../eye/eye.json' } } });
    assert.throws(() => collectReconstructionAssetRefs(root), /Invalid source face cosmetics index/);
    put(eyeIndex, { formatVersion: 1, items: { eye: { slots: { shader_eyeLeft_shader: { material: '../eye/missing.json' } } } } });
    assert.throws(() => collectReconstructionAssetRefs(root), /Missing reconstruction asset/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('head wrap index travels with the release when present and lands on the primary package', () => {
  const root = mkdtempSync(join(tmpdir(), 'finals-release-wraps-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value); };
  const wraps = 'models/reconstructed-assemblies-v1/head-wraps.json';
  const valid = { formatVersion: 1, contract: 'finals-head-component-wrap-v1', reference: { positions: [], triangles: [] },
    cages: {}, heads: {}, meshes: {}, provenance: { containers: [['global.utoc', 'ABC']] } };
  try {
    for (const path of RECONSTRUCTION_ROOTS)
      put(path, path.endsWith('.json') ? { formatVersion: 1, items: [] } : 'fixture');
    const prior = collectReconstructionAssetRefs(root);
    assert.equal(prior.has(wraps), false, 'a release without head wraps stays valid');
    put(wraps, valid);
    const next = collectReconstructionAssetRefs(root);
    assert.equal(next.size, prior.size + 1, 'self-contained: no dependencies are invented from provenance');
    assert.ok(next.has(wraps));
    put(wraps, { ...valid, contract: 'other' });
    assert.throws(() => collectReconstructionAssetRefs(root), /Invalid head wrap index/);
    put(wraps, { ...valid, cages: [] });
    assert.throws(() => collectReconstructionAssetRefs(root), /Invalid head wrap index/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  // The browser fetches it beside supported-items.json from the primary base, so the
  // default planner roots must pin it to shard 0 even when the package splits.
  const node = dependencies => ({ bytes: 1, sha256: '0'.repeat(64), dependencies });
  const leaves = Array.from({ length: 7 }, (_, i) => `models/reconstructed-leaf-${i}/mesh.glb`);
  const nodes = { 'models/reconstructed-assemblies-v1/assets.json': node([...leaves].sort()), [wraps]: node([]),
    ...Object.fromEntries(leaves.map(p => [p, node([])])) };
  const plan = planAssetShards(nodes, { version: 'wraps', limits: { maxFiles: 8, reservedFiles: 3, maxFileBytes: 1024 } });
  assert.ok(plan.shards.length > 1);
  assert.ok(plan.requiredRoots.includes(wraps));
  assert.ok(plan.shards[0].paths.includes(wraps));
});

test('release follows nested material, shadow, texture, fitting and variant dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'finals-release-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value); };
  try {
    put('models/index/assets.json', { meshes: { source: { url: '../mesh/body.glb', bodyMaskUrl: '../mesh/body.png' } },
      materials: { source: '../shaders/base.json' }, materialVariants: { variant: '../variants/hair.json' } });
    put('models/shaders/base.json', { shader: 'base.glsl', coverageShader: 'shadow.glsl',
      textures: [{ file: '../shared/tex.rgba.gz.bin', source: '/Game/DoNotPublish.uasset' }] });
    put('models/variants/hair.json', { shader: '../shaders/base.glsl', textures: [{ file: '../shared/tex.rgba.gz.bin' }] });
    for (const path of ['models/mesh/body.glb', 'models/mesh/body.png', 'models/shaders/base.glsl',
      'models/shaders/shadow.glsl', 'models/shared/tex.rgba.gz.bin']) put(path, 'fixture');
    const refs = collectReconstructionAssetRefs(root, ['models/index/assets.json']);
    assert.equal(refs.size, 8);
    assert.ok(refs.has('models/shaders/shadow.glsl'));
    assert.ok(refs.has('models/variants/hair.json'));
    put('models/mesh/body.coverage.webp', 'fixture');
    assert.deepEqual([...collectAssetCompanions(root, refs)], ['models/mesh/body.coverage.webp']);
    put('models/variants/hair.json', { shader: 'missing.glsl' });
    assert.throws(() => collectReconstructionAssetRefs(root, ['models/index/assets.json']), /Missing reconstruction asset/);
    put('models/variants/hair.json', { shader: '../../../escape.glsl' });
    assert.throws(() => collectReconstructionAssetRefs(root, ['models/index/assets.json']), /escapes public/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('evidence citations in served JSON are not followed as asset dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'finals-release-citation-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value); };
  try {
    // Shape of the PlasticSheet materials activated on 12 Oct 2026.
    put('models/index/assets.json', { materials: { sheet: '../sheet/mi-sheet.json' } });
    put('models/sheet/mi-sheet.json', { shader: 'sheet.glsl',
      parametricOpacity: { signoff: '_docs/goal-100-2026-10-11/signoffs-2026-10-12.json', noise: 'noise.png' } });
    put('models/sheet/sheet.glsl', 'fixture'); put('models/sheet/noise.png', 'fixture');
    const refs = collectReconstructionAssetRefs(root, ['models/index/assets.json']);
    assert.deepEqual([...refs].sort(), ['models/index/assets.json', 'models/sheet/mi-sheet.json',
      'models/sheet/noise.png', 'models/sheet/sheet.glsl']);
    assert.deepEqual(readAssetGraph(root, ['models/index/assets.json'])['models/sheet/mi-sheet.json'].dependencies,
      ['models/sheet/noise.png', 'models/sheet/sheet.glsl']);
    // Only the evidence folder is exempt: a genuinely missing file still fails.
    put('models/sheet/mi-sheet.json', { shader: 'sheet.glsl', parametricOpacity: { noise: 'missing.png' } });
    assert.throws(() => collectReconstructionAssetRefs(root, ['models/index/assets.json']), /Missing reconstruction asset/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source catalog stages runtime item definitions and fails on missing ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'finals-release-catalog-'));
  const folder = join(root, 'models/reconstructed-assembly-v2');
  try {
    mkdirSync(join(folder, 'items'), { recursive: true });
    writeFileSync(join(folder, 'catalog.json'), JSON.stringify({ formatVersion: 1, items: ['test-hair'] }));
    writeFileSync(join(folder, 'items/test-hair.json'), JSON.stringify({ properties: { Mesh: '/Game/Hair.Hair' } }));
    assert.equal(collectReconstructionAssetRefs(root, ['models/reconstructed-assembly-v2/catalog.json']).size, 2);
    writeFileSync(join(folder, 'catalog.json'), JSON.stringify({ formatVersion: 1, items: ['missing'] }));
    assert.throws(() => collectReconstructionAssetRefs(root, ['models/reconstructed-assembly-v2/catalog.json']), /Missing reconstruction asset/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
