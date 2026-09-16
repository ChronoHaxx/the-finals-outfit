"""Focused negative contracts for the Military Assault Vest adapter and freeze, without game assets.

The adapter is loaded against a stub of prepare-large-sneakers.py (its real dependencies live only in the
complete repository); freeze.mjs validators are pure exports and are exercised through node, and the
production resolver is run on synthetic definitions when node can strip its types. The supplied
source-only cohort.json is the only fixture; values under test come from the modules, not copies.

  C:/ProgramData/anaconda3/python.exe -B tests/test_assault_vests_adapter.py -v
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
ADAPTER = ROOT / 'scripts' / 'shader-probe' / 'prepare-assault-vests.py'
FREEZE = ROOT / '_docs' / 'assault-vests-2026-09-15' / 'freeze.mjs'
RESOLVER = ROOT / 'src' / 'rig' / 'SourceAssembly.ts'
COHORT = ROOT / '_docs' / 'assault-vests-2026-09-15' / 'cohort.json'
DEFAULT_MATERIAL = ('/Game/Discovery/Characters/Military/Assets/AssaultVest/'
                    'M_Military_AssaultVest.M_Military_AssaultVest')
# The previous (T-shirt) family's tags, and the gloves family's sleeve morphs: stale values from
# neighbouring batches that must never pass for this family.
TSHIRT_TAGS = ['Customization.Shape.PushInsideClothes.push_torso', 'Customization.HideMesh.WearingLongJacket',
               'Customization.Shape.ShrinkWrap.shrink_skirt_shorts_in', 'Customization.Shape.ShrinkWrap.shrink_half_skirt_in']
GLOVE_SLEEVE_MORPHS = ['shrink_gloves_under_jacket', 'shrink_gloves_under_jacket_right']
# The four choices whose source definitions carry no under-collar shrink wrap.
WITHOUT_UNDER_COLLAR = ['military-assaultvest-polyester-greencamo', 'military-assaultvest-polyester-moolahcamo',
                        'military-assaultvest-polyester-redblue', 'military-assaultvest-polyester-swat']


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
    configure('_docs/starter-tshirts-2026-09-15/batch.json', 'tshirts', 'tshirts-runtime', 'tshirts-preview')
    shared = types.SimpleNamespace(d=d, DOCS=Path('tshirts'), WORK=Path('tshirts'), RUNTIME=Path('tshirts'),
                                   PREVIEW=Path('tshirts'), MESH_REPORT=Path('tshirts'), progress=None,
                                   audit_blocked=lambda: {}, extract=object(), plan=object(),
                                   index=mock.Mock(), derive_coverage=mock.Mock())
    d.extract, d.plan = object(), object()
    real = importlib.util.spec_from_file_location

    def fake(name, location, *args, **kwargs):
        if name == 'prepare_large_sneakers':
            return importlib.machinery.ModuleSpec(name, _StubLoader(shared))
        raise AssertionError(f'The adapter loads only prepare-large-sneakers.py, not {location}')

    spec = real('prepare_assault_vests', ADAPTER)
    module = importlib.util.module_from_spec(spec)
    with mock.patch('importlib.util.spec_from_file_location', fake):
        spec.loader.exec_module(module)
    return module


def mesh_document(names, slot, uv_sets=2, bones=52):
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
        self.other_mesh = self.a.SOURCE_MESH.replace('AssaultVest_M', 'AssaultVest_F')

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
        dto = folder / 'SK_Military_AssaultVest_M.mesh.json'
        a.d.write(dto, {'source': dto_source or package, 'sourceMaterials': [{'MaterialSlotName': slot}],
                        'materials': [{'path': DEFAULT_MATERIAL}], 'lods': [{'morphs': [{'name': n} for n in names]}]})
        a.d.write(folder / 'assets.json', [{'path': record_path or package, 'sha256': 'pkg', 'meshFile': dto.name,
                                            'exports': exports or [{'type': 'SkeletalMesh'}]}])
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [package])
        a.d.write(a.d.SOURCE / 'meshes-01.run.json', {'exitCode': 0})
        path = a.WORK / 'meshes' / 'SK_Military_AssaultVest_M.glb'
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
        for name, stale in (('REUSE_TEXTURES', [Path('scripts/generated/shader-probe/starter-tshirts-v1/opus-textures-01')]),
                            ('MESH_EVIDENCE', [Path('scripts/generated/shader-probe/starter-tshirts-v1/meshes-01')]),
                            ('MARKER', 'shader-probe/prepare-starter-tshirts'), ('plan', object())):
            original = getattr(a.d, name)
            setattr(a.d, name, stale)
            with self.assertRaises(SystemExit):
                a._require_configuration()
            setattr(a.d, name, original)
        for name, stale in (('MESH_REPORT', Path('_docs/starter-tshirts-2026-09-15/mesh-report.json')), ('progress', print)):
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
                       {**cohort, 'meshes': [self.other_mesh]}, {**cohort, 'attached': True},
                       {**cohort, 'items': [{**first, 'slot': 'hands'}, *rest]},
                       {**cohort, 'items': [{**first, 'materials': first['materials'] * 2}, *rest]},
                       {**cohort, 'items': [first, first, *rest[1:]]},
                       # A renamed choice no longer has a row in the per-choice fitting tag mapping.
                       {**cohort, 'items': [{**first, 'id': first['id'] + '-v2'}, *rest]},
                       {**cohort, 'materials': cohort['materials'][1:]}):
            a.d.write(a.DOCS / 'cohort.json', broken)
            with self.assertRaises(SystemExit):
                a._require_cohort()

    def test_each_choice_keeps_its_own_fitting_tags(self):
        a, mapping = self.a, self.a.EXPECTED_ACTIVATED_TAGS_BY_ITEM
        collar, plain = 'military-assaultvest-polyester-black', WITHOUT_UNDER_COLLAR[0]
        self.assertEqual(sorted(mapping), sorted(item['id'] for item in self.cohort['items']))
        self.assertEqual(sorted(i for i, tags in mapping.items() if a.UNDER_COLLAR not in tags), WITHOUT_UNDER_COLLAR)
        self.assertEqual(sorted({tag for tags in mapping.values() for tag in tags}), sorted([*a.COMMON_TAGS, a.UNDER_COLLAR]))
        self.assertEqual((len(mapping[collar]), len(mapping[plain])), (9, 8))
        self.assertTrue(all(set(a.COMMON_TAGS) <= set(tags) for tags in mapping.values()))
        # Each choice is validated against its own row, in any order; another row is drift, as is an unknown id.
        self.assertTrue(a._is_fitting_tags(plain, mapping[plain][::-1]))
        self.assertFalse(a._is_fitting_tags(plain, mapping[collar]))
        self.assertFalse(a._is_fitting_tags(collar, mapping[plain]))
        self.assertFalse(a._is_fitting_tags(collar + '-v2', mapping[collar]))
        self.assertFalse(a._is_fitting_tags(collar, None))
        self.assertFalse(a._is_fitting_tags(collar, TSHIRT_TAGS))

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
        with self.assertRaisesRegex(SystemExit, 'preserved assault-vest conversion'):
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
        a.d.write(a.d.SOURCE / 'meshes-01.requests.json', [a.d.package_of(self.other_mesh)])
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
        self.assertEqual((recorded['morphNames'], recorded['slots'], recorded['bones']), (a.MORPH_NAMES, slots, 52))
        a.d.mesh_verifier.verify.return_value = {'passed': False}
        with self.assertRaisesRegex(SystemExit, 'no longer verify'):
            a.mesh()
        other = a.d.package_of(self.other_mesh)
        female, male = a.MORPH_NAMES
        for change, reason in (({'slot': 'TShirt'}, 'AssaultVest material slot'),
                               ({'dto_source': other}, 'DTO source identity'),
                               ({'record_path': other}, 'mesh source identity'),
                               ({'report_source': self.other_mesh}, 'mesh source identity'),
                               ({'exports': [{'type': 'SkeletalMesh'}, {'type': 'StaticMesh'}]}, 'one SkeletalMesh'),
                               ({'exports': [{'type': 'StaticMesh'}]}, 'one SkeletalMesh'),
                               # Consistently lost, reordered, invented or renamed in DTO and GLB alike.
                               ({'morphs': [female]}, 'not the original'),
                               ({'morphs': []}, 'not the original'),
                               ({'morphs': [male, female]}, 'not the original'),  # the T-shirt mesh's order
                               ({'morphs': [female, 'Medium_Male']}, 'not the original'),
                               ({'morphs': [*a.MORPH_NAMES, *GLOVE_SLEEVE_MORPHS]}, 'not the original'),  # no sleeve morphs here
                               # Lost or misnamed only by the conversion.
                               ({'glb_names': [female]}, 'GLB morph target names'),
                               ({'glb_names': [female, 'medium_mal']}, 'GLB morph target names'),
                               ({'glb_names': list(reversed(a.MORPH_NAMES))}, 'GLB morph target names'),
                               ({'glb_names': []}, 'GLB morph target names'),
                               ({'facts': {'bones': 27}}, 'differs from the exported mesh'),
                               ({'facts': {'vertices': 19019}}, 'differs from the exported mesh'),
                               ({'facts': {'triangles': 29024}}, 'differs from the exported mesh'),
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
        self.assertEqual(a._require_glb_geometry({**report, 'morphs': list(names), 'bones': list(range(52))}, dto), names)
        path.write_bytes(glb({**document, 'meshes': [{**mesh, 'weights': [0] * len(names)}]}))  # explicit zero defaults
        self.assertEqual(a._require_glb_geometry(report, dto), names)
        for broken_report in ({**report, 'uvSets': 1}, {**report, 'uvSets': True}, {**report, 'bones': 0},
                              {**report, 'morphs': len(names) - 1}, {**report, 'morphs': None},
                              {**report, 'morphs': names[::-1]}, {**report, 'triangles': None}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(broken_report, dto)
        for broken_dto in ({'lods': [{'morphs': [{'name': names[0]}, {'name': names[0]}]}]}, {'lods': []},
                           {'lods': [{'morphs': [{'name': ''}] * len(names)}]}):
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report, broken_dto)
        for broken_mesh in ({**mesh, 'extras': {}},                                          # names lost
                            {**mesh, 'extras': {'targetNames': [names[0], 'renamed']}},
                            {**mesh, 'extras': {'targetNames': names[::-1]}},                # reordered
                            {**mesh, 'primitives': [{**primitive, 'targets': primitive['targets'][:-1]}]},  # target dropped
                            {**mesh, 'primitives': [{'attributes': attributes}]},            # all targets dropped
                            {**mesh, 'primitives': [{**primitive, 'targets': [{'NORMAL': 1}] * len(names)}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {**attributes, 'TEXCOORD_2': 9}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'TEXCOORD_1'}}]},
                            {**mesh, 'primitives': [{**primitive, 'attributes': {k: v for k, v in attributes.items() if k != 'WEIGHTS_0'}}]}):
            path.write_bytes(glb({**document, 'meshes': [broken_mesh]}))
            with self.assertRaises(SystemExit):
                a._require_glb_geometry(report, dto)
        # A body morph switched on by default (mesh or node weights) would reshape every vest.
        for activated in ({**document, 'meshes': [{**mesh, 'weights': [0, 1]}]},
                          {**document, 'nodes': [{'mesh': 0, 'skin': 0, 'weights': [0.5, 0]}]}):
            path.write_bytes(glb(activated))
            with self.assertRaisesRegex(SystemExit, 'by default'):
                a._require_glb_geometry(report, dto)
        path.write_bytes(glb({**document, 'skins': []}))
        with self.assertRaises(SystemExit):
            a._require_glb_geometry(report, dto)

    def test_frozen_cohort_keeps_one_vest_part_and_each_choices_own_fitting_tags(self):
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
        # One choice that shrinks under the collar, and one that must never be given that tag.
        collar = next(i for i, row in enumerate(rows) if a.UNDER_COLLAR in row['fittingTags'])
        plain = next(i for i, row in enumerate(rows) if a.UNDER_COLLAR not in row['fittingTags'])
        collar_tags, plain_tags = rows[collar]['fittingTags'], rows[plain]['fittingTags']

        def stage(changed=None, **fields):
            items = [{**row, **(changed or {}).get(i, {})} for i, row in enumerate(rows)]
            a.d.write(a.DOCS / 'resolved-cohort.json', {**frozen, **fields, 'items': items})

        def tagged(index, properties):
            return {index: {'definition': {**rows[index]['definition'], 'properties': properties}}}

        stage(); a._require_frozen_cohort(report, slots)
        stage(tagged(collar, {'ActivatesTags': collar_tags[::-1]})); a._require_frozen_cohort(report, slots)  # source order is free
        stage({plain: {'fittingTags': plain_tags[::-1]}}); a._require_frozen_cohort(report, slots)
        part, wrong_slot = rows[0]['effectiveParts'][0], {'slot': 'TShirt', 'material': rows[0]['materials'][0]}
        drift = 'does not activate exactly'
        for changed, fields, reason in ((tagged(collar, {}), {}, drift),  # missing is not valid for a vest
                                        (tagged(collar, {'ActivatesTags': []}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': a.COMMON_TAGS}), {}, drift),  # collar lost
                                        # The under-collar tag is never added to a choice that lacks it.
                                        (tagged(plain, {'ActivatesTags': [*a.COMMON_TAGS, a.UNDER_COLLAR]}), {}, drift),
                                        (tagged(plain, {'ActivatesTags': collar_tags}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': collar_tags[:-1]}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': [*collar_tags[:-1], collar_tags[0]]}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': [*collar_tags, collar_tags[0]]}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': [*collar_tags, TSHIRT_TAGS[0]]}), {}, drift),
                                        (tagged(collar, {'ActivatesTags': TSHIRT_TAGS}), {}, drift),
                                        (tagged(plain, {'ActivatesTags': [*a.COMMON_TAGS[:-1],
                                                                          a.COMMON_TAGS[-1].replace('_in', '_out')]}), {}, drift),
                                        ({plain: {'fittingTags': []}}, {}, drift),
                                        ({plain: {'fittingTags': collar_tags}}, {}, drift),
                                        ({collar: {'fittingTags': plain_tags}}, {}, drift),
                                        ({0: {'effectiveParts': [{**part, 'mesh': self.other_mesh}]}}, {}, 'assault-vest mesh'),
                                        ({0: {'effectiveParts': [{**part, 'slots': [wrong_slot]}]}}, {}, 'assault-vest mesh'),
                                        ({0: {'effectiveParts': [part, {**part, 'sourceIndex': 1}]}}, {}, 'assault-vest mesh'),
                                        ({0: {'slot': 'hands'}}, {}, 'differs from cohort.json'),
                                        (None, {'context': 'Customization.Archetype.Light'}, 'not resolved for'),
                                        (None, {'meshes': [self.other_mesh]}, 'different mesh report'),
                                        (None, {'sourceSlots': [{**slots[0], 'slot': 'TShirt'}]}, 'different mesh report')):
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
                       {'preview': {**preview, 'previousAdvertised': a.BASELINE_ADVERTISED - 1}},
                       {'preview': {**preview, 'previewAssemblies': a.BASELINE_STRUCTURAL + 2}},
                       {'preview': {**preview, 'marker': 'shader-probe/prepare-starter-tshirts'}},
                       {'preview': {**preview, 'implemented': ['starterset-tshirt-x']}}):
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

// The supplied cohort is accepted; count, slot, mesh, attachment, id and material-list drift fail.
m.assertCohort(cohort);
assert.throws(() => m.assertCohort({...cohort, count: m.EXPECTED_COUNT + 1}), /count/);
assert.throws(() => m.assertCohort({...cohort, meshes: [m.SOURCE_MESH, m.SOURCE_MESH]}), /skeletal mesh/);
assert.throws(() => m.assertCohort({...cohort, attached: true}), /attached/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], slot: 'hands'}, ...rest]}), /slot/);
assert.throws(() => m.assertCohort({...cohort, items: [{...cohort.items[0], id: 'renamed'}, ...rest]}), /fitting tag mapping/);
assert.throws(() => m.assertCohort({...cohort, materials: cohort.materials.slice(1)}), /material list/);

// The mesh report must be hash-current, name the preserved GLB and describe the exported Medium mesh.
const report = {glb: 'g.glb', meshJson: 'm.json', sha256: m.GLB_SHA256, sourceDtoSha256: 'dto', source: m.packageOf(m.SOURCE_MESH),
  sourcePackageSha256: 'pkg', verification: {passed: true}, ...m.MESH_FACTS, morphs: m.MORPH_NAMES.length};
const shaOf = glbSha => p => p === 'g.glb' ? glbSha : 'dto';
const inventory = new Set([m.packageOf(m.SOURCE_MESH)]);
m.assertMeshReport(report, inventory, shaOf(m.GLB_SHA256));
m.assertMeshReport({...report, bones: Array.from({length: m.MESH_FACTS.bones}, (_, i) => `b${i}`)}, inventory, shaOf(m.GLB_SHA256));
assert.throws(() => m.assertMeshReport({...report, sha256: 'ff'}, inventory, shaOf('ff')), /preserved assault-vest conversion/);
assert.throws(() => m.assertMeshReport(report, inventory, shaOf('ff')), /GLB hash does not match/);
assert.throws(() => m.assertMeshReport({...report, source: m.SOURCE_MESH.replaceAll('AssaultVest_M', 'AssaultVest_F')}, inventory, shaOf(m.GLB_SHA256)), /skeletal mesh/);
assert.throws(() => m.assertMeshReport({...report, source: m.SOURCE_MESH.replaceAll('AssaultVest', 'TShirt')}, inventory, shaOf(m.GLB_SHA256)), /skeletal mesh/);
assert.throws(() => m.assertMeshReport(report, new Set(), shaOf(m.GLB_SHA256)), /inventory/);
for (const drift of [{bones: 27}, {uvSets: 1}, {vertices: '19020'}, {triangles: 29024}, {materialSections: 2}])
  assert.throws(() => m.assertMeshReport({...report, ...drift}, inventory, shaOf(m.GLB_SHA256)), /is not the exported/);
const slot = m.MATERIAL_SLOT;
assert.deepEqual(m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}], materials: [{path: '/Game/M.M'}]}),
  [{slot, material: '/Game/M.M'}]);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: 'TShirt'}], materials: [{path: '/Game/M.M'}]}), /material slot must be/);
assert.throws(() => m.sourceSlotsFromDto({sourceMaterials: [{MaterialSlotName: slot}, {MaterialSlotName: 'Print'}],
  materials: [{path: '/Game/M.M'}, {path: '/Game/B.B'}]}), /exactly one/);

// Morph targets are the two original Medium morphs by name, order and count, inactive by default.
const names = m.MORPH_NAMES;
assert.deepEqual(names, ['medium_female', 'medium_male']);
const dtoFor = list => ({lods: [{morphs: list.map(name => ({name}))}]});
const primitive = {attributes: {POSITION: 0}, targets: names.map((_, i) => ({POSITION: i + 1}))};
const glbDoc = {meshes: [{extras: {targetNames: names}, primitives: [primitive]}], nodes: [{mesh: 0}]};
assert.deepEqual(m.morphNamesFromDto(dtoFor(names)), names);
m.assertGlbMorphs(glbDoc, names, report);
m.assertGlbMorphs(glbDoc, names, {...report, morphs: names});
m.assertGlbMorphs({...glbDoc, meshes: [{...glbDoc.meshes[0], weights: [0, 0]}]}, names, report);
assert.throws(() => m.morphNamesFromDto(dtoFor([names[0], names[0]])), /not unique/);
// Lost, reordered into the T-shirt mesh's order, renamed, or the gloves family's sleeve morphs added.
for (const list of [names.slice(0, 1), [], [...names].reverse(), ['medium_female', 'Medium_Male'],
                    [...names, 'shrink_gloves_under_jacket', 'shrink_gloves_under_jacket_right']])
  assert.throws(() => m.morphNamesFromDto(dtoFor(list)), /original Medium morphs/);
assert.throws(() => m.assertGlbMorphs(glbDoc, names, {...report, morphs: 1}), /morph count/);
assert.throws(() => m.assertGlbMorphs({meshes: [{primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: [...names].reverse()}, primitives: [primitive]}]}, names, report), /target names/);
assert.throws(() => m.assertGlbMorphs({meshes: [{extras: {targetNames: names}, primitives: [{...primitive, targets: primitive.targets.slice(1)}]}]}, names, report), /primitive morph targets/);
assert.throws(() => m.assertGlbMorphs({...glbDoc, meshes: [{...glbDoc.meshes[0], weights: [0, 1]}]}, names, report), /by default/);
assert.throws(() => m.assertGlbMorphs({...glbDoc, nodes: [{mesh: 0, weights: [1, 0]}]}, names, report), /by default/);
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

const latest = 'Discovery/Content/Discovery/Characters/Military/Assets/AssaultVest/Skins/Polyester_Black/MI_Military_AssaultVest_Polyester_Black.uasset';
const saved = latest.replace('Polyester_Black/', 'Polyester_BLACK/');
const other = latest.replaceAll('Polyester_Black', 'Polyester_Red');
const archive = m.foldedIndex([latest, other]), inventoryIndex = m.foldedIndex(new Set([latest, other]));

// Fitting tags are per choice: eight shared, and the under-collar shrink wrap only where it belongs.
const collarId = 'military-assaultvest-polyester-black', plainId = 'military-assaultvest-polyester-greencamo';
const collarTags = m.tagsFor(collarId), plainTags = m.tagsFor(plainId);
assert.deepEqual(Object.keys(m.EXPECTED_ACTIVATED_TAGS_BY_ITEM).sort(), cohort.items.map(item => item.id).sort());
assert.deepEqual(plainTags, m.COMMON_TAGS);
assert.deepEqual([...collarTags].sort(), [...m.COMMON_TAGS, m.UNDER_COLLAR].sort());
assert.deepEqual(Object.keys(m.EXPECTED_ACTIVATED_TAGS_BY_ITEM).filter(id => !m.tagsFor(id).includes(m.UNDER_COLLAR)).sort(),
  ['military-assaultvest-polyester-greencamo', 'military-assaultvest-polyester-moolahcamo',
   'military-assaultvest-polyester-redblue', 'military-assaultvest-polyester-swat']);
assert.equal(m.isFittingTags('military-assaultvest-polyester-unknown', collarTags), false);
assert.equal(m.isFittingTags(plainId, collarTags), false);
assert.equal(m.isFittingTags(collarId, plainTags), false);
assert.equal(m.isFittingTags(plainId, [...plainTags].reverse()), true);

const definition = {formatVersion: 1, id: collarId, source: saved, sourceSha256: 'ab',
  properties: {Slots: ['upperBody'], ActivatesTags: collarTags}};
const current = {status: 'ok', package: {path: latest, sha256: 'ab'},
  exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['upperBody'], ActivatesTags: collarTags}}]};
const tshirtTags = ['Customization.Shape.PushInsideClothes.push_torso', 'Customization.HideMesh.WearingLongJacket',
  'Customization.Shape.ShrinkWrap.shrink_skirt_shorts_in', 'Customization.Shape.ShrinkWrap.shrink_half_skirt_in'];
m.assertDefinition({id: collarId}, definition);
m.assertDefinition({id: collarId}, {...definition, properties: {...definition.properties, ActivatesTags: [...collarTags].reverse()}});
// Missing, empty, partial, repeated, extra, renamed, the previous family's tags, another choice's row,
// and the under-collar tag added to a choice that lacks it are all drift.
for (const drift of [undefined, [], collarTags.slice(0, 3), [...collarTags.slice(0, 8), collarTags[0]], [...collarTags, collarTags[0]],
                     [...collarTags, tshirtTags[0]], tshirtTags, plainTags,
                     [...m.COMMON_TAGS.slice(0, 7), 'Customization.Shape.ShrinkWrap.shrink_half_skirt_out', m.UNDER_COLLAR],
                     collarTags.map(tag => tag.toLowerCase())])
  assert.throws(() => m.assertDefinition({id: collarId}, {...definition, properties: {Slots: ['upperBody'], ActivatesTags: drift}}), /activated tags/);
assert.throws(() => m.assertDefinition({id: plainId}, {...definition, id: plainId,
  properties: {Slots: ['upperBody'], ActivatesTags: [...m.COMMON_TAGS, m.UNDER_COLLAR]}}), /activated tags/);
// A choice with no row in the mapping cannot be validated at all.
assert.throws(() => m.assertDefinition({id: 'renamed'}, {...definition, id: 'renamed'}), /activated tags/);

// A unique case-only difference locates the record; the saved path is not rewritten.
assert.deepEqual(m.resolveDefinitionPackage(definition, archive, inventoryIndex, collarId), {archive: latest, inventory: latest, exactCase: false});
assert.equal(definition.source, saved);
assert.deepEqual(m.resolveDefinitionPackage({...definition, source: latest}, archive, inventoryIndex, collarId).exactCase, true);
m.assertCurrentDefinition(definition, definition, current);
// The exact package hash and decoded properties (including the activated tags) are still compared.
assert.throws(() => m.assertCurrentDefinition(definition, definition, {...current, package: {path: latest, sha256: 'AB'}}), /source package changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['hands'], ActivatesTags: collarTags}}]}), /source properties changed/);
assert.throws(() => m.assertCurrentDefinition(definition, definition,
  {...current, exports: [{type: 'CharacterCustomizationItem', properties: {Slots: ['upperBody'], ActivatesTags: plainTags}}]}), /source properties changed/);
// Missing, ambiguous (case-only collision, even with one exact spelling; duplicated key) and disagreeing lookups fail.
assert.throws(() => m.resolveDefinitionPackage({...definition, source: saved.replace('MI_Military_AssaultVest_Polyester_Black', 'MI_Absent')}, archive, inventoryIndex, collarId), /absent/);
for (const colliding of [m.foldedIndex([latest, saved]), m.foldedIndex([latest, latest])]) {
  assert.throws(() => m.resolveDefinitionPackage(definition, colliding, inventoryIndex, collarId), /ambiguous/);
  assert.throws(() => m.resolveDefinitionPackage({...definition, source: latest}, archive, colliding, collarId), /ambiguous/);
}
assert.throws(() => m.resolveDefinitionPackage(definition, archive, m.foldedIndex([latest.toUpperCase()]), collarId), /disagree/);

// Resolved-part admission: one visible part on the source mesh with the cohort's effective material.
const slots = [{slot, material: '/Game/Default.Default'}];
const part = {sourceIndex: 0, skeletalMesh: m.SOURCE_MESH, staticMesh: '', effect: '', hidden: false, unresolved: [],
  materials: {[slot]: '/Game/M.M'}, definition: {}};
const item = {id: collarId, materials: ['/Game/M.M']};
assert.deepEqual(m.assertResolved(item, definition, {parts: [part], materialParameters: []}, slots), [{slot, material: '/Game/M.M'}]);
for (const bad of [{WrapDeformation: {bIsWrapDeformed: true}}, {LocalScale: {X: 1, Y: 2, Z: 1}}, {LocalPosition: {X: 0, Y: 0, Z: 1}},
                   {LogicModules: [{}]}, {bIsAttached: true}, {OptionalAttachmentMesh: {AssetPathName: '/Game/A.A'}}])
  assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, definition: bad}], materialParameters: []}, slots));
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {}}]}, slots), /effective resolved materials/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, materials: {Other: '/Game/M.M'}}]}, slots), /absent slot/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part, {...part, sourceIndex: 1}]}, slots), /one visible part/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, skeletalMesh: m.SOURCE_MESH.replaceAll('_M\u002E', '_F.')}]}, slots), /assault-vest mesh/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, unresolved: ['multi-tag condition 0']}]}, slots), /unresolved/);
assert.throws(() => m.assertResolved(item, definition, {parts: [{...part, effect: '/Game/E.E'}]}, slots), /effects/);
assert.throws(() => m.assertResolved(item, definition, {parts: [part], materialParameters: [{}]}, slots), /material parameters/);
assert.throws(() => m.assertResolved(item, {...definition, properties: {ActivatesMaterialParameters: [{}]}}, {parts: [part]}, slots), /parameter rules/);

// Frozen outputs: only the three adapter files; identical rerun is a no-op; drift in any target fails before
// the first write; the preflight frozen-baseline.json is never a target.
assert.deepEqual(Object.values(m.FROZEN_OUTPUTS).map(file => path.basename(file)), ['resolved-cohort.json', 'batch.json', 'adapter-baseline.json']);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.assault-vests-freeze-'));
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
const plain = cohort.items.find(choice => !m.tagsFor(choice.id).includes(m.UNDER_COLLAR));
const soft = AssetPathName => ({AssetPathName, SubPathString: ''});
const slots = [{slot: m.MATERIAL_SLOT, material: '/Game/Discovery/Characters/Military/Assets/AssaultVest/M_Default.M_Default'}];
const rule = (tags, fields) => ({MatchingTags: tags, bOverrideMesh: false, ReplacementStaticMesh: soft(''),
  ReplacementSkeletalMesh: soft(''), bOverrideEffect: false, ReplacementEffect: soft(''), bOverrideMaterials: false,
  MaterialOverrides: [], ...fields});
const LIGHT = m.SOURCE_MESH.replaceAll('AssaultVest_M', 'AssaultVest_L'), HEAVY = m.SOURCE_MESH.replaceAll('AssaultVest_M', 'AssaultVest_H');
const archetypes = [rule(['Customization.Archetype.Light'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)}),
                    rule(['Customization.Archetype.Heavy'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(HEAVY)})];
const part = {StaticMesh: soft(''), SkeletalMesh: soft(m.SOURCE_MESH), Effect: soft(''), TagOverrides: archetypes,
  LocalPosition: {X: 0, Y: 0, Z: 0}, LocalRotation: {Pitch: 0, Yaw: 0, Roll: 0}, LocalScale: {X: 1, Y: 1, Z: 1}};
// Source tag order is not significant; the resolver reports fitting tags sorted.
const definition = {formatVersion: 1, id: item.id, source: 'Discovery/Content/AssaultVest.uasset', sourceSha256: 'ab',
  properties: {Slots: ['UpperBody'], ActivatesTags: [...m.tagsFor(item.id)].reverse(),
    MaterialOverrides: [{Key: m.MATERIAL_SLOT, Value: soft(material)}], VisualParts: [part]}};
const variant = (properties, partFields = {}) => ({...definition,
  properties: {...definition.properties, ...properties, VisualParts: [{...part, ...partFields}]}});
const resolve = (def, choice = item) => m.resolveChoice(choice, def, slots, resolveSourceOutfit);
const rejects = (def, pattern) => assert.throws(() => resolve(def), pattern);

// Medium resolves one visible part on the vest mesh with the cohort material and hands that choice's own
// fitting tags to the production fitting logic; Light/Heavy overrides stay outside.
const ok = resolve(definition);
assert.deepEqual(ok.effectiveSlots, [{slot: m.MATERIAL_SLOT, material}]);
assert.deepEqual([ok.visible.length, ok.visible[0].skeletalMesh, ok.outfit.fittingTags],
  [1, m.SOURCE_MESH, [...m.tagsFor(item.id)].sort()]);
assert.equal(resolveSourceOutfit([definition], ['Customization.Archetype.Light']).items[item.id].parts[0].skeletalMesh, LIGHT);

// A choice whose source definition carries no under-collar shrink wrap resolves without one, and is
// rejected if the family's other row is applied to it.
const plainDefinition = {...definition, id: plain.id,
  properties: {...definition.properties, ActivatesTags: [...m.tagsFor(plain.id)],
    MaterialOverrides: [{Key: m.MATERIAL_SLOT, Value: soft(plain.materials[0])}]}};
const plainOk = resolve(plainDefinition, plain);
assert.deepEqual(plainOk.outfit.fittingTags, [...m.COMMON_TAGS].sort());
assert.equal(plainOk.outfit.fittingTags.includes(m.UNDER_COLLAR), false);
assert.throws(() => resolve({...plainDefinition, properties: {...plainDefinition.properties,
  ActivatesTags: [...m.COMMON_TAGS, m.UNDER_COLLAR]}}, plain), /activated tags/);

// Missing, empty, partial or foreign (T-shirt) activated tags are drift for a vest.
for (const tags of [undefined, [], m.tagsFor(item.id).slice(0, 3), [...m.tagsFor(item.id), 'Customization.HideMesh.NailsCovered']])
  rejects(variant({ActivatesTags: tags}), /activated tags/);
// The activated tags feed rule matching too (by prefix): a part hidden or re-meshed by its own tag is rejected.
rejects(variant({}, {TagOverrides: [...archetypes, rule(['Customization.HideMesh.WristsCovered'], {bOverrideMesh: true})]}), /hidden/);
rejects(variant({}, {TagOverrides: [...archetypes, rule(['Customization.Shape.ShrinkWrap'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})]}), /assault-vest mesh/);

const medium = fields => ({TagOverrides: [...archetypes, rule([m.CONTEXT], fields)]});
rejects(variant({}, medium({bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})), /assault-vest mesh/);
rejects(variant({}, medium({bOverrideMesh: true})), /hidden/);
rejects(variant({}, {TagOverrides: [rule([m.CONTEXT, 'Customization.Archetype.Light'], {bOverrideMesh: true, ReplacementSkeletalMesh: soft(LIGHT)})]}), /unresolved part/);
rejects(variant({}, medium({bOffsetTransform: true})), /unresolved part/);
rejects(variant({}, medium({bAddLogicModules: true})), /unresolved part/);
rejects(variant({}, medium({bOverrideEffect: true, ReplacementEffect: soft('/Game/FX/E.E')})), /effects/);
rejects(variant({}, medium({bOverrideMaterials: true, MaterialOverrides: [{Key: m.MATERIAL_SLOT, Value: soft(cohort.items[1].materials[0])}]})), /effective resolved materials/);
rejects(variant({MaterialOverrides: []}), /effective resolved materials/);
rejects(variant({MaterialOverrides: [{Key: 'TShirt', Value: soft(material)}]}), /absent slot/);
rejects({...definition, properties: {...definition.properties, VisualParts: [part, part]}}, /one visible part/);
rejects(variant({}, {bIsAttached: true}), /attached/);
rejects(variant({}, {OptionalAttachmentMesh: soft('/Game/A.A')}), /attachment/);
rejects(variant({}, {LogicModules: [{}]}), /logic/);
rejects(variant({}, {WrapDeformation: {bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft('')}}), /wrap/);
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
                 'MESH_FACTS', 'COMMON_TAGS', 'UNDER_COLLAR', 'SHRINKS_UNDER_COLLAR', 'EXPECTED_ACTIVATED_TAGS_BY_ITEM',
                 'BASELINE_ADVERTISED', 'BASELINE_INDEXED', 'CATALOG_ITEMS')
        self.assertEqual({n: freeze[n] for n in names}, {n: getattr(adapter, n) for n in names})
        self.assertEqual(freeze['MESH_REPORT'], adapter.MESH_REPORT.as_posix())
        # The source-index count, not the product UI's full touched total of 539.
        self.assertEqual((adapter.BASELINE_ADVERTISED, adapter.BASELINE_STRUCTURAL, adapter.BASELINE_INDEXED,
                          adapter.CATALOG_ITEMS), (492, 493, 493, 2866))
        self.assertEqual((adapter.MESH_FACTS, adapter.GLB_SHA256[:12], adapter.MORPH_NAMES),
                         ({'vertices': 19020, 'triangles': 29023, 'uvSets': 2, 'bones': 52, 'materialSections': 1},
                          '2c0e14a13c5c', ['medium_female', 'medium_male']))

    def test_cohort_mesh_morphs_tags_baseline_lookup_resolution_and_append_only_writes(self):
        result = subprocess.run([*self.node(), '--input-type=module', '-e', FREEZE_CHECK, FREEZE.as_uri(), str(COHORT)],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('freeze contracts ok', result.stdout)

    def test_production_resolver_on_medium_admits_one_vest_part_with_its_fitting_tags(self):
        node = self.node('--import', 'tsx', '--no-warnings')
        if subprocess.run([*node, '-e', ''], capture_output=True).returncode:
            self.skipTest('the installed tsx loader is unavailable')
        result = subprocess.run([*node, '--input-type=module', '-e', RESOLVER_CHECK, FREEZE.as_uri(), RESOLVER.as_uri(),
                                 str(COHORT)], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('resolver contracts ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
