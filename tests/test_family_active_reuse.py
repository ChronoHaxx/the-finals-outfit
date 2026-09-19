"""Opt-in activeMeshReuse through the real shared index stage, without game assets.

prepare-large-sneakers.py is loaded unchanged from a private copy beside two placeholder siblings; its `d` is the
test_family_runner stub plus a small rebasing index, resolver and assembly builder.

  python -B tests/test_family_active_reuse.py -v
"""
import importlib.util
import json
import hashlib
import os
import random
import shutil
import struct
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts' / 'shader-probe'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


tfr = load('test_family_runner_for_reuse', ROOT / 'tests' / 'test_family_runner.py')
pf, write, sha, reuse = tfr.pf, tfr.write, tfr.sha, tfr.pf.reuse
DOCS = Path('_docs/glove-a')
ACTIVE, OLD, OTHER, MI_O = Path('public/models/active'), 'public/models/old-glove-v1', '/Game/Other/SK_O.SK_O', '/Game/Other/MI_O.MI_O'
DEFAULT = '/Game/Fam/glove-a/M_Default.M_Default'
URL_KEYS = ('url', 'bodyMaskUrl')
read = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
# The two accepted integer-only entries (active-mesh-reuse-proof-2026-09-18) and their accepted entrySha256 pins.
ACCEPTED = [({'url': '../reconstructed-family-batch08-tactical-boots-pouch-v1/meshes/SK_Military_TacticalBootsPouch_M.glb',
              'sha256': '85b010df5891d07a93ea7f0b17da53355ccd9a4af565cda0fd720201c969704c', 'kind': 'skeletal',
              'slots': [{'slot': 'TacticalBootsPouch', 'material': '/Game/Discovery/Characters/Military/Assets/TacticalBootsPouch/'
                         'MI_TacticalBootsPouch_TacticalBootsPouch.MI_TacticalBootsPouch_TacticalBootsPouch'}],
              'bodyMaskUrl': '../reconstructed-family-batch08-tactical-boots-pouch-v1/coverage/SK_Military_TacticalBootsPouch_M.bodymask.png',
              'bodyMaskUvTiles': [2, 1], 'coverageSource': 'derived-projection'},
             'cf4c694b2b7a2b6abb2ec28513b75f048105c50789eff59a28c88e1dd7ac4cc4'),
            ({'url': '../reconstructed-racing-gloves-v1/meshes/SK_Racing_Gloves_M.glb',
              'sha256': '4ef9280b50dcf274e9fc6ffacae8f788465c4ab1d2454b586d0d5c8826e38b00', 'kind': 'skeletal',
              'slots': [{'slot': 'Gloves', 'material': '/Game/Discovery/Characters/Racing/Assets/Gloves/MI_Gloves_Gloves.MI_Gloves_Gloves'}],
              'bodyMaskUrl': '../reconstructed-racing-gloves-v1/coverage/SK_Racing_Gloves_M.bodymask.png',
              'bodyMaskUvTiles': [2, 1], 'coverageSource': 'derived-projection'},
             '250d19cc3749423572d2c9de53e3aa9b212003228488fedeec8976b9d711aa75')]
# prepare-large-sneakers.py as preflight-family.py sees it; mesh() is the extraction, which may change files meanwhile.
LEGACY_STUB = '''import json, types
from pathlib import Path
DOCS = WORK = RUNTIME = PREVIEW = MESH_REPORT = None
read = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
def configure(batch, work, runtime, preview):
    d.SOURCE = Path(work) / 'source'
def slots(folder, record):
    dto = read(Path(folder) / record['meshFile'])
    return [{'slot': s['MaterialSlotName'], 'material': m['path']} for s, m in zip(dto['sourceMaterials'], dto['materials'])]
d = types.SimpleNamespace(configure=configure, dto_slots=slots, mesh_verifier=types.SimpleNamespace(verify=lambda dto, glb: {'passed': True}))
def mesh():
    plan = read('extraction.json')
    plan['sawBaseline'] = read(DOCS / 'frozen-baseline.json') if (DOCS / 'frozen-baseline.json').is_file() else None
    for path, text in plan['writes'].items():
        Path(path).write_bytes(text.encode())
    Path('extraction.json').write_text(json.dumps(plan), encoding='utf-8')
    MESH_REPORT.write_text(json.dumps(plan['report']), encoding='utf-8')
'''


