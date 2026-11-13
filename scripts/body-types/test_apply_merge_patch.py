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


class ApplyPatch(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
