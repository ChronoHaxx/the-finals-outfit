"""Focused negative contracts for the Starter Set Sneakers adapter and freeze, without game assets.

The adapter is loaded against a stub of prepare-large-sneakers.py (its real dependencies live only in the
complete repository); freeze.mjs validators are pure exports and are exercised through node. The supplied
source-only cohort.json is the only fixture.

  C:/ProgramData/anaconda3/python.exe -B tests/test_starter_sneakers_adapter.py -v
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
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-starter-sneakers.py'
FREEZE = ROOT / '_docs' / 'starter-sneakers-2026-09-15' / 'freeze.mjs'
COHORT = ROOT / '_docs' / 'starter-sneakers-2026-09-15' / 'cohort.json'
MESH = '/Game/Discovery/Characters/StarterSet/Assets/Sneakers/SK_Sneakers_M.SK_Sneakers_M'


class _StubLoader(importlib.abc.Loader):
    def __init__(self, shared):
        self.shared = shared

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__dict__.update(vars(self.shared))


def load_adapter():
    d = types.SimpleNamespace(REUSE_EXPORTS=['stale'], REUSE_TEXTURES=['stale'], MESH_EVIDENCE=['stale'], MARKER='stale')

    def configure(batch, work, runtime, preview):
        d.BATCH, d.WORK, d.RUNTIME, d.PREVIEW, d.SOURCE = Path(batch), Path(work), Path(runtime), Path(preview), Path(work) / 'source'

    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

    d.configure, d.write, d.now = configure, write, lambda: 'now'
    d.read_json = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    d.package_of = lambda o: 'Discovery/Content/' + o.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'
    d.job_id = lambda instance: instance.lower().replace('_', '-')
    configure('_docs/large-sneakers-2026-09-13/batch.json', 'sneakers', 'sneakers-runtime', 'sneakers-preview')
    shared = types.SimpleNamespace(d=d, DOCS=Path('sneakers'), WORK=Path('sneakers'), RUNTIME=Path('sneakers'),
                                   PREVIEW=Path('sneakers'), MESH_REPORT=Path('sneakers'), progress=None,
                                   audit_blocked=lambda: {}, extract=object(), plan=object())
    d.extract, d.plan = shared.extract, shared.plan
    real = importlib.util.spec_from_file_location

    def fake(name, location, *args, **kwargs):
        if name == 'prepare_large_sneakers':
            return importlib.machinery.ModuleSpec(name, _StubLoader(shared))
        return real(name, location, *args, **kwargs)

    spec = real('prepare_starter_sneakers', ADAPTER)
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

    def test_every_shared_global_is_repointed(self):
        a = self.a
        self.assertEqual((a.d.WORK, a.d.SOURCE, a.d.MARKER), (a.WORK, a.WORK / 'source', a.MARKER))
        self.assertEqual((a.d.REUSE_EXPORTS, a.d.REUSE_TEXTURES, a.d.MESH_EVIDENCE), ([], [], []))
        self.assertEqual(a.MARKER, 'shader-probe/prepare-starter-sneakers')
        a._require_configuration()
        a.progress('probe', value=1)
        self.assertEqual(a.d.read_json(a.WORK / 'progress.json')['marker'], a.MARKER)
        a.d.REUSE_TEXTURES = [Path('scripts/generated/shader-probe/accessory-source-v1/opus-textures-01')]
        with self.assertRaises(SystemExit):
            a._require_configuration()
        a.d.REUSE_TEXTURES, a.d.MARKER = [], 'shader-probe/prepare-racing-gloves'
        with self.assertRaises(SystemExit):
            a._require_configuration()

    def test_supplied_cohort_is_accepted_and_drift_rejected(self):
        a, cohort = self.a, self.cohort
        self.assertEqual(len(a._require_cohort()['items']), 17)
        first, rest = cohort['items'][0], cohort['items'][1:]
        for broken in ({**cohort, 'count': 16}, {**cohort, 'items': rest},
                       {**cohort, 'meshes': [MESH.replace('Sneakers_M', 'Sneakers_F')]},
                       {**cohort, 'items': [{**first, 'slot': 'hands'}, *rest]},
                       {**cohort, 'items': [{**first, 'materials': first['materials'] * 2}, *rest]},
                       {**cohort, 'items': [first, first, *rest[1:]]},
                       {**cohort, 'materials': cohort['materials'][1:]}):
            a.d.write(a.DOCS / 'cohort.json', broken)
            with self.assertRaises(SystemExit):
                a._require_cohort()

    def test_mesh_stage_never_converts_again(self):
        a = self.a
        a.s.mesh = mock.Mock()
        with self.assertRaisesRegex(SystemExit, 'restore'):
            a.mesh()
        a.s.mesh.assert_not_called()

    def test_report_must_name_the_preserved_glb(self):
        a = self.a
        a.d.file_sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
        other, dto = a.WORK / 'meshes' / 'SK_Sneakers_M.glb', Path('SK_Sneakers_M.mesh.json')
        other.parent.mkdir(parents=True); other.write_bytes(glb({'meshes': []})); dto.write_text('{}')
        a.d.write(a.MESH_REPORT, {'glb': other.as_posix(), 'meshJson': dto.as_posix(), 'file': other.name,
                                  'sha256': a.d.file_sha(other), 'sourceDtoSha256': a.d.file_sha(dto),
                                  'sourcePackageSha256': 'ab'})
        with self.assertRaisesRegex(SystemExit, 'preserved starter-sneaker conversion'):
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
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(MESH.replace('Sneakers_M', 'Sneakers_F'))])
        with self.assertRaises(SystemExit):
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(MESH)])
        self.assertTrue(a._require_mesh_request())
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 1})
        with self.assertRaises(SystemExit):
            a._require_mesh_request()

    def test_glb_must_keep_exactly_the_original_uv_sets_and_skinning(self):
        a = self.a
        # Two original UV sets and no morph targets: absent morph targets are valid and not required.
        attributes = {'POSITION': 0, 'TEXCOORD_0': 1, 'TEXCOORD_1': 2, 'JOINTS_0': 3, 'WEIGHTS_0': 4}
        document = {'meshes': [{'primitives': [{'attributes': attributes}]}], 'skins': [{'joints': [0], 'inverseBindMatrices': 5}]}
        path = Path('mesh.glb')
        report = {'glb': path.as_posix(), 'uvSets': 2, 'bones': 23, 'morphs': 0}
        path.write_bytes(glb(document)); a._require_glb_geometry(report)
        for broken_report in ({**report, 'uvSets': 1}, {**report, 'uvSets': 0}, {**report, 'bones': 0}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(broken_report)
        for broken in ({**attributes, 'TEXCOORD_2': 6}, {k: v for k, v in attributes.items() if k != 'TEXCOORD_1'},
                       {k: v for k, v in attributes.items() if k != 'JOINTS_0'}):
            path.write_bytes(glb({**document, 'meshes': [{'primitives': [{'attributes': broken}]}]}))
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report)
        path.write_bytes(glb({**document, 'skins': []}))
        with self.assertRaises(SystemExit):
            a._require_glb_geometry(report)

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
        a.d.file_sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
        a.d.write(run, {'at': '2026-09-15T10:00:00Z', 'result': 'passed'})
        first = a._preserve_gpu_run(run)
        self.assertEqual(a._preserve_gpu_run(run), first)
        first.write_text('{"tampered": true}\n')
        with self.assertRaises(SystemExit):
            a._preserve_gpu_run(run)

    def test_preview_keeps_the_baseline_and_its_unadvertised_entry(self):
        a, items = self.a, self.cohort['items']
        implemented = [items[0]['id']]
        advertised = [f'active-{i}' for i in range(426)]
        a.d.write(a.d.SOURCE / 'material-resolution.json',
                  [{'source': m, 'instance': m.rsplit('.', 1)[1]} for m in self.cohort['materials']])
        a.d.write(a.WORK / 'geometry-contracts.json', [])
        preview = {'marker': a.MARKER, 'activeUnchanged': True, 'implemented': implemented,
                   'previousAdvertised': 426, 'previewAdvertised': 427, 'previousAssemblies': 427,
                   'previewAssemblies': 428, 'unadvertisedStructurallyReady': ['unadvertised-pants']}

        def stage(preview=preview, supported=advertised + implemented,
                  ready=advertised + ['unadvertised-pants'] + implemented):
            a.d.write(a.PREVIEW / 'preview.json', preview)
            a.d.write(a.PREVIEW / 'supported-items.json', {'items': supported})
            a.d.write(a.WORK / 'resolver' / 'after.json', {'ready': [{'id': i} for i in ready]})

        stage(); a._require_preview()
        for broken in ({'supported': advertised + implemented + ['unadvertised-pants']},
                       {'ready': advertised + implemented},
                       {'preview': {**preview, 'previousAdvertised': 425}},
                       {'preview': {**preview, 'previewAssemblies': 429}},
                       {'preview': {**preview, 'marker': 'shader-probe/prepare-racing-gloves'}},
                       {'preview': {**preview, 'implemented': ['racing-gloves-x']}}):
            stage(**broken)
            with self.assertRaises(SystemExit):
                a._require_preview()
        stage()
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

// The supplied cohort is accepted; count, slot, mesh and material-list drift fail.
m.assertCohort(cohort);
assert.throws(() => m.assertCohort({...cohort, count: 16}), /count/);
assert.throws(() => m.assertCohort({...cohort, meshes: [m.SOURCE_MESH, m.SOURCE_MESH]}), /skeletal mesh/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], slot: 'hands'}, ...cohort.items.slice(1)]}), /feet slot/);
assert.throws(() => m.assertCohort({...cohort, materials: cohort.materials.slice(1)}), /material list/);

// The mesh report must be hash-current and name the preserved GLB; no morph targets are required.
const report = {glb: 'g.glb', meshJson: 'm.json', sha256: m.GLB_SHA256, sourceDtoSha256: 'dto', source: m.packageOf(m.SOURCE_MESH),
  sourcePackageSha256: 'pkg', verification: {passed: true}, bones: 23, uvSets: 2, morphs: 0};
const shaOf = glbSha => p => p === 'g.glb' ? glbSha : 'dto';
const inventory = new Set([m.packageOf(m.SOURCE_MESH)]);
m.assertMeshReport(report, inventory, shaOf(m.GLB_SHA256));
assert.throws(() => m.assertMeshReport({...report, sha256: 'ff'}, inventory, shaOf('ff')), /preserved starter-sneaker conversion/);
assert.throws(() => m.assertMeshReport(report, inventory, shaOf('ff')), /GLB hash does not match/);
assert.throws(() => m.assertMeshReport(report, new Set(), shaOf(m.GLB_SHA256)), /inventory/);
assert.deepEqual(m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'Sneakers'}], materials: [{path: '/Game/M.M'}]}),
  [{slot: 'Sneakers', material: '/Game/M.M'}]);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'Gloves'}], materials: [{path: '/Game/M.M'}]}), /Sneakers/);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'Sneakers'}, {MaterialSlotName: 'Laces'}],
  materials: [{path: '/Game/M.M'}, {path: '/Game/L.L'}]}), /exactly one/);

const latest = 'Discovery/Content/Discovery/Characters/StarterSet/Assets/Sneakers/Skins/Folder_Case/MI_Sneakers.uasset';
const saved = latest.replace('Folder_Case', 'Folder_CASE');
const other = latest.replace('Folder_Case/MI_Sneakers', 'Other/MI_Other');
const archive = m.foldedIndex([latest, other]), inventoryIndex = m.foldedIndex(new Set([latest, other]));
const definition = {formatVersion: 1, id: 'x', source: saved, sourceSha256: 'ab', properties: {Slots: ['feet']}};
const current = {status: 'ok', package: {path: latest, sha256: 'ab'},
  exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['feet']}}]};

// A unique case-only difference locates the record; the saved path is not rewritten.
assert.deepEqual(m.resolveDefinitionPackage(definition, archive, inventoryIndex, 'x'), {archive: latest, inventory: latest, exactCase: false});
assert.equal(definition.source, saved);
assert.deepEqual(m.resolveDefinitionPackage({...definition, source: latest}, archive, inventoryIndex, 'x').exactCase, true);
m.assertCurrentDefinition(definition, definition, current);
// The exact package hash and decoded properties are still compared after a case-insensitive match.
assert.throws(() => m.assertCurrentDefinition(definition, definition, {...current, package: {path: latest, sha256: 'AB'}}), /source package changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['hands']}}]}), /source properties changed/);
// Missing, ambiguous (case-only collision, even with one exact spelling; duplicated key) and disagreeing lookups fail.
assert.throws(() => m.resolveDefinitionPackage({...definition, source: saved.replace('MI_Sneakers', 'MI_Absent')}, archive, inventoryIndex, 'x'), /absent/);
for (const colliding of [m.foldedIndex([latest, saved]), m.foldedIndex([latest, latest])]) {
  assert.throws(() => m.resolveDefinitionPackage(definition, colliding, inventoryIndex, 'x'), /ambiguous/);
  assert.throws(() => m.resolveDefinitionPackage({...definition, source: latest}, archive, colliding, 'x'), /ambiguous/);
}
assert.throws(() => m.resolveDefinitionPackage(definition, archive, m.foldedIndex([latest.toUpperCase()]), 'x'), /disagree/);

// Resolved-part admission: one visible Sneakers part on the source mesh with the cohort's effective material.
const slots = [{slot: 'Sneakers', material: '/Game/Default.Default'}];
const part = {sourceIndex: 0, skeletalMesh: m.SOURCE_MESH, staticMesh: '', effect: '', hidden: false, unresolved: [],
  materials: {Sneakers: '/Game/M.M'}, definition: {}};
const item = {id: 'x', materials: ['/Game/M.M']};
assert.deepEqual(m.assertResolved(item, definition, {parts: [part], materialParameters: []}, slots), [{slot: 'Sneakers', material: '/Game/M.M'}]);
for (const bad of [{WrapDeformation: {bIsWrapDeformed: true}}, {LocalScale: {X: 1, Y: 2, Z: 1}}, {LocalPosition: {X: 0, Y: 0, Z: 1}},
                   {LogicModules: [{}]}, {bIsAttached: true}, {OptionalAttachmentMesh: {AssetPathName: '/Game/A.A'}}])
  assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, definition: bad}], materialParameters: []}, slots));
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {}}]}, slots), /effective resolved materials/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {Other: '/Game/M.M'}}]}, slots), /absent slot/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part, {...part, sourceIndex: 1}]}, slots), /one visible part/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, skeletalMesh: m.SOURCE_MESH.replace(/_M\b/g, '_F')}]}, slots), /starter-sneaker mesh/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, unresolved: ['multi-tag condition 0']}]}, slots), /unresolved/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, effect: '/Game/E.E'}]}, slots), /effects/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part], materialParameters: [{}]}, slots), /material parameters/);

// Frozen outputs: identical rerun is a no-op; drift in any target fails before the first write.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.starter-sneakers-freeze-'));
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
    def test_cohort_mesh_lookup_resolution_and_append_only_writes(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        result = subprocess.run([node, '--input-type=module', '-e', FREEZE_CHECK, FREEZE.as_uri(), str(COHORT)],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('freeze contracts ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
