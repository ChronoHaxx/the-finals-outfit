// Deterministic checks of the per-component multipart outfit contract and the snapshot fields it reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFittingSnapshot } from '../scripts/shader-probe/family-fitting-evidence.mjs';
import { expectedComponents, checkComponentBindings, checkComponentMeshes }
  from '../scripts/shader-probe/multipart-review-contract.mjs';

const TROUSERS = '/Game/Test/Trousers/SK_Test_Trousers.SK_Test_Trousers';
const SOCKS = '/Game/Test/Socks/SK_Test_Socks.SK_Test_Socks';
const T_MAT = '/Game/Test/Trousers/MI_Trousers_Red.MI_Trousers_Red';
const S_MAT = '/Game/Test/Socks/MI_Socks_Cotton.MI_Socks_Cotton';
const MORPHS = ['medium_male', 'medium_female'];
const manifest = { schemaVersion: 2, itemSlot: 'lowerBody', components: [
  { sourceIndex: 0, source: TROUSERS, slot: 'Trousers', morphNames: MORPHS },
  { sourceIndex: 1, source: SOCKS, slot: 'Socks', morphNames: [...MORPHS, 'push_socks_quarter'] },
] };
const item = { id: 'trousers-red', slot: 'lowerBody', materials: [T_MAT, S_MAT] };
const cohort = { meshes: [TROUSERS, SOCKS], items: [item] };
const components = expectedComponents(manifest, cohort, item);
const ACTIVE = new Set(['push_socks_quarter']);

const part = (sourceIndex, sourceMesh, material) =>
  ({ sourceIndex, sourceMesh, materials: [{ sourceMaterial: material, visible: true, reconstructed: true }] });
const entry = (...parts) => ({ id: item.id, parts });
const goodEntry = () => entry(part(0, TROUSERS, T_MAT), part(1, SOCKS, S_MAT));

/** One rendered mesh as collectFittingSnapshot reports it, built from a Three-like object. */
function rendered({ index, source, material, names, weights, uuid = `mesh-${index}` }) {
  const object = { isMesh: true, uuid, name: '', visible: true, children: [],
    userData: { sourcePartIndex: index, sourceMesh: source },
    material: { userData: { sourceMaterial: material } },
    morphTargetDictionary: Object.fromEntries(names.map((name, i) => [name, i])), morphTargetInfluences: weights };
  const root = { visible: true, children: [{ userData: { rigItemId: item.id }, visible: true, children: [object] }] };
  return collectFittingSnapshot({ root, assembly: null }).meshes[0];
}
const goodMeshes = () => [
  rendered({ index: 0, source: TROUSERS, material: T_MAT, names: MORPHS, weights: [0, 0] }),
  rendered({ index: 1, source: SOCKS, material: S_MAT, names: [...MORPHS, 'push_socks_quarter'], weights: [0, 0, 1] }),
];

test('snapshot exposes the part index, source mesh and source materials CharacterRig assigns', () => {
  const [mesh] = goodMeshes();
  assert.equal(mesh.itemId, item.id);
  assert.equal(mesh.sourcePartIndex, 0);
  assert.equal(mesh.sourceMesh, TROUSERS);
  assert.deepEqual(mesh.sourceMaterials, [T_MAT]);
  const bare = collectFittingSnapshot({ root: { visible: true, isMesh: true, children: [], userData: {} }, assembly: null }).meshes[0];
  assert.deepEqual([bare.sourcePartIndex, bare.sourceMesh, bare.sourceMaterials], [null, null, []]);
});

test('expected components follow manifest source order with one material each', () => {
  assert.deepEqual(components.map(c => [c.sourceIndex, c.source, c.material]), [[0, TROUSERS, T_MAT], [1, SOCKS, S_MAT]]);
  assert.throws(() => expectedComponents(manifest, { meshes: [SOCKS, TROUSERS] }, item), /source part order/);
  assert.throws(() => expectedComponents(manifest, { meshes: [TROUSERS] }, item), /source part order/);
  assert.throws(() => expectedComponents(manifest, cohort, { ...item, materials: [T_MAT] }), /one material per component/);
  assert.throws(() => expectedComponents(manifest, cohort, { ...item, slot: 'feet' }), /is not lowerBody/);
  assert.throws(() => expectedComponents({ ...manifest, schemaVersion: 1 }, cohort, item), /not a schemaVersion 2/);
});

