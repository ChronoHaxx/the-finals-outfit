"""Are the staged Light/Heavy meshes still the game's meshes after the 17 Nov 2026 update? (22 Nov 2026)

Coordinator rule (the user chose "proven pre-update files", 22 Nov): a pre-update extraction stands in for today's only
where its package is proven byte-identical to today's containers. The archetype index (build-archetype-index.py) takes
its class meshes from season11-staging-20261018, read on 18 Oct from the containers of 2 Oct. That run recorded the
sha256 of every mesh package it read (meshes-raw/chunk-*/assets.json), so this re-reads the same packages from today's
containers with the 18 Oct run's own probe and mapping and compares:
  - the package sha256 (the probe hashes the package bytes it reads: the proof), and
  - the mesh export (mesh.json bytes: the geometry the GLB was built from, bulk data included).
Each class mesh's Medium sibling is read too, for information only: the live index already serves it.

Reads the game containers and the 18 Oct run; writes only --out (must not exist). Windows paths throughout.
  python scripts/archetypes/prove-nov17.py --report scripts/generated/archetypes/apply-v1/report.json
      --out scripts/generated/archetypes/nov17-proof-v1
"""
import argparse, glob, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(r"E:\Coding\the-finals-outfit")
OCT = ROOT / "scripts/generated/shader-probe/season11-staging-20261018/meshes-raw"
TOOLS = {  # the 18 Oct run's own tools (its manifest: _docs/season11-staging-2026-10-18/opus/manifest.json)
    "dotnet": (ROOT / "scripts/generated/shader-probe/tools/dotnet/dotnet.exe", None),
    "probe": (ROOT / "scripts/generated/shader-probe/catalog-refresh-20261018/opus-probe-bin/ShaderProbe.dll",
              "57948870eeff4244002c244598a91860d62781e24356e39210f325b96ed87948"),
    "usmap": (ROOT / "scripts/generated/shader-probe/tools/507_TheFinals_21_08_26.usmap",
              "dae6746f9ad98ba2f9d2d8cc25e536eea716ac9655fda9e7c8cbc49975505418"),
}
PAKS = r"C:\Program Files (x86)\Steam\steamapps\common\The Finals\Discovery\Content\Paks"
OODLE = r"C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll"
SETTINGS = r"C:\Users\ChronoHax\AppData\Roaming\FModel\AppSettings.json"  # the probe reads this game's archive key only


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def package(object_path):
    # /Game/Discovery/Characters/X/SK_X_L.SK_X_L -> Discovery/Content/Discovery/Characters/X/SK_X_L.uasset
    return "Discovery/Content/" + object_path.split(".")[0][len("/Game/"):] + ".uasset"


def rows(folder):
    out = {}
    for f in glob.glob(str(Path(folder) / "**" / "assets.json"), recursive=True):
        for r in json.loads(Path(f).read_text(encoding="utf-8-sig")):
            out[r["path"].lower()] = dict(r, folder=str(Path(f).parent))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        sys.exit(f"Preserve {out}; write a new version instead")
    for name, (path, digest) in TOOLS.items():
        if not path.is_file() or (digest and sha(path) != digest):
            sys.exit(f"{name} is not the 18 Oct run's: {path}")
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    classes = {target: proof["medium"] for target, proof in report["meshes"].items()}
    wanted = sorted({package(p) for p in [*classes, *classes.values()]})
    old = rows(OCT)
    missing = [p for p in wanted if p.lower() not in old]
    if missing:
        sys.exit(f"The 18 Oct run never read {len(missing)} packages, e.g. {missing[:3]}")
    read = out / "read"
    out.mkdir(parents=True)
    (out / "requests.json").write_text(json.dumps(wanted, indent=1) + "\n", encoding="utf-8")
    with open(out / "read.log", "w", encoding="utf-8") as log:
        code = subprocess.call([str(TOOLS["dotnet"][0]), str(TOOLS["probe"][0]), "assets", PAKS, str(TOOLS["usmap"][0]),
                                OODLE, str(read), str(out / "requests.json"), SETTINGS], stdout=log, stderr=subprocess.STDOUT)
    if code != 0:
        sys.exit(f"probe exit {code}; see {out / 'read.log'}")
    new = rows(read)
    run = json.loads((read / "source-run.json").read_text(encoding="utf-8-sig"))
    result = {"policy": "archetypes-nov17-proof-v1", "rule": __doc__.split("\n\n")[1].strip(),
              "report": args.report, "reportSha256": sha(args.report),
              "today": {"containersNewest": max(c["lastWriteTimeUtc"] for c in run["sourceContainers"]),
                        "mappingSha256": run["mappingSha256"], "parserVersion": run["parserVersion"]},
              "packages": {}, "proven": [], "refused": {}, "mediumChanged": []}
    for p in wanted:
        a, b = old[p.lower()], new.get(p.lower())
        row = {"oct": a["sha256"].lower(), "today": b["sha256"].lower() if b else None}
        if b:
            row["meshJsonIdentical"] = sha(Path(a["folder"]) / a["meshFile"]) == sha(Path(b["folder"]) / b["meshFile"])
        row["identical"] = bool(b) and row["oct"] == row["today"] and row.get("meshJsonIdentical") is True
        result["packages"][p] = row
    for target, medium in sorted(classes.items()):
        p = package(target)
        if result["packages"][p]["identical"]:
            result["proven"].append(target)
        else:
            row = result["packages"][p]
            result["refused"][target] = ("not in today's containers" if row["today"] is None else
                                         "package bytes differ" if row["oct"] != row["today"] else "mesh export differs")
        if not result["packages"][package(medium)]["identical"]:
            result["mediumChanged"].append(medium)
    result["mediumChanged"] = sorted(set(result["mediumChanged"]))
    (out / "proof.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"classMeshes": len(classes), "proven": len(result["proven"]), "refused": len(result["refused"]),
                      "mediumChanged": len(result["mediumChanged"]), "containersNewest": result["today"]["containersNewest"]}))


if __name__ == "__main__":
    main()
