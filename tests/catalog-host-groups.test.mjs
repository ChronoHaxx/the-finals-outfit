import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogHostGroups } from '../scripts/lib/catalog-host-groups.mjs';

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
