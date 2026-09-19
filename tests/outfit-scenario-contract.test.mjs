// Scenario framing preflight for check-family-outfits. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflightScenarios, isSafeComponent, parseCamera } from '../scripts/shader-probe/outfit-scenario-contract.mjs';
import * as captureFamily from '../scripts/shader-probe/capture-family.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = path.join(root, 'scripts', 'shader-probe');
const reference = () => JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'outfit-scenario-framing.json'), 'utf8'));
const FRONT = '0,1.25,1.85,0,1.25,0', REAR = '0,1.25,-1.85,0,1.25,0', RIGHT = '1.7,1.2,1.9,0,1.05,0';
const step = (name, extra = {}) => ({ name, slots: { upperBody: 'shirt', feet: null }, expected: { shirt: true },
  camera: FRONT, pose: 'a', samePage: true, ...extra });
const run = steps => preflightScenarios({ steps });
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

test('the observed batch fails: rear swaps would have been shot at the front frame', () => {
  const result = preflightScenarios(reference());
  assert.equal(result.ok, false);
  assert.equal(result.frames, null);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /steps\[5\] "bare-rear" has samePage:true but requests camera "0,1.25,-1.85,0,1.25,0"/);
  assert.match(result.errors[0], /opened by steps\[0\] "shirt"/);
  // The swap never moved the camera, so the next rear step is still on the front page.
  assert.match(result.errors[1], /steps\[6\] "shirt-rear".*page has "0,1.25,1.85,0,1.25,0"/);
});

test('the corrected batch passes and records which page each screenshot was taken on', () => {
  const scenarios = reference();
  scenarios.steps[5].samePage = false;
  const result = preflightScenarios(scenarios);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.frames.map(f => f.effective.navigation), ['open', 'swap', 'swap', 'swap', 'swap', 'open', 'swap']);
  assert.deepEqual(result.frames.map(f => f.effective.camera), [FRONT, FRONT, FRONT, FRONT, FRONT, REAR, REAR]);
  assert.equal(result.frames[6].effective.frameFrom, 'steps[5] "bare-rear"');
  assert.deepEqual(result.frames[6].effective.cameraValues, [0, 1.25, -1.85, 0, 1.25, 0]);
});

test('stable same-page framing from older scenarios still passes unchanged', () => {
  const scenarios = deepFreeze({ steps: [step('shirt', { samePage: false }), step('coat'), step('bare'), step('shirt-restored')] });
  const before = JSON.stringify(scenarios);
  const result = preflightScenarios(scenarios);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(scenarios), before);
  assert.deepEqual(result.frames.map(f => f.effective.navigation), ['open', 'swap', 'swap', 'swap']);
});

test('a right-side camera or a pose change on the same page is rejected; a new page allows both', () => {
  const right = run([step('front'), step('right', { camera: RIGHT })]);
  assert.equal(right.ok, false);
  assert.match(right.errors[0], /"right" has samePage:true but requests camera "1\.7,1\.2,1\.9,0,1\.05,0"/);
  const idle = run([step('a-pose'), step('idle', { pose: 'idle' })]);
  assert.equal(idle.ok, false);
  assert.match(idle.errors[0], /requests pose "idle" \(page has "a"\)/);
  const both = run([step('a-pose'), step('both', { pose: 'idle', camera: REAR })]);
  assert.match(both.errors[0], /camera .* and pose "idle"/);
  for (const samePage of [false, undefined]) {
    const opened = run([step('front'), step('right', { camera: RIGHT, pose: 'idle', samePage })]);
    assert.equal(opened.ok, true, String(samePage));
    assert.deepEqual(opened.frames[1].effective, { navigation: 'open', camera: RIGHT,
      cameraValues: [1.7, 1.2, 1.9, 0, 1.05, 0], pose: 'idle', frameFrom: 'steps[1] "right"' });
  }
});

test('canonical numeric equivalence is accepted, but no tolerance is guessed', () => {
  const same = run([step('front'), step('spelled', { camera: ' 0.0 , 1.250,1.85e0, -0, +1.25 ,0 ' })]);
  assert.deepEqual(same.errors, []);
  assert.equal(same.frames[1].effective.camera, FRONT);
  assert.equal(same.frames[1].requested.camera, ' 0.0 , 1.250,1.85e0, -0, +1.25 ,0 ');
  const near = run([step('front'), step('near', { camera: '0,1.2500001,1.85,0,1.25,0' })]);
  assert.equal(near.ok, false);
});

