"""Synthetic contracts for the opt-in schemaVersion 2 activeMaterialReuse slice; no game assets, GPU or browser.

Reuses the literal fixtures of tests/test_multipart_active_reuse.py (a declared reused sock component) and adds one
active material bundle. Uses the real preflight write-once helper, family checks, index hook and Node freeze module.

  python -B tests/test_multipart_material_reuse.py -v
"""
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('multipart_active_reuse_fixtures', ROOT / 'tests' / 'test_multipart_active_reuse.py')
t = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(t)
mp, mar, NODE = t.mp, t.mar, t.NODE
mmr = mp.mmr
WOOL, SHOE_A = t.M('MI_Wool_Gray'), t.M('MI_Shoe_A')
OLD = Path('public/models/dress-v1/materials')
FRESH = Path('public/models/kit-v1/staging')
TEXTURES = {'aa11.rgba.gz.bin': b'gz texels one', 'bb22.rgba.gz.bin': b'gz texels two'}


def manifest(**changes):
    doc = {'formatVersion': 1, 'itemId': 'mi-wool-gray', 'shader': 'mi-wool-gray.glsl', 'futureMaterial': {'k': 0.5},
           'textures': [{'slot': 't10', 'id': n[:4], 'file': n, 'array': False, 'depth': 1, 'srgb': True, 'wrapS': 'TA_Wrap',
                         'wrapT': 'TA_Wrap', 'mips': [{'width': 2, 'height': 2, 'offset': 0, 'bytes': 16}],
                         'sha256': 'f' * 64, 'source': '/Game/T/' + n, 'sourceFormat': 'PF_DXT1'} for n in TEXTURES],
           'shaderSha256': 'a' * 64, 'assemblySha256': 'b' * 64}
    doc.update(changes)
    return doc


def write_bundle(folder, name='mi-wool-gray.json', doc=None):
    folder = Path(folder)
    t.write(folder / name, doc or manifest())
    (folder / 'mi-wool-gray.glsl').write_bytes(b'void main() {}\n')
    for n, data in TEXTURES.items():
        (folder / n).write_bytes(data)


def request(materials=(WOOL,)):
    doc = t.request()
    if materials is not None:
        doc[mmr.FIELD] = {'policy': mmr.POLICY, 'materials': [{'source': m} for m in materials]}
    return doc


def fixture(materials=(WOOL,)):
    """On top of the component fixture t.Fixture.setUp wrote: one active material bundle and the request."""
    write_bundle(OLD)
    t.edit('public/models/active/assets.json', lambda d: d['materials'].update({WOOL: '../dress-v1/materials/mi-wool-gray.json'}))
    t.write('manifests/request.json', request(materials))


def preflight(legacy=None):
    with mock.patch.object(mp.MultipartFamily, 'mesh'):
        return mp.preflight('manifests/request.json', legacy=legacy or t.legacy_with())


def expected_pin(folder=OLD):
    data = (folder / 'mi-wool-gray.json').read_bytes()
    files = {'mi-wool-gray.json': hashlib.sha256(data).hexdigest(), 'mi-wool-gray.glsl': hashlib.sha256(b'void main() {}\n').hexdigest(),
             **{n: hashlib.sha256(b).hexdigest() for n, b in TEXTURES.items()}}
    return {'source': WOOL, 'entrySha256': mar.v1.entry_sha('../dress-v1/materials/mi-wool-gray.json'),
            'manifestSha256': hashlib.sha256(data).hexdigest(), 'canonicalSha256': mar.v1.entry_sha(json.loads(data)), 'files': files}


def hashes():
    return {'public/models/active/assets.json': t.sha('public/models/active/assets.json')}


