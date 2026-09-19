"""Synthetic contracts for the schemaVersion 2 multipart runner; no game assets, GPU, browser or extraction.

The legacy stages are v1's test stub (tests/test_family_runner.py) plus the few helpers the multipart path calls.
Expected bindings are written literally in the fixture, never derived by the code under test. Fake stage functions
exercise orchestration only; real extraction/material/GPU/coverage integration is not run here.

  python -B tests/test_multipart_family.py -v
"""
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


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v1 = load('v1_family_runner_tests', ROOT / 'tests' / 'test_family_runner.py')
mp = load('prepare_multipart_family', ROOT / 'scripts' / 'shader-probe' / 'prepare-multipart-family.py')
write, glb, NODE = v1.write, v1.glb, shutil.which('node')
FITTED = 'fitted-conservative-shared-uv'
TAGS = ['Customization.Shape.PushInsideClothes.push_full_pants', 'Customization.Shape.PushInsideClothes.push_socks_quarter']
SHELL, LINER = '/Game/Fam/Kit/SK_Shell_M.SK_Shell_M', '/Game/Fam/Kit/SK_Liner_M.SK_Liner_M'
M = lambda name: f'/Game/Fam/Kit/Skins/{name}.{name}'
# (id, [Shell material, Liner material]) in component order; kit-2 reuses the liner material of kit-0.
ITEMS = [('kit-0', [M('MI_Shell_A'), M('MI_Liner_Plain')]), ('kit-1', [M('MI_Shell_B'), M('MI_Liner_White')]),
         ('kit-2', [M('MI_Shell_C'), M('MI_Liner_Plain')])]
# Literal expectation of what the freeze records for kit-0.
KIT0_PARTS = [{'sourceIndex': 0, 'mesh': SHELL, 'binding': 'explicit-override', 'slots': [{'slot': 'Shell', 'material': M('MI_Shell_A')}]},
              {'sourceIndex': 1, 'mesh': LINER, 'binding': 'explicit-override', 'slots': [{'slot': 'Liner', 'material': M('MI_Liner_Plain')}]}]
IMPLEMENTED = ['kit-0', 'kit-2']


def stub(tag):
    s = v1.stub_legacy(tag)
    d = s.d

    def load_batch():
        batch = d.read_json(d.BATCH)
        rows = {r['id']: r for r in d.read_json(Path(batch['cohort']))['items']}
        return batch, [rows[i] for i in batch['ids']]
    d.load_batch = load_batch
    d.preview_tools = types.SimpleNamespace(resolved_shape=lambda doc, folder: json.dumps(doc, sort_keys=True))
    d.stage_gpu = mock.Mock()
    return s


def package(source):
    return 'Discovery/Content/' + source.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


def request(mode=FITTED):
    return {'id': 'kit', 'schemaVersion': 2, 'itemSlot': 'lowerBody', 'fittingTags': TAGS,
            'coverage': {'mode': mode, 'reason': 'test'} if mode == 'none' else {'mode': mode, 'composition': 'per-component-union'},
            'paths': {'docs': '_docs/kit', 'work': 'scripts/generated/shader-probe/kit', 'runtime': 'public/models/kit-v1',
                      'preview': 'public/models/kit-preview-v1', 'active': 'public/models/active', 'sourceIndex': 'public/models/source',
                      'catalog': 'src/data/items.json', 'resolver': 'src/rig/SourceAssembly.ts',
                      'refresh': 'scripts/generated/shader-probe/refresh', 'appUrl': 'http://127.0.0.1:4321/',
                      'metadata': ['src/data/share-item-ids.json']},
            'components': [{'sourceIndex': 0, 'source': SHELL, 'slot': 'Shell'}, {'sourceIndex': 1, 'source': LINER, 'slot': 'Liner'}]}


