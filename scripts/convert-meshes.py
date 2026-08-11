# convert-meshes.py — headless Blender batch converter: .uemodel -> .glb
#
# Run via the Node wrapper (`npm run convert:meshes`), which invokes:
#   blender --background --python scripts/convert-meshes.py -- <addonsDir> <dumpRoot> [a:b]
#
# Uses the installed UEFormat addon's importer logic directly (no operator/registration
# needed) and exports skinned GLBs into public/models/. Each asset is imported into a
# fresh empty scene so skeletons/materials don't leak between conversions.
#
# Materials (M5): the dump's BaseColor is a NEUTRAL value/AO texture — all garment color
# comes from a compiled layered-dye material that is NOT in the dump. So here we bake the
# piece-shared, view-independent maps into the GLB — BaseColor (sRGB) darkened by the
# Occlusion channel + a tangent-space Normal — and emit the per-piece ColorMask as a
# sibling .png. The per-skin tint is reconstructed at runtime (see src/rig/CharacterRig.ts
# applyMaterial + scripts/import-catalog.ts). Baking BaseColor alone would still look gray.
import sys
import os
import glob
import json
import traceback
from pathlib import Path

import bpy

# ---- args after `--` -------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ADDONS_DIR = argv[0] if len(argv) > 0 else ""
DUMP_ROOT = argv[1] if len(argv) > 1 else ""
# optional "a:b" range (half-open, by index into the asset list) for chunked runs —
# Blender leaks data-blocks over very long sessions, so big batches can be split.
RANGE = argv[2] if len(argv) > 2 else ""

if ADDONS_DIR and ADDONS_DIR not in sys.path:
    sys.path.insert(0, ADDONS_DIR)

from io_scene_ueformat.importer.logic import UEFormatImport  # noqa: E402
from io_scene_ueformat.options import UEModelOptions  # noqa: E402

# Under --factory-startup the glTF I/O addon is normally on, but enable defensively.
try:
    import addon_utils
    addon_utils.enable("io_scene_gltf2", default_set=False, persistent=True)
except Exception:
    pass

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
# Prefer the auto-generated manifest (M6) when present, else the hand-authored list.
_generated = SCRIPT_DIR / "asset-sources.generated.json"
_sources_file = _generated if _generated.exists() else (SCRIPT_DIR / "asset-sources.json")
SOURCES = json.loads(_sources_file.read_text())["assets"]
MODELS_OUT = REPO_ROOT / "public" / "models"

OPTIONS = UEModelOptions(
    scale_factor=0.01,        # UE cm -> Blender m (~1.8 unit tall humanoid)
    import_morph_targets=False,
    import_collision=False,
    import_sockets=False,
    import_virtual_bones=False,
)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# Texture resolution
# ---------------------------------------------------------------------------
def _first_glob(d: Path, pats):
    for pat in pats:
        hits = sorted(glob.glob(str(d / pat)))
        if hits:
            return Path(hits[0])
    return None


def resolve_textures(asset, src: Path) -> dict:
    """Resolve the four PBR maps for an asset. Priority: explicit `asset.textures`
    (dump-relative paths) > backward-compat body `baseColorDir`/`baseColor` > sibling
    auto-glob next to the mesh. Any map may be None."""
    dump = Path(DUMP_ROOT)
    tex = asset.get("textures") or {}
    sib = src.parent

    def explicit(key):
        return (dump / tex[key]) if tex.get(key) and (dump / tex[key]).exists() else None

    base = explicit("baseColor")
    if base is None and asset.get("baseColor"):
        base_dir = (dump / asset["baseColorDir"]) if asset.get("baseColorDir") else sib
        for n in asset["baseColor"]:
            if (base_dir / n).exists():
                base = base_dir / n
                break
    if base is None:
        # *_CR = attachments' packed Color(+Roughness in alpha); *_D = head-style diffuse.
        # (Suffix globs can't collide with *_Decal.png / T_UI_*.png.)
        base = _first_glob(
            sib, ["*_BaseColor.png", "*_Color.png", "*BaseColor*.png", "*_CR.png", "*_D.png"]
        )

    return {
        "baseColor": base,
        # *_NOM = attachments' packed normal (XY in RG) — _fix_normal_z rebuilds Z anyway.
        "normal": explicit("normal")
        or _first_glob(sib, ["*_Normal.png", "*_N.png", "*Normal*.png", "*_NOM.png"]),
        "occlusion": explicit("occlusion")
        or _first_glob(sib, ["*_OcclusionCurvatureMaterialID.png", "*_ORM.png", "*Occlusion*.png"]),
        "colorMask": explicit("colorMask") or _first_glob(sib, ["*_ColorMask.png", "*ColorMask*.png"]),
        "emissive": explicit("emissive") or _first_glob(sib, ["*_Emissive.png", "*Emissive*.png"]),
    }


