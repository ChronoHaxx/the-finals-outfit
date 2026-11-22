"""Surface-match proof (Season 12 item refresh, tier 2, 22 Nov 2026): for a refused mesh whose SURFACE differs from its
Season 12 rebuild, is that only a vertex re-order, and if not, do the live textures still fit the new surface?

skin-by-name-proof.py stops at "surface differs" when positions, UVs or indices are not equal array for array. Two very
different things produce that:

1. **Permuted**: Season 12 re-exported the same triangles in another vertex order (a re-import shuffles the vertex
   buffer). Every vertex keeps its position, UVs and material; only the indices change. The rig and every derived
   artefact keyed on the surface (the body mask projection, material bindings) see the same mesh. After mapping S12
   vertices onto live ones, the tier-1 checks apply unchanged: normals, weights by joint name, morph names and deltas,
   extension binds, loader constraints. Class "permuted" plus the tier-1 kinds; "permuted" alone = re-encoded.
2. **Reworked**: the geometry really changed. Then two questions decide the route:
   - geometry: how far each S12 vertex lies from the live surface (and back), in cm;
   - texture fit: at the closest live surface point, does the live UV0 equal the S12 UV0? If nearly every vertex
     agrees within a couple of texels, the live material (textures authored for the live UVs) still maps onto the S12
     mesh, and only the geometry-derived artefacts (body mask, item masks) need a re-run. If not, S12 re-unwrapped the
     garment and its S12 textures are needed (a fresh texture read).

Vertex identity for the permutation: POSITION and every TEXCOORD_n, quantised to QUANT (both files come from the same
builder, so unchanged vertices are bit-equal). Triangles are compared as multisets of key triples per material,
rotated to a canonical start, so winding must match. Duplicate keys (hard-edge splits) are paired by normal.

  python -I scripts/body-types/surface-match-proof.py ACTIVE_ASSETS_JSON SKIN_PROOF_JSON REBUILT_DIR DRIVER_BODY_GLB \
      OUT_JSON [--only NAME,NAME...]

SKIN_PROOF_JSON is skin-by-name-proof.py output on the same index; its "surface differs" rows are judged. Read-only on
every input; refuses an existing output.
"""
import hashlib
import importlib.util
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('skin_by_name_proof', HERE / 'skin-by-name-proof.py')
skin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skin)

QUANT = 1e-6            # metres / UV units: keys are bit-equal for an unchanged vertex
TEXELS = 2048.0         # UV error is reported in texels of a 2048 map (the common garment size)
FIT_TEXELS = 2.0        # a vertex "fits" when its live UV0 at the closest point is within 2 texels
FIT_CM = 0.1            # ... and it lies within 1 mm of the live surface
FIT_SHARE = 0.995       # "same UVs" when at least this share of S12 vertices fit
COMPARE_CM = 2.0        # UVs are compared only where the S12 vertex lies within 2 cm of the live surface
COMPARE_SHARE = 0.9     # ... and only when that holds for 90% of S12 vertices (else: moved too far to judge)
CANDIDATES = 24         # nearest live triangles (by centroid) tried per S12 vertex