test('omitted pose means a and omitted samePage opens a page', () => {
  const { pose, samePage, ...bare } = step('bare');
  const result = run([bare, step('explicit-a'), { ...step('omitted-pose'), pose: undefined }]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.frames[0].requested, { camera: FRONT, pose: null, samePage: null });
  assert.equal(result.frames[0].effective.navigation, 'open');
  assert.equal(result.frames[0].effective.pose, 'a');
  assert.equal(result.frames[2].effective.navigation, 'swap');
  const idleThenOmitted = run([step('idle', { pose: 'idle' }), { ...step('omitted'), pose: undefined }]);
  assert.match(idleThenOmitted.errors[0], /pose "a" \(page has "idle"\)/);
});

test('the first step always opens a page, even when it asks for samePage', () => {
  const result = run([step('first', { camera: REAR, pose: 'idle', samePage: true }), step('second', { camera: REAR, pose: 'idle' })]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.frames[0].effective.navigation, 'open');
  assert.equal(result.frames[0].note, 'The first step always opens a page.');
  assert.equal(result.frames[1].effective.navigation, 'swap');
});

test('the whole sequence is checked, so a late bad entry fails before anything runs', () => {
  const steps = Array.from({ length: 30 }, (_, i) => step(`step-${i}`, { samePage: i > 0 }));
  steps.push(step('late-rear', { camera: REAR }), step('late-camera', { camera: '0,1,2' }));
  const result = run(steps);
  assert.equal(result.ok, false);
  assert.equal(result.frames, null);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /^steps\[30\] "late-rear"/);
  assert.match(result.errors[1], /^steps\[31\] "late-camera"\.camera/);
});

test('malformed cameras are rejected without throwing', () => {
  const cameras = [undefined, null, 5, ['0', '1', '2', '0', '1', '0'], '', '0,1,2,0,1', '0,1,2,0,1,0,0', '0,,2,0,1,0',
    '0,1,2,0,1,', ' ,1,2,0,1,0', 'NaN,1,2,0,1,0', '0,Infinity,2,0,1,0', '0,1,-Infinity,0,1,0', '1e999,1,2,0,1,0', '0;1;2;0;1;0', 'a,b,c,d,e,f'];
  for (const camera of cameras) {
    const result = run([step('only', { camera })]);
    assert.equal(result.ok, false, JSON.stringify(camera));
    assert.match(result.errors[0], /camera must be six finite numbers/);
  }
  // A malformed camera on the page that is kept is reported once, not compared further.
  const kept = run([step('opened', { camera: 'x' }), step('swapped', { camera: REAR })]);
  assert.equal(kept.errors.length, 1);
});

test('names must be safe and unique, including case-only duplicates', () => {
  assert.match(run([step('shirt'), step('shirt')]).errors[0], /steps\[1\] "shirt" reuses the screenshot name of steps\[0\] "shirt"/);
  assert.equal(run([step('Bare-Rear'), step('bare-rear')]).ok, false);
  for (const name of [undefined, '', '../shot', 'a/b', 'a\\b', 'con', 'shot.', 'with space', 7]) {
    assert.match(run([step('ok'), step(name)]).errors[0], /steps\[1\]\.name must be a safe file name component/, String(name));
  }
});

test('malformed documents and fields fail closed without incidental type errors', () => {
  for (const scenarios of [undefined, null, 'steps', [], {}, { steps: {} }, { steps: [] }, { steps: 'x' }]) {
    const result = preflightScenarios(scenarios);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
  }
  const cases = [
    [[null], /steps\[0\] must be an object/], [[[]], /steps\[0\] must be an object/],
    [[step('s', { slots: null })], /slots must be an object/], [[step('s', { slots: ['shirt'] })], /slots must be an object/],
    [[step('s', { slots: { feet: 3 } })], /slots\.feet must be an item id or null/],
    [[step('s', { expected: undefined })], /expected must be an object/], [[step('s', { expected: { shirt: 'yes' } })], /must be true or false/],
    [[step('s', { pose: 'A' })], /pose must be 'a' or 'idle'/], [[step('s', { pose: null })], /pose must be 'a' or 'idle'/],
    [[step('s'), step('t', { samePage: 'false' })], /samePage must be true, false or omitted/],
    [[step('s'), step('t', { samePage: 1 })], /samePage must be true, false or omitted/],
    [[step('s', { camera: 1n })], /camera must be six finite numbers/],
  ];
  for (const [steps, pattern] of cases) {
    const result = run(steps);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => pattern.test(e)), `${pattern}: ${result.errors}`);
  }
  // A step whose frame is unknown cannot vouch for the next same-page step, but also cannot crash it.
  assert.equal(run([null, step('after')]).errors.length, 1);
});

