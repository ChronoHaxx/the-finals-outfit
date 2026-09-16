"""Focused negative contracts for the Military Assault Pants adapter and freeze, without game assets.

The adapter is loaded against a stub of prepare-large-sneakers.py (its real dependencies live only in the
complete repository); freeze.mjs validators are pure exports and are exercised through node. The supplied
source-only cohort.json is the only fixture; values under test come from the modules, not copies.

  C:/ProgramData/anaconda3/python.exe -B tests/test_assault_pants_adapter.py -v
"""
import hashlib
import importlib.abc
import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-assault-pants.py'
FREEZE = ROOT / '_docs' / 'assault-pants-2026-09-15' / 'freeze.mjs'
COHORT = ROOT / '_docs' / 'assault-pants-2026-09-15' / 'cohort.json'
MORPHS = ['shrink_a', 'shrink_b', 'body_a', 'body_b']


class _StubLoader(importlib.abc.Loader):
    def __init__(self, shared):
        self.shared = shared

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__dict__.update(vars(self.shared))


def load_adapter():
    d = types.SimpleNamespace(REUSE_EXPORTS=['stale'], REUSE_TEXTURES=['stale'], MESH_EVIDENCE=['stale'], MARKER='stale',
                              ACTIVE=Path('active'), CATALOG=Path('catalog.json'))

    def configure(batch, work, runtime, preview):
        d.BATCH, d.WORK, d.RUNTIME, d.PREVIEW, d.SOURCE = Path(batch), Path(work), Path(runtime), Path(preview), Path(work) / 'source'

    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

    d.configure, d.write, d.now = configure, write, lambda: 'now'
    d.read_json = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    d.file_sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    d.package_of = lambda o: 'Discovery/Content/' + o.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'
    d.job_id = lambda instance: instance.lower().replace('_', '-')
    configure('_docs/starter-sneakers-2026-09-15/batch.json', 'sneakers', 'sneakers-runtime', 'sneakers-preview')
    # An earlier batch left its own hooks behind; the adapter must set every one itself.
    shared = types.SimpleNamespace(d=d, DOCS=Path('sneakers'), WORK=Path('sneakers'), RUNTIME=Path('sneakers'),
                                   PREVIEW=Path('sneakers'), MESH_REPORT=Path('sneakers'), progress=None,
                                   audit_blocked=lambda: {}, extract=object(), plan=object(),
                                   index=mock.Mock(), derive_coverage=mock.Mock())
    d.extract, d.plan = object(), object()
    real = importlib.util.spec_from_file_location

    def fake(name, location, *args, **kwargs):
        if name == 'prepare_large_sneakers':
            return importlib.machinery.ModuleSpec(name, _StubLoader(shared))
        return real(name, location, *args, **kwargs)

    spec = real('prepare_assault_pants', ADAPTER)
    module = importlib.util.module_from_spec(spec)
    with mock.patch('importlib.util.spec_from_file_location', fake):
        spec.loader.exec_module(module)
    return module


def glb(document):
    data = json.dumps(document).encode()
    data += b' ' * (-len(data) % 4)
    return b'glTF' + (2).to_bytes(4, 'little') + (20 + len(data)).to_bytes(4, 'little') + \
        len(data).to_bytes(4, 'little') + b'JSON' + data


