"""Write P1's committed evidence (12 Nov 2026, scene backdrops): what was read and where things stand. Numbers only.

Usage: python -I -X utf8 p1_evidence.py OUT.json LEVELS_DIR MENU_PLACEMENT.json TUNNEL_PLACEMENT.json

LEVELS_DIR is the probe's `level` output (its assets.json lists each package's path, size, hash and export count). The
placements come from assemble_scene.py. Positions are Blender metres (x forward into the scene, y left, z up).
"""
import json
import pathlib
import sys

out, levels_dir, menu_path, tunnel_path = sys.argv[1:5]


def pos(m):
    return [round(m[i][3], 2) for i in range(3)]


def scale(m):
    return [round(sum(m[r][c] ** 2 for r in range(3)) ** 0.5, 2) for c in range(3)]


def short(ref):
    return (ref or "").split("/")[-1].split(".")[-1]


def scene(path, light_levels):
    p = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    meshes = [m for m in p["meshes"] if "unsupported" not in m]
    visible = [m for m in meshes if m["visible"]]
    return {
        "levels": p["levels"],
        "meshComponents": len(meshes), "visible": len(visible),
        "instancedUnsupported": sum("unsupported" in m for m in p["meshes"]),
        "visibleMeshes": sorted(({"actor": m["actor"], "mesh": short(m.get("meshName")), "pos": pos(m["matrix"]),
                                  "scale": scale(m["matrix"]),
                                  "materials": [short(o) for o in m["overrideMaterials"] if o]} for m in visible),
                                key=lambda r: (r["pos"][0], r["actor"])),
        "lights": len(p["lights"]),
        "characterLights": [{"actor": l["actor"], "type": l["type"], "pos": pos(l["matrix"]),
                             **{k: l["values"][k] for k in ("Intensity", "IntensityUnits", "LightColor", "Temperature",
                                                            "bUseTemperature", "AttenuationRadius") if k in l["values"]}}
                            for l in p["lights"] if l["level"] in light_levels],
        "cameras": [{"level": c["level"], "actor": c["actor"], "pos": pos(c["matrix"]),
                     **{k: c["values"][k] for k in ("CurrentFocalLength", "CurrentAperture", "Filmback") if k in c["values"]}}
                    for c in p["cameras"]],
        "characterSpots": [{"actor": c["actor"], "type": c["type"], "root": c.get("root"), "pos": pos(c["matrix"])}
                           for c in p["characters"]],
    }


assets = json.loads((pathlib.Path(levels_dir) / "assets.json").read_text(encoding="utf-8"))
result = {
    "read": "12 Nov 2026, installed S12 paks (CL1439418), usmap e5b29e28, ShaderProbe level mode",
    "packages": [{"path": a["path"].replace("Discovery/Content/", ""), "bytes": a.get("bytes"),
                  "sha256": a.get("sha256"), "exports": len(a.get("exports", []))} for a in assets if "error" not in a],
    "menu": scene(menu_path, {"CharacterSelection_Lighting"}),
    "tunnel": scene(tunnel_path, set()),
}
pathlib.Path(out).write_text(json.dumps(result, indent=1), encoding="utf-8")
print(out, len(result["packages"]), "packages;", "menu", result["menu"]["visible"], "visible meshes;",
      "tunnel", result["tunnel"]["visible"], "visible meshes")
