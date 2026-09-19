// Multipart freeze contracts on the eight supplied Tactical Trousers definitions (read-only references).
// Expected bindings come from reference/resolver-probe-v1.json, produced separately by the product resolver.
// These deterministic contract tests use a clearly fake resolver. The real product resolver is
// exercised separately during the source freeze and browser integration. Run: node --test tests/multipart-family.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertResolved, resolveChoice, validateManifest, OTHER_ARCHETYPES} from '../scripts/shader-probe/freeze-multipart-family.mjs';

const ref = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/multipart-family/${name}`, import.meta.url), 'utf8'));
const definitions = ref('tactical-definitions.json'), probe = ref('resolver-probe-v1.json');
const path = soft => soft?.AssetPathName ?? '';
const FAKE_RESOLVE = ([definition], context) => {
  const tags = new Set([...context, ...(definition.properties.ActivatesTags ?? [])]);
  const materials = Object.fromEntries((definition.properties.MaterialOverrides ?? []).map(m => [m.Key, path(m.Value)]));
  const parts = definition.properties.VisualParts.map((part, sourceIndex) => {
    const hides = part.TagOverrides.some(r => r.MatchingTags.length === 1 && tags.has(r.MatchingTags[0]) && r.bOverrideMesh && !path(r.ReplacementSkeletalMesh));
    return {sourceIndex, staticMesh: path(part.StaticMesh), skeletalMesh: hides ? '' : path(part.SkeletalMesh), effect: path(part.Effect),
      hidden: hides, rules: [], unresolved: [], materials, definition: part};
  });
  return {unresolvedItems: [], fittingTags: [...(definition.properties.ActivatesTags ?? [])].sort(),
    items: {[definition.id]: {parts, hidden: parts.every(p => p.hidden), materialParameters: []}}};
};
const [trousers, socks] = probe.rows[0].bindings;
const cfg = {itemSlot: 'lowerBody', fittingTags: definitions[probe.rows[0].id].properties.ActivatesTags,
  components: [{sourceIndex: 0, source: trousers.mesh, slot: trousers.slot}, {sourceIndex: 1, source: socks.mesh, slot: socks.slot}]};
const itemFor = row => ({id: row.id, slot: 'lowerBody', materials: row.bindings.map(b => b.material)});
const copy = value => JSON.parse(JSON.stringify(value));

test('all eight definitions bind both components by explicit override, as the probe recorded', () => {
  assert.equal(probe.rows.length, 8);
  for (const row of probe.rows) {
    const {effectiveParts} = resolveChoice(itemFor(row), definitions[row.id], FAKE_RESOLVE, cfg);
    assert.deepEqual(effectiveParts, row.bindings.map(b => ({sourceIndex: b.sourceIndex, mesh: b.mesh, binding: 'explicit-override',
      slots: [{slot: b.slot, material: b.material}]})), row.id);
    for (const part of definitions[row.id].properties.VisualParts)
      assert(part.TagOverrides.every(rule => rule.MatchingTags.every(tag => OTHER_ARCHETYPES.includes(tag))), row.id);
  }
});

test('unsupported siblings are rejected individually with the exact reason', () => {
  const row = probe.rows.at(-1), cases = {
    'no explicit override': [d => d.properties.MaterialOverrides.pop(), /has no explicit override/],
    'unmatched override': [d => d.properties.MaterialOverrides.push({Key: 'DoubleBeltParts', Value: {AssetPathName: '/Game/X.X'}}), /matches no component slot/],
    'omitted part': [d => d.properties.VisualParts.pop(), /not exactly the manifest components/],
    'reordered parts': [d => d.properties.VisualParts.reverse(), /not exactly the manifest components/],
    'hide rule': [d => d.properties.VisualParts[1].TagOverrides.push({...copy(d.properties.VisualParts[1].TagOverrides[0]),
      MatchingTags: ['Customization.HideMesh.WearingLongJacket'], ReplacementSkeletalMesh: {AssetPathName: '', SubPathString: ''}}), /conditional part rule/],
    'wrap deformer': [d => { d.properties.VisualParts[0].WrapDeformation.bIsWrapDeformed = true; }, /wrap deformation/],
    'split tags': [d => d.properties.ActivatesTags.pop(), /activated tags/],
    'effect': [d => { d.properties.VisualParts[1].Effect = {AssetPathName: '/Game/FX.FX'}; }, /static or effect parts/],
    'parameter overlay': [d => { d.properties.ActivatesMaterialParameters = [{}]; }, /material parameter overlays/],
  };
  for (const [name, [change, reason]] of Object.entries(cases)) {
    const definition = copy(definitions[row.id]);
    change(definition);
    assert.throws(() => resolveChoice(itemFor(row), definition, FAKE_RESOLVE, cfg), reason, name);
  }
  const wrong = {...itemFor(row), materials: [row.bindings[0].material, probe.rows[0].bindings[1].material]};
  assert.throws(() => resolveChoice(wrong, definitions[row.id], FAKE_RESOLVE, cfg), /is not the cohort's/);
  const hidden = FAKE_RESOLVE([definitions[row.id]], ['Customization.Archetype.Medium']).items[row.id];
  hidden.parts[1].hidden = true;
  assert.throws(() => assertResolved(itemFor(row), definitions[row.id], hidden, cfg), /hidden parts/);
});

test('the manifest validator rejects single-mesh and ambiguous component lists', () => {
  const pin = {sha256: 'a'.repeat(64), sourcePackageSha256: 'B'.repeat(64), sourceDtoSha256: 'c'.repeat(64), morphNames: ['m'],
    facts: {vertices: 1, triangles: 1, uvSets: 1, bones: 1, materialSections: 1, maxInfluences: 8}};
  const manifest = {id: 'tactical', schemaVersion: 2, itemSlot: 'lowerBody', fittingTags: cfg.fittingTags,
    coverage: {mode: 'fitted-conservative-shared-uv', composition: 'per-component-union'},
    paths: {docs: '_docs/t', work: 'scripts/generated/shader-probe/t', runtime: 'public/models/t-v1', preview: 'public/models/t-preview-v1',
      active: 'public/models/a', sourceIndex: 'public/models/s', catalog: 'src/data/items.json', resolver: 'src/rig/SourceAssembly.ts',
      refresh: 'scripts/generated/shader-probe/r', appUrl: 'http://127.0.0.1:5174', metadata: ['src/data/share-item-ids.json']},
    components: cfg.components.map(c => ({...c, ...pin}))};
  assert.equal(validateManifest(manifest), manifest);
  for (const change of [m => m.components.pop(), m => m.components.reverse(), m => { m.components[1].slot = m.components[0].slot; },
    m => { m.coverage = {mode: 'derived'}; }, m => { m.schemaVersion = 1; }])
    assert.throws(() => { const m = copy(manifest); change(m); validateManifest(m); });
});