def node(script):
    urls = {k: json.dumps((ROOT / 'scripts' / 'shader-probe' / f).as_uri()) for k, f in
            (('FREEZE', 'freeze-multipart-family.mjs'), ('MATERIALS', 'multipart-material-reuse.mjs'))}
    code = "import fs from 'node:fs'; const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));" + script
    for k, v in urls.items():
        code = code.replace(k, v)
    result = subprocess.run([NODE, '--input-type=module', '-e', code], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    return json.loads(result.stdout)


class Fixture(t.Fixture):
    def setUp(self):
        super().setUp()
        fixture()

    def reset(self, materials=(WOOL,)):
        self.tearDown()
        t.Fixture.setUp(self)
        fixture(materials)


class Contract(Fixture):
    def test_field_shapes_match_in_python_and_node(self):
        mp.validate_manifest(request(), pinned=False)
        field = lambda d: d[mmr.FIELD]
        variant = lambda change: (lambda d: (change(d), d)[1])(request((t.M('MI_Shoe_A'), WOOL)))
        cases = {'without component reuse': (lambda d: (d.pop(mar.FIELD), d)[1])(request()),
                 'unknown key': variant(lambda d: field(d).update(materialVariants={})),
                 'unsorted': variant(lambda d: field(d)['materials'].reverse()),
                 'case duplicate': variant(lambda d: field(d)['materials'][0].update(source=WOOL.replace('Wool', 'wool'))),
                 'request pins': variant(lambda d: field(d)['materials'][0].update(entrySha256='a' * 64)),
                 'policy': variant(lambda d: field(d).update(policy='exact-active-component-v1')),
                 'empty': variant(lambda d: field(d).update(materials=[])),
                 'not a material path': variant(lambda d: field(d)['materials'][0].update(source='/Game/X/MI_A.MI_B'))}
        for name, doc in cases.items():
            with self.subTest(name), self.assertRaises(SystemExit):
                mp.validate_manifest(doc, pinned=False)
        if not NODE:
            self.skipTest('node is not available')
        t.write('cases.json', {'ok': request(), 'cases': cases})
        out = node("import {validateManifest} from FREEZE; const c = read('cases.json');"
                   "const ok = d => { try { validateManifest(d, false); return true; } catch { return false; } };"
                   "console.log(JSON.stringify({ok: ok(c.ok), cases: Object.fromEntries(Object.entries(c.cases).map(([k, d]) => [k, ok(d)]))}));")
        self.assertEqual(out, {'ok': True, 'cases': {k: False for k in cases}})

    def test_absent_field_and_undeclared_or_case_overlaps_refuse_before_extraction(self):
        extracted = []
        legacy = t.legacy_with(lambda *a: extracted.append(a))
        for name, materials, change, message in (
                ('absent field keeps the refusal', None, None, 'out of this slice'),
                ('undeclared already-active material', (WOOL,), lambda d: d['materials'].update({SHOE_A: 'x.json'}), 'out of this slice'),
                ('case variant of an undeclared material', (WOOL,), lambda d: d['materials'].update({SHOE_A.upper(): 'x.json'}), 'out of this slice'),
                ('case collision of the declared source', (WOOL,), lambda d: d['materials'].update({WOOL.lower(): 'x.json'}), 'exactly one active'),
                ('every material reused', tuple(sorted({m for _, ms in t.ITEMS for m in ms})), lambda d: d['materials'].update(
                    {m: '../dress-v1/materials/mi-wool-gray.json' for _, ms in t.ITEMS for m in ms}), 'at least one material')):
            with self.subTest(name):
                self.reset(materials)
                if change:
                    t.edit('public/models/active/assets.json', change)
                with self.assertRaisesRegex(SystemExit, message):
                    preflight(legacy)
                self.assertEqual(extracted, [])

    def test_bundle_paths_formats_and_bindings_fail_closed(self):
        cohort = json.loads((t.DOCS / 'cohort.json').read_text(encoding='utf-8'))
        mmr.early_pins(request(), hashes(), cohort)
        for name, change in {
                'unknown format': lambda: t.write(OLD / 'mi-wool-gray.json', manifest(formatVersion=2)),
                'unknown texture format': lambda: t.write(OLD / 'mi-wool-gray.json', manifest(shader='mi-wool-gray.png')),
                'shader traversal': lambda: t.write(OLD / 'mi-wool-gray.json', manifest(shader='../mi-wool-gray.glsl')),
                'texture subfolder': lambda: t.edit(OLD / 'mi-wool-gray.json', lambda d: d['textures'][0].update(file='x/aa11.rgba.gz.bin')),
                'missing texture file': lambda: (OLD / 'bb22.rgba.gz.bin').unlink(),
                'wrong-case texture file': lambda: t.edit(OLD / 'mi-wool-gray.json', lambda d: d['textures'][0].update(file='AA11.rgba.gz.bin')),
                'case-alias references': lambda: t.edit(OLD / 'mi-wool-gray.json', lambda d: d['textures'].append({**d['textures'][0], 'file': 'Aa11.rgba.gz.bin'})),
                'escaping binding': lambda: t.edit('public/models/active/assets.json', lambda d: d['materials'].update({WOOL: '../../../x.json'})),
                'object binding': lambda: t.edit('public/models/active/assets.json', lambda d: d['materials'].update({WOOL: {'url': 'x.json'}})),
                'missing bundle': lambda: shutil.rmtree(OLD)}.items():
            with self.subTest(name):
                self.reset()
                change()
                with self.assertRaises(SystemExit):
                    mmr.early_pins(request(), hashes(), cohort)


class Preflight(Fixture):
    def test_pins_precede_extraction_and_node_rederives_the_same_receipt(self):
        seen = []

        def extract(kind, name, packages):
            seen.append(json.loads((t.DOCS / 'frozen-baseline.json').read_text(encoding='utf-8'))[mmr.FIELD])
            t.default_extract(kind, name, packages)
        preflight(t.legacy_with(extract))
        family = json.loads((t.DOCS / 'family.json').read_text(encoding='utf-8'))
        expected = {'policy': mmr.POLICY, 'materials': [expected_pin()]}
        self.assertEqual((seen, family[mmr.FIELD]), ([expected], expected))
        self.assertNotEqual(expected_pin()['files']['aa11.rgba.gz.bin'], manifest()['textures'][0]['sha256'])  # file bytes, not texels
        if not NODE:
            self.skipTest('node is not available')
        script = ("import {familyConfig} from FREEZE; import {assertMaterialReuse} from MATERIALS;"
                  "const cfg = familyConfig(read('_docs/kit/family.json'));"
                  "let bad = null; try { assertMaterialReuse(cfg, read('_docs/kit/cohort.json')); } catch (e) { bad = e.message; }"
                  "console.log(JSON.stringify(bad));")
        self.assertIsNone(node(script))
        (OLD / 'bb22.rgba.gz.bin').write_bytes(b'gz texels two!')
        self.assertIn('differs from the manifest', node(script))

    def test_mutations_during_extraction_and_resumes_fail(self):
        for name in ('mi-wool-gray.json', 'mi-wool-gray.glsl', 'aa11.rgba.gz.bin'):
            with self.subTest(name):
                self.reset()

                def extract(kind, folder, packages, name=name):
                    (OLD / name).write_bytes((OLD / name).read_bytes() + b' ')  # the active index itself is unchanged
                    t.default_extract(kind, folder, packages)
                with self.assertRaisesRegex(SystemExit, 'changed since the early receipt'):
                    preflight(t.legacy_with(extract))
        self.reset()
        fam = mp.MultipartFamily('manifests/request.json', t.legacy_with(), pinned=False)
        pinned = fam._active_hashes()  # a component receipt saved without the material receipt: never completed later
        receipt = mar.early_pins(fam.m, pinned, fam._current_inputs(), json.loads((t.DOCS / 'cohort.json').read_text(encoding='utf-8')))
        t.write(t.DOCS / 'frozen-baseline.json', {'hashes': pinned, mar.FIELD: receipt})
        with self.assertRaisesRegex(SystemExit, 'never taken after the fact'):
            preflight()
        self.reset()
        preflight()
        (OLD / 'aa11.rgba.gz.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(SystemExit, 'never repinned'):
            preflight()


class Stages(Fixture):
    def family(self, legacy=None):
        preflight()
        fam = mp.MultipartFamily(t.DOCS / 'family.json', legacy=legacy or t.legacy_with())
        t.write(t.DOCS / 'adapter-baseline.json', {'manifestSha256': fam.sha, 'hashes': fam._active_hashes(), 'unadvertisedStructurallyReady': [],
                                                   'counts': {'advertised': 1, 'indexed': 2, 'catalog': 5, 'structural': 1},
                                                   mar.FIELD: fam.COMPONENT_REUSE, mmr.FIELD: fam.MATERIAL_REUSE})
        for name in mp.INDEX_FILES:
            (fam.WORK / 'active-before').mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fam.ACTIVE / name, fam.WORK / 'active-before' / name)
        active = json.loads((fam.ACTIVE / 'assets.json').read_text(encoding='utf-8'))
        implemented = [i for i, _ in t.ITEMS]
        new = {m: f'../kit-v1/materials/{mp.short(m)}.json' for _, ms in t.ITEMS for m in ms if m != WOOL}
        t.write(fam.PREVIEW / 'assets.json', {**active, 'meshes': {**active['meshes'], t.SHOE: {'url': '../kit-v1/meshes/SK_Sneakers_M.glb'}},
                                              'materials': {**active['materials'], **new}})
        t.write(fam.PREVIEW / 'skin-pairs.json', {'items': {'c1': {}}})
        t.write(fam.PREVIEW / 'supported-items.json', {'items': ['c0', *implemented], 'ready': [{'id': i} for i in ('c0', *implemented)],
                                                       'exceptions': [], 'meta': {'k': 1}})
        return fam, {'implemented': implemented}

    def test_fresh_compiled_bundle_must_be_identical(self):
        receipt = mmr.early_pins(request(), hashes(), json.loads((t.DOCS / 'cohort.json').read_text(encoding='utf-8')))
        proof = lambda: mmr.fresh_proof(receipt, FRESH, [{'source': WOOL, 'instance': 'I'}], lambda i: 'mi-wool-gray')
        write_bundle(FRESH)
        mmr.require_identical(proof())
        self.assertEqual(proof()['materials'][0]['files'], expected_pin(FRESH)['files'])
        for name, change in {
                'unknown field': lambda: t.edit(FRESH / 'mi-wool-gray.json', lambda d: d.update(extra=1)),
                'sampler wrap': lambda: t.edit(FRESH / 'mi-wool-gray.json', lambda d: d['textures'][0].update(wrapS='TA_Clamp')),
                'sRGB': lambda: t.edit(FRESH / 'mi-wool-gray.json', lambda d: d['textures'][1].update(srgb=False)),
                'mip': lambda: t.edit(FRESH / 'mi-wool-gray.json', lambda d: d['textures'][0]['mips'][0].update(bytes=15)),
                'shader bytes': lambda: (FRESH / 'mi-wool-gray.glsl').write_bytes(b'void main() { }\n'),
                'texture bytes': lambda: (FRESH / 'bb22.rgba.gz.bin').write_bytes(b'gz texels 2'),
                'not built': lambda: (FRESH / 'mi-wool-gray.json').unlink()}.items():
            with self.subTest(name):
                shutil.rmtree(FRESH, ignore_errors=True)
                write_bundle(FRESH)
                change()
                before = {p.name: p.read_bytes() for p in FRESH.iterdir()}
                with self.assertRaisesRegex(SystemExit, 'differ from the pinned'):
                    mmr.require_identical(proof())
                self.assertEqual({p.name: p.read_bytes() for p in FRESH.iterdir()}, before)  # fresh outputs are kept

    def test_index_hook_keeps_the_exact_old_binding_and_refuses_leaks(self):
        shared = []
        fam, preview = self.family(t.legacy_with(shared=shared))
        write_bundle('public/models/kit-v1/materials')
        hook = fam.s.ACTIVE_MATERIAL_REUSE
        old = {WOOL: '../dress-v1/materials/mi-wool-gray.json', t.M('MI_Cotton'): 'c.json'}
        added = {WOOL: '../kit-v1/materials/mi-wool-gray.json', SHOE_A: '../kit-v1/materials/mi-shoe-a.json'}
        self.assertEqual(hook(added, old, fam.PREVIEW), {WOOL})
        for name, args in {'other preview (leak)': (added, old, Path('public/models/other')),
                           'undeclared overlap': (added, {**old, SHOE_A: 'x.json'}, fam.PREVIEW),
                           'case collision': (added, {**old, WOOL.upper(): 'x.json'}, fam.PREVIEW),
                           'declared not validated': ({SHOE_A: added[SHOE_A]}, old, fam.PREVIEW)}.items():
            with self.subTest(name), self.assertRaises(SystemExit):
                hook(*args)
        (Path('public/models/kit-v1/materials') / 'aa11.rgba.gz.bin').write_bytes(b'x')
        with self.assertRaisesRegex(SystemExit, 'differs from the pinned'):
            hook(added, old, fam.PREVIEW)
        fam._require_preserved_entries(preview)  # kept binding: exact old URL, unknown and variant fields untouched
        self.assertEqual(set(fam._build_hashes()) - set(super(mp.MultipartFamily, fam)._build_hashes()), {(fam.WORK / mmr.PROOF).as_posix()})
        plain_doc = json.loads((t.DOCS / 'family.json').read_text(encoding='utf-8'))
        plain_doc.pop(mmr.FIELD)
        t.write('manifests/plain.json', plain_doc)
        plain = mp.MultipartFamily('manifests/plain.json', legacy=t.legacy_with(shared=shared))
        self.assertEqual(plain._build_hashes().keys(), super(mp.MultipartFamily, plain)._build_hashes().keys())
        with self.assertRaisesRegex(SystemExit, 'stage hooks'):
            plain._require_configuration()  # the earlier material hook on the shared stage module is refused

    def test_preview_and_replay_keep_pins(self):
        fam, preview = self.family()
        original = (fam.PREVIEW / 'assets.json').read_text(encoding='utf-8')
        for name, change, message in (
                ('kept binding repointed to the fresh copy', lambda: t.edit(fam.PREVIEW / 'assets.json', lambda d: d['materials'].update(
                    {WOOL: '../kit-v1/materials/mi-wool-gray.json'})), 'pre-existing materials'),
                ('kept binding removed', lambda: t.edit(fam.PREVIEW / 'assets.json', lambda d: d['materials'].pop(WOOL)), 'exactly the implemented'),
                ('material variants', lambda: t.edit(fam.PREVIEW / 'assets.json', lambda d: d.update(materialVariants={'v': 2})), 'materialVariants'),
                ('old texture mutated, index unchanged', lambda: (OLD / 'aa11.rgba.gz.bin').write_bytes(b'x'), 'accepted bundle files changed'),
                ('adapter pin dropped', lambda: t.edit(t.DOCS / 'adapter-baseline.json', lambda d: d.pop(mmr.FIELD)), 'activeMaterialReuse receipt')):
            with self.subTest(name):
                (fam.PREVIEW / 'assets.json').write_text(original, encoding='utf-8')
                write_bundle(OLD)
                t.write(t.DOCS / 'adapter-baseline.json', {**json.loads((t.DOCS / 'adapter-baseline.json').read_text(encoding='utf-8')),
                                                           mmr.FIELD: fam.MATERIAL_REUSE})
                change()
                with self.assertRaisesRegex(SystemExit, message):
                    fam._baseline()
                    fam._require_preserved_entries(preview)


if __name__ == '__main__':
    unittest.main()
