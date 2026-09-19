// Behaviour of the preview fitting decoder and weight ownership, on Three-like mesh stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
// Override only when reviewing a separate product worktree.
const {fittingMorphNames, SourceFitting} = await import(process.env.SOURCE_FITTING_MODULE ?? new URL('../../src/rig/SourceFitting.ts', import.meta.url).href);
import {FITTING_TAG, fittingMorphNames as evidenceMorphNames} from './family-fitting-evidence.mjs';

const BANDOLIER = 'bandolier_squeeze';
const BANDOLIER_TAG = 'Customization.Shape.PushJacket.bandolier_squeeze';

// Tags each decoder must accept, with the exact morph leaf they name.
const ACCEPTED = [
  [BANDOLIER_TAG, BANDOLIER],
  ['Customization.Shape.PushInsideClothes.Boots_M', 'Boots_M'],
  ['Customization.Shape.ShrinkWrap.shrink_pants_in_tallboots', 'shrink_pants_in_tallboots'],
  ['Customization.Shape.HeadNeckMatch.Neck01', 'Neck01'],
];
// Everything else stays undecoded: other PushJacket leaves, case variants, bare groups,
// unrelated shape groups and malformed suffixes.
const REJECTED = [
  'Customization.Shape.PushJacket.shrink_under_vest',
  'Customization.Shape.PushJacket.bandolier',
  'Customization.Shape.PushJacket.bandolier_squeeze2',
  'Customization.Shape.PushJacket.bandolier_squeeze_extra',
  'Customization.Shape.PushJacket.Bandolier_Squeeze',
  'Customization.Shape.PushJacket.BANDOLIER_SQUEEZE',
  'Customization.Shape.pushjacket.bandolier_squeeze',
  'customization.shape.PushJacket.bandolier_squeeze',
  'Customization.Shape.PushJacket',
  'Customization.Shape.PushJacket.',
  'Customization.Shape.PushJacket..bandolier_squeeze',
  'Customization.Shape.PushJacket.bandolier_squeeze.',
  'Customization.Shape.PushJacket.bandolier_squeeze.extra',
  'Customization.Shape.PushJacket.bandolier_squeeze ',
  'Customization.Shape.PushJacket.bandolier_squeeze\n',
  ' Customization.Shape.PushJacket.bandolier_squeeze',
  'Customization.Shape.PushJacket.bandolier-squeeze',
  'Customization.Shape.PushJacketX.bandolier_squeeze',
  'Customization.Shape.PushJackets.bandolier_squeeze',
  'Customization.Shape.PushJacket.PushJacket.bandolier_squeeze',
  'Customization.Shape.ShrinkWrap.PushJacket.bandolier_squeeze',
  'Customization.Shape.Push.bandolier_squeeze',
  'Customization.Shape.bandolier_squeeze',
  'Customization.Shape.OtherGroup.bandolier_squeeze',
  'bandolier_squeeze',
  'Customization.Shape.ShrinkWrap',
  'Customization.Shape.ShrinkWrap.',
  'Customization.Shape.shrinkwrap.Boots_M',
  'Customization.Shape.ShrinkWrap.Boots_M.extra',
  'Customization.Shape.HeadNeckMatch.neck-01',
  '',
];

test('decodes the exact bandolier tag and the three existing groups, nothing else', () => {
  for (const [tag, leaf] of ACCEPTED) assert.deepEqual([...fittingMorphNames([tag])], [leaf], tag);
  for (const tag of REJECTED) assert.deepEqual([...fittingMorphNames([tag])], [], JSON.stringify(tag));
  assert.deepEqual([...fittingMorphNames([...REJECTED, BANDOLIER_TAG, BANDOLIER_TAG])], [BANDOLIER]);
});

test('the evidence decoder and its public FITTING_TAG agree with the runtime decoder', () => {
  for (const tag of [...ACCEPTED.map(([tag]) => tag), ...REJECTED]) {
    const runtime = [...fittingMorphNames([tag])];
    assert.deepEqual([...evidenceMorphNames([tag])], runtime, JSON.stringify(tag));
    assert.deepEqual(FITTING_TAG.exec(tag)?.[1] ?? null, runtime[0] ?? null, JSON.stringify(tag));
  }
});

