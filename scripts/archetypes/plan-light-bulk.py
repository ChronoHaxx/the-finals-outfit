"""Plan the Light bulk extraction (23 Nov 2026): which class meshes to read, in what order, and in which batches.

Reads only. It takes the archetype builder's report (build-archetype-index.py report.json, with its `skipped` list),
the item definitions, the supported items and the preset outfits. It plans every Light class mesh that was skipped
because no staged read of its Medium sibling matches the live one:
  "medium sibling not staged"   the 18 Oct S11 read never covered it;
  "medium sibling repointed"    the live index serves another Medium GLB (an S12 refresh or one of our fix waves).
Rows the builder refused (a proof failed: reshaped meshes) or skipped for other reasons are not read again here.

Order: the starting outfit's pieces first, then by preset impact (presets that show an item needing the mesh), then by
item count, then by name. Batches of --batch rows; each batch's request list holds the Medium, Light and (unless
--no-heavy) Heavy packages, so every package is read once, Heavy staged for later.

Writes to --out (must not exist):
  rows.tsv          order, batch, Light mesh, Medium mesh, Heavy mesh, skip reason, live Medium folder, presets, items,
                    starter flag;
  requests/bNN.json the package list for one probe "assets" run;
  summary.json      counts, and coverage now vs if every planned row lands (items, presets whole).

Usage (Git Bash, from the worktree root):
  python -I scripts/archetypes/plan-light-bulk.py --report <builder out>/report.json --out <dir>
  python -I scripts/archetypes/plan-light-bulk.py jobs --read <probe out> --glb-dir <dir> --out <jobs.json>
The second form turns one probe "assets" read into the job list for scripts/shader-probe/stage-season-assets.py
build-glbs (the root checkout's converter), named the way the 18 Oct staging named its GLBs: <mesh>.glb.
"""
import argparse, json, sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[2]
DEFAULT_MODELS = next((p / "public" / "models" for p in HERE.parents
                       if (p / "public" / "models" / "reconstructed-assemblies-v1" / "assets.json").is_file()),
                      REPO / "public" / "models")
TAGS = {"light": "Customization.Archetype.Light", "heavy": "Customization.Archetype.Heavy"}
PLANNED = ("medium sibling not staged", "medium sibling repointed")
# src/store/useBuildStore.ts DEFAULT_BUILD (23 Nov 2026), less the face: the outfit a first visit shows.
STARTER = ["casual-basictshirt-cotton-black", "casual-loosejeans-denim-darkblue", "casual-tallsneakers-canvas"]


def package_of(object_path):
    path = object_path.split(".")[0]
    assert path.startswith("/Game/"), object_path
    return "Discovery/Content/" + path[len("/Game/"):] + ".uasset"


def light_parts(definition):
    """Each visual part's mesh on Light: (mesh, swapped, refusal). A non-identity Light offset rule is unsupported."""
    for part in definition.get("properties", {}).get("VisualParts", []) or []:
        mesh = (part.get("SkeletalMesh") or {}).get("AssetPathName") or (part.get("StaticMesh") or {}).get("AssetPathName") or ""
        swapped, refusal = False, None
        for rule in part.get("TagOverrides", []) or []:
            if rule.get("MatchingTags") != [TAGS["light"]]:
                continue
            if rule.get("bOffsetTransform"):
                p, r, s = rule["OffsetPosition"], rule["OffsetRotation"], rule["OffsetScale"]
                if any(abs(v) > 1e-6 for v in [*p.values(), *r.values()]) or any(abs(v - 1) > 1e-6 for v in s.values()):
                    refusal = "Light offset rule"
            if rule.get("bOverrideMesh"):
                target = ((rule.get("ReplacementSkeletalMesh") or {}).get("AssetPathName")
                          or (rule.get("ReplacementStaticMesh") or {}).get("AssetPathName") or "")
                if target:
                    mesh, swapped = target, True
        yield mesh, swapped, refusal


