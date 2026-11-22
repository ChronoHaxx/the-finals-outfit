"""Summarise an FModel umap JSON: export types, static meshes referenced (with counts), materials overridden, lights."""
import json, sys, collections, re
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
types = collections.Counter(e.get("Type") for e in data)
print("exports:", len(data))
for t, n in types.most_common(60): print(f"  {n:5d} {t}")
meshes = collections.Counter(); mats = collections.Counter(); lights = []
def walk(o, owner=None):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "StaticMesh" and isinstance(v, dict) and "ObjectPath" in v: meshes[v["ObjectPath"].split(".")[0]] += 1
            if k == "OverrideMaterials" and isinstance(v, list):
                for m in v:
                    if isinstance(m, dict) and "ObjectPath" in m: mats[m["ObjectPath"].split(".")[0]] += 1
            walk(v, owner)
    elif isinstance(o, list):
        for x in o: walk(x, owner)
for e in data:
    walk(e.get("Properties", {}))
    if "Light" in (e.get("Type") or "") and "Component" in (e.get("Type") or ""):
        p = e.get("Properties", {})
        lights.append((e["Type"], e["Name"], p.get("Intensity"), p.get("Mobility"), p.get("CastShadows"), p.get("LightColor")))
print("static meshes (distinct):", len(meshes), "instances:", sum(meshes.values()))
for m, n in meshes.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 40): print(f"  {n:4d} {m}")
print("override materials (distinct):", len(mats))
for m, n in mats.most_common(30): print(f"  {n:4d} {m}")
print("lights:", len(lights))
for l in lights[:40]: print("  ", l)
