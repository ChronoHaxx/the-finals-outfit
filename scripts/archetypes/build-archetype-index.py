"""Build an index that carries Light and Heavy contestants (archetypes, 22 Nov 2026).

Reads only. Inputs (default: the root checkout's public/models, found from this file's location):
  reconstructed-assemblies-v1/assets.json, skin-pairs.json   the active index
  reconstructed-assembly-v2/items/*.json                     the item definitions (their Archetype TagOverrides)
  season11-staging-*/source-glb/*.glb                        extracted meshes, Light/Medium/Heavy siblings included

Writes to --out: assets.json (the active index plus the class meshes and an `archetypes` record), skin-pairs.json
(unchanged copy, so a preview server can answer both), report.json (every proof, every refusal and every skip),
publish-list.tsv (each class mesh file, where the index expects it, and its sha256), skipped.tsv (each class mesh left
out without a proof, and why).

Every class mesh the item definitions name ends in exactly one of three lists, never dropped silently:
  added    (report.json "added", "meshes")  every proof below holds;
  refused  (report.json "refused")          a proof was tried and failed;
  skipped  (report.json "skipped")          no proof was tried, for a recorded reason: "medium sibling repointed" (the
           active index serves another build of the Medium mesh than the staged one, e.g. an S12 refresh), "medium
           sibling not staged", "medium not in the active index", "medium not skeletal in the active index", "swap
           conflict" (one Medium mesh swapped for different class meshes), "already in the active index", or "class
           body not proven" (the mesh passed, but its class cannot be built). With --live-equal-medium (proof 1',
           below), "medium changed in the game" (the staged Medium's surface is not the live one's), "live Medium
           reweighted" (only the skin weights differ: our own rework) or "live Medium file missing".

Proof 1' (--live-equal-medium, proposed 23 Nov 2026; use it only with the coordinator's approval): where no staged
Medium is byte-identical to the live one, one that matches it on everything the class mesh inherits stands in (see
live_equal). Fresh reads of today's containers come in through --staging (scripts/archetypes/run-light-bulk.py).

The fresh-pair rule (with --live-equal-medium and --proven, approved 26 Nov 2026): where the live Medium is
byte-identical to an older staged read (proof 1 holds) but that read's class sibling is not current in the 17 Nov
containers, a fresh --staging read of the same Medium stands in only if it is live-equal to the live mesh (proof 1'),
and the class sibling read beside it then takes every proof. Otherwise the row stays refused for currency. A fresh
read can never be byte-identical to the live mesh, so proof 1' is the bar. report.json "freshPair" and fresh-pair.tsv
record every attempt.

Proof 3' (--same-surface-permuted, approved 26 Nov 2026): where proof 3 fails only on vertex order (indices, UVs or
the skin's joint list), the class mesh may still be its Medium sibling's surface, exported with its vertices in another
order and a few quads split along the other diagonal. surface_permuted re-proves proofs 3-5 under a vertex bijection,
with the tolerances in SURFACE_PERMUTED; a mesh a side registry names is refused. report.json "proof3Prime" and
proof3-prime.tsv record every attempt.

The reshaped route (--reshaped NAME[,NAME], approved 26 Nov 2026 for SK_Casual_BasicTshirt_L): a class mesh the game
authored with its own shape and skin (the Light T-shirt: a lower hem, its own weights) fails proofs 3 and 5, because
the Medium's body mask was projected from another shape. Only the listed class meshes may take this route, never
automatically. For them, proof 3 becomes "the materials apply" and proof 5 becomes "its own body mask" (materials_apply
and the mask record below); proofs 1, 2, 4 and 6, the material slots, the fitting-morph names and the side-registry
refusal stay. Without --reshaped-masks a row that passes everything else is refused and written to
reshaped-preview/assets.json, an index for the mask generator only (scripts/shader-probe/build-companion-masks.mjs
--models-url ... --archetype), never to apply. With --reshaped-masks <that run's derived-coverage.json> and
--reshaped-mask-check <the same generator's Medium run, which must regenerate the Medium's published mask byte for
byte> it joins with its own bodyMaskUrl, published beside the meshes under <publish dir>/coverage/. report.json
"reshaped" and reshaped.tsv record every attempt.

The own-weights route (--own-weights NAME[,NAME], the user's yes on 28 Nov 2026 for SK_Sneakers_L/_H and
SK_StarterSet_TShirt_L/_H, the rows the 26 Nov UV-tile census held): a class mesh that is its Medium sibling's surface at
the class scale in the same vertex order, but whose UV0 islands sit whole tiles away and whose skin is the game's own
reweight, fails proof 3 on its UVs (and its joint list) and proof 3' on UV0. Only the listed class meshes may take this
route, never automatically. For them proof 3 becomes own_weights_surface (whole-tile UV0 shifts within one half-float
step, no triangle across two shifts, only tiles the Medium reads; positions, normals, indices and UV1 as tight as
proof 3'); the weights are recorded, not gated. The GLB is served with its raw tiles, and the row keeps the Medium's body
masks, as proof 3 and 3' rows do. report.json "ownWeights" and own-weights.tsv record every attempt.

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
scale moves the bounds centre by exactly that factor). A class the active index already carries (an earlier apply) is
re-proven the same way from its staged body, which must be the bytes the index serves beside a Medium body that still
matches; its `archetypes` record is kept either way, so a later run only ever adds.

With --proven (scripts/archetypes/prove-nov17.py's proof.json), a sixth proof: the class mesh's package is byte-identical
in today's game containers (rewritten 17 Nov 2026), since the staged meshes were read before that update.

Usage (Git Bash, from the worktree root):
  python scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/preview-v2 \\
      --proven scripts/generated/archetypes/nov17-proof-v1/proof.json
"""
import argparse, gzip, hashlib, json, os, re, struct, sys
from collections import Counter
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


# Proof 1' tolerances (approved by the coordinator 23 Nov 2026, with these stated): what a class mesh inherits from the
# live Medium entry must be the same mesh, up to float noise from a re-read or re-convert.
LIVE_EQUAL = {
    "positionM": 1e-5,          # vertex positions, metres
    "uv": 1e-6,                 # every UV set
    "normal": 1e-4,             # unit normals, per component
    "inverseBind": 1e-5,        # inverse-bind matrix elements (covers last-digit rotation noise of a re-convert)
    "weightQuantization": 65535,  # weights compared exactly as normalized UNSIGNED_SHORT; joint indices exactly
}


def skin_detail(path):
    """What proof 1' compares beyond mesh_data: per primitive the normals, the JOINTS_n index sets, the WEIGHTS_n sets
    quantized to normalized u16, and the morph targets by name (POSITION deltas); the skin's joint names in order and
    its inverse-bind matrices."""
    j, bin_ = glb(path)
    skin = j["skins"][0] if j.get("skins") else None
    names = [j["nodes"][i].get("name") for i in skin["joints"]] if skin else []
    ibm = accessor(j, bin_, skin["inverseBindMatrices"]).astype(np.float64) if skin else np.zeros((0, 16))
    prims = []
    for m in j["meshes"]:
        targets = m.get("extras", {}).get("targetNames", [])
        for p in m["primitives"]:
            at = p["attributes"]
            normals = accessor(j, bin_, at["NORMAL"]).astype(np.float64) if "NORMAL" in at else None
            joints, weights = [], []
            for key in sorted(k for k in at if k.startswith("JOINTS_")):
                joints.append(accessor(j, bin_, at[key]).astype(np.int64))
                wkey = "WEIGHTS_" + key[len("JOINTS_"):]
                w = accessor(j, bin_, at[wkey]).astype(np.float64)
                w /= {5121: 255.0, 5123: 65535.0}.get(j["accessors"][at[wkey]]["componentType"], 1.0)
                weights.append(np.rint(w * LIVE_EQUAL["weightQuantization"]).astype(np.int64))
            morphs = {name: accessor(j, bin_, t["POSITION"]).astype(np.float64)
                      for name, t in zip(targets, p.get("targets", [])) if "POSITION" in t}
            prims.append({"normals": normals, "joints": joints, "weights": weights, "morphs": morphs})
    return {"jointNames": names, "inverseBind": ibm, "prims": prims}


def morph_diff(da, db):
    """Morph targets that differ between the staged and the live Medium: allowed by proof 1', but recorded (they say
    the live Medium is behind the game, for a later Medium refresh). Max delta difference in cm per changed target."""
    changed, only_staged, only_live = {}, set(), set()
    for pa, pb in zip(da["prims"], db["prims"]):
        only_staged |= set(pa["morphs"]) - set(pb["morphs"])
        only_live |= set(pb["morphs"]) - set(pa["morphs"])
        for name in set(pa["morphs"]) & set(pb["morphs"]):
            x, y = pa["morphs"][name], pb["morphs"][name]
            d = float(np.abs(x - y).max() * 100) if x.shape == y.shape else float("inf")
            if d > 1e-4:
                changed[name] = max(changed.get(name, 0.0), round(d, 4))
    return {"changedCm": dict(sorted(changed.items())), "onlyStaged": sorted(only_staged), "onlyLive": sorted(only_live)}


