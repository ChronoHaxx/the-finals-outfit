import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectReconstructionAssetRefs, collectAssetCompanions } from '../scripts/lib/reconstruction-assets.mjs';

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
