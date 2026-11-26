"""Read-only (26 Nov 2026): which items the patch makes buildable on Light, by the viewer's mesh rule.

An item builds on Light only if every part resolves, under Customization.Archetype.Light, to a mesh the index holds
(src/rig/OutfitPass.ts classUnavailableItems, through resolveSourceRigParts): a part with a Light mesh override needs
that class mesh; a part without one keeps its own mesh. This applies that mesh-presence rule to the item definitions;
it does not evaluate other tag rules, so it is a census, not the viewer's own answer (the captures are).

  python -I items_on_light.py ACTIVE_ASSETS_JSON PATCHED_ASSETS_JSON ITEMS_DIR SUPPORTED_ITEMS_JSON OUT_TSV

Writes one row per supported item that changes state or uses one of the patch's new meshes: whether it builds on Light
before and after, and the class meshes it still lacks.
"""
import json
import os
import sys

LIGHT = "Customization.Archetype.Light"


def parts_on_light(definition):
    """(mesh the part resolves to on Light, its Medium mesh) for every mesh-carrying visual part."""
    out = []
    for part in definition.get("properties", {}).get("VisualParts", []) or []:
        skeletal = (part.get("SkeletalMesh") or {}).get("AssetPathName") or ""
        static = (part.get("StaticMesh") or {}).get("AssetPathName") or ""
        own = skeletal if not part.get("bIsAttached") else static or skeletal
        if not own:
            continue
        resolved = own
        for rule in part.get("TagOverrides", []) or []:
            if rule.get("MatchingTags") == [LIGHT] and rule.get("bOverrideMesh"):
                swap = ((rule.get("ReplacementSkeletalMesh") or {}).get("AssetPathName") or
                        (rule.get("ReplacementStaticMesh") or {}).get("AssetPathName") or "")
                if swap:
                    resolved = swap
        out.append((resolved, own))
    return out


def main(active_json, patched_json, items_dir, supported_json, out_tsv):
    load = lambda p: json.load(open(p, encoding="utf-8"))
    active, patched = set(load(active_json)["meshes"]), set(load(patched_json)["meshes"])
    new = patched - active
    supported = load(supported_json)
    ready = {x["id"] if isinstance(x, dict) else x for x in supported.get("ready", supported.get("items", []))}
    rows = []
    for name in sorted(os.listdir(items_dir)):
        d = load(os.path.join(items_dir, name))
        if d.get("id") not in ready:
            continue
        parts = parts_on_light(d)
        if not parts:
            continue
        before = all(r in active for r, _ in parts)
        after = all(r in patched for r, _ in parts)
        uses_new = any(r in new for r, _ in parts)
        if before != after or uses_new:
            lacking = sorted({r.rsplit(".", 1)[-1] for r, _ in parts if r not in patched})
            rows.append((d["id"], before, after, ",".join(sorted({r.rsplit(".", 1)[-1] for r, _ in parts if r in new})),
                         ",".join(lacking)))
    with open(out_tsv, "w", encoding="utf-8", newline="\n") as f:
        f.write("item\tbuildsOnLightBefore\tbuildsOnLightAfter\tnewMeshesUsed\tstillLacking\n")
        for r in rows:
            f.write("\t".join(map(str, r)) + "\n")
    gained = [r for r in rows if r[2] and not r[1]]
    inert = [r for r in rows if not r[2]]
    print(f"{len(rows)} items use a new mesh or change state; {len(gained)} newly build on Light; "
          f"{len(inert)} use a new mesh but still lack another class mesh")
    used = {m for r in gained for m in r[3].split(",") if m}
    print(f"new meshes seen in a newly buildable item: {len(used)} of {len(new)}")


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    main(*sys.argv[1:])
