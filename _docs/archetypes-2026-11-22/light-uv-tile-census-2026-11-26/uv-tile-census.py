"""Read-only census (26 Nov 2026): Light and Heavy class meshes that fail proof 3' only because UV0 islands sit whole
tiles away from their Medium sibling's (the SK_Sneakers_L pattern), with everything else exactly the Medium's.

Runs the archetype builder as a dry run (it writes only --out) and records every proof 3' attempt: the exact Medium and
class GLBs the builder pairs. Each attempt refused with "no vertex bijection on UV0" is then re-paired without UV0 as
the key, and judged:
  pairing   class vertex -> Medium vertex by class-scaled position (within the 3' 1e-5 m); vertices sharing a position
            (seams) are assigned by UV0 modulo whole tiles, then UV1, then normal; it must be a bijection;
  UV0       per vertex an integer tile shift, with a residual within one stored fp16 step at that magnitude
            (2^(floor(log2 max(|u_class|, |u_medium|)) - 10)): the game stores UVs as half floats, so the same
            authored coordinate 4 tiles away rounds on a coarser grid;
  islands   no triangle's vertices carry different shifts (so every island moves as one, and a tile edge never runs
            inside a triangle); the count of shifted islands is recorded;
  the rest  as proof 3': UV1 within 1/1024 (stricter than 3' 1/128), other UV sets 1e-6, normals, weights by joint name,
            triangles under the mapping (the 3' quad rule), weighted joints by name at the class scale, one-side joints
            body bones.
The census does not judge materials (which read the tile index or tile at non-integer rates): that is the rule's
material gate, applied to the candidates afterwards.

Usage (cwd = the main checkout, where the builder's default --models is):
  python -I _docs/archetypes-2026-11-22/light-uv-tile-census-2026-11-26/uv-tile-census.py <out dir> <builder flags without --out>
Writes <out dir>/uv-tile-census.tsv and uv-tile-census.json beside the dry run's own files.
"""
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

BUILDER = next(p / "scripts" / "archetypes" / "build-archetype-index.py" for p in Path(__file__).resolve().parents
               if (p / "scripts" / "archetypes" / "build-archetype-index.py").is_file())
spec = importlib.util.spec_from_file_location("build_archetype_index", BUILDER)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

UV1_TOLERANCE = 1 / 1024


def fp16_step(u):
    """The spacing of half floats around |u| (normal range): 2^(floor(log2|u|) - 10). 2^-24 below the normal range."""
    a = np.abs(np.asarray(u, dtype=np.float64))
    out = np.full(a.shape, 2.0 ** -24)
    normal = a >= 2.0 ** -14
    out[normal] = np.exp2(np.floor(np.log2(a[normal])) - 10)
    return out


def pair_by_position(med_scaled, cls_pos, uv_m, uv_c, uv1_m, uv1_c, n_m, n_c, radius):
    """Class vertex -> Medium vertex, or (None, reason). Each co-located cluster is assigned by the smallest UV0
    residual modulo whole tiles, then UV1, then normal (a minimum-cost assignment within the cluster)."""
    tree = cKDTree(med_scaled)
    near = tree.query_ball_point(cls_pos, r=radius)
    if any(not c for c in near):
        return None, "a class vertex has no Medium vertex at its class-scaled position"
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for v, cands in enumerate(near):
        for m in cands:
            parent[find(("c", v))] = find(("m", m))
    clusters = {}
    for v, cands in enumerate(near):
        clusters.setdefault(find(("c", v)), (set(), set()))[0].add(v)
        for m in cands:
            clusters[find(("c", v))][1].add(m)
    perm = np.full(len(cls_pos), -1, dtype=np.int64)
    for cs, ms in clusters.values():
        cs, ms = sorted(cs), sorted(ms)
        if len(cs) != len(ms):
            return None, "co-located vertices differ in number"
        if len(cs) == 1:
            perm[cs[0]] = ms[0]
            continue
        cost = np.full((len(cs), len(ms)), 1e18)
        for i, v in enumerate(cs):
            for j, m in enumerate(ms):
                if m in near[v]:
                    d = uv_c[v] - uv_m[m]
                    r = float(np.abs(d - np.rint(d)).max())
                    u1 = float(np.abs(uv1_c[v] - uv1_m[m]).max()) if uv1_c is not None else 0.0
                    nn = float(np.abs(n_c[v] - n_m[m]).max()) if n_c is not None else 0.0
                    cost[i, j] = r * 1e6 + u1 * 1e3 + nn
        rows, cols = linear_sum_assignment(cost)
        if cost[rows, cols].max() >= 1e18:
            return None, "co-located vertices cannot be paired one to one"
        for i, j in zip(rows, cols):
            perm[cs[i]] = ms[j]
    if len(set(perm.tolist())) != len(perm):
        return None, "the position pairing is not a bijection"
    return perm, None


