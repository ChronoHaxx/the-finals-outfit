"""skin-by-name-proof.py must admit only swaps the rig renders identically (apart from morph deltas), and must name the
reason for everything else. Synthetic GLBs, no game data. (Run: python -I scripts/body-types/test_skin_by_name_proof.py)

The risk is a false "re-encoded": an admitted mesh is swapped with no review, so a weight, normal or extension-bind
change it hides reaches production unseen.
"""
import importlib.util
import json
import shutil
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('skin_by_name_proof', HERE / 'skin-by-name-proof.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

# Driver: root > pelvis > spine; spine > arm. Garment-only bones hang under spine.
DRIVER = ['root', 'pelvis', 'spine', 'arm']
PARENT = {'pelvis': 'root', 'spine': 'pelvis', 'arm': 'spine', 'strap': 'spine', 'tassel': 'strap', 'orphan': None}
POS = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], np.float32)
NRM = np.array([[0, 0, 1]] * 4, np.float32)
TAN = np.array([[1, 0, 0, 1]] * 4, np.float32)
UV = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], np.float32)
IDX = np.array([0, 1, 2, 2, 1, 3], np.uint16)
# Per-vertex skinning by NAME: vertex -> [(bone, weight 0..255)]
SKIN = [[('spine', 255)], [('spine', 128), ('arm', 127)], [('strap', 255)], [('arm', 255)]]


def write_glb(path, joints, skin=SKIN, pos=POS, nrm=NRM, tan=TAN, morphs=None, ibm=None, extra_sets=False):
    """A one-mesh skinned GLB. joints: the skin's joint names in order (nodes are created for them and their parents)."""
    morphs = morphs if morphs is not None else {'medium_male': np.full((4, 3), 0.01, np.float32)}
    names = list(dict.fromkeys(joints + [p for j in joints for p in [PARENT.get(j)] if p]))
    nodes = [{'name': n} for n in names]
    for i, n in enumerate(names):
        kids = [k for k, m in enumerate(names) if PARENT.get(m) == n]
        if kids:
            nodes[i]['children'] = kids
    blobs, views, accessors = [], [], []

    def add(array, ctype, kind, normalized=False):
        data = np.ascontiguousarray(array).tobytes()
        offset = sum(len(b) for b in blobs)
        blobs.append(data + b'\0' * (-len(data) % 4))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
        acc = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(array), 'type': kind}
        if normalized:
            acc['normalized'] = True
        if ctype == 5126 and kind == 'VEC3':
            acc['min'], acc['max'] = array.min(0).tolist(), array.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    index = {n: i for i, n in enumerate(joints)}
    J = np.zeros((4, 4), np.uint8)
    W = np.zeros((4, 4), np.uint8)
    for v, influences in enumerate(skin):
        for k, (bone, w) in enumerate(influences):
            J[v, k], W[v, k] = index[bone], w
    attrs = {'POSITION': add(pos, 5126, 'VEC3'), 'NORMAL': add(nrm, 5126, 'VEC3'), 'TANGENT': add(tan, 5126, 'VEC4'),
             'TEXCOORD_0': add(UV, 5126, 'VEC2'), 'JOINTS_0': add(J, 5121, 'VEC4'),
             'WEIGHTS_0': add(W, 5121, 'VEC4', normalized=True)}
    if extra_sets:
        attrs['JOINTS_1'] = add(np.zeros((4, 4), np.uint8), 5121, 'VEC4')
        attrs['WEIGHTS_1'] = add(np.zeros((4, 4), np.uint8), 5121, 'VEC4', normalized=True)
    targets = [{'POSITION': add(d, 5126, 'VEC3')} for d in morphs.values()]
    ibm = ibm or {}
    mats = np.stack([np.asarray(ibm.get(n, np.eye(4)), np.float32).T.reshape(16) for n in joints])
    skin_ibm = add(mats, 5126, 'MAT4')
    nodes.append({'name': 'mesh', 'mesh': 0, 'skin': 0})
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0, len(nodes) - 1]}], 'nodes': nodes,
           'meshes': [{'primitives': [{'attributes': attrs, 'indices': add(IDX, 5123, 'SCALAR'), 'material': 0,
                                       'targets': targets}], 'extras': {'targetNames': list(morphs)}}],
           'materials': [{'name': 'MI_Test'}],
           'skins': [{'joints': [names.index(j) for j in joints], 'inverseBindMatrices': skin_ibm}],
           'accessors': accessors, 'bufferViews': views}
    binary = b''.join(blobs)
    doc['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(doc).encode()
    js += b' ' * (-len(js) % 4)
    Path(path).write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binary))
                           + struct.pack('<II', len(js), 0x4E4F534A) + js
                           + struct.pack('<II', len(binary), 0x004E4942) + binary)


LIVE_JOINTS = ['root', 'pelvis', 'spine', 'arm', 'strap']


