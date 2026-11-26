"""Knit clearance at rest from the installed game's own data only (current build, read-only extraction).

The balaclava is wrapped onto each face's _Wraps cage exactly as the viewer's HeadWrap.ts does (closest point on the
nearest proxy triangle plus a rigid offset in that triangle's frame; PR #75 showed the engine's own cloth binding
differs by <= ~0.3 mm). The head and cage take the fitting morphs the balaclava activates (default_ears) plus the
face's head_neck_match; the knit's own body-type morph (medium_male, Masculine) is toggled.

For each head vertex in the nose-tip region, a ray along the face's forward axis (+Y, Unreal) finds the nearest knit
crossing within 8 mm: positive = knit in front (covered), negative = skin in front of the knit (pokes through).
Units: Unreal centimetres in, millimetres out. Output: knit-clearance.txt.

Inputs are ShaderProbe `assets` extractions (read-only, pak files only) of SK_Head_<face>_Base, SK_Head_<face>_Base_Wraps
for HeadMaster and Faces 01, 10, 23, 30, 32, and SK_Streetwear_Balaclava_M, with the hand-patched 17 Nov mapping
(f36b7c4f); see README.md, "Reproduce".

  python -I knit-clearance.py <dumpDir1> [<dumpDir2> ...] --headwraps public/models/reconstructed-assemblies-v1/head-wraps.json
"""
import json, sys, numpy as np
from pathlib import Path

args = sys.argv[1:]
hw_path = args[args.index('--headwraps') + 1]
dirs = [Path(a) for a in args[:args.index('--headwraps')]]
def find(name):
    for d in dirs:
        f = d / f'{name}.mesh.json'
        if f.is_file(): return f
    raise FileNotFoundError(name)
def load(name):
    d = json.load(open(find(name), encoding='utf8')); l = d['lods'][0]
    P = np.asarray(l['positions'], float); N = np.asarray(l['normals'], float)[:, :3] if l.get('normals') else None
    M = {}
    for m in l.get('morphs') or []:
        D = np.zeros_like(P)
        for e in m['deltas']: D[e['vertex']] = e['position']
        M[m['name']] = D
    return P, N, np.asarray(l['indices'], int).reshape(-1, 3), M

hw = json.load(open(hw_path, encoding='utf8'))
src = '/Game/Discovery/Characters/Streetwear/Assets/Balaclava/SK_Streetwear_Balaclava_M.SK_Streetwear_Balaclava_M'
proxy = np.asarray(hw['meshes'][src]['triangles']).reshape(-1, 3)
REF, _, _, REFM = load('SK_Head_HeadMaster_Base_Wraps')
ref_pub = np.asarray(hw['reference']['positions']).reshape(-1, 3)
assert np.abs(REF[:, [0, 2, 1]] * 0.01 - ref_pub).max() < 1e-5, 'reference cage order differs'
KNIT, _, KTRI, KM = load('SK_Streetwear_Balaclava_M')

def frames(C):
    a, b, c = C[proxy[:, 0]], C[proxy[:, 1]], C[proxy[:, 2]]
    e1 = (b - a) / np.linalg.norm(b - a, axis=1)[:, None]
    n = np.cross(b - a, c - a); n /= np.linalg.norm(n, axis=1)[:, None]
    return a, b, c, e1, np.cross(n, e1), n

def closest_bary(p, a, b, c):  # Ericson 5.1.5, vectorised over triangles for one point
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - b; d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - c; d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    w = np.zeros((len(a), 3))
    with np.errstate(divide='ignore', invalid='ignore'):
        den = 1 / (va + vb + vc); v, ww = vb * den, vc * den
        w[:] = np.stack([1 - v - ww, v, ww], 1)
        m = (va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0); t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w[m] = np.stack([0 * t, 1 - t, t], 1)[m]
        m = (vb <= 0) & (d2 >= 0) & (d6 <= 0); t = d2 / (d2 - d6); w[m] = np.stack([1 - t, 0 * t, t], 1)[m]
        m = (d6 >= 0) & (d5 <= d6); w[m] = [0, 0, 1]
        m = (vc <= 0) & (d1 >= 0) & (d3 <= 0); t = d1 / (d1 - d3); w[m] = np.stack([1 - t, t, 0 * t], 1)[m]
        m = (d3 >= 0) & (d4 <= d3); w[m] = [0, 1, 0]
        m = (d1 <= 0) & (d2 <= 0); w[m] = [1, 0, 0]
    return w