def stage_fixture(mode=FITTED):
    """Every artifact a completed run leaves behind, for a two-component cohort of three choices."""
    work, docs = Path('scripts/generated/shader-probe/kit'), Path('_docs/kit')
    folder = work / 'source' / 'meshes-01'
    sha = lambda p: v1.hashlib.sha256(Path(p).read_bytes()).hexdigest()
    records, reports, pinned = [], [], []
    for source, slot, uv, morphs in ((SHELL, 'Shell', 2, ['medium_male', 'medium_female']), (LINER, 'Liner', 1, ['medium_male'])):
        stem = mp.short(source)
        write(folder / f'{stem}.mesh.json', {'source': package(source), 'sourceMaterials': [{'MaterialSlotName': slot}],
                                             'materials': [{'path': f'/Game/Fam/Kit/M_{slot}.M_{slot}'}], 'lods': [{'morphs': [{'name': n} for n in morphs]}]})
        attributes = {'POSITION': 0, 'JOINTS_0': 3, 'WEIGHTS_0': 4, **{f'TEXCOORD_{i}': 1 + i for i in range(uv)}}
        (work / 'meshes').mkdir(parents=True, exist_ok=True)
        (work / 'meshes' / f'{stem}.glb').write_bytes(glb({
            'materials': [{'extras': {'sourceSlot': {'MaterialSlotName': slot}, 'sourceMaterial': f'/Game/Fam/Kit/M_{slot}.M_{slot}'}}],
            'meshes': [{'extras': {'targetNames': morphs}, 'primitives': [{'attributes': attributes, 'targets': [{'POSITION': 9} for _ in morphs]}]}],
            'nodes': [{'mesh': 0, 'skin': 0}], 'skins': [{'joints': [0, 1], 'inverseBindMatrices': 5}]}))
        records.append({'path': package(source), 'sha256': 'AB' * 32 if slot == 'Shell' else 'CD' * 32, 'meshFile': f'{stem}.mesh.json',
                        'exports': [{'type': 'SkeletalMesh'}]})
        glb_path, dto = work / 'meshes' / f'{stem}.glb', folder / f'{stem}.mesh.json'
        facts = {'vertices': 10, 'triangles': 8, 'uvSets': uv, 'bones': 3, 'materialSections': 1, 'maxInfluences': 8}
        reports.append({'source': package(source), 'glb': glb_path.as_posix(), 'meshJson': dto.as_posix(), 'file': f'{stem}.glb',
                        'sha256': sha(glb_path), 'sourceDtoSha256': sha(dto), 'sourcePackageSha256': records[-1]['sha256'],
                        'verification': {'passed': True}, 'morphs': morphs, **facts})
        pinned.append({'sha256': sha(glb_path), 'sourcePackageSha256': records[-1]['sha256'], 'sourceDtoSha256': sha(dto),
                       'facts': facts, 'morphNames': morphs})
    write(folder / 'assets.json', list(reversed(records)))  # extractor order need not be part order
    write(folder / 'source-run.json', {'build': 'b1'})
    write(work / 'source' / 'meshes-01.requests.json', [package(LINER), package(SHELL)])
    write(work / 'source' / 'meshes-01.run.json', {'exitCode': 0})
    write(docs / 'mesh-report.json', {'formatVersion': 2, 'components': reports})
    manifest = request(mode)
    manifest['components'] = [{**c, **p} for c, p in zip(manifest['components'], pinned)]
    write('manifests/kit.json', manifest)
    items = [{'id': i, 'name': i, 'slot': 'lowerBody', 'materials': m} for i, m in ITEMS]
    write(docs / 'cohort.json', {'meshes': [SHELL, LINER], 'count': 3, 'items': items, 'attached': False,
                                 'materials': sorted({m for _, ms in ITEMS for m in ms})})
    write('public/models/active/assets.json', {'meshes': {'/Game/Other/SK_O.SK_O': {'url': 'o.glb', 'bodyMaskUrl': 'o.png', 'coverageSource': 'derived'}},
                                               'materials': {'/Game/Other/MI_O.MI_O': 'o.json'}})
    write('public/models/active/supported-items.json', {'items': ['c0'], 'ready': [{'id': 'c0', 'parts': []}], 'exceptions': [{'id': 'kit-1', 'reason': 'x'}]})
    write('public/models/active/skin-pairs.json', {'items': {'c1': {}}})
    write('src/data/items.json', [{'id': 'c0'}, {'id': 'c1'}, {'id': 'c2'}] + [{'id': i} for i, _ in ITEMS])
    write('src/data/share-item-ids.json', {'kit-0': 1})
    Path('src/rig').mkdir(parents=True, exist_ok=True)
    Path('src/rig/SourceAssembly.ts').write_text('// resolver\n')
    fam = mp.MultipartFamily('manifests/kit.json', legacy=stub)
    d = fam.d
    write(docs / 'frozen-baseline.json', {'hashes': fam._active_hashes()})
    rows = []
    for item in items:
        path = fam.SOURCE_INDEX / 'items' / (item['id'] + '.json')
        write(path, {'formatVersion': 1, 'id': item['id'], 'source': 'x', 'sourceSha256': 'ab', 'properties': {'ActivatesTags': TAGS[::-1]}})
        parts = [{'sourceIndex': i, 'mesh': mesh, 'binding': 'explicit-override', 'slots': [{'slot': slot, 'material': item['materials'][i]}]}
                 for i, (mesh, slot) in enumerate(((SHELL, 'Shell'), (LINER, 'Liner')))]
        rows.append({**item, 'definition': d.read_json(path), 'definitionFileSha256': d.file_sha(path), 'fittingTags': sorted(TAGS),
                     'effectiveParts': parts, 'resolved': {'materialParameters': [], 'parts': [
                         {'sourceIndex': p['sourceIndex'], 'skeletalMesh': p['mesh'], 'staticMesh': '', 'effect': '', 'hidden': False,
                          'unresolved': []} for p in parts]}})
    slots = [[{'slot': 'Shell', 'material': '/Game/Fam/Kit/M_Shell.M_Shell'}], [{'slot': 'Liner', 'material': '/Game/Fam/Kit/M_Liner.M_Liner'}]]
    write(docs / 'resolved-cohort.json', {'meshes': [SHELL, LINER], 'items': rows, 'manifestSha256': fam.sha, 'context': mp.CONTEXT,
                                          'meshReports': reports, 'sourceSlots': slots})
    write(docs / 'batch.json', {'cohort': (docs / 'resolved-cohort.json').as_posix(), 'ids': [i for i, _ in ITEMS], 'manifestSha256': fam.sha})
    write(docs / 'adapter-baseline.json', {'manifestSha256': fam.sha, 'hashes': fam._active_hashes(), 'unadvertisedStructurallyReady': [],
                                           'counts': {'advertised': 1, 'indexed': 2, 'catalog': 6, 'structural': 1}})
    write(d.SOURCE / 'working-01' / 'working-export.json', {'buildIdentity': {'build': 'b1'}})
    write(work / 'source-ready.json', {'buildIdentity': {'build': 'b1'}, 'batch': (docs / 'batch.json').as_posix(), 'marker': fam.MARKER + '/source'})
    materials = sorted({m for _, ms in ITEMS for m in ms})
    write(d.SOURCE / 'material-resolution.json', [{'source': m, 'instance': mp.short(m)} for m in materials])
    write(work / 'validation' / 'passed.requests.json', [{'id': d.job_id(mp.short(m))} for m in materials])
    for m in materials:  # the white liner shader needs a second UV set the one-UV liner mesh lacks
        write(fam.RUNTIME / 'staging' / (d.job_id(mp.short(m)) + '.json'), {'requiredUvSets': [0, 1] if 'White' in m else [0]})
    for path in (fam.RUNTIME / 'staging' / 'build-report.json', work / 'requests.json', work / 'surface-audit.json'):
        write(path, [])
    write(work / 'meshes' / 'meshes.json', fam._mesh_entries(reports))
    fam.progress('build', buildHashes=fam._build_hashes())
    write(work / 'geometry-contracts.json', fam.geometry_records())
    run = work / 'validation' / 'webgl-run.json'
    write(run, {'at': '2026-09-18T12:00:00Z', 'result': 'passed'})
    archived = fam._preserve_gpu_run(run)
    fam.progress('gpu', evidence=archived.as_posix(), evidenceSha256=d.file_sha(archived), build=fam._build_hashes())
    for name in mp.INDEX_FILES:
        (work / 'active-before').mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fam.ACTIVE / name, work / 'active-before' / name)
    active = d.read_json(fam.ACTIVE / 'assets.json')
    coverage = fam.RUNTIME / 'coverage'
    for f in (mp.pf.GENERATOR, mp.pf.HELPER, Path('public') / mp.pf.FITTED_BODY):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f'// {f.name}\n')
    provenance = fam._coverage_provenance()
    report = {'formatVersion': 1, 'geometryMode': 'source', 'indexFolder': fam.PREVIEW.as_posix(), 'sharedUvPolicy': 'all-surfaces-covered',
              'bodyFile': mp.pf.FITTED_BODY, 'bodySha256': sha(Path('public') / mp.pf.FITTED_BODY), 'records': [],
              'occlusionPolicy': {'name': 'fitted-occlusion', 'fittingTags': TAGS, 'helper': mp.pf.HELPER.as_posix(), **provenance}}
    meshes = {}
    for source in (SHELL, LINER):
        stem, mesh_sha = mp.short(source), fam.COMPONENTS[[SHELL, LINER].index(source)]['sha256']
        coverage.mkdir(parents=True, exist_ok=True)
        (coverage / f'{stem}.bodymask.png').write_bytes(b'mask ' + stem.encode())
        (coverage / f'{stem}.fitted-occlusion-diagnostic.png').write_bytes(b'diag ' + stem.encode())
        report['records'].append({'source': source, 'file': f'{stem}.bodymask.png', 'sha256': sha(coverage / f'{stem}.bodymask.png'),
                                  'diagnosticFile': f'{stem}.fitted-occlusion-diagnostic.png', 'uvTiles': [2, 1],
                                  'diagnosticSha256': sha(coverage / f'{stem}.fitted-occlusion-diagnostic.png'), 'meshSha256': mesh_sha,
                                  'coveredPixels': 5, 'restoration': {'candidatePixels': 5}, 'previousPolicy': {'sha256': 'e' * 64},
                                  'poseCounts': [{'pose': p, 'sharedUvRemovedPixels': 0, 'fittedOcclusion': {'fittingMorphs': ['m']}} for p in ('a', 'idle')]})
        meshes[source] = {'url': f'../kit-v1/meshes/{stem}.glb', 'bodyMaskUrl': f'../kit-v1/coverage/{stem}.bodymask.png',
                          'bodyMaskUvTiles': [2, 1], 'coverageSource': 'derived-projection'}
    write(coverage / 'derived-coverage.json', report)
    fam.progress('coverage-derived', coverage={'command': fam._coverage_command(IMPLEMENTED)}, fittedCoverage=fam._fitted_evidence(provenance))
    implemented_materials = {m for i, ms in ITEMS if i in IMPLEMENTED for m in ms}
    write(fam.PREVIEW / 'assets.json', {'meshes': {**active['meshes'], **meshes},
                                        'materials': {**active['materials'], **{m: f'../kit-v1/materials/{mp.short(m)}.json' for m in implemented_materials}}})
    write(fam.PREVIEW / 'skin-pairs.json', d.read_json(fam.ACTIVE / 'skin-pairs.json'))
    write(fam.PREVIEW / 'supported-items.json', {'items': ['c0', *IMPLEMENTED], 'ready': [{'id': 'c0', 'parts': []}] + [{'id': i} for i in IMPLEMENTED],
                                                 'exceptions': [{'id': 'kit-1', 'reason': 'x'}]})
    write(work / 'resolver' / 'before.json', {'ready': [{'id': 'c0'}]})
    write(work / 'resolver' / 'after.json', {'ready': [{'id': i} for i in ('c0', *IMPLEMENTED)]})
    write(fam.PREVIEW / 'preview.json', {'marker': fam.MARKER, 'activeUnchanged': True, 'implemented': IMPLEMENTED, 'coverageReady': True,
                                         'previousAdvertised': 1, 'previewAdvertised': 3, 'previousAssemblies': 1, 'previewAssemblies': 3,
                                         'unadvertisedStructurallyReady': []})
    return fam


