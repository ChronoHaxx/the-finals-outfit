"""Assemble an Unreal level read by the shader probe's `level` mode into a placement list (12 Nov 2026, scene backdrops P1).

Input: directories of `<package>.properties.json` files written by `ShaderProbe level` (levels and the blueprint packages
their components use as templates). Output: one JSON with every visible static-mesh component, light and camera, each
with its world matrix in Blender's frame (metres, Z up, right-handed), plus the source values it came from.

How a value is found: an instance stores only what differs from its template (a blueprint's component template, or the
engine's class default). So each property is looked up on the export, then on its template, then on that template's
template; missing everywhere means the engine default (location 0, rotation 0, scale 1, visible).

How a world transform is built: a component's Relative* values are relative to its AttachParent; a component without one
is placed in the world directly. Unreal composes scale, then rotation (FRotator: roll about X, pitch about Y, yaw about Z;
see FRotationMatrix), then translation, child first.

Frames: Unreal is left-handed, Z up, centimetres. Blender is right-handed, Z up, metres. The mesh builder plus Blender's
glTF import turn an Unreal vertex (x, y, z) into (x, -y, z) / 100, so a placement is F W F with F = diag(1, -1, 1) and its
translation divided by 100. Lights and cameras also need a local turn: Unreal aims them along +X with +Z up, Blender along
-Z with +Y up.

Usage: python -I -X utf8 assemble_scene.py OUT.json LEVEL_NAME [LEVEL_NAME ...] --dirs DIR [DIR ...]
"""
import argparse
import json
import math
import pathlib

import numpy as np

F = np.diag([1.0, -1.0, 1.0, 1.0])
# Columns: where Blender's local x, y, z axes go in the converted Unreal local frame (forward +X, up +Z, Y mirrored).
AIM = np.column_stack([[0, -1, 0, 0], [0, 0, 1, 0], [-1, 0, 0, 0], [0, 0, 0, 1]]).astype(float)

MESH_TYPES = ("StaticMeshComponent",)
LIGHT_TYPES = ("PointLightComponent", "SpotLightComponent", "RectLightComponent", "DirectionalLightComponent",
               "SkyLightComponent")
LIGHT_PROPS = ("Intensity", "IntensityUnits", "LightColor", "bUseTemperature", "Temperature", "AttenuationRadius",
               "InnerConeAngle", "OuterConeAngle", "SourceRadius", "SourceLength", "SourceWidth", "SourceHeight",
               "BarnDoorAngle", "BarnDoorLength", "CastShadows", "IndirectLightingIntensity", "VolumetricScatteringIntensity",
               "LightFunctionMaterial", "IESTexture", "bUseIESBrightness")
CAMERA_PROPS = ("CurrentFocalLength", "CurrentAperture", "Filmback", "FocusSettings", "LensSettings", "FieldOfView",
                "AspectRatio", "bConstrainAspectRatio")


def inner(ref):
    """'Type'Level:PersistentLevel.Actor.Comp'' -> 'Level:PersistentLevel.Actor.Comp'."""
    name = ref.get("ObjectName") if isinstance(ref, dict) else ref
    if not name or "'" not in name:
        return name
    return name.split("'", 1)[1].rstrip("'")


def package_of(ref):
    """The package path of an object reference (ObjectPath '/Game/X/Y.0' -> '/Game/X/Y')."""
    if not isinstance(ref, dict) or not ref.get("ObjectPath"):
        return None
    return ref["ObjectPath"].rsplit(".", 1)[0]


def rotator_matrix(rot):
    p, y, r = (math.radians(rot.get(k, 0.0)) for k in ("Pitch", "Yaw", "Roll"))
    sp, cp, sy, cy, sr, cr = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
    # FRotationMatrix rows are the local axes in world space (row-vector convention); columns here.
    x = [cp * cy, cp * sy, sp]
    yy = [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp]
    z = [-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp]
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2] = x, yy, z
    return m


def relative_matrix(loc, rot, scale):
    t = np.eye(4)
    t[:3, 3] = [loc.get("X", 0.0), loc.get("Y", 0.0), loc.get("Z", 0.0)]
    s = np.diag([scale.get("X", 1.0), scale.get("Y", 1.0), scale.get("Z", 1.0), 1.0])
    return t @ rotator_matrix(rot) @ s


def to_blender(world):
    b = F @ world @ F
    b[:3, 3] /= 100.0
    return b