test('complete, correctly bound components pass both checks', () => {
  assert.deepEqual(checkComponentBindings(goodEntry(), components, 'equip'), []);
  assert.deepEqual(checkComponentMeshes(goodMeshes(), components, ACTIVE, 'equip'), []);
});

test('a missing component fails', () => {
  assert.match(checkComponentBindings(entry(part(0, TROUSERS, T_MAT)), components, 'equip').join('\n'), /component 1: 0 rendered parts/);
  assert.match(checkComponentMeshes(goodMeshes().slice(0, 1), components, ACTIVE, 'equip').join('\n'), /component 1: missing rendered mesh/);
});

test('swapped per-part materials fail even though the aggregate material set is unchanged', () => {
  const swapped = entry(part(0, TROUSERS, S_MAT), part(1, SOCKS, T_MAT));
  const aggregate = e => e.parts.flatMap(p => p.materials.map(m => m.sourceMaterial)).sort();
  assert.deepEqual(aggregate(swapped), aggregate(goodEntry()));
  const errors = checkComponentBindings(swapped, components, 'equip');
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /component 0: materials .*expected only .*MI_Trousers_Red/);
  const meshes = goodMeshes();
  [meshes[0].sourceMaterials, meshes[1].sourceMaterials] = [[S_MAT], [T_MAT]];
  assert.equal(checkComponentMeshes(meshes, components, ACTIVE, 'equip').length, 2);
});

test('a wrong source part index or source mesh fails', () => {
  assert.match(checkComponentBindings(entry(part(0, TROUSERS, T_MAT), part(2, SOCKS, S_MAT)), components, 'equip').join('\n'),
    /rendered parts \[0,2\] are not exactly components \[0,1\]/);
  assert.match(checkComponentBindings(entry(part(0, SOCKS, T_MAT), part(1, SOCKS, S_MAT)), components, 'equip').join('\n'),
    /component 0: source mesh/);
  assert.match(checkComponentBindings(entry(part('0', TROUSERS, T_MAT), part(1, SOCKS, S_MAT)), components, 'equip').join('\n'),
    /component 0: 0 rendered parts/);
  const meshes = goodMeshes();
  meshes[1].sourcePartIndex = 2;
  const errors = checkComponentMeshes(meshes, components, ACTIVE, 'equip').join('\n');
  assert.match(errors, /source part 2, not a manifest component/);
  assert.match(errors, /component 1: missing rendered mesh/);
  const wrongMesh = goodMeshes();
  wrongMesh[0].sourceMesh = SOCKS;
  assert.match(checkComponentMeshes(wrongMesh, components, ACTIVE, 'equip').join('\n'), /component 0 mesh mesh-0: source mesh/);
});

test('each component keeps its own morph dictionary; another component\'s dictionary fails', () => {
  const meshes = goodMeshes();
  meshes[1] = rendered({ index: 1, source: SOCKS, material: S_MAT, names: MORPHS, weights: [0, 0] });
  assert.match(checkComponentMeshes(meshes, components, ACTIVE, 'equip').join('\n'), /component 1 mesh mesh-1: morph dictionary/);
  const extra = goodMeshes();
  extra[0] = rendered({ index: 0, source: TROUSERS, material: T_MAT, names: [...MORPHS, 'push_socks_quarter'], weights: [0, 0, 1] });
  assert.match(checkComponentMeshes(extra, components, ACTIVE, 'equip').join('\n'), /component 0 mesh mesh-0: morph dictionary/);
});

test('wrong fitting weights fail per component', () => {
  const inactive = goodMeshes();
  inactive[1].weights = [0, 0, 0];
  assert.match(checkComponentMeshes(inactive, components, ACTIVE, 'equip').join('\n'),
    /component 1 mesh mesh-1: push_socks_quarter weight 0, expected 1/);
  const stray = goodMeshes();
  stray[0].weights = [0.5, 0];
  assert.match(checkComponentMeshes(stray, components, ACTIVE, 'equip').join('\n'), /medium_male weight 0.5, expected 0/);
  assert.match(checkComponentMeshes(goodMeshes(), components, new Set(), 'remove').join('\n'), /push_socks_quarter weight 1, expected 0/);
});