def live_equal(staged_path, live_path):
    """Proof 1' ("live-equal Medium", approved 23 Nov 2026): the Medium read beside a class mesh is the live Medium GLB
    up to float noise, on everything the class mesh inherits from the index entry (tolerances: LIVE_EQUAL):
      primitive and vertex counts, indices (exact); positions, every UV set, normals (within epsilon); material slot
      names in order (exact); skin joint names in order (exact); inverse-bind matrices (within epsilon); joint index
      sets (exact) and weights after u16 quantization (exact).
    Morph targets may differ; morph_diff records them. Returns (ok, reason, detail). The reason is "medium changed in
    the game" for any surface, slot or skeleton difference, "live Medium reweighted" when only the skin weights or
    their joint indices differ (our own rework, or the game's); there is no fallback for a failing row."""
    a, b = mesh_data(staged_path), mesh_data(live_path)
    da, db = skin_detail(staged_path), skin_detail(live_path)
    pa, pb = a["prims"], b["prims"]

    def changed(what, **extra):
        return False, "medium changed in the game", {"differs": what, **extra}
    if len(pa) != len(pb) or any(len(x["pos"]) != len(y["pos"]) for x, y in zip(pa, pb)):
        return changed("primitives or vertex counts")
    for i, (x, y, nx, ny) in enumerate(zip(pa, pb, da["prims"], db["prims"])):
        if (x["idx"] is None) != (y["idx"] is None) or (x["idx"] is not None and not np.array_equal(x["idx"], y["idx"])):
            return changed("indices", primitive=i)
        if np.abs(x["pos"] - y["pos"]).max() > LIVE_EQUAL["positionM"]:
            return changed("positions", primitive=i, maxM=float(np.abs(x["pos"] - y["pos"]).max()))
        if len(x["uvs"]) != len(y["uvs"]) or any(np.abs(u - v).max() > LIVE_EQUAL["uv"] for u, v in zip(x["uvs"], y["uvs"])):
            return changed("UVs", primitive=i)
        if (nx["normals"] is None) != (ny["normals"] is None) or (
                nx["normals"] is not None and np.abs(nx["normals"] - ny["normals"]).max() > LIVE_EQUAL["normal"]):
            return changed("normals", primitive=i)
    if [x["slot"] for x in pa] != [y["slot"] for y in pb]:
        return changed("material slots", staged=[x["slot"] for x in pa], live=[y["slot"] for y in pb])
    if da["jointNames"] != db["jointNames"]:
        return changed("skin joint names or order")
    if da["inverseBind"].shape != db["inverseBind"].shape or (
            len(da["inverseBind"]) and np.abs(da["inverseBind"] - db["inverseBind"]).max() > LIVE_EQUAL["inverseBind"]):
        return changed("inverse-bind matrices", maxDiff=float(np.abs(da["inverseBind"] - db["inverseBind"]).max())
                       if da["inverseBind"].shape == db["inverseBind"].shape else None)
    morphs = morph_diff(da, db)
    for i, (nx, ny) in enumerate(zip(da["prims"], db["prims"])):
        if len(nx["joints"]) != len(ny["joints"]) or any(not np.array_equal(u, v) for u, v in zip(nx["joints"], ny["joints"])):
            return False, "live Medium reweighted", {"differs": "joint indices", "primitive": i, "morphs": morphs}
        bad = [int((u != v).any(axis=1).sum()) for u, v in zip(nx["weights"], ny["weights"])]
        if any(bad):
            worst = max(int(np.abs(u - v).max()) for u, v in zip(nx["weights"], ny["weights"]))
            return False, "live Medium reweighted", {"differs": "weights", "primitive": i, "vertices": sum(bad),
                                                     "maxU16Steps": worst, "morphs": morphs}
    return True, None, {"morphs": morphs}


def live_equal_margins(staged_path, live_path):
    """For a pair live_equal passed: the largest difference it measured on each toleranced quantity, beside its
    epsilon, so a review sees how close to the line the pair came (indices, slots, joint names and u16 weights are exact
    by then). Used by the fresh-pair rule's record only."""
    a, b = mesh_data(staged_path), mesh_data(live_path)
    da, db = skin_detail(staged_path), skin_detail(live_path)
    measured = {"positionM": 0.0, "uv": 0.0, "normal": 0.0, "inverseBind": 0.0}
    for x, y, nx, ny in zip(a["prims"], b["prims"], da["prims"], db["prims"]):
        measured["positionM"] = max(measured["positionM"], float(np.abs(x["pos"] - y["pos"]).max()))
        measured["uv"] = max([measured["uv"], *(float(np.abs(u - v).max()) for u, v in zip(x["uvs"], y["uvs"]))])
        if nx["normals"] is not None:
            measured["normal"] = max(measured["normal"], float(np.abs(nx["normals"] - ny["normals"]).max()))
    if len(da["inverseBind"]):
        measured["inverseBind"] = float(np.abs(da["inverseBind"] - db["inverseBind"]).max())
    return {k: {"measured": v, "epsilon": LIVE_EQUAL[k], "ofEpsilon": round(v / LIVE_EQUAL[k], 4)}
            for k, v in measured.items()}


# Proof 3' tolerances (approved by the coordinator 26 Nov 2026, with these stated): a class mesh that is its Medium
# sibling's surface at the class scale, but whose vertices come in another order (and whose few quads may be split along
# the other diagonal), as when the game exported the class mesh separately.
SURFACE_PERMUTED = {
    "uv0": 1e-6,                # UV0 per matched vertex: the bijection's key
    "uv": 1e-6,                 # UV sets after UV1
    "uv1": 1 / 128,             # UV1 (0.0078125): it drives body-hide masks, so its largest difference is recorded
    "positionM": 1e-5,          # class vertex vs the class-scaled Medium vertex, metres (proof 5 under the mapping)
    "normal": 1e-4,             # unit normals, per component
    "flippedFraction": 0.05,    # triangles split along the other diagonal, of all triangles
    "quadGapM": 1e-4,           # 0.1 mm: a flipped quad's two diagonals may pass no further apart, at either bind pose
}
# Per-mesh registries: a mesh they name may carry data tied to its vertex order, so proof 3' refuses it.
SIDE_REGISTRY_SECTIONS = ("attachmentBody", "attachmentFrames", "glitchOverlayMeshes", "meshPartEffects",
                          "activatedEffectParts", "mergedPartTransforms", "attachmentMirroredScale", "hairOverridePrecedence")
SIDE_REGISTRY_FILES = ("head-wraps.json", "face-cosmetics.json", "derived-coverage.json")
# Proof 3 failures that only a reordering can explain; any other problem keeps the row refused without trying 3'.
PERMUTABLE = ("indices differ", "UVs differ", "skin joints differ")
# The reshaped route (approved by the coordinator 26 Nov 2026): "the materials apply" in place of proof 3, and the mesh's
# own body mask in place of proof 5. Positions, triangles and weights are the game's own: recorded, not gated.
RESHAPED = {
    "uv0": 1e-6,                # UV0 per matched vertex: the bijection's key, so every texture lands as on Medium
    "uv": 1e-6,                 # UV sets after UV1
    "uv1": 1 / 128,             # UV1, as in proof 3' (recorded)
    "wrongFileCapM": 0.01,      # 1 cm: no vertex further from the class-scaled Medium (a wrong-file guard, not a fit)
    "jointM": 1e-4,             # weighted joints at the class scale of the Medium skin's (proof 4)
}
# What the reshaped route may replace: proof 3's in-order problems, the pure-scale bind and the proof 3' refusal.
RESHAPED_REPLACES = PERMUTABLE + ("proof 3':",)
RESHAPED_BIND = "bind is not a pure"
# The own-weights route (the user's yes, 28 Nov 2026, for the four rows the 26 Nov UV-tile census held: SK_Sneakers_L/_H
# and SK_StarterSet_TShirt_L/_H): the Medium surface at the class scale in the same vertex order, with UV0 islands whole
# tiles away and the game's own skin weights. Only listed rows, never automatic. The weights are recorded, not gated.
OWN_WEIGHTS = {
    "positionM": 1e-5,          # class vertex vs the class-scaled Medium vertex, same index (proof 5, as in proof 3')
    "normal": 1e-4,             # unit normals, per component
    "uv0Steps": 1.0,            # UV0 residual after a whole-tile shift, in stored half-float steps at its magnitude
    "uv1": 1 / 1024,            # UV1 (it drives body-hide masks): the census bound, stricter than proof 3''s 1/128
    "uv": 1e-6,                 # UV sets after UV1
    "jointM": 1e-4,             # weighted joints at the class scale of the Medium skin's (proof 4)
}
# What the own-weights route may replace: proof 3's UV and joint-list problems and the proof 3' refusal. Indices must
# match (the same vertex order), so "indices differ" stays a refusal.
OWN_WEIGHTS_REPLACES = ("UVs differ", "skin joints differ")


def fp16_step(u):
    """The spacing of half floats around |u| (normal range): 2^(floor(log2|u|) - 10); 2^-24 below the normal range."""
    a = np.abs(np.asarray(u, dtype=np.float64))
    out = np.full(a.shape, 2.0 ** -24)
    normal = a >= 2.0 ** -14
    out[normal] = np.exp2(np.floor(np.log2(a[normal])) - 10)
    return out


