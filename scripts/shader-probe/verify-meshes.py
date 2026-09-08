"""Independently read generated GLBs and compare their data with the source DTOs."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


def verify(source, path):
    d = json.loads(source.read_bytes())
    lod = d["lods"][0]
    raw = path.read_bytes()
    magic, version, length, json_length, kind = struct.unpack_from("<5I", raw)
    assert (magic, version, length, kind) == (0x46546c67, 2, len(raw), 0x4e4f534a)
    g = json.loads(raw[20:20+json_length])
    start = 28 + json_length
    assert g["extras"]["sourceDtoSha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    def read(index):
        a = g["accessors"][index]
        v = g["bufferViews"][a["bufferView"]]
        size = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        dtype = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]]
        return np.frombuffer(raw, dtype=dtype, count=a["count"]*size,
                             offset=start+v.get("byteOffset", 0)+a.get("byteOffset", 0)).reshape(-1, size)
    primitives = g["meshes"][0]["primitives"]
    attrs = primitives[0]["attributes"]
    p = read(attrs["POSITION"]).astype(float)
    # Reverse the conversion when checking against the original centimeter data.
    np.testing.assert_allclose(p[:, [0, 2, 1]] * 100, lod["positions"], rtol=0, atol=1.2e-5)
    for i, uv in enumerate(lod["uvs"]):
        np.testing.assert_array_equal(read(attrs[f"TEXCOORD_{i}"]), np.asarray(uv, dtype=np.float32))
    for i, colour in enumerate(lod.get("colours") or []):
        expected = [list(base64.b64decode(v)) if isinstance(v, str) else v for v in colour["values"]]
        np.testing.assert_array_equal(read(attrs[f"COLOR_{i}"]), expected)
    source_n = np.array(lod["normals"], dtype=float)
    source_t = np.array(lod["tangents"], dtype=float)
    n = read(attrs["NORMAL"])
    t = read(attrs["TANGENT"])
    np.testing.assert_allclose(np.linalg.norm(n, axis=1), 1, atol=1e-6)
    np.testing.assert_allclose(np.linalg.norm(t[:, :3], axis=1), 1, atol=1e-6)
    np.testing.assert_array_equal(np.abs(t[:, 3]), 1)
    bitangent = np.cross(n, t[:, :3]) * t[:, 3, None]
    source_bitangent = np.cross(source_n[:, :3], source_t[:, :3]) * np.sign(source_n[:, 3, None])
    def unit(v):
        return v / np.linalg.norm(v, axis=1)[:, None]
    np.testing.assert_allclose(unit(bitangent[:, [0, 2, 1]]), unit(source_bitangent), atol=3e-7)
    indices = np.concatenate([read(x["indices"]).ravel() for x in primitives])
    np.testing.assert_array_equal(indices, lod["indices"])
    for prim, section in zip(primitives, lod["sections"]):
        assert prim["material"] == section["MaterialIndex"]
        assert len(read(prim["indices"])) == section["NumFaces"]*3
    triangles = p[indices.reshape(-1, 3)]
    area = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    face = np.einsum("ij,ij->i", area, n[indices.reshape(-1, 3)[:, 0]])
    area_good = np.linalg.norm(area, axis=1) > 1e-12
    facing = np.mean(face[area_good] > 0)
    source_tri = np.array(lod["positions"])[indices.reshape(-1, 3)]
    source_area = np.cross(source_tri[:, 1]-source_tri[:, 0], source_tri[:, 2]-source_tri[:, 0])
    source_face = np.einsum("ij,ij->i", source_area, source_n[indices.reshape(-1, 3)[:, 0], :3])
    expected_face = -source_face * .0001 / np.linalg.norm(source_n[indices.reshape(-1, 3)[:, 0], :3], axis=1)
    # Preserve the source's relationship between winding and vertex normals, even
    # on authored double-sided cards or sharp edges whose first normal faces away.
    np.testing.assert_allclose(face, expected_face, rtol=.001, atol=1e-8)
    if d.get("bones"):
        sets = 2 if "WEIGHTS_1" in attrs else 1
        joints = np.concatenate([read(attrs[f"JOINTS_{i}"]) for i in range(sets)], axis=1)
        weights = np.concatenate([read(attrs[f"WEIGHTS_{i}"]) for i in range(sets)], axis=1)
        for vertex, influences in enumerate(lod["influences"]):
            np.testing.assert_array_equal(joints[vertex, :len(influences)], [i["Bone"] for i in influences])
            np.testing.assert_array_equal(weights[vertex, :len(influences)], np.array([i["Weight"] for i in influences], dtype=np.float32))
            assert not weights[vertex, len(influences):].any()
    names = g["meshes"][0]["extras"]["targetNames"]
    assert names == [m["name"] for m in lod["morphs"]]
    morph_targets = primitives[0].get("targets", [])
    # Test simultaneous morphs, including negative and fractional weights. This
    # catches treating delta normals as absolute normals or matching by position.
    source_positions = np.array(lod["positions"], dtype=float)
    source_normals = source_n[:, :3].copy()
    positions = p.copy()
    normals = n.astype(float).copy()
    for index, (morph, target) in enumerate(zip(lod["morphs"], morph_targets)):
        weight = [-.2, .35, 1][index % 3]
        deltas = morph["deltas"]
        ids = np.array([x["vertex"] for x in deltas], dtype=int)
        delta = read(target["POSITION"])
        expected = np.zeros_like(source_positions)
        expected[ids] = [x["position"] for x in deltas]
        np.testing.assert_allclose(delta[:, [0, 2, 1]] * 100, expected, atol=2e-6, rtol=2e-7)
        positions += weight * delta
        normals += weight * read(target["NORMAL"])
        source_positions[ids] += weight * np.array([x["position"] for x in deltas])
        source_normals[ids] += weight * np.array([x["normal"] for x in deltas])
    np.testing.assert_allclose(positions[:, [0, 2, 1]] * 100, source_positions, rtol=0, atol=1.6e-5)
    # A body can combine 33 independent float32 morph buffers here; allow the
    # accumulated rounding through normalization, including near-cancelling sums.
    np.testing.assert_allclose(unit(normals[:, [0, 2, 1]]), unit(source_normals), atol=2e-6, rtol=0)
    return {"file": path.name, "passed": True, "vertices": len(p), "morphs": len(names),
            "frontFacingFraction": float(facing), "sha256": hashlib.sha256(raw).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--meshes", type=Path, required=True)
    args = parser.parse_args()
    report = [verify(file, args.meshes / (file.name.removesuffix(".mesh.json") + ".glb"))
              for file in sorted(args.source.glob("*.mesh.json"))]
    assert report, "No source meshes found"
    (args.meshes / "verification.json").write_text(json.dumps(report, indent=2))
    print(f"Verified {len(report)} meshes, {sum(r['vertices'] for r in report)} vertices, {sum(r['morphs'] for r in report)} morphs")
