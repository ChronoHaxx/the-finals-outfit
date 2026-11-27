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
              admit_reviewed=None, surface=None, admit_rework=None, masked=(), package=None, masks=None, ship_masks=None,
              s12_live=(), item_masked=(), allow_mixed=None, holds=None):
        """items: {item: [mesh names]}; proof: {mesh: (status, morphsChanged, problems)}; morphs: {mesh: [names]};
        admit: {mesh: (skin-proof class, admissible)} written as a skin-by-name proof (tier 1, 12 Nov 2026);
        surface: {mesh: surface-proof class} written as a surface-match proof (tier 2, 22 Nov 2026), for meshes whose
        skin-proof class is "surface differs"; package: {mesh: identical} written as a package proof (tier 2, 23 Nov
        2026); meshes it omits are missing from the proof; masks: {mesh: status or (status, s12Sha256)} written as a
        mask proof (23 Nov 2026), hashes taken from the skin proof unless given."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        meshes = sorted({m for ms in items.values() for m in ms} | {'SK_Body_M'})
        active = tmp / 'active'
        active.mkdir()
        assets = {'meshes': {(BODY if m == 'SK_Body_M' else path(m)): {'url': f'../live/{m}.glb', 'sha256': 'live'}
                             for m in meshes},
                  'attachmentBody': {'source': BODY, 'url': '../live/SK_Body_M.glb', 'sha256': 'live'}}
        for m in item_masked:  # an item mask names it (one item, one mask)
            assets.setdefault('itemBodyMasks', {})[f'DA_{m}'] = {path(m): {'url': f'../coverage/item-{m}.bodymask.png'}}
        for m in s12_live:     # the active index already serves the rebuild (an earlier batch applied it)
            assets['meshes'][path(m)].update({'url': f'../rebuilt/{m}.glb', 'sha256': hashlib.sha256(m.encode()).hexdigest()})
        for m in masked:
            assets['meshes'][path(m)]['bodyMaskUrl'] = f'../coverage/{m}.bodymask.png'
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
        surface_proof = None
        if surface is not None:
            rows_s = {name: {**{k: skin[name][k] for k in ('source', 'liveUrl', 'liveSha256', 's12Sha256')},
                             'class': cls, 'admissible': cls == 'permuted', 'morphsChanged': rows[name]['morphsChanged']}
                      for name, cls in surface.items()}
            surface_proof = tmp / 'surface-proof.json'
            surface_proof.write_text(json.dumps({'meshes': rows_s}), encoding='utf-8')
            self.surface_proof = surface_proof
        package_proof = None
        if package is not None:
            package_proof = tmp / 'package-proof.json'
            package_proof.write_text(json.dumps({'all': [{'mesh': m, 'identical': same} for m, same in package.items()]}),
                                     encoding='utf-8')
        mask_proof = None
        if masks is not None:
            rows_m = {}
            for name, status in masks.items():
                status, s12 = status if isinstance(status, tuple) else (status, skin[name]['s12Sha256'])
                rows_m[name] = {'source': path(name), 'status': status, 'liveSha256': skin[name]['liveSha256'],
                                's12Sha256': s12, 'reasons': [] if status == 'unchanged' else [status],
                                'masks': [{'kind': 'body', 'url': f'../coverage/{name}.bodymask.png'}] if name in masked else [],
                                **({'s12BodyMask': {'file': f'cov/{name}.bodymask.png', 'sha256': 'mask'}}
                                   if status == 'body-changed' else {})}
            mask_proof = tmp / 'mask-proof.json'
            mask_proof.write_text(json.dumps({'meshes': rows_m}), encoding='utf-8')
        out = tmp / 'out' / 'assets.json'
        tool.main(str(active / 'assets.json'), str(tmp / 'proof.json'), str(rebuilt), str(out),
                  str(tmp / 'customization.json'), str(tmp / 'census.json') if census else None, changed_only,
                  admit_json=str(skin_proof) if skin_proof else None, admit_only=admit_only, admit_reviewed=admit_reviewed,
                  surface_json=str(surface_proof) if surface_proof else None, admit_rework=admit_rework,
                  package_json=str(package_proof) if package_proof else None,
                  mask_json=str(mask_proof) if mask_proof else None, ship_masks=ship_masks, allow_mixed=allow_mixed,
                  **({'holds': holds} if holds is not None else {}))
        self.out_assets = json.loads(out.read_text(encoding='utf-8'))
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

    # Tier 2 (22 Nov 2026): surface-differs meshes admitted from surface-match-proof.py.
    REORDERED = ['POSITION differs', 'TEXCOORD_0 differs', 'primitive 0 indices differ']

    def test_a_permuted_mesh_is_admitted_by_the_surface_proof_and_releases_what_it_held(self):
        items = {'boots': ['Boots'], 'outfit': ['Boots', 'Pants']}
        proof = {'Boots': ('refused', self.CHANGED, self.REORDERED), 'Pants': ('morph-only', self.CHANGED, None)}
        morphs = {'Boots': self.SHAPED, 'Pants': self.SHAPED}
        admit = {'Boots': ('surface differs', False)}
        # The skin proof alone never admits a surface refusal...
        self.assertIn(path('Pants'), self.build(items, proof, morphs, admit=admit)['held'])
        # ...the surface proof's "permuted" does, and the held pants cascade in.
        meta = self.build(items, proof, morphs, changed_only=True, admit=admit, surface={'Boots': 'permuted'})
        self.assertEqual(set(meta['swapped']), {path('Boots'), path('Pants')})
        self.assertEqual(meta['admitted'][path('Boots')]['class'], 'permuted')
        self.assertEqual(meta['admitted'][path('Boots')]['proof'], 'surface-match')
        self.assertIn('surfaceProofSha256', meta)

    def test_permuted_with_tier1_kinds_needs_review_and_reworked_never_passes(self):
        items = {'boots': ['Boots']}
        proof = {'Boots': ('refused', self.CHANGED, self.REORDERED)}
        morphs = {'Boots': self.SHAPED}
        admit = {'Boots': ('surface differs', False)}
        self.assertEqual(self.build(items, proof, morphs, admit=admit, surface={'Boots': 'permuted+weights'})['swapped'], {})
        meta = self.build(items, proof, morphs, admit=admit, surface={'Boots': 'permuted+weights'}, admit_reviewed=['Boots'])
        self.assertEqual(meta['admitted'][path('Boots')]['by'], 'review')
        for cls in ('reworked: same UVs, geometry moved', 'reworked: UVs changed, geometry within 1 mm'):
            with self.assertRaises(SystemExit):
                self.build(items, proof, morphs, admit=admit, surface={'Boots': cls}, admit_reviewed=['Boots'])

    def test_a_surface_proof_of_other_files_is_refused(self):
        items = {'boots': ['Boots']}
        proof = {'Boots': ('refused', self.CHANGED, self.REORDERED)}
        morphs = {'Boots': self.SHAPED}
        original = tool.admitted_meshes

        def stale(admit_json, admit_only, admit_reviewed, proof_, assets, served, rebuilt, surface_json=None, *rest):
            s = json.loads(Path(surface_json).read_text(encoding='utf-8'))
            s['meshes']['Boots']['s12Sha256'] = '0' * 64
            Path(surface_json).write_text(json.dumps(s), encoding='utf-8')
            return original(admit_json, admit_only, admit_reviewed, proof_, assets, served, rebuilt, surface_json, *rest)
        tool.admitted_meshes = stale
        self.addCleanup(setattr, tool, 'admitted_meshes', original)
        with self.assertRaises(SystemExit):
            self.build(items, proof, morphs, admit={'Boots': ('surface differs', False)}, surface={'Boots': 'permuted'})

    SAME_UVS = 'reworked: same UVs, geometry within 1 mm'

    def test_a_reworked_mesh_without_masks_is_admitted_only_by_name(self):
        items = {'mask': ['SkiMask']}
        proof = {'SkiMask': ('refused', {}, self.REORDERED)}
        morphs = {'SkiMask': self.SHAPED}
        admit = {'SkiMask': ('surface differs', False)}
        self.assertEqual(self.build(items, proof, morphs, admit=admit, surface={'SkiMask': self.SAME_UVS})['swapped'], {})
        meta = self.build(items, proof, morphs, admit=admit, surface={'SkiMask': self.SAME_UVS}, admit_rework=['SkiMask'])
        self.assertEqual(meta['admitted'][path('SkiMask')], {**meta['admitted'][path('SkiMask')],
                                                             'class': self.SAME_UVS, 'by': 'review'})
        self.assertIn(path('SkiMask'), meta['swapped'])

    def test_a_reworked_mesh_with_a_body_mask_or_new_uvs_is_refused(self):
        items = {'socks': ['Socks']}
        proof = {'Socks': ('refused', {}, self.REORDERED)}
        morphs = {'Socks': self.SHAPED}
        admit = {'Socks': ('surface differs', False)}
        with self.assertRaises(SystemExit):     # its body mask was projected from the old geometry
            self.build(items, proof, morphs, admit=admit, surface={'Socks': self.SAME_UVS}, admit_rework=['Socks'],
                       masked=['Socks'])
        for cls in ('reworked: UVs changed, geometry within 1 mm', 'reworked: UV0 tile shifts only, geometry within 1 mm',
                    'permuted+weights'):
            with self.assertRaises(SystemExit):
                self.build(items, proof, morphs, admit=admit, surface={'Socks': cls}, admit_rework=['Socks'])

    # Tier 2 (23 Nov 2026): masks derived from the garment's geometry. A reviewed mesh that carries masks is admitted
    # only when a mask proof shows every mask unchanged from the S12 mesh, or only the body mask changed and ships.
    def test_a_masked_mesh_is_admitted_only_when_its_masks_are_proven_unchanged(self):
        items = {'socks': ['Socks'], 'boots': ['Boots']}
        proof = {'Socks': ('refused', {}, self.REORDERED), 'Boots': ('refused', self.CHANGED, ['WEIGHTS_0 differs'])}
        morphs = {'Socks': self.SHAPED, 'Boots': self.SHAPED}
        admit = {'Socks': ('surface differs', False), 'Boots': ('weights', False)}
        kw = dict(admit=admit, surface={'Socks': self.SAME_UVS}, admit_rework=['Socks'], admit_reviewed=['Boots'],
                  masked=['Socks', 'Boots'])
        meta = self.build(items, proof, morphs, masks={'Socks': 'unchanged', 'Boots': 'unchanged'}, **kw)
        self.assertEqual(set(meta['swapped']), {path('Socks'), path('Boots')})
        self.assertEqual(meta['admitted'][path('Boots')]['masks'], 'unchanged')
        self.assertEqual(self.out_assets['meshes'][path('Socks')]['bodyMaskUrl'], '../coverage/Socks.bodymask.png')
        # The index moved after the proof: an item mask now names Boots that the proof never regenerated.
        with self.assertRaises(SystemExit):
            self.build(items, proof, morphs, masks={'Socks': 'unchanged', 'Boots': 'unchanged'}, item_masked=['Boots'], **kw)
        for masks in ({'Socks': 'unchanged'},                                  # Boots not judged
                      {'Socks': 'unchanged', 'Boots': 'unproven'},
                      {'Socks': 'unchanged', 'Boots': 'body-changed'},           # changed but not shipped
                      {'Socks': 'unchanged', 'Boots': ('unchanged', 'other file')}):  # judged another rebuild
            with self.assertRaises(SystemExit, msg=masks):
                self.build(items, proof, morphs, masks=masks, **kw)

    def test_a_changed_body_mask_ships_the_s12_mask_only_when_named(self):
        items = {'top': ['ClothTop']}
        proof = {'ClothTop': ('refused', {}, self.REORDERED)}
        morphs = {'ClothTop': self.SHAPED}
        kw = dict(admit={'ClothTop': ('surface differs', False)}, surface={'ClothTop': self.SAME_UVS},
                  admit_rework=['ClothTop'], masked=['ClothTop'], masks={'ClothTop': 'body-changed'})
        with self.assertRaises(SystemExit):
            self.build(items, proof, morphs, **kw)
        url = '../s12-refresh-tier2-v1/coverage-s12/ClothTop.bodymask.png'
        meta = self.build(items, proof, morphs, ship_masks={'ClothTop': url}, **kw)
        self.assertEqual(self.out_assets['meshes'][path('ClothTop')]['bodyMaskUrl'], url)
        self.assertEqual(meta['maskRepoints'][path('ClothTop')],
                         {'from': '../coverage/ClothTop.bodymask.png', 'to': url, 'sha256': 'mask',
                          'file': 'cov/ClothTop.bodymask.png'})
        # Already on its S12 file (an earlier batch applied it): the mask alone moves.
        live = {'ClothTop': ('morph-only', {}, None)}
        kw2 = dict(admit={'ClothTop': ('surface differs', False)}, masked=['ClothTop'], masks={'ClothTop': 'body-changed'})
        tmp_meta = self.build(items, live, morphs, changed_only=True, ship_masks={'ClothTop': url}, s12_live=['ClothTop'],
                              **kw2)
        self.assertEqual(tmp_meta['swapped'], {})
        self.assertEqual(tmp_meta['maskRepoints'][path('ClothTop')]['maskOnly'], True)
        self.assertEqual(self.out_assets['meshes'][path('ClothTop')]['bodyMaskUrl'], url)
        with self.assertRaises(SystemExit):    # an unchanged mask is never replaced
            self.build(items, proof, morphs, **{**kw, 'masks': {'ClothTop': 'unchanged'}}, ship_masks={'ClothTop': url})
        # v11 (23 Nov): named, but the item rule holds it (its outfit also shows pants that stay pre-S12). It keeps its
        # live file and its published mask, recorded as maskHeld, instead of stopping the build.
        outfit = {'outfit': ['ClothTop', 'Pants']}
        held_rows = {**proof, 'Pants': ('refused', self.CHANGED, self.REORDERED)}
        meta = self.build(outfit, held_rows, {**morphs, 'Pants': self.SHAPED}, ship_masks={'ClothTop': url}, **kw)
        self.assertEqual(meta['swapped'], {})
        self.assertIn(path('ClothTop'), meta['held'])
        self.assertEqual(meta['maskHeld'], ['ClothTop'])
        self.assertEqual(meta['maskRepoints'], {})
        self.assertEqual(self.out_assets['meshes'][path('ClothTop')]['bodyMaskUrl'], '../coverage/ClothTop.bodymask.png')
        with self.assertRaises(SystemExit):    # a name that is neither repointed nor held is still a mistake
            self.build(outfit, held_rows, {**morphs, 'Pants': self.SHAPED}, ship_masks={'ClothTop': url, 'Pants': url},
                       **kw)

    # Tier 2 (23 Nov 2026): the 17 Nov game update. Only packages proven byte-identical keep their 6 Nov rebuild.
    def test_a_package_changed_since_the_read_stays_live_and_holds_its_items(self):
        items = {'outfit': ['Top', 'Skirt'], 'skirt': ['Skirt'], 'tee': ['Tee']}
        proof = {'Top': ('morph-only', self.CHANGED, None), 'Skirt': ('morph-only', self.CHANGED, None),
                 'Tee': ('morph-only', {}, None)}
        morphs = {m: self.SHAPED for m in ('Top', 'Skirt', 'Tee')}
        meta = self.build(items, proof, morphs, package={'Top': False, 'Skirt': True})
        self.assertEqual(meta['swapped'], {})                     # Top stale, Skirt held by it
        self.assertEqual(meta['held'][path('Skirt')]['items'], ['outfit'])
        self.assertEqual(meta['stalePackages'], [path('Tee'), path('Top')])  # Tee is missing from the proof
        # Tee is stale but its live file already has the read's morphs: never repointed, still consistent.
        self.assertIn(path('Tee'), meta['effective'])
        self.assertIn(path('Tee'), meta['keptUnchanged'])
        # A stale package beside a proven one holds it only when its own morphs changed.
        belted = {'outfit': ['Top', 'Belt']}
        rows = {'Top': ('morph-only', self.CHANGED, None), 'Belt': ('morph-only', {}, None)}
        meta = self.build(belted, rows, {'Top': self.SHAPED, 'Belt': self.SHAPED}, package={'Top': True, 'Belt': False})
        self.assertEqual(set(meta['swapped']), {path('Top')})
        rows['Belt'] = ('morph-only', self.CHANGED, None)
        meta = self.build(belted, rows, {'Top': self.SHAPED, 'Belt': self.SHAPED}, package={'Top': True, 'Belt': False})
        self.assertEqual(meta['swapped'], {})
        self.assertEqual(meta['held'][path('Top')]['items'], ['outfit'])
        meta = self.build(items, proof, morphs, package={'Top': True, 'Skirt': True, 'Tee': True})
        self.assertEqual(set(meta['swapped']), {path('Top'), path('Skirt'), path('Tee')})

    # The mixed-item exception through main (26 Nov 2026): the tee must really be held live, not merely unproven.
    TEE, NECK = 'SK_Streetwear_CroppedTshirtOversize_M', 'SK_Streetwear_ChainNecklace_M'
    TEE_ITEM = 'streetwear-croppedtshirtoversize-cotton-red'

    def test_a_kept_tee_is_refused_by_the_mixed_item_exception(self):
        # A kept mesh already counts as Season 12 (the item rule treats it as effective), so excusing it would let the
        # exception through for an item that is not mixed. Both routes to "kept": a refusal without moved vertices or
        # changed morphs, and a stale package whose morphs equal the read's.
        items = {self.TEE_ITEM: [self.TEE, self.NECK], 'necklace': [self.NECK]}
        morphs = {self.TEE: self.SHAPED, self.NECK: self.SHAPED}
        neck = ('morph-only', self.CHANGED, None)
        for tee, package in ((('refused', {}, ['WEIGHTS_0 differs']), None),
                             (('morph-only', {}, None), {self.TEE: False, self.NECK: True})):
            with self.subTest(tee=tee), self.assertRaisesRegex(SystemExit, 'must be held live'):
                self.build(items, {self.TEE: tee, self.NECK: neck}, morphs, package=package,
                           allow_mixed=[self.TEE_ITEM])

    def test_a_held_live_tee_still_goes_mixed_through_main(self):
        items = {self.TEE_ITEM: [self.TEE, self.NECK], 'necklace': [self.NECK]}
        morphs = {self.TEE: self.SHAPED, self.NECK: self.SHAPED}
        proof = {self.TEE: ('refused', {}, ['POSITION differs']), self.NECK: ('morph-only', self.CHANGED, None)}
        self.assertIn(path(self.NECK), self.build(items, proof, morphs)['held'])   # without the exception
        meta = self.build(items, proof, morphs, allow_mixed=[self.TEE_ITEM])
        self.assertEqual(set(meta['swapped']), {path(self.NECK)})
        self.assertNotIn(path(self.TEE), meta['effective'])
        self.assertEqual(list(meta['mixedItemExceptions']), [self.TEE_ITEM])

    # Holds (tier 2, 27 Nov 2026): a hold wins over every proof and list, and a list that names a held mesh stops the
    # build. After C1 went live nothing held the cropped tee's item any more, and the batch B review list re-admitted it.
    HOLD_ITEMS = {'tee-item': ['Tee', 'Neck'], 'neck': ['Neck']}
    HOLD_PROOF = {'Tee': ('refused', {'medium_female': {'maxCm': 1.0, 'verticesChanged': 4}}, ['WEIGHTS_0 differs']),
                  'Neck': ('morph-only', {'medium_female': {'maxCm': 3.0, 'verticesChanged': 10}}, None)}

    def hold_morphs(self):
        return {'Tee': self.SHAPED, 'Neck': self.SHAPED}

    def test_a_held_mesh_on_an_admission_list_stops_the_build(self):
        admit = {'Tee': ('weights', False)}
        # Without the hold the review list repoints the tee, since nothing in its item holds it.
        meta = self.build(self.HOLD_ITEMS, self.HOLD_PROOF, self.hold_morphs(), admit=admit, admit_reviewed=['Tee'])
        self.assertIn(path('Tee'), meta['swapped'])
        for flag in ('admit_reviewed', 'admit_only', 'admit_rework'):
            with self.subTest(flag=flag), self.assertRaisesRegex(SystemExit, 'Held meshes are named for Season 12'):
                self.build(self.HOLD_ITEMS, self.HOLD_PROOF, self.hold_morphs(), admit=admit,
                           holds={'Tee': 'held: a review found a wedge'}, **{flag: ['Tee']})

    def test_a_held_mesh_on_the_ship_list_stops_the_build(self):
        with self.assertRaisesRegex(SystemExit, 'Held meshes are named for Season 12.*--ship-s12-masks Tee'):
            self.build(self.HOLD_ITEMS, self.HOLD_PROOF, self.hold_morphs(), holds={'Tee': 'held'},
                       ship_masks={'Tee': '../cov/Tee.bodymask.png'})

    def test_a_hold_on_a_mesh_the_index_lacks_stops_the_build(self):
        with self.assertRaisesRegex(SystemExit, 'does not hold'):
            self.build(self.HOLD_ITEMS, self.HOLD_PROOF, self.hold_morphs(), holds={'Nope': 'held'})

    def test_a_held_mesh_stays_live_whatever_proves_it(self):
        items = {'outfit': ['Top', 'Skirt'], 'skirt': ['Skirt']}
        proof = {'Top': ('morph-only', self.CHANGED, None), 'Skirt': ('morph-only', self.CHANGED, None)}
        morphs = {'Top': self.SHAPED, 'Skirt': self.SHAPED}
        self.assertEqual(set(self.build(items, proof, morphs)['swapped']), {path('Top'), path('Skirt')})
        # Held by name with changed morphs: the live Top is pre-S12, so the outfit holds the skirt too.
        meta = self.build(items, proof, morphs, holds={'Top': 'held: defective weights'})
        self.assertEqual(meta['swapped'], {})
        self.assertEqual(meta['holds'], {'Top': {'source': path('Top'), 'reason': 'held: defective weights'}})
        self.assertEqual(meta['held'][path('Skirt')]['items'], ['outfit'])
        # With unchanged morphs the live file already has the S12 shape: it stays live and holds nothing.
        meta = self.build(items, {**proof, 'Top': ('morph-only', {}, None)}, morphs, holds={'Top': 'held'})
        self.assertEqual(set(meta['swapped']), {path('Skirt')})
        self.assertIn(path('Top'), meta['keptUnchanged'])
        # Admitted without being named (a re-encoded mesh the skin proof admits by default): the hold still wins.
        refused = {**proof, 'Top': ('refused', self.CHANGED, ['JOINTS_0 differs'])}
        self.assertIn(path('Top'), self.build(items, refused, morphs, admit={'Top': ('re-encoded', True)})['swapped'])
        meta = self.build(items, refused, morphs, admit={'Top': ('re-encoded', True)}, holds={'Top': 'held'})
        self.assertEqual(meta['swapped'], {})
        self.assertNotIn(path('Top'), meta['admitted'])

    def test_a_held_tee_still_goes_mixed_by_its_exception(self):
        items = {self.TEE_ITEM: [self.TEE, self.NECK], 'necklace': [self.NECK]}
        morphs = {self.TEE: self.SHAPED, self.NECK: self.SHAPED}
        proof = {self.TEE: ('refused', self.CHANGED, ['WEIGHTS_0 differs']), self.NECK: ('morph-only', self.CHANGED, None)}
        meta = self.build(items, proof, morphs, holds={self.TEE: 'held: wedge'}, allow_mixed=[self.TEE_ITEM])
        self.assertEqual(set(meta['swapped']), {path(self.NECK)})
        self.assertEqual(list(meta['mixedItemExceptions']), [self.TEE_ITEM])

    def test_a_census_from_another_index_is_refused(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        (tmp / 'census.json').write_text(json.dumps({path('A'): {'url': '../x/A.glb', 'morphs': self.SHAPED}}))
        with self.assertRaises(SystemExit):
            tool.body_type_meshes(tmp / 'census.json', {path('A'): {'url': '../y/A.glb'}})


class MixedItemException(unittest.TestCase):
    """Option (c), tier 2 C1 (26 Nov 2026): exactly one item may go mixed because exactly one of its meshes is held."""
    TEE, NECK = 'SK_Streetwear_CroppedTshirtOversize_M', 'SK_Streetwear_ChainNecklace_M'
    ITEM = 'streetwear-croppedtshirtoversize-cotton-red'

    def setUp(self):
        self.by_name = {n: path(n) for n in (self.TEE, self.NECK, 'SK_Dress_M')}
        tee_item = {path(self.TEE), path(self.NECK)}
        dress_item = {path('SK_Dress_M'), path(self.NECK)}
        self.users = {}
        for item, meshes in ((self.ITEM, tee_item), ('dress', dress_item), ('necklace', {path(self.NECK)})):
            for m in meshes:
                self.users.setdefault(m, []).append((item, meshes))

    def test_the_approved_list_is_one_item_and_one_mesh(self):
        self.assertEqual({i: e['mesh'] for i, e in tool.MIXED_ITEM_EXCEPTIONS.items()}, {self.ITEM: self.TEE})

    def test_any_other_item_is_refused(self):
        with self.assertRaisesRegex(SystemExit, 'not an approved exception'):
            tool.mixed_item_excuses(['dress'], self.by_name, {path('SK_Dress_M')}, self.users)

    def test_the_tee_must_be_held_live(self):
        with self.assertRaisesRegex(SystemExit, 'must be held live'):
            tool.mixed_item_excuses([self.ITEM], self.by_name, set(), self.users)

    def test_an_index_without_the_mesh_is_refused(self):
        with self.assertRaisesRegex(SystemExit, 'does not hold'):
            tool.mixed_item_excuses([self.ITEM], {}, set(), self.users)

    def test_the_held_tee_no_longer_holds_its_items_other_meshes(self):
        excused = tool.mixed_item_excuses([self.ITEM], self.by_name, {path(self.TEE)}, self.users)
        self.assertEqual(excused, {(self.ITEM, path(self.TEE))})
        proven = {path(self.NECK), path('SK_Dress_M')}
        # Without the exception the live tee holds the necklace (morphs changed), which then holds the dress.
        effective, held = tool.settle(proven, set(), set(), self.users, BODY)
        self.assertEqual(effective, set())
        # With it the necklace and dress move; the tee stays live, so the tee's item stays mixed (never Season 12).
        effective, held = tool.settle(proven, set(), set(), self.users, BODY, excused)
        self.assertEqual(effective, proven)
        self.assertNotIn(path(self.TEE), effective)


class ParseArgs(unittest.TestCase):
    def test_holds_repeat_and_keep_their_reason_whole(self):
        positional, keywords = tool.parse_args(
            ['a', 'b', 'c', 'd', '--hold', "SK_A_M=held: the game's own weights, see x=y", '--admit-reviewed', 'X,Y',
             '--hold', 'SK_B_M=why', '--changed-only'])
        self.assertEqual(positional, ['a', 'b', 'c', 'd'])
        self.assertEqual(keywords['holds'], {'SK_A_M': "held: the game's own weights, see x=y", 'SK_B_M': 'why'})
        self.assertEqual(keywords['admit_reviewed'], ['X', 'Y'])
        self.assertTrue(keywords['changed_only'])
        self.assertNotIn('holds', tool.parse_args(['a', 'b', 'c', 'd'])[1])

    def test_a_hold_without_a_reason_or_named_twice_is_refused(self):
        for argv in (['--hold', 'SK_A_M'], ['--hold', 'SK_A_M= '], ['--hold'],
                     ['--hold', 'SK_A_M=x', '--hold', 'SK_A_M=y']):
            with self.subTest(argv=argv), self.assertRaises(SystemExit):
                tool.parse_args(['a', 'b', 'c', 'd', *argv])


if __name__ == '__main__':
    unittest.main()