def own_weights_surface(medium_path, cls_path, scale, body_bones):
    """The own-weights route's surface proof (the user's yes, 28 Nov 2026), in place of proofs 3 and 3' for a listed class
    mesh: its Medium sibling's surface at the class scale in the same vertex order, whose UV0 islands sit whole tiles from
    the Medium's and whose skin weights are the game's own. In detail:
      the same primitives, vertex counts, indices and material slots in order; every vertex within 1e-5 m of the
      class-scaled Medium vertex of the same index, its normal within 1e-4;
      UV0 the Medium's plus a whole-tile shift per vertex, within one stored half-float step at that magnitude (the game
      stores UVs as fp16, so the same coordinate four tiles away rounds on a coarser grid); no triangle across two
      shifts (each island moves as one); every tile the class reads is one the Medium reads (the runtime samples no tile
      the Medium is not drawn on already);
      UV1 within 1/1024, other UV sets within 1e-6;
      every joint listed on one side only is a body-skeleton bone; every weighted class joint is listed by the Medium
      skin, at the class scale (proof 4).
    The class GLB is served as the game wrote it, raw tiles included (as S12 C0b serves the Medium's). Its weights are
    recorded (vertices reweighted, the largest difference in u8 steps), not gated. Returns (ok, reason, detail)."""
    T = OWN_WEIGHTS
    a, c = mesh_data(medium_path), mesh_data(cls_path)
    da, dc = skin_detail(medium_path), skin_detail(cls_path)
    detail = {"vertices": 0, "positionMaxM": 0.0, "normalMax": 0.0, "uv0ResidualMax": 0.0, "uv0ResidualStepsMax": 0.0,
              "verticesShifted": 0, "islandsShifted": 0, "shifts": {}, "tilesMedium": [], "tilesClass": [],
              "uv1MaxDiff": 0.0, "verticesReweighted": 0, "weightMaxU8Steps": 0.0}

    def fail(why, **extra):
        return False, why, {**detail, **extra}
    pa, pc = a["prims"], c["prims"]
    if len(pa) != len(pc) or any(len(x["pos"]) != len(y["pos"]) for x, y in zip(pa, pc)):
        return fail("primitives or vertex counts differ")
    if [(x["slot"], x["material"]) for x in pa] != [(y["slot"], y["material"]) for y in pc]:
        return fail("material slots differ")
    shifts, tiles_m, tiles_c = Counter(), set(), set()
    weighted_a, weighted_c = set(), set()
    for i, (x, y, nx, ny) in enumerate(zip(pa, pc, da["prims"], dc["prims"])):
        if x["idx"] is None or y["idx"] is None or not np.array_equal(x["idx"], y["idx"]):
            return fail("indices differ (the same vertex order is required)", primitive=i)
        if not x["uvs"] or len(x["uvs"]) != len(y["uvs"]):
            return fail("UV sets missing or differ in number", primitive=i)
        detail["vertices"] += len(x["pos"])
        off = np.linalg.norm(y["pos"] - x["pos"] * scale, axis=1)
        detail["positionMaxM"] = max(detail["positionMaxM"], float(off.max()))
        if off.max() > T["positionM"]:
            return fail(f"positions are not the x{scale} Medium's (max {off.max():.2e} m)", primitive=i)
        if (nx["normals"] is None) != (ny["normals"] is None):
            return fail("normals present on one side only", primitive=i)
        if nx["normals"] is not None:
            dn = float(np.abs(ny["normals"] - nx["normals"]).max())
            detail["normalMax"] = max(detail["normalMax"], dn)
            if dn > T["normal"]:
                return fail(f"normals differ (max {dn:.6f})", primitive=i)
        um, uc = x["uvs"][0], y["uvs"][0]
        d = uc - um
        shift = np.rint(d).astype(np.int64)
        residual = np.abs(d - shift)
        steps = residual / fp16_step(np.maximum(np.abs(uc), np.abs(um)))
        detail["uv0ResidualMax"] = max(detail["uv0ResidualMax"], float(residual.max()))
        detail["uv0ResidualStepsMax"] = max(detail["uv0ResidualStepsMax"], float(steps.max()))
        if steps.max() > T["uv0Steps"] + 1e-9:
            return fail(f"UV0 is not a whole-tile shift of the Medium's (residual {steps.max():.2f} half-float steps)",
                        primitive=i)
        tri = y["idx"].reshape(-1, 3).astype(np.int64)
        ts = shift[tri]
        if np.any(ts != ts[:, :1, :]):
            return fail("a triangle spans two tile shifts", primitive=i)
        moved = np.any(shift != 0, axis=1)
        detail["verticesShifted"] += int(moved.sum())
        shifts.update(f"{s[0]:+d},{s[1]:+d}" for s in shift[moved].tolist())
        # Islands: triangles joined through shared vertices (a small union-find); count those that moved.
        parent = list(range(len(x["pos"])))

        def find(v):
            while parent[v] != v:
                parent[v] = parent[parent[v]]
                v = parent[v]
            return v
        for t in tri.tolist():
            r0 = find(t[0])
            for v in t[1:]:
                rv = find(v)
                if rv != r0:
                    parent[rv] = r0
        detail["islandsShifted"] += len({find(v) for v in np.unique(tri).tolist() if moved[v]})
        tiles_m |= {tuple(t) for t in np.floor(um).astype(np.int64).tolist()}
        tiles_c |= {tuple(t) for t in np.floor(uc).astype(np.int64).tolist()}
        for k in range(1, len(x["uvs"])):
            dk = float(np.abs(y["uvs"][k] - x["uvs"][k]).max())
            if k == 1:
                detail["uv1MaxDiff"] = max(detail["uv1MaxDiff"], dk)
            if dk > (T["uv1"] if k == 1 else T["uv"]):
                return fail(f"UV{k} differs (max {dk:.6f})", primitive=i)
        wa, wc = _weights_by_name(da, i), _weights_by_name(dc, i)
        for ea, ec in zip(wa, wc):
            if ea != ec:
                detail["verticesReweighted"] += 1
                worst = max(abs(ec.get(k, 0) - ea.get(k, 0)) for k in set(ea) | set(ec))
                detail["weightMaxU8Steps"] = max(detail["weightMaxU8Steps"], round(worst / 257, 1))
            weighted_a |= set(ea)
            weighted_c |= set(ec)
    detail.update({"shifts": dict(sorted(shifts.items())), "tilesMedium": sorted(tiles_m), "tilesClass": sorted(tiles_c),
                   "weightedOnlyMedium": sorted(weighted_a - weighted_c),
                   "weightedOnlyClass": sorted(weighted_c - weighted_a)})
    if not tiles_c <= tiles_m:
        return fail(f"the class reads UV tiles the Medium does not: {sorted(tiles_c - tiles_m)}")
    ja, jc = a["joints"] or {}, c["joints"] or {}
    one_side = sorted(n for n in set(ja) ^ set(jc) if n not in body_bones)
    if one_side:
        return fail("joints listed on one side only are not body-skeleton bones", joints=one_side)
    unlisted = sorted(n for n in weighted_c if n not in ja or n not in jc)
    if unlisted:
        return fail("weighted class joints the Medium skin does not list", joints=unlisted)
    residual = max((float(np.linalg.norm(jc[n] - scale * ja[n])) for n in weighted_c), default=0.0)
    detail["jointResidualMaxM"] = residual
    if residual > T["jointM"]:
        return fail(f"weighted joints are not at the x{scale} skeleton (max {residual:.5f} m)")
    return True, None, detail


def _rotation(t):
    """A triangle as its vertex cycle starting at the smallest id: winding kept, start vertex normalised."""
    t = tuple(int(v) for v in t)
    return min(t, t[1:] + t[:1], t[2:] + t[:2])


def _weights_by_name(d, i):
    """Per vertex of primitive i: {joint name: u16 weight}, zero weights dropped (skin_detail's quantization)."""
    p, names = d["prims"][i], d["jointNames"]
    n = len(p["joints"][0]) if p["joints"] else 0
    out = [dict() for _ in range(n)]
    for J, W in zip(p["joints"], p["weights"]):
        for v in range(n):
            for j, w in zip(J[v], W[v]):
                if w:
                    out[v][names[j]] = out[v].get(names[j], 0) + int(w)
    return out


def _segment_gap(p1, p2, q1, q2):
    """Closest distance between segments p1p2 and q1q2 (Ericson, Real-Time Collision Detection 5.1.9)."""
    d1, d2, r = p2 - p1, q2 - q1, p1 - q1
    a, e, f, c, b = d1 @ d1, d2 @ d2, d2 @ r, d1 @ r, d1 @ d2
    den = a * e - b * b
    s = float(np.clip((b * f - c * e) / den, 0, 1)) if den > 1e-18 else 0.0
    t = (b * s + f) / e if e > 1e-18 else 0.0
    if t < 0:
        t, s = 0.0, float(np.clip(-c / a, 0, 1)) if a > 1e-18 else 0.0
    elif t > 1:
        t, s = 1.0, float(np.clip((b - c) / a, 0, 1)) if a > 1e-18 else 0.0
    return float(np.linalg.norm((p1 + d1 * s) - (q1 + d2 * t)))


def _flipped_quads(only_cls, only_med, pos_med, pos_cls):
    """The class triangles missing from the Medium (and the reverse), both in Medium vertex ids, must form quads that
    the two meshes split along opposite diagonals. Each unmatched class triangle pairs with exactly one neighbour (a
    shared edge, the class diagonal) so that the pair covers the same four vertices as a Medium pair split along the
    other diagonal; the Medium pairs are used once each and all of them. Winding: the quad's directed boundary edges are
    the same in both. Returns (ok, reason, max diagonal gap in metres over both bind poses, quads)."""
    def edges(t):
        return [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])]

    def pairs_by_edge(tris):
        by = {}
        for n, t in enumerate(tris):
            for u, v in edges(t):
                by.setdefault(frozenset((u, v)), []).append(n)
        return by

    def boundary(t1, t2, diagonal):
        return sorted(e for e in edges(t1) + edges(t2) if frozenset(e) != diagonal)

    med_by_edge = pairs_by_edge(only_med)
    med_quads = {}                                   # (quad vertices, diagonal) -> (Medium triangle numbers)
    for diagonal, ns in med_by_edge.items():
        if len(ns) == 2:
            quad = frozenset(only_med[ns[0]]) | frozenset(only_med[ns[1]])
            if len(quad) == 4:
                med_quads[(quad, diagonal)] = tuple(ns)
    cls_by_edge = pairs_by_edge(only_cls)
    partner, gap, quads = {}, 0.0, 0
    for n, t in enumerate(only_cls):
        valid = []
        for u, v in edges(t):
            diagonal = frozenset((u, v))
            for m in cls_by_edge[diagonal]:
                if m == n:
                    continue
                quad = frozenset(t) | frozenset(only_cls[m])
                other = quad - diagonal
                if len(quad) == 4 and (quad, other) in med_quads:
                    valid.append((m, diagonal, quad, other))
        if len(valid) != 1:
            return False, f"an unmatched triangle has {len(valid)} quad partners, not exactly one", gap, quads
        partner[n] = valid[0]
    used = set()
    for n, (m, diagonal, quad, other) in partner.items():
        if partner.get(m, (None,))[0] != n:
            return False, "unmatched triangles do not pair mutually", gap, quads
        if n > m:
            continue
        med_pair = med_quads[(quad, other)]
        if med_pair in used:
            return False, "a Medium quad is matched twice", gap, quads
        used.add(med_pair)
        if boundary(only_cls[n], only_cls[m], diagonal) != boundary(only_med[med_pair[0]], only_med[med_pair[1]], other):
            return False, "a flipped quad changes winding", gap, quads
        a, b = sorted(diagonal)
        c, d = sorted(other)
        for pos in (pos_med, pos_cls):
            gap = max(gap, _segment_gap(pos[a], pos[b], pos[c], pos[d]))
        quads += 1
    if 2 * len(used) != len(only_med):
        return False, "Medium triangles left unpaired", gap, quads
    return True, None, gap, quads


