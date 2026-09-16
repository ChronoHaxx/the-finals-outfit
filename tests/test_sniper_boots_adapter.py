"""Focused negative contracts for the Military Sniper Boots adapter and freeze, without game assets.

The adapter is loaded against a stub of prepare-large-sneakers.py (its real dependencies live only in the
complete repository); freeze.mjs validators are pure exports and are exercised through node, and the
production resolver is run on synthetic definitions when node can strip its types. The supplied
source-only cohort.json is the only fixture; values under test come from the modules, not copies.

  C:/ProgramData/anaconda3/python.exe -B tests/test_sniper_boots_adapter.py -v
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
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-sniper-boots.py'
FREEZE = ROOT / '_docs' / 'sniper-boots-2026-09-16' / 'freeze.mjs'
RESOLVER = ROOT / 'src' / 'rig' / 'SourceAssembly.ts'
COHORT = ROOT / '_docs' / 'sniper-boots-2026-09-16' / 'cohort.json'
DEFAULT_MATERIAL = ('/Game/Discovery/Characters/Military/Assets/SniperBoots/'
                    'M_Military_SniperBoots.M_Military_SniperBoots')
# The previous (assault-vest) family's mesh, slot, tags and morph order: stale values that must never pass here.
VEST_MESH = '/Game/Discovery/Characters/Military/Assets/AssaultVest/SK_Military_AssaultVest_M.SK_Military_AssaultVest_M'
VEST_TAGS = ['Customization.HideMesh.WearingLongJacket', 'Customization.Shape.PushInsideClothes.push_full_jacket',
             'Customization.Shape.ShrinkWrap.shrink_under_collar']
VEST_MORPHS = ['medium_female', 'medium_male']


class _StubLoader(importlib.abc.Loader):
    def __init__(self, shared):
        self.shared = shared

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__dict__.update(vars(self.shared))


def glb(document):
    data = json.dumps(document).encode()
    data += b' ' * (-len(data) % 4)
    return b'glTF' + (2).to_bytes(4, 'little') + (20 + len(data)).to_bytes(4, 'little') + \
        len(data).to_bytes(4, 'little') + b'JSON' + data


def glb_json(path):
    data = path.read_bytes()
    return json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')])


def load_adapter():
    d = types.SimpleNamespace(REUSE_EXPORTS=['stale'], REUSE_TEXTURES=['stale'], MESH_EVIDENCE=['stale'], MARKER='stale',
                              ACTIVE=Path('active'), CATALOG=Path('catalog.json'), SOURCE_INDEX=Path('source-index'))

    def configure(batch, work, runtime, preview):
        d.BATCH, d.WORK, d.RUNTIME, d.PREVIEW, d.SOURCE = Path(batch), Path(work), Path(runtime), Path(preview), Path(work) / 'source'

    # The real helpers take Path values; a string here was an integration failure, so the stub refuses one.
    def read_json(path):
        if not isinstance(path, Path):
            raise TypeError(f'read_json needs a Path: {path!r}')
        return json.loads(path.read_text(encoding='utf-8'))

    def write(path, value):
        if not isinstance(path, Path):
            raise TypeError(f'write needs a Path: {path!r}')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

    def object_path(value):
        if value.startswith('Discovery/Content/') and value.endswith('.uasset'):
            stem = value.removeprefix('Discovery/Content/').removesuffix('.uasset')
            return '/Game/' + stem + '.' + stem.rsplit('/', 1)[-1]
        return value

    def dto_slots(folder, record):
        dto = read_json(folder / record['meshFile'])
        return [{'slot': n['MaterialSlotName'], 'material': m['path']} for n, m in zip(dto['sourceMaterials'], dto['materials'])]

    d.configure, d.write, d.read_json, d.now = configure, write, read_json, lambda: 'now'
    d.file_sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    d.package_of = lambda o: 'Discovery/Content/' + o.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'
    d.job_id = lambda instance: instance.lower().replace('_', '-')
    d.assembly_index = types.SimpleNamespace(object_path=object_path)
    d.dto_slots = dto_slots
    d.glb_slots = lambda p: [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
                             for m in glb_json(Path(p))['materials']]
    d.mesh_verifier = mock.Mock()
    # The previous family left its own configuration and hooks behind; the adapter must set every one itself.
    configure('_docs/assault-vests-2026-09-15/batch.json', 'vests', 'vests-runtime', 'vests-preview')
    shared = types.SimpleNamespace(d=d, DOCS=Path('vests'), WORK=Path('vests'), RUNTIME=Path('vests'),
                                   PREVIEW=Path('vests'), MESH_REPORT=Path('vests'), progress=None,
                                   audit_blocked=lambda: {}, extract=object(), plan=object(),
                                   index=mock.Mock(), derive_coverage=mock.Mock())
    d.extract, d.plan = object(), object()
    real = importlib.util.spec_from_file_location

    def fake(name, location, *args, **kwargs):
        if name == 'prepare_large_sneakers':
            return importlib.machinery.ModuleSpec(name, _StubLoader(shared))
        raise AssertionError(f'The adapter loads only prepare-large-sneakers.py, not {location}')

    spec = real('prepare_sniper_boots', ADAPTER)
    module = importlib.util.module_from_spec(spec)
    with mock.patch('importlib.util.spec_from_file_location', fake):
        spec.loader.exec_module(module)
    return module


def mesh_document(names, slot, uv_sets=2, bones=12):
    attributes = {'POSITION': 0, **{f'TEXCOORD_{i}': 1 + i for i in range(uv_sets)}, 'JOINTS_0': 5, 'WEIGHTS_0': 6}
    targets = [{'POSITION': 10 + i, 'NORMAL': 20 + i} for i in range(len(names))]
    return {'materials': [{'extras': {'sourceSlot': {'MaterialSlotName': slot}, 'sourceMaterial': DEFAULT_MATERIAL}}],
            'meshes': [{'extras': {'targetNames': list(names)}, 'primitives': [{'attributes': attributes, 'targets': targets}]}],
            'nodes': [{'mesh': 0, 'skin': 0}],
            'skins': [{'joints': list(range(bones)), 'inverseBindMatrices': 7}]}


class AdapterGuards(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        self.tmp = tempfile.mkdtemp()
        os.chdir(self.tmp)
        self.a = load_adapter()
        self.cohort = json.loads(COHORT.read_text(encoding='utf-8'))
        self.a.d.write(self.a.DOCS / 'cohort.json', self.cohort)
        self.other_mesh = self.a.SOURCE_MESH.replace('SniperBoots_M', 'SniperBoots_F')

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

    def stage_mesh(self, slot=None, morphs=None, glb_names=None, dto_source=None, record_path=None,
                   report_source=None, exports=None, facts=None):
        """A complete synthetic mesh handoff; each keyword changes exactly one contract."""
        a = self.a
        slot = slot or a.MATERIAL_SLOT
        names = list(a.MORPH_NAMES) if morphs is None else morphs
        package = a.d.package_of(a.SOURCE_MESH)
        folder = a.d.SOURCE / 'meshes-01'
        dto = folder / 'SK_Military_SniperBoots_M.mesh.json'
        a.d.write(dto, {'source': dto_source or package, 'sourceMaterials': [{'MaterialSlotName': slot}],
                        'materials': [{'path': DEFAULT_MATERIAL}], 'lods': [{'morphs': [{'name': n} for n in names]}]})
        a.d.write(folder / 'assets.json', [{'path': record_path or package, 'sha256': 'pkg', 'meshFile': dto.name,
                                            'exports': exports or [{'type': 'SkeletalMesh'}]}])
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [package])
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 0})
        path = a.WORK / 'meshes' / 'SK_Military_SniperBoots_M.glb'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(glb(mesh_document(names if glb_names is None else glb_names, slot)))
        a.GLB_SHA256 = a.d.file_sha(path)  # pin this synthetic conversion so the variation under test is the only drift
        a.d.write(a.MESH_REPORT, {'source': report_source or package, 'glb': path.as_posix(), 'meshJson': dto.as_posix(),
                                  'file': path.name, 'sha256': a.GLB_SHA256, 'sourceDtoSha256': a.d.file_sha(dto),
                                  'sourcePackageSha256': 'pkg', 'verification': {'passed': True},
                                  **a.MESH_FACTS, 'morphs': len(names), **(facts or {})})

    def test_every_shared_global_and_hook_is_repointed(self):
        a = self.a
        self.assertEqual((a.d.WORK, a.d.SOURCE, a.d.MARKER), (a.WORK, a.WORK / 'source', a.MARKER))
        self.assertEqual((a.d.REUSE_EXPORTS, a.d.REUSE_TEXTURES, a.d.MESH_EVIDENCE), ([], [], []))
        self.assertIs(a.d.extract, a.s.extract)
        self.assertIs(a.d.plan, a.s.plan)
        self.assertEqual((a.s.DOCS, a.s.MESH_REPORT), (a.DOCS, a.DOCS / 'mesh-report.json'))
        a._require_configuration()
        a.progress('probe', value=1)
        self.assertEqual(a.d.read_json(a.WORK / 'progress.json')['marker'], a.MARKER)
        for name, stale in (('REUSE_TEXTURES', [Path('scripts/generated/shader-probe/assault-vests-v1/opus-textures-01')]),
                            ('MESH_EVIDENCE', [Path('scripts/generated/shader-probe/assault-vests-v1/meshes-01')]),
                            ('MARKER', 'shader-probe/prepare-assault-vests'), ('plan', object())):
            original = getattr(a.d, name)
            setattr(a.d, name, stale)
            with self.assertRaises(SystemExit):
                a._require_configuration()
            setattr(a.d, name, original)
        for name, stale in (('MESH_REPORT', Path('_docs/assault-vests-2026-09-15/mesh-report.json')), ('progress', print)):
            original = getattr(a.s, name)
            setattr(a.s, name, stale)
            with self.assertRaises(SystemExit):
                a._require_configuration()
            setattr(a.s, name, original)

    def test_supplied_cohort_is_accepted_and_drift_rejected(self):
        a, cohort = self.a, self.cohort
        self.assertEqual(len(a._require_cohort()['items']), a.EXPECTED_COUNT)
        first, rest = cohort['items'][0], cohort['items'][1:]
        for broken in ({**cohort, 'count': a.EXPECTED_COUNT + 1}, {**cohort, 'items': rest},
                       {**cohort, 'meshes': [self.other_mesh]}, {**cohort, 'meshes': [VEST_MESH]},
                       {**cohort, 'attached': True},
                       {**cohort, 'items': [{**first, 'slot': 'upperBody'}, *rest]},
                       {**cohort, 'items': [{**first, 'materials': first['materials'] * 2}, *rest]},
                       {**cohort, 'items': [first, first, *rest[1:]]},
                       # A renamed choice no longer has a row in the per-choice fitting tag mapping.
                       {**cohort, 'items': [{**first, 'id': first['id'] + '-v2'}, *rest]},
                       {**cohort, 'materials': cohort['materials'][1:]}):
            a.d.write(a.DOCS / 'cohort.json', broken)
            with self.assertRaises(SystemExit):
                a._require_cohort()

    def test_each_choice_keeps_exactly_the_two_boot_fitting_tags(self):
        a, mapping = self.a, self.a.EXPECTED_ACTIVATED_TAGS_BY_ITEM
        item = self.cohort['items'][0]['id']
        self.assertEqual(sorted(mapping), sorted(i['id'] for i in self.cohort['items']))
        self.assertEqual({tuple(sorted(tags)) for tags in mapping.values()},
                         {('Customization.Shape.PushInsideClothes.push_lower_feet',
                           'Customization.Shape.ShrinkWrap.shrink_pants_in_lowboots')})
        self.assertTrue(a._is_fitting_tags(item, mapping[item][::-1]))  # source order is free
        tags = mapping[item]
        for drift in (None, [], tags[:1], [tags[0], tags[0]], [*tags, tags[0]], [*tags, VEST_TAGS[0]], VEST_TAGS,
                      [tags[0], tags[1].replace('lowboots', 'highboots')], [tag.lower() for tag in tags]):
            self.assertFalse(a._is_fitting_tags(item, drift), drift)
        self.assertFalse(a._is_fitting_tags(item + '-v2', tags))
        self.assertFalse(a._is_fitting_tags('military-assaultvest-polyester-black', tags))

    def test_mesh_stage_never_converts_again(self):
        a = self.a
        a.s.mesh = mock.Mock()
        self.stage_baseline()
        with self.assertRaisesRegex(SystemExit, 'restore'):
            a.mesh()
        a.s.mesh.assert_not_called()

    def test_report_must_name_the_preserved_glb(self):
        a = self.a
        handed_over = a.GLB_SHA256
        self.stage_mesh()  # a hash-current report of some other conversion
        a.GLB_SHA256 = handed_over
        with self.assertRaisesRegex(SystemExit, 'preserved sniper-boot conversion'):
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
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(VEST_MESH)])
        with self.assertRaises(SystemExit):
            a._require_mesh_request()
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(a.SOURCE_MESH)])
        self.assertTrue(a._require_mesh_request())
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 1})
        with self.assertRaises(SystemExit):
            a._require_mesh_request()

    def test_mesh_contract_rejects_other_mesh_slot_source_and_lost_or_misnamed_morphs(self):
        a = self.a
        self.stage_mesh()
        report, slots = a._require_mesh_contract()
        self.assertEqual(slots, [{'slot': a.MATERIAL_SLOT, 'material': DEFAULT_MATERIAL}])
        self.stage_baseline()
        a.d.mesh_verifier.verify.return_value = {'passed': True}
        a.mesh()
        a.d.mesh_verifier.verify.assert_called_once_with(Path(report['meshJson']), Path(report['glb']))
        recorded = a.d.read_json(a.WORK / 'progress.json')['mesh']
        self.assertEqual((recorded['morphNames'], recorded['slots'], recorded['bones']),
                         (['medium_male', 'medium_female'], slots, 12))
        a.d.mesh_verifier.verify.return_value = {'passed': False}
        with self.assertRaisesRegex(SystemExit, 'no longer verify'):
            a.mesh()
        other, vest = a.d.package_of(self.other_mesh), a.d.package_of(VEST_MESH)
        male, female = a.MORPH_NAMES
        for change, reason in (({'slot': 'AssaultVest'}, 'SniperBoots material slot'),
                               ({'slot': 'SniperBoots_Laces'}, 'SniperBoots material slot'),
                               ({'dto_source': other}, 'DTO source identity'),
                               ({'record_path': vest}, 'mesh source identity'),
                               ({'report_source': self.other_mesh}, 'mesh source identity'),
                               ({'exports': [{'type': 'SkeletalMesh'}, {'type': 'StaticMesh'}]}, 'one SkeletalMesh'),
                               ({'exports': [{'type': 'StaticMesh'}]}, 'one SkeletalMesh'),
                               # Consistently lost, reordered, invented or renamed in DTO and GLB alike.
                               ({'morphs': [male]}, 'not the original'),
                               ({'morphs': []}, 'not the original'),
                               ({'morphs': VEST_MORPHS}, 'not the original'),  # the assault-vest mesh's order
                               ({'morphs': [male, 'Medium_Female']}, 'not the original'),
                               ({'morphs': [*a.MORPH_NAMES, 'medium_male_boots']}, 'not the original'),
                               # Lost or misnamed only by the conversion.
                               ({'glb_names': [male]}, 'GLB morph target names'),
                               ({'glb_names': [male, 'medium_femal']}, 'GLB morph target names'),
                               ({'glb_names': VEST_MORPHS}, 'GLB morph target names'),
                               ({'glb_names': []}, 'GLB morph target names'),
                               ({'facts': {'bones': 52}}, 'differs from the exported mesh'),  # the vest's skeleton
                               ({'facts': {'vertices': 3079}}, 'differs from the exported mesh'),
                               ({'facts': {'triangles': 5029}}, 'differs from the exported mesh'),
                               ({'facts': {'materialSections': 2}}, 'differs from the exported mesh'),
                               ({'facts': {'uvSets': 1}}, 'differs from the exported mesh')):
            self.stage_mesh(**change)
            with self.assertRaisesRegex(SystemExit, reason, msg=change):
                a._require_mesh_contract()

    def test_glb_keeps_original_uv_sets_skinning_and_inactive_named_morphs(self):
        a, names = self.a, self.a.MORPH_NAMES
        document = mesh_document(names, a.MATERIAL_SLOT)
        mesh = document['meshes'][0]
        primitive, attributes = mesh['primitives'][0], mesh['primitives'][0]['attributes']
        dto = {'lods': [{'morphs': [{'name': name} for name in names]}]}
        path = Path('mesh.glb')
        report = {'glb': path.as_posix(), **a.MESH_FACTS, 'morphs': len(names)}
        path.write_bytes(glb(document))
        self.assertEqual(a._require_glb_geometry(report, dto), names)
        self.assertEqual(a._require_glb_geometry({**report, 'morphs': list(names), 'bones': list(range(12))}, dto), names)
        path.write_bytes(glb({**document, 'meshes': [{**mesh, 'weights': [0] * len(names)}]}))  # explicit zero defaults
        self.assertEqual(a._require_glb_geometry(report, dto), names)
        for broken_report in ({**report, 'uvSets': 1}, {**report, 'uvSets': True}, {**report, 'bones': 0},
                              {**report, 'morphs': len(names) - 1}, {**report, 'morphs': None},
                              {**report, 'morphs': names[::-1]}, {**report, 'triangles': None}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(broken_report, dto)
        for broken_mesh in ({**mesh, 'extras': {}},                                          # names lost
                            {**mesh, 'extras': {'targetNames': names[::-1]}},                # reordered
                            {**mesh, 'primitives': [{**primitive, 'targets': primitive['targets'][:-1]}]},  # target dropped
                            {**mesh, 'primitives': [{**primitive, 'targets': [{'NORMAL': 1}] * len(names)}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {**attributes, 'TEXCOORD_2': 9}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'TEXCOORD_1'}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'WEIGHTS_0'}}]}):
            path.write_bytes(glb({**document, 'meshes': [broken_mesh]}))
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report, dto)
        # A body morph switched on by default (mesh or node weights) would reshape every boot.
        for activated in ({**document, 'meshes': [{**mesh, 'weights': [1, 0]}]},
                          {**document, 'nodes': [{'mesh': 0, 'skin': 0, 'weights': [0, 0.5]}]}):
            path.write_bytes(glb(activated))
            with self.assertRaisesRegex(SystemExit, 'by default'):
                a._require_glb_geometry(report, dto)
        path.write_bytes(glb({**document, 'skins': []}))
        with self.assertRaises(SystemExit):
            a._require_glb_geometry(report, dto)

    def test_frozen_cohort_keeps_one_boot_part_and_exact_fitting_tags(self):
        a, cohort = self.a, self.cohort
        report, slots = {'sha256': 'glb'}, [{'slot': a.MATERIAL_SLOT, 'material': DEFAULT_MATERIAL}]
        rows = []
        for item in cohort['items']:
            tags = a.EXPECTED_ACTIVATED_TAGS_BY_ITEM[item['id']]
            definition = {'formatVersion': 1, 'id': item['id'], 'source': 'Discovery/Content/x.uasset', 'sourceSha256': 'ab',
                          'properties': {'ActivatesTags': list(tags)}}
            file = a.d.SOURCE_INDEX / 'items' / (item['id'] + '.json')
            a.d.write(file, definition)
            rows.append({**item, 'definition': definition, 'definitionFileSha256': a.d.file_sha(file),
                         'fittingTags': sorted(tags),
                         'effectiveParts': [{'sourceIndex': 0, 'mesh': a.SOURCE_MESH,
                                             'slots': [{'slot': a.MATERIAL_SLOT, 'material': item['materials'][0]}]}]})
        frozen = {**cohort, 'context': a.CONTEXT, 'items': rows, 'meshReport': report, 'sourceSlots': slots}
        a.d.write(a.DOCS / 'batch.json', {'cohort': (a.DOCS / 'resolved-cohort.json').as_posix(),
                                          'ids': [item['id'] for item in cohort['items']]})
        tags = rows[-1]['fittingTags']

        def stage(changed=None, **fields):
            items = [{**row, **(changed or {}).get(i, {})} for i, row in enumerate(rows)]
            a.d.write(a.DOCS / 'resolved-cohort.json', {**frozen, **fields, 'items': items})

        def tagged(properties, index=-1):
            return {len(rows) + index if index < 0 else index: {'definition': {**rows[index]['definition'], 'properties': properties}}}

        stage(); a._require_frozen_cohort(report, slots)
        stage(tagged({'ActivatesTags': tags[::-1]})); a._require_frozen_cohort(report, slots)  # source order is free
        part = rows[0]['effectiveParts'][0]
        drift = 'does not activate exactly'
        for changed, fields, reason in ((tagged({}), {}, drift),  # missing is not valid for a boot
                                        (tagged({'ActivatesTags': []}), {}, drift),
                                        (tagged({'ActivatesTags': tags[:1]}), {}, drift),
                                        (tagged({'ActivatesTags': [tags[0], tags[0]]}), {}, drift),
                                        (tagged({'ActivatesTags': [*tags, VEST_TAGS[0]]}), {}, drift),
                                        (tagged({'ActivatesTags': VEST_TAGS}, index=0), {}, drift),
                                        ({3: {'fittingTags': tags[1:]}}, {}, drift),
                                        ({3: {'fittingTags': [*tags, tags[1]]}}, {}, drift),
                                        ({0: {'effectiveParts': [{**part, 'mesh': VEST_MESH}]}}, {}, 'sniper-boot mesh'),
                                        ({0: {'effectiveParts': [{**part, 'slots': [{**part['slots'][0], 'slot': 'AssaultVest'}]}]}},
                                         {}, 'sniper-boot mesh'),
                                        ({0: {'effectiveParts': [part, {**part, 'sourceIndex': 1}]}}, {}, 'sniper-boot mesh'),
                                        ({0: {'slot': 'upperBody'}}, {}, 'differs from cohort.json'),
                                        (None, {'context': 'Customization.Archetype.Heavy'}, 'not resolved for'),
                                        (None, {'meshes': [self.other_mesh]}, 'different mesh report'),
                                        (None, {'sourceSlots': [{**slots[0], 'slot': 'AssaultVest'}]}, 'different mesh report')):
            stage(changed, **fields)
            with self.assertRaisesRegex(SystemExit, reason, msg=(changed, fields)):
                a._require_frozen_cohort(report, slots)
        stage()
        a.d.write(a.d.SOURCE_INDEX / 'items' / (rows[-1]['id'] + '.json'), {**rows[-1]['definition'], 'sourceSha256': 'cd'})
        with self.assertRaisesRegex(SystemExit, 'Source definition changed'):
            a._require_frozen_cohort(report, slots)

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
        a.d.write(run, {'at': '2026-09-16T10:00:00Z', 'result': 'passed'})
        first = a._preserve_gpu_run(run)
        self.assertEqual(a._preserve_gpu_run(run), first)
        self.assertTrue(first.is_relative_to(a.WORK / 'validation' / 'gpu-runs'))
        first.write_text('{"tampered": true}\n')
        with self.assertRaises(SystemExit):
            a._preserve_gpu_run(run)

    def test_index_needs_the_adapter_baseline_and_keeps_the_shared_derived_coverage(self):
        a = self.a
        a._require_downstream = lambda: None
        a._require_preview = lambda: None
        # The shared stages' preview output, including a derived body mask on this mesh, is left as they wrote it.
        mask = {'bodyMaskUrl': 'coverage/mask.png', 'bodyMaskUvTiles': [1, 1], 'coverageSource': 'derived-projection'}
        assets = {'meshes': {a.SOURCE_MESH: {'sha256': a.GLB_SHA256, **mask}}, 'materials': {}}
        a.s.index.side_effect = a.s.derive_coverage.side_effect = lambda: a.d.write(a.PREVIEW / 'assets.json', assets)
        advertised, _ = self.stage_baseline()
        # The eight-file preflight evidence is a different document; it neither satisfies nor blocks this checkpoint.
        a.d.write(a.DOCS / 'frozen-baseline.json', {'hashes': {f'file-{i}': 'ab' for i in range(8)}})
        preflight = (a.DOCS / 'frozen-baseline.json').read_bytes()
        with self.assertRaisesRegex(SystemExit, 'adapter-baseline.json is missing'):
            a.index()
        a.d.write(a.DOCS / 'adapter-baseline.json', {'hashes': a._active_hashes()})
        a.index()
        a.coverage()
        self.assertEqual((a.s.index.call_count, a.s.derive_coverage.call_count), (1, 1))
        self.assertEqual(a.d.read_json(a.PREVIEW / 'assets.json'), assets)
        a.d.write(a.d.ACTIVE / 'supported-items.json', {'items': advertised[1:]})
        with self.assertRaisesRegex(SystemExit, 'adapter-baseline'):
            a.coverage()
        a.d.write(a.DOCS / 'adapter-baseline.json', {'hashes': a._active_hashes()})  # pinned, but not the stated baseline
        with self.assertRaisesRegex(SystemExit, 'stated baseline'):
            a.coverage()
        self.assertEqual(a.s.derive_coverage.call_count, 1)
        self.assertEqual((a.DOCS / 'frozen-baseline.json').read_bytes(), preflight)

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
                       # The previous family's baseline is drift for this batch.
                       {'preview': {**preview, 'previousAdvertised': 492, 'previousAssemblies': 493}},
                       {'preview': {**preview, 'previewAssemblies': a.BASELINE_STRUCTURAL + 2}},
                       {'preview': {**preview, 'marker': 'shader-probe/prepare-assault-vests'}},
                       {'preview': {**preview, 'implemented': ['military-assaultvest-polyester-black']}}):
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
const VEST_MESH = '/Game/Discovery/Characters/Military/Assets/AssaultVest/SK_Military_AssaultVest_M.SK_Military_AssaultVest_M';
const vestTags = ['Customization.HideMesh.WearingLongJacket', 'Customization.Shape.ShrinkWrap.shrink_under_collar'];

// The supplied cohort is accepted; count, slot, mesh, attachment, id and material-list drift fail.
m.assertCohort(cohort);
assert.throws(() => m.assertCohort({...cohort, count: m.EXPECTED_COUNT + 1}), /count/);
assert.throws(() => m.assertCohort({...cohort, meshes: [VEST_MESH]}), /skeletal mesh/);
assert.throws(() => m.assertCohort({...cohort, attached: true}), /attached/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], slot: 'upperBody'}, ...rest]}), /slot/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], id: 'renamed'}, ...rest]}), /fitting tag mapping/);
assert.throws(() => m.assertCohort({...cohort, materials: cohort.materials.slice(1)}), /material list/);

// The mesh report must be hash-current, name the preserved GLB and describe the exported Medium mesh.
const report = {glb: 'g.glb', meshJson: 'm.json', sha256: m.GLB_SHA256, sourceDtoSha256: 'dto', source: m.packageOf(m.SOURCE_MESH),
  sourcePackageSha256: 'pkg', verification: {passed: true}, ...m.MESH_FACTS, morphs: m.MORPH_NAMES.length};
const shaOf = glbSha => p => p === 'g.glb' ? glbSha : 'dto';
const inventory = new Set([m.packageOf(m.SOURCE_MESH)]);
m.assertMeshReport(report, inventory, shaOf(m.GLB_SHA256));
m.assertMeshReport({...report, bones: Array.from({length: m.MESH_FACTS.bones}, (_, i) => `b${i}`)}, inventory, shaOf(m.GLB_SHA256));
assert.throws(() => m.assertMeshReport({...report, sha256: 'ff'}, inventory, shaOf('ff')), /preserved sniper-boot conversion/);
assert.throws(() => m.assertMeshReport(report, inventory, shaOf('ff')), /GLB hash does not match/);
assert.throws(() => m.assertMeshReport({...report, source: m.SOURCE_MESH.replaceAll('SniperBoots_M', 'SniperBoots_F')}, inventory, shaOf(m.GLB_SHA256)), /skeletal mesh/);
assert.throws(() => m.assertMeshReport({...report, source: VEST_MESH}, inventory, shaOf(m.GLB_SHA256)), /skeletal mesh/);
assert.throws(() => m.assertMeshReport(report, new Set([m.packageOf(VEST_MESH)]), shaOf(m.GLB_SHA256)), /inventory/);
for (const drift of [{bones: 52}, {uvSets: 1}, {vertices: '3080'}, {triangles: 5029}, {materialSections: 2}])
  assert.throws(() => m.assertMeshReport({...report, ...drift}, inventory, shaOf(m.GLB_SHA256)), /is not the exported/);
const slot = m.MATERIAL_SLOT;
assert.deepEqual(m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}], materials: [{path: '/Game/M.M'}]}),
  [{slot, material: '/Game/M.M'}]);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'AssaultVest'}], materials: [{path: '/Game/M.M'}]}), /material slot must be/);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}, {MaterialSlotName: 'Laces'}],
  materials: [{path: '/Game/M.M'}, {path: '/Game/B.B'}]}), /exactly one/);

// Morph targets are the two original Medium morphs by name, order and count, inactive by default.
const names = m.MORPH_NAMES;
assert.deepEqual(names, ['medium_male', 'medium_female']);
const dtoFor = list => ({lods: [{morphs: list.map(name => ({name}))}]});
const primitive = {attributes: {POSITION: 0}, targets: names.map((_, i) => ({POSITION: i + 1}))};
const glbDoc = {meshes: [{extras: {targetNames: names}, primitives: [primitive]}], nodes: [{mesh: 0}]};
assert.deepEqual(m.morphNamesFromDto(dtoFor(names)), names);
m.assertGlbMorphs(glbDoc, names, report);
m.assertGlbMorphs(glbDoc, names, {...report, morphs: names});
assert.throws(() => m.morphNamesFromDto(dtoFor([names[0], names[0]])), /not unique/);
// Lost, reordered into the assault-vest mesh's order, renamed, or an invented extra morph.
for (const list of [names.slice(0, 1), [], [...names].reverse(), ['medium_male', 'Medium_Female'], [...names, 'push_lower_feet']])
  assert.throws(() => m.morphNamesFromDto(dtoFor(list)), /original Medium morphs/);
assert.throws(() => m.assertGlbMorphs(glbDoc, names, {...report, morphs: 1}), /morph count/);
assert.throws(() => m.assertGlbMorphs({meshes: [{primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: [...names].reverse()}, primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: names}, primitives: [{...primitive, targets: primitive.targets.slice(1)}]}]}, names, report), /primitive morph targets/);
assert.throws(() => m.assertGlbMorphs({...glbDoc, meshes: [{...glbDoc.meshes[0], weights: [1, 0]}]}, names, report), /by default/);
assert.throws(() => m.assertGlbMorphs({...glbDoc, nodes: [{mesh: 0, weights: [0, 1]}]}, names, report), /by default/);

// Active baseline: advertised assemblies and catalog choices indexed by an assembly or skin pair.
const catalog = Array.from({length: m.CATALOG_ITEMS}, (_, i) => ({id: `c${i}`}));
const supported = {items: catalog.slice(0, m.BASELINE_ADVERTISED).map(item => item.id)};
const skinPairs = {items: Object.fromEntries(catalog.slice(m.BASELINE_ADVERTISED - 1, m.BASELINE_INDEXED).map(item => [item.id, {}]))};
m.assertBaseline(m.baselineCounts(supported, skinPairs, catalog));
assert.throws(() => m.assertBaseline(m.baselineCounts({items: [...supported.items, 'not-in-catalog']}, skinPairs, catalog)), /stated baseline/);
assert.throws(() => m.assertBaseline(m.baselineCounts(supported, {items: {}}, catalog)), /stated baseline/);
assert.throws(() => m.assertBaseline(m.baselineCounts({items: supported.items.slice(10)}, skinPairs, catalog)), /stated baseline/);

// Fitting tags: every choice has exactly the two boot tags; order is free; anything else is drift.
const id = cohort.items[0].id, tags = m.tagsFor(id);
assert.deepEqual(Object.keys(m.EXPECTED_ACTIVATED_TAGS_BY_ITEM).sort(), cohort.items.map(item => item.id).sort());
assert.deepEqual([...new Set(Object.values(m.EXPECTED_ACTIVATED_TAGS_BY_ITEM).map(row => JSON.stringify([...row].sort())))],
  [JSON.stringify(['Customization.Shape.PushInsideClothes.push_lower_feet', 'Customization.Shape.ShrinkWrap.shrink_pants_in_lowboots'])]);
assert.equal(m.isFittingTags('military-sniperboots-leather-unknown', tags), false);
assert.equal(m.isFittingTags(id, [...tags].reverse()), true);

const latest = 'Discovery/Content/Discovery/Characters/Military/Assets/SniperBoots/Skins/Leather_Black/MI_Military_SniperBoots_Leather_Black.uasset';
const saved = latest.replace('Leather_Black/', 'Leather_BLACK/');
const other = latest.replaceAll('Leather_Black', 'Leather_Gray');
const archive = m.foldedIndex([latest, other]), inventoryIndex = m.foldedIndex(new Set([latest, other]));
const definition = {formatVersion: 1, id, source: saved, sourceSha256: 'ab', properties: {Slots: ['feet'], ActivatesTags: tags}};
const current = {status: 'ok', package: {path: latest, sha256: 'ab'},
  exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['feet'], ActivatesTags: tags}}]};
m.assertDefinition({id}, definition);
m.assertDefinition({id}, {...definition, properties: {...definition.properties, ActivatesTags: [...tags].reverse()}});
for (const drift of [undefined, [], tags.slice(0, 1), [tags[0], tags[0]], [...tags, tags[0]], [...tags, vestTags[0]], vestTags,
                     [tags[0], tags[1].replace('lowboots', 'highboots')], tags.map(tag => tag.toLowerCase())])
  assert.throws(() => m.assertDefinition({id}, {...definition, properties: {Slots: ['feet'], ActivatesTags: drift}}), /activated tags/);
assert.throws(() => m.assertDefinition({id: 'renamed'}, {...definition, id: 'renamed'}), /activated tags/);

// A unique case-only difference locates the record; the saved path is not rewritten.
assert.deepEqual(m.resolveDefinitionPackage(definition, archive, inventoryIndex, id), {archive: latest, inventory: latest, exactCase: false});
assert.equal(definition.source, saved);
assert.equal(m.resolveDefinitionPackage({...definition, source: latest}, archive, inventoryIndex, id).exactCase, true);
m.assertCurrentDefinition(definition, definition, current);
assert.throws(() => m.assertCurrentDefinition(definition, definition, {...current, package: {path: latest, sha256: 'AB'}}), /source package changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['feet'], ActivatesTags: tags.slice(1)}}]}), /source properties changed/);
assert.throws(() => m.resolveDefinitionPackage({...definition, source: saved.replace('MI_Military_SniperBoots_Leather_Black', 'MI_Absent')}, archive, inventoryIndex, id), /absent/);
for (const colliding of [m.foldedIndex([latest, saved]), m.foldedIndex([latest, latest])]) {
  assert.throws(() => m.resolveDefinitionPackage(definition, colliding, inventoryIndex, id), /ambiguous/);
  assert.throws(() => m.resolveDefinitionPackage({...definition, source: latest}, archive, colliding, id), /ambiguous/);
}
assert.throws(() => m.resolveDefinitionPackage(definition, archive, m.foldedIndex([latest.toUpperCase()]), id), /disagree/);

// Frozen outputs: only the three adapter files; identical rerun is a no-op; drift in any target fails before
// the first write; the preflight frozen-baseline.json is never a target.
assert.deepEqual(Object.values(m.FROZEN_OUTPUTS).map(file => path.basename(file)), ['resolved-cohort.json', 'batch.json', 'adapter-baseline.json']);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.sniper-boots-freeze-'));
try {
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  assert.deepEqual(m.writeFrozenSet([[a, {v: 1}]]), [true]);
  assert.deepEqual(m.writeFrozenSet([[a, {v: 1}]]), [false]);
  fs.writeFileSync(b, m.textFor({v: 'old'}));
  assert.throws(() => m.writeFrozenSet([[path.join(dir, 'c.json'), {v: 3}], [b, {v: 'new'}]]), /Preserve existing frozen output/);
  assert.equal(fs.existsSync(path.join(dir, 'c.json')), false);
  assert.equal(fs.readFileSync(b, 'utf8'), m.textFor({v: 'old'}));
  assert.throws(() => m.writeFrozenSet([[path.join(dir, 'd.json'), {v: 4}], [path.join(dir, 'frozen-baseline.json'), {hashes: {}}]]), /preflight evidence/);
  assert.equal(fs.existsSync(path.join(dir, 'd.json')), false);
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
console.log('freeze contracts ok');
"""

