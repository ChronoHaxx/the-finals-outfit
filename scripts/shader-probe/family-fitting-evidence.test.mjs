// Behaviour of the shared fitting evidence, on synthetic Three-like snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFittingSnapshot, checkFittingEvidence, fittingMorphNames, implementedMorphs,
  FittingBaselines, BODY_UPPER} from './family-fitting-evidence.mjs';

const SHOE_TAG = 'Customization.Shape.PushInsideClothes.Boots_M';
const SHOE = 'Boots_M', OTHER = 'BodyTypeHeavy';

// --- synthetic scene and snapshot builders -----------------------------------
const mesh = (name, {uuid = name, dictionary, weights, matched, visible = true} = {}) => ({
  isMesh: true, uuid, name, visible, children: [],
  userData: matched === undefined ? {} : {sourceFittingMorphs: matched},
  morphTargetDictionary: dictionary, morphTargetInfluences: weights,
});
const group = (rigItemId, children, visible = true) => ({userData: {rigItemId}, visible, children});
const fitted = (name, weight, {uuid = name, matched = [SHOE], extra = 0.4} = {}) =>
  mesh(name, {uuid, dictionary: {[SHOE]: 0, [OTHER]: 1}, weights: [weight, extra], matched});
const snapshotOf = (meshes, {items = {boots: {hidden: false}}, fittingTags = [SHOE_TAG], ...rest} = {}) =>
  collectFittingSnapshot({root: {visible: true, children: meshes}, assembly: {items, fittingTags, ...rest}});
const check = (snapshot, {itemIds = ['boots'], fittingTags = [SHOE_TAG], slotConflicts = [], effective, coatId = null, shirtId = null, completeCoat = false} = {}) =>
  checkFittingEvidence({label: 'step', snapshot, requested: {itemIds, fittingTags, slotConflicts, coatId, shirtId, completeCoat},
    effectiveFittingTags: effective ?? snapshot.assembly?.fittingTags ?? []});

test('records body, support and candidate meshes with owner, uuid, visibility and finite weights', () => {
  const snapshot = snapshotOf([
    group('boots', [fitted('shoe-mesh', 1)]),
    group('pants', [fitted('pants-mesh', 1, {matched: [SHOE]})], false),
    mesh('body', {dictionary: {[SHOE]: 0, [OTHER]: 1}, weights: [1, 0.4], matched: [SHOE]}),
    mesh('decal-plane'),
  ]);
  const byName = Object.fromEntries(snapshot.meshes.map(m => [m.name, m]));
  assert.equal(snapshot.meshes.length, 4);
  assert.equal(byName['shoe-mesh'].itemId, 'boots');
  assert.equal(byName['body'].itemId, null);
  assert.equal(byName['body'].identity, 'body-or-unowned');
  assert.equal(byName['pants-mesh'].visible, false);       // hidden by its ancestor group
  assert.equal(byName['pants-mesh'].selfVisible, true);    // ...but fitted all the same
  assert.deepEqual(byName['body'].weights, [1, 0.4]);      // arbitrary body-type weight preserved
  assert.equal(byName['decal-plane'].dictionary, null);
  assert.equal(byName['decal-plane'].matched, null);
  assert.deepEqual(check(snapshot).errors, []);
});