def _load_img(path, non_color=False):
    if not path or not Path(path).exists():
        return None
    try:
        img = bpy.data.images.load(str(path), check_existing=True)
    except Exception:
        return None
    try:
        img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    except Exception:
        pass
    return img


def _fix_normal_z(img, normalize=False):
    """Return a GENERATED image with the normal map's Z reconstructed: B = sqrt(1-x²-y²).

    The game ships BC5 TWO-channel normals; the dump exporter writes PNGs whose blue
    channel holds packed data (cavity/AO-like), NOT geometric Z — rendering that blue as Z
    tilts normals into the surface (crusty faces). CRITICAL: the result must be a NEW
    generated image — the glTF exporter copies the ORIGINAL FILE BYTES for file-backed
    images, silently discarding in-place pixel edits (verified the hard way).

    With `normalize`, hot maps (mean |XY| > 0.11 — some heads' pore noise) are also
    low-passed and amplitude-damped IN-texture before Z reconstruction (the runtime's
    normalTexture.scale can't fix them: it scales XY against the baked near-zero Z)."""
    if img is None:
        return None
    cached = img.get("_zfix_name")
    if cached and cached in bpy.data.images:
        return bpy.data.images[cached]
    import numpy as np

    n = len(img.pixels)
    if n == 0:
        return img
    px = np.empty(n, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    x = px[:, 0] * 2.0 - 1.0
    y = px[:, 1] * 2.0 - 1.0
    amp = float(np.mean(np.hypot(x, y)))
    if normalize and amp > 0.11:
        w = int(img.size[0])
        h = int(img.size[1])
        if w * h * 4 == n:
            for _ in range(2):
                for arr in (x, y):
                    a2 = arr.reshape(h, w)
                    out = a2.copy()
                    out[1:-1, :] = (a2[:-2, :] + a2[1:-1, :] + a2[2:, :]) / 3.0
                    out[:, 1:-1] = (out[:, :-2] + out[:, 1:-1] + out[:, 2:]) / 3.0
                    arr[:] = out.reshape(-1)
        k = min(1.0, 0.085 / max(float(np.mean(np.hypot(x, y))), 1e-6))
        x *= k
        y *= k
    out_px = np.empty_like(px)
    out_px[:, 0] = (x + 1.0) * 0.5
    out_px[:, 1] = (y + 1.0) * 0.5
    out_px[:, 2] = (np.sqrt(np.clip(1.0 - x * x - y * y, 0.0, 1.0)) + 1.0) * 0.5
    out_px[:, 3] = 1.0
    fixed = bpy.data.images.new(img.name + "_zfix", width=img.size[0], height=img.size[1], alpha=False)
    fixed.pixels.foreach_set(out_px.reshape(-1))
    try:
        fixed.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    fixed.update()
    try:
        fixed.pack()  # embed the buffer — unpacked generated images can export black
    except Exception:
        pass
    img["_zfix_name"] = fixed.name
    return fixed


def _occ_to_grey(img):
    """Greyscale albedo from the OCM's occlusion (R channel). A large class of garments
    ships NO BaseColor at all (painted entirely by flat layer colors in-game) — baking the
    AO as the base keeps crease/fold shading and gives the runtime region tint a map to
    modulate. Values are sRGB-encoded so the glTF sRGB decode recovers the linear AO."""
    import numpy as np

    n = len(img.pixels)
    if n == 0:
        return None
    px = np.empty(n, dtype=np.float32)
    img.pixels.foreach_get(px)
    r = px.reshape(-1, 4)[:, 0]
    enc = np.where(r <= 0.0031308, r * 12.92, 1.055 * np.power(np.maximum(r, 1e-7), 1 / 2.4) - 0.055)
    out = bpy.data.images.new(img.name + "_occgrey", width=img.size[0], height=img.size[1], alpha=False)
    g = np.empty((len(r), 4), dtype=np.float32)
    g[:, 0] = enc
    g[:, 1] = enc
    g[:, 2] = enc
    g[:, 3] = 1.0
    out.pixels.foreach_set(g.reshape(-1))
    try:
        out.colorspace_settings.name = "sRGB"
    except Exception:
        pass
    out.update()
    return out


def apply_material(mat, tex, alpha=None, hide=False, normalize_normal=False) -> dict:
    """Rebuild a material's node graph: BaseColor (× Occlusion R) -> Base Color, Normal ->
    Normal. `alpha` in {None, 'mask', 'blend'}. `hide` makes the material fully transparent
    (e.g. the eyes' glassy refractive shell, which can't be reproduced). Leaves the material
    untouched if no maps resolved (so texture-less assets keep the addon's import defaults)."""
    if hide:
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Alpha"].default_value = 0.0
        nt.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
        try:
            mat.blend_method = "BLEND"
        except Exception:
            pass
        return {"baseColor": False, "normal": False, "occlusion": False}

    # NOTE: normal-map Z reconstruction happens in convert-meshes.mjs's compress pass
    # (gltf-transform + sharp): Blender's exporter copies original file bytes for
    # file-backed images and exports generated images through color management that
    # mangles Non-Color data — node-side rewriting is deterministic.
    base_img = _load_img(tex.get("baseColor"))
    norm_img = _load_img(tex.get("normal"), non_color=True)
    occ_img = _load_img(tex.get("occlusion"), non_color=True)
    pre_emis = _load_img(tex.get("emissive"))
    if not (base_img or norm_img or occ_img or pre_emis):
        return {"baseColor": False, "normal": False, "occlusion": False}
    if base_img is None and occ_img is not None:
        # No albedo shipped: bake the occlusion itself as a greyscale base (see _occ_to_grey).
        base_img = _occ_to_grey(occ_img)
        occ_img = None  # already folded into the base

    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.6
    nt.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])

    used = {"baseColor": False, "normal": False, "occlusion": False}
    base_out = None
    if base_img:
        bn = nt.nodes.new("ShaderNodeTexImage")
        bn.image = base_img
        base_out = bn.outputs["Color"]
        used["baseColor"] = True
        if alpha:
            nt.links.new(bsdf.inputs["Alpha"], bn.outputs["Alpha"])

    # Occlusion: the "ORM" map packs Occlusion(R)/Curvature(G)/MaterialID(B) — only R is
    # AO. Multiply the BaseColor by R (broadcast to grey) so AO travels in the GLB albedo
    # (a separate occlusionTexture needs a fragile glTF-settings node group headless).
    if occ_img is not None and base_out is not None:
        on = nt.nodes.new("ShaderNodeTexImage")
        on.image = occ_img
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(sep.inputs["Color"], on.outputs["Color"])
        mix = nt.nodes.new("ShaderNodeMixRGB")  # stable named sockets across 4.x
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        nt.links.new(mix.inputs["Color1"], base_out)
        nt.links.new(mix.inputs["Color2"], sep.outputs["Red"])  # float broadcasts to grey
        base_out = mix.outputs["Color"]
        used["occlusion"] = True

    if base_out is not None:
        nt.links.new(bsdf.inputs["Base Color"], base_out)

    if norm_img is not None:
        nn = nt.nodes.new("ShaderNodeTexImage")
        nn.image = norm_img
        nm = nt.nodes.new("ShaderNodeNormalMap")
        # Normal-map Z reconstruction + hot-map damping happen node-side in
        # convert-meshes.mjs fixNormalMaps() (Blender can't export pixel edits).
        nt.links.new(nm.inputs["Color"], nn.outputs["Color"])
        nt.links.new(bsdf.inputs["Normal"], nm.outputs["Normal"])
        used["normal"] = True

    emis_img = pre_emis
    if emis_img is not None:
        en = nt.nodes.new("ShaderNodeTexImage")
        en.image = emis_img
        try:
            nt.links.new(bsdf.inputs["Emission Color"], en.outputs["Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        except Exception:
            pass  # socket names vary across Blender versions; emissive is best-effort

    # Explicit alpha mode, ALWAYS — the ueformat importer can leave materials on BLEND, and
    # an unwanted BLEND head exports translucent skin (blotchy nose/eyes; the D texture's
    # alpha is a data mask, not coverage). Blender 4.2+ deprecates blend_method for
    # surface_render_method, and the old enum assignment fails silently — set both spellings
    # so the glTF exporter derives the right alphaMode (OPAQUE / MASK / BLEND) on any 4.x.
    blend = "OPAQUE" if not alpha else ("CLIP" if alpha == "mask" else "BLEND")
    surface = "BLENDED" if alpha == "blend" else "DITHERED"
    for attr, val in (("blend_method", blend), ("surface_render_method", surface)):
        try:
            setattr(mat, attr, val)
        except Exception:
            pass
    if alpha == "mask":
        try:
            mat.alpha_threshold = 0.33
        except Exception:
            pass
    return used


def hook_pbr_materials(asset, src: Path) -> dict:
    """Apply baked PBR to every material in the scene. Single-texture-set assets apply
    one map set to all materials; multi-material assets (e.g. the head) provide
    `asset.materials = [{match, textures, alpha}]` to map textures per material by name."""
    dump = Path(DUMP_ROOT)
    mats = list(bpy.data.materials)
    totals = {"baseColor": 0, "normal": 0, "occlusion": 0}
    cfgs = asset.get("materials")
    skip = [s.lower() for s in (asset.get("skipMaterials") or [])]
    for mat in mats:
        if cfgs:
            cfg = next((c for c in cfgs if c.get("match", "").lower() in mat.name.lower()), None)
            if cfg is None:
                continue
            tex = {k: (dump / v) for k, v in (cfg.get("textures") or {}).items()}
            used = apply_material(
                mat,
                tex,
                alpha=cfg.get("alpha"),
                hide=cfg.get("hide", False),
                normalize_normal=cfg.get("normalizeNormal", False),
            )
        else:
            if any(s in mat.name.lower() for s in skip):
                continue  # leave e.g. eye/eyelash materials as imported
            tex = resolve_textures(asset, src)
            used = apply_material(mat, tex, alpha=asset.get("alpha"))
        for k in totals:
            totals[k] += 1 if used.get(k) else 0
    return totals


def convert(asset) -> bool:
    src = Path(DUMP_ROOT) / asset["src"]
    dst = MODELS_OUT / asset["dst"]
    if not src.exists():
        print(f"  SKIP (missing source): {src}")
        return False
    if dst.exists() and os.environ.get("CONVERT_FORCE") != "1":
        return False  # already converted; set CONVERT_FORCE=1 to rebuild
    dst.parent.mkdir(parents=True, exist_ok=True)

    reset_scene()
    UEFormatImport(OPTIONS).import_file(src)
    # Multi-part pieces (e.g. HighPonytail_02 = ponytail + a separate FrontBangs mesh) ship as
    # several .uemodels under one item; import the extras into the SAME scene so they export into
    # one glb. Hair parts are static meshes (no skeleton), so there's no armature to reconcile.
    for extra in asset.get("extraParts", []):
        epath = Path(DUMP_ROOT) / extra
        if epath.exists():
            UEFormatImport(OPTIONS).import_file(epath)
        else:
            print(f"  (missing extra part: {epath})")

    try:
        used = hook_pbr_materials(asset, src)
    except Exception:
        used = {"baseColor": 0, "normal": 0, "occlusion": 0}
        traceback.print_exc()

    n_mesh = sum(1 for o in bpy.data.objects if o.type == "MESH")
    n_arm = sum(1 for o in bpy.data.objects if o.type == "ARMATURE")

    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        use_selection=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
        export_yup=True,
    )
    size_kb = dst.stat().st_size / 1024 if dst.exists() else 0
    print(
        f"  OK {asset['dst']}  ({n_mesh} mesh / {n_arm} arm, "
        f"base={used['baseColor']} norm={used['normal']} occ={used['occlusion']}, {size_kb:.0f} KB)"
    )
    return True


def main():
    print(f"Sources:   {_sources_file.name}")
    print(f"Dump root: {DUMP_ROOT}")
    print(f"Output:    {MODELS_OUT}")
    assets = SOURCES
    if RANGE and ":" in RANGE:
        a, b = RANGE.split(":", 1)
        assets = assets[int(a or 0):int(b or len(assets))]
        print(f"Range:     {RANGE} ({len(assets)} of {len(SOURCES)})")
    # CONVERT_ONLY=substr[,substr] — convert only pieces whose dst contains a substring (e.g. the
    # multi-part companions) so a few pieces can be rebuilt without a full-catalog re-convert.
    only = os.environ.get("CONVERT_ONLY", "")
    if only:
        subs = [s.strip().lower() for s in only.split(",") if s.strip()]
        assets = [a for a in assets if any(s in a["dst"].lower() for s in subs)]
        print(f"Only:      {only} ({len(assets)} match)")
    ok = 0
    for asset in assets:
        print(f"Converting {asset['src']} …")
        try:
            if convert(asset):
                ok += 1
        except Exception:
            print(f"  FAILED: {asset['src']}")
            traceback.print_exc()
    print(f"\nConverted {ok}/{len(assets)} assets.")


main()