# ------------------------------------------------------------------------------------------------ pools
class Pools:
    """The file's vertices as one table: primitives with the same attribute accessors share a pool."""

    def __init__(self, glb):
        self.glb = glb
        prims = glb.mesh['primitives']
        self.offset, self.prim_pool, keys, count = {}, [], [], 0
        for p in prims:
            key = tuple(sorted(p['attributes'].items()))
            if key not in self.offset:
                self.offset[key] = count
                keys.append(key)
                count += glb.doc['accessors'][p['attributes']['POSITION']]['count']
            self.prim_pool.append(self.offset[key])
        self.count, self.keys = count, keys
        self.prims = prims

    def attribute(self, name, normalise=False):
        """Pool-wide array for one attribute, or None when any pool lacks it."""
        parts = []
        for key in self.keys:
            attrs = dict(key)
            if name not in attrs:
                return None
            parts.append(self.glb.acc(attrs[name], normalise=normalise))
        return np.concatenate(parts)

    def names(self):
        sets = [set(dict(k)) for k in self.keys]
        return set.intersection(*sets) if sets else set()

    def triangles(self):
        """(material index, pool-index triangles) per primitive."""
        out = []
        for p, off in zip(self.prims, self.prim_pool):
            idx = self.glb.acc(p['indices']).astype(np.int64).reshape(-1, 3) + off
            out.append((p.get('material'), idx))
        return out

    def morph(self, name):
        """Pool-wide POSITION delta of a morph by name, or None."""
        names = self.glb.mesh.get('extras', {}).get('targetNames', [])
        if name not in names:
            return None
        k = names.index(name)
        parts, done = [], set()
        for p, off in zip(self.prims, self.prim_pool):
            if off in done:
                continue
            done.add(off)
            parts.append(self.glb.acc(p['targets'][k]['POSITION']))
        return np.concatenate(parts)


def uv_names(names):
    return sorted(n for n in names if n.startswith('TEXCOORD_'))


def vertex_keys(pools, uvs):
    cols = [pools.attribute('POSITION')] + [pools.attribute(n) for n in uvs]
    q = np.round(np.concatenate(cols, 1) / QUANT).astype(np.int64)
    return [row.tobytes() for row in q]


def canonical(tri):
    """Rotate a triangle of key ids so the smallest id comes first (keeps winding)."""
    a, b, c = tri
    if a <= b and a <= c:
        return (a, b, c)
    if b <= a and b <= c:
        return (b, c, a)
    return (c, a, b)


# ------------------------------------------------------------------------------------------------ permutation
def permutation(live, new, materials_live, materials_new):
    """S12 pool index -> live pool index when both files hold the same triangles over the same vertices, else None
    with a reason."""
    ln, nn = live.names(), new.names()
    if uv_names(ln) != uv_names(nn):
        return None, f'UV sets differ: {uv_names(ln)} vs {uv_names(nn)}'
    if live.count != new.count:
        return None, f'vertex count {live.count} vs {new.count}'
    uvs = uv_names(ln)
    kl, kn = vertex_keys(live, uvs), vertex_keys(new, uvs)
    if Counter(kl) != Counter(kn):
        return None, 'vertex positions/UVs differ as a set'
    ids = {k: i for i, k in enumerate(dict.fromkeys(kl))}
    il, in_ = np.array([ids[k] for k in kl]), np.array([ids[k] for k in kn])

    def tri_set(pools, key_id, mats):
        c = Counter()
        for m, tris in pools.triangles():
            for t in key_id[tris]:
                c[(mats[m] if m is not None else None, canonical(tuple(int(x) for x in t)))] += 1
        return c
    if tri_set(live, il, materials_live) != tri_set(new, in_, materials_new):
        return None, 'triangles differ (same vertices, other connectivity or material)'
    # Pair vertices key by key; duplicates (hard-edge splits) by normal direction.
    nl, nnorm = live.attribute('NORMAL'), new.attribute('NORMAL')
    groups_l, groups_n = defaultdict(list), defaultdict(list)
    for i, k in enumerate(il):
        groups_l[k].append(i)
    for i, k in enumerate(in_):
        groups_n[k].append(i)
    perm = np.empty(new.count, np.int64)
    for k, ns in groups_n.items():
        ls = groups_l[k]
        if len(ns) == 1:
            perm[ns[0]] = ls[0]
            continue
        free = list(ls)
        for i in ns:
            if nl is None or nnorm is None:
                j = free.pop(0)
            else:
                d = [float(np.dot(nl[f, :3], nnorm[i, :3])) for f in free]
                j = free.pop(int(np.argmax(d)))
            perm[i] = j
    return perm, None


