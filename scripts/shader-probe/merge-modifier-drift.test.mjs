// The narrow neutral-drift rule for the 17 Nov MeshMergeModifiers overrides (S12 batch C wave C1, option A).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admitMergeModifierDrift, mergeModifierOnly, resolvedEqual, MERGE_MODIFIER_TAG } from './merge-modifier-drift.mjs';
const { resolveSourceOutfit } = await import(new URL('../../src/rig/SourceAssembly.ts', import.meta.url).href);

const MEDIUM = ['Customization.Archetype.Medium'];
const resolveMedium = (definition) => resolveSourceOutfit([definition], MEDIUM);
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/merge-modifier-drift/streetwear-hoodie-cotton-blackfinals.json', import.meta.url), 'utf8'));
const DRIFT = { status: 'differs', keys: ['VisualParts'] };
const copy = (value) => structuredClone(value);
const stored = () => copy(fixture.stored);
const fresh = () => copy(fixture.nov17Properties);
const lastOverride = (properties) => properties.VisualParts[0].TagOverrides.at(-1);

test('the real Hoodie item passes both conditions on Medium', () => {
  const verdict = admitMergeModifierDrift(DRIFT, stored(), fresh(), resolveMedium);
  assert.deepEqual(verdict, { ok: true, appended: 1, resolvedEqual: true });
  // And the resolution compared is the real one: both definitions draw the Medium hoodie, not the suffix-less mesh.
  for (const definition of [stored(), { ...stored(), properties: fresh() }]) {
    const part = resolveMedium(definition).items[fixture.id].parts[0];
    assert.match(part.skeletalMesh, /SK_Streetwear_Hoodie_M$/);
    assert.deepEqual([part.hidden, part.rules, part.unresolved], [false, [], []]);
  }
});

test('the fixture is the real drift: one appended merge-modifier override, nothing else', () => {
  const before = fixture.stored.properties, after = fixture.nov17Properties;
  assert.deepEqual(Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])), ['VisualParts']);
  assert.equal(after.VisualParts[0].TagOverrides.length, before.VisualParts[0].TagOverrides.length + 1);
  assert.deepEqual(lastOverride(after).MatchingTags, [MERGE_MODIFIER_TAG]);
});

// Must-fail cases named by the coordinator, 26 Nov.
test('refuses an appended override with a second tag', () => {
  const f = fresh();
  lastOverride(f).MatchingTags.push('Customization.Archetype.Medium');
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, f.VisualParts).ok, false);
  assert.equal(admitMergeModifierDrift(DRIFT, stored(), f, resolveMedium).ok, false);
});

test('refuses an appended override with a material override', () => {
  const withMaterial = fresh();
  Object.assign(lastOverride(withMaterial), { bOverrideMaterials: true,
    MaterialOverrides: [{ Key: 'MI_Streetwear_Hoodie', Value: { AssetPathName: '/Game/Some/MI_Other.MI_Other', SubPathString: '' } }] });
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, withMaterial.VisualParts).ok, false);
  // A material list behind a false flag is refused as well: the rule reads the data, not just the flag.
  const listOnly = fresh();
  lastOverride(listOnly).MaterialOverrides.push({ Key: 'MI_Streetwear_Hoodie', Value: { AssetPathName: '/Game/X.X', SubPathString: '' } });
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, listOnly.VisualParts).ok, false);
  const flagOnly = fresh();
  lastOverride(flagOnly).bOverrideMaterials = true;
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, flagOnly.VisualParts).ok, false);
});

test('refuses a changed existing override', () => {
  const f = fresh();
  f.VisualParts[0].TagOverrides[0].ReplacementSkeletalMesh.AssetPathName = '/Game/Other/SK_Other_L.SK_Other_L';
  const verdict = mergeModifierOnly(stored().properties.VisualParts, f.VisualParts);
  assert.deepEqual(verdict, { ok: false, reason: 'part 0 TagOverrides[0] changed' });
  const reordered = fresh();
  const [light, heavy] = reordered.VisualParts[0].TagOverrides;
  reordered.VisualParts[0].TagOverrides.splice(0, 2, heavy, light);
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, reordered.VisualParts).ok, false);
});

