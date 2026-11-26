"""Cage body-type morph gap (26 Nov 2026): how far a head-wrapped part would move if the worn cage also took the head's
Masculine body-type morph (medium_male), which build-head-wraps.py leaves out (FITTING_MORPH).

Read-only: the active head-wraps.json, the cage and part extractions under scripts/generated/shader-probe (main
checkout). Writes one JSON report and prints a table.
  python cage_bodytype_gap.py <repo> <out.json>
"""
import json, sys
from pathlib import Path
import numpy as np

REPO = Path(sys.argv[1]); OUT = Path(sys.argv[2])
GEN = REPO / 'scripts/generated/shader-probe'
CAGE_DIRS = ['head-wraps-v2', 'w91-cages-v1', 'w91-cages-v2', 'w91-cages-face14']
PART_DIR = GEN / 'head-wraps-v2/source/assets-01'
PARTS = ['SK_Streetwear_Balaclava_M', 'SK_BeardFull_M', 'SK_Cowboy_MouthScarf_M', 'SK_Winter_MouthScarf_M',
         'SK_Sport_LuchadorFaceMask_M']
FACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30, 31, 32]
ACTIVE = ['default_ears', 'head_neck_match']  # the cage morphs the viewer drives with a balaclava on Masculine


def glb(p): return np.asarray(p, float)[:, [0, 2, 1]] * 0.01


def lod(path): return json.loads(path.read_text(encoding='utf-8'))['lods'][0]


def cage_file(name):
    for d in CAGE_DIRS:
        f = GEN / d / 'source/assets-01' / f'{name}.mesh.json'
        if f.is_file(): return f
    raise FileNotFoundError(name)


def frames(cage, tris):
    a, b, c = cage[tris[:, 0]], cage[tris[:, 1]], cage[tris[:, 2]]
    e1 = b - a; e1 /= np.linalg.norm(e1, axis=1)[:, None]
    n = np.cross(b - a, c - a); n /= np.linalg.norm(n, axis=1)[:, None]
    return a, b, c, e1, np.cross(n, e1), n