RESOLVER_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const [freezeUrl, resolverUrl, cohortPath] = process.argv.slice(-3);
const m = await import(freezeUrl);
const {resolveSourceOutfit} = await import(resolverUrl);
const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const item = cohort.items[0], material = item.materials[0];
const soft = AssetPathName => ({AssetPathName, SubPathString: ''});
const slots = [{slot: m.MATERIAL_SLOT, material: '/Game/Discovery/Characters/Military/Assets/SniperBoots/M_Default.M_Default'}];
const rule = (tags, fields) => ({MatchingTags: tags, bOverrideMesh: false, ReplacementStaticMesh: soft(''),
  ReplacementSkeletalMesh: soft(''), bOverrideEffect: false, ReplacementEffect: soft(''), bOverrideMaterials: false,
  MaterialOverrides: [], ...fields});
const LIGHT = m.SOURCE_MESH.replaceAll('SniperBoots_M', 'SniperBoots_L'), HEAVY = m.SOURCE_MESH.replaceAll('SniperBoots_M', 'SniperBoots_H');
const archetypes = [rule(['Customization.Archetype.Light'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)}),
                    rule(['Customization.Archetype.Heavy'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(HEAVY)})];
const part = {StaticMesh: soft(''), SkeletalMesh: soft(m.SOURCE_MESH), Effect: soft(''), TagOverrides: archetypes,
  LocalPosition: {X: 0, Y: 0, Z: 0}, LocalRotation: {Pitch: 0, Yaw: 0, Roll: 0}, LocalScale: {X: 1, Y: 1, Z: 1}};