class AdapterGuards(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        self.tmp = tempfile.mkdtemp()
        os.chdir(self.tmp)
        self.a = load_adapter()
        self.cohort = json.loads(COHORT.read_text(encoding='utf-8'))
        self.a.d.write(self.a.DOCS / 'cohort.json', self.cohort)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def stage_index(self, index, advertised, pairs=()):
        """Write one index and a catalog so the baseline counts are exactly the module's stated values."""
        a = self.a
        catalog = [{'id': f'catalog-{i}'} for i in range(a.CATALOG_ITEMS - len(self.cohort['items']))]
        a.d.write(a.d.CATALOG, catalog + [{'id': item['id']} for item in self.cohort['items']])
        a.d.write(index / 'supported-items.json', {'items': advertised})
        a.d.write(index / 'skin-pairs.json', {'items': {pair: {} for pair in pairs}})
        a.d.write(index / 'assets.json', {'meshes': {}, 'materials': {}})

    def stage_baseline(self):
        a = self.a
        advertised = [f'catalog-{i}' for i in range(a.BASELINE_ADVERTISED)]
        pairs = [f'catalog-{i}' for i in range(a.BASELINE_ADVERTISED, a.BASELINE_INDEXED)]
        self.stage_index(a.d.ACTIVE, advertised, pairs)
        return advertised, pairs

    def test_every_shared_global_and_hook_is_repointed(self):
        a = self.a
        self.assertEqual((a.d.WORK, a.d.SOURCE, a.d.MARKER), (a.WORK, a.WORK / 'source', a.MARKER))
        self.assertEqual((a.d.REUSE_EXPORTS, a.d.REUSE_TEXTURES, a.d.MESH_EVIDENCE), ([], [], []))
        self.assertIs(a.d.extract, a.s.extract)
        self.assertIs(a.d.plan, a.s.plan)
        a._require_configuration()
        a.progress('probe', value=1)
        self.assertEqual(a.d.read_json(a.WORK / 'progress.json')['marker'], a.MARKER)
        for name, stale in (('REUSE_TEXTURES', [Path('scripts/generated/shader-probe/accessory-source-v1/opus-textures-01')]),
                            ('MARKER', 'shader-probe/prepare-starter-sneakers'), ('plan', object())):
            original = getattr(a.d, name)
            setattr(a.d, name, stale)
            with self.assertRaises(SystemExit):
                a._require_configuration()
            setattr(a.d, name, original)
        a.s.MESH_REPORT = Path('_docs/starter-sneakers-2026-09-15/mesh-report.json')
        with self.assertRaises(SystemExit):
            a._require_configuration()

    def test_supplied_cohort_is_accepted_and_drift_rejected(self):
        a, cohort = self.a, self.cohort
        self.assertEqual(len(a._require_cohort()['items']), a.EXPECTED_COUNT)
        first, rest = cohort['items'][0], cohort['items'][1:]
        for broken in ({**cohort, 'count': a.EXPECTED_COUNT - 1}, {**cohort, 'items': rest},
                       {**cohort, 'meshes': [a.SOURCE_MESH.replace('Pants_M', 'Pants_F')]},
                       {**cohort, 'items': [{**first, 'slot': 'feet'}, *rest]},
                       {**cohort, 'items': [{**first, 'materials': first['materials'] * 2}, *rest]},
                       {**cohort, 'items': [first, first, *rest[1:]]},
                       {**cohort, 'materials': cohort['materials'][1:]}):
            a.d.write(a.DOCS / 'cohort.json', broken)
            with self.assertRaises(SystemExit):
                a._require_cohort()

    def test_mesh_stage_never_converts_again(self):
        a = self.a
        a.s.mesh = mock.Mock()
        self.stage_baseline()
        with self.assertRaisesRegex(SystemExit, 'restore'):
            a.mesh()
        a.s.mesh.assert_not_called()

    def test_report_must_name_the_preserved_glb(self):
        a = self.a
        other, dto = a.WORK / 'meshes' / 'SK_Military_AssaultPants_M.glb', Path('SK_Military_AssaultPants_M.mesh.json')
        other.parent.mkdir(parents=True); other.write_bytes(glb({'meshes': []})); dto.write_text('{}')
        a.d.write(a.MESH_REPORT, {'glb': other.as_posix(), 'meshJson': dto.as_posix(), 'file': other.name,
                                  'sha256': a.d.file_sha(other), 'sourceDtoSha256': a.d.file_sha(dto),
                                  'sourcePackageSha256': 'ab'})
        with self.assertRaisesRegex(SystemExit, 'preserved assault-pants conversion'):
            a._require_mesh_contract()

    def test_extracted_mesh_folder_is_reused_only_for_its_exact_request(self):
        a = self.a
        self.assertFalse(a._require_mesh_request())
        folder = a.d.SOURCE / 'meshes-01'
        folder.mkdir(parents=True)
        (folder / 'assets.json').write_text('[]')
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 0})
        with self.assertRaises(SystemExit):  # no request manifest
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(a.SOURCE_MESH.replace('Pants_M', 'Pants_F'))])
        with self.assertRaises(SystemExit):
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(a.SOURCE_MESH)])
        self.assertTrue(a._require_mesh_request())
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 1})
        with self.assertRaises(SystemExit):
            a._require_mesh_request()

    def test_glb_keeps_original_uv_sets_skinning_and_named_morphs(self):
        a = self.a
        attributes = {'POSITION': 0, 'TEXCOORD_0': 1, 'TEXCOORD_1': 2, 'JOINTS_0': 3, 'WEIGHTS_0': 4}
        targets = [{'POSITION': 10 + i, 'NORMAL': 20 + i} for i in range(len(MORPHS))]
        mesh = {'extras': {'targetNames': MORPHS}, 'primitives': [{'attributes': attributes, 'targets': targets}]}
        document = {'meshes': [mesh], 'skins': [{'joints': [0], 'inverseBindMatrices': 5}]}
        dto = {'lods': [{'morphs': [{'name': name} for name in MORPHS]}]}
        path = Path('mesh.glb')
        report = {'glb': path.as_posix(), 'uvSets': 2, 'bones': 23, 'morphs': len(MORPHS)}
        path.write_bytes(glb(document))
        self.assertEqual(a._require_glb_geometry(report, dto), MORPHS)
        self.assertEqual(a._require_glb_geometry({**report, 'morphs': list(MORPHS)}, dto), MORPHS)
        for broken_report in ({**report, 'uvSets': 1}, {**report, 'uvSets': 0}, {**report, 'bones': 0},
                              {**report, 'morphs': len(MORPHS) - 1}, {**report, 'morphs': None},
                              {**report, 'morphs': MORPHS[::-1]}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(broken_report, dto)
        renamed = {'lods': [{'morphs': [{'name': 'shrink_a'}, {'name': 'shrink_a'}, {'name': 'body_a'}, {'name': 'body_b'}]}]}
        for broken_dto in (renamed, {'lods': []}, {'lods': [{'morphs': [{'name': ''}] * len(MORPHS)}]}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report, broken_dto)
        primitive = mesh['primitives'][0]
        for broken_mesh in ({**mesh, 'extras': {}},                                        # names lost
                            {**mesh, 'extras': {'targetNames': MORPHS[:1] + ['renamed', *MORPHS[2:]]}},
                            {**mesh, 'extras': {'targetNames': MORPHS[::-1]}},             # reordered
                            {**mesh, 'primitives': [{**primitive, 'targets': targets[:-1]}]},  # target dropped
                            {**mesh, 'primitives': [{'attributes': attributes}]},          # all targets dropped
                            {**mesh, 'primitives': [{**primitive, 'targets': [{'NORMAL': 1}] * len(MORPHS)}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {**attributes, 'TEXCOORD_2': 6}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'TEXCOORD_1'}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'JOINTS_0'}}]}):
            path.write_bytes(glb({**document, 'meshes': [broken_mesh]}))
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report, dto)
        path.write_bytes(glb({**document, 'skins': []}))
        with self.assertRaises(SystemExit):
            a._require_glb_geometry(report, dto)

    def test_shader_needing_an_absent_uv_set_is_blocked(self):
        a = self.a
        a._require_mesh_contract = lambda: ({'uvSets': 2}, [])
        a.d.write(a.WORK / 'validation' / 'passed.requests.json', [{'id': 'mi-one'}, {'id': 'mi-two'}, {'id': 'mi-three'}])
        a.d.write(a.RUNTIME / 'staging' / 'mi-one.json', {'requiredUvSets': [0]})
        a.d.write(a.RUNTIME / 'staging' / 'mi-two.json', {})  # absent requirement keeps the [0, 1] default
        a.d.write(a.RUNTIME / 'staging' / 'mi-three.json', {'requiredUvSets': [0, 2]})
        self.assertEqual(list(a.geometry_blocked()), ['mi-three'])

    def test_gpu_evidence_is_never_replaced(self):
        a = self.a
        run = a.WORK / 'validation' / 'webgl-run.json'
        a.d.write(run, {'at': '2026-09-15T10:00:00Z', 'result': 'passed'})
        first = a._preserve_gpu_run(run)
        self.assertEqual(a._preserve_gpu_run(run), first)
        first.write_text('{"tampered": true}\n')
        with self.assertRaises(SystemExit):
            a._preserve_gpu_run(run)

    def test_index_needs_the_frozen_active_baseline_before_staging(self):
        a = self.a
        a._require_downstream = lambda: None
        a._require_preview = lambda: None
        advertised, _ = self.stage_baseline()
        with self.assertRaisesRegex(SystemExit, 'adapter-baseline.json is missing'):
            a.index()
        a.d.write(a.DOCS / 'adapter-baseline.json', {'hashes': a._active_hashes()})
        a.index()
        a.s.index.assert_called_once()
        a.d.write(a.d.ACTIVE / 'supported-items.json', {'items': advertised[1:]})
        with self.assertRaisesRegex(SystemExit, 'adapter-baseline'):
            a.coverage()
        a.d.write(a.DOCS / 'adapter-baseline.json', {'hashes': a._active_hashes()})  # pinned, but not the stated baseline
        with self.assertRaisesRegex(SystemExit, 'stated baseline'):
            a.coverage()
        a.s.derive_coverage.assert_not_called()

    def test_preview_keeps_the_baseline_progress_and_its_unadvertised_entry(self):
        a, items = self.a, self.cohort['items']
        implemented = [items[0]['id']]
        advertised, pairs = self.stage_baseline()
        a.d.write(a.d.SOURCE / 'material-resolution.json',
                  [{'source': m, 'instance': m.rsplit('.', 1)[1]} for m in self.cohort['materials']])
        a.d.write(a.WORK / 'geometry-contracts.json', [])
        preview = {'marker': a.MARKER, 'activeUnchanged': True, 'implemented': implemented,
                   'previousAdvertised': a.BASELINE_ADVERTISED, 'previewAdvertised': a.BASELINE_ADVERTISED + 1,
                   'previousAssemblies': a.BASELINE_STRUCTURAL, 'previewAssemblies': a.BASELINE_STRUCTURAL + 1,
                   'unadvertisedStructurallyReady': ['knight-pants']}

        def stage(preview=preview, supported=advertised + implemented, ready=advertised + ['knight-pants'] + implemented,
                  preview_pairs=pairs):
            a.d.write(a.PREVIEW / 'preview.json', preview)
            a.d.write(a.PREVIEW / 'supported-items.json', {'items': supported})
            a.d.write(a.PREVIEW / 'skin-pairs.json', {'items': {pair: {} for pair in preview_pairs}})
            a.d.write(a.WORK / 'resolver' / 'after.json', {'ready': [{'id': i} for i in ready]})

        stage(); a._require_preview()
        for broken in ({'supported': advertised + implemented + ['knight-pants']},
                       {'ready': advertised + implemented},
                       {'preview': {**preview, 'previousAdvertised': a.BASELINE_ADVERTISED - 1}},
                       {'preview': {**preview, 'previewAssemblies': a.BASELINE_STRUCTURAL + 2}},
                       {'preview': {**preview, 'marker': 'shader-probe/prepare-starter-sneakers'}},
                       {'preview': {**preview, 'implemented': ['starter-sneakers-x']}}):
            stage(**broken)
            with self.assertRaises(SystemExit):
                a._require_preview()
        # Catalog progress may grow only by the implemented choices.
        for broken in ({'preview_pairs': pairs[1:]}, {'supported': advertised + implemented + [f'catalog-{a.BASELINE_INDEXED}']}):
            stage(**broken)
            with self.assertRaisesRegex(SystemExit, 'catalog progress'):
                a._require_preview()
        stage()
        self.stage_index(a.d.ACTIVE, advertised, pairs[1:])  # active progress is not the stated baseline
        with self.assertRaisesRegex(SystemExit, 'stated baseline'):
            a._require_preview()
        self.stage_index(a.d.ACTIVE, advertised, pairs)
        a.d.write(a.WORK / 'geometry-contracts.json',
                  [{'itemId': a.d.job_id(items[0]['materials'][0].rsplit('.', 1)[1]), 'blockers': ['uv']}])
        with self.assertRaisesRegex(SystemExit, 'absent UV sets'):
            a._require_preview()