def jobs():
    ap = argparse.ArgumentParser(prog="plan-light-bulk.py jobs")
    ap.add_argument("--read", required=True)
    ap.add_argument("--glb-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(sys.argv[2:])
    if Path(args.out).exists():
        sys.exit(f"Preserve {args.out}")
    rows = []
    for f in sorted(Path(args.read).glob("**/assets.json")):
        rows += [(f.parent, r) for r in json.loads(f.read_text(encoding="utf-8-sig")) if r.get("meshFile")]
    out = [{"name": r["path"], "meshJson": str(folder / r["meshFile"]).replace("\\", "/"),
            "glbOut": str(Path(args.glb_dir) / (Path(r["meshFile"]).name.replace(".mesh.json", "") + ".glb")).replace("\\", "/"),
            "previous": None} for folder, r in rows]
    if len({j["glbOut"].lower() for j in out}) != len(out):
        sys.exit("Colliding GLB output names (a package read twice?)")
    Path(args.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(len(out), "jobs")


def main():
    if sys.argv[1:2] == ["jobs"]:
        return jobs()
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--models", default=str(DEFAULT_MODELS))
    ap.add_argument("--presets", default=str(REPO / "src" / "data" / "preset-outfits.json"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--no-heavy", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        sys.exit(f"Preserve {out}; write a new version instead")
    models = Path(args.models).resolve()
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    assets = json.loads((models / "reconstructed-assemblies-v1" / "assets.json").read_text(encoding="utf-8"))
    import hashlib
    active = hashlib.sha256((models / "reconstructed-assemblies-v1" / "assets.json").read_bytes()).hexdigest()
    if active != report["activeSha256"]:
        sys.exit(f"The report was built on {report['activeSha256'][:8]}, the active index is {active[:8]}: rebuild it first")
    indexed = assets["meshes"]
    supported = list(json.loads((models / "reconstructed-assemblies-v1" / "supported-items.json").read_text(encoding="utf-8"))["items"])
    presets = json.loads(Path(args.presets).read_text(encoding="utf-8"))["outfits"]

    # The rows: Light meshes skipped for want of a matching Medium read.
    rows = {}
    for target, row in report["skipped"].items():
        if row["class"] != "light":
            continue
        reasons = [r for r in row["reasons"] if r["reason"] in PLANNED]
        if reasons:
            r = reasons[0]
            live = indexed.get(r["medium"], {}).get("url", "")
            rows[target] = {"medium": r["medium"], "reason": r["reason"],
                            "liveFolder": live.split("/")[1] if live.startswith("../") else live.split("/")[0]}

    # Their Heavy siblings, and which supported items and presets need each Light mesh.
    defs, heavy = {}, {}
    for item in supported:
        f = models / "reconstructed-assembly-v2" / "items" / f"{item}.json"
        if f.exists():
            defs[item] = json.loads(f.read_text(encoding="utf-8"))
            for part in defs[item].get("properties", {}).get("VisualParts", []) or []:
                medium = (part.get("SkeletalMesh") or {}).get("AssetPathName") or ""
                for rule in part.get("TagOverrides", []) or []:
                    if rule.get("MatchingTags") == [TAGS["heavy"]] and rule.get("bOverrideMesh"):
                        t = (rule.get("ReplacementSkeletalMesh") or {}).get("AssetPathName") or ""
                        if medium and t:
                            heavy.setdefault(medium, set()).add(t)
    items_of = defaultdict(set)
    for item, d in defs.items():
        for mesh, swapped, _ in light_parts(d):
            if mesh in rows:
                items_of[mesh].add(item)
    presets_of = defaultdict(set)
    for p in presets:
        ids = {piece.get("id") for piece in p["pieces"]}
        for target, items in items_of.items():
            if ids & items:
                presets_of[target].add(p["id"])
    starter = {t for t, items in items_of.items() if items & set(STARTER)}

    order = sorted(rows, key=lambda t: (t not in starter, -len(presets_of[t]), -len(items_of[t]), t))
    lines = ["order\tbatch\tlight\tmedium\theavy\treason\tliveFolder\tpresets\titems\tstarter\n"]
    batches = defaultdict(list)
    for n, t in enumerate(order):
        b = n // args.batch + 1
        r = rows[t]
        h = sorted(heavy.get(r["medium"], ()))
        h = h[0] if len(h) == 1 else ""
        packages = [package_of(r["medium"]), package_of(t)] + ([package_of(h)] if h and not args.no_heavy else [])
        batches[b].extend(packages)
        lines.append(f"{n + 1}\t{b}\t{t}\t{r['medium']}\t{h}\t{r['reason']}\t{r['liveFolder']}\t"
                     f"{len(presets_of[t])}\t{len(items_of[t])}\t{'yes' if t in starter else ''}\n")

    # Coverage now, and if every planned row lands (every other proof assumed to pass: an upper bound).
    def status(item, extra):
        for mesh, swapped, refusal in light_parts(defs[item]):
            if refusal:
                return refusal
            if mesh and mesh not in indexed and mesh not in extra:
                return ("Light mesh refused by a proof" if mesh in report["refused"] else
                        "Light mesh planned here" if mesh in rows else
                        "Light mesh skipped: " + "; ".join(sorted({r["reason"] for r in report["skipped"].get(mesh, {}).get("reasons", [])}) or {"not named"})
                        if swapped else "mesh not indexed")
        return "ok"
    coverage = {}
    batch_of = {t: n // args.batch + 1 for n, t in enumerate(order)}
    steps = [("now", set())] + [(f"throughBatch{b:02d}", {t for t, k in batch_of.items() if k <= b})
                                for b in sorted(batches)[:-1]] + [("ifPlanLands", set(rows))]
    for label, extra in steps:
        st = {item: status(item, extra) for item in defs}
        whole, left = 0, Counter()
        blockers = Counter()
        for p in presets:
            ids = [piece.get("id") for piece in p["pieces"] if piece.get("id") in st]
            off = [i for i in ids if st[i] != "ok"]
            whole += not off
            left[min(len(off), 5)] += 1
            blockers.update(st[i] for i in off)
        coverage[label] = {"items": sum(s == "ok" for s in st.values()), "itemsOf": len(st),
                           "starterWhole": all(st.get(i) == "ok" for i in STARTER),
                           "presetsWhole": whole, "presetsOf": len(presets),
                           "presetsLeftOff": {("5+" if k == 5 else str(k)): v for k, v in sorted(left.items())},
                           "presetPiecesLeftOffBy": dict(blockers.most_common())}

    out.mkdir(parents=True)
    (out / "requests").mkdir()
    (out / "rows.tsv").write_text("".join(lines), encoding="utf-8")
    for b, packages in sorted(batches.items()):
        (out / "requests" / f"b{b:02d}.json").write_text(json.dumps(sorted(set(packages)), indent=1) + "\n", encoding="utf-8")
    summary = {"policy": "archetypes-light-bulk-plan-v1", "report": args.report, "activeSha256": active,
               "rows": len(rows), "byReason": dict(Counter(r["reason"] for r in rows.values())),
               "byLiveFolder": dict(Counter(r["liveFolder"] for r in rows.values()).most_common()),
               "starterRows": sorted(starter), "batches": len(batches), "batchSize": args.batch,
               "packages": sum(len(set(p)) for p in batches.values()), "heavyRead": not args.no_heavy,
               "coverage": coverage}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("rows", "byReason", "batches", "packages")}))
    for label, c in coverage.items():
        print(f"  {label}: items {c['items']}/{c['itemsOf']}, presets whole {c['presetsWhole']}/{c['presetsOf']}, "
              f"starter whole {c['starterWhole']}, left off per preset {c['presetsLeftOff']}")


if __name__ == "__main__":
    main()