test('a wrong body or support weight fails even though every candidate mesh is correct', () => {
  const candidate = group('boots', [fitted('shoe-mesh', 1)]);
  const body = mesh('body', {dictionary: {[SHOE]: 0, [OTHER]: 1}, weights: [0.5, 0.4], matched: [SHOE]});
  const pants = group('pants', [fitted('pants-mesh', 0)]);
  assert.deepEqual(check(snapshotOf([candidate])).errors, []); // the candidate-only view sees nothing
  const errors = check(snapshotOf([candidate, body, pants])).errors;
  assert.equal(errors.length, 2);
  assert.match(errors[0], /body-or-unowned\/body#body: Boots_M weight 0\.5, expected 1/);
  assert.match(errors[1], /pants-mesh#pants-mesh: Boots_M weight 0, expected 1/);
});

test('stale or missing fitting bookkeeping fails; unrelated weights are never demanded to be 0', () => {
  const stale = check(snapshotOf([mesh('body', {dictionary: {[OTHER]: 0}, weights: [0.4], matched: [SHOE]})]));
  assert.equal(stale.errors.length, 1);
  assert.match(stale.errors[0], /bookkeeping \["Boots_M"\], expected \[\]/);
  const missing = check(snapshotOf([mesh('shoe-mesh', {dictionary: {[SHOE]: 0}, weights: [1]})]));
  assert.match(missing.errors[0], /bookkeeping null, expected \["Boots_M"\]/);
  assert.deepEqual(check(snapshotOf([fitted('shoe-mesh', 1, {extra: 0.9})])).errors, []);
});

test('only morphs the mesh actually implements are required', () => {
  const absent = snapshotOf([mesh('body', {dictionary: {[OTHER]: 0}, weights: [0.4]})]);
  assert.deepEqual(implementedMorphs(absent.meshes[0], fittingMorphNames([SHOE_TAG])), []);
  assert.deepEqual(check(absent).errors, []);
  assert.deepEqual(check(absent).notes, ['step: no mesh implements Boots_M']);
  // An index outside the weight array is not a drivable morph, so nothing is claimed for it.
  const short = snapshotOf([mesh('body', {dictionary: {[SHOE]: 7}, weights: [0.4]})]);
  assert.deepEqual(check(short).errors, []);
  const broken = snapshotOf([mesh('body', {dictionary: {[SHOE]: 0}, weights: [Number.NaN], matched: [SHOE]})]);
  assert.match(check(broken).errors[0], /non-finite morph weight at index 0/);
});

test('missing final assembly data fails instead of being accepted', () => {
  const snapshot = collectFittingSnapshot({root: {visible: true, children: [fitted('shoe-mesh', 1)]}, assembly: null});
  assert.equal(snapshot.assembly, null);
  assert.deepEqual(check(snapshot).errors, ['step: missing final source assembly']);
  const rootless = collectFittingSnapshot({root: null, assembly: null});
  assert.deepEqual(rootless.meshes, []);
  assert.deepEqual(check(rootless).errors, ['step: missing rendered rig root', 'step: missing final source assembly']);
});

test('a shirt suppressed by a BodyUpper conflict is explained, and its tags stay inactive', () => {
  const SHIRT_TAG = 'Customization.Shape.ShrinkWrap.Shirt_M';
  const snapshot = snapshotOf([group('coat', [fitted('coat-mesh', 1)])], {items: {coat: {hidden: false}}});
  const result = check(snapshot, {itemIds: ['coat', 'shirt'], fittingTags: [SHOE_TAG, SHIRT_TAG],
    slotConflicts: [{slot: BODY_UPPER, items: ['coat', 'shirt']}], coatId: 'coat', shirtId: 'shirt', completeCoat: true});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.suppressed, [{id: 'shirt', reason: 'body-upper-conflict'}]);
  // The page may not claim the hidden shirt's tag: the resolver over the worn definitions rules.
  const claimed = snapshotOf([group('coat', [fitted('coat-mesh', 1)])],
    {items: {coat: {hidden: false}}, fittingTags: [SHOE_TAG, SHIRT_TAG]});
  assert.match(check(claimed, {itemIds: ['coat', 'shirt'], effective: [SHOE_TAG]}).errors[0],
    /final fitting tags .*Shirt_M.* disagree with the resolver/);
});

test('an unexplained missing item fails; unsupported and added items are recorded', () => {
  const snapshot = snapshotOf([group('boots', [fitted('shoe-mesh', 1)])],
    {items: {boots: {hidden: false}, undersuit: {hidden: false}}, unresolvedItems: ['gloves']});
  const result = check(snapshot, {itemIds: ['boots', 'gloves', 'hat']});
  assert.deepEqual(result.errors, ['step: requested item is missing from the final assembly: hat']);
  assert.deepEqual(result.suppressed, [{id: 'gloves', reason: 'unsupported'}, {id: 'hat', reason: 'unexplained'}]);
  assert.deepEqual(result.added, ['undersuit']);
});

// --- restoration across same-page swaps --------------------------------------
const active = new Set([SHOE]), inactive = new Set();

test('A -> B -> A restores the observed baseline, including a nonzero one', () => {
  const baselines = new FittingBaselines();
  const at = weight => snapshotOf([mesh('body', {dictionary: {[SHOE]: 0}, weights: [weight]})]);
  assert.deepEqual(baselines.observe('a', at(0.35), inactive).notes, []);
  baselines.observe('b', at(1), active);
  const good = baselines.observe('a2', at(0.35), inactive);
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.restored, [{uuid: 'body', identity: 'body-or-unowned', name: SHOE, baseline: 0.35}]);
  const corrupted = new FittingBaselines();
  corrupted.observe('a', at(0.35), inactive);
  corrupted.observe('b', at(1), active);
  assert.match(corrupted.observe('a2', at(0), inactive).errors[0],
    /Boots_M is 0 after removal, expected the observed 0\.35/);
});

