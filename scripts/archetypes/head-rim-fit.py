"""How does the game show the shared (Medium-authored) head on a Light or Heavy body? (23 Nov 2026) Reads GLBs only.

The head has no class mesh. Two candidate models, judged by how well the head's neck rim (its vertices lying on the
Medium body) meets the class body, each with its own morphs (head_neck_match plus the class morph):
  - leader pose: each vertex carried by its joints' move from the Medium rest, full size
    (v - (1-s) * sum_b w_b p_b, rotations being equal);
  - scaled: the head scaled by the class about the origin, morphs scaled with it (s * (v + d)).
The control is the head on the Medium body. Result (23 Nov, SK_Head_Face_01_Base): scaled fits to 0.10 / 0.14 cm median
(Light / Heavy), as tightly as Medium's 0.12 cm; leader pose misses by 1.54 / 2.12 cm. See README "The head is scaled".

  python -I scripts/archetypes/head-rim-fit.py [--head SK_Head_Face_01_Base]
"""
import argparse, gzip, json, struct
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve()
MODELS = next((p / "public" / "models" for p in HERE.parents
               if (p / "public" / "models" / "reconstructed-assemblies-v1" / "assets.json").is_file()), None)
STAGED = "season11-staging-20261018/source-glb"


def load(path):
    b = Path(path).read_bytes()
    b = gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
    def acc(i):
        x = j["accessors"][i]; v = j["bufferViews"][x["bufferView"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[x["type"]]
        dt = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[x["componentType"]]
        a = np.frombuffer(bin_, dtype=dt, count=x["count"] * n, offset=v.get("byteOffset", 0) + x.get("byteOffset", 0))
        a = a.reshape(x["count"], n).astype(float)
        if x.get("normalized") and x["componentType"] in (5121, 5123):
            a /= 255.0 if x["componentType"] == 5121 else 65535.0
        return a
    pr = j["meshes"][0]["primitives"][0]
    names = j["meshes"][0].get("extras", {}).get("targetNames", [])
    skin = j["skins"][0]
    ibm = acc(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    weights = acc(pr["attributes"]["WEIGHTS_0"])
    return {"P": acc(pr["attributes"]["POSITION"]),
            "D": {n: acc(t["POSITION"]) for n, t in zip(names, pr.get("targets", []))},
            "joints": np.array([np.linalg.inv(m)[:3, 3] for m in ibm]),
            "J": acc(pr["attributes"]["JOINTS_0"]).astype(int), "W": weights / weights.sum(1, keepdims=True)}


def morphed(mesh, names):
    return mesh["P"] + sum((mesh["D"][n] for n in names if n in mesh["D"]), np.zeros_like(mesh["P"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--head", default="SK_Head_Face_01_Base")
    args = ap.parse_args()
    assets = json.loads((MODELS / "reconstructed-assemblies-v1/assets.json").read_text(encoding="utf-8"))
    url = next(e["url"] for k, e in assets["meshes"].items() if k.endswith(f"/{args.head}.{args.head}"))
    head = load((MODELS / "reconstructed-assemblies-v1" / url).resolve())
    medium = morphed(load(MODELS / STAGED / "SK_Body_M.glb"), ["head_neck_match"])
    on_medium = cKDTree(medium).query(morphed(head, ["head_neck_match"]))[0]
    rim = on_medium < 0.005
    stats = lambda g: f"median {np.median(g):.2f}  p90 {np.percentile(g, 90):.2f}  max {g.max():.2f} cm"
    print(f"{args.head}: {rim.sum()} rim vertices; control (Medium body): {stats(on_medium[rim] * 100)}")
    for cls, s, body, morph in (("light", 0.85, "SK_Body_L.glb", "light_male"), ("heavy", 1.15, "SK_Body_H.glb", "heavy_male")):
        tree = cKDTree(morphed(load(MODELS / STAGED / body), [morph, "head_neck_match"]))
        d = sum((head["D"][n] for n in (morph, "head_neck_match") if n in head["D"]), np.zeros_like(head["P"]))
        carried = head["P"] - (1 - s) * np.einsum("vk,vkc->vc", head["W"], head["joints"][head["J"]]) + d
        for label, points in (("leader pose (full size)", carried), ("scaled with the class", s * (head["P"] + d))):
            print(f"  {cls:5} {label:24} {stats(tree.query(points[rim])[0] * 100)}")


if __name__ == "__main__":
    main()