class SkinByName(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        write_glb(self.tmp / 'live.glb', LIVE_JOINTS)

    def judge(self, **kwargs):
        joints = kwargs.pop('joints', LIVE_JOINTS)
        write_glb(self.tmp / 'new.glb', joints, **kwargs)
        return tool.compare(self.tmp / 'live.glb', self.tmp / 'new.glb', set(DRIVER))

    def test_reordered_and_extended_joint_list_is_re_encoded(self):
        # S12's usual change: the same bones and weights under a re-ordered, longer joint list (calf_l/calf_r added).
        r = self.judge(joints=['strap', 'arm', 'root', 'spine', 'pelvis', 'tassel'],
                       morphs={'medium_male': np.full((4, 3), 0.02, np.float32)})
        self.assertEqual(r['class'], 're-encoded', r)
        self.assertEqual(r['morphsChanged']['medium_male']['verticesChanged'], 4)

    def test_moved_weight_is_refused(self):
        moved = [SKIN[0], [('spine', 64), ('arm', 191)], SKIN[2], SKIN[3]]
        self.assertEqual(self.judge(skin=moved)['class'], 'weights')

    def test_two_rounding_steps_pass(self):
        rounded = [SKIN[0], [('spine', 127), ('arm', 128)], SKIN[2], SKIN[3]]
        self.assertEqual(self.judge(skin=rounded)['class'], 're-encoded')

    def test_changed_weight_sum_is_refused(self):
        # 8-influence meshes render unnormalised (SourceMesh.ts), so a sum off by one step moves the vertex.
        short = [SKIN[0], [('spine', 128), ('arm', 126)], SKIN[2], SKIN[3]]
        self.assertEqual(self.judge(skin=short)['class'], 'weights')

    def test_flipped_normal_and_tangent_sign_are_refused(self):
        flipped = NRM.copy()
        flipped[1] = [0, 0, -1]
        self.assertEqual(self.judge(nrm=flipped)['class'], 'normals')
        mirrored = TAN.copy()
        mirrored[2, 3] = -1
        self.assertEqual(self.judge(tan=mirrored)['class'], 'normals')

    def test_moved_extension_bind_is_refused_but_a_driver_bind_is_not(self):
        shifted = np.eye(4)
        shifted[0, 3] = 0.05
        self.assertEqual(self.judge(ibm={'strap': shifted})['class'], 'extension bones')
        # The rig replaces a driver bone's inverse bind with the driver's own (rebindSourceSkeleton).
        self.assertEqual(self.judge(ibm={'spine': shifted})['class'], 're-encoded')

    def test_unresolvable_joint_is_a_loader_refusal(self):
        r = self.judge(joints=LIVE_JOINTS + ['orphan'])
        self.assertEqual(r['class'], 'loader refuses')
        self.assertIn('orphan', ' '.join(r['loader']))

    def test_changed_influence_layout_is_a_loader_refusal(self):
        self.assertEqual(self.judge(extra_sets=True)['class'], 'loader refuses')

    def test_morph_set_change_reports_removed_shape(self):
        r = self.judge(morphs={'shrink_under_vest': np.full((4, 3), 0.003, np.float32)})
        self.assertEqual(r['class'], 'morph set')
        self.assertEqual(r['morphsAdded'], ['shrink_under_vest'])
        self.assertEqual(r['morphsRemovedMaxCm'], {'medium_male': round(float(np.linalg.norm([0.01] * 3)) * 100, 3)})

    def test_moved_position_is_not_tier_one(self):
        moved = POS.copy()
        moved[3, 2] = 0.01
        self.assertEqual(self.judge(pos=moved)['class'], 'surface differs')

    def test_main_refuses_existing_output_and_marks_admissible(self):
        assets = self.tmp / 'index' / 'assets.json'
        assets.parent.mkdir()
        assets.write_text('{}', encoding='utf-8')
        shutil.copy(self.tmp / 'live.glb', self.tmp / 'SK_A.live.glb')
        rebuilt = self.tmp / 'rebuilt'
        rebuilt.mkdir()
        write_glb(rebuilt / 'SK_A.glb', ['arm', 'spine', 'root', 'pelvis', 'strap'])
        write_glb(self.tmp / 'driver.glb', DRIVER, skin=[[('spine', 255)]] * 4)
        proof = self.tmp / 'proof.json'
        proof.write_text(json.dumps({'SK_A': {'source': '/Game/SK_A.SK_A', 'liveUrl': '../SK_A.live.glb', 'status': 'refused'},
                                     'SK_B': {'source': '/Game/SK_B.SK_B', 'liveUrl': '../x.glb', 'status': 'morph-only'}}))
        out = self.tmp / 'out.json'
        tool.main(str(assets), str(proof), str(rebuilt), str(self.tmp / 'driver.glb'), str(out))
        rows = json.loads(out.read_text(encoding='utf-8'))['meshes']
        self.assertEqual(list(rows), ['SK_A'])
        self.assertTrue(rows['SK_A']['admissible'])
        with self.assertRaises(SystemExit):
            tool.main(str(assets), str(proof), str(rebuilt), str(self.tmp / 'driver.glb'), str(out))


if __name__ == '__main__':
    unittest.main()
