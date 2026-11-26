"""Read-only (26 Nov 2026): is SK_Casual_BasicTshirt_L the x0.85 of the pre-C0 Medium T-shirt (reconstructed-meshes-v2)?"""
import hashlib, importlib.util, json, struct

import pathlib
R = pathlib.Path(__file__).resolve().parents[3].as_posix() + "/"  # repo root: run from the main checkout
WT = R
spec = importlib.util.spec_from_file_location("b", WT + "scripts/archetypes/build-archetype-index.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def joint_names(p):
    with open(p, "rb") as f:
        f.read(12)
        n, _ = struct.unpack("<II", f.read(8))
        j = json.loads(f.read(n))
    return {j["nodes"][i].get("name") for s in j.get("skins", []) for i in s["joints"]}


old_m = R + "public/models/reconstructed-meshes-v2/SK_Casual_BasicTshirt_M.glb"
new_m = R + "public/models/s12-bodytype-refresh-v1/meshes/SK_Casual_BasicTshirt_M.glb"
light = R + "scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Casual_BasicTshirt_L.glb"
heavy = R + "scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Casual_BasicTshirt_H.glb"
body = R + "public/models/reconstructed-meshes-v2/SK_Body_M.glb"
bones = joint_names(body)
for name, p in [("old M", old_m), ("new M", new_m), ("L", light), ("H", heavy), ("body", body)]:
    print(name, sha(p)[:8])
for med_name, med in [("old M", old_m), ("new M", new_m)]:
    for cls, p, s in [("L", light, 0.85), ("H", heavy, 1.15)]:
        ok, why, d = b.surface_permuted(med, p, s, bones)
        keep = {k: d.get(k) for k in ("positionMaxM", "normalMax", "uv1MaxDiff", "flippedTriangles", "flippedFraction",
                                     "quadGapMaxM", "jointResidualMaxM", "unweightedJointsOneSide")}
        print(f"{cls} vs {s} x {med_name}: {'PASS' if ok else 'FAIL'} {why} {json.dumps(keep)}")
