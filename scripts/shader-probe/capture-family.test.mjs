// Unit tests for capture-family.mjs. These run with Node alone (no browser, no playwright-core):
// the CLI path lazily imports playwright, and importing this module must not launch anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ANGLE_NAMES,
  FRONT_ANGLE,
  assertFreshOutput,
  buildSlots,
  canonicalJson,
  configHash,
  defaultAngles,
  isSafeComponent,
  parseArgs,
  parseCamera,
  resolveUnder,
  validateConfig,
  validateItemState,
  validateOptions,
  viewUrl,
} from './capture-family.mjs';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function validConfig() {
  return {
    items: [{ id: 'jacket-a', slot: 'upperBody', meshes: ['mesh/body', 'mesh/trim'], materials: ['mat/body', 'mat/trim'] }],
    baseOutfit: { upperBody: 'casual-basictshirt-cotton-alfaacta', face: 'head-face-01-base' },
    camera: '0,1.05,2.5,0,1.05,0',
    path: '/thesecret-dev-mode-ganyu-only/',
  };
}

function reconstructedEntry(overrides = {}) {
  return {
    id: 'jacket-a',
    sourceAssembly: true,
    sourceSkinPair: false,
    groupVisible: true,
    visibleMeshes: 2,
    hiddenMeshes: 0,
    parts: [
      { sourceIndex: 0, sourceMesh: 'mesh/body', materials: [{ name: 'm0', sourceMaterial: 'mat/body', reconstructed: true, visible: true }] },
      { sourceIndex: 1, sourceMesh: 'mesh/trim', materials: [{ name: 'm1', sourceMaterial: 'mat/trim', reconstructed: true, visible: true }] },
    ],
    ...overrides,
  };
}

const state = (assemblies = [], other = []) => ({ assemblies, other });
const item = () => ({ id: 'jacket-a', slot: 'upperBody', meshes: ['mesh/body', 'mesh/trim'], materials: ['mat/body', 'mat/trim'] });

// ---------------------------------------------------------------------------------------------
// Argument parsing and option validation
// ---------------------------------------------------------------------------------------------

test('parseArgs reads all four options', () => {
  const parsed = parseArgs(['--config', 'c.json', '--output', 'out', '--mode', 'preview', '--preview', 'pv']);
  assert.deepEqual(parsed, { config: 'c.json', output: 'out', mode: 'preview', preview: 'pv' });
});

test('parseArgs rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('parseArgs rejects a missing option value', () => {
  assert.throws(() => parseArgs(['--config', '--output', 'out']), /missing value for --config/);
});

test('validateOptions rejects a malformed mode', () => {
  const options = { config: 'c.json', output: 'out', mode: 'Preview', preview: null };
  assert.throws(() => validateOptions(options), /malformed mode/);
});

test('validateOptions requires --preview only in preview mode', () => {
  assert.throws(
    () => validateOptions({ config: 'c.json', output: 'out', mode: 'preview', preview: null }),
    /--preview <folder> is required in preview mode/,
  );
  assert.doesNotThrow(() => validateOptions({ config: 'c.json', output: 'out', mode: 'before', preview: null }));
  assert.doesNotThrow(() => validateOptions({ config: 'c.json', output: 'out', mode: 'active', preview: null }));
});

// ---------------------------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------------------------

test('validateConfig accepts a valid config and fills the eight default angles', () => {
  const config = validateConfig(validConfig());
  assert.equal(config.pose, 'a');
  assert.deepEqual(config.angles.map(angle => angle.name), [...DEFAULT_ANGLE_NAMES]);
  assert.deepEqual(config.angles.map(angle => angle.radians), [0, 1, 2, 3, 4, 5, 6, 7].map(n => (n * Math.PI) / 4));
  assert.equal(config.angles.length, 8);
  // Catalog data is passed through untouched.
  assert.equal(config.baseOutfit.upperBody, 'casual-basictshirt-cotton-alfaacta');
  assert.deepEqual(config.items[0].meshes, ['mesh/body', 'mesh/trim']);
});

test('validateConfig rejects duplicate item ids', () => {
  const raw = validConfig();
  raw.items.push({ ...raw.items[0] });
  assert.throws(() => validateConfig(raw), /duplicate item id/);
});