def edit(path, change):
    doc = json.loads(Path(path).read_text(encoding='utf-8'))
    change(doc)
    write(path, doc)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.mkdtemp()
        os.chdir(self.tmp)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)


class MultipartRunner(Fixture):
    def test_complete_two_part_fixture_replays_and_plans_every_component(self):
        fam = stage_fixture()
        fam.verify()
        batch, items, missing = fam.plan()
        self.assertEqual((missing, [i['id'] for i in items]), ([], ['kit-0', 'kit-1', 'kit-2']))
        self.assertEqual([{k: p[k] for k in ('sourceIndex', 'mesh', 'slots')} for p in items[0]['parts']],
                         [{k: p[k] for k in ('sourceIndex', 'mesh', 'slots')} for p in KIT0_PARTS])
        self.assertIs(fam.d.plan, fam.s.plan)
        blockers = {r['itemId']: r['blockers'] for r in fam.geometry_records() if r['blockers']}
        self.assertEqual(list(blockers), ['mi-liner-white'])
        self.assertIn('SK_Liner_M lacks original UV sets [1]', blockers['mi-liner-white'][0])

    def test_independent_corruptions_each_fail_replay(self):
        def swap_parts(doc):
            doc['items'][0]['effectiveParts'].reverse()
        def rebind(doc):
            doc['items'][1]['effectiveParts'][1]['slots'][0]['material'] = M('MI_Liner_Plain')
        def omit(doc):
            doc['items'][2]['effectiveParts'].pop()
        corruptions = {
            'part order': lambda: edit('_docs/kit/resolved-cohort.json', swap_parts),
            'omitted component': lambda: edit('_docs/kit/resolved-cohort.json', omit),
            'omitted export': lambda: edit('scripts/generated/shader-probe/kit/source/meshes-01/assets.json', lambda d: d.pop()),
            'mesh bytes': lambda: Path('scripts/generated/shader-probe/kit/meshes/SK_Liner_M.glb').write_bytes(b'glTF'),
            'slot': lambda: edit('scripts/generated/shader-probe/kit/source/meshes-01/SK_Shell_M.mesh.json',
                                 lambda d: d['sourceMaterials'][0].update(MaterialSlotName='Liner')),
            'source package': lambda: edit('scripts/generated/shader-probe/kit/source/meshes-01/assets.json', lambda d: d[0].update(sha256='EF' * 32)),
            'source build': lambda: write('scripts/generated/shader-probe/kit/source/working-01/working-export.json', {'buildIdentity': {'build': 'b2'}}),
            'material binding': lambda: edit('_docs/kit/resolved-cohort.json', rebind),
            'coverage png': lambda: Path('public/models/kit-v1/coverage/SK_Liner_M.bodymask.png').write_bytes(b'changed'),
            'preexisting entry': lambda: edit('public/models/kit-preview-v1/assets.json', lambda d: d['meshes']['/Game/Other/SK_O.SK_O'].update(url='x.glb')),
            'skin pairs': lambda: write('public/models/kit-preview-v1/skin-pairs.json', {'items': {}}),
            'bare preliminary index': lambda: edit('public/models/kit-preview-v1/preview.json', lambda d: d.update(coverageReady=False)),
            'active snapshot': lambda: write('scripts/generated/shader-probe/kit/active-before/skin-pairs.json', {'items': {'c9': {}}}),
        }
        for name, corrupt in corruptions.items():
            with self.subTest(name):
                os.chdir(self.cwd)
                shutil.rmtree(self.tmp)
                os.makedirs(self.tmp)
                os.chdir(self.tmp)
                fam = stage_fixture()
                corrupt()
                with self.assertRaises(SystemExit):
                    fam.verify()

    def test_active_baseline_drift_blocks_mutating_stages(self):
        fam = stage_fixture()
        fam._require_frozen_baseline()
        write('src/data/share-item-ids.json', {'kit-0': 2})
        with self.assertRaisesRegex(SystemExit, 'differs from adapter-baseline'):
            fam._require_frozen_baseline()

    def test_old_gpu_result_and_rebuilt_outputs_fail(self):
        fam = stage_fixture()
        with self.assertRaisesRegex(SystemExit, 'did not record a fresh run'):
            fam.gpu()  # the stub GPU stage leaves the previous webgl-run.json in place
        write(fam.WORK / 'requests.json', [{'id': 'changed'}])
        with self.assertRaisesRegex(SystemExit, 'build'):
            fam._require_gpu_evidence()
        with self.assertRaisesRegex(SystemExit, 'No completed build record'):
            fam._require_build_record()

    def test_fitted_evidence_needs_one_record_per_component(self):
        fam = stage_fixture()
        edit('public/models/kit-v1/coverage/derived-coverage.json', lambda d: d['records'].pop())
        with self.assertRaisesRegex(SystemExit, 'one record per component'):
            fam._fitted_evidence(fam._coverage_provenance())

    def test_preflight_rejects_active_reuse_before_extraction(self):
        stage_fixture()
        write('manifests/request.json', request())
        edit('public/models/active/assets.json', lambda d: d['meshes'].update({LINER: {'url': 'l.glb'}}))
        shutil.rmtree('_docs/kit')
        write('_docs/kit/cohort.json', {'meshes': [SHELL, LINER], 'count': 1, 'attached': False,
                                        'items': [{'id': 'kit-0', 'name': 'k', 'slot': 'lowerBody', 'materials': ITEMS[0][1]}], 'materials': sorted(ITEMS[0][1])})
        extract = mock.Mock()

        def legacy(tag):
            s = stub(tag)
            s.extract = extract
            return s
        with self.assertRaisesRegex(SystemExit, 'Already-active mesh/material reuse'):
            mp.preflight('manifests/request.json', legacy=legacy)
        extract.assert_not_called()
        with self.assertRaisesRegex(SystemExit, 'only runs preflight'):
            mp.MultipartFamily('manifests/request.json', legacy=stub, pinned=False).source()

    def test_run_is_sequential_logged_and_preserves_failed_attempts(self):
        stage_fixture()
        calls = []

        def runner(command, stdout, **_):
            calls.append(command)
            stdout.write(b'log line\n')
            return types.SimpleNamespace(returncode=1 if command[-1] == 'gpu' else 0)
        self.assertEqual(mp.run('manifests/kit.json', ['mesh', 'freeze', 'gpu', 'index'], runner=runner, python='py'), 1)
        self.assertEqual(mp.run('manifests/kit.json', ['mesh'], runner=runner, python='py'), 0)
        self.assertEqual([c[-1] for c in calls], ['mesh', 'manifests/kit.json', 'gpu', 'mesh'])
        receipts = sorted(Path('_docs/kit/runs').glob('*Z*.json'))
        first, second = (json.loads(p.read_text(encoding='utf-8')) for p in receipts)
        self.assertEqual((first['complete'], [s['exitCode'] for s in first['stages']]), (False, [0, 0, 1]))
        self.assertTrue(second['complete'])
        self.assertTrue(all(Path(s['log']).is_file() and 'seconds' in s for s in first['stages']))