FREEZE_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const m = await import(process.argv.at(-2));
const cohort = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
const rest = cohort.items.slice(1);

// The supplied cohort is accepted; count, slot, mesh and material-list drift fail.
m.assertCohort(cohort);
assert.throws(() => m.assertCohort({...cohort, count: m.EXPECTED_COUNT - 1}), /count/);
assert.throws(() => m.assertCohort({...cohort, meshes: [m.SOURCE_MESH, m.SOURCE_MESH]}), /skeletal mesh/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], slot: 'feet'}, ...rest]}), /slot/);
assert.throws(() => m.assertCohort({...cohort, materials: cohort.materials.slice(1)}), /material list/);

// The mesh report must be hash-current and name the preserved GLB.
const report = {glb: 'g.glb', meshJson: 'm.json', sha256: m.GLB_SHA256, sourceDtoSha256: 'dto', source: m.packageOf(m.SOURCE_MESH),
  sourcePackageSha256: 'pkg', verification: {passed: true}, bones: 23, uvSets: 2, morphs: 2};
const shaOf = glbSha => p => p === 'g.glb' ? glbSha : 'dto';
const inventory = new Set([m.packageOf(m.SOURCE_MESH)]);
m.assertMeshReport(report, inventory, shaOf(m.GLB_SHA256));
assert.throws(() => m.assertMeshReport({...report, sha256: 'ff'}, inventory, shaOf('ff')), /preserved assault-pants conversion/);
assert.throws(() => m.assertMeshReport(report, inventory, shaOf('ff')), /GLB hash does not match/);
assert.throws(() => m.assertMeshReport(report, new Set(), shaOf(m.GLB_SHA256)), /inventory/);
const slot = m.MATERIAL_SLOT;
assert.deepEqual(m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}], materials: [{path: '/Game/M.M'}]}),
  [{slot, material: '/Game/M.M'}]);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'Gloves'}], materials: [{path: '/Game/M.M'}]}), /material slot must be/);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}, {MaterialSlotName: 'Belt'}],
  materials: [{path: '/Game/M.M'}, {path: '/Game/B.B'}]}), /exactly one/);

