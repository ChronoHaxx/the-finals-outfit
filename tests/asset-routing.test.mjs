import assert from 'node:assert/strict';
import test from 'node:test';
import { isReconstructionPath, joinBase, modelUrlFor } from '../src/lib/asset-routing.mjs';
import { RECONSTRUCTION_ROOTS } from '../scripts/lib/reconstruction-assets.mjs';

test('reconstruction prefix covers every root and nothing that merely shares a name', () => {
  for (const path of [...RECONSTRUCTION_ROOTS, 'models/reconstructed-assemblies-v1', '/models/reconstructed/coat.json',
    'models/reconstructed-body-paints-v1/paint.png']) assert.ok(isReconstructionPath(path), path);
  for (const path of ['models/reconstructedness/a.glb', 'models/body/reconstructed-a.glb',
    'items/reconstructed-a.webp', 'textures/models/reconstructed/a.png']) assert.ok(!isReconstructionPath(path), path);
});

test('modelUrl keeps the existing fallback chain unless the reconstruction override applies', () => {
  const coat = 'models/reconstructed/coat.json', body = 'models/body/body.glb';
  const site = { assetsBase: '/app/' };
  assert.equal(modelUrlFor(body, site), '/app/models/body/body.glb');
  assert.equal(modelUrlFor(coat, site), '/app/models/reconstructed/coat.json');
  const split = { assetsBase: 'https://a.example/v1', modelsBase: 'https://m.example/v2/' };
  assert.equal(modelUrlFor(coat, split), 'https://m.example/v2/models/reconstructed/coat.json');
  const three = { ...split, reconstructionBase: ' https://r.example/v3 ' };
  assert.equal(modelUrlFor(body, three), 'https://m.example/v2/models/body/body.glb');
  assert.equal(modelUrlFor('/' + coat, three), 'https://r.example/v3/models/reconstructed/coat.json');
  assert.equal(modelUrlFor('models/reconstructed-assemblies-v1', three),
    'https://r.example/v3/models/reconstructed-assemblies-v1');
  assert.equal(modelUrlFor('models/reconstructedness/a.glb', three), 'https://m.example/v2/models/reconstructedness/a.glb');
  assert.equal(modelUrlFor(coat, { ...split, reconstructionBase: '  ' }), modelUrlFor(coat, split));
  assert.equal(modelUrlFor(coat, { assetsBase: 'https://a.example/v1', reconstructionBase: 'https://r.example/v3//' }),
    'https://r.example/v3/models/reconstructed/coat.json');
});

test('joinBase normalizes slashes on both sides', () => {
  assert.equal(joinBase('https://a.example/v1', 'x.png'), 'https://a.example/v1/x.png');
  assert.equal(joinBase('https://a.example/v1//', '//x.png'), 'https://a.example/v1/x.png');
  assert.equal(joinBase(' https://a.example/v1// ', '//x.png'), 'https://a.example/v1/x.png');
});

test('blank model override falls back after whitespace normalization', () => {
  assert.equal(modelUrlFor('/models/body/body.glb', { assetsBase: ' /app/ ', modelsBase: '  ' }),
    '/app/models/body/body.glb');
  assert.equal(modelUrlFor('/models/body/body.glb', { assetsBase: ' /app/ ', modelsBase: ' https://m.example/v2/ ' }),
    'https://m.example/v2/models/body/body.glb');
});

test('a public mesh URL maps to its host label and path, and nothing else maps', async () => {
  const { gatedMeshPath, isMeshPath } = await import('../src/lib/asset-routing.mjs');
  assert.equal(gatedMeshPath('https://29ae13de.the-finals-outfit-assets.pages.dev/models/reconstructed-meshes-v2/SK_Body_M.glb'),
    '29ae13de/models/reconstructed-meshes-v2/SK_Body_M.glb');
  assert.equal(gatedMeshPath('https://a029b249.the-finals-outfit-assets.pages.dev/models/body/SK_Body_M.GLB'), 'a029b249/models/body/SK_Body_M.GLB');
  for (const url of ['https://h.example/models/a.bin', 'http://h.example/models/a.glb', 'https://h.example/models/a.glb?v=1',
    '/models/a.glb', 'https://Bad_Label.example/a.glb', 'not a url'])
    assert.equal(gatedMeshPath(url), null, url);
  assert.ok(isMeshPath('a/b.glb?v=1') && !isMeshPath('a/b.glb.json'));
});