// Source tag order is not significant; the resolver reports fitting tags sorted.
const definition = {formatVersion: 1, id: item.id, source: 'Discovery/Content/SniperBoots.uasset', sourceSha256: 'ab',
  properties: {Slots: ['Feet'], ActivatesTags: [...m.tagsFor(item.id)].reverse(),
    MaterialOverrides: [{Key: m.MATERIAL_SLOT, Value: soft(material)}], VisualParts: [part]}};
const variant = (properties, partFields = {}) => ({...definition,
  properties: {...definition.properties, ...properties, VisualParts: [{...part, ...partFields}]}});
const resolve = def => m.resolveChoice(item, def, slots, resolveSourceOutfit);
const rejects = (def, pattern) => assert.throws(() => resolve(def), pattern);

// Medium resolves one visible part on the boot mesh with the cohort material and hands exactly the two boot
// fitting tags to the production fitting logic; Light/Heavy overrides stay outside.
const ok = resolve(definition);
assert.deepEqual(ok.effectiveSlots, [{slot: m.MATERIAL_SLOT, material}]);
assert.deepEqual([ok.visible.length, ok.visible[0].skeletalMesh, ok.outfit.fittingTags],
  [1, m.SOURCE_MESH, [...m.FITTING_TAGS].sort()]);
