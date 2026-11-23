"""Build an index that carries Light and Heavy contestants (archetypes, 22 Nov 2026).

Reads only. Inputs (default: the root checkout's public/models, found from this file's location):
  reconstructed-assemblies-v1/assets.json, skin-pairs.json   the active index
  reconstructed-assembly-v2/items/*.json                     the item definitions (their Archetype TagOverrides)
  season11-staging-*/source-glb/*.glb                        extracted meshes, Light/Medium/Heavy siblings included

Writes to --out: assets.json (the active index plus the class meshes and an `archetypes` record), skin-pairs.json
(unchanged copy, so a preview server can answer both), report.json (every proof and every refusal), publish-list.tsv
(each class mesh file, where the index expects it, and its sha256).

A class mesh joins the index only with proof, never by approximation:
  1. Same build: its Medium sibling's staged GLB is byte-identical (sha256) to the mesh the active index serves, so the
     staged Light/Heavy GLBs come from the same extraction as the live Medium mesh.
  2. Same package: the GLB's recorded source is the package of the object path the item's TagOverride names.
  3. Same surface: same primitives, vertex counts, indices and every UV set, and the same material slots and default
     materials, so the Medium entry's slot bindings and body-hide masks (body-UV space) apply unchanged.
  4. Its own class skeleton: every skin joint sits at the class scale of the Medium joint (to 1e-4 m).
  5. A pure-scale bind (to 0.05 cm): the derived body-hide masks were computed on the Medium bind, so they are reused
     only where the class bind is the Medium bind scaled. Reshaped class meshes are refused here (and listed).
Class morphs (light_*/heavy_*) are carried as the game authored them; they are never derived from Medium ones, which
the 22 Nov census shows is impossible (_docs/archetypes-2026-11-22/README.md).

The class bodies (SK_Body_L/H) take the same proofs plus a skeleton proof: every bone translation is the class scale of
Medium's and every rotation equal. Their skin-material bounds origin is the class scale of the Medium body's (a pure
scale moves the bounds centre by exactly that factor).

With --proven (scripts/archetypes/prove-nov17.py's proof.json), a sixth proof: the class mesh's package is byte-identical
in today's game containers (rewritten 17 Nov 2026), since the staged meshes were read before that update.

Usage (Git Bash, from the worktree root):
  python scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/preview-v2 \\
      --proven scripts/generated/archetypes/nov17-proof-v1/proof.json
"""
import argparse, gzip, hashlib, json, os, struct, sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve()
# The nearest checkout holding the active index: the root checkout itself, or the root above a .claude/worktrees one.
DEFAULT_MODELS = next((p / "public" / "models" for p in HERE.parents
                       if (p / "public" / "models" / "reconstructed-assemblies-v1" / "assets.json").is_file()),
                      HERE.parents[2] / "public" / "models")
CLASSES = {"light": ("Customization.Archetype.Light", 0.85), "heavy": ("Customization.Archetype.Heavy", 1.15)}
STAGING = ["season11-staging-20261018", "season11-staging-20260912"]
JOINT_TOLERANCE = 1e-4      # metres: class joint vs scaled Medium joint
BIND_TOLERANCE = 5e-4       # metres (0.05 cm): pure-scale bind
UV_TOLERANCE = 1e-6


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def glb(path):
    b = Path(path).read_bytes()
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    jl = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20:20 + jl]), b[20 + jl + 8:]


def accessor(j, bin_, i):
    a = j["accessors"][i]
    v = j["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    dt = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1", 5122: "<i2", 5120: "i1"}[a["componentType"]]
    if "sparse" in a:
        raise ValueError("sparse accessor")
    return np.frombuffer(bin_, dtype=dt, count=a["count"] * n,
                         offset=v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], n)