def real_legacy(defs):
    def legacy(tag):
        folder = Path('legacy-modules') / tag
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SCRIPTS / 'prepare-large-sneakers.py', folder / 'prepare-large-sneakers.py')
        (folder / 'prepare-accessory-defaults.py').write_text('def configure(*args):\n    pass\n', encoding='utf-8')
        (folder / 'check-material-batch.py').write_text('', encoding='utf-8')
        s = load('legacy_' + tag.replace('-', '_'), folder / 'prepare-large-sneakers.py')
        s.d = extend(tfr.stub_legacy(tag).d, s, defs)
        return s
    return legacy


def extend(d, s, defs):
    at = lambda root, url: Path(os.path.normpath(Path(root) / url))

    class Rebaser:
        def __init__(self, source, target):
            self.source, self.target, self.missing = source, target, []

        def __call__(self, url):
            if not at(self.source, url).is_file():
                self.missing.append(url)
            return Path(os.path.relpath(at(self.source, url), self.target)).as_posix()

    def rebase_assets(doc, rb):
        out = json.loads(json.dumps(doc))
        for entry in out['meshes'].values():
            entry.update({k: rb(entry[k]) for k in URL_KEYS if k in entry})
        out['materials'] = {k: rb(v) for k, v in out['materials'].items()}
        return out

    def shape(value, root, key=None):
        if isinstance(value, dict):
            return {k: shape(v, root, k) for k, v in value.items()}
        if isinstance(value, list):
            return [shape(v, root, key) for v in value]
        return at(root, value).as_posix() if isinstance(value, str) and (key in URL_KEYS or value.endswith('.json')) else value

    def resolve_items(assets_path, out):
        assets = read(assets_path)
        ready = [{'id': i, 'mesh': m, 'material': t} for i, (m, t) in sorted(defs.items()) if m in assets['meshes'] and t in assets['materials']]
        write(out, {'ready': ready})
        return {'ready': ready}

    def stage_meshes(meshes):
        report = read(s.MESH_REPORT)
        (s.RUNTIME / 'meshes').mkdir(parents=True, exist_ok=True)
        shutil.copyfile(report['glb'], s.RUNTIME / 'meshes' / report['file'])
        write(s.RUNTIME / 'meshes' / 'meshes.json', [{'source': min(meshes), 'file': report['file'], 'sha256': report['sha256']}])

    def stage_materials(jobs):
        by_job = {d.job_id(r['instance']): r['source'] for r in read(d.SOURCE / 'material-resolution.json')}
        for job in jobs:
            write(s.RUNTIME / 'materials' / f'{job}.json', {'source': by_job[job]})

    def build(meshes, materials, working, legacy, addition_file, coverage, _):
        staged = read(s.RUNTIME / 'meshes' / 'meshes.json')[0]
        entry = {'url': 'meshes/' + staged['file'], 'sha256': staged['sha256'], 'kind': 'skeletal',
                 'slots': d.glb_slots(s.RUNTIME / 'meshes' / staged['file'])}
        if coverage:
            record = read(coverage[0] / 'derived-coverage.json')['records'][0]
            entry.update(bodyMaskUrl='coverage/' + record['file'], bodyMaskUvTiles=record['uvTiles'], coverageSource='derived-projection')
        mats = {read(p)['source']: 'materials/' + p.name for p in (s.RUNTIME / 'materials').glob('*.json')}
        write(addition_file, {'meshes': {staged['source']: entry}, 'materials': mats})

    copy = lambda doc, rb=None: json.loads(json.dumps(doc))
    helper = types.SimpleNamespace(
        accepted_ids=lambda: {j['id'] for j in read(s.WORK / 'validation' / 'passed.requests.json')},
        stage_runtime_meshes=stage_meshes, stage_runtime_materials=stage_materials, rebase_supported=copy,
        guard_preview=lambda: None, resolve_items=resolve_items,
        references=lambda assets, pairs, supported: [e[k] for e in assets['meshes'].values() for k in URL_KEYS if k in e]
        + list(assets['materials'].values()))
    d.ready_source, d.shared_helpers, d.assembly_index.build, d.LEGACY = (lambda: None), (lambda: helper), build, Path('legacy')
    d.package_identity = types.SimpleNamespace(requested_keys=lambda materials, resolution, inventory: dict(materials))
    d.exported_inventory = lambda folder: {}
    d.preview_tools = types.SimpleNamespace(Rebaser=Rebaser, rebase_assets=rebase_assets, rebase_skin_pairs=copy, resolved_shape=shape)
    return d