// Morph targets survive by name, order and count; lost, renamed or dropped targets fail.
const names = ['shrink_a', 'body_a'];
const dto = {lods: [{morphs: names.map(name => ({name}))}]};
const primitive = {attributes: {POSITION: 0}, targets: names.map((_, i) => ({POSITION: i + 1}))};
const glbDoc = {meshes: [{extras: {targetNames: names}, primitives: [primitive]}]};
assert.deepEqual(m.morphNamesFromDto(dto), names);
m.assertGlbMorphs(glbDoc, names, report);
m.assertGlbMorphs(glbDoc, names, {...report, morphs: names});
assert.throws(() => m.morphNamesFromDto({lods: [{morphs: [{name: 'a'}, {name: 'a'}]}]}), /not unique/);
assert.throws(() => m.assertGlbMorphs(glbDoc, names, {...report, morphs: 1}), /morph count/);
assert.throws(() => m.assertGlbMorphs({meshes: [{primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: ['shrink_a', 'renamed']}, primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: names}, primitives: [{...primitive, targets: primitive.targets.slice(1)}]}]}, names, report), /primitive morph targets/);
const buffer = (doc => { const json = Buffer.from(JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4));
  const head = Buffer.alloc(20); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length, 8);
  head.writeUInt32LE(json.length, 12); head.write('JSON', 16, 'latin1'); return Buffer.concat([head, json]); })(glbDoc);