test('validateConfig rejects a path-traversal item id', () => {
  const raw = validConfig();
  raw.items[0].id = '../evil';
  assert.throws(() => validateConfig(raw), /safe name without path separators or traversal/);
});

test('validateConfig rejects an unsafe or duplicate angle name', () => {
  const unsafe = validConfig();
  unsafe.angles = [{ name: '../secret', radians: 0 }];
  assert.throws(() => validateConfig(unsafe), /angles\[0\]\.name must be a nonempty safe name/);

  const duplicate = validConfig();
  duplicate.angles = [{ name: 'front', radians: 0 }, { name: 'front', radians: 1 }];
  assert.throws(() => validateConfig(duplicate), /duplicate angle name/);
});

test('validateConfig rejects non-finite angle radians', () => {
  const raw = validConfig();
  raw.angles = [{ name: 'front', radians: Number.POSITIVE_INFINITY }];
  assert.throws(() => validateConfig(raw), /radians must be a finite number/);
  raw.angles = [{ name: 'front', radians: '0' }];
  assert.throws(() => validateConfig(raw), /radians must be a finite number/);
});

test('validateConfig rejects a malformed camera', () => {
  for (const camera of ['0,1.05,2.5,0,1.05', '0,1.05,2.5,0,1.05,', '0,1.05,2.5,0,1.05,NaN', 'x,1,2,3,4,5']) {
    const raw = validConfig();
    raw.camera = camera;
    assert.throws(() => validateConfig(raw), /camera must be exactly six finite numbers/, camera);
  }
});

test('validateConfig rejects duplicate or empty meshes and materials', () => {
  const duplicateMesh = validConfig();
  duplicateMesh.items[0].meshes = ['mesh/body', 'mesh/body'];
  assert.throws(() => validateConfig(duplicateMesh), /duplicate source mesh/);

  const emptyMaterial = validConfig();
  emptyMaterial.items[0].materials = [];
  assert.throws(() => validateConfig(emptyMaterial), /materials must be a nonempty array/);

  const duplicateMaterial = validConfig();
  duplicateMaterial.items[0].materials = ['mat/body', 'mat/body'];
  assert.throws(() => validateConfig(duplicateMaterial), /duplicate source material/);
});

test('an item can fill a slot that is absent from the base outfit', () => {
  const raw = validConfig();
  raw.baseOutfit = { face: 'head-face-01-base' };
  const config = validateConfig(raw);
  assert.deepEqual(buildSlots(config.baseOutfit, config.items[0]), {
    face: 'head-face-01-base', upperBody: 'jacket-a',
  });
});

test('validateConfig rejects an invalid pose and a bad path', () => {
  const badPose = validConfig();
  badPose.pose = 'run';
  assert.throws(() => validateConfig(badPose), /pose must be 'a' or 'idle'/);

  const relative = validConfig();
  relative.path = 'thesecret-dev-mode-ganyu-only/';
  assert.throws(() => validateConfig(relative), /path must be an absolute URL path/);

  const traversal = validConfig();
  traversal.path = '/a/../b/';
  assert.throws(() => validateConfig(traversal), /path must not contain '\.\.'/);
});

test('defaultAngles is eight evenly spaced yaw angles starting at front', () => {
  const angles = defaultAngles();
  assert.equal(angles.length, 8);
  assert.deepEqual(angles[0], { name: 'front', radians: 0 });
  assert.deepEqual(angles[2], { name: 'right', radians: Math.PI / 2 });
  assert.deepEqual(angles[4], { name: 'back', radians: Math.PI });
  assert.equal(FRONT_ANGLE.radians, 0);
});

// ---------------------------------------------------------------------------------------------
// Exact assembly validation
// ---------------------------------------------------------------------------------------------

test('a legitimate multi-part exact set passes preview validation', () => {
  const result = validateItemState(state([reconstructedEntry()]), item(), 'preview');
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.actual.meshes, ['mesh/body', 'mesh/trim']);
  assert.deepEqual(result.actual.materials, ['mat/body', 'mat/trim']);
});

test('an absent target (or only an unrelated visible item) fails', () => {
  const absent = validateItemState(state([reconstructedEntry()]), { ...item(), id: 'coat-b' }, 'active');
  assert.equal(absent.ok, false);
  assert.match(absent.errors.join('; '), /coat-b.*not present/);

  const unrelated = validateItemState(state([{ ...reconstructedEntry(), id: 'coat-b' }]), item(), 'active');
  assert.equal(unrelated.ok, false);
  assert.match(unrelated.errors.join('; '), /not present/);
});

