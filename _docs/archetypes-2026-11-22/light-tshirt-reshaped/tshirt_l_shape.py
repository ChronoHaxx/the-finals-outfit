"""Read-only (26 Nov 2026): where and how SK_Casual_BasicTshirt_L differs from x0.85 of the live Medium (47ccc034)."""
import importlib.util, json, struct
import numpy as np

import pathlib
R = pathlib.Path(__file__).resolve().parents[3].as_posix() + "/"  # repo root: run from the main checkout
WT = R
spec = importlib.util.spec_from_file_location("b", WT + "scripts/archetypes/build-archetype-index.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

med = R + "public/models/s12-bodytype-refresh-v1/meshes/SK_Casual_BasicTshirt_M.glb"
lig = R + "scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Casual_BasicTshirt_L.glb"
body = R + "public/models/reconstructed-meshes-v2/SK_Body_M.glb"
S = 0.85

with open(body, "rb") as f:
    f.read(12)
    n, _ = struct.unpack("<II", f.read(8))
    bj = json.loads(f.read(n))
body_bones = {bj["nodes"][i].get("name") for s in bj.get("skins", []) for i in s["joints"]}

M, L = b.mesh_data(med), b.mesh_data(lig)
dm, dl = b.skin_detail(med), b.skin_detail(lig)
pm, pl = M["prims"][0], L["prims"][0]
km = {tuple(np.round(pm["uvs"][0][v], 6).tolist()): v for v in range(len(pm["pos"]))}
perm = np.array([km[tuple(np.round(pl["uvs"][0][v], 6).tolist())] for v in range(len(pl["pos"]))])
assert len(set(perm.tolist())) == len(perm), "UV0 is not a bijection"
off = np.linalg.norm(pl["pos"] - S * pm["pos"][perm], axis=1)
print("vertices", len(off), "| offset mm: max %.3f, median %.4f" % (off.max() * 1000, np.median(off) * 1000))
for t in (1e-5, 1e-4, 5e-4, 1e-3, 2e-3):
    print(f"  > {t*1000:g} mm: {(off > t).sum()}")
y = pm["pos"][perm][:, 1]  # glTF Y up, Medium bind
print("Medium bind height range of the shirt: %.3f .. %.3f m" % (y.min(), y.max()))
moved = off > 1e-3
if moved.any():
    print("vertices moved > 1 mm sit at Medium heights %.3f .. %.3f m" % (y[moved].min(), y[moved].max()))
    hist = np.histogram(y[moved], bins=8, range=(y.min(), y.max()))
    print("  per height band (low to high):", hist[0].tolist())
    d = (pl["pos"] - S * pm["pos"][perm])[moved]
    print("  mean displacement of those (x, y, z) mm:", np.round(d.mean(0) * 1000, 3).tolist())
nl, nm = dl["prims"][0]["normals"], dm["prims"][0]["normals"][perm]
print("normals max component diff %.5f, vertices with any diff > 1e-3: %d" % (np.abs(nl - nm).max(), (np.abs(nl - nm).max(1) > 1e-3).sum()))
uv1 = np.abs(pl["uvs"][1] - pm["uvs"][1][perm]).max() if len(pl["uvs"]) > 1 else None
print("UV1 max diff", uv1)


def byname(d):
    p, jn, out = d["prims"][0], d["jointNames"], []
    for v in range(len(p["joints"][0])):
        e = {}
        for J, W in zip(p["joints"], p["weights"]):
            for j, w in zip(J[v], W[v]):
                if w:
                    e[jn[j]] = e.get(jn[j], 0) + int(w)
        out.append(e)
    return out


wl, wm = byname(dl), byname(dm)
wm = [wm[j] for j in perm]
diff = [v for v in range(len(wl)) if wl[v] != wm[v]]
print("weights differ by name on", len(diff), "of", len(wl))
maxdw = max(max(abs(wl[v].get(k, 0) - wm[v].get(k, 0)) for k in set(wl[v]) | set(wm[v])) for v in diff) if diff else 0
print("  largest single-joint weight change %.3f" % (maxdw / 65535))
setl, setm = set().union(*wl), set().union(*wm)
print("weighted joints L", len(setl), "M", len(setm), "| only L", sorted(setl - setm), "| only M", sorted(setm - setl))
print("weighted joints of L that are not body bones:", sorted(setl - body_bones))
jl, jm = L["joints"], M["joints"]
common = set(jl) & set(jm)
res = max(float(np.linalg.norm(jl[n] - S * jm[n])) for n in common)
print("joint lists L", len(jl), "M", len(jm), "| proof 4 residual over shared joints %.2e m" % res)
print("L morph targets:", pl["targets"])
print("M morph targets:", pm["targets"])
print("slots L", [p["slot"] for p in L["prims"]], "M", [p["slot"] for p in M["prims"]],
      "| materials equal:", [p["material"] for p in L["prims"]] == [p["material"] for p in M["prims"]])
print("source", L["source"])