test('refuses any other VisualParts field changed', () => {
  const edits = [
    p => { p.SkeletalMesh.AssetPathName = '/Game/Other/SK_Other_M.SK_Other_M'; },
    p => { p.LocalScale.X = 1.01; },
    p => { p.bIsAttached = !p.bIsAttached; },
    p => { p.WrapDeformation = { changed: true }; },
    p => { delete p.LogicModules; },
    p => { p.NewField = 1; },
  ];
  for (const edit of edits) {
    const f = fresh();
    edit(f.VisualParts[0]);
    const verdict = mergeModifierOnly(stored().properties.VisualParts, f.VisualParts);
    assert.equal(verdict.ok, false, String(edit));
    assert.match(verdict.reason, /^part 0 field /);
  }
});

test('refuses part-count changes, removed overrides and drift with nothing appended', () => {
  const s = stored().properties.VisualParts;
  const added = fresh(); added.VisualParts.push(copy(added.VisualParts[0]));
  assert.equal(mergeModifierOnly(s, added.VisualParts).ok, false);
  const removed = fresh(); removed.VisualParts[0].TagOverrides.splice(0, 1);
  assert.equal(mergeModifierOnly(s, removed.VisualParts).ok, false);
  assert.deepEqual(mergeModifierOnly(s, stored().properties.VisualParts), { ok: false, reason: 'no merge-modifier override appended' });
  assert.equal(mergeModifierOnly(s, undefined).ok, false);
});

test('refuses an appended override that does more than swap the mesh', () => {
  const edits = [
    o => { o.bOverrideEffect = true; },
    o => { o.bAddLogicModules = true; },
    o => { o.LogicModules.push({ any: 1 }); },
    o => { o.bOffsetTransform = true; },
    o => { o.OptionalWrapDeformerMeshOverride.AssetPathName = '/Game/X/SK_Wrap.SK_Wrap'; },
    o => { o.MatchingTags = []; },
    o => { o.MatchingTags = ['Customization.Feature.MeshMergeModifiers.Extra']; },
  ];
  for (const edit of edits) {
    const f = fresh();
    edit(lastOverride(f));
    assert.equal(mergeModifierOnly(stored().properties.VisualParts, f.VisualParts).ok, false, String(edit));
  }
});

test('key order inside a part does not count as a change', () => {
  const f = fresh();
  f.VisualParts[0] = Object.fromEntries(Object.entries(f.VisualParts[0]).reverse());
  assert.equal(mergeModifierOnly(stored().properties.VisualParts, f.VisualParts).ok, true);
});

test('only a VisualParts-only `differs` drift row qualifies', () => {
  for (const drift of [{ status: 'identical', keys: [] }, { status: 'differs', keys: ['VisualParts', 'Slots'] },
    { status: 'differs', keys: ['MaterialOverrides'] }, { status: 'missing' }, undefined])
    assert.equal(admitMergeModifierDrift(drift, stored(), fresh(), resolveMedium).ok, false, JSON.stringify(drift));
});

test('condition (2) bites: a context that grants the tag resolves the two definitions differently', () => {
  const granted = (definition) => resolveSourceOutfit([definition], [...MEDIUM, MERGE_MODIFIER_TAG]);
  assert.equal(resolvedEqual(granted, stored(), fresh()), false);
  const verdict = admitMergeModifierDrift(DRIFT, stored(), fresh(), granted);
  assert.deepEqual([verdict.ok, verdict.resolvedEqual], [false, false]);
  assert.match(granted({ ...stored(), properties: fresh() }).items[fixture.id].parts[0].skeletalMesh, /SK_Streetwear_Hoodie$/);
});