test('a hidden ancestor fails even when the mesh flags say visible', () => {
  const result = validateItemState(state([reconstructedEntry({ groupVisible: false })]), item(), 'preview');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /hidden by a hidden ancestor/);
});

test('a target with no visible meshes fails', () => {
  const result = validateItemState(state([reconstructedEntry({ visibleMeshes: 0 })]), item(), 'preview');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /no visible meshes/);
});

test('missing, extra or wrong materials fail', () => {
  const missing = reconstructedEntry();
  missing.parts[0].materials = [];
  assert.match(validateItemState(state([missing]), item(), 'preview').errors.join('; '), /missing source materials: mat\/body/);

  const extra = reconstructedEntry();
  extra.parts.push({ sourceIndex: 2, sourceMesh: 'mesh/body', materials: [{ name: 'x', sourceMaterial: 'mat/extra', reconstructed: true, visible: true }] });
  const extraResult = validateItemState(state([extra]), item(), 'preview');
  assert.equal(extraResult.ok, false);
  assert.match(extraResult.errors.join('; '), /unexpected source materials: mat\/extra/);

  const wrong = reconstructedEntry();
  wrong.parts[1].materials = [{ name: 'm1', sourceMaterial: 'mat/wrong', reconstructed: true, visible: true }];
  const wrongResult = validateItemState(state([wrong]), item(), 'preview');
  assert.equal(wrongResult.ok, false);
  assert.match(wrongResult.errors.join('; '), /missing source materials: mat\/trim/);
  assert.match(wrongResult.errors.join('; '), /unexpected source materials: mat\/wrong/);
});

test('missing or unexpected source meshes fail', () => {
  const missing = reconstructedEntry();
  missing.parts = [missing.parts[0]];
  const missingResult = validateItemState(state([missing]), item(), 'preview');
  assert.match(missingResult.errors.join('; '), /missing source meshes: mesh\/trim/);

  const extra = reconstructedEntry();
  extra.parts.push({ sourceIndex: 2, sourceMesh: 'mesh/extra', materials: [{ name: 'm2', sourceMaterial: 'mat/trim', reconstructed: true, visible: true }] });
  assert.match(validateItemState(state([extra]), item(), 'preview').errors.join('; '), /unexpected source meshes: mesh\/extra/);
});

test('an unreconstructed material fails', () => {
  const entry = reconstructedEntry();
  entry.parts[1].materials[0].reconstructed = false;
  const result = validateItemState(state([entry]), item(), 'preview');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /materials not reconstructed: mat\/trim/);
});

test('unidentified additional bindings cannot disappear from the exact-set check', () => {
  const unknownMaterial = reconstructedEntry();
  unknownMaterial.parts[0].materials.push({ name: 'unbound', reconstructed: true, visible: true });
  assert.equal(validateItemState(state([unknownMaterial]), item(), 'active').ok, false);

  const unknownMesh = reconstructedEntry();
  unknownMesh.parts.push({ sourceIndex: 2, materials: [
    { sourceMaterial: 'mat/body', reconstructed: true, visible: true },
  ] });
  assert.equal(validateItemState(state([unknownMesh]), item(), 'active').ok, false);

  const emptyPart = reconstructedEntry();
  emptyPart.parts.push({ sourceIndex: 2, sourceMesh: 'mesh/body', materials: [] });
  assert.equal(validateItemState(state([emptyPart]), item(), 'active').ok, false);
});

test('a hidden source part fails even when a different part remains visible', () => {
  const entry = reconstructedEntry({ visibleMeshes: 1, hiddenMeshes: 1 });
  entry.parts[1].materials[0].visible = false;
  assert.equal(validateItemState(state([entry]), item(), 'preview').ok, false);
});

test('preview/active reject a legacy item that never became a sourceAssembly', () => {
  const legacy = reconstructedEntry({ sourceAssembly: false, sourceSkinPair: true });
  const result = validateItemState(state([legacy]), item(), 'active');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /not a reconstructed sourceAssembly/);
});

