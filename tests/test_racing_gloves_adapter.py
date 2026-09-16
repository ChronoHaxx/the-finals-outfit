"""Focused negative contracts for the Racing Gloves adapter and freeze, without game assets.

The adapter is loaded against a stub of prepare-large-sneakers.py (its real dependencies live only in the
complete repository); freeze.mjs validators are pure exports and are exercised through node.

  C:/ProgramData/anaconda3/python.exe -m unittest tests/test_racing_gloves_adapter.py
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
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-racing-gloves.py'
FREEZE = ROOT / '_docs' / 'racing-gloves-2026-09-14' / 'freeze.mjs'
MESH = '/Game/Discovery/Characters/Racing/Assets/Gloves/SK_Racing_Gloves_M.SK_Racing_Gloves_M'


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

    spec = real('prepare_racing_gloves', ADAPTER)
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

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_shared_global_is_repointed(self):
        a = self.a
        self.assertEqual((a.d.WORK, a.d.SOURCE, a.d.MARKER), (a.WORK, a.WORK / 'source', a.MARKER))
        self.assertEqual((a.d.REUSE_EXPORTS, a.d.REUSE_TEXTURES, a.d.MESH_EVIDENCE), ([], [], []))
        a._require_configuration()
        a.d.REUSE_TEXTURES = [Path('scripts/generated/shader-probe/accessory-source-v1/opus-textures-01')]
        with self.assertRaises(SystemExit):
            a._require_configuration()

    def test_extracted_mesh_folder_is_reused_only_for_its_exact_request(self):
        a = self.a
        self.assertFalse(a._require_mesh_request())
        folder = a.d.SOURCE / 'meshes-01'
        folder.mkdir(parents=True)
        (folder / 'assets.json').write_text('[]')
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 0})
        with self.assertRaises(SystemExit):  # no request manifest
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(MESH.replace('Racing_Gloves', 'Racing_Boots'))])
        with self.assertRaises(SystemExit):
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(MESH)])
        self.assertTrue(a._require_mesh_request())
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 1})
        with self.assertRaises(SystemExit):
            a._require_mesh_request()

    def test_glb_must_keep_exactly_the_original_uv_sets_and_skinning(self):
        a = self.a
        attributes = {'POSITION': 0, 'TEXCOORD_0': 1, 'TEXCOORD_1': 2, 'JOINTS_0': 3, 'WEIGHTS_0': 4}
        document = {'meshes': [{'primitives': [{'attributes': attributes}]}], 'skins': [{'joints': [0], 'inverseBindMatrices': 5}]}
        path = Path('mesh.glb')
        report = {'glb': path.as_posix(), 'uvSets': 2, 'bones': 55}
        path.write_bytes(glb(document)); a._require_glb_geometry(report)
        for broken_report in ({**report, 'uvSets': 3}, {**report, 'uvSets': 0}, {**report, 'bones': 0}):
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
        a._require_mesh_contract = lambda: ({'uvSets': 1}, [])
        a.d.write(a.WORK / 'validation' / 'passed.requests.json', [{'id': 'mi-one'}, {'id': 'mi-two'}])
        a.d.write(a.RUNTIME / 'staging' / 'mi-one.json', {'requiredUvSets': [0]})
        a.d.write(a.RUNTIME / 'staging' / 'mi-two.json', {})  # absent requirement keeps the [0, 1] default
        self.assertEqual(list(a.geometry_blocked()), ['mi-two'])

    def test_gpu_evidence_is_never_replaced(self):
        a = self.a
        run = a.WORK / 'validation' / 'webgl-run.json'
        a.d.file_sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
        a.d.write(run, {'at': '2026-09-14T10:00:00Z', 'result': 'passed'})
        first = a._preserve_gpu_run(run)
        self.assertEqual(a._preserve_gpu_run(run), first)
        first.write_text('{"tampered": true}\n')
        with self.assertRaises(SystemExit):
            a._preserve_gpu_run(run)


LOOKUP_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const m = await import(process.argv.at(-1));
const latest = 'Discovery/Content/Discovery/Characters/Racing/Assets/Gloves/Skins/Folder_Case/CI_Glove.uasset';
const saved = latest.replace('Folder_Case', 'Folder_CASE');
const other = latest.replace('Folder_Case/CI_Glove', 'Other/CI_Other');
const archive = m.foldedIndex([latest, other]), inventory = m.foldedIndex(new Set([latest, other]));
const definition = {formatVersion: 1, id: 'x', source: saved, sourceSha256: 'ab', properties: {Slots: ['hands']}};
const current = {status: 'ok', package: {path: latest, sha256: 'ab'},
  exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['hands']}}]};

// A unique case-only difference locates the record; the saved path is not rewritten.
assert.deepEqual(m.resolveDefinitionPackage(definition, archive, inventory, 'x'), {archive: latest, inventory: latest, exactCase: false});
assert.equal(definition.source, saved);
assert.deepEqual(m.resolveDefinitionPackage({...definition, source: latest}, archive, inventory, 'x').exactCase, true);
m.assertCurrentDefinition(definition, definition, current);
// The exact package hash and decoded properties are still compared after a case-insensitive match.
assert.throws(() => m.assertCurrentDefinition(definition, definition, {...current, package: {path: latest, sha256: 'AB'}}), /source package changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['head']}}]}), /source properties changed/);
// Missing, ambiguous (case-only collision, even with one exact spelling; duplicated key) and disagreeing lookups fail.
assert.throws(() => m.resolveDefinitionPackage({...definition, source: saved.replace('CI_Glove', 'CI_Absent')}, archive, inventory, 'x'), /absent/);
for (const colliding of [m.foldedIndex([latest, saved]), m.foldedIndex([latest, latest])]) {
  assert.throws(() => m.resolveDefinitionPackage(definition, colliding, inventory, 'x'), /ambiguous/);
  assert.throws(() => m.resolveDefinitionPackage({...definition, source: latest}, archive, colliding, 'x'), /ambiguous/);
}
assert.throws(() => m.resolveDefinitionPackage(definition, archive, m.foldedIndex([latest.toUpperCase()]), 'x'), /disagree/);

// Resolved-part admission rejects wrap deformation and nonidentity transforms.
const slots = [{slot: 'Gloves', material: '/Game/M.M'}];
const part = {sourceIndex: 0, skeletalMesh: m.SOURCE_MESH, staticMesh: '', effect: '', hidden: false, unresolved: [], materials: {}, definition: {}};
const item = {id: 'x', materials: ['/Game/M.M']};
m.assertResolved(item, definition, {parts: [part], materialParameters: []}, slots);
for (const bad of [{WrapDeformation: {bIsWrapDeformed: true}}, {LocalScale: {X: 1, Y: 2, Z: 1}}, {LogicModules: [{}]}, {bIsAttached: true}])
  assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, definition: bad}], materialParameters: []}, slots));
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {Other: '/Game/M.M'}}]}, slots), /absent slot/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part, {...part, sourceIndex: 1}]}, slots), /one visible part/);

// Frozen outputs: identical rerun is a no-op; drift in any target fails before the first write.
const dir = fs.mkdtempSync(path.join(process.cwd(), '.racing-freeze-'));
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
    def test_package_lookup_resolution_and_append_only_writes(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        result = subprocess.run([node, '--input-type=module', '-e', LOOKUP_CHECK, FREEZE.as_uri()],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('freeze contracts ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
