"""Read the existing compiled skin/face shaders with the eight remaining paint MIs.

Diagnostic only. Does not edit product sources, catalog or staged assets.
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
exports = ROOT / "scripts/generated/shader-probe/reference-skin-01/exports"
textures = ROOT / "scripts/generated/shader-probe/reference-skin-01/textures"
content = Path("C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content")
out = ROOT / "scripts/generated/shader-probe/paint-contracts-astra-v1"
out.mkdir(exist_ok=True, parents=True)
texture_info = {t["path"]: t for t in builder.read_json(textures / "textures.json")}
rejections = builder.read_json(ROOT / "scripts/generated/shader-probe/body-paint-siblings-v1/prepare-report.json")
summary = []
for entry in rejections["items"]:
    if entry["status"] != "unchanged":
        continue
    item = builder.read_json(ROOT / ("public/models/reconstructed-assembly-v2/items/" + entry["id"] + ".json"))
    for rule in item["properties"]["ActivatesMaterialParameters"]:
        target = "head" if "shader_head_shader" in rule["SlotNames"] else "body"
        base = "MI_Head_Face_01_Base_Head" if target == "head" else "MI_Body_Face_01_Base"
        parent = "M_Face" if target == "head" else "M_Skin"
        paint_path = rule["MaterialInstance"]["AssetPathName"]
        paint_file = content / (paint_path.removeprefix("/Game/").split(".")[0] + ".json")
        paint = builder.read_json(paint_file)[0]
        assembly = exports / ("shaders/" + parent + ".SP_PCD3D_SM5.basepass-pixel.dxbc.asm")
        uniforms = builder.read_json(exports / (parent + ".SP_PCD3D_SM5.uniforms.json"))
        bindings = builder.read_json(exports / ("bindings/" + parent + ".SP_PCD3D_SM5.basepass-pixel.bindings.json"))
        chain = parent_chain(exports, base)
        chain.append({**paint, "_parameterOverride": True, "Properties": {
            k: v for k, v in paint["Properties"].items()
            if k in ["ScalarParameterValues", "VectorParameterValues", "TextureParameterValues"]
        }})
        constants, parameters = builder.material_constants(uniforms, chain)
        slots, overrides = {}, {}
        for slot, source_path in texture_paths(chain, bindings):
            if source_path in texture_info:
                t = texture_info[source_path]
                mip = t["mips"][0]
                slots[slot] = {"path": source_path, "width": mip["width"], "height": mip["height"],
                    "depth": t["slices"], "mipCount": len(t["mips"]),
                    "array": t["type"] == "UTexture2DArray", "cube": t["type"] == "UTextureCube"}
            elif source_path.startswith("/Game/"):
                image_path = content / (source_path.removeprefix("/Game/").split(".")[0] + ".png")
                if not image_path.is_file():
                    raise ValueError("Source PNG missing: " + str(image_path))
                with Image.open(image_path) as im:
                    slots[slot] = {"path": source_path, "width": im.width, "height": im.height,
                        "depth": 1, "mipCount": 1, "array": False, "cube": False}
                overrides[slot] = source_path
        sliced = builder.Slice(assembly.read_text(), constants, slots, skin_surface=True,
            material_buffer=bindings["materialBufferIndex"])
        shader, used, report = sliced.emit()
        label = entry["id"] + "-" + target
        (out / (label + ".glsl")).write_text(shader)
        summary.append({"id": entry["id"], "target": target, "shaderParent": parent,
            "material": str(paint_file), "materialSha256": hashlib.sha256(paint_file.read_bytes()).hexdigest(),
            "assemblySha256": hashlib.sha256(assembly.read_bytes()).hexdigest(),
            "parameters": {k: v for k, v in parameters.items() if k.startswith(("Body", "Tattoo"))},
            "materialBuffer": bindings["materialBufferIndex"], "firstBufferVectors": [constants[i:i+4] for i in range(0, 24, 4)],
            "textureOverrides": overrides, "used": used, "report": report,
            "caveat": "Diagnostic symbolic emit and PNG dimensions, not native mip filtering or staged full material."})
        print(label + ": " + str(report["scalarNodes"]) + " nodes; overrides " + str(overrides))
(out / "source-summary.json").write_text(json.dumps(summary, indent=2))