assert.equal(resolveSourceOutfit([definition], ['Customization.Archetype.Heavy']).items[item.id].parts[0].skeletalMesh, HEAVY);

// Missing, empty, partial or foreign (assault-vest) activated tags are drift for a boot.
for (const tags of [undefined, [], m.tagsFor(item.id).slice(0, 1), [...m.tagsFor(item.id), 'Customization.Shape.ShrinkWrap.shrink_under_collar']])
  rejects(variant({ActivatesTags: tags}), /activated tags/);
// The activated tags feed rule matching too (by prefix): a part hidden or re-meshed by its own tag is rejected.
rejects(variant({}, {TagOverrides: [...archetypes, rule(['Customization.Shape.PushInsideClothes.push_lower_feet'], {bOverrideMesh: true})]}), /hidden/);
rejects(variant({}, {TagOverrides: [...archetypes, rule(['Customization.Shape.ShrinkWrap'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})]}), /sniper-boot mesh/);

const medium = fields => ({TagOverrides: [...archetypes, rule([m.CONTEXT], fields)]});
rejects(variant({}, medium({bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})), /sniper-boot mesh/);
rejects(variant({}, medium({bOverrideMesh: true})), /hidden/);
rejects(variant({}, {TagOverrides: [rule([m.CONTEXT, 'Customization.Archetype.Light'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})]}), /unresolved part/);
rejects(variant({}, medium({bOffsetTransform: true})), /unresolved part/);
rejects(variant({}, medium({bAddLogicModules: true})), /unresolved part/);
rejects(variant({}, medium({bOverrideEffect: true, ReplacementEffect: soft('/Game/FX/E.E')})), /effects/);
rejects(variant({}, medium({bOverrideMaterials: true, MaterialOverrides: [{Key: m.MATERIAL_SLOT, Value: soft(cohort.items[1].materials[0])}]})), /effective resolved materials/);
rejects(variant({MaterialOverrides: []}), /effective resolved materials/);
rejects(variant({MaterialOverrides: [{Key: 'AssaultVest', Value: soft(material)}]}), /absent slot/);
rejects({...definition, properties: {...definition.properties, VisualParts: [part, part]}}, /one visible part/);
rejects(variant({}, {bIsAttached: true}), /attached/);
rejects(variant({}, {OptionalAttachmentMesh: soft('/Game/A.A')}), /attachment/);
rejects(variant({}, {LogicModules: [{}]}), /logic/);
rejects(variant({}, {WrapDeformation: {bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft('')}}), /wrap/);
rejects(variant({}, {LocalPosition: {X: 0, Y: 0, Z: 2}}), /local position/);
rejects(variant({}, {LocalRotation: {Pitch: 0, Yaw: 90, Roll: 0}}), /local rotation/);
rejects(variant({}, {LocalScale: {X: 1, Y: 1, Z: 2}}), /local scale/);
rejects(variant({ActivatesMaterialParameters: [{MaterialInstance: soft('/Game/P.P'),
  Behavior: 'ECustomizationMaterialBehavior::OverrideParameters', MatchingTags: [], SlotNames: [m.MATERIAL_SLOT]}]}), /material parameter/);
