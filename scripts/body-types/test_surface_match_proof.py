"""surface-match-proof.py must call a mesh "permuted" only when Season 12 merely re-ordered the same triangles, and must
tell a texture-preserving rework from a re-unwrap. Synthetic GLBs, no game data.
(Run: python -I scripts/body-types/test_surface_match_proof.py)

The risks: a false "permuted" swaps a changed surface with no review, so stale body masks or a wrong texture mapping
reach production; a false "same UVs" ships a garment whose live textures land on the wrong islands.
"""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('surface_match_proof', HERE / 'surface-match-proof.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

JOINTS = ['root', 'pelvis', 'spine']
PARENT = {'pelvis': 'root', 'spine': 'pelvis'}


def grid(n=6, size=0.3):
    """An n x n vertex grid in the XY plane (normals +Z), UVs in [0,1], two triangles per cell."""
    xs, ys = np.meshgrid(np.linspace(0, size, n), np.linspace(0, size, n))
    pos = np.stack([xs.ravel(), ys.ravel(), np.zeros(n * n)], 1).astype(np.float32)
    uv = np.stack([xs.ravel() / size, ys.ravel() / size], 1).astype(np.float32)
    idx = []
    for r in range(n - 1):
        for c in range(n - 1):
            a, b, d, e = r * n + c, r * n + c + 1, (r + 1) * n + c, (r + 1) * n + c + 1
            idx += [a, b, d, d, b, e]
    return pos, uv, np.array(idx, np.uint32)


def write_glb(path, pos, uv, idx, weights=None, morph=None, nrm=None, slots=None, uv1=None):
    """slots: [(slot name, triangle count)] splits the triangles into primitives over one vertex pool, one material each
    (all named MI_Test, as S12's cloth sections that reuse the garment's MI). Default: one slot "Test"."""
    n = len(pos)
    nrm = nrm if nrm is not None else np.tile(np.array([[0, 0, 1]], np.float32), (n, 1))
    tan = np.tile(np.array([[1, 0, 0, 1]], np.float32), (n, 1))
    weights = weights if weights is not None else np.tile(np.array([[0, 0, 255, 0]], np.uint8), (n, 1))
    J = np.tile(np.array([[0, 1, 2, 0]], np.uint8), (n, 1))
    morph = morph if morph is not None else (pos * 0.01).astype(np.float32)
    blobs, views, accessors = [], [], []

    def add(array, ctype, kind, normalized=False):
        array = np.ascontiguousarray(array)
        data = array.tobytes()
        offset = sum(len(b) for b in blobs)
        blobs.append(data + b'\0' * (-len(data) % 4))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
        acc = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(array), 'type': kind}
        if normalized:
            acc['normalized'] = True
        accessors.append(acc)
        return len(accessors) - 1
    attrs = {'POSITION': add(pos, 5126, 'VEC3'), 'NORMAL': add(nrm, 5126, 'VEC3'), 'TANGENT': add(tan, 5126, 'VEC4'),
             'TEXCOORD_0': add(uv, 5126, 'VEC2'), 'JOINTS_0': add(J, 5121, 'VEC4'),
             'WEIGHTS_0': add(weights, 5121, 'VEC4', normalized=True)}
    if uv1 is not None:
        attrs['TEXCOORD_1'] = add(uv1, 5126, 'VEC2')
    nodes =[{'name': 'root', 'children': [1]}, {'name': 'pelvis', 'children': [2]}, {'name': 'spine'},
             {'name': 'mesh', 'mesh': 0, 'skin': 0}]
    ibm = add(np.tile(np.eye(4, dtype=np.float32).reshape(1, 16), (3, 1)), 5126, 'MAT4')
    slots = slots or [('Test', len(idx) // 3)]
    target = add(morph, 5126, 'VEC3')
    prims, start = [], 0
    for k, (_, count) in enumerate(slots):
        part = idx[start * 3:(start + count) * 3]
        start += count
        prims.append({'attributes': attrs, 'indices': add(part.astype(np.uint32), 5125, 'SCALAR'), 'material': k,
                      'targets': [{'POSITION': target}]})
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0, 3]}], 'nodes': nodes,
           'meshes': [{'primitives': prims, 'extras': {'targetNames': ['medium_male']}}],
           'materials': [{'name': 'MI_Test', 'extras': {'sourceSlot': {'MaterialSlotName': s}}} for s, _ in slots],
           'skins': [{'joints': [0, 1, 2], 'inverseBindMatrices': ibm}],
           'accessors': accessors, 'bufferViews': views}
    binary = b''.join(blobs)
    doc['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(doc).encode()
    js += b' ' * (-len(js) % 4)
    import struct
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
    Path(path).write_bytes(out)


def permute(pos, uv, idx, seed=1, **arrays):
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(pos))          # new vertex i = old vertex order[i]
    inv = np.empty_like(order)
    inv[order] = np.arange(len(order))
    return pos[order], uv[order], inv[idx].astype(np.uint32), {k: v[order] for k, v in arrays.items()}