// --- weight ownership ----------------------------------------------------------
const stub = (dictionary, weights) => ({morphTargetDictionary: dictionary, morphTargetInfluences: weights, userData: {}});
const torso = (bandolier = 0.25, body = 0.6) =>
  stub({medium_male: 0, [BANDOLIER]: 1, medium_female: 2}, [body, bandolier, 0]);
const on = fittingMorphNames([BANDOLIER_TAG]), off = fittingMorphNames([]);

test('A/B/A: bandolier drives to 1, then restores its nonzero original without touching other morphs', () => {
  const fitting = new SourceFitting(), mesh = torso();
  fitting.apply(mesh, off);
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[0.6, 0.25, 0], []]);
  fitting.apply(mesh, on);
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[0.6, 1, 0], [BANDOLIER]]);
  fitting.apply(mesh, on); // re-applying while active keeps the first observed original
  mesh.morphTargetInfluences[0] = 0.8; // a body-type change while fitted is not ours to undo
  fitting.apply(mesh, off);
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[0.8, 0.25, 0], []]);
  fitting.apply(mesh, on);
  fitting.apply(mesh, off);
  assert.deepEqual(mesh.morphTargetInfluences, [0.8, 0.25, 0]);
});

test('removing only the bandolier restores it while a co-active fitting morph stays driven', () => {
  const fitting = new SourceFitting();
  const mesh = stub({Boots_M: 0, [BANDOLIER]: 1, medium_male: 2}, [0.1, 0.4, 0.7]);
  const both = fittingMorphNames(['Customization.Shape.PushInsideClothes.Boots_M', BANDOLIER_TAG]);
  fitting.apply(mesh, both);
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[1, 1, 0.7], ['Boots_M', BANDOLIER]]);
  fitting.apply(mesh, fittingMorphNames(['Customization.Shape.PushInsideClothes.Boots_M']));
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[1, 0.4, 0.7], ['Boots_M']]);
  fitting.apply(mesh, off);
  assert.deepEqual(mesh.morphTargetInfluences, [0.1, 0.4, 0.7]);
});

test('meshes without a drivable bandolier morph stay untouched', () => {
  const fitting = new SourceFitting();
  const absent = stub({medium_male: 0, medium_female: 1}, [0.6, 0.3]);
  const outOfRange = stub({[BANDOLIER]: 5, medium_male: 0}, [0.6]);
  const bare = {userData: {}};
  const receiver = torso(0);
  for (const mesh of [absent, outOfRange, bare, receiver]) fitting.apply(mesh, on);
  assert.deepEqual([absent.morphTargetInfluences, absent.userData.sourceFittingMorphs], [[0.6, 0.3], []]);
  assert.deepEqual([outOfRange.morphTargetInfluences, outOfRange.userData.sourceFittingMorphs], [[0.6], []]);
  assert.deepEqual(bare, {userData: {}});
  assert.deepEqual(receiver.morphTargetInfluences, [0.6, 1, 0]);
  for (const mesh of [absent, outOfRange, receiver]) fitting.apply(mesh, off);
  assert.deepEqual([absent.morphTargetInfluences, outOfRange.morphTargetInfluences, receiver.morphTargetInfluences],
    [[0.6, 0.3], [0.6], [0.6, 0, 0]]);
});

test('an unsupported PushJacket leaf never drives the morph it names', () => {
  const fitting = new SourceFitting();
  const mesh = stub({shrink_under_vest: 0, [BANDOLIER]: 1}, [0.2, 0.3]);
  fitting.apply(mesh, fittingMorphNames(['Customization.Shape.PushJacket.shrink_under_vest',
    'Customization.Shape.PushJacket', 'Customization.Shape.PushJacket.Bandolier_Squeeze']));
  assert.deepEqual([mesh.morphTargetInfluences, mesh.userData.sourceFittingMorphs], [[0.2, 0.3], []]);
});