def closest(p, a, b, c):
    """Barycentric weights of the closest point on triangle abc to p (Ericson 5.1.5), one point."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = ab @ ap, ac @ ap
    if d1 <= 0 and d2 <= 0: return np.array([1, 0, 0.])
    bp = p - b; d3, d4 = ab @ bp, ac @ bp
    if d3 >= 0 and d4 <= d3: return np.array([0, 1, 0.])
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0: v = d1 / (d1 - d3); return np.array([1 - v, v, 0])
    cp = p - c; d5, d6 = ab @ cp, ac @ cp
    if d6 >= 0 and d5 <= d6: return np.array([0, 0, 1.])
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0: w = d2 / (d2 - d6); return np.array([1 - w, 0, w])
    va = d3 * d6 - d5 * d4
    if va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return np.array([0, 1 - w, w])
    denom = 1 / (va + vb + vc); v, w = vb * denom, vc * denom
    return np.array([1 - v - w, v, w])


def bind(points, ref, tris):
    a, b, c, e1, e2, n = frames(ref, tris)
    centres = (a + b + c) / 3
    out = []
    for p in points:
        near = np.argsort(((centres - p) ** 2).sum(1))[:8]
        best = None
        for t in near:
            w = closest(p, a[t], b[t], c[t]); q = w @ np.array([a[t], b[t], c[t]]); dd = ((p - q) ** 2).sum()
            if best is None or dd < best[0]: best = (dd, t, w, p - q)
        _, t, w, r = best
        out.append((t, w, np.array([r @ e1[t], r @ e2[t], r @ n[t]])))
    return out


def apply(binding, cage, tris):
    a, b, c, e1, e2, n = frames(cage, tris)
    return np.array([w[0] * a[t] + w[1] * b[t] + w[2] * c[t] + k[0] * e1[t] + k[1] * e2[t] + k[2] * n[t]
                     for t, w, k in binding])


def main():
    wraps = json.loads((REPO / 'public/models/reconstructed-assemblies-v1/head-wraps.json').read_text(encoding='utf-8'))
    ref = np.asarray(wraps['reference']['positions'], float).reshape(-1, 3)
    heads = {k.split('/')[-1].split('.')[0]: v for k, v in wraps['heads'].items()}
    report = {'meaning': 'per part and face: max displacement (mm) the cage medium_male morph would add to the wrap, by '
                         'height band of the part vertex (GLB y, metres); and the part\'s own medium_male morph there',
              'faces': {}}
    parts = {}
    for name in PARTS:
        rec = lod(PART_DIR / f'{name}.mesh.json')
        pos = glb(rec['positions'])
        own = np.zeros_like(pos)
        for m in rec.get('morphs') or []:
            if m['name'] == 'medium_male' and m['deltas']:
                own[[e['vertex'] for e in m['deltas']]] = glb([e['position'] for e in m['deltas']])
        key = next(k for k in wraps['meshes'] if k.endswith('/' + name + '.' + name))
        tris = np.asarray(wraps['meshes'][key]['triangles'], int).reshape(-1, 3)
        parts[name] = (pos, own, tris, bind(pos, ref, tris))
    for n in FACES:
        head = f'SK_Head_Face_{n:02d}_Base'
        cage_path = heads[head]; cname = cage_path.split('/')[-1].split('.')[0]
        cage = wraps['cages'][cage_path]
        target = np.asarray(cage['positions'], float).reshape(-1, 3).copy()
        for m in ACTIVE:
            if m in cage['morphs']:
                mm = cage['morphs'][m]; target[mm['vertices']] += np.asarray(mm['deltas']).reshape(-1, 3)
        # The source cage in reference order (head-wraps.json keeps it reordered when it was stored differently).
        src = lod(cage_file(cname)); spos = glb(src['positions'])
        if cage.get('reordered'):
            print(f'Face {n:02d} {cname}: reordered cage, skipped'); report['faces'][f'Face {n:02d}'] = {'cage': cname, 'skipped': 'reordered'}; continue
        order = np.arange(len(spos))  # stored in reference order (build-head-wraps.py keeps the identity then)
        drift = float(np.abs(spos[order] - np.asarray(cage['positions']).reshape(-1, 3)).max())
        if drift > 1e-5:
            print(f'Face {n:02d} {cname}: source cage does not match the active cage (unique {len(set(order.tolist()))}, drift {drift:.3g} m)')
            report['faces'][f'Face {n:02d}'] = {'cage': cname, 'skipped': 'source cage differs from the active cage'}; continue
        inverse = np.empty(len(order), int); inverse[order] = np.arange(len(order))
        male = next(m for m in src['morphs'] if m['name'] == 'medium_male')
        delta = np.zeros_like(target)
        delta[inverse[[e['vertex'] for e in male['deltas']]]] = glb([e['position'] for e in male['deltas']])
        row = {'cage': cname, 'cageMatchMaxM': drift, 'cageMaleMaxMm': round(float(np.linalg.norm(delta, axis=1).max()) * 1000, 2)}
        for name, (pos, own, tris, binding) in parts.items():
            used = np.unique(tris)
            if not np.abs(delta[used]).any():
                row[name] = {'maxMm': 0.0}; continue
            moved = apply(binding, target + delta, tris) - apply(binding, target, tris)
            dist = np.linalg.norm(moved, axis=1) * 1000
            ownd = np.linalg.norm(own, axis=1) * 1000
            y = pos[:, 1]
            bands = {'face y>1.66': y > 1.66, 'jaw 1.62-1.66': (y > 1.62) & (y <= 1.66), 'neck y<=1.62': y <= 1.62}
            i = int(np.argmax(dist))
            row[name] = {'maxMm': round(float(dist.max()), 2), 'at': [round(float(v), 4) for v in pos[i]],
                         'bands': {k: round(float(dist[m].max()), 2) if m.any() else None for k, m in bands.items()},
                         'ownMaleAtMaxMm': round(float(ownd[i]), 2), 'ownMaleMaxMm': round(float(ownd.max()), 2),
                         'dot': round(float((moved[i] @ own[i]) / ((np.linalg.norm(moved[i]) * np.linalg.norm(own[i])) or 1)), 2),
                         'cageInsteadOfOwnMaxMm': {k: round(float(np.linalg.norm(moved - own, axis=1)[m].max() * 1000), 2) if m.any() else None
                                                   for k, m in bands.items()}}
        report['faces'][f'Face {n:02d}'] = row
        print(f'Face {n:02d} {cname[8:-6]:>14} cage mm {row["cageMaleMaxMm"]:5.1f}  ' + '  '.join(
            f'{k[3:15]} {v["maxMm"]:5.2f}' + (f' ({v["bands"]["jaw 1.62-1.66"]}/{v["bands"]["neck y<=1.62"]}; swap {max(x for x in v["cageInsteadOfOwnMaxMm"].values() if x is not None)})' if 'bands' in v else '')
            for k, v in row.items() if isinstance(v, dict)))
    OUT.write_text(json.dumps(report, indent=1), encoding='utf-8')


main()
