"""Evaluate the eight remaining body paint contracts through the compiled M_Skin/M_Face base passes.

Diagnostic only, in the manner of inspect-body-paint-shader.py; it changes no product file. Each
paint MI named by its decoded item definition is layered onto the Medium Face 01 base material of
the slot it targets. OverrideParameters copies only the donor's explicit dynamic values, so any
parameter a paint does not set keeps the recipient chain's value, which for these paints is the
master material's default. The uniform preshaders are evaluated with the validated builder and the
existing skin-surface slicer emits the folded GLSL. Paint PNG sizes stand in for the cooked mip
chains, which are not supplied, so filtering equivalence is not claimed.

  py scripts/shader-probe/evaluate-remaining-paints.py [<Content root>]

Writes scripts/generated/shader-probe/paint-contracts-opus-v1/shader/{<id>--<slot>.glsl,constants.json}.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/shader-probe"))
from material_inputs import parent_chain, texture_paths

spec = importlib.util.spec_from_file_location("build_materials", ROOT / "scripts/shader-probe/build-materials.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

EXPORTS = ROOT / "scripts/generated/shader-probe/reference-skin-01/exports"
TEXTURES = ROOT / "scripts/generated/shader-probe/reference-skin-01/textures"
CONTENT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content")
OUTPUT = ROOT / "scripts/generated/shader-probe/paint-contracts-opus-v1/shader"
IDS = [
    "bodycosmetics-bodypaint-90sskateboarder-01",
    "bodycosmetics-bodypaint-armsblack-01",
    "bodycosmetics-bodypaint-bruises-02",
    "bodycosmetics-bodypaint-oilyhands-01",
    "bodycosmetics-bodypaint-runnyfingersblack-01",
    "bodycosmetics-bodypaint-runnyfingersgold-01",
    "bodycosmetics-bodypaint-sweat-01",
    "bodycosmetics-bodypaint-techwearsymbols-01",
]
# Recipient Medium Face 01 base material and compiled shader for each slot a paint may target.
TARGETS = {"BaseBody": ("MI_Body_Face_01_Base", "M_Skin"),
           "shader_head_shader": ("MI_Head_Face_01_Base_Head", "M_Face")}
# The only condition the base face context satisfies; SourceAssembly treats an empty list as unconditional.
BASE_TAGS = {"Customization.Slot.Head"}
PAINT_PARAMETERS = {"BodyPaintUV", "BodyPaintTiles", "BodyPaintPlacement", "BodyNormalOverride",
                    "BodyColorMultiplyNonMasked", "BodyColorOverride", "BodySurfaceOverride",
                    "TattooUV", "TattooTiles", "TattooPlacement", "TattooColorOverride"}
PAINT_ROOT = "/Game/Discovery/Characters/BodyCosmetics/BodyPaint/"


def source_file(object_path, suffix):
    if not object_path.startswith("/Game/") or ".." in object_path:
        raise ValueError(f"Unsupported source object path: {object_path}")
    return CONTENT / (object_path[len("/Game/"):].split(".")[0] + suffix)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


texture_info = {t["path"]: t for t in builder.read_json(TEXTURES / "textures.json")}
OUTPUT.mkdir(parents=True, exist_ok=True)
summary = []
for item_id in IDS:
    definition = builder.read_json(ROOT / f"public/models/reconstructed-assembly-v2/items/{item_id}.json")
    if definition["formatVersion"] != 1 or definition["id"] != item_id:
        raise ValueError(f"Invalid source item definition: {item_id}")
    for rule in definition["properties"].get("ActivatesMaterialParameters", []):
        tags = rule.get("MatchingTags") or []
        if rule["Behavior"] != "ECustomizationMaterialBehavior::OverrideParameters" or not set(tags) <= BASE_TAGS:
            raise ValueError(f"{item_id}: rule outside the base face context: {rule}")
        for slot in rule["SlotNames"]:
            base_material, shader_parent = TARGETS[slot]
            paint_file = source_file(rule["MaterialInstance"]["AssetPathName"], ".json")
            paint = builder.read_json(paint_file)[0]
            if paint["Properties"].get("StaticParametersRuntime") or paint.get("LoadedMaterialResources"):
                raise ValueError(f"{item_id}/{slot}: a static permutation needs its own compiled shader")
            chain = parent_chain(EXPORTS, base_material)
            chain.append({**paint, "_parameterOverride": True, "Properties": {
                k: v for k, v in paint["Properties"].items()
                if k in ("ScalarParameterValues", "VectorParameterValues", "TextureParameterValues")}})
            assembly = EXPORTS / f"shaders/{shader_parent}.SP_PCD3D_SM5.basepass-pixel.dxbc.asm"
            uniforms = builder.read_json(EXPORTS / f"{shader_parent}.SP_PCD3D_SM5.uniforms.json")
            bindings = builder.read_json(EXPORTS / f"bindings/{shader_parent}.SP_PCD3D_SM5.basepass-pixel.bindings.json")
            constants, parameters = builder.material_constants(uniforms, chain)

            slots, paint_slots = {}, {}
            for texture_slot, texture_path in texture_paths(chain, bindings):
                if texture_path in texture_info:
                    t = texture_info[texture_path]
                    mip = t["mips"][0]
                    slots[texture_slot] = {"path": texture_path, "width": mip["width"], "height": mip["height"],
                                           "depth": t["slices"], "mipCount": len(t["mips"]),
                                           "array": t["type"] == "UTexture2DArray", "cube": t["type"] == "UTextureCube"}
                elif texture_path.startswith(PAINT_ROOT):
                    with Image.open(source_file(texture_path, ".png")) as image:
                        slots[texture_slot] = {"path": texture_path, "width": image.width, "height": image.height,
                                               "depth": 1, "mipCount": 1, "array": False, "cube": False}
                    paint_slots[texture_slot] = texture_path

            sliced = builder.Slice(assembly.read_text(), constants, slots, skin_surface=True,
                                   material_buffer=bindings["materialBufferIndex"])
            shader, used, report = sliced.emit()
            label = f"{item_id}--{slot}"
            (OUTPUT / f"{label}.glsl").write_text(shader)
            # The value each paint/tattoo uniform actually holds, keyed by the register the asm reads.
            registers = {}
            for field in bindings["uniformFields"]:
                if not PAINT_PARAMETERS & set(field["parameters"]):
                    continue
                width = int(field["type"][-1])
                value = constants[field["floatOffset"]:field["floatOffset"] + width]
                registers[field["register"]] = {"expression": field["expression"],
                                                "value": value[0] if width == 1 else value}
            summary.append({
                "id": item_id, "slot": slot, "matchingTags": tags, "shaderParent": shader_parent,
                "recipient": base_material, "sourceMi": str(paint_file), "sourceMiSha256": sha256(paint_file),
                "assemblySha256": sha256(assembly), "glsl": f"{label}.glsl",
                "paintSlots": paint_slots, "used": used, "scalarNodes": report["scalarNodes"],
                "parameters": {k: v for k, v in parameters.items() if k in PAINT_PARAMETERS},
                "registers": registers,
                "caveat": "Diagnostic symbolic emit, not a staged material or filtering-equivalence check; "
                          "paint PNG dimensions and one mip only.",
            })
            print(f"{label}: {report['scalarNodes']} nodes, paint slots {paint_slots}")

(OUTPUT / "constants.json").write_text(json.dumps(summary, indent=2) + "\n")