def invalid_manifests():
    base = json.loads(json.dumps(request()))
    base['components'] = [{**c, 'sha256': 'a' * 64, 'sourcePackageSha256': 'B' * 64, 'sourceDtoSha256': 'c' * 64, 'morphNames': ['m'],
                           'facts': {'vertices': 1, 'triangles': 1, 'uvSets': 1, 'bones': 1, 'materialSections': 1, 'maxInfluences': 8}}
                          for c in base['components']]

    def variant(change):
        doc = json.loads(json.dumps(base))
        change(doc)
        return doc
    return base, {
        'one component': variant(lambda d: d['components'].pop()),
        'duplicate source': variant(lambda d: d['components'][1].update(source=SHELL, slot='Other')),
        'duplicate index': variant(lambda d: d['components'][1].update(sourceIndex=0)),
        'reordered': variant(lambda d: d['components'].reverse()),
        'duplicate slot': variant(lambda d: d['components'][1].update(slot='Shell')),
        'two sections': variant(lambda d: d['components'][0]['facts'].update(materialSections=2)),
        'unknown field': variant(lambda d: d['components'][0].update(hide=True)),
        'no composition': variant(lambda d: d['coverage'].pop('composition')),
        'no shape tag': variant(lambda d: d.update(fittingTags=['Customization.HideMesh.X'])),
        'metadata overlaps output': variant(lambda d: d['paths'].update(metadata=['_docs/kit/names.json'])),
        'schemaVersion 1': variant(lambda d: d.update(schemaVersion=1)),
        'unpinned': variant(lambda d: d['components'][0].pop('sha256')),
    }