assert.deepEqual(m.glbDocument(buffer), glbDoc);
assert.throws(() => m.glbDocument(Buffer.from('not a glb at all, padded')), /binary glTF/);

// Active baseline: advertised assemblies and catalog choices indexed by an assembly or skin pair.
const catalog = Array.from({length: m.CATALOG_ITEMS}, (_, i) => ({id: `c${i}`}));
const supported = {items: catalog.slice(0, m.BASELINE_ADVERTISED).map(item => item.id)};
const skinPairs = {items: Object.fromEntries(catalog.slice(m.BASELINE_ADVERTISED - 1, m.BASELINE_INDEXED).map(item => [item.id, {}]))};
m.assertBaseline(m.baselineCounts(supported, skinPairs, catalog));
assert.throws(() => m.assertBaseline(m.baselineCounts({items: [...supported.items, 'not-in-catalog']}, skinPairs, catalog)), /stated baseline/);
assert.throws(() => m.assertBaseline(m.baselineCounts(supported, {items: {}}, catalog)), /stated baseline/);
assert.throws(() => m.assertBaseline(m.baselineCounts(supported, skinPairs, catalog.slice(1))), /stated baseline/);

const latest = 'Discovery/Content/Discovery/Characters/Military/Assets/AssaultPants/Skins/Folder_Case/MI_Pants.uasset';
const saved = latest.replace('Folder_Case', 'Folder_CASE');
const other = latest.replace('Folder_Case/MI_Pants', 'Other/MI_Other');
const archive = m.foldedIndex([latest, other]), inventoryIndex = m.foldedIndex(new Set([latest, other]));
const definition = {formatVersion: 1, id: 'x', source: saved, sourceSha256: 'ab', properties: {Slots: ['lowerBody']}};
const current = {status: 'ok', package: {path: latest, sha256: 'ab'},
  exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['lowerBody']}}]};

