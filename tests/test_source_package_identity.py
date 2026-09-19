"""Source package identity: exact paths and the narrow directory-case tolerance, without game assets.

  C:/ProgramData/anaconda3/python.exe -B tests/test_source_package_identity.py -v
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'scripts' / 'shader-probe'
sys.path.insert(0, str(PROBE))
import source_package_identity as spi  # noqa: E402

AUDIT = json.loads((ROOT / 'tests' / 'fixtures' / 'source-package-identity' / 'directory-case.json').read_text(encoding='utf-8'))
TACTICAL, RACING = AUDIT['cases']
EXACT = '/Game/Discovery/Characters/Exact/MI_Exact.MI_Exact'
EXACT_PACKAGE = 'Discovery/Content/Discovery/Characters/Exact/MI_Exact.uasset'
ROOT_MATERIAL = '/Game/Discovery/Materials/M_CharacterAttachment'
ROOT_PACKAGE = 'Discovery/Content/Discovery/Materials/M_CharacterAttachment.uasset'
# Sibling modules not supplied to this workspace; the adapter paths under test do not use them.
UNSUPPLIED = {'build-materials', 'build-meshes', 'verify-meshes', 'prepare-coverage-preview', 'prepare-accessories',
              'stage-validated-materials'}


def package(object_path):
    return 'Discovery/Content/' + object_path.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


class Resolve(unittest.TestCase):
    def test_exact_path(self):
        self.assertEqual(spi.resolve(EXACT, [ROOT_PACKAGE, EXACT_PACKAGE]),
                         {'match': 'exact', 'package': EXACT_PACKAGE, 'object': EXACT})

    def test_observed_directory_case_fixtures(self):
        for case in (TACTICAL, RACING):
            found = spi.resolve(case['source'], [ROOT_PACKAGE, case['matches'][0]['exportedPath']])
            self.assertEqual(found, {'match': 'directory-case', 'package': case['matches'][0]['exportedPath'],
                                     'object': case['matches'][0]['exportedObject']})
            self.assertEqual(case['source'].rsplit('.', 1)[1], found['object'].rsplit('.', 1)[1])

    def test_case_collisions_are_rejected_even_with_an_exact_match(self):
        actual = TACTICAL['matches'][0]['exportedPath']
        for inventory in ([actual, package(TACTICAL['source'])],  # the exact one is present as well
                          [actual, actual.replace('/Military/', '/MILITARY/')]):
            with self.assertRaisesRegex(ValueError, 'ambiguous ignoring case'):
                spi.resolve(TACTICAL['source'], inventory)
        for inventory in ([EXACT_PACKAGE, 'Discovery/Content/Other/mi_exact.uasset'],   # basename case variant elsewhere
                          [EXACT_PACKAGE, 'Discovery/Content/Other/MI_Exact.uasset']):  # same basename elsewhere
            with self.assertRaisesRegex(ValueError, 'not unique'):
                spi.resolve(EXACT, inventory)
        self.assertEqual(spi.resolve(EXACT, [EXACT_PACKAGE, EXACT_PACKAGE])['match'], 'exact')  # one package listed twice

    def test_other_differences_stay_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not in the working export'):  # another directory, no basename fallback
            spi.resolve('/Game/Discovery/Characters/Other/MI_Exact.MI_Exact', [EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'not in the working export'):  # another package name
            spi.resolve('/Game/Discovery/Characters/Exact/MI_Exact2.MI_Exact2', [EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'Object name differs'):
            spi.resolve('/Game/Discovery/Characters/Exact/MI_Exact.MI_Other', [EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'Object name differs'):  # case-only object name
            spi.resolve('/Game/Discovery/Characters/Exact/MI_Exact.MI_EXACT', [EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'Package name differs'):  # case-only basename, directory exact
            spi.resolve('/Game/Discovery/Characters/Exact/MI_EXACT.MI_EXACT', [EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'Package name differs'):  # directory and basename case
            spi.resolve(TACTICAL['source'], [TACTICAL['matches'][0]['exportedPath'].replace('TacticalBootsPouch_Nylon', 'TACTICALBootsPouch_Nylon')])
        with self.assertRaisesRegex(ValueError, 'directory differs'):  # non-ASCII case folding is not accepted
            spi.resolve('/Game/Straße/MI_A.MI_A', ['Discovery/Content/STRASSE/MI_A.uasset'])
        for bad in ('Game/A/MI_A.MI_A', '/Game/A/MI_A', '/Game/A//MI_A.MI_A', '/Game/../MI_A.MI_A', '/Game/A\\B/MI_A.MI_A',
                    '/Game/A/MI_A.', '/Game/A/MI_A.b.MI_A', '/Game/ A/MI_A.MI_A', None):
            with self.assertRaisesRegex(ValueError, 'Malformed'):
                spi.resolve(bad, ['Discovery/Content/A/MI_A.uasset'])
        for bad in ('Content/A/MI_A.uasset', 'Discovery/Content/A/MI_A.uexp', 'Discovery/Content/A//MI_A.uasset',
                    'Discovery/Content/A/MI_A.b.uasset'):
            with self.assertRaisesRegex(ValueError, 'Malformed'):
                spi.match('Discovery/Content/A/MI_A.uasset', bad)


def record(object_path, parent=None):
    stem, name = object_path.removeprefix('/Game/').rsplit('.', 1)
    return {'Name': name, 'Package': '/Game/' + stem,
            'Properties': {'Parent': {'ObjectPath': parent}} if parent else {}}


class Chain(unittest.TestCase):
    ROOT = record(ROOT_MATERIAL + '.M_CharacterAttachment')

    def test_exact_chain_and_export_index_links(self):
        for link in (ROOT_MATERIAL + '.0', ROOT_MATERIAL + '.M_CharacterAttachment'):
            members = spi.chain_identity([self.ROOT, record(EXACT, link)], [ROOT_PACKAGE, EXACT_PACKAGE])
            self.assertEqual([(m['match'], m['parent'] and m['parent']['match']) for m in members], [('exact', None), ('exact', 'exact')])

    def test_parent_link_into_another_directory_is_rejected(self):
        for link in ('/Game/Discovery/Elsewhere/M_CharacterAttachment.0', '/Game/Discovery/Materials/M_Other.0',
                     ROOT_MATERIAL + '.M_Other', '/Game/Discovery/Materials/M_CHARACTERATTACHMENT.0'):
            with self.assertRaises(ValueError):
                spi.chain_identity([self.ROOT, record(EXACT, link)], [ROOT_PACKAGE, EXACT_PACKAGE])

    def test_directory_case_member_and_link_are_reported(self):
        link = ROOT_MATERIAL.replace('Materials', 'MATERIALS') + '.0'
        actual = RACING['matches'][0]['exportedPath']
        members = spi.chain_identity([self.ROOT, record(RACING['source'], link)], [ROOT_PACKAGE, actual])
        self.assertEqual(members[1], {'object': RACING['source'], 'package': actual, 'exportedObject': RACING['matches'][0]['exportedObject'],
                                      'match': 'directory-case', 'parent': {'object': link, 'match': 'directory-case'}})

    def test_root_with_parent_or_member_without_link_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'has a parent'):
            spi.chain_identity([record(EXACT, ROOT_MATERIAL + '.0')], [ROOT_PACKAGE, EXACT_PACKAGE])
        with self.assertRaisesRegex(ValueError, 'no parent link'):
            spi.chain_identity([self.ROOT, record(EXACT)], [ROOT_PACKAGE, EXACT_PACKAGE])


def load_defaults():
    """The actual adapter module; only the unsupplied sibling modules are empty stand-ins."""
    real = importlib.util.spec_from_file_location

    class Empty:
        def create_module(self, spec): return None
        def exec_module(self, module): pass

    def spec_for(name, location, *args, **kwargs):
        return importlib.util.spec_from_loader(name, Empty()) if Path(location).stem in UNSUPPLIED else real(name, location, *args, **kwargs)

    spec = real('prepare_accessory_defaults', PROBE / 'prepare-accessory-defaults.py')
    module = importlib.util.module_from_spec(spec)
    with mock.patch.object(importlib.util, 'spec_from_file_location', spec_for):
        spec.loader.exec_module(module)
    return module


def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


class StageSource(unittest.TestCase):
    """prepare-accessory-defaults.stage_source over one synthetic probe export (no probe, validate.ps1 mocked)."""
    WRONG_FOLDER = '/Game/Discovery/Characters/Other/MI_Exact.MI_Exact'
    ELSEWHERE = '/Game/Discovery/Characters/Linked/MI_Linked.MI_Linked'

    def setUp(self):
        self.cwd, self.tmp = os.getcwd(), tempfile.TemporaryDirectory()
        os.chdir(self.tmp.name)
        self.addCleanup(lambda: (os.chdir(self.cwd), self.tmp.cleanup()))
        self.d = load_defaults()
        self.d.configure('batch.json', 'work', 'public/runtime', 'public/preview')
        folder = self.d.SOURCE / 'materials-01'
        link = ROOT_MATERIAL + '.0'
        # (decoded object, exported package, decoded parent link): Tactical decodes with the exported directory
        # spelling, Racing with the requested one; MI_Linked's parent link names another directory.
        exports = [(ROOT_MATERIAL + '.M_CharacterAttachment', ROOT_PACKAGE, None), (EXACT, EXACT_PACKAGE, link),
                   (TACTICAL['matches'][0]['exportedObject'], TACTICAL['matches'][0]['exportedPath'], link),
                   (RACING['source'], RACING['matches'][0]['exportedPath'], link),
                   (self.ELSEWHERE, package(self.ELSEWHERE), '/Game/Discovery/Elsewhere/M_CharacterAttachment.0')]
        results = []
        for decoded, path, parent in exports:
            dto = record(decoded, parent)
            if parent is None: dto['CachedExpressionData'] = {'ReferencedTextures': []}
            else: write(folder / f'{dto["Name"]}.SP_PCD3D_SM5.uniforms.json', {})
            write(folder / f'{dto["Name"]}.json', [dto])
            (folder / f'{dto["Name"]}.uasset').write_bytes(path.encode())
            results.append({'name': dto['Name'], 'path': path, **({'parent': link} if parent else {})})
        write(folder / 'probe-summary.json', {'results': results})
        write(folder / 'shader-extraction.json', [])
        write(folder / 'source-run.json', {'mappingSha256': 'm', 'sourceContainers': [{'name': 'c', 'sha256': 'x'}]})
        self.sources = [EXACT, TACTICAL['source'], RACING['source'], self.WRONG_FOLDER, self.ELSEWHERE]
        write('cohort.json', {'items': []})
        write('batch.json', {'cohort': 'cohort.json', 'ids': ['a']})
        write(self.d.CATALOG, []); write(self.d.ACTIVE / 'assets.json', {'meshes': {}, 'materials': {}})
        items = [{'id': 'a', 'parts': [{'slots': [{'slot': f's{i}', 'material': s} for i, s in enumerate(self.sources)]}]}]
        self.plan = mock.patch.object(self.d, 'plan', return_value=(json.loads(Path('batch.json').read_text()), items, []))

    def validate(self, command, **kwargs):
        working = Path(command[command.index('-Exports') + 1])
        write(working / 'validation.json', {'passed': True})
        for dto in working.glob('MI_*.json'):
            write(working / 'bindings' / f'{dto.stem}.SP_PCD3D_SM5.basepass-pixel.bindings.json', {'textureBindings': []})
        return 0

    def run_source(self):
        with self.plan, mock.patch.object(self.d, 'extract', side_effect=AssertionError('no extraction expected')), \
                mock.patch.object(self.d.subprocess, 'call', side_effect=self.validate):
            self.d.stage_source(argparse.Namespace(fresh_sources=True))
        return {row['source']: row for row in json.loads((self.d.SOURCE / 'material-resolution.json').read_text())}

    def test_resolution_rows(self):
        rows = self.run_source()
        working = self.d.SOURCE / 'working-01'
        sha = lambda name: self.d.file_sha(working / f'{name}.uasset')
        root = {'object': ROOT_MATERIAL + '.M_CharacterAttachment', 'package': ROOT_PACKAGE, 'uassetSha256': sha('M_CharacterAttachment')}
        # Exact path: the row keeps its earlier shape, with no identity evidence added.
        self.assertEqual(rows[EXACT], {'source': EXACT, 'instance': 'MI_Exact', 'chain': [
            root, {'object': EXACT, 'package': EXACT_PACKAGE, 'uassetSha256': sha('MI_Exact')}],
            'root': 'M_CharacterAttachment', 'owner': 'MI_Exact', 'textures': []})
        for case, decoded_as_requested in ((TACTICAL, False), (RACING, True)):
            row, match = rows[case['source']], case['matches'][0]
            self.assertEqual((row['source'], row['instance'], row['owner'], row['root']),
                             (case['source'], case['instance'], case['instance'], 'M_CharacterAttachment'))
            self.assertEqual(row['sourcePackage'], {'match': 'directory-case', 'requested': {'object': case['source'], 'package': package(case['source'])},
                                                    'actual': {'object': match['exportedObject'], 'package': match['exportedPath'],
                                                               'uassetSha256': sha(case['instance'])}})
            self.assertEqual(sha(case['instance']), self.d.sha(match['exportedPath']))
            member = {'object': case['source'] if decoded_as_requested else match['exportedObject'], 'package': match['exportedPath'],
                      'uassetSha256': sha(case['instance'])}
            if decoded_as_requested: member['exported'] = {'object': match['exportedObject'], 'match': 'directory-case'}
            self.assertEqual(row['chain'], [root, member])
        self.assertEqual(rows[self.WRONG_FOLDER]['error'], 'Exact source package is not in the working export')
        self.assertRegex(rows[self.ELSEWHERE]['error'], 'Chain member does not match.*directory differs')
        ready = json.loads((self.d.WORK / 'source-ready.json').read_text())
        self.assertEqual(ready['defaultMaterials'], sorted(self.sources))

        # The index adapter's key check: the actual build-assembly-assets key of each built manifest, then renamed.
        resolution = json.loads((self.d.SOURCE / 'material-resolution.json').read_text())
        inventory = self.d.exported_inventory(working)
        built = {self.d.assembly_index.object_path(p): f'candidate/{p}' for p in
                 (EXACT_PACKAGE, TACTICAL['matches'][0]['exportedPath'], RACING['matches'][0]['exportedPath'])}
        keyed = spi.requested_keys(built, resolution, inventory)
        self.assertEqual(set(keyed), {EXACT, TACTICAL['source'], RACING['source']})
        self.assertEqual(keyed[RACING['source']], 'candidate/' + RACING['matches'][0]['exportedPath'])
        exact_only = {k: v for k, v in built.items() if k == EXACT}
        self.assertEqual(spi.requested_keys(exact_only, [r for r in resolution if 'sourcePackage' not in r], inventory), exact_only)
        tampered = [{**r, 'sourcePackage': {**r['sourcePackage'], 'actual': {**r['sourcePackage']['actual'], 'package': EXACT_PACKAGE}}}
                    if 'sourcePackage' in r else r for r in resolution]
        with self.assertRaisesRegex(ValueError, 'no longer holds'):
            spi.requested_keys(built, tampered, inventory)
        with self.assertRaisesRegex(ValueError, 'collide'):  # the canonical spelling is itself requested elsewhere
            spi.requested_keys(built, resolution + [{'source': TACTICAL['matches'][0]['exportedObject'], 'instance': TACTICAL['instance']}], inventory)
        with self.assertRaisesRegex(ValueError, 'ambiguous'):  # the evidence is re-checked against today's inventory
            spi.requested_keys(built, resolution, inventory + [package(TACTICAL['source'])])


if __name__ == '__main__':
    unittest.main()
