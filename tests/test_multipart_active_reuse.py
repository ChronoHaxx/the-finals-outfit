"""Synthetic contracts for the opt-in schemaVersion 2 activeComponentReuse slice; no game assets, GPU or browser.

Self-contained: the shared v1 stub (tests/test_family_runner.py) is not in this workspace, so a minimal legacy stub
drives the real preflight, the pinned family checks and the Node freeze module. Expected pins are hashed here from
literal fixture bytes. Real extraction, conversion, coverage derivation and indexing are Astra's proof.

  python -B tests/test_multipart_active_reuse.py -v
"""
import hashlib
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
spec = importlib.util.spec_from_file_location('prepare_multipart_family_reuse_tests', ROOT / 'scripts' / 'shader-probe' / 'prepare-multipart-family.py')
mp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mp)
mar, pf, NODE = mp.mar, mp.pf, shutil.which('node')
TAGS = ['Customization.Shape.PushInsideClothes.push_lower_feet', 'Customization.Shape.PushInsideClothes.push_socks_quarter']
SHOE, SOCK = '/Game/Starter/SK_Sneakers_M.SK_Sneakers_M', '/Game/Socks/SK_Socks_Quarter_M.SK_Socks_Quarter_M'
M = lambda name: f'/Game/Skins/{name}.{name}'
ITEMS = [('starter-blackpurple', [M('MI_Shoe_A'), M('MI_Wool_Gray')]), ('starter-darkgraywhite', [M('MI_Shoe_B'), M('MI_Wool_White')]),
         ('starter-skillissue', [M('MI_Shoe_C'), M('MI_Wool_Gray')])]
SOCK_SLOTS = [{'slot': 'Quarter', 'material': M('MI_Quarter')}]
DRESS, REPORT = 'public/models/dress-v1', 'public/models/dress-v1/coverage/derived-coverage.json'
SOCK_GLB, SOCK_MASK = b'sock glb bytes', b'sock mask bytes'
WORK, DOCS = Path('scripts/generated/shader-probe/kit'), Path('_docs/kit')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def edit(path, change):
    doc = json.loads(Path(path).read_text(encoding='utf-8'))
    change(doc)
    write(path, doc)


def package(source):
    return 'Discovery/Content/' + source.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


def request(reused=(SOCK,)):
    doc = {'id': 'kit', 'schemaVersion': 2, 'itemSlot': 'feet', 'fittingTags': TAGS,
           'coverage': {'mode': 'fitted-conservative-shared-uv', 'composition': 'per-component-union'},
           'paths': {'docs': '_docs/kit', 'work': WORK.as_posix(), 'runtime': 'public/models/kit-v1', 'preview': 'public/models/kit-preview-v1',
                     'active': 'public/models/active', 'sourceIndex': 'public/models/source', 'catalog': 'src/data/items.json',
                     'resolver': 'src/rig/SourceAssembly.ts', 'refresh': 'scripts/generated/shader-probe/refresh',
                     'appUrl': 'http://127.0.0.1:4321/', 'metadata': ['src/data/share-item-ids.json']},
           'components': [{'sourceIndex': 0, 'source': SHOE, 'slot': 'Shoe'}, {'sourceIndex': 1, 'source': SOCK, 'slot': 'Quarter'}]}
    if reused is not None:
        doc[mar.FIELD] = {'policy': mar.POLICY, 'components': [{'source': s, 'originReport': REPORT} for s in reused]}
    return doc


def record(source, mask_sha, mesh_sha, tiles=(2, 1)):
    stem = mp.short(source)
    return {'source': source, 'file': stem + '.bodymask.png', 'diagnosticFile': stem + '.fitted-occlusion-diagnostic.png', 'sha256': mask_sha,
            'meshSha256': mesh_sha, 'uvTiles': list(tiles), 'coveredPixels': 5, 'restoration': {'candidatePixels': 5},
            'previousPolicy': {'sha256': 'e' * 64},
            'poseCounts': [{'pose': p, 'sharedUvRemovedPixels': 0, 'fittedOcclusion': {'fittingMorphs': ['m']}} for p in ('a', 'idle')]}