// A unique case-only difference locates the record; the saved path is not rewritten.
assert.deepEqual(m.resolveDefinitionPackage(definition, archive, inventoryIndex, 'x'), {archive: latest, inventory: latest, exactCase: false});
assert.equal(definition.source, saved);
assert.deepEqual(m.resolveDefinitionPackage({...definition, source: latest}, archive, inventoryIndex, 'x').exactCase, true);
m.assertCurrentDefinition(definition, definition, current);
// The exact package hash and decoded properties are still compared after a case-insensitive match.
assert.throws(() => m.assertCurrentDefinition(definition, definition, {...current, package: {path: latest, sha256: 'AB'}}), /source package changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['feet']}}]}), /source properties changed/);
// Missing, ambiguous (case-only collision, even with one exact spelling; duplicated key) and disagreeing lookups fail.
assert.throws(() => m.resolveDefinitionPackage({...definition, source: saved.replace('MI_Pants', 'MI_Absent')}, archive, inventoryIndex, 'x'), /absent/);
for (const colliding of [m.foldedIndex([latest, saved]), m.foldedIndex([latest, latest])]) {
  assert.throws(() => m.resolveDefinitionPackage(definition, colliding, inventoryIndex, 'x'), /ambiguous/);
  assert.throws(() => m.resolveDefinitionPackage({...definition, source: latest}, archive, colliding, 'x'), /ambiguous/);
}
assert.throws(() => m.resolveDefinitionPackage(definition, archive, m.foldedIndex([latest.toUpperCase()]), 'x'), /disagree/);

// Resolved-part admission: one visible part on the source mesh with the cohort's effective material.
const slots = [{slot, material: '/Game/Default.Default'}];
const part = {sourceIndex: 0, skeletalMesh: m.SOURCE_MESH, staticMesh: '', effect: '', hidden: false, unresolved: [],
  materials: {[slot]: '/Game/M.M'}, definition: {}};
const item = {id: 'x', materials: ['/Game/M.M']};
assert.deepEqual(m.assertResolved(item, definition, {parts: [part], materialParameters: []}, slots), [{slot, material: '/Game/M.M'}]);
for (const bad of [{WrapDeformation: {bIsWrapDeformed: true}}, {LocalScale: {X: 1, Y: 2, Z: 1}}, {LocalPosition: {X: 0, Y: 0, Z: 1}},
                   {LogicModules: [{}]}, {bIsAttached: true}, {OptionalAttachmentMesh: {AssetPathName: '/Game/A.A'}}])
  assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, definition: bad}], materialParameters: []}, slots));
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {}}]}, slots), /effective resolved materials/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {Other: '/Game/M.M'}}]}, slots), /absent slot/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part, {...part, sourceIndex: 1}]}, slots), /one visible part/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, skeletalMesh: m.SOURCE_MESH.replace(/_M\b/g, '_F')}]}, slots), /assault-pants mesh/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, unresolved: ['multi-tag condition 0']}]}, slots), /unresolved/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, effect: '/Game/E.E'}]}, slots), /effects/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part], materialParameters: [{}]}, slots), /material parameters/);
assert.throws(() => m.assertResolved(item, {...definition, properties: {ActivatesMaterialParameters: [{}]}}, {parts: [part]}, slots), /parameter rules/);

// Frozen outputs: identical rerun is a no-op; drift in any target fails before the first write.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.assault-pants-freeze-'));
try {
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  assert.deepEqual(m.writeFrozenSet([[a, {v: 1}]]), [true]);
  assert.deepEqual(m.writeFrozenSet([[a, {v: 1}]]), [false]);
  fs.writeFileSync(b, m.textFor({v: 'old'}));
  assert.throws(() => m.writeFrozenSet([[path.join(dir, 'c.json'), {v: 3}], [b, {v: 'new'}]]), /Preserve existing frozen output/);
  assert.equal(fs.existsSync(path.join(dir, 'c.json')), false);
  assert.equal(fs.readFileSync(b, 'utf8'), m.textFor({v: 'old'}));
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
console.log('freeze contracts ok');
"""


class FreezeContracts(unittest.TestCase):
    def test_cohort_mesh_morphs_baseline_lookup_resolution_and_append_only_writes(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        result = subprocess.run([node, '--input-type=module', '-e', FREEZE_CHECK, FREEZE.as_uri(), str(COHORT)],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('freeze contracts ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