test('a stale weight left behind after removal fails', () => {
  const baselines = new FittingBaselines();
  const at = weight => snapshotOf([mesh('body', {dictionary: {[SHOE]: 0}, weights: [weight]})]);
  baselines.observe('a', at(0), inactive);
  baselines.observe('b', at(1), active);
  assert.match(baselines.observe('a2', at(1), inactive).errors[0], /is 1 after removal, expected the observed 0/);
});

test('a first sighting that is already active is recorded, not guessed', () => {
  const baselines = new FittingBaselines();
  const at = weight => snapshotOf([mesh('body', {dictionary: {[SHOE]: 0}, weights: [weight]})]);
  const first = baselines.observe('b', at(1), active);
  assert.deepEqual(first.errors, []);
  assert.match(first.notes[0], /was already active when first observed — no baseline to restore/);
  const removed = baselines.observe('a', at(0.2), inactive); // adopt what removal actually left
  assert.deepEqual(removed.errors, []);
  assert.deepEqual(removed.restored, []);
  baselines.observe('b2', at(1), active);
  assert.match(baselines.observe('a2', at(0), inactive).errors[0], /expected the observed 0\.2/);
});

test('a reload resets tracking and a replaced mesh inherits no baseline', () => {
  const baselines = new FittingBaselines();
  const at = (weight, uuid) => snapshotOf([mesh('body', {uuid, dictionary: {[SHOE]: 0}, weights: [weight]})]);
  baselines.observe('a', at(0.35, 'mesh-1'), inactive);
  baselines.observe('b', at(1, 'mesh-1'), active);
  baselines.reset();
  const reloaded = baselines.observe('a2', at(0, 'mesh-1'), inactive);
  assert.deepEqual([reloaded.errors, reloaded.notes, reloaded.restored], [[], [], []]);
  const replaced = new FittingBaselines();
  replaced.observe('a', at(0.35, 'mesh-1'), inactive);
  replaced.observe('b', at(1, 'mesh-1'), active);
  const swapped = replaced.observe('a2', at(0, 'mesh-2'), inactive); // a different mesh, same identity
  assert.deepEqual([swapped.errors, swapped.restored], [[], []]);
});


test('a BodyUpper conflict cannot explain a missing coat instead of its shirt', () => {
  const state = snapshotOf([], {items: {shirt: {hidden: false}}, fittingTags: []});
  const result = check(state, {itemIds: ['coat', 'shirt'], slotConflicts: [{slot: BODY_UPPER, items: ['coat', 'shirt']}], coatId: 'coat', shirtId: 'shirt', completeCoat: true});
  assert.match(result.errors.join('; '), /requested item is missing.*coat/);
});

test('an incomplete coat does not authorize suppressing the selected shirt', () => {
  const state = snapshotOf([], {items: {coat: {hidden: false}}, fittingTags: []});
  const result = check(state, {itemIds: ['coat', 'shirt'], slotConflicts: [{slot: BODY_UPPER, items: ['coat', 'shirt']}], coatId: 'coat', shirtId: 'shirt', completeCoat: false});
  assert.match(result.errors.join('; '), /requested item is missing.*shirt/);
});

// --- the exact PushJacket bandolier tag ----------------------------------------
const BANDOLIER = 'bandolier_squeeze', BANDOLIER_TAG = 'Customization.Shape.PushJacket.bandolier_squeeze';
const torso = (weight, {matched = [BANDOLIER], uuid = 'torso-mesh', body = 0.6} = {}) => group('torso', [
  mesh('torso-mesh', {uuid, dictionary: {medium_male: 0, [BANDOLIER]: 1, medium_female: 2}, weights: [body, weight, 0], matched})]);
