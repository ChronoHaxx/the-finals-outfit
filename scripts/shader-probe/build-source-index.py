"""Index decoded customization records against catalog IDs without token inference.

The ID link uses the catalog's exact DA-name slug convention. Mesh/slot/material
relationships come exclusively from decoded properties, and unresolved IDs remain
explicit. Generated records and game package paths stay outside tracked source.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re


def slug(name):
    raw = name.removeprefix("DA_")
    value = re.sub("[^a-z0-9]+", "-", raw.lower()).strip("-")
    # Same FNV-1a truncation as scripts/import-catalog.ts. Do not guess a match
    # from a common prefix: long catalog IDs also require the exact hash suffix.
    if len(value) > 48:
        hash_value = 0x811c9dc5
        for char in raw:
            hash_value = ((hash_value ^ ord(char)) * 0x01000193) & 0xffffffff
        value = value[:43].rstrip("-") + "-" + f"{hash_value:x}"[:4].rjust(4, "0")
    return value


def object_path(value):
    return (value or {}).get("AssetPathName", "")


def build(definitions, catalog, output):
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    extraction = json.loads((definitions / "assets.json").read_text())
    by_file = {r.get("propertiesFile", Path(r["path"]).stem + ".properties.json"): r for r in extraction if "error" not in r}
    records, bodies, other = {}, {}, Counter()
    ids = defaultdict(list)
    materials, meshes, tags = Counter(), Counter(), Counter()
    features = Counter()
    for file in sorted(definitions.glob("*.properties.json")):
        source = by_file[file.name]
        for obj in json.loads(file.read_text()):
            p = obj.get("properties") or {}
            if obj["type"] == "BodyType":
                bodies[obj["Name"]] = {"source": source["path"], "sourceSha256": source["sha256"], "properties": p}
            if obj["type"] != "CharacterCustomizationItem":
                other[obj["type"]] += 1
                continue
            record = {"source": source["path"], "sourceSha256": source["sha256"],
                      "propertiesSha256": hashlib.sha256(file.read_bytes()).hexdigest(), "properties": p}
            records[obj["Name"]] = record
            ids[slug(obj["Name"])].append(obj["Name"])
            parts = p.get("VisualParts", [])
            features["multipleParts"] += len(parts) > 1
            features["noVisualParts"] += not parts
            features["parentVariant"] += bool(object_path(p.get("ParentVariant")))
            features["activatedMaterialParameters"] += bool(p.get("ActivatesMaterialParameters"))
            tags.update(p.get("ActivatesTags", []))
            for part in parts:
                features["attachedParts"] += bool(part.get("bIsAttached"))
                features["wrapDeformedParts"] += bool(part.get("WrapDeformation", {}).get("bIsWrapDeformed"))
                for field in ["SkeletalMesh", "StaticMesh"]:
                    path = object_path(part.get(field))
                    if path:
                        meshes[path] += 1
                for override in part.get("TagOverrides", []):
                    if override.get("bOverrideMesh"):
                        replacements = [object_path(override.get(k)) for k in ["ReplacementStaticMesh", "ReplacementSkeletalMesh"]]
                        features["hidePartRules" if not any(replacements) else "replacePartRules"] += 1
                        for path in replacements:
                            if path:
                                meshes[path] += 1
                    for m in override.get("MaterialOverrides", []):
                        path = object_path(m.get("Value"))
                        if path:
                            materials[path] += 1
            for m in p.get("MaterialOverrides", []):
                path = object_path(m.get("Value"))
                if path:
                    materials[path] += 1
            for m in p.get("ActivatesMaterialParameters", []):
                path = object_path(m.get("MaterialInstance"))
                if path:
                    materials[path] += 1
    links, unresolved, ambiguous = {}, [], []
    items = json.loads(catalog.read_text())
    for item in items:
        candidates = ids.get(item["id"], [])
        if len(candidates) == 1:
            links[item["id"]] = candidates[0]
        elif candidates:
            ambiguous.append({"id": item["id"], "candidates": candidates})
        else:
            unresolved.append(item["id"])
    report = {"catalogItems": len(items), "decodedCustomizationRecords": len(records),
              "catalogIdsResolved": len(links), "catalogIdsUnresolved": len(unresolved),
              "catalogIdsAmbiguous": len(ambiguous), "bodyTypes": len(bodies),
              "referencedMeshesIncludingVariants": len(meshes), "explicitMaterialReferences": len(materials),
              "features": dict(features), "otherDecodedTypes": dict(other),
              "extractionFailures": [r for r in extraction if "error" in r],
              "unresolvedCatalogIds": unresolved, "ambiguousCatalogIds": ambiguous,
              "coverageMeaning": "Source relationships only. Rendering and game-reference fidelity are not measured by these counts."}
    payload = {"formatVersion": 1, "catalog": links, "definitions": records, "bodyTypes": bodies}
    (output / "customization.json").write_text(json.dumps(payload, separators=(",", ":")))
    (output / "coverage.json").write_text(json.dumps(report, indent=2))
    (output / "material-references.json").write_text(json.dumps(dict(materials.most_common()), indent=2))
    (output / "mesh-references.json").write_text(json.dumps(dict(meshes.most_common()), indent=2))
    (output / "activated-tags.json").write_text(json.dumps(dict(tags.most_common()), indent=2))
    # Per-item runtime records let the viewer fetch only the selected outfit.
    runtime = output / "items"
    runtime.mkdir()
    for item_id, definition in links.items():
        (runtime / (item_id + ".json")).write_text(json.dumps(
            {"formatVersion": 1, "id": item_id, **records[definition]}, separators=(",", ":")))
    (output / "catalog.json").write_text(json.dumps({"formatVersion": 1, "items": sorted(links)}, separators=(",", ":")))
    print(json.dumps({k: v for k, v in report.items() if k not in ["unresolvedCatalogIds", "ambiguousCatalogIds", "extractionFailures"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--definitions", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("src/data/items.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.definitions, args.catalog, args.output)