def mapped_compare(live, new, perm, driver):
    """skin-by-name-proof's tier-1 checks on S12 data re-ordered into live vertex order."""
    inv = np.empty_like(perm)
    inv[perm] = np.arange(len(perm))         # live index -> S12 index
    kinds, loader, detail = [], [], {}
    ln_, nn_ = live.names(), new.names()
    if ln_ != nn_:
        extra = ln_ ^ nn_
        (loader if extra <= {'JOINTS_1', 'WEIGHTS_1', 'JOINTS_2', 'WEIGHTS_2'} else kinds).append(
            f'attribute sets differ: {sorted(extra)}')
    # Colours compared through the mapping (materials may read them).
    for name in sorted(n for n in ln_ & nn_ if n.startswith('COLOR_')):
        a, b = live.attribute(name, normalise=True), new.attribute(name, normalise=True)[inv]
        if a.shape != b.shape or np.abs(a - b).max(initial=0) > 1.5 / 255:
            kinds.append('vertex colour')
            detail['colourMaxSteps'] = round(float(np.abs(a - b).max(initial=0)) * 255, 2) if a.shape == b.shape else None
    normal_deg = tangent_deg = 0.0
    flips = 0
    if 'NORMAL' in ln_ & nn_:
        normal_deg = float(skin.angles(live.attribute('NORMAL'), new.attribute('NORMAL')[inv]).max(initial=0))
    if 'TANGENT' in ln_ & nn_:
        a, b = live.attribute('TANGENT'), new.attribute('TANGENT')[inv]
        tangent_deg = float(skin.angles(a, b).max(initial=0))
        flips = int((np.sign(a[:, 3]) != np.sign(b[:, 3])).sum())
    detail.update(normalMaxDeg=round(normal_deg, 3), tangentMaxDeg=round(tangent_deg, 3), tangentSignFlips=flips)
    if normal_deg > skin.NORMAL_DEG or tangent_deg > skin.NORMAL_DEG or flips:
        kinds.append('normals')
    ln = live.glb.mesh.get('extras', {}).get('targetNames', [])
    nn = new.glb.mesh.get('extras', {}).get('targetNames', [])
    if set(ln) != set(nn):
        kinds.append('morph set')
        detail['morphsAdded'], detail['morphsRemoved'] = sorted(set(nn) - set(ln)), sorted(set(ln) - set(nn))
        detail['morphsRemovedMaxCm'] = {m: round(float(np.linalg.norm(live.morph(m), axis=1).max(initial=0)) * 100, 3)
                                        for m in detail['morphsRemoved']}
    changed = {}
    for name in sorted(set(ln) & set(nn)):
        d = np.linalg.norm(live.morph(name) - new.morph(name)[inv], axis=1)
        if d.max(initial=0) > skin.TOL:
            changed[name] = {'maxCm': round(float(d.max()) * 100, 3), 'verticesChanged': int((d > skin.TOL).sum())}
    detail['morphsChanged'] = changed
    lg, ng = live.glb, new.glb
    ls, ns = lg.doc.get('skins', []), ng.doc.get('skins', [])
    if len(ls) != len(ns) or len(ns) > 1:
        loader.append('skin count differs or several skins')
    elif ns:
        lnames = [lg.node(j).get('name') for j in ls[0]['joints']]
        nnames = [ng.node(j).get('name') for j in ns[0]['joints']]
        detail.update(jointsLive=len(lnames), jointsS12=len(nnames))
        sets_l = [skin.influence_sets(dict(k)) for k in live.keys]
        sets_n = [skin.influence_sets(dict(k)) for k in new.keys]
        if len({tuple(s) for s in sets_l + sets_n}) != 1:
            loader.append('influence layout differs between primitives or files')
        if any('JOINTS_2' in dict(k) for k in new.keys):
            loader.append('JOINTS_2 (SourceMesh.ts throws)')
        bad = skin.unresolvable(ng, driver)
        if bad:
            loader.append(f'rebind throws (no driver ancestor): {bad[:5]}')
        if not loader:
            union = {n: i for i, n in enumerate(sorted(set(lnames) | set(nnames)))}

            def dense(pools, names):
                return np.concatenate([skin.weights_by_name(pools.glb, dict(k), names, union) for k in pools.keys])
            wl, wn = dense(live, lnames), dense(new, nnames)[inv]
            l1 = np.abs(wl - wn).sum(1) * 255
            sums = np.abs(wl.sum(1) - wn.sum(1)) * 255
            detail.update(weightMaxSteps=round(float(l1.max(initial=0)), 2),
                          verticesWeightMoved=int((l1 > skin.WEIGHT_STEPS).sum()),
                          weightSumMaxSteps=round(float(sums.max(initial=0)), 2))
            if l1.max(initial=0) > skin.WEIGHT_STEPS or sums.max(initial=0) > skin.SUM_STEPS:
                kinds.append('weights')
            weighted = {n for n, i in union.items() if wn[:, i].any()}
            libm = dict(zip(lnames, lg.acc(ls[0]['inverseBindMatrices'])))
            nibm = dict(zip(nnames, ng.acc(ns[0]['inverseBindMatrices'])))
            extension = sorted(n for n in weighted if n not in driver)
            moved = {n: round(float(np.abs(libm[n] - nibm[n]).max()), 6) for n in extension
                     if n in libm and np.abs(libm[n] - nibm[n]).max() > skin.IBM_TOL}
            added = [n for n in extension if n not in libm]
            detail.update(weightedExtensionBones=extension)
            if moved or added:
                kinds.append('extension bones')
                detail.update(extensionBindsMoved=moved, extensionBonesAdded=added)
    if loader:
        return {'class': 'loader refuses', 'loader': loader, **detail}
    return {'class': '+'.join(['permuted'] + kinds), **detail}


