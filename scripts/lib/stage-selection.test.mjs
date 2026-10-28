import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGES_FREE, preflightPackage, selectStagePaths, stageMode } from './stage-selection.mjs';

const sets = {
  catalog: new Set(['items/hair/icon.webp', 'models/body/body.glb', 'models/reconstructed/coat.json',
    'models/reconstructedness/decoy.glb']),
  companions: new Set(['models/body/body.bodymask.png', 'models/reconstructed-meshes-v2/x.coverage.webp']),
  reconstruction: new Set(['models/reconstructed-assembly-v2/catalog.json', 'models/reconstructed/coat.json',
    'models/body/body.bodymask.png', 'models/masks/arm.bodymask.png']),
};
const sorted = set => [...set].sort();

test('mode flags are exclusive and unknown flags are refused', () => {
  assert.equal(stageMode(['v3']), 'all');
  assert.equal(stageMode(['v3', '--models-only']), 'models');
  assert.equal(stageMode(['v3', '--reconstruction-only']), 'reconstruction');
  assert.equal(stageMode(['v3', '--icons-only']), 'icons');
  assert.throws(() => stageMode(['v3', '--icons-only', '--models-only']), /mutually exclusive/);
  assert.throws(() => stageMode(['v3', '--models-only', '--reconstruction-only']), /mutually exclusive/);
  assert.throws(() => stageMode(['v3', '--reconstructions-only']), /Unknown option/);
});

test('all and models packages keep their existing selection', () => {
  const all = ['items/hair/icon.webp', 'models/body/body.bodymask.png', 'models/body/body.glb',
    'models/masks/arm.bodymask.png', 'models/reconstructed-assembly-v2/catalog.json',
    'models/reconstructed-meshes-v2/x.coverage.webp', 'models/reconstructed/coat.json',
    'models/reconstructedness/decoy.glb'];
  assert.deepEqual(sorted(selectStagePaths('all', sets)), all);
  assert.deepEqual(sorted(selectStagePaths('models', sets)), all.slice(1));
});

test('reconstruction package excludes icons and legacy models but keeps its relative dependencies', () => {
  assert.deepEqual(sorted(selectStagePaths('reconstruction', sets)), [
    'models/body/body.bodymask.png', 'models/masks/arm.bodymask.png',
    'models/reconstructed-assembly-v2/catalog.json', 'models/reconstructed-meshes-v2/x.coverage.webp',
    'models/reconstructed/coat.json',
  ]);
});

test('icons package is the catalog and companion paths outside models/', () => {
  assert.deepEqual(sorted(selectStagePaths('icons', sets)), ['items/hair/icon.webp']);
});

test('file limit counts the reserved generated files', () => {
  assert.deepEqual(PAGES_FREE, { maxFiles: 20000, reservedFiles: 3, maxFileBytes: 25 * 1024 * 1024 });
  const paths = n => Array.from({ length: n }, (_, i) => `models/reconstructed/${i}.bin`);
  assert.doesNotThrow(() => preflightPackage('reconstruction', paths(19997), () => 1));
  assert.throws(() => preflightPackage('reconstruction', paths(19998), () => 1),
    /19998 files \+ 3 reserved = 20001 exceeds 20000[\s\S]*Split the referenced asset graph[\s\S]*do not drop items/);
});

test('any file over 25 MiB fails before staging', () => {
  const limit = PAGES_FREE.maxFileBytes;
  assert.doesNotThrow(() => preflightPackage('all', ['a.bin'], () => limit));
  assert.throws(() => preflightPackage('models', ['a.bin', 'b.bin'], path => path === 'b.bin' ? limit + 1 : 1),
    /'models' package[\s\S]*b\.bin \(25\.0 MiB\)[\s\S]*smaller encoding/);
});
