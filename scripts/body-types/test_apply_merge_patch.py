"""apply-merge-patch.py writes the merge into the live index, so its guards are what stand between a stale or wrong patch
and the live catalogue. These checks drive it on a synthetic index: no game data, GLB or server is needed.
(Run: python -I scripts/body-types/test_apply_merge_patch.py)
"""
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('apply_merge_patch', HERE / 'apply-merge-patch.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

BODY = '/Game/Body/SK_Body_M.SK_Body_M'
TEE = '/Game/Items/SK_Tee_M.SK_Tee_M'
HAT = '/Game/Items/SK_Hat_M.SK_Hat_M'
LIVE_BODY = '../reconstructed-meshes-v2/SK_Body_M.glb'


class Fixture(unittest.TestCase):
    """A synthetic active index (body, T-shirt, hat) and a patch repointing the T-shirt."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.active = self.tmp / 'active'
        self.active.mkdir()
        assets = {'formatVersion': 1, 'bodyType': 'masculine',
                  'meshes': {BODY: {'url': LIVE_BODY, 'sha256': 'b0', 'kind': 'skeletal'},
                             TEE: {'url': '../live/SK_Tee_M.glb', 'sha256': 't0', 'slots': [{'slot': 'Tee'}]},
                             HAT: {'url': '../live/SK_Hat_M.glb', 'sha256': 'h0'}},
                  'attachmentBody': {'source': BODY, 'url': LIVE_BODY, 'sha256': 'b0', 'restBones': {'root': [1]}},
                  'unknownField': {'kept': True}}
        pairs = {'items': {'face-01': {'head': {'url': '../h.glb'}, 'body': {'url': LIVE_BODY, 'materials': {}}}}}
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        (self.active / 'skin-pairs.json').write_bytes(tool.dump(pairs))
        self.patch = {
            'activeIndexSha256': tool.sha(self.active / 'assets.json'),
            'activeSkinPairsSha256': tool.sha(self.active / 'skin-pairs.json'),
            'body': {'source': BODY, 'url': LIVE_BODY, 'fromSha256': 'b0', 'toSha256': 'b1'},
            'meshes': {BODY: {'fromUrl': LIVE_BODY, 'toUrl': LIVE_BODY, 'fromSha256': 'b0', 'toSha256': 'b1'},
                       TEE: {'fromUrl': '../live/SK_Tee_M.glb', 'toUrl': '../s12/SK_Tee_M.glb',
                             'fromSha256': 't0', 'toSha256': 't1'}}}

    def run_tool(self, *flags, out='out'):
        patch = self.tmp / 'patch.json'
        patch.write_text(json.dumps(self.patch), encoding='utf-8')
        tool.main([str(patch), str(self.active), str(self.tmp / out), *flags])
        load = lambda name: json.loads((self.tmp / out / name).read_bytes())
        return load('assets.json'), load('skin-pairs.json')


class ApplyPatch(Fixture):
    def test_garments_only_leaves_the_body_and_pairs_untouched(self):
        assets, _ = self.run_tool('--garments-only')
        self.assertEqual(assets['meshes'][TEE]['url'], '../s12/SK_Tee_M.glb')
        self.assertEqual(assets['meshes'][TEE]['sha256'], 't1')
        self.assertEqual(assets['meshes'][TEE]['slots'], [{'slot': 'Tee'}])
        self.assertEqual(assets['meshes'][BODY], {'url': LIVE_BODY, 'sha256': 'b0', 'kind': 'skeletal'})
        self.assertEqual(assets['attachmentBody']['sha256'], 'b0')
        self.assertEqual(assets['unknownField'], {'kept': True})
        self.assertEqual((self.tmp / 'out' / 'skin-pairs.json').read_bytes(),
                         (self.active / 'skin-pairs.json').read_bytes())

    def test_body_url_moves_the_body_everywhere(self):
        assets, pairs = self.run_tool('--body-url', '../s12/SK_Body_M.glb')
        self.assertEqual(assets['meshes'][BODY]['url'], '../s12/SK_Body_M.glb')
        self.assertEqual(assets['meshes'][BODY]['sha256'], 'b1')
        self.assertEqual(assets['attachmentBody']['url'], '../s12/SK_Body_M.glb')
        self.assertEqual(assets['attachmentBody']['restBones'], {'root': [1]})
        self.assertEqual(pairs['items']['face-01']['body']['url'], '../s12/SK_Body_M.glb')

    def test_a_body_mask_repoint_needs_the_new_file_in_place(self):
        # Tier 2 (23 Nov 2026): the S12 body mask ships with its mesh; the patch pins the file's sha256.
        assets = json.loads((self.active / 'assets.json').read_bytes())
        assets['meshes'][TEE]['bodyMaskUrl'] = '../live/SK_Tee_M.bodymask.png'
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        new = self.tmp / 's12' / 'SK_Tee_M.bodymask.png'
        self.patch['meshes'][TEE]['bodyMask'] = {'fromUrl': '../live/SK_Tee_M.bodymask.png',
                                                 'toUrl': '../s12/SK_Tee_M.bodymask.png',
                                                 'toSha256': hashlib.sha256(b'mask').hexdigest()}
        with self.assertRaises(SystemExit):        # not copied yet
            self.run_tool('--garments-only', out='out-missing')
        new.parent.mkdir()
        new.write_bytes(b'other')
        with self.assertRaises(SystemExit):        # another file
            self.run_tool('--garments-only', out='out-other')
        new.write_bytes(b'mask')
        out, _ = self.run_tool('--garments-only')
        self.assertEqual(out['meshes'][TEE]['bodyMaskUrl'], '../s12/SK_Tee_M.bodymask.png')
        self.assertEqual(out['meshes'][TEE]['url'], '../s12/SK_Tee_M.glb')
        self.patch['meshes'][TEE]['bodyMask']['fromUrl'] = '../elsewhere.png'
        with self.assertRaises(SystemExit):        # the entry names another mask now
            self.run_tool('--garments-only', out='out-moved')

    def test_a_mask_only_repoint_keeps_the_mesh(self):
        # The mesh is already its S12 file (an earlier batch); only the body mask moves.
        assets = json.loads((self.active / 'assets.json').read_bytes())
        assets['meshes'][HAT]['bodyMaskUrl'] = '../live/SK_Hat_M.bodymask.png'
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        (self.tmp / 's12').mkdir()
        (self.tmp / 's12' / 'SK_Hat_M.bodymask.png').write_bytes(b'hat')
        self.patch['bodyMasks'] = {HAT: {'fromUrl': '../live/SK_Hat_M.bodymask.png', 'toUrl': '../s12/SK_Hat_M.bodymask.png',
                                         'toSha256': hashlib.sha256(b'hat').hexdigest(), 'meshSha256': 'h0'}}
        out, _ = self.run_tool('--garments-only')
        self.assertEqual(out['meshes'][HAT], {'url': '../live/SK_Hat_M.glb', 'sha256': 'h0',
                                              'bodyMaskUrl': '../s12/SK_Hat_M.bodymask.png'})
        self.patch['bodyMasks'][HAT]['meshSha256'] = 'h-other'
        with self.assertRaises(SystemExit):        # the mesh is not the file the mask was made from
            self.run_tool('--garments-only', out='out-other-mesh')

    def test_a_material_repoint_needs_the_old_entry_and_the_new_file(self):
        # Batch C (25 Nov 2026): the T-shirt's 17 Nov material replaces the live one, by material instance.
        mi = '/Game/Items/MI_Tee_Black.MI_Tee_Black'
        assets = json.loads((self.active / 'assets.json').read_bytes())
        assets['materials'] = {mi: '../live/tee-black.json', '/Game/Items/MI_Hat.MI_Hat': '../live/hat.json'}
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        self.patch['materials'] = {mi: {'fromUrl': '../live/tee-black.json', 'toUrl': '../c0/tee-black.json',
                                        'toSha256': hashlib.sha256(b'{}').hexdigest()}}
        with self.assertRaises(SystemExit):        # the new file is not in place yet
            self.run_tool('--garments-only', out='out-missing')
        (self.tmp / 'c0').mkdir()
        (self.tmp / 'c0' / 'tee-black.json').write_bytes(b'{}')
        out, _ = self.run_tool('--garments-only')
        self.assertEqual(out['materials'], {mi: '../c0/tee-black.json', '/Game/Items/MI_Hat.MI_Hat': '../live/hat.json'})
        self.patch['materials'][mi]['fromUrl'] = '../live/other.json'
        with self.assertRaises(SystemExit):        # the entry names another file now
            self.run_tool('--garments-only', out='out-moved')

    def test_a_material_with_variants_is_refused(self):
        mi = '/Game/Items/MI_Tee_Black.MI_Tee_Black'
        assets = json.loads((self.active / 'assets.json').read_bytes())
        assets['materials'] = {mi: '../live/tee-black.json'}
        assets['materialVariants'] = {json.dumps([mi, '/Game/Items/MI_Donor.MI_Donor']): '../live/tee-variant.json'}
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        (self.tmp / 'c0').mkdir()
        (self.tmp / 'c0' / 'tee-black.json').write_bytes(b'{}')
        self.patch['materials'] = {mi: {'fromUrl': '../live/tee-black.json', 'toUrl': '../c0/tee-black.json',
                                        'toSha256': hashlib.sha256(b'{}').hexdigest()}}
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only')
        self.assertFalse((self.tmp / 'out').exists())

    def test_a_compact_index_is_written_back_compact(self):
        # 23 Nov 2026: the Light apply writes the index as one line of compact JSON; keep it that way.
        assets = json.loads((self.active / 'assets.json').read_bytes())
        (self.active / 'assets.json').write_bytes(tool.dump(assets, 'compact'))
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        out, _ = self.run_tool('--garments-only')
        raw = (self.tmp / 'out' / 'assets.json').read_bytes()
        self.assertEqual(raw, tool.dump(out, 'compact'))
        self.assertEqual(out['meshes'][TEE]['url'], '../s12/SK_Tee_M.glb')
        (self.active / 'assets.json').write_bytes(json.dumps(assets, indent=4).encode())   # an unknown format
        self.patch['activeIndexSha256'] = tool.sha(self.active / 'assets.json')
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only', out='out-unknown')

    def test_refuses_the_preserved_body_url(self):
        with self.assertRaises(SystemExit):
            self.run_tool('--body-url', LIVE_BODY)

    def test_refuses_a_moved_index(self):
        self.patch['activeIndexSha256'] = hashlib.sha256(b'other').hexdigest()
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only')
        self.assertFalse((self.tmp / 'out').exists())

    def test_refuses_an_entry_that_moved(self):
        self.patch['meshes'][TEE]['fromSha256'] = 'something-else'
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only')
        self.assertFalse((self.tmp / 'out').exists())

    def test_refuses_an_existing_output(self):
        (self.tmp / 'out').mkdir()
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only')

    def test_needs_exactly_one_mode(self):
        with self.assertRaises(SystemExit):
            self.run_tool()
        with self.assertRaises(SystemExit):
            self.run_tool('--garments-only', '--body-url', '../s12/SK_Body_M.glb', out='out2')

    def test_output_differs_only_in_repointed_lines(self):
        self.run_tool('--garments-only')
        before = (self.active / 'assets.json').read_bytes().split(b'\r\n')
        after = (self.tmp / 'out' / 'assets.json').read_bytes().split(b'\r\n')
        self.assertEqual(len(before), len(after))
        changed = [a for a, b in zip(after, before) if a != b]
        self.assertEqual(len(changed), 2)
        self.assertTrue(all(b'SK_Tee_M' in line or b't1' in line for line in changed))


maker_spec = importlib.util.spec_from_file_location('make_refresh_patch', HERE / 'make-refresh-patch.py')
maker = importlib.util.module_from_spec(maker_spec)
maker_spec.loader.exec_module(maker)


class RefreshPatch(Fixture):
    """make-refresh-patch.py reads every "from" and sha256 itself; its patch must apply cleanly and only to that index."""

    def setUp(self):
        super().setUp()
        self.mi = '/Game/Items/MI_Tee_Black.MI_Tee_Black'
        assets = json.loads((self.active / 'assets.json').read_bytes())
        assets['meshes'][TEE]['bodyMaskUrl'] = '../live/SK_Tee_M.bodymask.png'
        assets['materials'] = {self.mi: '../live/tee-black.json'}
        (self.active / 'assets.json').write_bytes(tool.dump(assets))
        (self.tmp / 'c0').mkdir()
        for name, data in (('SK_Tee_M.glb', b'glb'), ('SK_Tee_M.bodymask.png', b'mask'), ('tee-black.json', b'{}')):
            (self.tmp / 'c0' / name).write_bytes(data)
        self.spec = {'note': 'C0.', 'meshes': {TEE: {'toUrl': '../c0/SK_Tee_M.glb',
                                                     'bodyMask': {'toUrl': '../c0/SK_Tee_M.bodymask.png'}}},
                     'materials': {self.mi: {'toUrl': '../c0/tee-black.json'}}}

    def make(self, out='refresh.json'):
        (self.tmp / 'spec.json').write_text(json.dumps(self.spec), encoding='utf-8')
        maker.main(str(self.active), str(self.tmp / 'spec.json'), str(self.tmp / out))
        return json.loads((self.tmp / out).read_text(encoding='utf-8'))

    def test_the_patch_applies_mesh_mask_and_material(self):
        self.patch = self.make()
        self.assertEqual(self.patch['meshes'][TEE]['fromSha256'], 't0')
        self.assertEqual(self.patch['meshes'][TEE]['toSha256'], hashlib.sha256(b'glb').hexdigest())
        out, _ = self.run_tool('--garments-only')
        self.assertEqual(out['meshes'][TEE]['url'], '../c0/SK_Tee_M.glb')
        self.assertEqual(out['meshes'][TEE]['bodyMaskUrl'], '../c0/SK_Tee_M.bodymask.png')
        self.assertEqual(out['materials'][self.mi], '../c0/tee-black.json')
        self.assertEqual(out['meshes'][BODY], {'url': LIVE_BODY, 'sha256': 'b0', 'kind': 'skeletal'})
        self.assertEqual((self.tmp / 'out' / 'skin-pairs.json').read_bytes(),
                         (self.active / 'skin-pairs.json').read_bytes())

    def test_refuses_the_body_a_missing_file_and_a_new_material(self):
        self.spec['meshes'] = {BODY: {'toUrl': '../c0/SK_Tee_M.glb'}}
        with self.assertRaises(SystemExit):
            self.make('r1.json')
        self.spec['meshes'] = {TEE: {'toUrl': '../c0/missing.glb'}}
        with self.assertRaises(SystemExit):
            self.make('r2.json')
        self.spec['meshes'], self.spec['materials'] = {}, {'/Game/Items/MI_New.MI_New': {'toUrl': '../c0/tee-black.json'}}
        with self.assertRaises(SystemExit):
            self.make('r3.json')


if __name__ == '__main__':
    unittest.main()
