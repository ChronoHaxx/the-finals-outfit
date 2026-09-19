"""Consequential contracts for the manifest-driven family runner, without game assets or project dependencies.

prepare-family.py runs against a fresh stub of the legacy Large Sneakers stages per configuration; freeze-family.mjs
exports are exercised through node. Two synthetic families differ in mesh slot, item slot, morphs, tags and count.

  python -B tests/test_family_runner.py -v
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts' / 'shader-probe' / 'prepare-family.py'
FREEZE = ROOT / 'scripts' / 'shader-probe' / 'freeze-family.mjs'
DOC = ROOT / 'scripts' / 'shader-probe' / 'family-runner.md'
spec = importlib.util.spec_from_file_location('prepare_family', RUNNER)
pf = importlib.util.module_from_spec(spec); spec.loader.exec_module(pf)
NODE = shutil.which('node')


def example_manifest():
    return json.loads(re.search(r'```json\n(.*?)```', DOC.read_text(encoding='utf-8'), re.S).group(1))


def stub_legacy(tag):
    """A fresh stand-in for prepare-large-sneakers.py and its accessory-default helpers, left configured elsewhere."""
    def read_json(path):
        if not isinstance(path, Path):
            raise TypeError(f'read_json needs a Path: {path!r}')
        return json.loads(path.read_text(encoding='utf-8'))

    def write(path, value):
        if not isinstance(path, Path):
            raise TypeError(f'write needs a Path: {path!r}')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

    def configure(batch, work, runtime, preview):
        d.BATCH, d.WORK, d.RUNTIME, d.PREVIEW, d.SOURCE = Path(batch), Path(work), Path(runtime), Path(preview), Path(work) / 'source'

    def object_path(value):
        stem = value.removeprefix('Discovery/Content/').removesuffix('.uasset')
        return '/Game/' + stem + '.' + stem.rsplit('/', 1)[-1] if value.startswith('Discovery/Content/') else value

    d = types.SimpleNamespace(read_json=read_json, write=write, configure=configure, now=lambda: 'now', MARKER='stale',
                              REUSE_EXPORTS=['stale'], REUSE_TEXTURES=['stale'], MESH_EVIDENCE=['stale'],
                              ACTIVE=Path('stale'), CATALOG=Path('stale'), SOURCE_INDEX=Path('stale'),
                              file_sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest(),
                              package_of=lambda o: 'Discovery/Content/' + o.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset',
                              job_id=lambda i: i.lower().replace('_', '-'),
                              assembly_index=types.SimpleNamespace(object_path=object_path),
                              mesh_verifier=types.SimpleNamespace(verify=lambda dto, glb: {'passed': True}),
                              build_identity=lambda folder: read_json(folder / 'source-run.json'))
    d.dto_slots = lambda folder, record: [{'slot': n['MaterialSlotName'], 'material': m['path']} for n, m in
                                          zip(*(lambda dto: (dto['sourceMaterials'], dto['materials']))(read_json(folder / record['meshFile'])))]
    d.glb_slots = lambda p: [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
                             for m in glb_json(Path(p))['materials']]
    configure('_docs/previous/batch.json', 'previous', 'previous-runtime', 'previous-preview')
    return types.SimpleNamespace(d=d, DOCS=Path('previous'), WORK=Path('previous'), RUNTIME=Path('previous'), PREVIEW=Path('previous'),
                                 MESH_REPORT=Path('previous'), progress=None, audit_blocked=lambda: {}, extract=object(), plan=object(),
                                 build=mock.Mock(), index=mock.Mock(), derive_coverage=mock.Mock())


def glb(document):
    data = json.dumps(document).encode()
    data += b' ' * (-len(data) % 4)
    return b'glTF' + (2).to_bytes(4, 'little') + (20 + len(data)).to_bytes(4, 'little') + len(data).to_bytes(4, 'little') + b'JSON' + data


def glb_json(path):
    data = path.read_bytes()
    return json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')])


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def manifest_for(name, slot, item_slot, morphs, tags, sha, mode='derived'):
    return {'id': name, 'schemaVersion': 1, 'fittingTags': tags, 'coverage': {'mode': mode},
            'paths': {'docs': f'_docs/{name}', 'work': f'scripts/generated/shader-probe/{name}', 'runtime': f'public/models/{name}-v1',
                      'preview': f'public/models/{name}-preview-v1', 'active': 'public/models/active', 'sourceIndex': 'public/models/source',
                      'catalog': 'src/data/items.json', 'resolver': 'src/rig/SourceAssembly.ts',
                      'refresh': 'scripts/generated/shader-probe/refresh', 'appUrl': 'http://127.0.0.1:4321/'},
            'mesh': {'source': f'/Game/Fam/{name}/SK_{slot.replace(" ", "")}.SK_{slot.replace(" ", "")}', 'slot': slot, 'itemSlot': item_slot, 'sha256': sha,
                     'facts': {'vertices': 10, 'triangles': 8, 'uvSets': 2, 'bones': 3, 'materialSections': 1}, 'morphNames': morphs}}


def stage_family(name, slot, item_slot, morphs, tags, count, mode='derived'):
    """A complete synthetic evidence set: mesh handoff, freeze outputs, source build, geometry, GPU run and preview."""
    work, docs = Path(f'scripts/generated/shader-probe/{name}'), Path(f'_docs/{name}')
    source = work / 'source' / 'meshes-01'
    stem = 'SK_' + slot.replace(' ', '')
    mesh = f'/Game/Fam/{name}/{stem}.{stem}'
    package = 'Discovery/Content/' + mesh.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'
    default = f'/Game/Fam/{name}/M_Default.M_Default'
    write(source / 'SK.mesh.json', {'source': package, 'sourceMaterials': [{'MaterialSlotName': slot}], 'materials': [{'path': default}],
                                    'lods': [{'morphs': [{'name': n} for n in morphs]}]})
    write(source / 'assets.json', [{'path': package, 'sha256': 'pkg', 'meshFile': 'SK.mesh.json', 'exports': [{'type': 'SkeletalMesh'}]}])
    write(source / 'source-run.json', {'build': 'b1'})
    write(work / 'source' / 'meshes-01.requests.json', [package])
    write(work / 'source' / 'meshes-01.run.json', {'exitCode': 0})
    doc = {'materials': [{'extras': {'sourceSlot': {'MaterialSlotName': slot}, 'sourceMaterial': default}}],
           'meshes': [{'extras': {'targetNames': morphs}, 'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1, 'TEXCOORD_1': 2, 'JOINTS_0': 3, 'WEIGHTS_0': 4},
                                                                       'targets': [{'POSITION': 9} for _ in morphs]}]}],
           'nodes': [{'mesh': 0, 'skin': 0}], 'skins': [{'joints': [0, 1, 2], 'inverseBindMatrices': 5}]}
    (work / 'meshes').mkdir(parents=True, exist_ok=True)
    (work / 'meshes' / 'SK.glb').write_bytes(glb(doc))
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    report = {'source': package, 'glb': (work / 'meshes' / 'SK.glb').as_posix(), 'meshJson': (source / 'SK.mesh.json').as_posix(),
              'file': 'SK.glb', 'sha256': sha(work / 'meshes' / 'SK.glb'), 'sourceDtoSha256': sha(source / 'SK.mesh.json'),
              'sourcePackageSha256': 'pkg', 'verification': {'passed': True}, 'vertices': 10, 'triangles': 8, 'uvSets': 2,
              'bones': 3, 'materialSections': 1, 'morphs': len(morphs)}
    write(docs / 'mesh-report.json', report)
    manifest = manifest_for(name, slot, item_slot, morphs, tags, report['sha256'], mode)
    write(f'manifests/{name}.json', manifest)
    items = [{'id': f'{name}-{i}', 'name': f'{name} {i}', 'slot': item_slot, 'materials': [f'/Game/Fam/{name}/MI_{name}{i}.MI_{name}{i}']}
             for i in range(count)]
    cohort = {'meshes': [mesh], 'count': count, 'items': items, 'materials': [i['materials'][0] for i in items]}
    write(docs / 'cohort.json', cohort)
    return manifest, cohort, report


def write_active(*families):
    write('public/models/active/supported-items.json', {'items': ['c0', 'c1']})
    write('public/models/active/skin-pairs.json', {'items': {'c2': {}}})
    write('public/models/active/assets.json', {'meshes': {'/Game/Other/SK_O.SK_O': {'bodyMaskUrl': 'm.png', 'coverageSource': 'derived'}}, 'materials': {}})
    write('src/data/items.json', [{'id': f'c{i}'} for i in range(4)] + [{'id': i['id']} for m in families for i in m[1]['items']])


def freeze_family(fam, cohort, report):
    """What freeze-family.mjs and the later stages leave behind for one family (synthetic, no real GPU)."""
    d, rows = fam.d, []
    for item in cohort['items']:
        path = fam.SOURCE_INDEX / 'items' / (item['id'] + '.json')
        definition = {'formatVersion': 1, 'id': item['id'], 'source': 'x', 'sourceSha256': 'ab',
                      'properties': {'ActivatesTags': list(reversed(fam.FITTING_TAGS))} if fam.FITTING_TAGS else {}}
        write(path, definition)
        rows.append({**item, 'definition': definition, 'definitionFileSha256': d.file_sha(path), 'fittingTags': sorted(fam.FITTING_TAGS),
                     'effectiveParts': [{'sourceIndex': 0, 'mesh': fam.SOURCE_MESH, 'slots': [{'slot': fam.MATERIAL_SLOT, 'material': item['materials'][0]}]}]})
    slots = d.dto_slots(d.SOURCE / 'meshes-01', d.read_json(d.SOURCE / 'meshes-01' / 'assets.json')[0])
    write(fam.DOCS / 'resolved-cohort.json', {**cohort, 'manifestSha256': fam.sha, 'context': pf.CONTEXT, 'items': rows,
                                              'meshReport': report, 'sourceSlots': slots})
    write(fam.DOCS / 'batch.json', {'cohort': (fam.DOCS / 'resolved-cohort.json').as_posix(), 'ids': [i['id'] for i in rows], 'manifestSha256': fam.sha})
    write(fam.DOCS / 'adapter-baseline.json', {'manifestSha256': fam.sha, 'hashes': fam._active_hashes(), 'unadvertisedStructurallyReady': ['c3'],
                                               'counts': {'advertised': 2, 'indexed': 3, 'catalog': len(d.read_json(fam.CATALOG)), 'structural': 3}})
    write(d.SOURCE / 'working-01' / 'working-export.json', {'buildIdentity': {'build': 'b1'}})
    write(fam.WORK / 'source-ready.json', {'buildIdentity': {'build': 'b1'}, 'batch': (fam.DOCS / 'batch.json').as_posix(), 'marker': fam.MARKER + '/source'})
    first = cohort['items'][0]
    instance = first['materials'][0].rsplit('.', 1)[1]
    write(d.SOURCE / 'material-resolution.json', [{'source': first['materials'][0], 'instance': instance}])
    write(fam.WORK / 'validation' / 'passed.requests.json', [{'id': d.job_id(instance)}])
    write(fam.RUNTIME / 'staging' / (d.job_id(instance) + '.json'), {'requiredUvSets': [0, 1]})
    for path in (fam.RUNTIME / 'staging' / 'build-report.json', fam.WORK / 'requests.json', fam.WORK / 'surface-audit.json'):
        write(path, [])
    write(fam.WORK / 'geometry-contracts.json', fam.geometry_records())
    run = fam.WORK / 'validation' / 'webgl-run.json'
    write(run, {'at': '2026-09-16T12:00:00Z', 'result': 'passed', 'family': fam.m['id']})
    archived = fam._preserve_gpu_run(run)
    fam.progress('gpu', evidence=archived.as_posix(), evidenceSha256=d.file_sha(archived), build=fam._build_hashes())
    implemented = [first['id']]
    write(fam.PREVIEW / 'preview.json', {'marker': fam.MARKER, 'activeUnchanged': True, 'implemented': implemented, 'coverageReady': False,
                                         'previousAdvertised': 2, 'previewAdvertised': 3, 'previousAssemblies': 3, 'previewAssemblies': 4,
                                         'unadvertisedStructurallyReady': ['c3']})
    write(fam.PREVIEW / 'supported-items.json', {'items': ['c0', 'c1', *implemented]})
    write(fam.PREVIEW / 'skin-pairs.json', {'items': {'c2': {}}})
    write(fam.PREVIEW / 'assets.json', d.read_json(fam.ACTIVE / 'assets.json'))
    write(fam.WORK / 'resolver' / 'before.json', {'ready': [{'id': i} for i in ('c0', 'c1', 'c3')]})
    write(fam.WORK / 'resolver' / 'after.json', {'ready': [{'id': i} for i in ('c0', 'c1', 'c3', *implemented)]})


class Runner(unittest.TestCase):
    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.mkdtemp()
        os.chdir(self.tmp)
        a = stage_family('glove-a', 'Gloves', 'hands', ['medium_male', 'medium_female'], ['Customization.HideMesh.NailsCovered'], 3)
        b = stage_family('boot-b', 'Boots Main', 'feet', ['shrink_boots'], [], 5)
        write_active(a, b)
        self.a, self.b = (pf.Family(f'manifests/{name}.json', legacy=stub_legacy) for name in ('glove-a', 'boot-b'))
        freeze_family(self.a, a[1], a[2])
        freeze_family(self.b, b[1], b[2])

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_two_configurations_do_not_contaminate_and_stale_configuration_fails(self):
        a, b = self.a, self.b
        self.assertIsNot(a.d, b.d)
        for fam, cohort_size in ((a, 3), (b, 5)):
            fam._require_downstream()
            self.assertEqual(len(fam.d.read_json(fam.DOCS / 'batch.json')['ids']), cohort_size)
            self.assertEqual((fam.d.REUSE_EXPORTS, fam.d.MARKER), ([], f'shader-probe/prepare-family/{fam.m["id"]}'))
        a.d.WORK = b.WORK
        with self.assertRaisesRegex(SystemExit, 'not configured'):
            a._require_downstream()
        b.s.progress = a.progress
        with self.assertRaisesRegex(SystemExit, 'stage hooks'):
            b._require_configuration()
        b.s.progress = b._hooks['progress']
        manifest = json.loads(Path('manifests/boot-b.json').read_text())
        write('manifests/boot-b.json', {**manifest, 'fittingTags': ['Customization.Shape.PushInsideClothes.push_boots']})
        with self.assertRaisesRegex(SystemExit, 'manifest changed'):
            b._require_configuration()
        # A second family's evidence never satisfies the first: its batch carries another manifest hash.
        shutil.copyfile(b.DOCS / 'batch.json', a.DOCS / 'batch.json')
        a.d.WORK = a.WORK
        with self.assertRaisesRegex(SystemExit, 'different manifest'):
            a._require_downstream()

    def test_geometry_and_source_identity_negatives(self):
        a, d = self.a, self.a.d
        dto_path = d.SOURCE / 'meshes-01' / 'SK.mesh.json'
        dto = d.read_json(dto_path)
        report = d.read_json(a.MESH_REPORT)
        write(dto_path, {**dto, 'lods': [{'morphs': [{'name': 'medium_female'}, {'name': 'medium_male'}]}]})
        write(a.MESH_REPORT, {**report, 'sourceDtoSha256': d.file_sha(dto_path)})
        with self.assertRaisesRegex(SystemExit, 'not the original'):
            a._require_mesh_contract()
        write(dto_path, dto)
        write(a.MESH_REPORT, {**report, 'source': 'Discovery/Content/Fam/other/SK_Gloves.uasset'})
        with self.assertRaisesRegex(SystemExit, 'source identity'):
            a._require_mesh_contract()
        write(a.MESH_REPORT, report)
        write(a.RUNTIME / 'staging' / 'mi-glove-a0.json', {'requiredUvSets': [0, 2]})
        self.assertEqual(list(a.geometry_blocked()), ['mi-glove-a0'])
        with self.assertRaisesRegex(SystemExit, 'absent UV sets'):
            a._require_preview(a._baseline(), replay=True)

    def test_verify_is_a_read_only_replay_that_tolerates_acceptance_but_mutating_stages_do_not(self):
        a = self.a
        before = pf.tree_state(['_docs', 'scripts', 'public', 'src', 'manifests'])
        a.verify()
        self.assertEqual(pf.tree_state(['_docs', 'scripts', 'public', 'src', 'manifests']), before)
        # The accepted family is now in the active index: replay still passes, mutating stages refuse to run.
        write('public/models/active/supported-items.json', {'items': ['c0', 'c1', 'glove-a-0']})
        a.verify()
        with self.assertRaisesRegex(SystemExit, 'differs from adapter-baseline'):
            a.index()
        a.s.index.assert_not_called()
        # Same cardinality, different originally unadvertised entry: rejected by id.
        preview = a.d.read_json(a.PREVIEW / 'preview.json')
        write(a.PREVIEW / 'preview.json', {**preview, 'unadvertisedStructurallyReady': ['c9']})
        with self.assertRaisesRegex(SystemExit, 'frozen baseline'):
            a.verify()
        write(a.PREVIEW / 'preview.json', preview)
        write(a.WORK / 'resolver' / 'after.json', {'ready': [{'id': i} for i in ('c0', 'c1', 'c9', 'glove-a-0')]})
        with self.assertRaisesRegex(SystemExit, 'preserved by id'):
            a.verify()

    def test_gpu_evidence_must_be_fresh_for_this_build(self):
        a = self.a
        a._require_gpu_evidence()
        write(a.WORK / 'requests.json', [{'id': 'rebuilt'}])
        with self.assertRaisesRegex(SystemExit, 'build changed'):
            a._require_gpu_evidence()
        write(a.WORK / 'validation' / 'webgl-run.json', {'at': 'later'})
        with self.assertRaisesRegex(SystemExit, 'not the recorded fresh GPU run'):
            a._require_gpu_evidence()


FITTED = 'fitted-conservative-shared-uv'
# Only full-string matches of the generator's three shape groups apply; the rest stays source metadata.
PANTS_TAGS = ['Customization.HideMesh.NailsCovered', 'Customization.Shape.PushInsideClothes.push_full_pants',
              'Customization.Shape.PushInsideClothes.push_full_pants.x', 'xCustomization.Shape.ShrinkWrap.a',
              'Customization.Shape.ShrinkWrapX.a', 'Customization.Shape.HeadNeckMatch.neck']
APPLIED = ['Customization.Shape.PushInsideClothes.push_full_pants', 'Customization.Shape.HeadNeckMatch.neck']
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fake_generator(fam, mutate=lambda report: None):
    """Stands in for build-companion-masks.mjs: the outputs it writes, including its refusal of existing fitted paths."""
    def run(command, **_):
        output = Path(command[command.index('--output') + 1])
        if '--fitted-occlusion' in command and output.exists():
            return 1
        output.mkdir(parents=True, exist_ok=True)
        stem = fam.SOURCE_MESH.rsplit('.', 1)[1]
        (output / f'{stem}.bodymask.png').write_bytes(b'mask')
        record = {'source': fam.SOURCE_MESH, 'uvTiles': [2, 1], 'coveredPixels': 7, 'file': f'{stem}.bodymask.png',
                  'sha256': sha(output / f'{stem}.bodymask.png'), 'meshSha256': fam.GLB_SHA256,
                  'poseCounts': [{'pose': p, 'sharedUvRemovedPixels': 3} for p in ('a', 'idle')]}
        report = {'formatVersion': 1, 'geometryMode': 'source', 'indexFolder': command[command.index('--index') + 1],
                  'bodyFile': pf.FITTED_BODY, 'bodySha256': sha(Path('public') / pf.FITTED_BODY), 'records': [record]}
        if '--fitted-occlusion' in command:
            (output / f'{stem}.fitted-occlusion-diagnostic.png').write_bytes(b'diagnostic')
            for pose in record['poseCounts']:
                pose['fittedOcclusion'] = {'fittingMorphs': ['push_full_pants']}
            record.update(previousPolicy={'sha256': '0' * 64}, restoration={'candidatePixels': 7},
                          diagnosticFile=f'{stem}.fitted-occlusion-diagnostic.png',
                          diagnosticSha256=sha(output / f'{stem}.fitted-occlusion-diagnostic.png'))
            report.update(sharedUvPolicy='all-surfaces-covered', occlusionPolicy={
                'name': 'fitted-occlusion', 'fittingTags': command[command.index('--fitting-tags') + 1].split(','),
                'helper': 'scripts/shader-probe/coverage-projection.mjs', 'helperSha256': sha(pf.HELPER),
                'generatorSha256': sha(pf.GENERATOR)})
        mutate(report)
        write(output / 'derived-coverage.json', report)
        return 0
    return run


def fake_index(fam):
    """Stands in for the shared index stage: a runtime/coverage report makes the preview coverage-ready."""
    def run():
        report_path = fam.RUNTIME / 'coverage' / 'derived-coverage.json'
        preview = fam.d.read_json(fam.PREVIEW / 'preview.json')
        assets = fam.d.read_json(fam.PREVIEW / 'assets.json')
        if report_path.is_file():
            record = fam.d.read_json(report_path)['records'][0]
            target = fam.PREVIEW / 'coverage' / record['file']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fam.RUNTIME / 'coverage' / record['file'], target)
            assets['meshes'][fam.SOURCE_MESH] = {'bodyMaskUrl': f'coverage/{record["file"]}', 'bodyMaskUvTiles': record['uvTiles'],
                                                 'coverageSource': 'derived'}
        write(fam.PREVIEW / 'assets.json', assets)
        write(fam.PREVIEW / 'preview.json', {**preview, 'coverageReady': report_path.is_file()})
        fam.progress('preview-coverage' if report_path.is_file() else 'preview-structural')
    return run


class FittedCoverage(unittest.TestCase):
    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.mkdtemp()
        os.chdir(self.tmp)
        a = stage_family('glove-a', 'Gloves', 'hands', ['medium_male', 'medium_female'], ['Customization.HideMesh.NailsCovered'], 3)
        c = stage_family('pants-c', 'Pants', 'lowerBody', ['medium_male'], PANTS_TAGS, 2, mode=FITTED)
        write_active(a, c)
        for path, data in ((pf.GENERATOR, b'generator'), (pf.HELPER, b'helper'), (Path('public') / pf.FITTED_BODY, b'body')):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.a, self.c = (pf.Family(f'manifests/{name}.json', legacy=stub_legacy) for name in ('glove-a', 'pants-c'))
        freeze_family(self.a, a[1], a[2])
        freeze_family(self.c, c[1], c[2])
        for fam in (self.a, self.c):
            fam.s.index.side_effect = fake_index(fam)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def derive(self, fam, generator=None):
        with mock.patch.object(pf.subprocess, 'call', side_effect=generator or fake_generator(fam)) as call, \
                mock.patch.object(pf.Family, '_require_app'):
            try:
                fam.coverage()
            finally:
                self.calls = [c.args[0] for c in call.call_args_list]

    def test_fitted_mode_runs_the_existing_generator_with_exact_shape_tags_and_pins_its_evidence(self):
        c = self.c
        self.derive(c)
        self.assertEqual(self.calls, [['node', 'scripts/shader-probe/build-companion-masks.mjs', '--all', '--items', 'pants-c-0',
                                       '--index', c.PREVIEW.as_posix(), '--output', (c.RUNTIME / 'coverage').as_posix(),
                                       '--conservative-shared-uv', '--fitted-occlusion', '--fitting-tags', ','.join(APPLIED)]])
        pin = c._fitted_pin()
        self.assertEqual((pin['coverage']['sourceFittingTags'], pin['coverage']['appliedFittingTags']), (PANTS_TAGS, APPLIED))
        self.assertEqual(pin['fittedCoverage']['generatorSha256'], sha(pf.GENERATOR))
        roots = ['_docs', 'scripts', 'public', 'src', 'manifests']
        before = pf.tree_state(roots)
        c.verify()
        self.assertEqual(pf.tree_state(roots), before)
        c.index()  # re-indexing replays the pinned evidence before and after the shared stage
        with self.assertRaisesRegex(SystemExit, 'already derived'):
            self.derive(c)
        # A substituted report, runtime PNG or indexed preview mask is rejected on replay.
        stem = c.SOURCE_MESH.rsplit('.', 1)[1]
        for path, data in ((c.RUNTIME / 'coverage' / f'{stem}.bodymask.png', b'other'),
                           (c.RUNTIME / 'coverage' / 'derived-coverage.json', None),
                           (c.PREVIEW / 'coverage' / f'{stem}.bodymask.png', b'other')):
            saved = path.read_bytes()
            path.write_bytes(data if data is not None else saved.replace(b'"sharedUvRemovedPixels": 3', b'"sharedUvRemovedPixels": 4', 1))
            with self.assertRaisesRegex(SystemExit, 'pinned|differs from its report'):
                c.verify()
            path.write_bytes(saved)
        c.verify()

    def test_existing_output_is_never_reused_even_when_empty(self):
        c = self.c
        (c.RUNTIME / 'coverage').mkdir(parents=True)
        with self.assertRaisesRegex(SystemExit, 'never reuses'):
            self.derive(c)
        self.assertEqual((self.calls, list((c.RUNTIME / 'coverage').iterdir())), ([], []))
        c.s.index.assert_not_called()

    def test_fitted_verification_rejects_an_initial_unmasked_preview(self):
        # A structural preview is necessary as input to derivation, but must not pass final verification/merge.
        c = self.c
        c.index()
        self.assertFalse(c.d.read_json(c.PREVIEW / 'preview.json')['coverageReady'])
        with self.assertRaisesRegex(SystemExit, 'requires completed fitted coverage'):
            c.verify()

    def test_unfitted_foreign_or_wrong_provenance_reports_fail_before_indexing(self):
        c = self.c
        mutations = {'fitted-occlusion': lambda r: r.pop('occlusionPolicy'),
                     'all-surfaces-covered': lambda r: r.pop('sharedUvPolicy'),
                     'applied': lambda r: r['occlusionPolicy'].update(fittingTags=PANTS_TAGS),
                     'provenance': lambda r: r['occlusionPolicy'].update(generatorSha256='0' * 64),
                     'pinned manifest mesh': lambda r: r['records'][0].update(meshSha256='0' * 64),
                     'this family preview': lambda r: r.update(indexFolder='public/models/active'),
                     'mask or diagnostic': lambda r: r['records'][0].update(sha256='0' * 64)}
        for message, mutate in mutations.items():
            with self.subTest(message):
                with self.assertRaisesRegex(SystemExit, message):
                    self.derive(c, fake_generator(c, mutate))
                c.s.index.assert_not_called()
                self.assertIsNone(c._fitted_pin())
                # The shared index stage would index any runtime/coverage report; an unpinned one is refused.
                with self.assertRaisesRegex(SystemExit, 'without pinned evidence'):
                    c.index()
                with self.assertRaisesRegex(SystemExit, 'without pinned evidence'):
                    c.verify()
                c.s.index.assert_not_called()
                shutil.rmtree(c.RUNTIME / 'coverage')

    def test_old_modes_keep_their_command_folder_rule_and_evidence_contract(self):
        a = self.a
        (a.RUNTIME / 'coverage').mkdir(parents=True)  # an empty folder stays acceptable for the existing modes
        self.derive(a)
        self.assertEqual(self.calls, [['node', 'scripts/shader-probe/build-companion-masks.mjs', '--all', '--items', 'glove-a-0',
                                       '--index', a.PREVIEW.as_posix(), '--output', (a.RUNTIME / 'coverage').as_posix()]])
        derived = [r for r in a.d.read_json(a.WORK / 'progress.json')['history'] if r['milestone'] == 'coverage-derived']
        self.assertEqual([sorted(r) for r in derived], [['at', 'coverage', 'manifestSha256', 'milestone']])
        a.verify()  # an unfitted report is the accepted contract of the old modes, and no pin is required
        conservative = {**json.loads(Path('manifests/glove-a.json').read_text()), 'coverage': {'mode': 'conservative-shared-uv'}}
        write('manifests/glove-a-conservative.json', conservative)
        fam = pf.Family('manifests/glove-a-conservative.json', legacy=stub_legacy)
        self.assertEqual(fam._coverage_command(['x'])[-3:], ['--output', (fam.RUNTIME / 'coverage').as_posix(), '--conservative-shared-uv'])


def invalid_manifests():
    good = example_manifest()
    bad = []
    def variant(path, value):
        doc = json.loads(json.dumps(good)); target = doc
        for key in path[:-1]:
            target = target[key]
        if value is KeyError:
            del target[path[-1]]
        else:
            target[path[-1]] = value
        bad.append(doc)
    for path, value in [(('extra',), 1), (('schemaVersion',), 2), (('schemaVersion',), True), (('id',), 'Bad Id'), (('marker',), '../x'),
                        (('paths', 'docs'), '/abs/docs'), (('paths', 'work'), 'scripts/generated/shader-probe/../x'),
                        (('paths', 'preview'), good['paths']['runtime']), (('paths', 'runtime'), good['paths']['active'] + '/nested'),
                        (('paths', 'docs'), 'public/models/docs'), (('paths', 'resolver'), 'src/rig/Other.ts'),
                        (('paths', 'appUrl'), 'https://127.0.0.1:4173/'), (('paths', 'appUrl'), 'http://example.com:4173/'),
                        (('paths', 'appUrl'), 'http://127.0.0.1:4173/?x=1'), (('paths', 'refresh'), KeyError), (('paths', 'extra'), 'x'),
                        (('mesh', 'source'), '/Game/A/SK_A.SK_B'), (('mesh', 'sha256'), 'ABC'), (('mesh', 'itemSlot'), ''),
                        (('mesh', 'facts', 'materialSections'), 2), (('mesh', 'facts', 'uvSets'), 0), (('mesh', 'facts', 'bones'), '3'),
                        (('mesh', 'morphNames'), ['a', 'a']), (('fittingTags',), ['t', 't']), (('fittingTags',), 't'),
                        (('coverage',), {'mode': 'guess'}), (('coverage',), {'mode': 'none'}), (('coverage',), {'mode': 'derived', 'reason': 'x'}),
                        (('coverage',), {'mode': 'derived', 'uvTiles': [1, 1]})]:
        variant(path, value)
    # The fitted mode keeps the minimal shape and needs at least one full-string shape tag the generator accepts.
    bad += [{**good, 'coverage': {'mode': FITTED}},
            {**good, 'coverage': {'mode': FITTED}, 'fittingTags': PANTS_TAGS[:1] + PANTS_TAGS[2:5]},
            {**good, 'coverage': {'mode': FITTED, 'fittingTags': APPLIED}, 'fittingTags': PANTS_TAGS}]
    return good, bad


NODE_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const m = await import(process.argv.at(-2));
const {good, bad, fittedGood, tagCases} = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
const rejected = bad.map(doc => { try { m.validateManifest(doc); return false; } catch { return true; } });
m.validateManifest(good);
m.validateManifest(fittedGood);
const fitted = tagCases.map(tags => { try { return m.fittedTags(tags); } catch { return null; } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-freeze-'));
const cwd = process.cwd();
try {
  process.chdir(dir);
  const cfg = m.familyConfig(good), p = cfg.paths, put = (f, v) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify(v)); };
  put(`${p.active}/supported-items.json`, {items: ['a', 'b']});
  put(`${p.active}/skin-pairs.json`, {items: {c: {}}});
  put(`${p.active}/assets.json`, {meshes: {}, materials: {}});
  put(p.catalog, ['a', 'b', 'c', 'd', 'e'].map(id => ({id})));
  put(`${p.sourceIndex}/catalog.json`, {formatVersion: 1, items: ['a', 'b', 'd', 'e']});
  for (const id of ['a', 'b', 'd', 'e']) put(`${p.sourceIndex}/items/${id}.json`, {id});
  // Readiness comes from the resolver: 'e' is ready but not advertised, 'b' is advertised but not structurally ready.
  const resolver = {resolveSourceOutfit: ([def]) => ({items: {[def.id]: {id: def.id, hidden: def.id === 'd'}}}),
    resolveSourceRigParts: item => { if (item.id === 'b') throw new Error('missing mesh'); return [{}]; }};
  const baseline = m.deriveBaseline(cfg, resolver);
  assert.deepEqual([baseline.counts, baseline.unadvertisedStructurallyReady, baseline.manifestSha256],
    [{advertised: 2, indexed: 3, catalog: 5, structural: 2}, ['e'], cfg.manifestSha256]);
  assert.deepEqual(Object.keys(baseline.hashes), cfg.baselineFiles);
  const entries = value => [[cfg.outputs.cohort, {v: 1}], [cfg.outputs.batch, {v: 2}], [cfg.outputs.baseline, value]];
  assert.deepEqual(m.writeFrozenSet(entries(baseline)), [true, true, true]);
  assert.deepEqual(m.writeFrozenSet(entries(baseline)), [false, false, false]);
  // Drift in the active index changes the derived baseline: the rerun fails before any write.
  put(`${p.active}/supported-items.json`, {items: ['a', 'b', 'e']});
  const drifted = m.deriveBaseline(cfg, resolver);
  assert.deepEqual([drifted.counts.advertised, drifted.unadvertisedStructurallyReady], [3, []]);
  const saved = fs.readFileSync(cfg.outputs.baseline, 'utf8');
  assert.throws(() => m.writeFrozenSet(entries(drifted)), /Preserve existing frozen output/);
  assert.equal(fs.readFileSync(cfg.outputs.baseline, 'utf8'), saved);
  // A partial earlier freeze, or targeting the preflight evidence, fails with nothing written.
  fs.rmSync(cfg.outputs.batch);
  assert.throws(() => m.writeFrozenSet(entries(baseline)), /Partial earlier freeze/);
  assert.equal(fs.existsSync(cfg.outputs.batch), false);
  assert.throws(() => m.writeFrozenSet([[`${p.docs}/new.json`, {}], [`${p.docs}/frozen-baseline.json`, {}]]), /preflight/);
  assert.equal(fs.existsSync(`${p.docs}/new.json`), false);
  assert.throws(() => m.parseArgs(['--manifest', 'x', '--write']), /Unexpected argument/);
} finally { process.chdir(cwd); fs.rmSync(dir, {recursive: true, force: true}); }
console.log(JSON.stringify({rejected, fitted, sha: m.manifestSha(good)}));
"""


