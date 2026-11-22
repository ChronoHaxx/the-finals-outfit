"""Blender layout check for an assembled scene (12 Nov 2026, scene backdrops P1). Run inside Blender:

  blender -b --factory-startup -P blender_blockout.py -- PLACEMENT.json MESHES_DIR GLB_DIR TEX_DIR OUT_PREFIX CONFIG.json

It builds the scene from assemble_scene.py's placements and renders it from the configured cameras. Materials are flat
stand-ins chosen by material name (glowing screens, LEDs and strips emit; everything else is grey), because the point is
to check placement and framing against the user's screenshots, not the look. Saves OUT_PREFIX.blend for P2.

CONFIG: {"camera": {"actor": NAME, "level": LEVEL, "offset_cm": [x, y, z]}, "sensors_mm": [23.76, 36],
         "resolution": [W, H], "include_hidden": false, "standin": [x, y, z] (metres, Blender) or null,
         "skip_material_words": ["Fog"], "skip_actors": ["StaticMeshActor_87"],
         "emit": {"word": [r, g, b, strength], ...}, "translucent": {"word": alpha}, "view_transform": "AgX"}
A hand-matched camera replaces "actor"/"level" with {"pos": [x, y, z], "target": [x, y, z], "lens": mm} (Blender metres).
"""
import json
import math
import pathlib
import re
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
placement_path, meshes_dir, glb_dir, tex_dir, out_prefix, config_path = args
# Blender resolves a relative render path against the .blend, not the shell's folder, so a relative prefix silently
# writes nowhere useful.
out_prefix = str(pathlib.Path(out_prefix).resolve())
placement = json.loads(pathlib.Path(placement_path).read_text(encoding="utf-8"))
config = json.loads(pathlib.Path(config_path).read_text(encoding="utf-8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Mesh package path -> glb stem, via the probe's assets.json (the builder names glbs after the mesh.json stems).
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
    mesh_obj = next(o for o in new if o.type == "MESH")
    data = mesh_obj.data
    data.name = stem
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    mesh_data[stem] = data
    return data


materials = {}
icon = pathlib.Path(tex_dir) / "T_THEFINALS_01_IconStroke_A.png"


def material(name):
    if name in materials:
        return materials[name]
    m = bpy.data.materials.new(name or "None")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    low = (name or "").lower()
    emit = next((v for k, v in config.get("emit", {}).items() if k.lower() in low), None)
    if emit:
        r, g, b, strength = emit
        bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        if "titleled" in low and icon.exists():
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(str(icon))
            mix = nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            mix.inputs[1].default_value = (r, g, b, 1)
            links.new(tex.outputs["Color"], mix.inputs[2])
            links.new(mix.outputs["Color"], bsdf.inputs["Emission Color"])
    else:
        grey = 0.08 if any(w in low for w in ("floor", "stage")) else 0.35
        bsdf.inputs["Base Color"].default_value = (grey, grey, grey * 1.05, 1)
        bsdf.inputs["Roughness"].default_value = 0.25 if "floor" in low else 0.6
    alpha = next((v for k, v in config.get("translucent", {}).items() if k.lower() in low), None)
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        else:
            m.blend_method = "BLEND"
    materials[name] = m
    return m


hidden = bpy.data.collections.new("hidden_in_game")
shown = bpy.data.collections.new("scene")
scene.collection.children.link(shown)
scene.collection.children.link(hidden)
skip_words = [w.lower() for w in config.get("skip_material_words", [])]
# Actors a level sequence hides for the shot being matched (the static level can't say which): exact actor names.
skip_actors = set(config.get("skip_actors", []))
placed = skipped = 0
for i, p in enumerate(placement["meshes"]):
    stem = stem_by_package.get(p.get("mesh") or "")
    if not stem or p["actor"] in skip_actors:
        continue
    names = slot_materials(stem, load_mesh(stem), p.get("overrideMaterials") or [])
    if any(w in n.lower() for n in names for w in skip_words):
        skipped += 1
        continue
    obj = bpy.data.objects.new(f"{p['actor']}.{p['component']}", load_mesh(stem))
    obj.matrix_world = Matrix(p["matrix"])
    for slot in range(len(obj.data.materials)):
        obj.material_slots[slot].link = "OBJECT"
        obj.material_slots[slot].material = material(names[slot] if slot < len(names) else None)
    (shown if p.get("visible", True) else hidden).objects.link(obj)
    placed += 1
if not config.get("include_hidden"):
    bpy.context.view_layer.layer_collection.children["hidden_in_game"].exclude = True

if config.get("standin"):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=1.8, location=Vector(config["standin"]) + Vector((0, 0, 0.9)))
    bpy.context.active_object.name = "character_standin"
    bpy.context.active_object.data.materials.append(material("standin"))

world = bpy.data.worlds.new("dark")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.01, 0.012, 0.02, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world
fill = bpy.data.lights.new("fill", "SUN")
fill.energy = 0.6
fill_obj = bpy.data.objects.new("fill", fill)
fill_obj.rotation_euler = (math.radians(50), 0, math.radians(200))
scene.collection.objects.link(fill_obj)

cam_cfg = config["camera"]
cam_data = bpy.data.cameras.new("game_camera")
cam_data.sensor_fit = "HORIZONTAL"
cam_data.clip_start = 0.05
cam_data.clip_end = 500
cam = bpy.data.objects.new("game_camera", cam_data)
if "pos" in cam_cfg:
    # A camera matched by hand ("pos" and "target" in Blender metres, "lens" in mm): for shots whose camera a level
    # sequence animates, so no placed camera holds it.
    pos, target = Vector(cam_cfg["pos"]), Vector(cam_cfg["target"])
    cam_data.lens = cam_cfg.get("lens", 35.0)
    m = Matrix.Translation(pos) @ (target - pos).to_track_quat("-Z", "Y").to_matrix().to_4x4()
else:
    src = next(c for c in placement["cameras"] if c["actor"] == cam_cfg["actor"] and c["level"] == cam_cfg["level"])
    cam_data.lens = src["values"].get("CurrentFocalLength", 35.0)
    m = Matrix(src["matrix"])
if cam_cfg.get("offset_cm"):
    # The offset is in the camera rig's frame (Unreal cm: forward, right, up); in Blender's camera frame that is
    # -Z (forward), +X with Unreal's Y mirrored (right), +Y (up).
    x, y, z = (v / 100.0 for v in cam_cfg["offset_cm"])
    m = m @ Matrix.Translation(Vector((y, z, -x)))
cam.matrix_world = m
scene.collection.objects.link(cam)
scene.camera = cam

engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = config.get("resolution", [1600, 900])
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = config.get("view_transform", "AgX")
report = {"placed": placed, "skippedByMaterial": skipped, "camera": cam_cfg, "cameraWorld": [list(r) for r in cam.matrix_world],
          "lens": cam_data.lens, "renders": []}
for sensor in config.get("sensors_mm", [36.0]):
    cam_data.sensor_width = sensor
    out = f"{out_prefix}-sensor{sensor:g}.png"
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    report["renders"].append(out)
bpy.ops.wm.save_as_mainfile(filepath=f"{out_prefix}.blend")
pathlib.Path(f"{out_prefix}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
print("BLOCKOUT", json.dumps(report))
