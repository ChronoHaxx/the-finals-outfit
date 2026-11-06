"""Morph-only proof (body types, 6 Nov 2026): may an S12-rebuilt mesh replace the live one in a preview index?

A rebuilt GLB qualifies only when everything except its morph targets equals the live GLB:
- every vertex attribute: POSITION, NORMAL, TANGENT, TEXCOORD_n, COLOR_n, JOINTS_n, WEIGHTS_n;
- each primitive's index buffer and material slot;
- the material names and source slots;
- the skin's joint names and inverse bind matrices;
- the morph NAMES.

Then the derived artefacts built on the live mesh (body masks, material bindings, wraps, transfers) stay valid. The
only change the preview makes is the morph deltas that S12 ships.

  python -I scripts/body-types/morph-only-proof.py LIVE_ASSETS_JSON REBUILT_DIR OUT_JSON

Read-only on both inputs; refuses an existing OUT_JSON.
"""
import gzip
import json
import struct
import sys
from pathlib import Path

import numpy as np

TOL = 1e-6
IBM_TOL = 1e-5


def read_glb(path):
    b = Path(path).read_bytes()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    if struct.unpack('<I', b[:4])[0] != 0x46546C67:
        raise ValueError(f'not a GLB: {path}')
    jl = struct.unpack('<I', b[12:16])[0]
    doc = json.loads(b[20:20 + jl])
    binary = b[20 + jl + 8:]

    def accessor(i):
        a = doc['accessors'][i]
        if 'sparse' in a:
            raise ValueError('sparse accessors are not compared')
        v = doc['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}[a['componentType']]
        stride = v.get('byteStride')
        if stride and stride != np.dtype(dt).itemsize * n:
            raise ValueError('interleaved buffer views are not compared')
        return np.frombuffer(binary, dtype=dt, count=a['count'] * n,
                             offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)
    return doc, accessor


def same(a, b):
    if a.shape != b.shape:
        return False
    if a.dtype.kind == 'f' or b.dtype.kind == 'f':
        return bool(np.abs(a.astype(np.float64) - b.astype(np.float64)).max(initial=0) <= TOL)
    return bool(np.array_equal(a, b))


def compare(live_path, new_path):
    ld, la = read_glb(live_path)
    nd, na = read_glb(new_path)
    problems, morphs = [], {}
    if len(ld['meshes']) != 1 or len(nd['meshes']) != 1:
        return ['not a single-mesh GLB'], morphs
    lm, nm = ld['meshes'][0], nd['meshes'][0]
    lnames = lm.get('extras', {}).get('targetNames', [])
    nnames = nm.get('extras', {}).get('targetNames', [])
    # The rig applies morphs by name (morphTargetDictionary), so only the name SET is identity; order is not.
    if set(lnames) != set(nnames) or len(set(nnames)) != len(nnames):
        problems.append(f'morph names differ: -{sorted(set(lnames) - set(nnames))} +{sorted(set(nnames) - set(lnames))}')
    if len(lm['primitives']) != len(nm['primitives']):
        return problems + ['primitive count differs'], morphs
    if [m.get('name') for m in ld.get('materials', [])] != [m.get('name') for m in nd.get('materials', [])]:
        problems.append('material names differ')
    # UVChannelData is the texture-streaming density hint (LocalUVDensities); re-exports differ in the fifth decimal
    # and nothing renders from it, so it is not part of the slot identity.
    def slots(doc):
        return [{k: v for k, v in (m.get('extras', {}).get('sourceSlot') or {}).items() if k != 'UVChannelData'}
                for m in doc.get('materials', [])]
    if slots(ld) != slots(nd):
        problems.append('material source slots differ')
    seen = set()
    for i, (lp, rp) in enumerate(zip(lm['primitives'], nm['primitives'])):
        if lp.get('material') != rp.get('material'):
            problems.append(f'primitive {i} material index differs')
        if set(lp['attributes']) != set(rp['attributes']):
            problems.append(f'primitive {i} attribute sets differ: {sorted(lp["attributes"])} vs {sorted(rp["attributes"])}')
        for name in sorted(set(lp['attributes']) & set(rp['attributes'])):
            key = (name, lp['attributes'][name])
            if key in seen:
                continue
            seen.add(key)
            if not same(la(lp['attributes'][name]), na(rp['attributes'][name])):
                problems.append(f'{name} differs')
        if not same(la(lp['indices']), na(rp['indices'])):
            problems.append(f'primitive {i} indices differ')
        if i == 0 and set(lnames) == set(nnames):
            for k, name in enumerate(lnames):
                d = np.linalg.norm(la(lp['targets'][k]['POSITION']).astype(np.float64)
                                   - na(rp['targets'][nnames.index(name)]['POSITION']).astype(np.float64), axis=1)
                if d.max(initial=0) > TOL:
                    morphs[name] = {'maxCm': round(float(d.max()) * 100, 3), 'verticesChanged': int((d > TOL).sum())}
    ls, ns = ld.get('skins', []), nd.get('skins', [])
    if len(ls) != len(ns):
        problems.append('skin count differs')
    for s1, s2 in zip(ls, ns):
        if [ld['nodes'][j].get('name') for j in s1['joints']] != [nd['nodes'][j].get('name') for j in s2['joints']]:
            problems.append('skin joint names differ')
        else:
            # Inverse binds are float32 products of the bone chain; a re-export can differ in the last bits. Translation
            # columns are metres, so 1e-5 is 0.01 mm. Anything larger is a changed rest pose and refuses the mesh.
            d = np.abs(la(s1['inverseBindMatrices']).astype(np.float64)
                       - na(s2['inverseBindMatrices']).astype(np.float64)).max(initial=0)
            if d > IBM_TOL:
                problems.append(f'inverse bind matrices differ (max {d:.2e})')
    return problems, morphs


def main(assets_json, rebuilt_dir, out_json):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    assets = Path(assets_json)
    meshes = json.loads(assets.read_text(encoding='utf-8'))['meshes']
    by_name = {key.rsplit('.', 1)[-1]: (key, entry) for key, entry in meshes.items()}
    report = {}
    for glb in sorted(Path(rebuilt_dir).glob('*.glb')):
        if glb.stem not in by_name:
            report[glb.stem] = {'status': 'not-indexed'}
            continue
        key, entry = by_name[glb.stem]
        problems, morphs = compare(assets.parent / entry['url'], glb)
        report[glb.stem] = {'source': key, 'liveUrl': entry['url'],
                            'status': 'morph-only' if not problems else 'refused',
                            **({'problems': problems} if problems else {}), 'morphsChanged': morphs}
    out.write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8')
    for name, r in report.items():
        changed = ', '.join(f'{k} {v["maxCm"]}cm' for k, v in r.get('morphsChanged', {}).items())
        print(f'{name:42s} {r["status"]:11s} {"; ".join(r.get("problems", []))} {changed}')


if __name__ == '__main__':
    main(*sys.argv[1:4])
