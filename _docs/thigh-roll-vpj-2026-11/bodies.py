"""Question 2 (26 Nov 2026): where does the thigh_roll_vpj bind offset come from?

Compares, for the leg helper joints, the LOCAL rest transform (relative to the parent bone) recorded in:
  - the source body mesh (reconstructed-meshes-v2/SK_Body_M.glb): from its inverse binds, and from its node TRS;
  - the legacy driver body (models/body/SK_Body_M.glb), whose node rests the viewer binds every skin to;
  - the Light class body, from its inverse binds;
  - a garment's inverse binds and node TRS (LongCoat, live file);
  - the June dump's USkeleton reference poses (SK_Body_M_Skeleton, SK_CharacterMeshMergeTarget_Skeleton), UE space
    converted to the glTF mirror: position (x, -y, z) / 100, quaternion (-x, y, -z, w).
Read-only.   python -X utf8 -I bodies.py OUT_JSON
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glbskin import Glb, rot_deg, rot_axis  # noqa: E402

M = Path('E:/Coding/the-finals-outfit/public/models')
# The June FModel dump's Characters folder (FINALS_DUMP overrides, as in scripts/convert-meshes.mjs).
DUMP = Path(os.environ.get('FINALS_DUMP') or 'C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/'
            'Exports/Discovery/Content/Discovery/Characters')
A = json.load(open(M / 'reconstructed-assemblies-v1/assets.json', encoding='utf8'))
JOINTS = ['thigh_l', 'thigh_roll_vpj_l', 'thigh_front_vpj_l', 'thigh_back_vpj_l', 'calf_l', 'knee_vpj_l',
          'thigh_r', 'thigh_roll_vpj_r', 'thigh_front_vpj_r', 'thigh_back_vpj_r', 'calf_r', 'knee_vpj_r',
          'upperarm_vpj_01_l', 'lowerarm_vpj_01_l']


def from_ibm(g):
    names, ibm, joints = g.skin()
    p = g.parents()
    world = {n: np.linalg.inv(m) for n, m in zip(names, ibm)}
    name_of = {j: n for n, j in zip(names, joints)}
    parent = {n: name_of.get(p.get(j)) for n, j in zip(names, joints)}
    return world, parent


def from_nodes(g):
    names, _, joints = g.skin()
    p = g.parents()
    world = {n: g.world(j, p) for n, j in zip(names, joints)}
    name_of = {j: n for n, j in zip(names, joints)}
    parent = {n: name_of.get(p.get(j)) for n, j in zip(names, joints)}
    return world, parent


def from_driver(g):
    """The legacy driver is meshopt-compressed: only its node graph is read (the viewer binds to these rests)."""
    names, joints = g.joints()
    p = g.parents()
    world = {n: g.world(j, p) for n, j in zip(names, joints)}
    name_of = {j: n for n, j in zip(names, joints)}
    parent = {n: name_of.get(p.get(j)) for n, j in zip(names, joints)}
    return world, parent


def quat_m(x, y, z, w):
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def from_uskeleton(path):
    d = json.load(open(path, encoding='utf8'))
    sk = next(o for o in d if o.get('Type') == 'Skeleton')['ReferenceSkeleton']
    info, pose = sk['FinalRefBoneInfo'], sk['FinalRefBonePose']
    local, parent = {}, {}
    for b, t in zip(info, pose):
        r, p = t['Rotation'], t['Translation']
        L = np.eye(4)
        L[:3, :3] = quat_m(-r['X'], r['Y'], -r['Z'], r['W'])
        L[:3, 3] = [p['X'] / 100, -p['Y'] / 100, p['Z'] / 100]
        local[b['Name']] = L
        parent[b['Name']] = info[b['ParentIndex']]['Name'] if b['ParentIndex'] >= 0 else None
    return local, parent


def to_local(world, parent):
    return {n: (np.linalg.inv(world[parent[n]]) @ world[n] if parent.get(n) in world else world[n]) for n in world}


def describe(L):
    return {'pos_cm': [round(float(v) * 100, 3) for v in L[:3, 3]], 'rot_deg_from_identity': round(rot_deg(L), 3)}


def delta(La, Lb):
    """Lb relative to La, both local to the same parent: position difference (cm) and rotation angle (deg)."""
    D = np.linalg.inv(La) @ Lb
    return {'dpos_cm': round(float(np.linalg.norm(Lb[:3, 3] - La[:3, 3])) * 100, 3), 'drot_deg': round(rot_deg(D), 3),
            'axis_in_parent': [round(float(v), 3) for v in (La[:3, :3] @ rot_axis(D))]}


src = {}
body = Glb(M / 'reconstructed-meshes-v2/SK_Body_M.glb')
w, p = from_ibm(body); src['body_ibm'] = (to_local(w, p), p, w)
w, p = from_nodes(body); src['body_nodes'] = (to_local(w, p), p, w)
drv = Glb(M / 'body/SK_Body_M.glb', nodes_only=True)
w, p = from_driver(drv); src['driver_nodes'] = (to_local(w, p), p, w)
light = Glb((M / 'reconstructed-assemblies-v1' / A['meshes'][A['archetypes']['light']['body']]['url']).resolve())
w, p = from_ibm(light); src['light_body_ibm'] = (to_local(w, p), p, w)
coat = Glb(M / 'reconstructed-meshes-v2/SK_Casual_LongCoat_M.glb')
w, p = from_ibm(coat); src['longcoat_ibm'] = (to_local(w, p), p, w)
w, p = from_nodes(coat); src['longcoat_nodes'] = (to_local(w, p), p, w)
for tag, f in (('uskel_body_m', DUMP / 'Body/SK_Body_M_Skeleton.json'),
               ('uskel_mergetarget', DUMP / 'Avatar/MeshMerge/SK_CharacterMeshMergeTarget_Skeleton.json')):
    loc, par = from_uskeleton(f)
    src[tag] = (loc, par, None)

out = {'parents': {j: src['body_ibm'][1].get(j) for j in JOINTS}, 'local': {}, 'vs_body_ibm': {}, 'world_vs_body_ibm': {}}
for j in JOINTS:
    out['local'][j] = {k: describe(v[0][j]) for k, v in src.items() if j in v[0]}
    ref = src['body_ibm'][0][j]
    out['vs_body_ibm'][j] = {k: delta(ref, v[0][j]) for k, v in src.items() if j in v[0] and k != 'body_ibm'
                             and v[1].get(j) == src['body_ibm'][1].get(j)}
    rw = src['body_ibm'][2][j]
    out['world_vs_body_ibm'][j] = {k: {'dpos_cm': round(float(np.linalg.norm(v[2][j][:3, 3] - rw[:3, 3])) * 100, 3),
                                       'drot_deg': round(rot_deg(np.linalg.inv(rw) @ v[2][j]), 3)}
                                   for k, v in src.items() if v[2] is not None and j in v[2] and k != 'body_ibm'}
# The viewer's driver vs the body bind over every shared bone: is the driver the same skeleton?
shared = [n for n in src['body_ibm'][2] if n in src['driver_nodes'][2]]
dd = sorted(((n, float(np.linalg.norm(src['driver_nodes'][2][n][:3, 3] - src['body_ibm'][2][n][:3, 3])) * 100,
              rot_deg(np.linalg.inv(src['body_ibm'][2][n]) @ src['driver_nodes'][2][n])) for n in shared),
            key=lambda r: -r[2])
out['driver_vs_body_ibm_all'] = {'bones': len(shared), 'worst_rot': [(n, round(c, 3), round(d, 3)) for n, c, d in dd[:12]],
                                 'max_cm': round(max(r[1] for r in dd), 3)}
json.dump(out, open(sys.argv[1], 'w', encoding='utf8'), indent=1)
for j in JOINTS:
    print('==', j, 'parent', out['parents'][j])
    for k, v in out['local'][j].items():
        print(f'   {k:18s} local {v}')
    for k, v in out['vs_body_ibm'][j].items():
        print(f'   vs body_ibm {k:18s} {v}')
print('driver vs body ibm:', out['driver_vs_body_ibm_all'])
