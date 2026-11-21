"""Relight the Season 12 intro tunnel in Blender Cycles and render a plate (15 Nov 2026, scene backdrops P2-tunnel).

  blender -b --factory-startup -P blender_relight_tunnel.py -- PLACEMENT MESHES_DIR GLB_DIR TEX_DIR OUT_PREFIX CONFIG.json

Builds G_IntroPodium_01 from assemble_scene.py's placements with materials rebuilt from the material instances'
parameters (README section 7: M_Props_01 tiles and concrete, LED screens and the end glass lit in the team colour, white
strips) and the tunnel's own 16 lights, then renders with Cycles.

Units, chosen so the game's numbers carry over without guessing: 1 lumen = 1 Blender watt for lights (both describe a
point or spot light's output as if it shone in every direction, and an area light's one-sided output), and an Unreal
emissive value = a Blender emission strength. Then one exposure, fitted against the user's screenshot from the camera
solved in P1, brings both to the screen. (A screen's emission integrated over its area comes to about the 150 lm of the
rect light the level adds for it, which says the mapping is consistent.)

CONFIG: {"camera": {"pos": [x, y, z], "target": [x, y, z], "lens": mm, "sensor": mm}, "resolution": [w, h],
         "samples": 128, "exposure": 0.0, "view_transform": "AgX", "look": "None", "glare": 0.0..1,
         "emission_scale": {"screen": 1, "strip": 1, "logo": 1, "glass": 1}, "light_scale": 1.0}
"""
import json
import math
import pathlib
import re
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
# Absolute paths: Blender resolves relative ones against the .blend, not the shell's folder.
placement_path, meshes_dir, glb_dir, tex_dir, out_prefix, config_path = (str(pathlib.Path(a).resolve()) for a in args)
placement = json.loads(pathlib.Path(placement_path).read_text(encoding="utf-8"))
config = json.loads(pathlib.Path(config_path).read_text(encoding="utf-8"))
tex = pathlib.Path(tex_dir)
emission_scale = {"screen": 1.0, "strip": 1.0, "logo": 1.0, "glass": 1.0, **config.get("emission_scale", {})}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Mesh package path -> glb stem (as blender_blockout.py).
assets = json.loads((pathlib.Path(meshes_dir) / "assets.json").read_text(encoding="utf-8"))
stem_by_package = {}
for r in assets:
    if r.get("meshFile"):
        key = "/" + r["path"].removesuffix(".uasset").replace("Discovery/Content/", "Game/", 1).replace("Engine/Content/", "Engine/", 1)
        stem_by_package[key] = r["meshFile"].removesuffix(".mesh.json")
source_slots = {}  # stem -> [(slot name, material package path)] in the source mesh's order
for stem in set(stem_by_package.values()):
    d = json.loads((pathlib.Path(meshes_dir) / f"{stem}.mesh.json").read_text(encoding="utf-8"))
    source_slots[stem] = [(m["name"], (m["path"] or "").split(".")[0]) for m in d["materials"]]

def slot_materials(stem, data, overrides):
    """The material name for each of an imported mesh's slots. The glTF importer orders slots by first use in the
    sections and merges repeated materials, so slot j is matched to the source slot by the name the mesh builder gave
    the glTF material (the source slot name), not by position; the level's overrides are indexed by source slot."""
    names, slots = [], source_slots[stem]
    for j, mat in enumerate(data.materials):
        imported = re.sub(r"\.\d{3}$", "", mat.name) if mat else ""
        index = next((i for i, s in enumerate(slots) if s[0] == imported), j if j < len(slots) else None)
        if index is None:
            names.append("")
            continue
        override = overrides[index] if index < len(overrides) else None
        names.append((override or slots[index][1]).split("/")[-1].split(".")[0])
    return names


mesh_data = {}


def load_mesh(stem):
    if stem in mesh_data:
        return mesh_data[stem]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(glb_dir) / f"{stem}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    data = next(o for o in new if o.type == "MESH").data
    data.name = stem
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    mesh_data[stem] = data
    return data


images = {}


def image(name, data=True):
    if name not in images:
        img = bpy.data.images.load(str(tex / f"{name}.png"))
        img.colorspace_settings.name = "Non-Color" if data else "sRGB"
        images[name] = img
    return images[name]


def tiled(nodes, links, img, tiling, interpolation="Linear"):
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (tiling, tiling, 1.0)
    links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    node = nodes.new("ShaderNodeTexImage")
    node.image = img
    node.interpolation = interpolation
    links.new(mapping.outputs["Vector"], node.inputs["Vector"])
    return node


