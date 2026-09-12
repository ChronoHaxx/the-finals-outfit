"""Inspect the existing compiled M_Skin with the two paint parameter overrides.

Diagnostic GLSL only: this does not build/stage materials or change the catalog.
Paint dimensions come from exported PNGs; cooked mip chains are not supplied.
"""
import importlib.util
import json
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/shader-probe"))
from material_inputs import parent_chain, texture_paths

spec = importlib.util.spec_from_file_location("build_materials", ROOT / "scripts/shader-probe/build-materials.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

exports = ROOT / "scripts/generated/shader-probe/reference-skin-01/exports"
textures = ROOT / "scripts/generated/shader-probe/reference-skin-01/textures"
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters/BodyCosmetics/BodyPaint"
)
output = ROOT / "scripts/generated/shader-probe/body-paints-source-formula-v1"
output.mkdir(exist_ok=True)
texture_info = {t["path"]: t for t in builder.read_json(textures / "textures.json")}
summary = []

cases = [
    ("BodyTight_01", "BodyHands", "MI_Body_Face_01_Base", "M_Skin"),
    ("Goblin_01", "BodyHands", "MI_Body_Face_01_Base", "M_Skin"),
    ("BodyTight_01", "Head", "MI_Head_Face_01_Base_Head", "M_Face"),
]
for style, part, base_material, shader_parent in cases:
    assembly = exports / f"shaders/{shader_parent}.SP_PCD3D_SM5.basepass-pixel.dxbc.asm"
    uniforms = builder.read_json(exports / f"{shader_parent}.SP_PCD3D_SM5.uniforms.json")
    bindings = builder.read_json(exports / f"bindings/{shader_parent}.SP_PCD3D_SM5.basepass-pixel.bindings.json")
    chain = parent_chain(exports, base_material)
    paint_file = source / style / f"MI_BodyCosmetics_BodyPaint_{style}_{part}.json"
    paint = builder.read_json(paint_file)[0]
    chain.append({**paint, "_parameterOverride": True, "Properties": {
        k: v for k, v in paint["Properties"].items()
        if k in ["ScalarParameterValues", "VectorParameterValues", "TextureParameterValues"]
    }})
    constants, parameters = builder.material_constants(uniforms, chain)
    slots, paint_slots = {}, {}
    for slot, texture_path in texture_paths(chain, bindings):
        if texture_path in texture_info:
            t = texture_info[texture_path]
            mip = t["mips"][0]
            slots[slot] = {"path": texture_path, "width": mip["width"], "height": mip["height"],
                           "depth": t["slices"], "mipCount": len(t["mips"]),
                           "array": t["type"] == "UTexture2DArray", "cube": t["type"] == "UTextureCube"}
        elif f"/BodyPaint/{style}/" in texture_path:
            from PIL import Image
            image_path = source / style / (texture_path.split("/")[-1].split(".")[0] + ".png")
            with Image.open(image_path) as image:
                slots[slot] = {"path": texture_path, "width": image.width, "height": image.height,
                               "depth": 1, "mipCount": 1, "array": False, "cube": False}
            paint_slots[slot] = texture_path

    sliced = builder.Slice(assembly.read_text(), constants, slots, skin_surface=True,
                           material_buffer=bindings["materialBufferIndex"])
    shader, used, report = sliced.emit()
    label = style if part == "BodyHands" else f"{style}_{part}"
    (output / (label + ".glsl")).write_text(shader)
    result = {"style": style, "part": part, "shaderParent": shader_parent,
              "paintSlots": paint_slots, "used": used, "report": report,
              "assemblySha256": hashlib.sha256(assembly.read_bytes()).hexdigest(),
              "paintMiSha256": hashlib.sha256(paint_file.read_bytes()).hexdigest(),
              "parameters": {k: v for k, v in parameters.items() if "BodyPaint" in k or "Override" in k},
              "caveat": "Diagnostic symbolic emit, not a staged material or filtering-equivalence check; paint PNG dimensions and one mip only."}
    summary.append(result)
    print(f"{label}: {report['scalarNodes']} nodes, paint slots {paint_slots}")

(output / "summary.json").write_text(json.dumps(summary, indent=2))
