import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogHostGroups } from '../scripts/lib/catalog-host-groups.mjs';
import { isModelPath, joinBase, modelUrlFor } from '../src/lib/asset-routing.mjs';

const paths = ['items/hair/icon.webp', 'models/body/body.glb', 'models/decals/paint.webp'];
test('one host retains the complete catalog and reconstruction checks', () => {
  assert.deepEqual(catalogHostGroups(paths, ' https://assets.example/v1 '), [
    { base: 'https://assets.example/v1/', paths, reconstruction: true },
  ]);
  assert.deepEqual(catalogHostGroups(paths, 'https://assets.example/v1', 'https://assets.example/v1/'),
    catalogHostGroups(paths, 'https://assets.example/v1'));
});
test('separate model release owns textures and reconstruction, while icons keep the asset host', () => {
  const groups = catalogHostGroups(paths, 'https://icons.example/v1/', 'https://models.example/v2/');
  assert.deepEqual(groups, [
    { base: 'https://icons.example/v1/', paths: ['items/hair/icon.webp'], reconstruction: false },
    { base: 'https://models.example/v2/', paths: ['models/body/body.glb', 'models/decals/paint.webp'], reconstruction: true },
  ]);
  assert.deepEqual(groups.flatMap(group => group.paths).sort(), [...paths].sort());
});
test('empty model override preserves the legacy single-host path', () => {
  assert.deepEqual(catalogHostGroups(paths, 'https://assets.example/', '  '),
    catalogHostGroups(paths, 'https://assets.example/'));
});

const bases = ['https://icons.example/v1/', 'https://models.example/v2/', 'https://recon.example/v3/'];
const mixed = [
  'items/hair/icon.webp',
  'models/body/body.glb',
  'models/reconstructed-assembly-v2/catalog.json',
  '/models/reconstructed/coat.json',
  'models/reconstructedness/decoy.glb',
  'models/reconstructed-assemblies-v1',
];
const reconstructed = ['models/reconstructed-assembly-v2/catalog.json', '/models/reconstructed/coat.json',
  'models/reconstructed-assemblies-v1'];
test('third host takes only reconstruction files and owns the reconstruction checks', () => {
  const groups = catalogHostGroups(mixed, ...bases);
  assert.deepEqual(groups, [
    { base: bases[0], paths: ['items/hair/icon.webp'], reconstruction: false },
    { base: bases[1], paths: ['models/body/body.glb', 'models/reconstructedness/decoy.glb'], reconstruction: false },
    { base: bases[2], paths: reconstructed, reconstruction: true },
  ]);
  assert.deepEqual(groups.flatMap(group => group.paths).sort(), [...mixed].sort());
});
test('hosts that normalize to the same base share one group', () => {
  assert.deepEqual(catalogHostGroups(mixed, bases[0], bases[1], ' https://models.example/v2// '),
    catalogHostGroups(mixed, bases[0], bases[1]));
  assert.deepEqual(catalogHostGroups(mixed, 'https://icons.example/v1', bases[1], ` ${bases[0]} `), [
    { base: bases[0], paths: ['items/hair/icon.webp', ...reconstructed], reconstruction: true },
    { base: bases[1], paths: ['models/body/body.glb', 'models/reconstructedness/decoy.glb'], reconstruction: false },
  ]);
  assert.deepEqual(catalogHostGroups(mixed, bases[0], undefined, bases[2]), [
    { base: bases[0], paths: ['items/hair/icon.webp', 'models/body/body.glb', 'models/reconstructedness/decoy.glb'], reconstruction: false },
    { base: bases[2], paths: reconstructed, reconstruction: true },
  ]);
});
test('blank or missing reconstruction override keeps the existing grouping', () => {
  assert.deepEqual(catalogHostGroups(mixed, bases[0], bases[1], '  '), catalogHostGroups(mixed, bases[0], bases[1]));
  assert.deepEqual(catalogHostGroups(paths, bases[0], undefined, ''), catalogHostGroups(paths, bases[0]));
  assert.deepEqual(catalogHostGroups(paths, bases[0], undefined, undefined), catalogHostGroups(paths, bases[0]));
});
test('reconstruction host is still validated when the catalog references nothing there', () => {
  assert.deepEqual(catalogHostGroups(new Set(['items/hair/icon.webp']), ...bases), [
    { base: bases[0], paths: ['items/hair/icon.webp'], reconstruction: false },
    { base: bases[1], paths: [], reconstruction: false },
    { base: bases[2], paths: [], reconstruction: true },
  ]);
  assert.deepEqual(catalogHostGroups([], ...bases).filter(group => group.reconstruction),
    [{ base: bases[2], paths: [], reconstruction: true }]);
});
test('validator hosts match the runtime URL for every path in every configuration', () => {
  const configs = [
    [' https://icons.example/v1 ', '  ', '  '],
    [' https://icons.example/v1/ ', ' https://models.example/v2/ ', ' https://recon.example/v3/ '],
    ['https://icons.example/v1'],
    ['https://icons.example/v1', 'https://models.example/v2'],
    ['https://icons.example/v1', 'https://models.example/v2', ' https://recon.example/v3 '],
    ['https://icons.example/v1/', undefined, 'https://recon.example/v3//'],
    ['https://icons.example/v1', 'https://models.example/v2/', 'https://icons.example/v1/'],
  ];
  for (const [assetsBase, modelsBase, reconstructionBase] of configs) {
    const groups = catalogHostGroups(mixed, assetsBase, modelsBase, reconstructionBase);
    assert.equal(groups.filter(group => group.reconstruction).length, 1);
    for (const { base, paths: hosted } of groups) for (const path of hosted) {
      const runtime = isModelPath(path)
        ? modelUrlFor(path, { assetsBase, modelsBase, reconstructionBase })
        : joinBase(assetsBase, path);
      assert.equal(base + path.replace(/^\/+/, ''), runtime, `${path} with ${[assetsBase, modelsBase, reconstructionBase]}`);
    }
  }
});