class ActiveMeshReuse(unittest.TestCase):
    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.mkdtemp()
        os.chdir(self.tmp)
        self.manifest, self.cohort, self.report = tfr.stage_family('glove-a', 'Gloves', 'hands', ['medium_male'], [], 3,
                                                                   mode='conservative-shared-uv')
        self.mesh = self.manifest['mesh']['source']
        for path, data in ((f'{OLD}/meshes/SK.glb', Path(self.report['glb']).read_bytes()), (f'{OLD}/coverage/SK_Gloves.bodymask.png', b'mask'),
                           (f'{OLD}/materials/default.json', b'{}'), ('public/models/other-v1/SK_O.glb', b'o'),
                           ('public/models/other-v1/m.png', b'm'), ('public/models/other-v1/mi-o.json', b'{}'),
                           (pf.GENERATOR, b'generator'), (pf.HELPER, b'helper'), (Path('public') / pf.FITTED_BODY, b'body')):
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(data)
        # The earlier accepted family: same GLB bytes, its mask, default binding and a field this runner does not know.
        self.entry = {'url': '../old-glove-v1/meshes/SK.glb', 'sha256': self.report['sha256'], 'kind': 'skeletal',
                      'slots': [{'slot': 'Gloves', 'material': DEFAULT}], 'bodyMaskUrl': '../old-glove-v1/coverage/SK_Gloves.bodymask.png',
                      'bodyMaskUvTiles': [2, 1], 'coverageSource': 'derived-projection', 'futureField': {'kept': ['as', 1]}}
        write(ACTIVE / 'assets.json', {'meshes': {self.mesh: self.entry, OTHER: {
            'url': '../other-v1/SK_O.glb', 'sha256': 'o', 'kind': 'skeletal', 'slots': [], 'bodyMaskUrl': '../other-v1/m.png',
            'bodyMaskUvTiles': [1, 1], 'coverageSource': 'derived'}}, 'materials': {MI_O: '../other-v1/mi-o.json',
            DEFAULT: '../old-glove-v1/materials/default.json'}, 'materialVariants': {'v': {'x': 1}}})
        write(ACTIVE / 'supported-items.json', {'items': ['c0', 'c1'], 'ready': [{'id': 'c0'}, {'id': 'c1'}], 'defaults': {'hands': 'c1'},
                                                'exceptions': [{'id': 'glove-a-0', 'reason': 'no material'}, {'id': 'c9', 'reason': 'held'}]})
        write(ACTIVE / 'skin-pairs.json', {'items': {'c2': {'skin': 'x'}}})
        write('src/data/items.json', [{'id': f'c{i}'} for i in range(4)] + [{'id': i['id']} for i in self.cohort['items']])
        self.hashes = {p.as_posix(): sha(p) for p in [ACTIVE / n for n in reuse.INDEX_FILES] + [Path('src/data/items.json')]}
        self.early = reuse.early_pin(self.request(), self.hashes)  # what preflight saves before extraction
        self.baseline = {'hashes': self.hashes, reuse.FIELD: self.early}
        write('_docs/glove-a/frozen-baseline.json', self.baseline)
        self.slots = [{'slot': 'Gloves', 'material': DEFAULT}]
        self.defs = {'c0': (OTHER, MI_O), 'c1': (self.mesh, DEFAULT), 'c3': (OTHER, MI_O),
                     **{i['id']: (self.mesh, i['materials'][0]) for i in self.cohort['items']}}

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def request(self):
        return {**self.manifest, reuse.FIELD: {'policy': reuse.POLICY}}

    def family(self, opt_in=True):
        manifest = dict(self.manifest)
        if opt_in:
            manifest[reuse.FIELD] = reuse.preflight_pin(self.request(), self.report, self.slots, self.cohort, self.baseline)
        write('manifests/glove-a.json', manifest)
        fam = pf.Family('manifests/glove-a.json', legacy=real_legacy(self.defs))
        tfr.freeze_family(fam, self.cohort, self.report)
        if opt_in:  # freeze-family.mjs records the re-derived pin in the baseline
            write(fam.DOCS / 'adapter-baseline.json', {**read(fam.DOCS / 'adapter-baseline.json'), reuse.FIELD: manifest[reuse.FIELD]})
        shutil.rmtree(fam.PREVIEW)  # the real shared index stage writes the preview
        shutil.rmtree(fam.WORK / 'resolver')
        write(fam.d.SOURCE / 'material-resolution.json', [{'source': m, 'instance': m.rsplit('.', 1)[1]} for m in self.cohort['materials']])
        return fam

    def derive(self, fam, generator=None):
        with mock.patch.object(pf.subprocess, 'call', side_effect=generator or tfr.fake_generator(fam)), \
                mock.patch.object(pf.Family, '_require_app'):
            fam.coverage()

    def test_opt_in_keeps_the_whole_active_entry_and_adds_only_new_materials(self):
        fam = self.family()
        fam.index()
        preview = read(fam.PREVIEW / 'preview.json')
        self.assertEqual((preview['implemented'], preview['coverageReady'], preview['reusedActiveMeshes']), (['glove-a-0'], False, [self.mesh]))
        with self.assertRaisesRegex(SystemExit, 'coverage-complete preview'):
            fam.verify()  # the structural preview is only input to the comparison
        self.derive(fam)
        assets, supported = read(fam.PREVIEW / 'assets.json'), read(fam.PREVIEW / 'supported-items.json')
        self.assertEqual(assets['meshes'][self.mesh], self.entry)  # sibling folders: even the rebased URLs are identical
        self.assertEqual(set(assets['meshes']), {self.mesh, OTHER})
        self.assertEqual(set(assets['materials']) - {MI_O, DEFAULT}, {self.cohort['items'][0]['materials'][0]})
        self.assertEqual((supported['items'], supported['exceptions'], supported['defaults']),
                         (['c0', 'c1', 'glove-a-0'], [{'id': 'c9', 'reason': 'held'}], {'hands': 'c1'}))
        self.assertNotIn(self.mesh, read(fam.WORK / 'assets-additions.json')['meshes'])
        self.assertEqual(fam._fitted_pin('reuseCoverage')['reuseCoverage']['activeMaskSha256'], fam.REUSE['maskSha256'])
        roots = ['_docs', 'scripts', 'public', 'src', 'manifests']
        before = pf.tree_state(roots)
        fam.verify()
        self.assertEqual(pf.tree_state(roots), before)
        fam.index()  # a re-index replays the pinned comparison before and after the shared stage
        # Stale evidence afterwards: body, generator, or the reused mask/GLB bytes.
        for path, data, stage, message in ((Path('public') / pf.FITTED_BODY, b'new body', fam.verify, 'body'),
                                           (pf.GENERATOR, b'new generator', fam.index, 'generator or helper changed'),
                                           (Path(f'{OLD}/coverage/SK_Gloves.bodymask.png'), b'x', fam.verify, 'changed since preflight'),
                                           (Path(f'{OLD}/meshes/SK.glb'), b'x', fam.build, 'does not describe its GLB bytes')):
            with self.subTest(path.as_posix()):
                saved = path.read_bytes()
                path.write_bytes(data)
                with self.assertRaisesRegex(SystemExit, message):
                    stage()
                path.write_bytes(saved)
        fam.verify()

    def test_without_opt_in_the_default_duplicate_refusal_is_unchanged(self):
        fam = self.family(opt_in=False)
        self.assertIsNone(fam.s.ACTIVE_MESH_REUSE)
        with self.assertRaisesRegex(ValueError, 'Would replace existing meshes'):
            fam.index()
        self.assertFalse((fam.PREVIEW / 'assets.json').exists())
        fam.s.ACTIVE_MESH_REUSE = reuse.index_hook(self.mesh, {'glbSha256': self.report['sha256']})
        with self.assertRaisesRegex(SystemExit, 'stage hooks'):
            fam._require_configuration()

    def test_a_differing_fresh_mask_or_report_fails_closed_and_never_indexes(self):
        fam = self.family()
        fam.index()
        stem = 'SK_Gloves.bodymask.png'

        def recomputed(command, **_):
            tfr.fake_generator(fam)(command)
            out = Path(command[command.index('--output') + 1])
            (out / stem).write_bytes(b'recomputed')
            report = read(out / 'derived-coverage.json')
            report['records'][0]['sha256'] = sha(out / stem)
            write(out / 'derived-coverage.json', report)
            return 0
        cases = {'differs from the pinned active mask': recomputed,
                 'UV tiles': tfr.fake_generator(fam, lambda r: r['records'][0].update(uvTiles=[1, 1])),
                 'body': tfr.fake_generator(fam, lambda r: r.update(bodySha256='0' * 64)),
                 'pinned active GLB': tfr.fake_generator(fam, lambda r: r['records'][0].update(meshSha256='0' * 64)),
                 'unfitted': tfr.fake_generator(fam, lambda r: r.update(occlusionPolicy={'name': 'fitted-occlusion'}))}
        for message, generator in cases.items():
            with self.subTest(message):
                with self.assertRaisesRegex(SystemExit, message):
                    self.derive(fam, generator)
                self.assertIsNone(fam._fitted_pin('reuseCoverage'))
                self.assertFalse(read(fam.PREVIEW / 'preview.json')['coverageReady'])
                with self.assertRaisesRegex(SystemExit, 'without the pinned active-mask comparison'):
                    fam.index()
                with self.assertRaisesRegex(SystemExit, 'coverage-complete'):
                    fam.verify()
                shutil.rmtree(fam.RUNTIME / 'coverage')

    def test_baseline_pin_and_gpu_freshness_gate_every_stage(self):
        fam = self.family()
        baseline = read(fam.DOCS / 'adapter-baseline.json')
        write(fam.DOCS / 'adapter-baseline.json', {k: v for k, v in baseline.items() if k != reuse.FIELD})
        with self.assertRaisesRegex(SystemExit, 'activeMeshReuse pin'):
            fam.index()
        write(fam.DOCS / 'adapter-baseline.json', baseline)
        write(fam.WORK / 'requests.json', [{'id': 'rebuilt'}])
        with self.assertRaisesRegex(SystemExit, 'build changed'):
            fam.index()
        self.assertFalse((fam.PREVIEW / 'preview.json').exists())

    def test_preflight_proves_reuse_or_refuses(self):
        pin = lambda **k: reuse.preflight_pin(k.get('request', self.request()), k.get('report', self.report), k.get('slots', self.slots),
                                              k.get('cohort', self.cohort), k.get('baseline', self.baseline))
        self.assertEqual(pin()['glbSha256'], self.report['sha256'])
        item = self.cohort['items'][0]
        glb = Path(self.report['glb'])
        cases = {'slot/default': dict(slots=[{'slot': 'Gloves', 'material': MI_O}]),
                 'byte-identical': dict(report={**self.report, 'sha256': '0' * 64}),
                 'material reuse': dict(cohort={**self.cohort, 'items': [{**item, 'materials': [DEFAULT.upper()]}]}),
                 'already advertised': dict(cohort={**self.cohort, 'items': [{**item, 'id': 'c1'}]}),
                 'frozen-baseline': dict(baseline={**self.baseline, 'hashes': {**self.hashes, (ACTIVE / 'assets.json').as_posix(): '0' * 64}}),
                 'unsupported policy': dict(request={**self.manifest, reuse.FIELD: {'policy': 'by-name'}}),
                 'deferred': dict(request={**self.request(), 'coverage': {'mode': pf.FITTED_MODE}})}
        for message, change in cases.items():
            with self.subTest(message), self.assertRaisesRegex(SystemExit, message):
                pin(**change)
        assets = read(ACTIVE / 'assets.json')
        for message, entry in (('defer it', {k: v for k, v in self.entry.items() if k != 'bodyMaskUrl'}),
                               ('skeletal', {**self.entry, 'kind': 'static'}), ('outside public', {**self.entry, 'url': '../../../x.glb'})):
            with self.subTest(message), self.assertRaisesRegex(SystemExit, message):
                reuse.derive_pin({**assets, 'meshes': {self.mesh: entry}}, ACTIVE, self.mesh)
        glb.write_bytes(glb.read_bytes() + b' ')
        with self.assertRaisesRegex(SystemExit, 'byte-identical'):
            pin()

    def source_ready(self):
        """Current definitions for the cohort and no preflight evidence yet: the state before a NEW preflight."""
        lines = []
        for item in self.cohort['items']:
            package = f'Discovery/Content/Fam/{item["id"]}.uasset'
            write(Path('public/models/source/items') / f'{item["id"]}.json', {'source': package, 'sourceSha256': 'ab', 'properties': {}})
            lines.append(json.dumps({'package': {'path': package, 'sha256': 'ab'}, 'status': 'ok',
                                     'exports': [{'type': 'CharacterCustomizationItem', 'properties': {}}]}))
        records = Path('scripts/generated/shader-probe/refresh/opus-definitions-01/records.jsonl')
        records.parent.mkdir(parents=True, exist_ok=True)
        records.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        for name in ('frozen-baseline.json', 'mesh-report.json'):
            (DOCS / name).unlink()

    def preflight(self, request, writes=None):
        """The real preflight-family.py and module beside the stub, whose extraction applies writes."""
        folder = Path('preflight-copy')
        folder.mkdir(exist_ok=True)
        for name in ('preflight-family.py', 'family_active_reuse.py'):
            shutil.copyfile(SCRIPTS / name, folder / name)
        (folder / 'prepare-large-sneakers.py').write_text(LEGACY_STUB, encoding='utf-8')
        write('extraction.json', {'writes': writes or {}, 'report': self.report})
        write('manifests/request.json', request)
        return load('preflight_copy', folder / 'preflight-family.py').prepare('manifests/request.json')

    def test_preflight_pins_bytes_before_extraction_and_never_repins(self):
        self.source_ready()
        mask, glb = Path(f'{OLD}/coverage/SK_Gloves.bodymask.png'), Path(f'{OLD}/meshes/SK.glb')
        # The separate mask is replaced during extraction while every index JSON stays byte-identical.
        with self.assertRaisesRegex(SystemExit, r"changed during extraction \(\['maskSha256'\]\)"):
            self.preflight(self.request(), {mask.as_posix(): 'swapped'})
        self.assertEqual(read('extraction.json')['sawBaseline'], self.baseline)  # saved before extraction started
        saved = (DOCS / 'frozen-baseline.json').read_bytes()
        self.assertEqual(json.loads(saved), self.baseline)
        self.assertFalse((DOCS / 'family.json').exists())
        # Resumed on the changed mask, or on a changed GLB and entry: refused, the original pin is kept.
        with self.assertRaisesRegex(SystemExit, r"changed since the early pin \(\['maskSha256'\]\)"):
            self.preflight(self.request())
        mask.write_bytes(b'mask')
        assets, old_glb = read(ACTIVE / 'assets.json'), glb.read_bytes()
        glb.write_bytes(old_glb + b' ')
        write(ACTIVE / 'assets.json', {**assets, 'meshes': {**assets['meshes'], self.mesh: {**self.entry, 'sha256': sha(glb)}}})
        with self.assertRaisesRegex(SystemExit, r"changed since the early pin \(\['entrySha256', 'glbSha256'\]\)"):
            self.preflight(self.request())
        self.assertEqual((DOCS / 'frozen-baseline.json').read_bytes(), saved)
        self.assertFalse((DOCS / 'family.json').exists())
        glb.write_bytes(old_glb)
        write(ACTIVE / 'assets.json', assets)
        self.preflight(self.request())  # restored bytes: the resumed preflight proves reuse against the early pin
        self.assertEqual(read(DOCS / 'family.json')[reuse.FIELD], {k: self.early[k] for k in ('policy', *reuse.PINS)})
        self.assertEqual((DOCS / 'frozen-baseline.json').read_bytes(), saved)

    def test_missing_early_pin_cannot_authorize_a_preflight(self):
        self.source_ready()
        write(DOCS / 'frozen-baseline.json', {'hashes': self.hashes})  # pre-hardening evidence, resumed
        before = (DOCS / 'frozen-baseline.json').read_bytes()
        with self.assertRaisesRegex(SystemExit, 'saved without the early pin'):
            self.preflight(self.request())
        self.assertEqual((DOCS / 'frozen-baseline.json').read_bytes(), before)
        self.assertFalse((DOCS / 'family.json').exists() or (DOCS / 'mesh-report.json').exists())
        (DOCS / 'frozen-baseline.json').unlink()
        write(DOCS / 'mesh-report.json', self.report)  # a conversion that no early pin precedes
        with self.assertRaisesRegex(SystemExit, 'conversion without an early pin'):
            self.preflight(self.request())
        self.assertFalse((DOCS / 'frozen-baseline.json').exists())
        for baseline in ({'hashes': self.hashes}, {**self.baseline, reuse.FIELD: None},
                         {**self.baseline, reuse.FIELD: {**self.early, 'source': OTHER}}):
            with self.subTest(baseline.get(reuse.FIELD)), self.assertRaisesRegex(SystemExit, 'no early pin'):
                reuse.preflight_pin(self.request(), self.report, self.slots, self.cohort, baseline)

    def test_without_opt_in_preflight_evidence_is_unchanged(self):
        self.source_ready()
        mask = Path(f'{OLD}/coverage/SK_Gloves.bodymask.png')
        self.preflight(self.manifest, {mask.as_posix(): 'unrelated without the opt-in'})
        self.assertEqual(read('extraction.json')['sawBaseline'], {'hashes': self.hashes})
        self.assertEqual((DOCS / 'frozen-baseline.json').read_text(encoding='utf-8'), json.dumps({'hashes': self.hashes}, indent=2) + '\n')
        self.assertNotIn(reuse.FIELD, read(DOCS / 'family.json'))
        self.preflight(self.manifest)  # resumes on the saved evidence

    def test_entry_hash_is_shared_with_freeze_family(self):
        old = lambda e: hashlib.sha256(json.dumps(e, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        for entry, pin in ACCEPTED + [(self.entry, old(self.entry))]:
            self.assertEqual((reuse.entry_sha(entry), old(entry)), (pin, pin))  # integer-only pins unchanged
        self.assertEqual(reuse.canonical(json.loads('{"b":[1.0,-0.0,-0,1e-07,1E-7,2.5e+2,0.000001,1.5e-7],"a":{"u":0.1}}')),
                         '{"a":{"u":0.1},"b":[1,0,0,1e-7,1e-7,250,0.000001,1.5e-7]}')
        texts = ['{"futureField":{"scale":[1.0,-0.0,2.5e-8,{"deep":1E3,"z":[0.30000000000000004,-123456789.125]}]},"kind":"skeletal"}',
                 '{"\\ue000":1,"\\ud83d\\ude00":2,"a":"\\u0001\\u007f\\u2028é"}', '5e-324', '-1e-6', '9007199254740991', '0.1',
                 '1e21', '1e20', '9007199254740992', '-12345678901234567890', '1.7976931348623157e308', '1e400', 'NaN',
                 '-Infinity', '"\\ud800"', '{"\\udc00":1}', '{"a":[1,{"b":1e999}]}']
        rng = random.Random(20260918)
        doubles = [struct.unpack('<d', rng.getrandbits(64).to_bytes(8, 'little'))[0] for _ in range(20000)]
        texts += [json.dumps(v) for v in doubles if v == v and abs(v) != float('inf')]
        texts += [f'{rng.randint(-10 ** 9, 10 ** 9)}.{rng.randint(0, 10 ** rng.randint(1, 9))}e{rng.randint(-30, 12)}' for _ in range(5000)]
        texts += [repr(rng.random() * 10 ** rng.randint(-12, 15)) for _ in range(5000)]

        def python(text):
            try:
                return reuse.canonical(json.loads(text))
            except SystemExit:
                return None
        py = [python(t) for t in texts]
        self.assertEqual([t for t, p in zip(texts[:17], py) if p is None], texts[6:17])  # refused, never rounded
        self.assertGreater(sum(p is not None for p in py), 15000)  # random bit patterns beyond 2**53 are refused
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        write('texts.json', texts)
        script = ("const m = await import(process.argv.at(-2)); const texts = m.read(process.argv.at(-1));"
                  "console.log(JSON.stringify(texts.map(t => { try { return m.entryCanonical(JSON.parse(t)); } catch { return null; } })));")
        result = subprocess.run([node, '--input-type=module', '-e', script, (SCRIPTS / 'freeze-family.mjs').as_uri(), 'texts.json'],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([(t, p, j) for t, p, j in zip(texts, py, json.loads(result.stdout)) if p != j], [])

    def test_validators_agree_and_schema_version_2_rejects_the_field(self):
        good = {**tfr.example_manifest(), 'coverage': {'mode': 'derived'},
                reuse.FIELD: {'policy': reuse.POLICY, 'entrySha256': 'a' * 64, 'glbSha256': '0' * 64, 'maskSha256': 'b' * 64}}
        field = good[reuse.FIELD]
        bad = [{**good, reuse.FIELD: {**field, 'policy': 'x'}}, {**good, reuse.FIELD: {**field, 'extra': 1}},
               {**good, reuse.FIELD: {'policy': reuse.POLICY}}, {**good, reuse.FIELD: {**field, 'maskSha256': 'B' * 64}},
               {**good, reuse.FIELD: {**field, 'glbSha256': 'c' * 64}}, {**good, reuse.FIELD: [field]},
               {**good, 'coverage': {'mode': 'none', 'reason': 'x'}}, {**good, 'coverage': {'mode': pf.FITTED_MODE},
                                                                          'fittingTags': ['Customization.Shape.ShrinkWrap.a']}]
        self.assertIs(pf.validate_manifest(good), good)
        for doc in bad:
            with self.assertRaises(SystemExit, msg=json.dumps(doc)):
                pf.validate_manifest(doc)
        mp = load('multipart_for_reuse', SCRIPTS / 'prepare-multipart-family.py')
        with self.assertRaisesRegex(SystemExit, 'activeMeshReuse'):
            mp.validate_manifest({**good, 'schemaVersion': 2})
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        fam = self.family()
        script = ("const m = await import(process.argv.at(-3)); const cases = JSON.parse(m.read(process.argv.at(-2)).text);"
                  "const ok = d => { try { m.validateManifest(d); return true; } catch { return false; } };"
                  "const cfg = m.familyConfig(m.read(process.argv.at(-1)));"
                  "console.log(JSON.stringify({good: ok(cases.good), bad: cases.bad.map(ok), pin: m.activeReusePin(cfg),"
                  "frozen: m.assertActiveReuse(cfg, m.read('_docs/glove-a/cohort.json'))}));")
        write('cases.json', {'text': json.dumps({'good': good, 'bad': bad})})
        result = subprocess.run([node, '--input-type=module', '-e', script, (SCRIPTS / 'freeze-family.mjs').as_uri(), 'cases.json',
                                 'manifests/glove-a.json'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout)
        self.assertEqual((out['good'], out['bad'], out['pin'], out['frozen']), (True, [False] * len(bad), fam.REUSE, fam.REUSE))


if __name__ == '__main__':
    unittest.main()