def tile_shift(medium_path, cls_path, scale, body_bones):
    """(pattern?, first failure or None, detail) for one Medium/class pair: see the module docstring."""
    T = tool.SURFACE_PERMUTED
    a, c = tool.mesh_data(medium_path), tool.mesh_data(cls_path)
    da, dc = tool.skin_detail(medium_path), tool.skin_detail(cls_path)
    detail = {"vertices": 0, "verticesShifted": 0, "islandsShifted": 0, "shifts": Counter(), "residualMax": 0.0,
              "residualOverStepMax": 0.0, "straddling": 0, "uv1MaxDiff": 0.0, "positionMaxM": 0.0, "normalMax": 0.0,
              "flippedTriangles": 0, "triangles": 0, "quadGapMaxM": 0.0, "uvTilesMedium": set(), "uvTilesClass": set()}

    def done(why):
        detail["shifts"] = ";".join(f"{k}x{v}" for k, v in sorted(detail["shifts"].items()))
        detail["uvTilesMedium"], detail["uvTilesClass"] = sorted(detail["uvTilesMedium"]), sorted(detail["uvTilesClass"])
        return why is None, why, detail
    pa, pc = a["prims"], c["prims"]
    if len(pa) != len(pc) or any(len(x["pos"]) != len(y["pos"]) for x, y in zip(pa, pc)):
        return done("primitives or vertex counts differ")
    if [(x["slot"], x["material"]) for x in pa] != [(y["slot"], y["material"]) for y in pc]:
        return done("material slots differ")
    weighted_a, weighted_c = set(), set()
    for i, (x, y, nx, ny) in enumerate(zip(pa, pc, da["prims"], dc["prims"])):
        if not x["uvs"] or len(x["uvs"]) != len(y["uvs"]) or x["idx"] is None or y["idx"] is None:
            return done("UV sets or indices missing or differ in number")
        med_scaled = x["pos"] * scale
        uv1_m = x["uvs"][1] if len(x["uvs"]) > 1 else None
        uv1_c = y["uvs"][1] if len(y["uvs"]) > 1 else None
        perm, why = pair_by_position(med_scaled, y["pos"], x["uvs"][0], y["uvs"][0], uv1_m, uv1_c, nx["normals"],
                                     ny["normals"], T["positionM"])
        if why:
            return done(why)
        detail["vertices"] += len(perm)
        detail["positionMaxM"] = max(detail["positionMaxM"],
                                     float(np.linalg.norm(y["pos"] - med_scaled[perm], axis=1).max()))
        um, uc = x["uvs"][0][perm].astype(np.float64), y["uvs"][0].astype(np.float64)
        d = uc - um
        shift = np.rint(d).astype(np.int64)
        residual = np.abs(d - shift)
        step = fp16_step(np.maximum(np.abs(uc), np.abs(um)))
        detail["residualMax"] = max(detail["residualMax"], float(residual.max()))
        detail["residualOverStepMax"] = max(detail["residualOverStepMax"], float((residual / step).max()))
        detail["uvTilesMedium"] |= {tuple(t) for t in np.floor(um).astype(int).tolist()}
        detail["uvTilesClass"] |= {tuple(t) for t in np.floor(uc).astype(int).tolist()}
        moved = np.any(shift != 0, axis=1)
        detail["verticesShifted"] += int(moved.sum())
        detail["shifts"].update(f"{s[0]:+d},{s[1]:+d}" for s in shift[moved].tolist())
        tri = y["idx"].reshape(-1, 3).astype(np.int64)
        tri_shift = shift[tri]
        straddle = np.any(tri_shift != tri_shift[:, :1, :], axis=(1, 2))
        detail["straddling"] += int(straddle.sum())
        # Islands: triangles connected through shared class vertices; count those that moved.
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        n = len(perm)
        e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
        _, label = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)), directed=False)
        used = np.unique(tri)
        detail["islandsShifted"] += len(set(label[used[moved[used]]].tolist()))
        if (residual > step + 1e-12).any():
            return done("UV0 residual beyond one fp16 step at its magnitude")
        if straddle.any():
            return done("a triangle straddles two tile shifts")
        for k in range(1, len(x["uvs"])):
            dk = float(np.abs(y["uvs"][k] - x["uvs"][k][perm]).max())
            if k == 1:
                detail["uv1MaxDiff"] = max(detail["uv1MaxDiff"], dk)
            if dk > (UV1_TOLERANCE if k == 1 else T["uv"]):
                return done(f"UV{k} differs under the mapping (max {dk:.6f})")
        if detail["positionMaxM"] > T["positionM"]:
            return done("positions are not the class-scaled Medium's")
        if (nx["normals"] is None) != (ny["normals"] is None):
            return done("normals present on one side only")
        if nx["normals"] is not None:
            dn = float(np.abs(ny["normals"] - nx["normals"][perm]).max())
            detail["normalMax"] = max(detail["normalMax"], dn)
            if dn > T["normal"]:
                return done(f"normals differ under the mapping (max {dn:.6f})")
        wa, wc = tool._weights_by_name(da, i), tool._weights_by_name(dc, i)
        if len(wa) != len(wc):
            return done("weights differ by joint name under the mapping")
        # Recorded, not stopped on: the spec keeps weights exact, but SK_Sneakers_L (the motivating row) differs by a
        # few u8 steps, so the census counts "the tile pattern, weights exact" and "the tile pattern, reweighted".
        for v, m in enumerate(perm):
            if wc[v] != wa[m]:
                detail["verticesReweighted"] = detail.get("verticesReweighted", 0) + 1
                worst = max(abs(wc[v].get(k, 0) - wa[m].get(k, 0)) for k in set(wc[v]) | set(wa[m]))
                detail["weightMaxU16"] = max(detail.get("weightMaxU16", 0), worst)
        for w in wa:
            weighted_a |= set(w)
        for w in wc:
            weighted_c |= set(w)
        tri_m = x["idx"].reshape(-1, 3).astype(np.int64)
        tri_c = perm[tri]
        cm = Counter(tool._rotation(t) for t in tri_m)
        cc = Counter(tool._rotation(t) for t in tri_c)
        only_c, only_m = list((cc - cm).elements()), list((cm - cc).elements())
        detail["triangles"] += len(tri_c)
        detail["flippedTriangles"] += len(only_c)
        if len(only_c) != len(only_m):
            return done("triangle counts under the mapping differ")
        if only_c:
            inverse = np.empty_like(perm)
            inverse[perm] = np.arange(len(perm))
            ok, why, gap, _ = tool._flipped_quads(only_c, only_m, x["pos"], y["pos"][inverse])
            detail["quadGapMaxM"] = max(detail["quadGapMaxM"], gap)
            if not ok:
                return done(why)
            if gap > T["quadGapM"]:
                return done("a flipped quad is not planar")
    if detail["triangles"] and detail["flippedTriangles"] / detail["triangles"] > T["flippedFraction"]:
        return done("too many triangles split the other way")
    if weighted_a != weighted_c:
        return done("weighted joints differ by name")
    ja, jc = a["joints"] or {}, c["joints"] or {}
    if [n for n in sorted(set(ja) ^ set(jc)) if n not in body_bones]:
        return done("joints listed on one side only are not body-skeleton bones")
    if any(n not in ja or n not in jc for n in weighted_a):
        return done("weighted joints missing from a skin")
    if max((float(np.linalg.norm(jc[n] - scale * ja[n])) for n in weighted_a), default=0.0) > tool.JOINT_TOLERANCE:
        return done("weighted joints are not at the class skeleton")
    if detail["verticesShifted"] == 0:
        return done("no tile shift: another UV0 difference")
    if detail.get("verticesReweighted"):
        detail["patternExceptWeights"] = True
        return done(f"weights differ by joint name under the mapping (max {detail['weightMaxU16'] / 257:.1f} u8 steps "
                    f"on {detail['verticesReweighted']} vertices)")
    return done(None)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = Path(sys.argv[1])
    attempts = []
    original = tool.surface_permuted

    def recording(medium_path, cls_path, scale, body_bones):
        result = original(medium_path, cls_path, scale, body_bones)
        attempts.append((Path(medium_path), Path(cls_path), scale, body_bones, result))
        return result
    tool.surface_permuted = recording
    sys.argv = ["build-archetype-index.py", "--out", str(out), *sys.argv[2:]]
    tool.main()
    rows = []
    for medium_path, cls_path, scale, body_bones, (ok, why, _detail) in attempts:
        if ok or why != "no vertex bijection on UV0":
            continue
        pattern, failure, detail = tile_shift(medium_path, cls_path, scale, body_bones)
        rows.append({"classMesh": cls_path.stem, "class": "light" if scale < 1 else "heavy", "medium": medium_path.stem,
                     "classFile": str(cls_path), "mediumFile": str(medium_path), "pattern": pattern,
                     "firstFailure": failure or "", **detail})
    cols = ["classMesh", "class", "medium", "pattern", "patternExceptWeights", "firstFailure", "vertices",
            "verticesShifted", "islandsShifted", "shifts", "residualMax", "residualOverStepMax", "straddling",
            "verticesReweighted", "weightMaxU16", "uv1MaxDiff", "positionMaxM", "normalMax", "flippedTriangles",
            "triangles", "uvTilesMedium", "uvTilesClass"]
    kind = lambda r: 0 if r["pattern"] else 1 if r.get("patternExceptWeights") else 2
    (out / "uv-tile-census.tsv").write_text("\t".join(cols) + "\n" + "".join(
        "\t".join(str(r.get(c, "")) for c in cols) + "\n"
        for r in sorted(rows, key=lambda r: (kind(r), r["class"], r["classMesh"]))), encoding="utf-8")
    (out / "uv-tile-census.json").write_text(json.dumps(rows, indent=1, default=str) + "\n", encoding="utf-8")
    total = Counter((r["class"], kind(r)) for r in rows)
    print(f"uv-tile census: {len(rows)} attempts refused on UV0;", "; ".join(
        f"{cls}: pattern {total[(cls, 0)]}, pattern but reweighted {total[(cls, 1)]}, other {total[(cls, 2)]}"
        for cls in ("light", "heavy")))
    print(Counter(r["firstFailure"].split(" (")[0] for r in rows if kind(r) == 2).most_common())


if __name__ == "__main__":
    main()