def origin_report(**changes):
    doc = {'formatVersion': 1, 'geometryMode': 'source', 'sharedUvPolicy': 'all-surfaces-covered', 'indexFolder': 'public/models/dress-preview',
           'bodyFile': pf.FITTED_BODY, 'bodySha256': sha(Path('public') / pf.FITTED_BODY),
           'records': [record('/Game/Dress/SK_Dress_M.SK_Dress_M', 'd' * 64, 'c' * 64),
                       record(SOCK, hashlib.sha256(SOCK_MASK).hexdigest(), hashlib.sha256(SOCK_GLB).hexdigest())],
           'occlusionPolicy': {'name': 'fitted-occlusion', 'settings': {'tiltDegrees': [30, 60], 'azimuths': 8, 'surfaceTolerance': 0},
                               'fittingTags': TAGS, 'helper': pf.HELPER.as_posix(), 'helperSha256': sha(pf.HELPER),
                               'generatorSha256': sha(pf.GENERATOR)}}
    doc.update(changes)
    return doc


def fixture(reused=(SOCK,)):
    """Active index with the accepted sock entry (unknown fields included), its files and originating report."""
    for f in (pf.GENERATOR, pf.HELPER, Path('public') / pf.FITTED_BODY):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f'// {f.name}\n')
    Path(DRESS, 'meshes').mkdir(parents=True)
    Path(DRESS, 'coverage').mkdir(parents=True)
    Path(DRESS, 'meshes', 'SK_Socks_Quarter_M.glb').write_bytes(SOCK_GLB)
    Path(DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png').write_bytes(SOCK_MASK)
    write(REPORT, origin_report())
    sock = {'url': '../dress-v1/meshes/SK_Socks_Quarter_M.glb', 'sha256': hashlib.sha256(SOCK_GLB).hexdigest(), 'slots': SOCK_SLOTS,
            'kind': 'skeletal', 'bodyMaskUrl': '../dress-v1/coverage/SK_Socks_Quarter_M.bodymask.png', 'bodyMaskUvTiles': [2, 1],
            'coverageSource': 'derived-projection', 'futureField': {'weight': 1.5, 'note': 'kept whole'}}
    write('public/models/active/assets.json', {'meshes': {SOCK: sock, '/Game/Other/SK_O.SK_O': {'url': 'o.glb', 'bodyMaskUrl': 'o.png'}},
                                               'materials': {M('MI_Cotton'): 'c.json'}, 'materialVariants': {'v': 1}, 'futureTop': [1]})
    write('public/models/active/supported-items.json', {'items': ['c0'], 'ready': [{'id': 'c0'}], 'exceptions': [], 'meta': {'k': 1}})
    write('public/models/active/skin-pairs.json', {'items': {'c1': {}}})
    write('src/data/items.json', [{'id': 'c0'}, {'id': 'c1'}] + [{'id': i} for i, _ in ITEMS])
    write('src/data/share-item-ids.json', {})
    write('src/rig/SourceAssembly.ts', '// resolver')
    write(DOCS / 'cohort.json', {'meshes': [SHOE, SOCK], 'count': 3, 'attached': False,
                                 'items': [{'id': i, 'name': i, 'slot': 'feet', 'materials': m} for i, m in ITEMS],
                                 'materials': sorted({m for _, ms in ITEMS for m in ms})})
    write('manifests/request.json', request(reused))


def default_extract(kind, name, packages):
    folder = WORK / 'source' / name
    for source, slot in ((SHOE, [{'slot': 'Shoe', 'material': M('MI_Shoe')}]), (SOCK, SOCK_SLOTS)):
        write(folder / f'{mp.short(source)}.mesh.json', {'source': package(source), 'slots': slot})
    write(folder / 'assets.json', [{'path': package(s), 'sha256': 'AB' * 32, 'meshFile': f'{mp.short(s)}.mesh.json'} for s in (SOCK, SHOE)])
    write(WORK / 'source' / f'{name}.requests.json', sorted(packages))
    write(WORK / 'source' / f'{name}.run.json', {'exitCode': 0})


def default_build(dto, output, sock=SOCK_GLB):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(sock if 'Socks' in output.name else b'shoe glb bytes')
    return {'sha256': sha(output), 'file': output.name, 'morphs': ['medium_male'], 'vertices': 10, 'triangles': 8, 'uvSets': 1,
            'bones': 3, 'materialSections': 1, 'maxInfluences': 8}


def legacy_with(extract=default_extract, build=default_build, shared=None):
    objects = {package(s): s for s in (SHOE, SOCK)}

    def legacy(tag):
        if shared is not None and shared:
            return shared[0]
        d = types.SimpleNamespace(read_json=lambda p: json.loads(Path(p).read_text(encoding='utf-8')), write=write, file_sha=sha,
                                  configure=lambda *a: None, package_of=package,
                                  assembly_index=types.SimpleNamespace(object_path=lambda p: objects.get(p, p)),
                                  meshes_builder=types.SimpleNamespace(build=build),
                                  mesh_verifier=types.SimpleNamespace(verify=lambda dto, glb: {'passed': True}),
                                  dto_slots=lambda folder, rec: json.loads((Path(folder) / rec['meshFile']).read_text(encoding='utf-8'))['slots'],
                                  preview_tools=types.SimpleNamespace(resolved_shape=lambda doc, folder: json.dumps(doc, sort_keys=True)))
        s = types.SimpleNamespace(d=d, audit_blocked=lambda: {}, extract=extract, plan=None)
        if shared is not None:
            shared.append(s)
        return s
    return legacy


def preflight(legacy=None):
    with mock.patch.object(mp.MultipartFamily, 'mesh'):
        return mp.preflight('manifests/request.json', legacy=legacy or legacy_with())


class Fixture(unittest.TestCase):
    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.mkdtemp()
        os.chdir(self.tmp)
        fixture()

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)


