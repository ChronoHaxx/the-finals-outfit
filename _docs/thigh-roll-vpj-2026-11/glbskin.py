"""Minimal read-only GLB skin reader for the thigh_roll_vpj investigation (26 Nov 2026).

Handles gzip-wrapped GLBs, strided views and normalised weights. No meshopt (the active index has none) and no sparse
accessors on the attributes read here. Matrices come back row-major (numpy convention), glTF column-major on disk.
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np

NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DTYPE = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}
NORM = {5121: 255.0, 5123: 65535.0}


class Glb:
    def __init__(self, path, nodes_only=False):
        self.path = Path(path)
        b = self.path.read_bytes()
        if b[:2] == b'\x1f\x8b':
            b = gzip.decompress(b)
        if struct.unpack('<I', b[:4])[0] != 0x46546C67:
            raise ValueError(f'not a GLB: {path}')
        jl = struct.unpack('<I', b[12:16])[0]
        self.doc = json.loads(b[20:20 + jl])
        self.bin = b[20 + jl + 8:]
        for e in ([] if nodes_only else self.doc.get('extensionsRequired', [])):
            raise ValueError(f'unsupported required extension {e}: {path}')

    def acc(self, i):
        a = self.doc['accessors'][i]
        if 'sparse' in a:
            raise ValueError('sparse accessor')
        v = self.doc['bufferViews'][a['bufferView']]
        n, dt = NCOMP[a['type']], np.dtype(DTYPE[a['componentType']])
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride') or dt.itemsize * n
        if stride == dt.itemsize * n:
            out = np.frombuffer(self.bin, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
        else:
            raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=off)
            out = np.lib.stride_tricks.as_strided(raw.view(np.uint8), shape=(a['count'], n * dt.itemsize),
                                                  strides=(stride, 1)).copy().view(dt).reshape(a['count'], n)
        if a.get('normalized') and a['componentType'] in NORM:
            return out.astype(np.float64) / NORM[a['componentType']]
        return out.astype(np.float64) if dt.kind == 'f' else out

    # --- scene graph -------------------------------------------------------------------------------------------
    def local(self, i):
        n = self.doc['nodes'][i]
        if 'matrix' in n:
            return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
        t = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64)
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3] = R * s
        M[:3, 3] = t
        return M

    def parents(self):
        p = {}
        for i, n in enumerate(self.doc['nodes']):
            for c in n.get('children', []):
                p[c] = i
        return p

    def world(self, i, _p=None):
        p = self.parents() if _p is None else _p
        M = self.local(i)
        while i in p:
            i = p[i]
            M = self.local(i) @ M
        return M

    # --- skin --------------------------------------------------------------------------------------------------
    def skin(self):
        s = self.doc['skins'][0]
        ibm = self.acc(s['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        names = [self.doc['nodes'][j].get('name') for j in s['joints']]
        return names, ibm, s['joints']

    def joints(self):
        s = self.doc['skins'][0]
        return [self.doc['nodes'][j].get('name') for j in s['joints']], s['joints']

    def mesh_node(self):
        for i, n in enumerate(self.doc['nodes']):
            if 'mesh' in n and 'skin' in n:
                return i
        return None

    def skin_weights(self):
        """Per primitive (positions [N,3], joints [N,K], weights [N,K], normals [N,3] or None)."""
        out = []
        for m in self.doc['meshes']:
            for prim in m['primitives']:
                at = prim['attributes']
                pos = self.acc(at['POSITION'])
                J, W = [], []
                k = 0
                while f'JOINTS_{k}' in at:
                    J.append(self.acc(at[f'JOINTS_{k}']).astype(np.int64))
                    W.append(self.acc(at[f'WEIGHTS_{k}']).astype(np.float64))
                    k += 1
                if not J:
                    continue
                nrm = self.acc(at['NORMAL']) if 'NORMAL' in at else None
                out.append((pos, np.concatenate(J, 1), np.concatenate(W, 1), nrm))
        return out


def rot_deg(M):
    c = np.clip((np.trace(M[:3, :3]) - 1) / 2, -1, 1)
    return float(np.degrees(np.arccos(c)))


def rot_axis(M):
    R = M[:3, :3]
    a = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    n = np.linalg.norm(a)
    return a / n if n > 1e-12 else np.zeros(3)