def surface_permuted(medium_path, cls_path, scale, body_bones):
    """Proof 3' ("same surface up to vertex order", approved 26 Nov 2026), used where proof 3 fails only on indices,
    UVs or the skin's joint list. Under a deterministic vertex bijection (UV0, then the class-scaled position: ties are
    identical vertices) the class mesh must be its Medium sibling at the class scale (tolerances: SURFACE_PERMUTED):
      same primitives, vertex counts and material slots in order; per matched vertex UV0, positions (x scale), normals,
      UV1 (1/128, recorded) and other UV sets, and the weight per (vertex, joint name), exact after u16 quantization;
      the same weighted joints by name, at the class scale (proof 4); joints only one side lists carry no weight and
      must be body-skeleton bones; triangles equal under the mapping except quads split along the other diagonal
      (_flipped_quads), at most 5% of all, each diagonal gap at most 0.1 mm.
    Fitting-morph deltas are compared under the mapping and recorded, never refused (as in proof 1'). The caller refuses
    a mesh any side registry names. Returns (ok, reason, detail); detail records the permutation hash, UV1, the
    flipped fraction and the largest quad gap."""
    T = SURFACE_PERMUTED
    a, c = mesh_data(medium_path), mesh_data(cls_path)
    da, dc = skin_detail(medium_path), skin_detail(cls_path)
    detail = {"uv1MaxDiff": 0.0, "positionMaxM": 0.0, "normalMax": 0.0, "triangles": 0, "flippedTriangles": 0,
              "flippedQuads": 0, "flippedFraction": 0.0, "quadGapMaxM": 0.0}

    def fail(why, **extra):
        return False, why, {**detail, **extra}
    pa, pc = a["prims"], c["prims"]
    if len(pa) != len(pc) or any(len(x["pos"]) != len(y["pos"]) for x, y in zip(pa, pc)):
        return fail("primitives or vertex counts differ")
    if [(x["slot"], x["material"]) for x in pa] != [(y["slot"], y["material"]) for y in pc]:
        return fail("material slots differ")
    digest = hashlib.sha256()
    weighted_a, weighted_c, morphs = set(), set(), {}
    for i, (x, y, nx, ny) in enumerate(zip(pa, pc, da["prims"], dc["prims"])):
        if not x["uvs"] or len(x["uvs"]) != len(y["uvs"]) or x["idx"] is None or y["idx"] is None:
            return fail("UV sets or indices missing or differ in number", primitive=i)
        med_scaled = x["pos"] * scale
        om = np.lexsort((med_scaled[:, 2], med_scaled[:, 1], med_scaled[:, 0], x["uvs"][0][:, 1], x["uvs"][0][:, 0]))
        oc = np.lexsort((y["pos"][:, 2], y["pos"][:, 1], y["pos"][:, 0], y["uvs"][0][:, 1], y["uvs"][0][:, 0]))
        perm = np.empty(len(oc), dtype=np.int64)
        perm[oc] = om                                       # class vertex -> Medium vertex
        digest.update(perm.astype("<u4").tobytes())
        if float(np.abs(y["uvs"][0] - x["uvs"][0][perm]).max()) > T["uv0"]:
            return fail("no vertex bijection on UV0", primitive=i)
        d = float(np.linalg.norm(y["pos"] - med_scaled[perm], axis=1).max())
        detail["positionMaxM"] = max(detail["positionMaxM"], d)
        if d > T["positionM"]:
            return fail(f"positions are not the x{scale} Medium's under the mapping (max {d * 1000:.4f} mm)", primitive=i)
        for k in range(1, len(x["uvs"])):
            d = float(np.abs(y["uvs"][k] - x["uvs"][k][perm]).max())
            if k == 1:
                detail["uv1MaxDiff"] = max(detail["uv1MaxDiff"], d)
            if d > (T["uv1"] if k == 1 else T["uv"]):
                return fail(f"UV{k} differs under the mapping (max {d:.6f})", primitive=i)
        if (nx["normals"] is None) != (ny["normals"] is None):
            return fail("normals present on one side only", primitive=i)
        if nx["normals"] is not None:
            d = float(np.abs(ny["normals"] - nx["normals"][perm]).max())
            detail["normalMax"] = max(detail["normalMax"], d)
            if d > T["normal"]:
                return fail(f"normals differ under the mapping (max {d:.6f})", primitive=i)
        wa, wc = _weights_by_name(da, i), _weights_by_name(dc, i)
        bad = [v for v, m in enumerate(perm) if wc[v] != wa[m]] if len(wa) == len(wc) else list(range(len(perm)))
        if bad:
            return fail("weights differ by joint name under the mapping", primitive=i, vertices=len(bad))
        for e in wa:
            weighted_a |= set(e)
        for e in wc:
            weighted_c |= set(e)
        for name in set(nx["morphs"]) & set(ny["morphs"]):
            d = float(np.abs(ny["morphs"][name] - scale * nx["morphs"][name][perm]).max() * 100)
            if d > 1e-4:
                morphs[name] = max(morphs.get(name, 0.0), round(d, 4))
        tri_m = x["idx"].reshape(-1, 3).astype(np.int64)
        tri_c = perm[y["idx"].reshape(-1, 3).astype(np.int64)]
        cm = Counter(_rotation(t) for t in tri_m)
        cc = Counter(_rotation(t) for t in tri_c)
        only_c, only_m = list((cc - cm).elements()), list((cm - cc).elements())
        detail["triangles"] += len(tri_c)
        detail["flippedTriangles"] += len(only_c)
        if len(only_c) != len(only_m):
            return fail("triangle counts under the mapping differ", primitive=i)
        if only_c:
            inverse = np.empty_like(perm)
            inverse[perm] = np.arange(len(perm))           # Medium vertex -> class vertex
            ok, why, gap, quads = _flipped_quads(only_c, only_m, x["pos"], y["pos"][inverse])
            detail["quadGapMaxM"] = max(detail["quadGapMaxM"], gap)
            detail["flippedQuads"] += quads
            if not ok:
                return fail(why, primitive=i)
            if gap > T["quadGapM"]:
                return fail(f"a flipped quad is not planar (diagonal gap {gap * 1000:.4f} mm)", primitive=i)
    detail["flippedFraction"] = detail["flippedTriangles"] / max(1, detail["triangles"])
    if detail["flippedFraction"] > T["flippedFraction"]:
        return fail(f"{detail['flippedFraction']:.2%} of triangles split the other way")
    if weighted_a != weighted_c:
        return fail("weighted joints differ by name", onlyMedium=sorted(weighted_a - weighted_c),
                    onlyClass=sorted(weighted_c - weighted_a))
    ja, jc = a["joints"] or {}, c["joints"] or {}
    one_side = sorted(set(ja) ^ set(jc))
    outside = [n for n in one_side if n not in body_bones]
    if outside:
        return fail("joints listed on one side only are not body-skeleton bones", joints=outside)
    missing = sorted(n for n in weighted_a if n not in ja or n not in jc)
    if missing:
        return fail("weighted joints missing from a skin", joints=missing)
    residual = max((float(np.linalg.norm(jc[n] - scale * ja[n])) for n in weighted_a), default=0.0)
    if residual > JOINT_TOLERANCE:
        return fail(f"weighted joints are not at the x{scale} skeleton (max {residual:.5f} m)")
    detail.update({"permutationSha256": digest.hexdigest(), "jointResidualMaxM": residual,
                   "unweightedJointsOneSide": one_side, "morphs": dict(sorted(morphs.items()))})
    return True, None, detail


def _uv_order(prim, pos):
    """Vertex order by UV0, then the other UV sets, then position (ties: identical texture coordinates, e.g. mirrored
    islands, where the pairing cannot change what the materials see)."""
    keys = [pos[:, 2], pos[:, 1], pos[:, 0]]
    for uv in reversed(prim["uvs"]):
        keys += [uv[:, 1], uv[:, 0]]
    return np.lexsort(keys)