class Manifest(Fixture):
    def test_python_and_node_reject_the_same_manifests(self):
        base, cases = invalid_manifests()
        self.assertIs(mp.validate_manifest(base), base)
        mp.validate_manifest(request(), pinned=False)
        for name, doc in cases.items():
            with self.subTest(name), self.assertRaises(SystemExit):
                mp.validate_manifest(doc)
        with self.assertRaises(SystemExit):
            mp.validate_manifest(v1.example_manifest())
        with self.assertRaisesRegex(SystemExit, r"missing \['mesh'\]"):
            mp.pf.validate_manifest(base)  # v1 never accepts a v2 manifest
        if not NODE:
            self.skipTest('node is not available')
        write('cases.json', {'base': base, 'request': request(), 'cases': cases, 'v1': v1.example_manifest()})
        script = (f"import {{validateManifest}} from {json.dumps((ROOT / 'scripts/shader-probe/freeze-multipart-family.mjs').as_uri())};"
                  "import fs from 'node:fs'; const c = JSON.parse(fs.readFileSync('cases.json','utf8'));"
                  "const ok = (d, p) => { try { validateManifest(d, p); return true; } catch { return false; } };"
                  "console.log(JSON.stringify({base: ok(c.base), request: ok(c.request, false), v1: ok(c.v1),"
                  "cases: Object.fromEntries(Object.entries(c.cases).map(([k, d]) => [k, ok(d)]))}));")
        out = json.loads(subprocess.run([NODE, '--input-type=module', '-e', script], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(out, {'base': True, 'request': True, 'v1': False, 'cases': {k: False for k in cases}})


if __name__ == '__main__':
    unittest.main()