class SurfaceMatch(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.driver = set(JOINTS)
        self.pos, self.uv, self.idx = grid()
        write_glb(self.dir / 'live.glb', self.pos, self.uv, self.idx)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def judge(self, **kw):
        write_glb(self.dir / 's12.glb', **kw)
        return tool.judge(self.dir / 'live.glb', self.dir / 's12.glb', self.driver)

    def test_reordered_vertices_and_triangles_are_permuted(self):
        pos, uv, idx, extra = permute(self.pos, self.uv, self.idx, morph=(self.pos * 0.01).astype(np.float32))
        tris = idx.reshape(-1, 3)[::-1]               # triangle order changed too
        tris = np.roll(tris, 1, axis=1)               # and each triangle starts at another corner (same winding)
        r = self.judge(pos=pos, uv=uv, idx=tris.ravel(), morph=extra['morph'])
        self.assertEqual(r['class'], 'permuted', r)
        self.assertEqual(r['morphsChanged'], {})

    def test_permuted_with_a_moved_weight_needs_review(self):
        w = np.tile(np.array([[0, 0, 255, 0]], np.uint8), (len(self.pos), 1))
        w[7] = [0, 128, 127, 0]
        pos, uv, idx, extra = permute(self.pos, self.uv, self.idx, w=w, morph=(self.pos * 0.01).astype(np.float32))
        r = self.judge(pos=pos, uv=uv, idx=idx, weights=extra['w'], morph=extra['morph'])
        self.assertEqual(r['class'], 'permuted+weights', r)

    def test_permuted_morph_change_is_reported_in_live_order(self):
        morph = (self.pos * 0.01).astype(np.float32)
        morph[3] += 0.02
        pos, uv, idx, extra = permute(self.pos, self.uv, self.idx, morph=morph)
        r = self.judge(pos=pos, uv=uv, idx=idx, morph=extra['morph'])
        self.assertEqual(r['class'], 'permuted')
        self.assertEqual(r['morphsChanged']['medium_male']['verticesChanged'], 1)

    def test_flipped_winding_is_not_permuted(self):
        tris = self.idx.reshape(-1, 3)[:, ::-1].ravel()
        r = self.judge(pos=self.pos, uv=self.uv, idx=tris)
        self.assertFalse(r['class'].startswith('permuted'), r)

    def test_other_connectivity_over_the_same_vertices_is_not_permuted(self):
        tris = self.idx.reshape(-1, 3).copy()
        a, b = tris[0].copy(), tris[1].copy()        # flip the diagonal of the first cell
        tris[0], tris[1] = [a[0], a[1], b[2]], [a[0], b[2], a[2]]
        r = self.judge(pos=self.pos, uv=self.uv, idx=tris.ravel())
        self.assertFalse(r['class'].startswith('permuted'), r)

    def test_a_new_slot_with_the_same_material_is_not_a_plain_swap(self):
        # SK_Military_CombatPants_M (22 Nov 2026): S12 moved its cloth triangles into a new slot that reuses the MI; the
        # index binds by slot name, so the viewer threw "Missing source material slot: CombatPants_Cloth".
        n = len(self.idx) // 3
        r = self.judge(pos=self.pos, uv=self.uv, idx=self.idx, slots=[('Test', n - 4), ('Test_Cloth', 4)])
        self.assertEqual(r['class'], 'permuted+material slots', r)
        self.assertIn(['MI_Test', 'Test_Cloth'], [list(s) for s in r['slotsS12']])

    def test_a_moved_uv_island_is_uvs_changed(self):
        uv = self.uv.copy()
        uv[:6] += [0.1, 0.0]                           # the bottom row of vertices maps elsewhere in the texture
        r = self.judge(pos=self.pos, uv=uv, idx=self.idx)
        self.assertTrue(r['class'].startswith('reworked: UVs changed'), r)

    def test_a_whole_tile_shift_is_reported_as_tile_shift(self):
        uv = self.uv + np.array([4.0, 0.0], np.float32)
        r = self.judge(pos=self.pos, uv=uv, idx=self.idx)
        self.assertTrue(r['class'].startswith('reworked: UV0 tile shifts only'), r)
        self.assertGreater(r['uv0']['tileShiftShare'], 0.99)

    def test_reshaped_geometry_with_the_same_uvs_keeps_the_textures(self):
        pos = self.pos.copy()
        pos[:, 2] += 0.005 * np.sin(pos[:, 0] * 20)    # up to 5 mm bulge, same UVs
        r = self.judge(pos=pos, uv=self.uv, idx=self.idx)
        self.assertEqual(r['class'], 'reworked: same UVs, geometry moved', r)

    def test_seam_duplicates_do_not_count_as_moved_uvs(self):
        # Split the grid along its middle column into two UV islands (duplicate seam vertices), as a real seam.
        n = 6
        pos, uv, idx = self.pos.copy(), self.uv.copy(), self.idx.reshape(-1, 3).copy()
        seam = [r * n + 3 for r in range(n)]
        dup = {v: len(pos) + i for i, v in enumerate(seam)}
        pos = np.concatenate([pos, pos[seam]])
        uv = np.concatenate([uv, uv[seam] + [0.25, 0]]).astype(np.float32)
        right = [i for i, t in enumerate(idx) if all((v % n) >= 3 for v in t)]
        for i in right:
            idx[i] = [dup.get(v, v) for v in idx[i]]
        right_verts = {v for i in right for v in idx[i]} - set(dup.values())
        uv[list(right_verts)] += [0.25, 0]
        write_glb(self.dir / 'live.glb', pos, uv, idx.ravel())
        p2, uv2, idx2, _ = permute(pos, uv, idx.ravel())
        p2 = p2.copy()
        p2[:, 2] += 0.0001                             # 0.1 mm: not permuted, but the same surface and UVs
        r = self.judge(pos=p2, uv=uv2, idx=idx2)
        self.assertTrue(r['class'].startswith('reworked: same UVs'), r)

    def test_a_relaid_uv1_with_the_same_uv0_is_not_same_uvs(self):
        # CrystalHeadband / PopBraceletSet (22 Nov 2026): S12 re-laid UV1 only; UV1 feeds the layered detail and noise.
        write_glb(self.dir / 'live.glb', self.pos, self.uv, self.idx, uv1=self.uv)
        pos = self.pos.copy()
        pos[:, 2] += 0.0001                            # not permuted, so the rework metrics run
        r = self.judge(pos=pos, uv=self.uv, idx=self.idx, uv1=(self.uv * 0.5).astype(np.float32))
        self.assertTrue(r['class'].startswith('reworked: UV1+ changed'), r)
        r = self.judge(pos=pos, uv=self.uv, idx=self.idx, uv1=self.uv)
        self.assertTrue(r['class'].startswith('reworked: same UVs'), r)

    def test_geometry_moved_far_cannot_be_judged(self):
        pos = self.pos.copy()
        pos[:, 2] += 0.05                              # 5 cm away everywhere
        r = self.judge(pos=pos, uv=self.uv, idx=self.idx)
        self.assertEqual(r['class'], 'reworked: geometry moved too far to judge UVs', r)


if __name__ == '__main__':
    unittest.main()