def materials_apply(medium_path, cls_path, scale, body_bones):
    """The reshaped route's surface proof (approved 26 Nov 2026), in place of proof 3 for a listed class mesh the game
    authored with its own shape and skin: the Medium's materials still apply unchanged when every vertex keeps its
    texture coordinates. Under a bijection on UV0 (ties broken by the other UV sets, then the class-scaled position):
      same primitives, vertex counts and material slots in order; UV0 within 1e-6, UV1 within 1/128, other UV sets
      within 1e-6; every joint the class skin lists is a body-skeleton bone or listed by the Medium skin too (a joint
      neither is would be grafted at runtime); every weighted class joint is listed by the Medium skin at the class scale
      (proof 4); no vertex further than 1 cm from the class-scaled Medium (a wrong-file guard).
    The class mesh's positions, triangles and weights are the game's own: their differences from the class-scaled
    Medium are recorded (largest and median offset, vertices over 1 mm, triangles not in the Medium's set under the
    mapping, vertices reweighted by joint name), never gated. Returns (ok, reason, detail)."""
    T = RESHAPED
    a, c = mesh_data(medium_path), mesh_data(cls_path)
    da, dc = skin_detail(medium_path), skin_detail(cls_path)
    detail = {"uv1MaxDiff": 0.0, "positionMaxM": 0.0, "positionMedianM": 0.0, "verticesOver1mm": 0, "vertices": 0,
              "triangles": 0, "trianglesNotInMedium": 0, "verticesReweighted": 0}

    def fail(why, **extra):
        return False, why, {**detail, **extra}
    pa, pc = a["prims"], c["prims"]
    if len(pa) != len(pc) or any(len(x["pos"]) != len(y["pos"]) for x, y in zip(pa, pc)):
        return fail("primitives or vertex counts differ")
    if [(x["slot"], x["material"]) for x in pa] != [(y["slot"], y["material"]) for y in pc]:
        return fail("material slots differ")
    digest, offsets = hashlib.sha256(), []
    weighted_a, weighted_c = set(), set()
    for i, (x, y) in enumerate(zip(pa, pc)):
        if not x["uvs"] or len(x["uvs"]) != len(y["uvs"]) or x["idx"] is None or y["idx"] is None:
            return fail("UV sets or indices missing or differ in number", primitive=i)
        med_scaled = x["pos"] * scale
        perm = np.empty(len(y["pos"]), dtype=np.int64)
        perm[_uv_order(y, y["pos"])] = _uv_order(x, med_scaled)     # class vertex -> Medium vertex
        digest.update(perm.astype("<u4").tobytes())
        for k in range(len(x["uvs"])):
            d = float(np.abs(y["uvs"][k] - x["uvs"][k][perm]).max())
            if k == 1:
                detail["uv1MaxDiff"] = max(detail["uv1MaxDiff"], d)
            if d > (T["uv0"] if k == 0 else T["uv1"] if k == 1 else T["uv"]):
                return fail("no vertex bijection on UV0" if k == 0 else f"UV{k} differs under the mapping (max {d:.6f})",
                            primitive=i)
        offsets.append(np.linalg.norm(y["pos"] - med_scaled[perm], axis=1))
        tri_m = Counter(_rotation(t) for t in x["idx"].reshape(-1, 3).astype(np.int64))
        tri_c = Counter(_rotation(t) for t in perm[y["idx"].reshape(-1, 3).astype(np.int64)])
        detail["triangles"] += sum(tri_c.values())
        detail["trianglesNotInMedium"] += sum((tri_c - tri_m).values())
        wa, wc = _weights_by_name(da, i), _weights_by_name(dc, i)
        detail["verticesReweighted"] += sum(wc[v] != wa[m] for v, m in enumerate(perm))
        for e in wa:
            weighted_a |= set(e)
        for e in wc:
            weighted_c |= set(e)
    off = np.concatenate(offsets)
    detail.update({"vertices": int(len(off)), "positionMaxM": float(off.max()), "positionMedianM": float(np.median(off)),
                   "verticesOver1mm": int((off > 1e-3).sum()), "permutationSha256": digest.hexdigest(),
                   "weightedOnlyMedium": sorted(weighted_a - weighted_c), "weightedOnlyClass": sorted(weighted_c - weighted_a)})
    if detail["positionMaxM"] > T["wrongFileCapM"]:
        return fail(f"a vertex is {detail['positionMaxM'] * 100:.2f} cm from the x{scale} Medium (over the 1 cm cap)")
    ja, jc = a["joints"] or {}, c["joints"] or {}
    grafted = sorted(n for n in jc if n not in body_bones and n not in ja)
    if grafted:
        return fail("joints the class skin lists are neither body-skeleton bones nor listed by the Medium skin",
                    joints=grafted)
    unlisted = sorted(n for n in weighted_c if n not in ja or n not in jc)
    if unlisted:
        return fail("weighted class joints the Medium skin does not list", joints=unlisted)
    residual = max((float(np.linalg.norm(jc[n] - scale * ja[n])) for n in weighted_c), default=0.0)
    detail["jointResidualMaxM"] = residual
    if residual > T["jointM"]:
        return fail(f"weighted joints are not at the x{scale} skeleton (max {residual:.5f} m)")
    return True, None, detail