# ------------------------------------------------------------------------------------------------ rework metrics
def closest_on_triangles(p, a, b, c):
    """Closest points on triangles (a,b,c) to points p (all (n,3)); returns distance and barycentrics (n,3)."""
    ab, ac, ap = b - a, c - a, p - a
    n = np.cross(ab, ac)
    nn = (n * n).sum(1)
    safe = np.where(nn > 1e-30, nn, 1.0)
    # Interior projection.
    w_b = (np.cross(ap, ac) * n).sum(1) / safe
    w_c = (np.cross(ab, ap) * n).sum(1) / safe
    w_a = 1 - w_b - w_c
    inside = (nn > 1e-30) & (w_a >= 0) & (w_b >= 0) & (w_c >= 0)
    proj = a + w_b[:, None] * ab + w_c[:, None] * ac
    best = np.where(inside, np.linalg.norm(p - proj, axis=1), np.inf)
    bary = np.stack([w_a, w_b, w_c], 1)

    def edge(u, v, iu, iv):
        nonlocal best, bary
        uv = v - u
        L = (uv * uv).sum(1)
        t = np.clip(((p - u) * uv).sum(1) / np.where(L > 1e-30, L, 1.0), 0, 1)
        q = u + t[:, None] * uv
        d = np.linalg.norm(p - q, axis=1)
        take = d < best
        nb = np.zeros_like(bary)
        nb[:, iu], nb[:, iv] = 1 - t, t
        best = np.where(take, d, best)
        bary = np.where(take[:, None], nb, bary)
    edge(a, b, 0, 1)
    edge(b, c, 1, 2)
    edge(c, a, 2, 0)
    return best, bary


TIE_M = 1e-5            # candidates within 0.01 mm of the closest one count as "at the same place"