class Manifest(Fixture):
    def test_field_shapes(self):
        mp.validate_manifest(request(None), pinned=False)  # absent: today's request
        doc = request()
        self.assertIs(mp.validate_manifest(doc, pinned=False), doc)
        self.assertNotIn(mar.FIELD, set().union(*pf.FIELDS['manifest']))  # schemaVersion 1 never accepts it
        cases = request_cases()
        for name, doc in cases.items():
            with self.subTest(name), self.assertRaises(SystemExit):
                mp.validate_manifest(doc, pinned=False)
        if not NODE:
            self.skipTest('node is not available')
        write('cases.json', {'ok': request(), 'cases': cases})
        out = node("import {validateManifest} from %s; const c = read('cases.json');"
                   "const ok = d => { try { validateManifest(d, false); return true; } catch { return false; } };"
                   "console.log(JSON.stringify({ok: ok(c.ok), cases: Object.fromEntries(Object.entries(c.cases).map(([k, d]) => [k, ok(d)]))}));")
        self.assertEqual(out, {'ok': True, 'cases': {k: False for k in cases}})


def request_cases():
    def variant(change, reused=(SOCK,)):
        doc = request(reused)
        change(doc)
        return doc
    field = lambda d: d[mar.FIELD]
    return {
        'all components reused': request((SHOE, SOCK)),
        'empty': variant(lambda d: field(d).update(components=[])),
        'unknown source': variant(lambda d: field(d)['components'][0].update(source='/Game/X/SK_X.SK_X')),
        'case variant source': variant(lambda d: field(d)['components'][0].update(source=SOCK.lower())),
        'extra key': variant(lambda d: field(d)['components'][0].update(entrySha256='a' * 64)),
        'unknown field': variant(lambda d: field(d).update(materials=[])),
        'policy': variant(lambda d: field(d).update(policy='exact-active-entry-v1')),
        'unfitted mode': variant(lambda d: d.update(coverage={'mode': 'derived', 'composition': 'per-component-union'})),
        'escaping report': variant(lambda d: field(d)['components'][0].update(originReport='public/models/../x/derived-coverage.json')),
        'report in outputs': variant(lambda d: field(d)['components'][0].update(originReport='public/models/kit-v1/coverage/derived-coverage.json')),
        'not a report': variant(lambda d: field(d)['components'][0].update(originReport='public/models/dress-v1/coverage/x.json')),
    }


