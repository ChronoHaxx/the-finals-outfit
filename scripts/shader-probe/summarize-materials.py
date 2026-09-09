"""Group explicit material references by parent and actual compiled shader hash."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path


def summarize(inventory, output):
    data = json.loads(inventory.read_text())
    records = {r["path"].lower(): r for r in data["records"]}
    families, variants = defaultdict(list), defaultdict(list)
    unresolved, resolved = [], []
    for material in data["records"]:
        chain, seen = [], set()
        current = material
        error = None
        while current:
            if current["path"].lower() in seen:
                error = "parent cycle"; break
            seen.add(current["path"].lower())
            chain.append(current)
            parent = current.get("parent")
            if not parent:
                break
            current = records.get(parent.lower())
            if current is None:
                error = "missing parent: " + parent
        root = chain[-1]["path"] if not error else "unresolved"
        families[root].append(material["path"])
        # An instance with its own static permutation must not silently borrow
        # another parent's shader when its requested platform/quality is absent.
        owner = next((r for r in chain if r["resources"] or r.get("declaresStaticPermutation")), None)
        selected = [] if not owner else [s for resource in owner["resources"]
            if resource["platform"] == "SP_PCD3D_SM5" and resource["quality"] == "Num"
            for s in resource["basePassShaders"]
            if s["vertexFactory"] == "TGPUSkinVertexFactoryDefault" and s["type"] == "TBasePassPSFNoLightMapPolicy"]
        if error or len(selected) != 1 or not selected[0].get("outputHash"):
            unresolved.append({"path": material["path"], "reason": error or
                (owner or {}).get("unresolved") or "No unique SM5 Num/default-skin/no-lightmap base-pass shader"})
            continue
        shader = selected[0]
        variants[shader["outputHash"]].append(material["path"])
        resolved.append({"path": material["path"], "root": root, "shaderOwner": owner["path"],
                         "outputHash": shader["outputHash"], "parentChain": [r["path"] for r in chain]})
    shaders = [s for r in data["records"] for resource in r["resources"] for s in resource["basePassShaders"]]
    report = {"formatVersion": 1, "scope": data["note"], "requestedMaterialReferences": data["requested"],
              "materialsIncludingParents": len(records), "parseErrors": data["errors"],
              "rootFamilies": len(families), "materialsWithSelectedShader": len(resolved),
              "uniqueSelectedPixelShaders": len(variants), "materialsWithoutSelectedShader": len(unresolved),
              "archiveHashReferencesResolved": sum(bool(s.get("outputHash")) for s in shaders),
              "archiveHashReferencesTotal": len(shaders),
              "families": [{"parent": p, "materials": len(v)} for p,v in sorted(families.items(), key=lambda x: -len(x[1]))],
              "variants": [{"outputHash": h, "materials": len(v), "examples": v[:5]} for h,v in sorted(variants.items(), key=lambda x: -len(x[1]))],
              "unresolved": unresolved, "resolved": resolved,
              "meaning": "Parsing, parent grouping and bytecode identity only. A shared shader can still have different parameters, textures and required features."}
    output.write_text(json.dumps(report, indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ["families","variants","unresolved","resolved","parseErrors"]}, indent=2))
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--inventory", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    summarize(args.inventory, args.output)