console.log('resolver contracts ok');
"""


class FreezeContracts(unittest.TestCase):
    def node(self, *flags):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not available')
        return [node, *flags]

    def test_adapter_and_freeze_share_the_handed_over_contract(self):
        script = 'const m = await import(process.argv.at(-1)); console.log(JSON.stringify(m));'
        result = subprocess.run([*self.node(), '--input-type=module', '-e', script, FREEZE.as_uri()],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        freeze, cwd = json.loads(result.stdout), os.getcwd()
        try:
            os.chdir(tempfile.gettempdir())
            adapter = load_adapter()
        finally:
            os.chdir(cwd)
        names = ('SOURCE_MESH', 'MATERIAL_SLOT', 'ITEM_SLOT', 'CONTEXT', 'EXPECTED_COUNT', 'GLB_SHA256', 'MORPH_NAMES',
                 'MESH_FACTS', 'FITTING_TAGS', 'EXPECTED_ACTIVATED_TAGS_BY_ITEM',
                 'BASELINE_ADVERTISED', 'BASELINE_INDEXED', 'CATALOG_ITEMS')
        self.assertEqual({n: freeze[n] for n in names}, {n: getattr(adapter, n) for n in names})
        self.assertEqual(freeze['MESH_REPORT'], adapter.MESH_REPORT.as_posix())
        # The source-index count, not the product UI's full touched total of 549.
        self.assertEqual((adapter.BASELINE_ADVERTISED, adapter.BASELINE_STRUCTURAL, adapter.BASELINE_INDEXED,
                          adapter.CATALOG_ITEMS), (502, 503, 503, 2866))
        self.assertEqual((adapter.MESH_FACTS, adapter.GLB_SHA256, adapter.MORPH_NAMES),
                         ({'vertices': 3080, 'triangles': 5028, 'uvSets': 2, 'bones': 12, 'materialSections': 1},
                          '69f401a4311275046e5ddd3ed25e187ad0a912fc983f4a2fb2a3c40f3ada47b3', ['medium_male', 'medium_female']))
        self.assertEqual((adapter.SOURCE_MESH, adapter.MATERIAL_SLOT, adapter.ITEM_SLOT, adapter.MARKER),
                         ('/Game/Discovery/Characters/Military/Assets/SniperBoots/SK_Military_SniperBoots_M.SK_Military_SniperBoots_M',
                          'SniperBoots', 'feet', 'shader-probe/prepare-sniper-boots'))

    def test_cohort_mesh_morphs_tags_baseline_lookup_and_append_only_writes(self):
        result = subprocess.run([*self.node(), '--input-type=module', '-e', FREEZE_CHECK, FREEZE.as_uri(), str(COHORT)],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('freeze contracts ok', result.stdout)

    def test_production_resolver_on_medium_admits_one_boot_part_with_its_fitting_tags(self):
        node = self.node('--import', 'tsx', '--no-warnings')
        if subprocess.run([*node, '-e', ''], capture_output=True).returncode:
            self.skipTest('the installed tsx loader is unavailable')
        result = subprocess.run([*node, '--input-type=module', '-e', RESOLVER_CHECK, FREEZE.as_uri(), RESOLVER.as_uri(),
                                 str(COHORT)], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('resolver contracts ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
