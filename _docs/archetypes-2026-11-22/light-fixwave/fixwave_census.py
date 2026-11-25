"""Read-only (25 Nov 2026; input: the S12 tier-2 list light-fixwave-mediums.tsv, d25e25d): why does each fix-wave Medium fail proof 1' against the 18 Oct staged Medium?

Matches vertices by (position to 1e-5 m, UV0 modulo whole tiles to 1e-3), then compares triangles as sets and skin
weights by joint NAME (u16). Classifies each row:
  reordered        same vertices, triangles and skin by name; only order/joint list differs (a converter difference)
  reweighted       same vertices and triangles; skin by name differs (processing changed the weights)
  geometry         vertex/triangle sets differ (a different read, or processing changed the mesh)
"""
import csv, importlib.util, json, os, sys
from collections import Counter
import numpy as np

S = os.path.dirname(os.path.abspath(__file__))
WT = os.path.join(S, "..", "..", "..", "scripts", "archetypes", "build-archetype-index.py")
R = "E:/Coding/the-finals-outfit/"  # the main checkout: public/models and scripts/generated (as run on 25 Nov)
PM = R + "public/models/"
spec = importlib.util.spec_from_file_location("b", WT)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def load(path):
    j, bin_ = b.glb(path)
    skin = j["skins"][0] if j.get("skins") else None
    names = [j["nodes"][i].get("name") for i in skin["joints"]] if skin else []
    prims = []
    for m in j["meshes"]:
        for p in m["primitives"]:
            at = p["attributes"]
            pos = b.accessor(j, bin_, at["POSITION"]).astype(np.float64)
            uv = b.accessor(j, bin_, at["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in at else np.zeros((len(pos), 2))
            idx = b.accessor(j, bin_, p["indices"]).ravel().astype(np.int64)
            skinw = [dict() for _ in range(len(pos))]
            for key in sorted(k for k in at if k.startswith("JOINTS_")):
                jj = b.accessor(j, bin_, at[key]).astype(np.int64)
                wk = "WEIGHTS_" + key[7:]
                w = b.accessor(j, bin_, at[wk]).astype(np.float64)
                w /= {5121: 255.0, 5123: 65535.0}.get(j["accessors"][at[wk]]["componentType"], 1.0)
                for v in range(len(pos)):
                    for c in range(jj.shape[1]):
                        q = int(np.rint(w[v, c] * 65535))
                        if q:
                            n = names[jj[v, c]]
                            skinw[v][n] = skinw[v].get(n, 0) + q
            mat = j["materials"][p["material"]] if "material" in p else {}
            nrm = b.accessor(j, bin_, at["NORMAL"]).astype(np.float64) if "NORMAL" in at else np.zeros_like(pos)
            prims.append({"pos": pos, "uv": uv, "nrm": nrm, "idx": idx, "skin": skinw,
                          "slot": mat.get("extras", {}).get("sourceSlot", {}).get("MaterialSlotName")})
    return {"names": names, "prims": prims}


def keys(p):
    """Geometric vertex key: position (1e-5 m), UV0 modulo whole tiles (1e-3), normal (1e-2)."""
    pos = np.rint(p["pos"] / 1e-5).astype(np.int64)
    uv = p["uv"] - np.floor(p["uv"])
    uv = np.rint(uv / 1e-3).astype(np.int64) % 1000
    nrm = np.rint(p["nrm"] / 1e-2).astype(np.int64)
    return [tuple(a) + tuple(c) + tuple(n) for a, c, n in zip(pos.tolist(), uv.tolist(), nrm.tolist())]


def tri_keys(idx, ks):
    """Triangles as a multiset of key triples, winding kept, rotation normalised (order-free, duplicate-safe)."""
    out = Counter()
    for a, c, d in idx.reshape(-1, 3).tolist():
        t = (ks[a], ks[c], ks[d])
        out[min(t, t[1:] + t[:1], t[2:] + t[:2])] += 1
    return out


def compare(staged, live):
    A, B = load(staged), load(live)
    if len(A["prims"]) != len(B["prims"]):
        return "geometry", f"primitives {len(A['prims'])} vs {len(B['prims'])}"
    notes, verdict = [], "reordered"
    if [p["slot"] for p in A["prims"]] != [p["slot"] for p in B["prims"]]:
        notes.append("slot order differs")
    if A["names"] != B["names"]:
        notes.append("joint list differs" + ("" if set(A["names"]) == set(B["names"]) else
                                             f" (+{len(set(B['names']) - set(A['names']))} -{len(set(A['names']) - set(B['names']))} names)"))
    for i, (pa, pb) in enumerate(zip(A["prims"], B["prims"])):
        ka, kb = keys(pa), keys(pb)
        if len(ka) != len(kb):
            return "geometry", f"prim {i} vertices {len(ka)} vs {len(kb)}" + ("; " + "; ".join(notes) if notes else "")
        ca, cb = Counter(ka), Counter(kb)
        if ca != cb:
            miss = sum((ca - cb).values())
            return "geometry", f"prim {i} {miss}/{len(ka)} vertices have no match"
        if tri_keys(pa["idx"], ka) != tri_keys(pb["idx"], kb):
            return "geometry", f"prim {i} same vertices, triangles differ"
        if ka != kb:
            notes.append(f"prim {i} vertex order differs")
        sa = Counter((k, frozenset(s.items())) for k, s in zip(ka, pa["skin"]))
        sb = Counter((k, frozenset(s.items())) for k, s in zip(kb, pb["skin"]))
        if sa != sb:
            bad = sum((sa - sb).values())
            # Worst u16 step, per key (first occurrence on each side).
            fa = {k: s for k, s in zip(ka, pa["skin"])}
            fb = {k: s for k, s in zip(kb, pb["skin"])}
            worst = max(max((abs(fa[k].get(n, 0) - fb[k].get(n, 0)) for n in set(fa[k]) | set(fb[k])), default=0)
                        for k in fa)
            verdict = "reweighted"
            notes.append(f"prim {i} skin by name differs on {bad}/{len(ka)} vertices (max {worst} u16)")
    return verdict, "; ".join(notes)


def main():
    rows = list(csv.DictReader(open(os.path.join(S, "light-fixwave-mediums.tsv"), encoding="utf-8"), delimiter="\t"))
    rep = json.load(open(R + "scripts/generated/archetypes/bulk-v2-build/report.json", encoding="utf-8"))
    out = []
    for r in rows:
        v = rep["proof1Prime"][r["medium"]]
        staged = os.path.normpath(os.path.join(PM, v["stagedFile"]))
        live = os.path.normpath(os.path.join(PM, "reconstructed-assemblies-v1", v["liveUrl"]))
        lglb = os.path.join(os.path.dirname(staged), r["light"] + ".glb")
        try:
            verdict, note = compare(staged, live)
        except Exception as e:  # report, don't hide
            verdict, note = "error", repr(e)[:160]
        out.append({**r, "proof1Prime": v.get("differs"), "census": verdict, "note": note,
                    "stagedMedium": os.path.relpath(staged, R).replace("\\", "/"),
                    "stagedLight": os.path.relpath(lglb, R).replace("\\", "/") if os.path.exists(lglb) else ""})
        print(f"{r['light']:<38} {r['fixWave']:<26} p1:{v.get('differs')!s:<26} -> {verdict:<10} {note[:150]}", flush=True)
    json.dump(out, open(os.path.join(S, "census.json"), "w", encoding="utf-8"), indent=1)
    print(Counter((o["fixWave"], o["census"]) for o in out))


main()
