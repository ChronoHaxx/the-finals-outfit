"""Skin-by-name proof (Season 12 item refresh, tier 1, 12 Nov 2026): what would the RIG render differently if a refused
mesh's live GLB were replaced by its Season 12 rebuild?

morph-only-proof.py compares raw arrays, so it refuses a mesh whose joint list Season 12 re-ordered or extended even
when every vertex keeps the same bones and weights. The rig does not see joint order: rebindSourceSkeleton
(src/rig/SourceSkeleton.ts) resolves each joint by NAME against the driver skeleton (models/body/SK_Body_M.glb), gives
every driver bone the DRIVER's rest inverse, and keeps the mesh's own inverse bind only for garment-only bones
("extensions"). This proof compares what reaches the screen:

- surface (must be equal, else the mesh is not tier 1): primitive count, indices, material index per primitive,
  POSITION, TEXCOORD_n, COLOR_n, the attribute set, material names and source slots;
- loader constraints (src/rig/SourceMesh.ts, SourceSkeleton.ts): no JOINTS_2, the same influence layout, every joint
  either a driver bone or reachable from one through its parents inside the joint list (else the rebind throws);
- weights by joint name: per-vertex L1 distance and per-vertex sum (8-influence meshes are rendered unnormalised);
- normals and tangents (direction and the handedness sign);
- morph names, and which morph deltas changed (compared by name);
- inverse binds of WEIGHTED extension bones only.

Class "re-encoded" = nothing above differs except morph deltas: the swap renders exactly as a morph-only swap, so every
artefact derived from the live mesh stays valid. It is the only class admitted automatically (admissible: true). Any
other class needs a review and an explicit admission by name (build-preview-index.py --admit).

  python -I scripts/body-types/skin-by-name-proof.py ACTIVE_ASSETS_JSON PROOF_JSON REBUILT_DIR DRIVER_BODY_GLB OUT_JSON \
      [--only NAME,NAME...]

PROOF_JSON is morph-only-proof.py output on the same index; only its refused rows are judged. Read-only on every input;
refuses an existing output.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('morph_only_proof', HERE / 'morph-only-proof.py')
proof_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof_tool)

TOL = 1e-6
WEIGHT_STEPS = 2.5      # per-vertex L1 by joint name, in 1/255 steps: two 8-bit rounding steps pass
SUM_STEPS = 0.5         # per-vertex weight sum, in 1/255 steps
NORMAL_DEG = 1.0
IBM_TOL = 1e-5          # as morph-only-proof.py: translation columns are metres
BODY_TYPE_MORPHS = {'medium_male', 'medium_female'}
SCALE = {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}


class Glb:
    def __init__(self, path):
        self.path = Path(path)
        self.doc, self._acc = proof_tool.read_glb(path)

    def acc(self, index, normalise=False):
        a = self._acc(index)
        info = self.doc['accessors'][index]
        if normalise and info.get('normalized') and info['componentType'] in SCALE:
            return a.astype(np.float64) / SCALE[info['componentType']]
        return a.astype(np.float64) if a.dtype.kind == 'f' else a

    @property
    def mesh(self):
        return self.doc['meshes'][0]

    def node(self, i):
        return self.doc['nodes'][i]


def same(a, b):
    if a.shape != b.shape:
        return False
    if a.dtype.kind == 'f' or b.dtype.kind == 'f':
        return bool(np.abs(a.astype(np.float64) - b.astype(np.float64)).max(initial=0) <= TOL)
    return bool(np.array_equal(a, b))


def angles(a, b):
    a, b = a[:, :3].astype(np.float64), b[:, :3].astype(np.float64)
    cos = (a * b).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-12)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def influence_sets(attributes):
    return sorted(k for k in attributes if k.startswith('JOINTS_'))


def weights_by_name(glb, attributes, names, union):
    """Dense (vertices x union joints) weight matrix, summed by joint name."""
    sets = influence_sets(attributes)
    J = np.concatenate([glb.acc(attributes[k]).astype(np.int64) for k in sets], 1)
    W = np.concatenate([glb.acc(attributes[k.replace('JOINTS', 'WEIGHTS')], normalise=True) for k in sets], 1)
    column = np.array([union[n] for n in names])
    dense = np.zeros((J.shape[0], len(union)))
    rows = np.repeat(np.arange(J.shape[0]), J.shape[1])
    np.add.at(dense, (rows, column[J.ravel()]), W.ravel())
    return dense


def unresolvable(glb, driver):
    """Joints rebindSourceSkeleton would throw on: not a driver bone and no parent chain inside the joint list."""
    joints = glb.doc['skins'][0]['joints']
    inside = set(joints)
    parent = {c: i for i, n in enumerate(glb.doc['nodes']) for c in n.get('children', [])}
    bad = []
    for j in joints:
        k = j
        while glb.node(k).get('name') not in driver:
            k = parent.get(k)
            if k is None or k not in inside:
                bad.append(glb.node(j).get('name'))
                break
    return bad


def compare(live_path, new_path, driver):
    live, new = Glb(live_path), Glb(new_path)
    surface, loader, kinds, detail = [], [], [], {}
    if len(live.doc['meshes']) != 1 or len(new.doc['meshes']) != 1:
        return {'class': 'surface differs', 'surface': ['not a single-mesh GLB']}
    lp, np_ = live.mesh['primitives'], new.mesh['primitives']
    if len(lp) != len(np_):
        return {'class': 'surface differs', 'surface': ['primitive count differs']}
    if [m.get('name') for m in live.doc.get('materials', [])] != [m.get('name') for m in new.doc.get('materials', [])]:
        surface.append('material names differ')

    def slots(doc):
        return [{k: v for k, v in (m.get('extras', {}).get('sourceSlot') or {}).items() if k != 'UVChannelData'}
                for m in doc.get('materials', [])]
    if slots(live.doc) != slots(new.doc):
        surface.append('material source slots differ')
    seen = set()
    normal_deg, tangent_deg, tangent_flips = 0.0, 0.0, 0
    for i, (a, b) in enumerate(zip(lp, np_)):
        if a.get('material') != b.get('material'):
            surface.append(f'primitive {i} material index differs')
        if set(a['attributes']) != set(b['attributes']):
            (loader if {k for k in set(a['attributes']) ^ set(b['attributes'])} <= {'JOINTS_1', 'WEIGHTS_1', 'JOINTS_2', 'WEIGHTS_2'}
             else surface).append(f'primitive {i} attribute sets differ: {sorted(a["attributes"])} vs {sorted(b["attributes"])}')
        if not same(live.acc(a['indices']), new.acc(b['indices'])):
            surface.append(f'primitive {i} indices differ')
        for name in sorted(set(a['attributes']) & set(b['attributes'])):
            key = (name, a['attributes'][name])
            if key in seen or name.startswith(('JOINTS_', 'WEIGHTS_')):
                continue
            seen.add(key)
            x, y = live.acc(a['attributes'][name]), new.acc(b['attributes'][name])
            if x.shape != y.shape:
                surface.append(f'{name} shape differs')
            elif name == 'NORMAL':
                normal_deg = max(normal_deg, float(angles(x, y).max(initial=0)))
            elif name == 'TANGENT':
                tangent_deg = max(tangent_deg, float(angles(x, y).max(initial=0)))
                tangent_flips += int((np.sign(x[:, 3]) != np.sign(y[:, 3])).sum())
            elif not same(x, y):
                surface.append(f'{name} differs')
    if surface:
        return {'class': 'surface differs', 'surface': surface}
    detail.update(normalMaxDeg=round(normal_deg, 3), tangentMaxDeg=round(tangent_deg, 3), tangentSignFlips=tangent_flips)
    if normal_deg > NORMAL_DEG or tangent_deg > NORMAL_DEG or tangent_flips:
        kinds.append('normals')

    # Morphs by name (the rig applies them by name, morphTargetDictionary).
    ln, nn = live.mesh.get('extras', {}).get('targetNames', []), new.mesh.get('extras', {}).get('targetNames', [])
    if set(ln) != set(nn):
        kinds.append('morph set')
        detail['morphsAdded'], detail['morphsRemoved'] = sorted(set(nn) - set(ln)), sorted(set(ln) - set(nn))
        detail['morphsRemovedMaxCm'] = {m: round(float(np.linalg.norm(live.acc(lp[0]['targets'][ln.index(m)]['POSITION']),
                                                                       axis=1).max(initial=0)) * 100, 3)
                                        for m in detail['morphsRemoved']}
    changed = {}
    for name in sorted(set(ln) & set(nn)):
        d = np.linalg.norm(live.acc(lp[0]['targets'][ln.index(name)]['POSITION'])
                           - new.acc(np_[0]['targets'][nn.index(name)]['POSITION']), axis=1)
        if d.max(initial=0) > TOL:
            changed[name] = {'maxCm': round(float(d.max()) * 100, 3), 'verticesChanged': int((d > TOL).sum())}
    detail['morphsChanged'] = changed

    # Skin, as the rig resolves it.
    ls, ns = live.doc.get('skins', []), new.doc.get('skins', [])
    if len(ls) != len(ns) or len(ns) > 1:
        loader.append('skin count differs or several skins')
    elif ns:
        lnames = [live.node(j).get('name') for j in ls[0]['joints']]
        nnames = [new.node(j).get('name') for j in ns[0]['joints']]
        detail.update(jointsLive=len(lnames), jointsS12=len(nnames))
        if any(influence_sets(p['attributes']) != influence_sets(lp[0]['attributes']) for p in lp + np_):
            loader.append('influence layout differs between primitives or files')
        if any('JOINTS_2' in p['attributes'] for p in np_):
            loader.append('JOINTS_2 (SourceMesh.ts throws)')
        bad = unresolvable(new, driver)
        if bad:
            loader.append(f'rebind throws (no driver ancestor): {bad[:5]}')
        if not loader:
            union = {n: i for i, n in enumerate(sorted(set(lnames) | set(nnames)))}
            wl = weights_by_name(live, lp[0]['attributes'], lnames, union)
            wn = weights_by_name(new, np_[0]['attributes'], nnames, union)
            l1 = np.abs(wl - wn).sum(1) * 255
            sums = np.abs(wl.sum(1) - wn.sum(1)) * 255
            detail.update(weightMaxSteps=round(float(l1.max(initial=0)), 2), verticesWeightMoved=int((l1 > WEIGHT_STEPS).sum()),
                          weightSumMaxSteps=round(float(sums.max(initial=0)), 2))
            if l1.max(initial=0) > WEIGHT_STEPS or sums.max(initial=0) > SUM_STEPS:
                kinds.append('weights')
            weighted = {n for n, i in union.items() if wn[:, i].any()}
            libm = dict(zip(lnames, live.acc(ls[0]['inverseBindMatrices'])))
            nibm = dict(zip(nnames, new.acc(ns[0]['inverseBindMatrices'])))
            extension = sorted(n for n in weighted if n not in driver)
            moved = {n: round(float(np.abs(libm[n] - nibm[n]).max()), 6) for n in extension
                     if n in libm and np.abs(libm[n] - nibm[n]).max() > IBM_TOL}
            added = [n for n in extension if n not in libm]
            detail.update(weightedExtensionBones=extension)
            if moved or added:
                kinds.append('extension bones')
                detail.update(extensionBindsMoved=moved, extensionBonesAdded=added)
    if loader:
        return {'class': 'loader refuses', 'loader': loader, **detail}
    return {'class': '+'.join(kinds) if kinds else 're-encoded', **detail}


def main(assets_json, proof_json, rebuilt_dir, driver_glb, out_json, only=None):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    base = Path(assets_json).parent
    rows = json.loads(Path(proof_json).read_text(encoding='utf-8'))
    driver_doc = Glb(driver_glb).doc
    driver = {driver_doc['nodes'][j].get('name') for j in driver_doc['skins'][0]['joints']}
    report = {}
    for name, row in sorted(rows.items()):
        if row.get('status') != 'refused' or (only and name not in only):
            continue
        live, new = base / row['liveUrl'], Path(rebuilt_dir) / f'{name}.glb'
        result = compare(live, new, driver)
        report[name] = {'source': row['source'], 'liveUrl': row['liveUrl'],
                        'liveSha256': hashlib.sha256(live.read_bytes()).hexdigest(),
                        's12Sha256': hashlib.sha256(new.read_bytes()).hexdigest(),
                        **result, 'admissible': result['class'] == 're-encoded'}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'driver': Path(driver_glb).as_posix(), 'driverBones': len(driver),
                               'tolerances': {'weightSteps': WEIGHT_STEPS, 'sumSteps': SUM_STEPS, 'normalDeg': NORMAL_DEG,
                                              'ibm': IBM_TOL},
                               'meshes': report}, indent=1) + '\n', encoding='utf-8')
    counts = {}
    for r in report.values():
        counts[r['class']] = counts.get(r['class'], 0) + 1
    print(json.dumps({'judged': len(report), **dict(sorted(counts.items())), 'out': str(out)}))


if __name__ == '__main__':
    argv = sys.argv[1:]
    only = None
    if '--only' in argv:
        i = argv.index('--only')
        only = set(argv[i + 1].split(','))
        del argv[i:i + 2]
    main(*argv[:5], only=only)