test('before mode accepts a visible legacy item with a sourceSkinPair', () => {
  const legacy = reconstructedEntry({ sourceAssembly: false, sourceSkinPair: true });
  const result = validateItemState(state([legacy]), item(), 'before');
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('before mode accepts a visible legacy item classed as other', () => {
  const result = validateItemState(state([], [{ id: 'jacket-a', visibleMeshes: 3, groupVisible: true }]), item(), 'before');
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('before mode rejects an already reconstructed sourceAssembly', () => {
  const result = validateItemState(state([reconstructedEntry()]), item(), 'before');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /already a reconstructed sourceAssembly in before mode/);
});

test('before mode fails for an absent or hidden target', () => {
  const absent = validateItemState(state([], []), item(), 'before');
  assert.equal(absent.ok, false);
  assert.match(absent.errors.join('; '), /not present/);

  const hidden = validateItemState(state([], [{ id: 'jacket-a', visibleMeshes: 2, groupVisible: false }]), item(), 'before');
  assert.equal(hidden.ok, false);
  assert.match(hidden.errors.join('; '), /hidden by a hidden ancestor/);
});

// ---------------------------------------------------------------------------------------------
// Path, hashing and URL helpers
// ---------------------------------------------------------------------------------------------

test('isSafeComponent rejects separators, traversal and empty names', () => {
  for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b']) {
    assert.equal(isSafeComponent(name), false, JSON.stringify(name));
  }
  assert.equal(isSafeComponent('front-right_01.png'), true);
});

test('output components avoid reserved Windows names and normalized collisions', () => {
  for (const name of ['NUL', 'con.txt', 'COM1', 'Lpt9.webp', 'jacket.']) {
    assert.equal(isSafeComponent(name), false, name);
  }
  const duplicateItem = validConfig();
  duplicateItem.items.push({ ...duplicateItem.items[0], id: 'JACKET-A' });
  assert.throws(() => validateConfig(duplicateItem), /duplicate item id/);
  const duplicateAngle = validConfig();
  duplicateAngle.angles = [{ name: 'front', radians: 0 }, { name: 'Front', radians: 1 }];
  assert.throws(() => validateConfig(duplicateAngle), /duplicate angle name/);
});

test('resolveUnder keeps every view under the output directory', () => {
  const root = path.resolve('/tmp/capture-root');
  assert.equal(resolveUnder(root, 'views', 'jacket-a', '00-front.png'), path.join(root, 'views', 'jacket-a', '00-front.png'));
  assert.throws(() => resolveUnder(root, 'views', '..', '00-front.png'), /unsafe path component/);
  assert.throws(() => resolveUnder(root, 'views', 'a/b.png'), /unsafe path component/);
});

test('assertFreshOutput accepts a missing or empty directory and rejects a reused one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-family-'));
  try {
    const missing = path.join(dir, 'new-output');
    assert.equal(assertFreshOutput(missing), missing);

    const empty = path.join(dir, 'empty');
    fs.mkdirSync(empty);
    assert.equal(assertFreshOutput(empty), empty);

    fs.writeFileSync(path.join(empty, 'stale.txt'), 'x');
    assert.throws(() => assertFreshOutput(empty), /not empty/);

    fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
    assert.throws(() => assertFreshOutput(path.join(dir, 'file.txt')), /not a directory/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configHash is stable across key order and changes with config content', () => {
  const a = validConfig();
  const b = { path: a.path, camera: a.camera, baseOutfit: a.baseOutfit, items: a.items };
  assert.equal(configHash(validateConfig(a)), configHash(validateConfig(b)));

  const changed = validConfig();
  changed.items[0].meshes = ['mesh/other'];
  assert.notEqual(configHash(validateConfig(a)), configHash(validateConfig(changed)));
  assert.equal(canonicalJson({ b: 1, a: [2, undefined] }), '{"a":[2,null],"b":1}');
});

test('viewUrl keeps the harness outfit query but moves it onto the configured path', () => {
  const config = validateConfig(validConfig());
  const url = new URL(viewUrl(config, { ...config.baseOutfit, upperBody: 'jacket-a' }));
  assert.equal(url.pathname, '/thesecret-dev-mode-ganyu-only/');
  assert.equal(url.searchParams.get('cam'), '0,1.05,2.5,0,1.05,0');
  assert.equal(url.searchParams.get('pose'), 'a');
  assert.equal(url.searchParams.get('reconstructed'), '1');
  assert.ok(url.searchParams.get('outfit'));
  assert.equal(parseCamera(config.camera).length, 6);
});
