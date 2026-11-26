"""Read-only (26 Nov 2026): proof 3' quad rule on SK_Casual_BasicTshirt_L, at both binds, with its own positions."""
import importlib.util
from collections import Counter
import numpy as np
import pathlib
R = pathlib.Path(__file__).resolve().parents[3].as_posix() + "/"  # repo root: run from the main checkout
WT = R
spec = importlib.util.spec_from_file_location("b", WT + "scripts/archetypes/build-archetype-index.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
x = b.mesh_data(R + "public/models/s12-bodytype-refresh-v1/meshes/SK_Casual_BasicTshirt_M.glb")["prims"][0]
y = b.mesh_data(R + "scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Casual_BasicTshirt_L.glb")["prims"][0]
om = np.lexsort((x["uvs"][0][:, 1], x["uvs"][0][:, 0]))
oc = np.lexsort((y["uvs"][0][:, 1], y["uvs"][0][:, 0]))
perm = np.empty(len(oc), dtype=np.int64); perm[oc] = om
assert np.abs(y["uvs"][0] - x["uvs"][0][perm]).max() <= 1e-6
tri_m = x["idx"].reshape(-1, 3).astype(np.int64); tri_c = perm[y["idx"].reshape(-1, 3).astype(np.int64)]
cm = Counter(b._rotation(t) for t in tri_m); cc = Counter(b._rotation(t) for t in tri_c)
only_c, only_m = list((cc - cm).elements()), list((cm - cc).elements())
inverse = np.empty_like(perm); inverse[perm] = np.arange(len(perm))
ok, why, gap, quads = b._flipped_quads(only_c, only_m, x["pos"], y["pos"][inverse])
print("triangles", len(tri_c), "flipped", len(only_c), f"({len(only_c)/len(tri_c):.2%})", "quads", quads, "ok", ok, why,
      "max diagonal gap mm %.4f" % (gap * 1000))
_, _, gm, _ = b._flipped_quads(only_c, only_m, x["pos"], x["pos"])
_, _, gl, _ = b._flipped_quads(only_c, only_m, y["pos"][inverse], y["pos"][inverse])
print("gap at the Medium bind %.4f mm, at the Light bind %.4f mm" % (gm * 1000, gl * 1000))
verts = sorted({v for t in only_m for v in t})
print("flipped-quad vertices at Medium heights %.3f .. %.3f m" % (x["pos"][verts, 1].min(), x["pos"][verts, 1].max()))
