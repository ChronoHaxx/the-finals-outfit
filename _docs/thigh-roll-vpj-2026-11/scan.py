"""Question 1 (26 Nov 2026): how widespread are bind offsets like thigh_roll_vpj's?

For every skinned mesh GLB the active index (reconstructed-assemblies-v1/assets.json) references, and every joint of
its skin that the reference body also has: the joint's bind pose (its inverse bind, inverted) against the reference
body's own bind (attachmentBody.restBones for Medium meshes, the Light body's inverse binds for Light class meshes;
the basis is picked by the median joint-position distance, as Archetype.ts sourceBindBasis does). Reported per joint:
  - dRot (deg), dPos (cm): the joint's bind rotation and position against the body's, in world (bind) space;
  - originCm: |translation| of body_rest @ IBM (the 26 Nov C1 diagnostic's metric, kept for comparison);
  - wMax / n05: the joint's largest vertex weight in that mesh and how many vertices weigh more than 0.05 on it;
  - slideMm: per vertex, d = sum_j w_j (body_rest_j @ IBM_j - I) v, the distance a vertex would move at the rest pose if
    the mesh were skinned with its own inverse binds instead of the body's (what the viewer does). Max and p99 over the
    mesh's vertices; normalMm = |d . n| (the part along the vertex normal: in/out of the surface, what can open a gap
    or push through the body); the rest slides along the surface.
Basis: Medium (attachmentBody.restBones), Light (the Light body's inverse binds) or Heavy (Medium with every bind
position scaled by 1.15, Archetype.ts; the index records no Heavy body).
Read-only on every input.   python -X utf8 -I scan.py OUT_JSON
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glbskin import Glb, rot_deg  # noqa: E402

M = Path('E:/Coding/the-finals-outfit/public/models')
IDX = M / 'reconstructed-assemblies-v1'
A = json.load(open(IDX / 'assets.json', encoding='utf8'))
ROT_FLAG, POS_FLAG = 0.5, 0.1  # a joint counts as offset above 0.5 deg or 0.1 cm


def rests(g):
    names, ibm, _ = g.skin()
    return {n: np.linalg.inv(m) for n, m in zip(names, ibm)}


def mesh_world(g):
    i = g.mesh_node()
    return None if i is None else g.world(i)


medium_glb = Glb((IDX / A['attachmentBody']['url']).resolve())
medium = {k: np.array(v, dtype=np.float64).reshape(4, 4).T for k, v in A['attachmentBody']['restBones'].items()}
assert all(np.allclose(medium[k], v, atol=1e-6) for k, v in rests(medium_glb).items()), 'restBones != body inverse binds'
light_url = A['meshes'][A['archetypes']['light']['body']]['url']
light_glb = Glb((IDX / light_url).resolve())
light = rests(light_glb)
heavy = {}
for k, v in medium.items():
    h = v.copy(); h[:3, 3] *= 1.15; heavy[k] = h
BASES = {'medium': (medium, mesh_world(medium_glb)), 'light': (light, mesh_world(light_glb)),
         'heavy': (heavy, mesh_world(medium_glb))}


def median_dist(ibm_rest, ref):
    d = [np.linalg.norm(ibm_rest[n][:3, 3] - ref[n][:3, 3]) for n in ibm_rest if n in ref]
    return float(np.median(d)) if d else np.inf


urls = defaultdict(list)
for key, m in A['meshes'].items():
    if m.get('kind') == 'skeletal':
        urls[m['url']].append(key)

rows, joint_stats = [], defaultdict(lambda: {'meshes': 0, 'dRotMax': 0.0, 'dPosMax': 0.0, 'originCmMax': 0.0,
                                               'weighted05': 0, 'offsetAndWeighted05': 0, 'worst': None})
errors = []
for url, keys in sorted(urls.items()):
    path = (IDX / url).resolve()
    try:
        g = Glb(path)
        names, ibm, _ = g.skin()
        own = {n: np.linalg.inv(m) for n, m in zip(names, ibm)}
        basis = min(BASES, key=lambda b: median_dist(own, BASES[b][0]))
        ref, ref_world = BASES[basis]
        mw = mesh_world(g)
        bind_frame_ok = mw is None or ref_world is None or bool(np.allclose(mw, ref_world, atol=1e-5))
        offs = np.stack([ref[n] @ ibm[i] if n in ref else np.eye(4) for i, n in enumerate(names)])
        per = {}
        for i, n in enumerate(names):
            if n not in ref:
                continue
            D = np.linalg.inv(ref[n]) @ own[n]
            per[n] = {'dRot': rot_deg(D), 'dPos': float(np.linalg.norm(own[n][:3, 3] - ref[n][:3, 3])) * 100,
                      'originCm': float(np.linalg.norm(offs[i][:3, 3])) * 100, 'wMax': 0.0, 'n05': 0}
        slide, normal, nverts = [], [], 0
        for pos, J, W, nrm in g.skin_weights():
            nverts += len(pos)
            v = np.c_[pos, np.ones(len(pos))]
            disp = np.zeros((len(pos), 3))
            for k in range(J.shape[1]):
                w = W[:, k]
                live = w > 0
                if not live.any():
                    continue
                Mk = offs[J[live, k]] - np.eye(4)
                disp[live] += w[live, None] * np.einsum('nij,nj->ni', Mk, v[live])[:, :3]
            slide.append(np.linalg.norm(disp, axis=1))
            if nrm is not None:
                nn = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
                normal.append(np.abs((disp * nn).sum(1)))
            for i, n in enumerate(names):
                if n not in per:
                    continue
                wj = (W * (J == i)).sum(1)
                per[n]['wMax'] = max(per[n]['wMax'], float(wj.max(initial=0)))
                per[n]['n05'] += int((wj > 0.05).sum())
        slide = np.concatenate(slide) if slide else np.zeros(1)
        normal = np.concatenate(normal) if normal else np.zeros(1)
        offset_joints = {n: {k: round(v, 4) if isinstance(v, float) else v for k, v in r.items()}
                         for n, r in per.items() if r['dRot'] > ROT_FLAG or r['dPos'] > POS_FLAG}
        row = {'url': url, 'keys': keys, 'basis': basis, 'bindFrameMatchesBody': bind_frame_ok, 'vertices': nverts,
               'slideMmMax': round(float(slide.max()) * 1000, 3), 'slideMmP99': round(float(np.percentile(slide, 99)) * 1000, 3),
               'normalMmMax': round(float(normal.max()) * 1000, 3),
               'normalMmP99': round(float(np.percentile(normal, 99)) * 1000, 3), 'offsetJoints': offset_joints,
               'jointsNotInBody': [n for n in names if n not in ref]}
        rows.append(row)
        for n, r in per.items():
            s = joint_stats[n]
            s['meshes'] += 1
            s['dRotMax'] = max(s['dRotMax'], r['dRot'])
            s['dPosMax'] = max(s['dPosMax'], r['dPos'])
            s['originCmMax'] = max(s['originCmMax'], r['originCm'])
            w05 = r['wMax'] > 0.05
            s['weighted05'] += w05
            off = r['dRot'] > ROT_FLAG or r['dPos'] > POS_FLAG
            s['offsetAndWeighted05'] += bool(off and w05)
            s.setdefault('offsetMeshes', 0)
            s['offsetMeshes'] += bool(off)
            if s['worst'] is None or r['dRot'] > s['worst'][1]:
                s['worst'] = (url, round(r['dRot'], 3))
    except Exception as e:  # report, never hide
        errors.append({'url': url, 'error': repr(e)})

summary = {n: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items()}
           for n, s in sorted(joint_stats.items(), key=lambda kv: -kv[1]['dRotMax'])}
out = {'index': str(IDX / 'assets.json'), 'skinnedMeshes': len(urls), 'scanned': len(rows), 'errors': errors,
       'flag': {'rotDeg': ROT_FLAG, 'posCm': POS_FLAG}, 'joints': summary,
       'basisCounts': {b: sum(r['basis'] == b for r in rows) for b in BASES},
       'bindFrameMismatches': [r['url'] for r in rows if not r['bindFrameMatchesBody']],
       'meshes': sorted(rows, key=lambda r: -r['slideMmMax'])}
json.dump(out, open(sys.argv[1], 'w', encoding='utf8'), indent=1)
print('scanned', len(rows), 'of', len(urls), 'errors', len(errors), 'basis', out['basisCounts'],
      'bind-frame mismatches', len(out['bindFrameMismatches']))
print(f"{'joint':24s} {'meshes':>6s} {'w>.05':>6s} {'offset':>6s} {'off&w':>6s} {'dRotMax':>8s} {'dPosMax':>8s} {'origin':>7s}")
for n, s in summary.items():
    if s['dRotMax'] > 0.05 or s['dPosMax'] > 0.01:
        print(f"{n:24s} {s['meshes']:6d} {s['weighted05']:6d} {s.get('offsetMeshes', 0):6d} {s['offsetAndWeighted05']:6d} "
              f"{s['dRotMax']:8.3f} {s['dPosMax']:8.3f} {s['originCmMax']:7.3f}  worst {s['worst']}")
print('top slide:')
for r in out['meshes'][:25]:
    print(f"  {r['slideMmMax']:7.2f} mm (p99 {r['slideMmP99']:6.2f}; normal {r['normalMmMax']:6.2f}, p99 {r['normalMmP99']:5.2f}) {r['basis']} {r['url']}  "
          f"{ {n: (round(v['dRot'], 2), v['wMax']) for n, v in r['offsetJoints'].items()} }")
