"""The Season 12 body-type item rule must never let a mixed item into the preview, and must say why it held a mesh.

The real risk is a whole-catalogue merge: a mesh swapped under an item that still shows a pre-S12 garment pokes through
(stage 1, short dress). These checks drive build-preview-index.py on a synthetic index of a few items and meshes, so no
game data, GLB or server is needed. (Run: python -I scripts/body-types/test_build_preview_index.py)
"""
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_preview_index', HERE / 'build-preview-index.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

BODY = '/Game/Body/SK_Body_M.SK_Body_M'


def path(name):
    return f'/Game/Items/{name}.{name}'


def mesh_ref(name):
    return {'AssetPathName': path(name)}


class ItemRule(unittest.TestCase):
    def build(self, items, proof, morphs, changed_only=False, census=True, admit=None, admit_only=None,
              admit_reviewed=None):
        """items: {item: [mesh names]}; proof: {mesh: (status, morphsChanged, problems)}; morphs: {mesh: [names]};
        admit: {mesh: (skin-proof class, admissible)} written as a skin-by-name proof (tier 1, 12 Nov 2026)."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        meshes = sorted({m for ms in items.values() for m in ms} | {'SK_Body_M'})
        active = tmp / 'active'
        active.mkdir()
        assets = {'meshes': {(BODY if m == 'SK_Body_M' else path(m)): {'url': f'../live/{m}.glb', 'sha256': 'live'}
                             for m in meshes},
                  'attachmentBody': {'source': BODY, 'url': '../live/SK_Body_M.glb', 'sha256': 'live'}}
        (active / 'assets.json').write_text(json.dumps(assets), encoding='utf-8')
        (active / 'supported-items.json').write_text(json.dumps({'items': sorted(items)}), encoding='utf-8')
        custom = {'catalog': {item: f'DA_{item}' for item in items},
                  'definitions': {f'DA_{item}': {'properties': {'VisualParts': [{'SkeletalMesh': mesh_ref(m)} for m in ms]}}
                                  for item, ms in items.items()}}
        (tmp / 'customization.json').write_text(json.dumps(custom), encoding='utf-8')
        census_rows = {key: {'url': row['url'], 'morphs': morphs.get(key.rsplit('.', 1)[-1], [])}
                       for key, row in assets['meshes'].items()}
        (tmp / 'census.json').write_text(json.dumps(census_rows), encoding='utf-8')
        rebuilt = tmp / 'rebuilt'
        rebuilt.mkdir()
        rows = {}
        for name, (status, changed, problems) in proof.items():
            key = BODY if name == 'SK_Body_M' else path(name)
            rows[name] = {'source': key, 'liveUrl': f'../live/{name}.glb', 'status': status,
                          'morphsChanged': changed, **({'problems': problems} if problems else {})}
            (rebuilt / f'{name}.glb').write_bytes(name.encode())
        (tmp / 'proof.json').write_text(json.dumps(rows), encoding='utf-8')
        skin_proof = None
        if admit is not None:
            (tmp / 'live').mkdir()
            skin = {}
            for name, (cls, admissible) in admit.items():
                live = tmp / 'live' / f'{name}.glb'
                live.write_bytes(b'live ' + name.encode())
                sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
                skin[name] = {'source': path(name), 'liveUrl': f'../live/{name}.glb', 'class': cls,
                              'admissible': admissible, 'liveSha256': sha(live),
                              's12Sha256': sha(rebuilt / f'{name}.glb'), 'morphsChanged': rows[name]['morphsChanged']}
            skin_proof = tmp / 'skin-proof.json'
            skin_proof.write_text(json.dumps({'meshes': skin}), encoding='utf-8')
            self.skin_proof = skin_proof
        out = tmp / 'out' / 'assets.json'
        tool.main(str(active / 'assets.json'), str(tmp / 'proof.json'), str(rebuilt), str(out),
                  str(tmp / 'customization.json'), str(tmp / 'census.json') if census else None, changed_only,
                  admit_json=str(skin_proof) if skin_proof else None, admit_only=admit_only, admit_reviewed=admit_reviewed)
        return json.loads(out.read_text(encoding='utf-8'))['s12BodyTypePreview']

    CHANGED = {'medium_female': {'maxCm': 3.0, 'verticesChanged': 10}}
    SHAPED = ['medium_male', 'medium_female']

    def test_a_mesh_shown_with_a_refused_mesh_is_held(self):
        meta = self.build({'dress': ['Shell', 'Undershirt'], 'shirt': ['Undershirt']},
                          {'SK_Body_M': ('morph-only', self.CHANGED, None),
                           'Undershirt': ('morph-only', self.CHANGED, None),
                           'Shell': ('refused', {}, ['POSITION differs'])},
                          {'Shell': self.SHAPED, 'Undershirt': self.SHAPED, 'SK_Body_M': self.SHAPED})
        self.assertNotIn(path('Undershirt'), meta['swapped'])
        self.assertEqual(meta['held'][path('Undershirt')]['items'], ['dress'])
        self.assertIn(BODY, meta['swapped'])  # the body is exempt from the rule

    def test_a_mesh_without_body_type_morphs_never_makes_an_item_mixed(self):
        items = {'jacket': ['Jacket', 'Badge']}
        proof = {'Jacket': ('morph-only', self.CHANGED, None)}
        morphs = {'Jacket': self.SHAPED, 'Badge': []}
        self.assertIn(path('Jacket'), self.build(items, proof, morphs)['swapped'])
        # Without the census (stage 1 behaviour) the unread Badge holds it.
        self.assertIn(path('Jacket'), self.build(items, proof, morphs, census=False)['held'])

    def test_a_refused_mesh_with_unchanged_morphs_and_vertices_does_not_hold_others(self):
        items = {'pants': ['Pants', 'Belt']}
        morphs = {'Pants': self.SHAPED, 'Belt': self.SHAPED}
        kept = self.build(items, {'Pants': ('morph-only', self.CHANGED, None),
                                  'Belt': ('refused', {}, ['WEIGHTS_0 differs', 'TEXCOORD_0 differs'])}, morphs)
        self.assertIn(path('Pants'), kept['swapped'])
        self.assertEqual(kept['keptUnchanged'], [path('Belt')])
        # The same refusal with moved vertices or changed morphs is a real pre-S12 mesh: it holds the pants.
        for problems, changed in ((['POSITION differs'], {}), (['primitive 0 vertex count differs (3 live vs 4 rebuilt)'], {}),
                                  (['WEIGHTS_0 differs'], self.CHANGED)):
            meta = self.build(items, {'Pants': ('morph-only', self.CHANGED, None),
                                      'Belt': ('refused', changed, problems)}, morphs)
            self.assertIn(path('Pants'), meta['held'], problems)
            self.assertEqual(meta['keptUnchanged'], [])

    def test_a_held_mesh_names_the_root_item_not_itself(self):
        # Jeans shared by three items; only the lumberjack variant shows a refused belt.
        items = {'jeans-a': ['Jeans'], 'jeans-b': ['Jeans'], 'jeans-lumberjack': ['Jeans', 'Belt']}
        meta = self.build(items, {'Jeans': ('morph-only', self.CHANGED, None),
                                  'Belt': ('refused', self.CHANGED, ['POSITION differs'])},
                          {'Jeans': self.SHAPED, 'Belt': self.SHAPED})
        self.assertEqual(meta['held'][path('Jeans')]['items'], ['jeans-lumberjack'])

    def test_holding_cascades_to_the_fixpoint(self):
        # Top is held by the refused Vest; Skirt is shown with Top elsewhere, so it is held too.
        items = {'layered': ['Top', 'Vest'], 'outfit': ['Top', 'Skirt'], 'skirt': ['Skirt']}
        meta = self.build(items, {'Top': ('morph-only', self.CHANGED, None), 'Skirt': ('morph-only', self.CHANGED, None),
                                  'Vest': ('refused', self.CHANGED, ['POSITION differs'])},
                          {'Top': self.SHAPED, 'Skirt': self.SHAPED, 'Vest': self.SHAPED})
        self.assertEqual(set(meta['held']), {path('Top'), path('Skirt')})
        self.assertEqual(meta['swapped'], {})

    def test_changed_only_repoints_only_changed_meshes_and_the_body(self):
        items = {'shoes': ['Shoes'], 'coat': ['Coat']}
        proof = {'SK_Body_M': ('morph-only', self.CHANGED, None), 'Shoes': ('morph-only', {}, None),
                 'Coat': ('morph-only', self.CHANGED, None)}
        morphs = {'Shoes': self.SHAPED, 'Coat': self.SHAPED, 'SK_Body_M': self.SHAPED}
        meta = self.build(items, proof, morphs, changed_only=True)
        self.assertEqual(set(meta['swapped']), {BODY, path('Coat')})
        self.assertIn(path('Shoes'), meta['effective'])  # unchanged still counts as Season 12
        self.assertEqual(set(self.build(items, proof, morphs)['swapped']), {BODY, path('Coat'), path('Shoes')})

    # Tier 1 (12 Nov 2026): refused meshes admitted from skin-by-name-proof.py.
    REENCODED = ['WEIGHTS_0 differs', 'JOINTS_0 differs', 'skin joint names differ']

    def test_an_admitted_mesh_counts_as_proven_and_releases_what_it_held(self):
        items = {'tee': ['Tee'], 'outfit': ['Tee', 'Pants']}
        proof = {'Tee': ('refused', self.CHANGED, self.REENCODED), 'Pants': ('morph-only', self.CHANGED, None)}
        morphs = {'Tee': self.SHAPED, 'Pants': self.SHAPED}
        self.assertIn(path('Pants'), self.build(items, proof, morphs)['held'])
        meta = self.build(items, proof, morphs, changed_only=True, admit={'Tee': ('re-encoded', True)})
        self.assertEqual(set(meta['swapped']), {path('Tee'), path('Pants')})
        self.assertEqual(meta['swapped'][path('Tee')]['admitted'], {'class': 're-encoded', 'by': 'proof'})
        self.assertEqual(meta['admitted'][path('Tee')]['name'], 'Tee')

    def test_a_morph_set_mesh_is_repointed_only_by_review_and_never_skipped(self):
        # A morph-set change leaves morphsChanged empty; it must not pass as "unchanged" and stay on its live GLB.
        items = {'tee': ['StarterTee']}
        proof = {'StarterTee': ('refused', {}, ['morph names differ: -[] +[\'shrink_under_vest\']'])}
        morphs = {'StarterTee': self.SHAPED}
        admit = {'StarterTee': ('morph set', False)}
        with self.assertRaises(SystemExit):
            self.build(items, proof, morphs, admit=admit, admit_only=['StarterTee'])
        self.assertEqual(self.build(items, proof, morphs, admit=admit)['swapped'], {})  # not admissible by default
        meta = self.build(items, proof, morphs, changed_only=True, admit=admit, admit_reviewed=['StarterTee'])
        self.assertEqual(meta['swapped'][path('StarterTee')]['admitted'], {'class': 'morph set', 'by': 'review'})

    def test_an_admitted_mesh_with_unchanged_morphs_is_repointed_not_kept(self):
        # A weights-only change with no morph change is "kept" on its live GLB unless admitted.
        items = {'coat': ['Coat']}
        proof = {'Coat': ('refused', {}, ['WEIGHTS_0 differs'])}
        morphs = {'Coat': self.SHAPED}
        self.assertEqual(self.build(items, proof, morphs, changed_only=True)['keptUnchanged'], [path('Coat')])
        meta = self.build(items, proof, morphs, changed_only=True, admit={'Coat': ('weights', False)},
                          admit_reviewed=['Coat'])
        self.assertEqual(meta['keptUnchanged'], [])
        self.assertIn(path('Coat'), meta['swapped'])

    def test_surface_or_loader_refusals_and_stale_files_are_never_admitted(self):
        items = {'pants': ['Pants']}
        morphs = {'Pants': self.SHAPED}
        proof = {'Pants': ('refused', self.CHANGED, ['POSITION differs'])}
        for cls in ('surface differs', 'loader refuses'):
            with self.assertRaises(SystemExit):
                self.build(items, proof, morphs, admit={'Pants': (cls, False)}, admit_reviewed=['Pants'])
        # The live file the skin proof judged was replaced since: refuse rather than swap an unjudged mesh.
        original = tool.admitted_meshes

        def stale(admit_json, *args):
            skin = json.loads(Path(admit_json).read_text(encoding='utf-8'))
            skin['meshes']['Pants']['liveSha256'] = '0' * 64
            Path(admit_json).write_text(json.dumps(skin), encoding='utf-8')
            return original(admit_json, *args)
        tool.admitted_meshes = stale
        self.addCleanup(setattr, tool, 'admitted_meshes', original)
        with self.assertRaises(SystemExit):
            self.build(items, {'Pants': ('refused', self.CHANGED, self.REENCODED)}, morphs,
                       admit={'Pants': ('re-encoded', True)})

    def test_a_census_from_another_index_is_refused(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        (tmp / 'census.json').write_text(json.dumps({path('A'): {'url': '../x/A.glb', 'morphs': self.SHAPED}}))
        with self.assertRaises(SystemExit):
            tool.body_type_meshes(tmp / 'census.json', {path('A'): {'url': '../y/A.glb'}})


if __name__ == '__main__':
    unittest.main()