class ManifestAndFreeze(unittest.TestCase):
    def test_python_and_node_reject_the_same_manifests_and_derive_the_baseline_once(self):
        good, bad = invalid_manifests()
        self.assertIs(pf.validate_manifest(good), good)
        for doc in bad:
            with self.assertRaises(SystemExit, msg=json.dumps(doc)):
                pf.validate_manifest(doc)
        fitted_good = {**good, 'coverage': {'mode': FITTED}, 'fittingTags': PANTS_TAGS}
        self.assertIs(pf.validate_manifest(fitted_good), fitted_good)
        tag_cases = [PANTS_TAGS, list(reversed(PANTS_TAGS)), PANTS_TAGS[2:5], [], ['Customization.Shape.ShrinkWrap.a\n']]
        expected = [APPLIED, list(reversed(APPLIED)), None, None, None]
        for tags, applied in zip(tag_cases, expected):
            if applied is None:
                with self.assertRaisesRegex(SystemExit, 'needs a Customization.Shape'):
                    pf.fitted_tags(tags)
            else:
                self.assertEqual(pf.fitted_tags(tags), applied)
        if not NODE:
            self.skipTest('node is not available')
        with tempfile.TemporaryDirectory() as tmp:
            cases = Path(tmp) / 'cases.json'
            cases.write_text(json.dumps({'good': good, 'bad': bad, 'fittedGood': fitted_good, 'tagCases': tag_cases}), encoding='utf-8')
            result = subprocess.run([NODE, '--input-type=module', '-e', NODE_CHECK, FREEZE.as_uri(), str(cases)],
                                    capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(out['rejected'], [True] * len(bad))
        self.assertEqual(out['fitted'], expected)
        self.assertEqual(out['sha'], pf.manifest_sha(good))

    def test_every_coverage_policy_and_an_empty_tag_set_are_valid(self):
        good = example_manifest()
        pf.validate_manifest({**good, 'coverage': {'mode': 'none', 'reason': 'Shared UV layout; mask audited elsewhere'}})
        pf.validate_manifest({**good, 'coverage': {'mode': 'conservative-shared-uv'}, 'fittingTags': []})


if __name__ == '__main__':
    unittest.main()