def reshaped_mask(coverage, coverage_dir, check, target, medium_path, cls, cls_sha, class_body_sha, medium_entry,
                  published_sha):
    """The body mask a reshaped class mesh brings (approved 26 Nov 2026: "the Medium mask's own policy, and only after
    the generator reproduces it"). Two runs of build-companion-masks.mjs --models-url: `check`, a Medium run that must
    regenerate the Medium's published mask byte for byte (published_sha), and `coverage`, the --archetype run, made by
    the same generator (sha256) with the same method and shared-UV policy, no fitted occlusion. Its one record for this
    mesh must be projected from this staged GLB (its sha256) onto the class body the index serves (its sha256), in the
    Medium mask's body UV tiles, with its PNG beside it as recorded. Returns (record, png path, None) or (None, None,
    reason)."""
    if coverage.get("formatVersion") != 1 or coverage.get("archetype") != cls:
        return None, None, f"the mask run is not a {cls} run (archetype {coverage.get('archetype')!r})"
    if check.get("formatVersion") != 1 or check.get("archetype") is not None:
        return None, None, "the check run is not a Medium run"
    if "occlusionPolicy" in coverage or "occlusionPolicy" in check:
        return None, None, "fitted occlusion is not part of the reshaped route's policy"
    if (not coverage.get("generatorSha256") or coverage.get("generatorSha256") != check.get("generatorSha256")
            or coverage.get("method") != check.get("method") or coverage.get("sharedUvPolicy") != check.get("sharedUvPolicy")):
        return None, None, "the mask and its check were not made by the same generator and policy"
    checks = [r for r in check.get("records", []) if r.get("source") == medium_path]
    if published_sha is None:
        return None, None, "the Medium's published mask is not on disk to check against"
    if len(checks) != 1 or checks[0].get("sha256") != published_sha:
        return None, None, "the check run does not reproduce the Medium's published mask"
    if coverage.get("bodySha256") != class_body_sha:
        return None, None, f"the mask was projected onto another body ({str(coverage.get('bodySha256'))[:8]})"
    records = [r for r in coverage.get("records", []) if r.get("source") == target]
    if len(records) != 1:
        return None, None, f"the mask run has {len(records)} records for this mesh"
    record = records[0]
    if record.get("meshSha256") != cls_sha:
        return None, None, "the mask was projected from another file of this mesh"
    if record.get("uvTiles") != medium_entry.get("bodyMaskUvTiles"):
        return None, None, f"the mask's UV tiles {record.get('uvTiles')} are not the Medium mask's"
    png = Path(coverage_dir) / record["file"]
    if not png.is_file() or sha256(png) != record.get("sha256"):
        return None, None, f"the mask file {record['file']} is missing or not the recorded one"
    return record, png, None


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
    # --staging <run dir> (repeatable): a fresh read of today's containers (scripts/archetypes/run-light-bulk.sh), its
    # GLBs in <run dir>/source-glb, searched before the S11 folders. Its run record (<run dir>/run.json) is the currency
    # proof: every batch read with the pinned map and passed the usmap window guard. With --staging, a mesh from the
    # S11 folders (read before 17 Nov) still needs --proven.
    ap.add_argument("--staging", action="append", default=[])
    # --live-equal-medium: proof 1' (see live_equal) where the staged Medium is not byte-identical to the live one.
    # Proposed 23 Nov 2026; use it only with the coordinator's approval of that rule.
    ap.add_argument("--live-equal-medium", action="store_true")
    # --same-surface-permuted: proof 3' (see surface_permuted) where proof 3 fails only on vertex order. Approved by the
    # coordinator 26 Nov 2026 with the tolerances in SURFACE_PERMUTED.
    ap.add_argument("--same-surface-permuted", action="store_true")
    # --reshaped NAME[,NAME] (repeatable): class meshes (short names, e.g. SK_Casual_BasicTshirt_L) that may take the
    # reshaped route (see materials_apply); approved by the coordinator 26 Nov 2026. Never automatic: only listed rows.
    # --reshaped-masks <derived-coverage.json from build-companion-masks.mjs --archetype>: their own body masks, and
    # --reshaped-mask-check <derived-coverage.json of the same generator's Medium run>: it must regenerate each listed
    # row's Medium mask byte for byte, so the class masks were made with the Medium masks' own policy.
    ap.add_argument("--reshaped", action="append", default=[])
    ap.add_argument("--reshaped-masks")
    ap.add_argument("--reshaped-mask-check")
    # --own-weights NAME[,NAME] (repeatable): class meshes (short names) that may take the own-weights route (see
    # own_weights_surface): the user's yes, 28 Nov 2026, for SK_Sneakers_L/_H and SK_StarterSet_TShirt_L/_H. Never
    # automatic: only listed rows. They keep the Medium's body masks, as proof 3 and 3' rows do.
    ap.add_argument("--own-weights", action="append", default=[])
    args = ap.parse_args()
    reshaped_names = {n.strip() for arg in args.reshaped for n in arg.split(",") if n.strip()}
    own_weights_names = {n.strip() for arg in args.own_weights for n in arg.split(",") if n.strip()}
    if reshaped_names & own_weights_names:
        sys.exit(f"listed for both the reshaped and the own-weights route: {sorted(reshaped_names & own_weights_names)}")
    if (args.reshaped_masks or args.reshaped_mask_check) and not reshaped_names:
        sys.exit("--reshaped-masks and --reshaped-mask-check need --reshaped")
    if bool(args.reshaped_masks) != bool(args.reshaped_mask_check):
        sys.exit("--reshaped-masks and --reshaped-mask-check go together")
    load_json = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
    coverage = load_json(args.reshaped_masks) if args.reshaped_masks else None
    mask_check = load_json(args.reshaped_mask_check) if args.reshaped_mask_check else None
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
              "classes": {}, "meshes": {}, "refused": {}, "skipped": {}, "proof1Prime": {}, "proof3Prime": {},
              "reshaped": {}, "freshPair": {}, "ownWeights": {}}

    # The Archetype mesh swaps the definitions author: Medium skeletal mesh -> class mesh. Every class mesh named here
    # ends in exactly one of report["meshes"] (added), report["refused"] (a proof failed) or report["skipped"] (never
    # proven, with the reason): nothing is dropped silently (coordinator, 23 Nov 2026).
    named = {cls: {} for cls in CLASSES}  # class -> Medium -> every class mesh the definitions swap it for
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
                        if target:
                            named[cls].setdefault(medium, set()).add(target)
    conflicts = {medium for cls in CLASSES for medium, targets in named[cls].items() if len(targets) > 1}
    swaps = {cls: {medium: next(iter(targets)) for medium, targets in named[cls].items() if len(targets) == 1}
             for cls in CLASSES}
    report["swapConflicts"] = sorted(conflicts)

    def skip(target, cls, medium, reason, **detail):
        """A class mesh left out without being proven, and why (one entry per Medium mesh that names it)."""
        row = report["skipped"].setdefault(target, {"class": cls, "reasons": []})
        row["reasons"].append({"medium": medium, "reason": reason, **detail})

    for cls in CLASSES:
        for medium_path, targets in named[cls].items():
            entry = assets["meshes"].get(medium_path)
            for target in sorted(targets):
                if medium_path in conflicts:
                    skip(target, cls, medium_path, "swap conflict",
                         candidates={c: sorted(named[c].get(medium_path, ())) for c in CLASSES})
                elif target in assets["meshes"]:
                    skip(target, cls, medium_path, "already in the active index")
                elif entry is None:
                    skip(target, cls, medium_path, "medium not in the active index")
                elif entry.get("kind") != "skeletal":
                    skip(target, cls, medium_path, "medium not skeletal in the active index")

    staged, fresh = {}, set()
    report["stagingRuns"] = []
    for run in map(Path, args.staging):
        record = json.loads((run / "run.json").read_text(encoding="utf-8"))
        if record.get("policy") != "archetypes-light-bulk-run-v1":
            sys.exit(f"{run / 'run.json'} is not a run-light-bulk.sh record")
        bad = {b: r for b, r in record.get("batches", {}).items()
               if r.get("guard", {}).get("exitCode") != 0 or r.get("mappingSha256", "").lower() != record["usmapSha256"].lower()
               or r.get("missing") or not isinstance(r.get("glb"), dict) or r["glb"].get("exit") != 0}
        if not record.get("control", {}).get("ok"):
            sys.exit(f"{run}: the control (the patched map re-reads unchanged meshes byte for byte) has not passed")
        if not record.get("batches") or bad:
            sys.exit(f"{run}: batches without a clean read (guard, pinned map, every package): {sorted(bad) or 'none run'}")
        report["stagingRuns"].append({"dir": str(run), "runSha256": sha256(run / "run.json"),
                                      "usmapSha256": record["usmapSha256"], "batches": sorted(record["batches"])})
        for f in sorted((run / "source-glb").glob("*.glb")):
            staged.setdefault(f.name, []).append(f)
            fresh.add(f)
    for folder in STAGING:
        for f in (models / folder / "source-glb").glob("*.glb"):
            staged.setdefault(f.name, []).append(f)
    by_sha = {}
    def staged_sha(f):
        if f not in by_sha:
            by_sha[f] = sha256(f)
        return by_sha[f]

    fresh_medium_checks = {}  # Medium object path -> its fresh read's proof 1' result, shared by its class meshes

    def fresh_pair(medium_path, entry, candidates, target, stale):
        """The fresh-pair rule (approved 26 Nov 2026). The live Medium is byte-identical to an older staged read, but
        that read's class sibling `stale` is not current. Returns (the fresh Medium read to use, or None; the record).
        A fresh read is never byte-identical to the live mesh, so it must be live-equal to it (proof 1', the same
        tolerances every fresh row meets); its class sibling must be in the same run. Nothing falls back further."""
        rel = lambda f: os.path.relpath(f, models).replace(os.sep, "/")
        record = {"byteMatchedMedium": rel(stale.parent / (medium_path.rsplit(".", 1)[-1] + ".glb")),
                  "staleSibling": rel(stale), "freshMedium": None}
        fresh_m = next((f for f in candidates if f in fresh), None)
        if fresh_m is None:
            return None, {**record, "verdict": "no fresh read of the Medium"}
        record["freshMedium"] = rel(fresh_m)
        if medium_path not in fresh_medium_checks:
            live_file = (index_dir / entry["url"]).resolve()
            fresh_medium_checks[medium_path] = (live_equal(fresh_m, live_file) if live_file.is_file()
                                                else (False, "live Medium file missing", {}))
        ok, why, detail = fresh_medium_checks[medium_path]
        record.update({"freshMediumSha256": staged_sha(fresh_m), "liveSha256": entry.get("sha256")})
        if not ok:
            return None, {**record, "verdict": f"the fresh Medium is not live-equal: {why}", **detail}
        if not (fresh_m.parent / stale.name).exists():
            return None, {**record, "verdict": "no fresh read of the class mesh beside the fresh Medium"}
        return fresh_m, {**record, "verdict": "used", "morphs": detail["morphs"],
                         "liveEqualMargins": live_equal_margins(fresh_m, (index_dir / entry["url"]).resolve())}

    added, item_masks = {}, {}
    masks_added, preview = {}, {}  # reshaped rows: their own mask (png, publish path, sha); preview entries (no mask yet)
    medium_body = assets["attachmentBody"]["source"]
    body_bones, registries = set(), {}
    if args.same_surface_permuted or reshaped_names or own_weights_names:
        # Proof 3', the reshaped and the own-weights route need the body skeleton's bone names (joints a skin lists on one side only must
        # be among them) and the side registries (a mesh they name is refused).
        body_glb = [f for f in staged.get(medium_body.rsplit(".", 1)[-1] + ".glb", [])
                    if staged_sha(f) == assets["meshes"][medium_body]["sha256"]]
        if not body_glb:
            sys.exit("proof 3' / reshaped route: the Medium body the index serves is not staged, so its bones are unknown")
        bj, _ = glb(body_glb[0])
        body_bones = {bj["nodes"][i].get("name") for i in bj["skins"][0]["joints"]}
        registries = {f"assets.json {s}": json.dumps(assets[s]) for s in SIDE_REGISTRY_SECTIONS if s in assets}
        registries.update({f: (index_dir / f).read_text(encoding="utf-8") for f in SIDE_REGISTRY_FILES
                           if (index_dir / f).is_file()})
        report["proof3PrimeRules"] = {"tolerances": SURFACE_PERMUTED, "registries": sorted(registries),
                                      "bodyBones": len(body_bones), "bodyFile": os.path.relpath(body_glb[0], models)}
    for medium_path, entry in sorted(assets["meshes"].items()):
        if entry.get("kind") != "skeletal" or medium_path in conflicts:
            continue
        name = medium_path.rsplit(".", 1)[-1]
        candidates = staged.get(name + ".glb", [])
        match = [f for f in candidates if staged_sha(f) == entry.get("sha256")]
        proof1 = {"proof1": "bytes"}
        wanted = [swaps[c].get(medium_path) for c in CLASSES]
        if not match and args.live_equal_medium and candidates and any(t and t not in assets["meshes"] for t in wanted):
            # Proof 1' on one staged copy: today's read when there is one (candidates list --staging first), else the
            # newest S11 read. No fallback to another copy: a failing row is skipped and listed.
            live_file = (index_dir / entry["url"]).resolve()
            f = candidates[0]
            ok, why, detail = live_equal(f, live_file) if live_file.is_file() else (False, "live Medium file missing", {})
            report["proof1Prime"][medium_path] = {
                "verdict": "pass" if ok else why, "stagedFile": os.path.relpath(f, models).replace(os.sep, "/"),
                "liveUrl": entry.get("url"), "targets": {c: swaps[c].get(medium_path) for c in CLASSES}, **detail}
            if ok:
                match = [f]
                proof1 = {"proof1": "live-equal", "morphs": detail["morphs"]}
            else:
                for cls in CLASSES:
                    target = swaps[cls].get(medium_path)
                    if target and target not in assets["meshes"]:
                        skip(target, cls, medium_path, why, liveUrl=entry.get("url"),
                             stagedFile=os.path.relpath(f, models).replace(os.sep, "/"), **detail)
                continue
        if not match:
            # Proof 1 (same build) cannot hold: the staged class meshes belong to another Medium build, or to none.
            for cls in CLASSES:
                target = swaps[cls].get(medium_path)
                if not target or target in assets["meshes"]:
                    continue
                if candidates:
                    skip(target, cls, medium_path, "medium sibling repointed", liveUrl=entry.get("url"),
                         liveSha256=entry.get("sha256"),
                         stagedSha256=sorted({staged_sha(f) for f in candidates}))
                else:
                    skip(target, cls, medium_path, "medium sibling not staged")
            continue
        medium_glb = match[0]
        medium = mesh_data(medium_glb)
        for cls, (tag, scale) in CLASSES.items():
            target = swaps[cls].get(medium_path)
            if not target or target in assets["meshes"]:
                continue
            file = medium_glb.parent / (target.rsplit(".", 1)[-1] + ".glb")
            pair_glb, pair_medium, pair_proof1 = medium_glb, medium, proof1
            if (args.live_equal_medium and current is not None and file.exists() and file not in fresh
                    and target not in current["proven"]):
                # The fresh-pair rule (26 Nov 2026): the live Medium is byte-identical to an older staged read, but that
                # read's class sibling is not current. A fresh read of the same Medium stands in only if it is
                # live-equal (proof 1'); its own class sibling then takes every proof below. Otherwise the row is
                # refused for currency, as before.
                used, record = fresh_pair(medium_path, entry, candidates, target, file)
                report["freshPair"][target] = record
                if used is not None:
                    pair_glb, pair_medium = used, mesh_data(used)
                    pair_proof1 = {"proof1": "live-equal", "morphs": record["morphs"],
                                   "freshPair": {k: record[k] for k in ("byteMatchedMedium", "staleSibling",
                                                                         "freshMedium", "freshMediumSha256",
                                                                         "liveSha256", "liveEqualMargins")}}
                    file = used.parent / file.name
            if not file.exists():
                report["refused"][target] = ["not staged beside its Medium sibling"]
                continue
            ok, proof = prove(pair_medium, mesh_data(file), scale, target, entry["slots"])
            if not ok and args.same_surface_permuted and all(p.endswith(PERMUTABLE) for p in proof["problems"]):
                # Proof 3': the in-order surface proof failed only on vertex order. Re-prove the whole surface under a
                # vertex bijection; a mesh a side registry names is refused, whatever the geometry says.
                names = re.compile("|".join(rf"(?<![\w/]){re.escape(p.rsplit('.', 1)[-1])}(?![\w])"
                                            for p in (medium_path, target)))
                named_in = sorted(r for r, text in registries.items() if names.search(text))
                if named_in:
                    ok3, why3, detail3 = False, f"named in a side registry: {', '.join(named_in)}", {}
                else:
                    ok3, why3, detail3 = surface_permuted(pair_glb, file, scale, body_bones)
                report["proof3Prime"][target] = {"verdict": "pass" if ok3 else why3, "class": cls, "medium": medium_path,
                                                 "inOrderProblems": proof["problems"], **detail3}
                if ok3:
                    ok, proof["proof3"], proof["proof3Prime"] = True, "permuted", detail3
                    proof["inOrderProblems"], proof["problems"] = proof["problems"], []
                else:
                    proof["problems"] = proof["problems"] + [f"proof 3': {why3}"]
            if not ok and target.rsplit(".", 1)[-1] in own_weights_names:
                # The own-weights route (the user's yes, 28 Nov 2026), only for listed rows: the Medium surface in the
                # same vertex order with UV0 islands whole tiles away and the game's own weights (own_weights_surface).
                # Every other proof problem, and a side registry naming either mesh, keeps the row refused.
                other = [p for p in proof["problems"] if not (p.endswith(OWN_WEIGHTS_REPLACES) or p.startswith("proof 3':"))]
                names = re.compile("|".join(rf"(?<![\w/]){re.escape(p.rsplit('.', 1)[-1])}(?![\w])"
                                            for p in (medium_path, target)))
                named_in = sorted(r for r, text in registries.items() if names.search(text))
                detail_w = {}
                if other:
                    why_w = "; ".join(other)
                elif named_in:
                    why_w = f"named in a side registry: {', '.join(named_in)}"
                else:
                    _, why_w, detail_w = own_weights_surface(pair_glb, file, scale, body_bones)
                report["ownWeights"][target] = {"verdict": why_w or "pass", "class": cls, "medium": medium_path,
                                                "inOrderProblems": proof["problems"], **detail_w}
                if why_w is None:
                    ok, proof["proof3"], proof["ownWeights"] = True, "own weights", detail_w
                    proof["inOrderProblems"], proof["problems"] = proof["problems"], []
                else:
                    proof["problems"] = proof["problems"] + [f"own-weights route: {why_w}"]
            if not ok and target.rsplit(".", 1)[-1] in reshaped_names:
                # The reshaped route (approved 26 Nov 2026), only for listed rows: proof 3 becomes "the materials apply",
                # proof 5 the mesh's own body mask. Every other proof problem keeps the row refused.
                other = [p for p in proof["problems"] if not (p.endswith(PERMUTABLE) or p.startswith(RESHAPED_REPLACES[-1])
                                                              or p.startswith(RESHAPED_BIND))]
                names = re.compile("|".join(rf"(?<![\w/]){re.escape(p.rsplit('.', 1)[-1])}(?![\w])"
                                            for p in (medium_path, target)))
                named_in = sorted(r for r, text in registries.items() if names.search(text))
                applied_body = ((assets.get("archetypes") or {}).get(cls) or {}).get("body")
                detail_r, record, png = {}, None, None
                if other:
                    why_r = "; ".join(other)
                elif named_in:
                    why_r = f"named in a side registry: {', '.join(named_in)}"
                elif any(medium_path in masks for masks in assets.get("itemBodyMasks", {}).values()):
                    why_r = "the Medium carries item masks, which would need their own class masks too"
                elif not entry.get("bodyMaskUrl"):
                    why_r = "the Medium has no body mask for this one to replace"
                elif not applied_body or applied_body not in assets["meshes"]:
                    why_r = f"the {cls} body is not applied in the active index (the mask is projected onto it)"
                else:
                    ok_r, why_r, detail_r = materials_apply(pair_glb, file, scale, body_bones)
                    if ok_r and coverage is not None:
                        published = (index_dir / entry["bodyMaskUrl"]).resolve()
                        record, png, why_r = reshaped_mask(
                            coverage, Path(args.reshaped_masks).parent, mask_check, target, medium_path, cls,
                            staged_sha(file), assets["meshes"][applied_body]["sha256"], entry,
                            sha256(published) if published.is_file() else None)
                report["reshaped"][target] = {"verdict": why_r or ("pass" if record else "pass, mask pending"),
                                              "class": cls, "medium": medium_path, "inOrderProblems": proof["problems"],
                                              **detail_r, **({"mask": record["file"], "maskSha256": record["sha256"]}
                                                             if record else {})}
                if why_r is None:
                    ok, proof["proof3"], proof["reshaped"] = True, "reshaped", detail_r
                    proof["inOrderProblems"], proof["problems"] = proof["problems"], []
                    if record:
                        proof["mask"] = {"file": record["file"], "sha256": record["sha256"], "uvTiles": record["uvTiles"],
                                         "coverage": str(args.reshaped_masks), "coverageSha256": sha256(args.reshaped_masks),
                                         "png": png}
                    else:
                        proof["previewOnly"] = True
                else:
                    proof["problems"] = proof["problems"] + [f"reshaped route: {why_r}"]
            proof.update({"class": cls, "medium": medium_path, "file": os.path.relpath(file, models).replace(os.sep, "/"),
                          "sha256": staged_sha(file), "mediumSha256": entry["sha256"], **pair_proof1})
            if not ok:
                report["refused"][target] = proof["problems"]
                continue
            if file in fresh:
                proof["currency"] = "read from today's containers (stagingRuns)"
            elif args.staging and current is None:
                report["refused"][target] = ["read before the 17 Nov update, and no --proven proof given"]
                continue
            elif current is not None:
                package = "Discovery/Content/" + target.split(".")[0][len("/Game/"):] + ".uasset"
                proof["containers17Nov"] = current["packages"].get(package)
                if target not in current["proven"]:
                    report["refused"][target] = [f"not current in the 17 Nov containers: "
                                                 f"{current['refused'].get(target, 'no proof row')}"]
                    continue
            new = {k: v for k, v in entry.items() if k not in ("url", "sha256")}
            hosted = models / args.publish_dir / "meshes" / file.name if args.publish_dir else file
            proof["publish"] = os.path.relpath(hosted, models).replace(os.sep, "/")
            new["url"] = os.path.relpath(hosted, index_dir).replace(os.sep, "/")
            new["sha256"] = proof["sha256"]
            if proof.get("proof3") == "reshaped":
                # Its own body mask, never the Medium's (whose shape and skin it was projected from).
                for k in ("bodyMaskUrl", "bodyMaskUvTiles", "coverageSource"):
                    new.pop(k, None)
                if proof.pop("previewOnly", False):
                    # No mask yet: the generator's preview index only, never the result.
                    preview[target] = (new, proof)
                    report["refused"][target] = ["reshaped route: needs its own body mask (--reshaped-masks); "
                                                 "written to reshaped-preview/ for the mask generator"]
                    continue
                png = proof["mask"].pop("png")
                mask_hosted = models / args.publish_dir / "coverage" / png.name if args.publish_dir else png
                proof["mask"]["publish"] = os.path.relpath(mask_hosted, models).replace(os.sep, "/")
                new.update({"bodyMaskUrl": os.path.relpath(mask_hosted, index_dir).replace(os.sep, "/"),
                            "bodyMaskUvTiles": proof["mask"]["uvTiles"], "coverageSource": "derived-projection"})
                masks_added[target] = (os.path.relpath(png, models).replace(os.sep, "/"), proof["mask"]["publish"],
                                       proof["mask"]["sha256"])
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
        applied = (assets.get("archetypes") or {}).get(cls)
        body_file = None
        if target in added:
            body_file = models / report["meshes"][target]["file"]
        elif target in assets["meshes"] and applied and applied.get("body") == target and medium_body_glb:
            # Applied earlier (23 Nov 2026: Light). Re-prove it against today's Medium body, so that a later run on the
            # applied index keeps the class (its new meshes need it) only while the Medium body is still the one it was
            # proven against: the staged class body must be the bytes the index serves, beside the matching Medium.
            staged_body = medium_body_glb[0].parent / (target.rsplit(".", 1)[-1] + ".glb")
            if staged_body.exists() and staged_sha(staged_body) == assets["meshes"][target].get("sha256"):
                body_file = staged_body
        if not target or body_file is None or not medium_body_glb:
            report["classes"][cls] = {"refused": "class body not proven"}
            continue
        mj, _ = glb(medium_body_glb[0])
        cj, _ = glb(body_file)
        measured, residual, rotation = skeleton_scale(mj, cj, scale)
        # 1e-5 m (a hundredth of a millimetre) and 1e-5 per quaternion component: float32 rounding, nothing more.
        if abs(measured - scale) > 1e-5 or residual > 1e-5 or rotation > 1e-5:
            report["classes"][cls] = {"refused": f"skeleton is not a x{scale} scale ({measured}, residual {residual} m, rot {rotation})"}
            continue
        record = {"body": target, "skeletonScale": scale, "boundsOrigin": [round(v * scale, 6) for v in medium_origin]}
        if applied and target not in added and applied != record:
            report["classes"][cls] = {"refused": f"the applied record {applied} is not today's proof {record}"}
            continue
        archetypes[cls] = record
        report["classes"][cls] = {"body": target, "skeletonScale": scale, "measuredScale": measured,
                                  "translationResidualMaxM": residual, "rotationMaxDiff": rotation,
                                  "alreadyApplied": target not in added}

    # A class without a proven body cannot be built, so none of its meshes join (with neither, the index is unchanged).
    for k in sorted(added):
        if report["meshes"][k]["class"] not in archetypes:
            skip(k, report["meshes"][k]["class"], report["meshes"][k]["medium"], "class body not proven")
    added = {k: v for k, v in added.items() if report["meshes"][k]["class"] in archetypes}
    # A class mesh reached from several Medium meshes counts once: added or refused through any of them wins.
    for k in [k for k in report["skipped"] if k in added or k in report["refused"]]:
        del report["skipped"][k]
    every = {target for cls in CLASSES for targets in named[cls].values() for target in targets}
    accounted = set(added) | set(report["refused"]) | set(report["skipped"])
    if every - accounted:
        sys.exit(f"{len(every - accounted)} class meshes neither added, refused nor skipped, e.g. {sorted(every - accounted)[:3]}")
    if set(added) & set(report["refused"]):
        sys.exit(f"class meshes both added and refused (reached from two Medium meshes): {sorted(set(added) & set(report['refused']))[:3]}")
    counts = {cls: {} for cls in CLASSES}
    for k, row in report["skipped"].items():
        why = "; ".join(sorted({r["reason"] for r in row["reasons"]}))
        counts[row["class"]][why] = counts[row["class"]].get(why, 0) + 1
    report["skippedCounts"] = {cls: dict(sorted(c.items())) for cls, c in counts.items()}
    item_masks = {source: {k: v for k, v in masks.items() if k in added} for source, masks in item_masks.items()}
    item_masks = {source: masks for source, masks in item_masks.items() if masks}
    result = dict(assets)
    result["meshes"] = {**assets["meshes"], **added}
    if item_masks:
        result["itemBodyMasks"] = {k: {**assets.get("itemBodyMasks", {}).get(k, {}), **item_masks.get(k, {})}
                                   for k in [*assets.get("itemBodyMasks", {}),
                                             *sorted(set(item_masks) - set(assets.get("itemBodyMasks", {})))]}
    if archetypes:
        # Additive: a class applied earlier keeps its record even when this run cannot re-prove it.
        result["archetypes"] = {**(assets.get("archetypes") or {}), **archetypes}
    (out / "assets.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    (out / "skin-pairs.json").write_text(json.dumps(skin_pairs, separators=(",", ":")), encoding="utf-8")
    report["added"] = {cls: sorted(k for k, v in report["meshes"].items() if v["class"] == cls and k in added) for cls in CLASSES}
    if reshaped_names:
        report["reshapedRules"] = {"tolerances": RESHAPED, "listed": sorted(reshaped_names),
                                   "masks": str(args.reshaped_masks) if coverage is not None else None,
                                   "masksSha256": sha256(args.reshaped_masks) if coverage is not None else None,
                                   "maskCheck": str(args.reshaped_mask_check) if mask_check is not None else None,
                                   "maskCheckSha256": sha256(args.reshaped_mask_check) if mask_check is not None else None,
                                   "maskPolicy": {k: (coverage or {}).get(k) for k in ("method", "sharedUvPolicy",
                                                                                      "generatorSha256")},
                                   "notTried": sorted(reshaped_names - {k.rsplit(".", 1)[-1] for k in report["reshaped"]})}
    if own_weights_names:
        report["ownWeightsRules"] = {"tolerances": OWN_WEIGHTS, "listed": sorted(own_weights_names),
                                     "notTried": sorted(own_weights_names
                                                        - {k.rsplit(".", 1)[-1] for k in report["ownWeights"]})}
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    # source (models-relative) <TAB> where the index expects it <TAB> sha256: the apply copies, then checks the sha256.
    # A reshaped row's own body mask follows its mesh.
    (out / "publish-list.tsv").write_text("".join(
        f"{report['meshes'][k]['file']}\t{report['meshes'][k]['publish']}\t{report['meshes'][k]['sha256']}\n"
        + ("\t".join(masks_added[k]) + "\n" if k in masks_added else "")
        for k in sorted(added)), encoding="utf-8")
    if preview:
        # Reshaped rows that passed everything but their own mask: an index for the mask generator only (it resolves the
        # class mesh from an index), never to apply. Same publish-list form, so a preview server can serve the GLBs.
        prev = out / "reshaped-preview"
        prev.mkdir(exist_ok=True)
        shown = {k: v for k, (v, p) in preview.items() if p["class"] in archetypes}
        (prev / "assets.json").write_text(json.dumps({**result, "meshes": {**result["meshes"], **shown}},
                                                     separators=(",", ":")), encoding="utf-8")
        (prev / "publish-list.tsv").write_text("".join(f"{p['file']}\t{p['publish']}\t{p['sha256']}\n"
                                                       for k, (v, p) in sorted(preview.items()) if k in shown),
                                               encoding="utf-8")
        (prev / "README.txt").write_text("Preview index for build-companion-masks.mjs --archetype only. Never apply it: "
                                         "its reshaped rows have no body mask yet.\n", encoding="utf-8")
    # Every proof 1' comparison, passing or not, with the morph targets that differ (the row table's morph columns).
    def morph_cells(m):
        m = m or {}
        return ("; ".join(f"{k}:{v}" for k, v in (m.get("changedCm") or {}).items()),
                "; ".join(m.get("onlyStaged") or []), "; ".join(m.get("onlyLive") or []))
    tab = "\t"
    (out / "proof1-prime.tsv").write_text(
        tab.join(["medium", "light", "heavy", "verdict", "differs", "morphsChangedCm", "morphsOnlyStaged",
                  "morphsOnlyLive"]) + "\n" + "".join(
            tab.join([k, v["targets"].get("light") or "", v["targets"].get("heavy") or "", v["verdict"],
                      str(v.get("differs", "")), *morph_cells(v.get("morphs"))]) + "\n"
            for k, v in sorted(report["proof1Prime"].items())), encoding="utf-8")
    # Every proof 3' attempt, passing or not: the recorded UV1 difference, flipped fraction, quad gap and permutation.
    if args.same_surface_permuted:
        cols = ["uv1MaxDiff", "positionMaxM", "normalMax", "flippedTriangles", "triangles", "flippedFraction",
                "quadGapMaxM", "permutationSha256"]
        (out / "proof3-prime.tsv").write_text(
            tab.join(["class mesh", "class", "medium", "verdict", *cols]) + "\n" + "".join(
                tab.join([k, v["class"], v["medium"], v["verdict"], *(str(v.get(c, "")) for c in cols)]) + "\n"
                for k, v in sorted(report["proof3Prime"].items())), encoding="utf-8")
        passed = sum(v["verdict"] == "pass" for v in report["proof3Prime"].values())
        print(f"  proof 3': {passed} of {len(report['proof3Prime'])} attempts pass")
    # Every reshaped-route attempt: what it replaced, the recorded differences and its mask.
    if reshaped_names:
        cols = ["uv1MaxDiff", "positionMaxM", "positionMedianM", "verticesOver1mm", "vertices", "trianglesNotInMedium",
                "triangles", "verticesReweighted", "jointResidualMaxM", "permutationSha256", "mask", "maskSha256"]
        (out / "reshaped.tsv").write_text(
            tab.join(["class mesh", "class", "medium", "verdict", *cols]) + "\n" + "".join(
                tab.join([k, v["class"], v["medium"], v["verdict"], *(str(v.get(c, "")) for c in cols)]) + "\n"
                for k, v in sorted(report["reshaped"].items())), encoding="utf-8")
        for k, v in sorted(report["reshaped"].items()):
            print(f"  reshaped route: {k.rsplit('.', 1)[-1]}: {v['verdict']}")
        if report["reshapedRules"]["notTried"]:
            print("  reshaped route: not tried (no failing proof row reached it): "
                  + ", ".join(report["reshapedRules"]["notTried"]))
    # Every own-weights attempt: the tile shifts it allowed and the reweight it recorded.
    if own_weights_names:
        cols = ["vertices", "verticesShifted", "islandsShifted", "shifts", "uv0ResidualStepsMax", "tilesMedium",
                "tilesClass", "uv1MaxDiff", "positionMaxM", "normalMax", "verticesReweighted", "weightMaxU8Steps",
                "jointResidualMaxM"]
        (out / "own-weights.tsv").write_text(
            tab.join(["class mesh", "class", "medium", "verdict", *cols]) + "\n" + "".join(
                tab.join([k, v["class"], v["medium"], v["verdict"], *(str(v.get(c, "")) for c in cols)]) + "\n"
                for k, v in sorted(report["ownWeights"].items())), encoding="utf-8")
        for k, v in sorted(report["ownWeights"].items()):
            print(f"  own-weights route: {k.rsplit('.', 1)[-1]}: {v['verdict']}"
                  + (f" ({v['verticesReweighted']} of {v['vertices']} vertices reweighted, max {v['weightMaxU8Steps']}"
                     f" u8 steps; {v['verticesShifted']} shifted)" if v["verdict"] == "pass" else ""))
        if report["ownWeightsRules"]["notTried"]:
            print("  own-weights route: not tried (no failing proof row reached it): "
                  + ", ".join(report["ownWeightsRules"]["notTried"]))
    # Every fresh-pair attempt: which stale sibling it replaced, and whether the fresh Medium stood in.
    if report["freshPair"]:
        cols = ["verdict", "byteMatchedMedium", "staleSibling", "freshMedium", "freshMediumSha256", "liveSha256"]
        margins = lambda v: ";".join(f"{q}={m['measured']:.3g} ({m['ofEpsilon']:.2%} of eps)"
                                     for q, m in v.get("liveEqualMargins", {}).items())
        (out / "fresh-pair.tsv").write_text(
            tab.join(["class mesh", *cols, "liveEqualMargins", "outcome"]) + "\n" + "".join(
                tab.join([k, *(str(v.get(c, "")) for c in cols), margins(v),
                          "added" if k in report["meshes"] else "refused" if k in report["refused"] else "skipped"])
                + "\n" for k, v in sorted(report["freshPair"].items())), encoding="utf-8")
        used = sum(v["verdict"] == "used" for v in report["freshPair"].values())
        print(f"  fresh pair: {used} of {len(report['freshPair'])} stale siblings replaced by a fresh live-equal read")
    # class mesh <TAB> class <TAB> reason <TAB> the Medium mesh that names it: the apply record copies this list.
    (out / "skipped.tsv").write_text("".join(
        f"{k}\t{row['class']}\t{r['reason']}\t{r['medium']}\n"
        for k, row in sorted(report["skipped"].items()) for r in row["reasons"]), encoding="utf-8")
    print(json.dumps({cls: len(v) for cls, v in report["added"].items()}), "class meshes;",
          len(report["refused"]), "refused;", len(report["skipped"]), "skipped;", "classes:", sorted(archetypes))
    for cls, c in report["skippedCounts"].items():
        for why, n in c.items():
            print(f"  skipped {cls}: {n} {why}")


if __name__ == "__main__":
    main()