const torsoStep = (weight, fittingTags, options) =>
  snapshotOf([torso(weight, options)], {items: {torso: {hidden: false}}, fittingTags});
const checkTorso = snapshot => check(snapshot, {itemIds: ['torso']});

test('only the exact bandolier PushJacket tag is decoded', () => {
  assert.deepEqual([...fittingMorphNames([BANDOLIER_TAG])], [BANDOLIER]);
  for (const tag of ['Customization.Shape.PushJacket.shrink_under_vest', 'Customization.Shape.PushJacket',
    'Customization.Shape.PushJacket.Bandolier_Squeeze', 'Customization.Shape.pushjacket.bandolier_squeeze',
    'Customization.Shape.PushJacket.bandolier_squeeze.extra', 'Customization.Shape.PushJacket.bandolier_squeeze2',
    'Customization.Shape.OtherGroup.bandolier_squeeze'])
    assert.deepEqual([...fittingMorphNames([tag])], [], tag);
  // An undecoded PushJacket leaf demands nothing, even on a mesh that authors that morph.
  const vest = snapshotOf([group('coat', [mesh('coat-mesh', {dictionary: {shrink_under_vest: 0}, weights: [0]})])],
    {items: {coat: {hidden: false}}, fittingTags: ['Customization.Shape.PushJacket.shrink_under_vest']});
  assert.deepEqual(check(vest, {itemIds: ['coat']}).errors, []);
});

test('an ignored bandolier left at zero while its tag is active fails', () => {
  // What the old decoder produced: nothing driven, nothing recorded.
  const ignored = checkTorso(torsoStep(0, [BANDOLIER_TAG], {matched: []}));
  assert.equal(ignored.errors.length, 2);
  assert.match(ignored.errors[0], /torso-mesh#torso-mesh: bandolier_squeeze weight 0, expected 1/);
  assert.match(ignored.errors[1], /fitting bookkeeping \[\], expected \["bandolier_squeeze"\]/);
  // Driven but unrecorded, or recorded but not driven, fails as well.
  assert.match(checkTorso(torsoStep(1, [BANDOLIER_TAG], {matched: []})).errors.join('; '), /bookkeeping \[\]/);
  assert.match(checkTorso(torsoStep(0.25, [BANDOLIER_TAG])).errors.join('; '), /weight 0\.25, expected 1/);
  const fitted = checkTorso(torsoStep(1, [BANDOLIER_TAG]));
  assert.deepEqual([fitted.errors, fitted.notes], [[], []]);
  assert.deepEqual(fitted.meshes[0].implemented, [BANDOLIER]);
  assert.deepEqual(fitted.meshes[0].weights, [0.6, 1, 0]); // unrelated body-type weight not demanded
});

test('bandolier removal: stale bookkeeping or a stale weight fails, the nonzero original restores', () => {
  assert.match(checkTorso(torsoStep(0.25, [])).errors[0], /bookkeeping \["bandolier_squeeze"\], expected \[\]/);
  assert.deepEqual(checkTorso(torsoStep(0.25, [], {matched: []})).errors, []);
  const run = weights => {
    const baselines = new FittingBaselines(), steps = [[], [BANDOLIER_TAG], []];
    return steps.map((tags, index) =>
      baselines.observe(`s${index}`, torsoStep(weights[index], tags, {matched: tags.length ? [BANDOLIER] : []}),
        fittingMorphNames(tags)));
  };
  const good = run([0.25, 1, 0.25]);
  assert.deepEqual(good.flatMap(step => step.errors), []);
  assert.deepEqual(good[2].restored.map(entry => [entry.name, entry.baseline]), [[BANDOLIER, 0.25]]);
  assert.match(run([0.25, 1, 1])[2].errors[0], /bandolier_squeeze is 1 after removal, expected the observed 0\.25/);
  assert.match(run([0.25, 1, 0])[2].errors[0], /bandolier_squeeze is 0 after removal, expected the observed 0\.25/);
});