def surface_distance(points, normals, tris_pos, tri_norm, tri_mat, mats, uv_tris=None, uv_target=None):
    """For each point: distance (m) to the closest same-material, normal-agreeing triangle; with uv_tris/uv_target also
    the smallest UV error (exact, and modulo whole tiles) among the triangles tied for closest.

    The tie matters at UV seams: a seam vertex lies on two islands at distance zero, and only one of them carries its UV.
    """
    cent = tris_pos.mean(1)
    tree = cKDTree(cent)
    k = min(CANDIDATES, len(cent))
    _, cand = tree.query(points, k=k)
    cand = cand.reshape(len(points), k)
    dist, bars = [], []
    for j in range(k):
        t = cand[:, j]
        d, bary = closest_on_triangles(points, tris_pos[t, 0], tris_pos[t, 1], tris_pos[t, 2])
        if normals is not None:
            agree = (tri_norm[t] * normals).sum(1)
            d = np.where(agree > 0.2, d, d + 1.0)      # wrong-facing shells (linings) lose against right-facing ones
        if mats is not None:
            d = np.where(tri_mat[t] == mats, d, d + 10.0)
        dist.append(d)
        bars.append(bary)
    dist = np.stack(dist, 1)
    best = dist.min(1)
    if uv_tris is None or uv_target is None:
        return best, None, None
    exact = np.full(len(points), np.inf)
    wrapped = np.full(len(points), np.inf)
    tie = dist <= (best + TIE_M)[:, None]
    for j in range(k):
        uv = (bars[j][:, :, None] * uv_tris[cand[:, j]]).sum(1)
        diff = uv_target - uv
        e = np.linalg.norm(diff, axis=1)
        w = np.linalg.norm(diff - np.round(diff), axis=1)
        exact = np.where(tie[:, j], np.minimum(exact, e), exact)
        wrapped = np.where(tie[:, j], np.minimum(wrapped, w), wrapped)
    return best, exact, wrapped


def flat(pools, materials):
    """Positions, per-vertex material name, triangle arrays of a file."""
    pos = pools.attribute('POSITION')
    tris, mats = [], []
    for m, t in pools.triangles():
        tris.append(t)
        mats.append(np.full(len(t), m if m is not None else -1))
    tris = np.concatenate(tris)
    mats = np.concatenate(mats)
    vmat = np.full(pools.count, -1)
    vmat[tris.ravel()] = np.repeat(mats, 3)
    names = np.array([materials[m] if m >= 0 else '' for m in range(-1, len(materials))], dtype=object)[mats + 1]
    vnames = np.array([materials[m] if m >= 0 else '' for m in vmat], dtype=object)
    return pos, tris, names, vnames


def face_normals(tp):
    n = np.cross(tp[:, 1] - tp[:, 0], tp[:, 2] - tp[:, 0])
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-20)