def props_material(name, cr, noh, tiling, multiply, roughness, desaturation=1.0, metal=0.0, normal=0.5):
    # Unreal stores normal maps DirectX style (green points down the texture); Blender reads OpenGL style, so green is
    # flipped. Blue is rebuilt as 1 (the Normal Map node renormalises).
    """M_Props_01: colour × ColorMultiply (desaturated), roughness = the CR alpha × Roughness, normal from NOH's RG."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    colour = tiled(nodes, links, image(cr, data=False), tiling)
    sat = nodes.new("ShaderNodeHueSaturation")
    sat.inputs["Saturation"].default_value = 1.0 - desaturation
    links.new(colour.outputs["Color"], sat.inputs["Color"])
    mul = nodes.new("ShaderNodeMixRGB")
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[2].default_value = (multiply, multiply, multiply, 1)
    links.new(sat.outputs["Color"], mul.inputs[1])
    links.new(mul.outputs["Color"], bsdf.inputs["Base Color"])
    rough = nodes.new("ShaderNodeMath")
    rough.operation = "MULTIPLY"
    rough.use_clamp = True
    rough.inputs[1].default_value = roughness
    links.new(colour.outputs["Alpha"], rough.inputs[0])
    links.new(rough.outputs["Value"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metal
    if noh:
        n = tiled(nodes, links, image(noh), tiling)
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(n.outputs["Color"], sep.inputs["Color"])
        comb = nodes.new("ShaderNodeCombineColor")
        flip = nodes.new("ShaderNodeMath")
        flip.operation = "SUBTRACT"
        flip.inputs[0].default_value = 1.0
        links.new(sep.outputs["Green"], flip.inputs[1])
        links.new(sep.outputs["Red"], comb.inputs["Red"])
        links.new(flip.outputs["Value"], comb.inputs["Green"])
        comb.inputs["Blue"].default_value = 1.0
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal
        links.new(comb.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return m


TEAM = (0.008, 0.0, 0.391)  # the team colour the screens and the glass take from the parameter collection (blue team)


def emissive_material(name, colour, strength, led=None, glossy=0.12, logo=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1)
    bsdf.inputs["Roughness"].default_value = glossy
    bsdf.inputs["Emission Color"].default_value = (*colour, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    if led:  # LED pixels: the texture's 2×2 LEDs tiled `led` times; dark gaps between them
        px = tiled(nodes, links, image("T_MonitorScreen_Pixel_01"), led, "Closest")
        mul = nodes.new("ShaderNodeMixRGB")
        mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 1.0
        mul.inputs[1].default_value = (*colour, 1)
        links.new(px.outputs["Color"], mul.inputs[2])
        links.new(mul.outputs["Color"], bsdf.inputs["Emission Color"])
    if logo:  # the end glass: the team colour, and the stacked logo in white on top
        logo_strength, logo_scale = logo
        coord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.vector_type = "POINT"
        mapping.inputs["Location"].default_value = (0.5 - 0.5 / logo_scale, 0.5 - 0.5 / logo_scale, 0)
        mapping.inputs["Scale"].default_value = (1 / logo_scale, 1 / logo_scale, 1)
        links.new(coord.outputs["UV"], mapping.inputs["Vector"])
        t = nodes.new("ShaderNodeTexImage")
        t.image = image("stacked-logo")
        t.extension = "CLIP"
        links.new(mapping.outputs["Vector"], t.inputs["Vector"])
        mix = nodes.new("ShaderNodeMixRGB")
        mix.inputs[1].default_value = (*colour, 1)
        mix.inputs[2].default_value = (logo_strength / strength, logo_strength / strength, logo_strength / strength, 1)
        links.new(t.outputs["Color"], mix.inputs[0])
        links.new(mix.outputs["Color"], bsdf.inputs["Emission Color"])
    return m


FLOOR_NORMAL = config.get("floor_normal", 0.0)
MATERIALS = {
    # The floor's gloss (CR alpha: glossy tiles, rough grout) gives the tile grid; its normal map ("floor_normal" in the
    # config, 0 = off) tilts each tile a little, so each reflects its own offset copy, as in the game.
    "MI_Floor_IntroPodium_01": lambda: props_material("floor", "T_TileFloor_01_CR", "T_TileFloor_01_NOH" if FLOOR_NORMAL else None,
                                                      2.0, 0.05, 0.55, normal=FLOOR_NORMAL),
    "MI_Floor_IntroPodium_01_B": lambda: props_material("floor_b", "T_TileFloor_01_CR", "T_TileFloor_01_NOH" if FLOOR_NORMAL else None,
                                                        2.0, 0.05, 0.55, normal=FLOOR_NORMAL),
    "MI_Wall_IntroPodium_01": lambda: props_material("wall", "T_TileFloor_03_A_CR", "T_TileFloor_03_A_NOH", 2.0, 0.009, 0.4),
    "MI_Cieling_IntroPodium_01": lambda: props_material("ceiling", "T_Concrete_Cast_01_CR", "T_Concrete_Cast_01_NOH", 1.0, 0.104, 1.388, 0.5),
    "MI_Panel_IntroPodium_01": lambda: props_material("panel", "T_BitumentRoof_02_A_CR", "T_BitumentRoof_02_A_NOH", 2.076, 0.5, 1.4, normal=0.3),
    "MI_Drainage_IntroPodium_01": lambda: props_material("drainage", "T_Mon_StoneTileTrim_01_CR", "T_Mon_StoneTileTrim_01_NOH", 1.0, 0.04, 1.0, 0.9),
    "MI_CielingAdd_IntroPodium_01_A": lambda: props_material("ducts", "T_Default_01_C", None, 2.0, 0.1, 0.3, metal=0.925),
    "MI_IntroPodium_Emissive_01": lambda: emissive_material("strip", (0.598, 0.642, 1.0), 10.0 * emission_scale["strip"], glossy=0.4),
}
built = {}


def material_for(mesh_stem, slot_name):
    if mesh_stem.startswith("SM_ScreenIntroPodium") and slot_name == "G_IntroPodium_01":
        key = "screen"
        maker = lambda: emissive_material("screen", TEAM, 10.0 * emission_scale["screen"], led=180)
    elif mesh_stem.startswith("SM_Glass_IntroPodium") and slot_name == "G_IntroPodium_01":
        key = "glass"
        maker = lambda: emissive_material("glass", TEAM, 1.0 * emission_scale["glass"],
                                          logo=(config.get("logo_strength", 20.0) * emission_scale["logo"], config.get("logo_scale", 0.8)))
    else:
        key = slot_name if slot_name in MATERIALS else "default"
        maker = MATERIALS.get(slot_name) or (lambda: props_material("default", "T_Concrete_Cast_01_CR", None, 1.0, 0.05, 1.0))
    if key not in built:
        built[key] = maker()
    return built[key]


SKIP_MATERIALS = ("Fog", "DDGI", "TunnelRun_End_Effect", "Light_RT_Emissive", "Tournament", "WinnerScreen",
                  "CaptureBackground", "Grid_WorldAligned", "Backdrop", "FrontendStage", "OutroPodium")
SKIP_ACTORS = set(config.get("skip_actors", ["StaticMeshActor_87"]))
placed = 0
for p in placement["meshes"]:
    stem = stem_by_package.get(p.get("mesh") or "")
    if not stem or not p.get("visible", True) or p["actor"] in SKIP_ACTORS:
        continue
    names = slot_materials(stem, load_mesh(stem), p.get("overrideMaterials") or [])
    if any(w.lower() in (n or "").lower() for n in names for w in SKIP_MATERIALS) or stem.startswith(("SM_FrontendStage", "SM_Outro", "SM_tournament", "SM_DDGI")):
        continue
    obj = bpy.data.objects.new(f"{p['actor']}.{p['component']}", load_mesh(stem))
    obj.matrix_world = Matrix(p["matrix"])
    for slot in range(len(obj.data.materials)):
        obj.material_slots[slot].link = "OBJECT"
        obj.material_slots[slot].material = material_for(stem, names[slot] if slot < len(names) else "")
    scene.collection.objects.link(obj)
    placed += 1

# The tunnel's own lights (the lobby's and the squad stage's are left out: the screenshot shows the lobby dark).
light_scale = config.get("light_scale", 1.0)
lights = 0
for l in placement["lights"]:
    M = Matrix(l["matrix"])
    pos = M.translation
    if not (5 <= pos.x <= 28 and abs(pos.y) < 4 and -1 <= pos.z <= 8) or not l.get("visible", True):
        continue
    v = l["values"]
    colour = v.get("LightColor") or {"R": 255, "G": 255, "B": 255}
    rgb = tuple((c / 255.0) ** 2.2 for c in (colour["R"], colour["G"], colour["B"]))
    kind = {"PointLightComponent": "POINT", "SpotLightComponent": "SPOT", "RectLightComponent": "AREA"}.get(l["type"])
    if not kind:
        continue
    data = bpy.data.lights.new(l["actor"], kind)
    data.color = rgb
    data.energy = float(v.get("Intensity", 100.0)) * light_scale  # lumens -> watts, 1:1 (see the docstring)
    if kind == "SPOT":
        data.spot_size = math.radians(2 * float(v.get("OuterConeAngle", 44.0)))
        data.spot_blend = 0.3
    if kind == "AREA":
        data.shape = "RECTANGLE"
        data.size = float(v.get("SourceWidth", 64.0)) / 100.0
        data.size_y = float(v.get("SourceHeight", 64.0)) / 100.0
    if kind in ("POINT", "SPOT"):
        data.shadow_soft_size = float(v.get("SourceRadius", 5.0)) / 100.0
    obj = bpy.data.objects.new(l["actor"], data)
    obj.matrix_world = M
    scene.collection.objects.link(obj)
    lights += 1

world = bpy.data.worlds.new("black")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
scene.world = world

cam_cfg = config["camera"]
cam_data = bpy.data.cameras.new("plate")
cam_data.sensor_fit = cam_cfg.get("fit", "HORIZONTAL")
cam_data.sensor_width = cam_cfg.get("sensor", 36.0)
cam_data.sensor_height = cam_cfg.get("sensor", 36.0)
if "vfov" in cam_cfg:  # a vertical field of view, as three.js cameras are given
    cam_data.sensor_fit = "VERTICAL"
    cam_data.lens_unit = "FOV"
    cam_data.angle_y = math.radians(cam_cfg["vfov"])
else:
    cam_data.lens = cam_cfg.get("lens", 35.0)
cam_data.clip_start = 0.05
cam_data.clip_end = 200
cam = bpy.data.objects.new("plate", cam_data)
pos, target = Vector(cam_cfg["pos"]), Vector(cam_cfg["target"])
cam.matrix_world = Matrix.Translation(pos) @ (target - pos).to_track_quat("-Z", "Y").to_matrix().to_4x4()
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
device = "CPU"
for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            device = kind
            break
    except Exception:
        continue
scene.cycles.device = "GPU" if device != "CPU" else "CPU"
scene.cycles.samples = config.get("samples", 128)
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.render.resolution_x, scene.render.resolution_y = config.get("resolution", [1620, 1620])
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"
scene.view_settings.view_transform = config.get("view_transform", "AgX")
scene.view_settings.look = config.get("look", "None")
scene.view_settings.exposure = config.get("exposure", 0.0)

glare = config.get("glare", 0.0)
if glare > 0:
    scene.use_nodes = True
    tree = scene.node_tree
    rl = tree.nodes.get("Render Layers") or tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.get("Composite") or tree.nodes.new("CompositorNodeComposite")
    g = tree.nodes.new("CompositorNodeGlare")
    g.glare_type = "BLOOM" if "BLOOM" in [i.identifier for i in g.bl_rna.properties["glare_type"].enum_items] else "FOG_GLOW"
    g.quality = "HIGH"
    try:
        g.mix = -1.0 + 2.0 * glare  # older API: -1 (only the image) .. 1 (only the glare)
    except AttributeError:
        pass
    for name, value in (("Strength", glare), ("Threshold", 1.0)):
        if name in g.inputs:
            g.inputs[name].default_value = value
    tree.links.new(rl.outputs["Image"], g.inputs["Image"])
    tree.links.new(g.outputs["Image"], comp.inputs["Image"])

if config.get("linear"):
    # Scene-linear light out, for tone mapping outside Blender (tools/tonemap_plate.py: exposure, an ACES curve as
    # Unreal's, bloom). A float EXR, then the same pixels as a float16 .npy that numpy reads without an EXR library.
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = f"{out_prefix}.exr"
    bpy.ops.render.render(write_still=True)
    import numpy as np
    img = bpy.data.images.load(f"{out_prefix}.exr")
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    np.save(f"{out_prefix}.npy", px.reshape(h, w, 4)[::-1, :, :3].astype(np.float16))
else:
    scene.render.filepath = f"{out_prefix}.png"
    bpy.ops.render.render(write_still=True)
report = {"placed": placed, "lights": lights, "device": device, "camera": cam_cfg, "materials": sorted(built)}
if config.get("save_blend"):
    bpy.ops.wm.save_as_mainfile(filepath=f"{out_prefix}.blend")
pathlib.Path(f"{out_prefix}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
print("RELIGHT", json.dumps(report))