def bind(P, C):
    a, b, c, e1, e2, n = frames(C); out = []
    for p in P:
        w = closest_bary(p, a, b, c)
        q = p - (w[:, :1] * a + w[:, 1:2] * b + w[:, 2:] * c); d = (q * q).sum(1); t = int(np.argmin(d))
        out.append((t, w[t], np.array([q[t] @ e1[t], q[t] @ e2[t], q[t] @ n[t]])))
    return out

def apply(binding, C):
    a, b, c, e1, e2, n = frames(C)
    return np.array([w[0] * a[t] + w[1] * b[t] + w[2] * c[t] + k[0] * e1[t] + k[1] * e2[t] + k[2] * n[t] for t, w, k in binding])

BIND = bind(KNIT, REF)
assert np.abs(apply(BIND, REF) - KNIT).max() < 1e-6

def clearance(head_pts, head_nrm, knit):
    A, B, C = knit[KTRI[:, 0]], knit[KTRI[:, 1]], knit[KTRI[:, 2]]
    e1, e2 = B - A, C - A; d = np.array([0, 1.0, 0])  # forward (+Y, Unreal)
    pv = np.cross(d, e2); det = (e1 * pv).sum(1); ok = np.abs(det) > 1e-12; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    out = np.full(len(head_pts), np.nan)
    for i, o in enumerate(head_pts):
        s = o - A; u = (s * pv).sum(1) * inv; q = np.cross(s, e1); v = (q @ d) * inv; t = (e2 * q).sum(1) * inv
        hit = ok & (u >= 0) & (u <= 1) & (v >= 0) & (u + v <= 1) & (np.abs(t) < 0.8)
        if hit.any(): out[i] = t[hit][np.argmin(np.abs(t[hit]))]
    return out * 10  # mm

faces = ['HeadMaster', 'Face_01', 'Face_10', 'Face_23', 'Face_30', 'Face_32']
print(f"{'face':11s} {'cage nose behind head nose (mm)':>32s} | {'knit, no body type':>22s} | {'knit, Masculine':>22s}")
for face in faces:
    H, HN, _, HM = load(f'SK_Head_{face}_Base')
    C, _, _, CM = load(f'SK_Head_{face}_Base_Wraps')
    head = H + sum(HM[m] for m in ('default_ears', 'head_neck_match') if m in HM)  # medium_male is zero on the face
    cage = C + sum(CM[m] for m in ('default_ears', 'head_neck_match') if m in CM)
    mid = np.abs(H[:, 0]) < 1.0; tip = np.where(mid)[0][np.argmax(H[mid, 1])]
    # the nose-tip region only (as the in-page probe): within 6 mm of the tip's forward reach, near the midline,
    # below the bridge; the eye-hole rim and the nostril insides give false crossings
    sel = (H[:, 1] > H[tip, 1] - 0.6) & (np.abs(H[:, 0]) < 3) & (H[:, 2] < H[tip, 2] + 0.4)
    base = apply(BIND, cage); cells = []
    for knit in (base, base + KM['medium_male']):
        cl = clearance(head[sel], None, knit); v = cl[~np.isnan(cl)]
        cells.append(f"{v.min():+6.2f} mm, {int((v < 0).sum()):3d}/{len(v):3d} through")
    print(f"{face:11s} {(head[tip, 1] - cage[77, 1]) * 10:32.2f} | {cells[0]:>22s} | {cells[1]:>22s}")