test('name and camera parsing match capture-family.mjs', () => {
  const names = ['shot', 'Shot-1.v2', '', '.', '..', 'a/b', 'a\\b', 'x.', 'nul', 'COM1.png', 'lpt9', 'a b', 'é', null, 3];
  for (const name of names) assert.equal(isSafeComponent(name), captureFamily.isSafeComponent(name), String(name));
  const cameras = [FRONT, ' 1 ,2,3,4,5,6', '1,2,3,4,5', '1,,3,4,5,6', 'NaN,2,3,4,5,6', '0x10,2,3,4,5,6', '1e999,2,3,4,5,6', null, 7];
  for (const camera of cameras) assert.deepEqual(parseCamera(camera), captureFamily.parseCamera(camera), String(camera));
});

// The checker imports playwright-core and multipart modules that are not in this workspace, so it runs
// here against stubs in a throwaway folder. The stubbed launch leaves a marker and stops the run.
test('check-family-outfits rejects a bad scenario before launching a browser or creating evidence', () => {
  const tmp = fs.mkdtempSync(path.join(root, 'tests', '.tmp-checker-'));
  try {
    const at = (...parts) => path.join(tmp, ...parts);
    const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    for (const file of ['check-family-outfits.mjs', 'outfit-scenario-contract.mjs', 'family-fitting-evidence.mjs',
      'coverage-preview-harness.mjs', 'capture-family.mjs']) {
      write(at('scripts', 'shader-probe', file), fs.readFileSync(path.join(probe, file)));
    }
    write(at('scripts', 'shader-probe', 'freeze-multipart-family.mjs'), 'export const validateManifest=()=>{};\n');
    write(at('scripts', 'shader-probe', 'multipart-review-contract.mjs'),
      'export const expectedComponents=()=>[],checkComponentBindings=()=>[],checkComponentMeshes=()=>[];\n');
    write(at('node_modules', 'playwright-core', 'package.json'), '{"name":"playwright-core","type":"module","main":"index.js"}\n');
    write(at('node_modules', 'playwright-core', 'index.js'), "import fs from 'node:fs';\n"
      + "export const chromium={async launch(){fs.writeFileSync(process.env.LAUNCH_MARKER,'launched');throw new Error('stub launch');}};\n");
    write(at('resolver.mjs'), 'export const resolveSourceOutfit=()=>({fittingTags:[],slotConflicts:[]});\n');
    write(at('docs', 'cohort.json'), '{"items":[]}\n');
    for (const file of ['assets.json', 'skin-pairs.json', 'supported-items.json']) write(at('preview', file), '{"items":[]}\n');
    write(at('manifest.json'), JSON.stringify({ id: 'stub', schemaVersion: 1, paths: { appUrl: 'http://127.0.0.1:9',
      resolver: at('resolver.mjs'), docs: at('docs'), preview: at('preview'), active: at('preview'), sourceIndex: at('source') } }));
    const check = (scenarios, name) => {
      write(at(`${name}.json`), JSON.stringify(scenarios));
      const env = { ...process.env, LAUNCH_MARKER: at(`${name}.launched`) };
      const result = spawnSync(process.execPath, [at('scripts', 'shader-probe', 'check-family-outfits.mjs'),
        at('manifest.json'), at(`${name}.json`), at(`${name}-evidence`), 'preview'], { cwd: tmp, env, encoding: 'utf8' });
      return { ...result, launched: fs.existsSync(env.LAUNCH_MARKER), evidence: fs.existsSync(at(`${name}-evidence`)) };
    };
    const bad = check(reference(), 'bad');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Invalid scenarios[\s\S]*"bare-rear" has samePage:true/);
    assert.equal(bad.launched, false);
    assert.equal(bad.evidence, false);
    const fixed = reference();
    fixed.steps[5].samePage = false;
    const good = check(fixed, 'good');
    assert.match(good.stderr, /stub launch/);
    assert.equal(good.launched, true);
    assert.equal(good.evidence, true);
    // Existing evidence is still never reused.
    const again = check(fixed, 'good');
    assert.match(again.stderr, /Preserve existing evidence/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