class Level:
    def __init__(self, dirs):
        self.by_path = {}
        for d in dirs:
            for f in pathlib.Path(d).glob("*.properties.json"):
                for e in json.loads(f.read_text(encoding="utf-8")):
                    if "path" in e:
                        self.by_path[e["path"]] = e

    def exports_of(self, level_name):
        prefix = None
        for path in self.by_path:
            if path.split(".", 1)[0].endswith("/" + level_name) and ":PersistentLevel" in path:
                prefix = path.split(".", 1)[0] + "." + level_name + ":"
                break
        if prefix is None:
            raise SystemExit(f"level {level_name} not loaded")
        return prefix.rsplit(".", 1)[0], [e for p, e in self.by_path.items() if p.startswith(prefix)]

    def prop(self, e, name, depth=0):
        while e is not None and depth < 8:
            props = e.get("properties") or {}
            if name in props:
                return props[name]
            t = e.get("template")
            e = self.by_path.get(t) if t else None
            depth += 1
        return None

    def resolve(self, package, ref):
        """A reference inside the same level package to its export."""
        name = inner(ref)
        return self.by_path.get(f"{package}.{name}") if name else None


def assemble(level_dirs, level_names):
    lv = Level(level_dirs)
    meshes, lights, cameras, actors = [], [], [], []
    for level_name in level_names:
        package, exports = lv.exports_of(level_name)
        cache = {}

        def world(e, depth=0):
            key = e["path"]
            if key in cache:
                return cache[key]
            loc = lv.prop(e, "RelativeLocation") or {}
            rot = lv.prop(e, "RelativeRotation") or {}
            scale = lv.prop(e, "RelativeScale3D") or {}
            rel = relative_matrix(loc, rot, scale)
            parent_ref = (e.get("properties") or {}).get("AttachParent")
            parent = lv.resolve(package, parent_ref) if parent_ref else None
            if parent is not None and depth < 32 and not lv.prop(e, "bAbsoluteLocation"):
                m = world(parent, depth + 1) @ rel
            else:
                m = rel
            cache[key] = m
            return m

        def visible(e):
            if lv.prop(e, "bVisible") is False or lv.prop(e, "bHiddenInGame") is True:
                return False
            actor = lv.by_path.get(f"{package}.{level_name}:PersistentLevel.{e['outer']}")
            return not (actor and (actor.get("properties") or {}).get("bHidden") is True)

        for e in exports:
            t = e["type"]
            base = dict(level=level_name, actor=e["outer"], component=e["Name"], type=t, visible=visible(e))
            if t.endswith(MESH_TYPES) and "Instanced" not in t:
                mesh = lv.prop(e, "StaticMesh")
                if not mesh:
                    continue
                overrides = lv.prop(e, "OverrideMaterials") or []
                meshes.append(dict(base, mesh=package_of(mesh), meshName=inner(mesh) or mesh.get("ObjectName"),
                                   overrideMaterials=[package_of(m) for m in overrides],
                                   matrix=to_blender(world(e)).round(6).tolist(),
                                   castShadow=lv.prop(e, "CastShadow")))
            elif "Instanced" in t:
                meshes.append(dict(base, unsupported="instanced static mesh: per-instance data is not a tagged property"))
            elif t in LIGHT_TYPES:
                values = {k: lv.prop(e, k) for k in LIGHT_PROPS}
                lights.append(dict(base, values={k: v for k, v in values.items() if v is not None},
                                   matrix=(to_blender(world(e)) @ AIM).round(6).tolist()))
            elif t == "CineCameraComponent" or t == "CameraComponent":
                values = {k: lv.prop(e, k) for k in CAMERA_PROPS}
                cameras.append(dict(base, values={k: v for k, v in values.items() if v is not None},
                                    matrix=(to_blender(world(e)) @ AIM).round(6).tolist()))
            elif t.startswith("BP_Frontend") and ("Character" in t or "SquadMember" in t or "Dummy" in t):
                # An actor's own outer is the level, so name it by itself. Its root may be inherited from the class
                # default (FrontendCharacter_0 stores none); a Character's root is then its capsule, CollisionCylinder.
                root = lv.resolve(package, (e.get("properties") or {}).get("RootComponent"))
                if root is None:
                    own = [c for c in exports if c["outer"] == e["Name"]]
                    root = next((c for c in own if c["Name"] == "CollisionCylinder"), None) or next(
                        (c for c in own if "AttachParent" not in (c.get("properties") or {})
                         and lv.prop(c, "RelativeLocation") is not None), None)
                if root is not None:
                    actors.append(dict(base, actor=e["Name"], root=root["Name"],
                                       note="capsule centre: feet are one capsule half-height lower (about 0.9 m)"
                                       if root["Name"] == "CollisionCylinder" or "SquadMember" in t or "Dummy" in t else None,
                                       matrix=to_blender(world(root)).round(6).tolist()))
    return dict(meshes=meshes, lights=lights, cameras=cameras, characters=actors)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("levels", nargs="+")
    ap.add_argument("--dirs", nargs="+", required=True)
    a = ap.parse_args()
    result = assemble(a.dirs, a.levels)
    result["levels"] = a.levels
    result["frame"] = "Blender: metres, Z up, right-handed; matrices row-major 4x4; lights/cameras aim along local -Z"
    pathlib.Path(a.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"{a.out}: {len(result['meshes'])} meshes, {len(result['lights'])} lights, {len(result['cameras'])} cameras, "
          f"{len(result['characters'])} character spots")


if __name__ == "__main__":
    main()
