"""Convert the source mesh DTO to GLB without merging vertices or reducing weights.

Raw DTO JSON remains the exact decoded source reference. GLB changes units/basis
and makes normal/tangent XYZ unit length as required by glTF. Materials are named
placeholders; surface reconstruction and outfit assembly bind them separately.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


class Glb:
    def __init__(self):
        self.doc = {"asset": {"version": "2.0", "generator": "finals-source-mesh-v1"},
                    "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
                    "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
        self.data = bytearray()

    def accessor(self, values, kind, dtype="<f4", normalized=False, bounds=False, target=None):
        data = np.asarray(values, dtype=dtype)
        if not len(data) or not np.isfinite(data).all():
            raise ValueError("Empty or non-finite accessor")
        self.data.extend(b"\0" * (-len(self.data) % 4))
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": data.nbytes}
        if target:
            view["target"] = target
        self.data.extend(data.tobytes())
        component = {"<f4": 5126, "<u4": 5125, "<u2": 5123, "u1": 5121}[dtype]
        a = {"bufferView": len(self.doc["bufferViews"]), "componentType": component,
             "count": len(data), "type": kind}
        if normalized:
            a["normalized"] = True
        if bounds:
            a["min"] = np.atleast_1d(data.min(axis=0)).tolist()
            a["max"] = np.atleast_1d(data.max(axis=0)).tolist()
        self.doc["bufferViews"].append(view)
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"]) - 1

    def write(self, path):
        self.doc["buffers"] = [{"byteLength": len(self.data)}]
        header = json.dumps(self.doc, separators=(",", ":"), allow_nan=False).encode()
        header += b" " * (-len(header) % 4)
        self.data.extend(b"\0" * (-len(self.data) % 4))
        path.write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(header) + len(self.data))
                         + struct.pack("<II", len(header), 0x4E4F534A) + header
                         + struct.pack("<II", len(self.data), 0x004E4942) + self.data)


def basis(values, scale=1):
    return np.asarray(values, dtype=np.float64)[..., [0, 2, 1]] * scale


def transform(bone):
    x, y, z, w = np.asarray(bone["rotation"], dtype=np.float64)[[0, 2, 1, 3]] * [-1, -1, -1, 1]
    quat = np.array([x, y, z, w])
    quat /= np.linalg.norm(quat)
    x, y, z, w = quat
    rotation = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    scale = basis(bone["scale"])
    translation = basis(bone["translation"], .01)
    matrix = np.eye(4)
    matrix[:3, :3] = rotation @ np.diag(scale)
    matrix[:3, 3] = translation
    return {"name": bone["name"], "translation": translation.tolist(),
            "rotation": quat.tolist(), "scale": scale.tolist()}, matrix


def build(source, output):
    raw = source.read_bytes()
    d = json.loads(raw)
    if d.get("formatVersion") != 1 or d.get("coordinates") != "Unreal original, centimeters":
        raise ValueError("Unsupported source format or coordinate convention")
    if len(d["lods"]) != 1:
        raise ValueError("This builder requires one explicitly selected source LOD")
    lod = d["lods"][0]
    glb = Glb()
    doc = glb.doc
    name = source.name.removesuffix(".mesh.json")
    provenance = {"source": d["source"], "sourceDtoSha256": hashlib.sha256(raw).hexdigest(),
                  "sourceLod": lod["sourceLod"], "coordinateConversion": "(X,Z,Y)*0.01",
                  "pipelineVersion": 1}
    doc["extras"] = provenance
    bones = d.get("bones") or []
    if len(bones) > 65535:
        raise ValueError("Skeleton exceeds the supported uint16 joint index range")
    world = []
    for i, bone in enumerate(bones):
        parent = bone["parent"]
        if parent >= i or parent < -1:
            raise ValueError("Bones must form an acyclic parent-before-child hierarchy")
        node, local = transform(bone)
        doc["nodes"].append(node)
        world.append(world[parent] @ local if parent >= 0 else local)
        if parent >= 0:
            doc["nodes"][parent].setdefault("children", []).append(i)
        else:
            doc["scenes"][0]["nodes"].append(i)
    if bones:
        inverses = np.array([np.linalg.inv(m).T.reshape(16) for m in world])
        doc["skins"] = [{"joints": list(range(len(bones))),
                          "inverseBindMatrices": glb.accessor(inverses, "MAT4")}]

    n = len(lod["positions"])
    positions = basis(lod["positions"], .01)
    normals = np.asarray(lod["normals"], dtype=float)
    tangents = np.asarray(lod["tangents"], dtype=float)
    if not n or normals.shape != (n, 4) or tangents.shape != (n, 4):
        raise ValueError("Normal/tangent count differs from source vertex count")
    lengths = np.linalg.norm(normals[:, :3], axis=1)
    tangent_lengths = np.linalg.norm(tangents[:, :3], axis=1)
    if min(lengths.min(), tangent_lengths.min()) < 1e-8 or np.any(normals[:, 3] == 0):
        raise ValueError("Degenerate source tangent frame")
    attrs = {"POSITION": glb.accessor(positions, "VEC3", bounds=True, target=34962),
             "NORMAL": glb.accessor(basis(normals[:, :3]) / lengths[:, None], "VEC3", target=34962),
             # Reflection reverses cross(N,T); preserve the source bitangent direction.
             "TANGENT": glb.accessor(np.column_stack((basis(tangents[:, :3]) / tangent_lengths[:, None],
                                                       -np.sign(normals[:, 3]))), "VEC4", target=34962)}
    for i, uv in enumerate(lod["uvs"]):
        if len(uv) != n:
            raise ValueError("UV count differs from source vertex count")
        attrs[f"TEXCOORD_{i}"] = glb.accessor(uv, "VEC2", target=34962)
    for i, colour in enumerate(lod.get("colours") or []):
        if len(colour["values"]) != n:
            raise ValueError("Colour count differs from source vertex count")
        values = [list(base64.b64decode(v, validate=True)) if isinstance(v, str) else v for v in colour["values"]]
        attrs[f"COLOR_{i}"] = glb.accessor(values, "VEC4", "u1", normalized=True, target=34962)
    influence_count = max((len(x) for x in lod["influences"]), default=0)
    if bones:
        if not 0 < influence_count <= 8 or len(lod["influences"]) != n:
            raise ValueError("Unsupported skin influence count (no weights are truncated)")
        joints = np.zeros((n, 8), dtype=np.uint16)
        weights = np.zeros((n, 8), dtype=np.float32)
        for v, influences in enumerate(lod["influences"]):
            for k, inf in enumerate(influences):
                if not 0 <= inf["Bone"] < len(bones) or inf["Weight"] < 0:
                    raise ValueError("Invalid bone index or skin weight")
                joints[v, k], weights[v, k] = inf["Bone"], inf["Weight"]
        if not np.allclose(weights.sum(axis=1), 1, atol=1e-5, rtol=0):
            raise ValueError("Source skin weights do not sum to one")
        for i in range((influence_count + 3) // 4):
            attrs[f"JOINTS_{i}"] = glb.accessor(joints[:, 4*i:4*i+4], "VEC4", "<u2", target=34962)
            attrs[f"WEIGHTS_{i}"] = glb.accessor(weights[:, 4*i:4*i+4], "VEC4", target=34962)
    elif influence_count:
        raise ValueError("Source skin weights have no skeleton")

    targets, target_names = [], []
    for morph in lod["morphs"]:
        pos = np.zeros((n, 3))
        norm = np.zeros((n, 3))
        seen = set()
        for delta in morph["deltas"]:
            v = delta["vertex"]
            if not 0 <= v < n or v in seen:
                raise ValueError("Invalid or duplicate morph source vertex")
            seen.add(v)
            pos[v] = basis(delta["position"], .01)
            # Scaling both base normal and deltas by the same factor preserves
            # normalize(N + sum(weight * delta)) for arbitrary morph combinations.
            norm[v] = basis(delta["normal"]) / lengths[v]
        targets.append({"POSITION": glb.accessor(pos, "VEC3", bounds=True),
                        "NORMAL": glb.accessor(norm, "VEC3")})
        target_names.append(morph["name"])
    if len(set(target_names)) != len(target_names):
        raise ValueError("Duplicate morph names")

    for i, material in enumerate(d["materials"]):
        native = (d.get("sourceMaterials") or [{}] * len(d["materials"]))[i]
        doc["materials"].append({"name": material["name"],
                                  "pbrMetallicRoughness": {"baseColorFactor": [.45, .45, .45, 1],
                                                           "metallicFactor": 0, "roughnessFactor": .7},
                                  "extras": {"sourceMaterial": material["path"], "sourceSlot": native}})
    indices = np.asarray(lod["indices"], dtype=np.uint32)
    if len(indices) % 3 or indices.max() >= n:
        raise ValueError("Invalid source index buffer")
    primitives = []
    covered = np.zeros(len(indices), dtype=bool)
    for section in lod["sections"]:
        start, count, mat = section["FirstIndex"], section["NumFaces"] * 3, section["MaterialIndex"]
        if not 0 <= start <= start + count <= len(indices) or np.any(covered[start:start+count]):
            raise ValueError("Invalid or overlapping section range")
        if not 0 <= mat < len(doc["materials"]):
            raise ValueError("Invalid section material")
        covered[start:start+count] = True
        if not count:
            continue
        # UE's clockwise source indices become glTF CCW under the Y/Z reflection.
        # Reversing them again would turn these meshes inside out.
        prim = {"attributes": attrs, "indices": glb.accessor(indices[start:start+count], "SCALAR", "<u4", target=34963),
                "material": mat, "mode": 4, "extras": {"sourceSection": section}}
        if targets:
            prim["targets"] = targets
        primitives.append(prim)
    if not covered.all() or not primitives:
        raise ValueError("Sections do not cover the source index buffer")
    mesh = {"name": name, "primitives": primitives, "extras": {"targetNames": target_names, **provenance}}
    if targets:
        mesh["weights"] = [0] * len(targets)
    doc["meshes"].append(mesh)
    node = {"name": name, "mesh": 0}
    if bones:
        node["skin"] = 0
    doc["scenes"][0]["nodes"].append(len(doc["nodes"]))
    doc["nodes"].append(node)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError(f"Preserve existing output: {output}")
    glb.write(output)
    return {**provenance, "file": output.name, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "vertices": n, "triangles": len(indices)//3, "uvSets": len(lod["uvs"]),
            "morphs": target_names, "bones": len(bones), "maxInfluences": influence_count,
            "materialSections": len(primitives)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sources = sorted(p for folder in args.inputs for p in folder.glob("*.mesh.json"))
    if not sources or len({p.name.lower() for p in sources}) != len(sources):
        raise ValueError("No source meshes, or colliding source output names")
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("Output directory must be empty")
    report = [build(p, args.output / (p.name.removesuffix(".mesh.json") + ".glb")) for p in sources]
    (args.output / "meshes.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"meshes": len(report), "vertices": sum(r["vertices"] for r in report),
                      "morphs": sum(len(r["morphs"]) for r in report)}, indent=2))