def rework_metrics(live, new, materials_live, materials_new):
    lpos, ltris, lmat, _ = flat(live, materials_live)
    npos, ntris, _, nvmat = flat(new, materials_new)
    # Map material names to small ints shared by both files.
    names = {n: i for i, n in enumerate(sorted({str(x) for x in materials_live + materials_new} | {'', 'None'}))}
    lmat = np.array([str(x) for x in lmat], dtype=object)
    nvmat = np.array([str(x) for x in nvmat], dtype=object)
    lmi = np.array([names[n] for n in lmat])
    nmi = np.array([names[n] for n in nvmat])
    ltp = lpos[ltris]
    lfn = face_normals(ltp)
    nnorm = new.attribute('NORMAL')
    nnorm = nnorm[:, :3] / (np.linalg.norm(nnorm[:, :3], axis=1, keepdims=True) + 1e-20) if nnorm is not None else None
    out = {'verticesLive': live.count, 'verticesS12': new.count, 'trianglesLive': int(len(ltris)),
           'trianglesS12': int(len(ntris))}
    d, _, _ = surface_distance(npos, nnorm, ltp, lfn, lmi, nmi)
    dcm = d * 100
    used = np.zeros(new.count, bool)
    used[ntris.ravel()] = True
    dcm = dcm[used]
    out['s12ToLiveCm'] = {q: round(float(np.percentile(dcm, p)), 3) for q, p in (('p50', 50), ('p95', 95), ('p99', 99))}
    out['s12ToLiveCm']['max'] = round(float(dcm.max(initial=0)), 3)
    out['wrongMaterialOrFacing'] = int((dcm >= 100).sum())
    # Reverse: live geometry the S12 mesh no longer covers.
    ntp = npos[ntris]
    nfn = face_normals(ntp)
    lnorm = live.attribute('NORMAL')
    lnorm = lnorm[:, :3] / (np.linalg.norm(lnorm[:, :3], axis=1, keepdims=True) + 1e-20) if lnorm is not None else None
    nmat_t = np.array([names[str(materials_new[m]) if m is not None else ''] for m, t in new.triangles() for _ in range(len(t))])
    _, _, _, lvmat = flat(live, materials_live)
    lvmi = np.array([names[str(n)] for n in lvmat])
    dr, _, _ = surface_distance(lpos, lnorm, ntp, nfn, nmat_t, lvmi)
    lused = np.zeros(live.count, bool)
    lused[ltris.ravel()] = True
    drcm = dr[lused] * 100
    out['liveToS12Cm'] = {q: round(float(np.percentile(drcm, p)), 3) for q, p in (('p50', 50), ('p95', 95), ('p99', 99))}
    out['liveToS12Cm']['max'] = round(float(drcm.max(initial=0)), 3)
    near = dcm <= COMPARE_CM
    out['nearShare'] = round(float(near.mean()), 5)
    out['within1mmShare'] = round(float((dcm <= FIT_CM).mean()), 5)
    for name in uv_names(live.names() & new.names()):
        ul, un = live.attribute(name), new.attribute(name)
        _, ex, wr = surface_distance(npos, nnorm, ltp, lfn, lmi, nmi, ul[ltris], un)
        ex, wr = ex[used] * TEXELS, wr[used] * TEXELS
        key = 'uv' + name[-1]
        # Fit is judged where the surface is still close (within COMPARE_CM); how far it moved is reported separately.
        out[key] = {'fitShare': round(float((ex[near] <= FIT_TEXELS).mean()) if near.any() else 0.0, 5),
                    'fitShareModTile': round(float((wr[near] <= FIT_TEXELS).mean()) if near.any() else 0.0, 5),
                    'tileShiftShare': round(float(((wr <= FIT_TEXELS) & (ex > FIT_TEXELS))[near].mean()) if near.any() else 0.0, 5),
                    'errorTexelsP99': round(float(np.percentile(ex[near], 99)) if near.any() else -1, 2)}
    out['uvSetsLive'], out['uvSetsS12'] = uv_names(live.names()), uv_names(new.names())
    out['colourSetsLive'] = sorted(n for n in live.names() if n.startswith('COLOR_'))
    out['colourSetsS12'] = sorted(n for n in new.names() if n.startswith('COLOR_'))
    return out


def rework_class(m):
    uv0 = m.get('uv0')
    if uv0 is None:
        return 'reworked: no UV0 to compare'
    if m['nearShare'] < COMPARE_SHARE:
        return 'reworked: geometry moved too far to judge UVs'
    geometry = m['s12ToLiveCm']['p99'] > FIT_CM or m['liveToS12Cm']['p99'] > FIT_CM
    tail = ', geometry moved' if geometry else ', geometry within 1 mm'
    if uv0['fitShare'] >= FIT_SHARE:
        return 'reworked: same UVs' + tail
    if uv0['fitShareModTile'] >= FIT_SHARE:
        return 'reworked: UV0 tile shifts only' + tail
    return 'reworked: UVs changed' + tail


# ------------------------------------------------------------------------------------------------ driver
def material_names(doc):
    return [m.get('name') for m in doc.get('materials', [])]