def node(script):
    code = f"import fs from 'node:fs'; const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));" + script % tuple(
        json.dumps((ROOT / 'scripts' / 'shader-probe' / name).as_uri()) for name in ('freeze-multipart-family.mjs',) * script.count('%s'))
    result = subprocess.run([NODE, '--input-type=module', '-e', code], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    return json.loads(result.stdout)


class Preflight(Fixture):
    def test_receipt_precedes_extraction_and_pins_the_whole_entry(self):
        seen = []

        def extract(kind, name, packages):
            seen.append(json.loads(Path(DOCS / 'frozen-baseline.json').read_text(encoding='utf-8'))[mar.FIELD])
            default_extract(kind, name, packages)
        preflight(legacy_with(extract))
        manifest = json.loads(Path(DOCS / 'family.json').read_text(encoding='utf-8'))
        entry = json.loads(Path('public/models/active/assets.json').read_text(encoding='utf-8'))['meshes'][SOCK]
        expected = {'policy': mar.POLICY, 'components': [{'source': SOCK, 'originReport': REPORT, 'entrySha256': mar.v1.entry_sha(entry),
                                                          'glbSha256': hashlib.sha256(SOCK_GLB).hexdigest(),
                                                          'maskSha256': hashlib.sha256(SOCK_MASK).hexdigest(), 'originReportSha256': sha(REPORT)}]}
        self.assertEqual((seen, manifest[mar.FIELD]), ([expected], expected))
        self.assertIs(mp.validate_manifest(manifest), manifest)
        fam = mp.MultipartFamily(DOCS / 'family.json', legacy=legacy_with())
        self.assertEqual((fam.REUSED, fam.NEW_SOURCES), ([SOCK], [SHOE]))
        fam._require_configuration()
        preflight()  # a resumed preflight compares the receipt and changes nothing
        if NODE:  # the freeze re-derives the same receipt and whole-entry hash from the files
            write('cfg.json', manifest)
            out = node("import {familyConfig} from %s; import {assertComponentReuse} from '" +
                       (ROOT / 'scripts/shader-probe/multipart-active-reuse.mjs').as_uri() + "';"
                       "const cfg = familyConfig(read('cfg.json')); console.log(JSON.stringify(assertComponentReuse(cfg, read('_docs/kit/cohort.json')).receipt));")
            self.assertEqual(out, expected)
            Path(DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png').write_bytes(SOCK_MASK + b'!')
            with self.assertRaisesRegex(AssertionError, 'differs from the manifest|does not prove'):
                node(f"import {{familyConfig}} from %s; import {{assertComponentReuse}} from '{(ROOT / 'scripts/shader-probe/multipart-active-reuse.mjs').as_uri()}';"
                     "assertComponentReuse(familyConfig(read('cfg.json')), read('_docs/kit/cohort.json')); console.log('{}');")

    def test_mutations_before_and_during_extraction_fail(self):
        mask, glb = Path(DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png'), Path(DRESS, 'meshes', 'SK_Socks_Quarter_M.glb')

        def during(change):
            def extract(kind, name, packages):
                default_extract(kind, name, packages)
                change()
            return legacy_with(extract)
        cases = {
            'mask during extraction': (during(lambda: mask.write_bytes(b'sock mask byteS')), 'changed since the early receipt|does not prove'),
            'glb during extraction': (during(lambda: glb.write_bytes(b'x')), 'sha256 of'),
            'report during extraction': (during(lambda: write(REPORT, origin_report(indexFolder='x'))), 'changed since'),
            'unknown entry field': (during(lambda: edit('public/models/active/assets.json', lambda d: d['meshes'][SOCK].update(x=1))), 'changed since frozen'),
            'fresh GLB differs': (legacy_with(build=lambda dto, out: default_build(dto, out, b'other')), 'not byte-identical'),
            'fresh slot differs': (during(lambda: edit(WORK / 'source/meshes-01/SK_Socks_Quarter_M.mesh.json',
                                                       lambda d: d['slots'][0].update(material=M('MI_Other')))), 'slot'),
        }
        for name, (legacy, message) in cases.items():
            with self.subTest(name):
                reset(self)
                with self.assertRaisesRegex(SystemExit, message):
                    preflight(legacy)
                self.assertFalse((DOCS / 'family.json').exists())

    def test_resume_never_repins(self):
        preflight()
        Path(DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png').write_bytes(b'sock mask bytez')
        with self.assertRaisesRegex(SystemExit, 'never repinned|does not prove'):
            preflight()
        reset(self)
        preflight()
        edit(DOCS / 'frozen-baseline.json', lambda d: d.pop(mar.FIELD))
        with self.assertRaisesRegex(SystemExit, 'without the early receipt'):
            preflight()
        reset(self)
        default_extract('assets', 'meshes-01', [])  # an extraction that no receipt precedes
        with self.assertRaisesRegex(SystemExit, 'without an early receipt'):
            preflight()

    def test_origin_and_identity_gates_fail_before_extraction(self):
        extract = mock.Mock()
        cases = {
            'tags': (lambda: edit('manifests/request.json', lambda d: d.update(fittingTags=TAGS[:1])), 'applied fitting tags'),
            'body': (lambda: (Path('public') / pf.FITTED_BODY).write_text('// other body\n'), 'body'),
            'helper': (lambda: pf.HELPER.write_text('// other helper\n'), 'helper'),
            'generator': (lambda: pf.GENERATOR.write_text('// other generator\n'), 'generator'),
            'settings missing': (lambda: edit(REPORT, lambda d: d['occlusionPolicy'].pop('settings')), 'settings'),
            'report uvTiles': (lambda: edit(REPORT, lambda d: d['records'][1].update(uvTiles=[2])), 'uvTiles'),
            'incomplete poses': (lambda: edit(REPORT, lambda d: d['records'][1]['poseCounts'].pop()), 'A/idle'),
            'report missing': (lambda: os.remove(REPORT), 'missing'),
            'case-variant url': (lambda: edit('public/models/active/assets.json', lambda d: d['meshes'][SOCK].update(
                url='../dress-v1/meshes/sk_socks_quarter_m.glb')), 'exact on-disk case'),
            'shoe active by case': (lambda: edit('public/models/active/assets.json', lambda d: d['meshes'].update({SHOE.lower(): {}})), 'undeclared'),
            'material active by case': (lambda: edit('public/models/active/assets.json', lambda d: d['materials'].update({M('MI_Wool_Gray').upper(): 'x'})), 'material reuse'),
            'sock case duplicate': (lambda: edit('public/models/active/assets.json', lambda d: d['meshes'].update({SOCK.upper(): {}})), 'exactly one active'),
            'declared not active': (lambda: edit('public/models/active/assets.json', lambda d: d['meshes'].pop(SOCK)), 'exactly one active'),
        }
        for name, (change, message) in cases.items():
            with self.subTest(name):
                reset(self)
                change()
                with self.assertRaisesRegex(SystemExit, message):
                    preflight(legacy_with(extract))
                extract.assert_not_called()

    def test_absent_field_keeps_the_v2_refusal(self):
        write('manifests/request.json', request(None))
        extract = mock.Mock()
        with self.assertRaisesRegex(SystemExit, 'Already-active mesh/material reuse'):
            preflight(legacy_with(extract))
        extract.assert_not_called()
        self.assertEqual(json.loads((DOCS / 'frozen-baseline.json').read_text(encoding='utf-8')).keys(), {'hashes'})


def reset(case):
    os.chdir(case.cwd)
    shutil.rmtree(case.tmp)
    os.makedirs(case.tmp)
    os.chdir(case.tmp)
    fixture()


class Stages(Fixture):
    """The pinned family's preview, coverage and hook checks on a preview the shared stage would write."""
    def family(self, legacy=None):
        preflight()
        fam = mp.MultipartFamily(DOCS / 'family.json', legacy=legacy or legacy_with())
        write(DOCS / 'adapter-baseline.json', {'manifestSha256': fam.sha, 'hashes': fam._active_hashes(), 'unadvertisedStructurallyReady': [],
                                               'counts': {'advertised': 1, 'indexed': 2, 'catalog': 5, 'structural': 1}, mar.FIELD: fam.COMPONENT_REUSE})
        for name in mp.INDEX_FILES:
            (fam.WORK / 'active-before').mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fam.ACTIVE / name, fam.WORK / 'active-before' / name)
        active = json.loads((fam.ACTIVE / 'assets.json').read_text(encoding='utf-8'))
        implemented = [i for i, _ in ITEMS]
        materials = {m for _, ms in ITEMS for m in ms}
        write(fam.PREVIEW / 'assets.json', {**active, 'meshes': {**active['meshes'], SHOE: {'url': '../kit-v1/meshes/SK_Sneakers_M.glb',
                                                                                             'bodyMaskUrl': '../kit-v1/coverage/SK_Sneakers_M.bodymask.png'}},
                                            'materials': {**active['materials'], **{m: f'../kit-v1/materials/{mp.short(m)}.json' for m in materials}}})
        write(fam.PREVIEW / 'skin-pairs.json', {'items': {'c1': {}}})
        write(fam.PREVIEW / 'supported-items.json', {'items': ['c0', *implemented], 'ready': [{'id': i} for i in ('c0', *implemented)],
                                                     'exceptions': [], 'meta': {'k': 1}})
        return fam, {'implemented': implemented}

    def test_preview_keeps_the_pinned_entry_and_only_adds_new_identities(self):
        fam, preview = self.family()
        fam._require_preserved_entries(preview)
        fam._require_unrelated_masks()
        fam._baseline()
        corruptions = {
            'rewritten url': lambda d: d['meshes'][SOCK].update(url='../kit-v1/meshes/SK_Socks_Quarter_M.glb'),
            'uv tiles': lambda d: d['meshes'][SOCK].update(bodyMaskUvTiles=[2]),
            'dropped unknown field': lambda d: d['meshes'][SOCK].pop('futureField'),
            'slot': lambda d: d['meshes'][SOCK]['slots'][0].update(material=M('MI_Wool_Gray')),
            'material variants': lambda d: d.update(materialVariants={'v': 2}),
            'unknown top field': lambda d: d.update(futureTop=[2]),
            'reused removed': lambda d: d['meshes'].pop(SOCK),
        }
        original = (fam.PREVIEW / 'assets.json').read_text(encoding='utf-8')
        for name, change in corruptions.items():
            with self.subTest(name):
                (fam.PREVIEW / 'assets.json').write_text(original, encoding='utf-8')
                edit(fam.PREVIEW / 'assets.json', change)
                with self.assertRaises(SystemExit):
                    fam._require_preserved_entries(preview)
                    fam._require_unrelated_masks()
        (fam.PREVIEW / 'assets.json').write_text(original, encoding='utf-8')
        edit(fam.PREVIEW / 'supported-items.json', lambda d: d.update(meta={'k': 2}))
        with self.assertRaisesRegex(SystemExit, 'metadata'):
            fam._require_preserved_entries(preview)

    def test_accepted_files_and_receipts_are_replayed(self):
        fam, preview = self.family()
        for name, change, message in (
                ('accepted mask', lambda: Path(DRESS, 'coverage', 'SK_Socks_Quarter_M.bodymask.png').write_bytes(b'x'), 'accepted files changed'),
                ('snapshot entry', lambda: edit(fam.WORK / 'active-before' / 'assets.json', lambda d: d['meshes'][SOCK].update(y=1)), 'not the frozen'),
                ('receipt', lambda: edit(DOCS / 'frozen-baseline.json', lambda d: d[mar.FIELD]['components'][0].update(maskSha256='0' * 64)), 'early receipt'),
                ('adapter pin', lambda: edit(DOCS / 'adapter-baseline.json', lambda d: d.pop(mar.FIELD)), 'receipt')):
            with self.subTest(name):
                fam, preview = (reset(self), self.family())[1]
                change()
                with self.assertRaisesRegex(SystemExit, message):
                    fam._baseline()
                    fam._require_preserved_entries(preview)

    def test_fresh_derivation_must_reproduce_the_active_mask(self):
        fam, _ = self.family()
        entries = fam._reused_entries()
        receipt = fam.COMPONENT_REUSE
        fresh = origin_report(indexFolder=fam.PREVIEW.as_posix())
        good = [{'source': SOCK, 'meshSha256': receipt['components'][0]['glbSha256'], 'maskSha256': receipt['components'][0]['maskSha256'],
                 'uvTiles': [2, 1]}]
        mar.require_fresh(receipt, entries, fresh, good)
        for name, report, components, message in (
                ('one pixel', fresh, [{**good[0], 'maskSha256': hashlib.sha256(SOCK_MASK + b'\x01').hexdigest()}], 'differs from the pinned active mask'),
                ('uv tiles', fresh, [{**good[0], 'uvTiles': [2]}], 'UV tiles'),
                ('settings', {**fresh, 'occlusionPolicy': {**fresh['occlusionPolicy'], 'settings': {'azimuths': 4}}}, good, 'settings'),
                ('missing record', fresh, [], 'differs')):
            with self.subTest(name), self.assertRaisesRegex(SystemExit, message):
                mar.require_fresh(receipt, entries, report, components)

    def test_index_hook_keeps_only_the_pinned_entry_and_does_not_leak(self):
        shared = []
        fam, _ = self.family(legacy_with(shared=shared))
        hook = fam.s.ACTIVE_MESH_REUSE
        sock = {'sha256': hashlib.sha256(SOCK_GLB).hexdigest(), 'slots': SOCK_SLOTS, 'kind': 'skeletal'}
        self.assertEqual(hook({SHOE: {}, SOCK: sock}, {SOCK: sock}), {SOCK})
        for added, active in (({SOCK: sock}, {SOCK: sock}), ({SHOE: {}, SOCK: {**sock, 'sha256': 'f' * 64}}, {SOCK: sock}),
                              ({SHOE: {}, SOCK: sock}, {SOCK: sock, SHOE.upper(): {}})):
            with self.assertRaises(SystemExit):
                hook(added, active)
        manifest = json.loads((DOCS / 'family.json').read_text(encoding='utf-8'))
        manifest.pop(mar.FIELD)
        write('manifests/plain.json', manifest)
        plain = mp.MultipartFamily('manifests/plain.json', legacy=legacy_with(shared=shared))
        self.assertEqual(plain.NEW_SOURCES, [SHOE, SOCK])
        with self.assertRaisesRegex(SystemExit, 'stage hooks'):
            plain._require_configuration()  # the earlier reuse hook on the shared stage module is refused


if __name__ == '__main__':
    unittest.main()