def mesh_data(path):
    j, bin_ = glb(path)
    prims = []
    for m in j["meshes"]:
        names = m.get("extras", {}).get("targetNames", [])
        for p in m["primitives"]:
            at = p["attributes"]
            mat = j["materials"][p["material"]] if "material" in p else {}
            slot = mat.get("extras", {}).get("sourceSlot", {}).get("MaterialSlotName")
            prims.append({
                "pos": accessor(j, bin_, at["POSITION"]).astype(np.float64),
                "uvs": [accessor(j, bin_, at[k]).astype(np.float64) for k in sorted(at) if k.startswith("TEXCOORD_")],
                "idx": accessor(j, bin_, p["indices"]).ravel() if "indices" in p else None,
                "slot": slot, "material": mat.get("extras", {}).get("sourceMaterial"),
                "targets": names,
            })
    joints = None
    if j.get("skins"):
        s = j["skins"][0]
        ibm = accessor(j, bin_, s["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64)
        joints = {j["nodes"][i].get("name"): np.linalg.inv(m)[:3, 3] for i, m in zip(s["joints"], ibm)}
    return {"json": j, "prims": prims, "joints": joints, "source": j.get("extras", {}).get("source")}


def package_of(object_path):
    # /Game/Discovery/Characters/X/SK_X_L.SK_X_L -> Discovery/Content/Discovery/Characters/X/SK_X_L.uasset
    path = object_path.split(".")[0]
    assert path.startswith("/Game/"), object_path
    return "Discovery/Content/" + path[len("/Game/"):] + ".uasset"


def prove(medium, cls, scale, object_path, index_slots):
    """Every proof for one class mesh against its Medium sibling. Returns (ok, report)."""
    r = {"object": object_path}
    problems = []
    if cls["source"] != package_of(object_path):
        problems.append(f"source {cls['source']} is not {package_of(object_path)}")
    pm, pc = medium["prims"], cls["prims"]
    if len(pm) != len(pc):
        problems.append("primitive count differs")
    else:
        for i, (a, b) in enumerate(zip(pm, pc)):
            if len(a["pos"]) != len(b["pos"]):
                problems.append(f"primitive {i}: vertex count differs")
                continue
            if (a["idx"] is None) != (b["idx"] is None) or (a["idx"] is not None and not np.array_equal(a["idx"], b["idx"])):
                problems.append(f"primitive {i}: indices differ")
            if len(a["uvs"]) != len(b["uvs"]) or any(np.abs(u - v).max() > UV_TOLERANCE for u, v in zip(a["uvs"], b["uvs"])):
                problems.append(f"primitive {i}: UVs differ")
            if a["slot"] != b["slot"] or a["material"] != b["material"]:
                problems.append(f"primitive {i}: material slot differs")
        if not problems:
            bind = np.concatenate([np.linalg.norm(b["pos"] - scale * a["pos"], axis=1) for a, b in zip(pm, pc)])
            r["bindResidualMaxCm"] = round(float(bind.max() * 100), 4)
            if bind.max() > BIND_TOLERANCE:
                problems.append(f"bind is not a pure x{scale} scale of Medium (max {bind.max() * 100:.2f} cm)")
    slots = [p["slot"] for p in pc]
    if [s["slot"] for s in index_slots] != list(dict.fromkeys(slots)) and [s["slot"] for s in index_slots] != slots:
        problems.append(f"slots {slots} do not match the index's {[s['slot'] for s in index_slots]}")
    if cls["joints"] is None or medium["joints"] is None or set(cls["joints"]) != set(medium["joints"]):
        problems.append("skin joints differ")
    else:
        d = max(float(np.linalg.norm(cls["joints"][n] - scale * medium["joints"][n])) for n in medium["joints"])
        r["jointResidualMaxM"] = d
        if d > JOINT_TOLERANCE:
            problems.append(f"skin is not bound to the x{scale} skeleton (max {d:.5f} m)")
    tm, tc = set(pc[0]["targets"]) if pc else set(), set(pm[0]["targets"]) if pm else set()
    r["classMorphs"] = sorted(t for t in tm if t.startswith(("light_", "heavy_")))
    fitting_m = sorted(t for t in tc if not t.startswith(("light_", "medium_", "heavy_")))
    fitting_c = sorted(t for t in tm if not t.startswith(("light_", "medium_", "heavy_")))
    if fitting_m != fitting_c:
        problems.append(f"fitting morphs differ: {sorted(set(fitting_m) ^ set(fitting_c))}")
    r["problems"] = problems
    return not problems, r


def skeleton_scale(medium_json, cls_json, scale):
    """The class skeleton against Medium: the median translation ratio, the largest translation residual (metres) from
    the exact `scale`, and the largest quaternion component difference."""
    nm = {n.get("name"): n for n in medium_json["nodes"]}
    ratios, residual, rot = [], 0.0, 0.0
    for n in cls_json["nodes"]:
        m = nm.get(n.get("name"))
        if m is None or "translation" not in n:
            continue
        a, b = np.array(m["translation"]), np.array(n["translation"])
        if np.linalg.norm(a) > 1e-2:
            ratios.append(float(np.dot(a, b) / np.dot(a, a)))
        residual = max(residual, float(np.linalg.norm(b - scale * a)))
        q1, q2 = np.array(m.get("rotation", [0, 0, 0, 1])), np.array(n.get("rotation", [0, 0, 0, 1]))
        rot = max(rot, float(min(np.abs(q1 - q2).max(), np.abs(q1 + q2).max())))
    return float(np.median(ratios)), residual, rot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=str(DEFAULT_MODELS))
    ap.add_argument("--out", required=True)
    # --publish-dir <folder under public/models>: the index points the class meshes at <folder>/meshes/ (a folder the
    # apply fills from publish-list.tsv and the host serves; its name must start "reconstructed-" for the routes).
    # Without it the index points at the staged files themselves, which only a local preview server serves.
    ap.add_argument("--publish-dir")
    # --proven <proof.json from prove-nov17.py>: also require each class mesh's package to be byte-identical in today's
    # containers (the coordinator's rule for pre-update data, 22 Nov). A mesh the proof refused or never read is refused.
    ap.add_argument("--proven")
    args = ap.parse_args()
    current = None
    if args.proven:
        proof17 = json.loads(Path(args.proven).read_text(encoding="utf-8"))
        if proof17.get("policy") != "archetypes-nov17-proof-v1":
            sys.exit(f"{args.proven} is not a prove-nov17.py result")
        current = {"proven": set(proof17["proven"]), "refused": proof17["refused"], "packages": proof17["packages"],
                   "file": args.proven, "sha256": sha256(args.proven), "containers": proof17["today"]["containersNewest"]}
    if args.publish_dir and not args.publish_dir.startswith("reconstructed-"):
        sys.exit("--publish-dir must start with reconstructed- (models/reconstructed-* is what the host routes)")
    models = Path(args.models).resolve()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index_dir = models / "reconstructed-assemblies-v1"
    assets = json.loads((index_dir / "assets.json").read_text(encoding="utf-8"))
    skin_pairs = json.loads((index_dir / "skin-pairs.json").read_text(encoding="utf-8"))
    report = {"activeSha256": sha256(index_dir / "assets.json"), "skinPairsSha256": sha256(index_dir / "skin-pairs.json"),
              "currentProof": {k: current[k] for k in ("file", "sha256", "containers")} if current else None,
              "classes": {}, "meshes": {}, "refused": {}}

    # The Archetype mesh swaps the definitions author: Medium skeletal mesh -> class mesh.
    swaps = {cls: {} for cls in CLASSES}
    conflicts = set()
    items_dir = models / "reconstructed-assembly-v2" / "items"
    for f in sorted(items_dir.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for part in d.get("properties", {}).get("VisualParts", []) or []:
            medium = (part.get("SkeletalMesh") or {}).get("AssetPathName") or ""
            if not medium:
                continue
            for rule in part.get("TagOverrides", []) or []:
                for cls, (tag, _) in CLASSES.items():
                    if rule.get("MatchingTags") == [tag] and rule.get("bOverrideMesh"):
                        target = (rule.get("ReplacementSkeletalMesh") or {}).get("AssetPathName") or ""
                        if target and swaps[cls].setdefault(medium, target) != target:
                            conflicts.add(medium)
    report["swapConflicts"] = sorted(conflicts)

    staged = {}
    for folder in STAGING:
        for f in (models / folder / "source-glb").glob("*.glb"):
            staged.setdefault(f.name, []).append(f)
    by_sha = {}
    def staged_sha(f):
        if f not in by_sha:
            by_sha[f] = sha256(f)
        return by_sha[f]

    added, item_masks = {}, {}
    medium_body = assets["attachmentBody"]["source"]
    for medium_path, entry in sorted(assets["meshes"].items()):
        if entry.get("kind") != "skeletal" or medium_path in conflicts:
            continue
        name = medium_path.rsplit(".", 1)[-1]
        match = [f for f in staged.get(name + ".glb", []) if staged_sha(f) == entry.get("sha256")]
        if not match:
            continue
        medium_glb = match[0]
        medium = mesh_data(medium_glb)
        for cls, (tag, scale) in CLASSES.items():
            target = swaps[cls].get(medium_path)
            if not target or target in assets["meshes"]:
                continue
            file = medium_glb.parent / (target.rsplit(".", 1)[-1] + ".glb")
            if not file.exists():
                report["refused"][target] = ["not staged beside its Medium sibling"]
                continue
            ok, proof = prove(medium, mesh_data(file), scale, target, entry["slots"])
            proof.update({"class": cls, "medium": medium_path, "file": str(file.relative_to(models)).replace(os.sep, "/"),
                          "sha256": staged_sha(file), "mediumSha256": entry["sha256"]})
            if not ok:
                report["refused"][target] = proof["problems"]
                continue
            if current is not None:
                package = "Discovery/Content/" + target.split(".")[0][len("/Game/"):] + ".uasset"
                proof["containers17Nov"] = current["packages"].get(package)
                if target not in current["proven"]:
                    report["refused"][target] = [f"not current in the 17 Nov containers: "
                                                 f"{current['refused'].get(target, 'no proof row')}"]
                    continue
            new = {k: v for k, v in entry.items() if k not in ("url", "sha256")}
            hosted = models / args.publish_dir / "meshes" / file.name if args.publish_dir else file
            proof["publish"] = str(hosted.relative_to(models)).replace(os.sep, "/")
            new["url"] = os.path.relpath(hosted, index_dir).replace(os.sep, "/")
            new["sha256"] = proof["sha256"]
            added[target] = new
            report["meshes"][target] = proof
            for source, masks in assets.get("itemBodyMasks", {}).items():
                if medium_path in masks:
                    item_masks.setdefault(source, {})[target] = masks[medium_path]

    # The class bodies and their records.
    archetypes = {}
    body_origins = {json.dumps(p["body"]["boundsOrigin"]) for p in skin_pairs["items"].values()
                    if p["body"]["sourceMesh"] == medium_body}
    if len(body_origins) != 1:
        sys.exit(f"skin pairs disagree on the Medium body's bounds origin: {body_origins}")
    medium_origin = json.loads(body_origins.pop())
    medium_body_glb = [f for f in staged.get(medium_body.rsplit(".", 1)[-1] + ".glb", [])
                       if staged_sha(f) == assets["meshes"][medium_body]["sha256"]]
    for cls, (tag, scale) in CLASSES.items():
        target = swaps[cls].get(medium_body)
        if not target or target not in added or not medium_body_glb:
            report["classes"][cls] = {"refused": "class body not proven"}
            continue
        mj, _ = glb(medium_body_glb[0])
        cj, _ = glb(models / report["meshes"][target]["file"])
        measured, residual, rotation = skeleton_scale(mj, cj, scale)
        # 1e-5 m (a hundredth of a millimetre) and 1e-5 per quaternion component: float32 rounding, nothing more.
        if abs(measured - scale) > 1e-5 or residual > 1e-5 or rotation > 1e-5:
            report["classes"][cls] = {"refused": f"skeleton is not a x{scale} scale ({measured}, residual {residual} m, rot {rotation})"}
            continue
        archetypes[cls] = {"body": target, "skeletonScale": scale,
                           "boundsOrigin": [round(v * scale, 6) for v in medium_origin]}
        report["classes"][cls] = {"body": target, "skeletonScale": scale, "measuredScale": measured,
                                  "translationResidualMaxM": residual, "rotationMaxDiff": rotation}

    # A class without a proven body cannot be built, so none of its meshes join (with neither, the index is unchanged).
    added = {k: v for k, v in added.items() if report["meshes"][k]["class"] in archetypes}
    item_masks = {source: {k: v for k, v in masks.items() if k in added} for source, masks in item_masks.items()}
    item_masks = {source: masks for source, masks in item_masks.items() if masks}
    result = dict(assets)
    result["meshes"] = {**assets["meshes"], **added}
    if item_masks:
        result["itemBodyMasks"] = {k: {**assets.get("itemBodyMasks", {}).get(k, {}), **item_masks.get(k, {})}
                                   for k in [*assets.get("itemBodyMasks", {}),
                                             *sorted(set(item_masks) - set(assets.get("itemBodyMasks", {})))]}
    if archetypes:
        result["archetypes"] = archetypes
    (out / "assets.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    (out / "skin-pairs.json").write_text(json.dumps(skin_pairs, separators=(",", ":")), encoding="utf-8")
    report["added"] = {cls: sorted(k for k, v in report["meshes"].items() if v["class"] == cls and k in added) for cls in CLASSES}
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    # source (models-relative) <TAB> where the index expects it <TAB> sha256: the apply copies, then checks the sha256.
    (out / "publish-list.tsv").write_text("".join(
        f"{report['meshes'][k]['file']}\t{report['meshes'][k]['publish']}\t{report['meshes'][k]['sha256']}\n"
        for k in sorted(added)), encoding="utf-8")
    print(json.dumps({cls: len(v) for cls, v in report["added"].items()}), "class meshes;",
          len(report["refused"]), "refused;", "classes:", sorted(archetypes))


if __name__ == "__main__":
    main()
