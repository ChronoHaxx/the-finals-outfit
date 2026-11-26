"""For the capture's "own bind" comparison (26 Nov 2026): per garment mesh, the bind-space offset M_j = body_rest_j @ IBM_j
of every joint whose own bind differs from the body's (> 0.5 deg or 0.1 cm), row-major, for capture.mjs to apply in the
page as boneInverse_j' = boneInverse_j B M_j B^-1. The viewer then draws the garment as if it were skinned with its OWN
inverse binds (a leader-pose follower in UE), not the body's. Diagnostic only: page state, never the app's code or data.
Read-only.   python -X utf8 -I ownbind-offsets.py OUT_JSON SK_Name [SK_Name ...]
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glbskin import Glb, rot_deg  # noqa: E402

IDX = Path('E:/Coding/the-finals-outfit/public/models/reconstructed-assemblies-v1')
A = json.load(open(IDX / 'assets.json', encoding='utf8'))
rest = {k: np.array(v, dtype=np.float64).reshape(4, 4).T for k, v in A['attachmentBody']['restBones'].items()}
out = {}
for name in sys.argv[2:]:
    key = next(k for k in A['meshes'] if k.endswith(f'/{name}.{name}'))
    g = Glb((IDX / A['meshes'][key]['url']).resolve())
    names, ibm, _ = g.skin()
    joints = {}
    for i, n in enumerate(names):
        if n not in rest:
            continue
        M = rest[n] @ ibm[i]
        D = np.linalg.inv(rest[n]) @ np.linalg.inv(ibm[i])
        if rot_deg(D) > 0.5 or np.linalg.norm(M[:3, 3]) * 100 > 0.1 and rot_deg(D) > 0.05:
            joints[n] = {'rowMajor': [round(float(v), 9) for v in M.flatten()], 'deg': round(rot_deg(D), 3)}
    out[name] = {'sourceMesh': key, 'url': A['meshes'][key]['url'], 'joints': joints}
    print(name, A['meshes'][key]['url'], {n: j['deg'] for n, j in joints.items()})
json.dump(out, open(sys.argv[1], 'w', encoding='utf8'), indent=1)