def material_slots(doc):
    """(material name, source slot name) per material: the index binds materials by slot name (assets.json slots)."""
    return [(m.get('name'), (m.get('extras', {}).get('sourceSlot') or {}).get('MaterialSlotName'))
            for m in doc.get('materials', [])]


def judge(live_path, new_path, driver):
    lg, ng = skin.Glb(live_path), skin.Glb(new_path)
    if len(lg.doc['meshes']) != 1 or len(ng.doc['meshes']) != 1:
        return {'class': 'not a single-mesh GLB'}
    live, new = Pools(lg), Pools(ng)
    ml, mn = material_names(lg.doc), material_names(ng.doc)
    sl, sn = material_slots(lg.doc), material_slots(ng.doc)
    out = {}
    if sorted(set(ml)) != sorted(set(mn)):
        out['materialsLive'], out['materialsS12'] = ml, mn
    if sorted(set(sl), key=str) != sorted(set(sn), key=str):
        # 22 Nov 2026: S12 split SK_Military_CombatPants_M's cloth section into a new slot "CombatPants_Cloth" (same MI);
        # the index has no binding for it, so the viewer throws "Missing source material slot".
        out['slotsLive'], out['slotsS12'] = sl, sn
    perm, reason = permutation(live, new, ml, mn)
    if perm is not None:
        result = mapped_compare(live, new, perm, driver)
        if 'materialsLive' in out:
            result['class'] += '+material names'
        if 'slotsLive' in out:
            result['class'] += '+material slots'
        elif permutation(live, new, sl, sn)[0] is None:
            # Same slot names, but triangles moved between slots.
            result['class'] += '+material slots'
            out['slotsNote'] = 'triangles moved between slots'
        return {**out, **result}
    metrics = rework_metrics(live, new, ml, mn)
    cls = rework_class(metrics)
    if 'materialsLive' in out:
        cls += '; material names differ'
    if 'slotsLive' in out:
        cls += '; material slots differ'
    return {**out, 'class': cls, 'notPermuted': reason, **metrics}


def main(assets_json, skin_proof_json, rebuilt_dir, driver_glb, out_json, only=None):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    base = Path(assets_json).parent
    rows = json.loads(Path(skin_proof_json).read_text(encoding='utf-8'))['meshes']
    driver_doc = skin.Glb(driver_glb).doc
    driver = {driver_doc['nodes'][j].get('name') for j in driver_doc['skins'][0]['joints']}
    report = {}
    for name, row in sorted(rows.items()):
        if row.get('class') != 'surface differs' or (only and name not in only):
            continue
        live, new = base / row['liveUrl'], Path(rebuilt_dir) / f'{name}.glb'
        try:
            result = judge(live, new, driver)
        except Exception as e:   # one bad file must not hide the other verdicts
            result = {'class': 'error', 'error': f'{type(e).__name__}: {e}'}
        report[name] = {'source': row['source'], 'liveUrl': row['liveUrl'], 'liveSha256': row['liveSha256'],
                        's12Sha256': hashlib.sha256(new.read_bytes()).hexdigest(), **result,
                        'admissible': result['class'] == 'permuted'}
        print(f"{name:48s} {result['class']}", flush=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'driver': Path(driver_glb).as_posix(), 'quant': QUANT, 'texels': TEXELS,
                               'fit': {'texels': FIT_TEXELS, 'cm': FIT_CM, 'share': FIT_SHARE}, 'meshes': report},
                              indent=1) + '\n', encoding='utf-8')
    counts = Counter(r['class'].split(';')[0].split(',')[0] for r in report.values())
    print(json.dumps({'judged': len(report), **dict(sorted(counts.items())), 'out': str(out)}))


if __name__ == '__main__':
    argv = sys.argv[1:]
    only = None
    if '--only' in argv:
        i = argv.index('--only')
        only = set(argv[i + 1].split(','))
        del argv[i:i + 2]
    main(*argv[:5], only=only)
