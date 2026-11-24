"""Run the Light bulk extraction, one batch at a time, failing closed (23 Nov 2026).

Reads today's game containers with the hand-patched 12.03 map (w177 step 3e) and converts the meshes to GLBs. It writes
only under --run (never public/models). Every step is recorded in <run>/run.json, which the archetype builder requires
(build-archetype-index.py --staging <run>): a batch counts only if its read used the pinned map, read every requested
package and passed the map's window guard, and only after the control below passed.

  control  Re-read packages proven byte-identical between the 18 Oct read and the 17 Nov containers, with the patched
           map, and require each mesh export (mesh.json) to equal the 18 Oct one byte for byte. Proves the patched map
           reads meshes exactly as the map they were staged with. Run once, before batch 01.
  batch    Read one planned batch (plan-light-bulk.py requests/bNN.json), retry missing packages one at a time, run the
           window guard over every read folder, record, then convert (the root checkout's
           scripts/shader-probe/stage-season-assets.py build-glbs) into <run>/source-glb.

The map: SOURCE_USMAP (default: the w177 patch v1 in _docs/goal-100-2026-10-11/w177-panning-contract/
usmap-patch-2026-11-23/mapping), pinned by sha256; the guard: check_window.py beside it. The probe, paks, Oodle and FModel
settings are the 18 Oct run's, taken from prove-nov17.py.

Usage (Git Bash, any folder; the main checkout must hold the tools):
  python -I scripts/archetypes/run-light-bulk.py control --run <run dir> --proof <prove-nov17 proof.json>
  python -I scripts/archetypes/run-light-bulk.py batch --run <run dir> --plan <plan dir> --batch 01
"""
import argparse, hashlib, importlib.util, json, os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prove_nov17", HERE / "prove-nov17.py")
p17 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p17)
ROOT = p17.ROOT
PATCH = ROOT / "_docs/goal-100-2026-10-11/w177-panning-contract/usmap-patch-2026-11-23"
USMAP = Path(os.environ.get("SOURCE_USMAP") or PATCH / "mapping/5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap")
USMAP_SHA256 = "f36b7c4f27182664ee0ff6dd175d1ed854f3e00b4184607c8599d319502c0c3c"
GUARD = PATCH / "check_window.py"
CONVERTER = ROOT / "scripts/shader-probe/stage-season-assets.py"
PLANNER = HERE / "plan-light-bulk.py"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pins():
    for name, (path, digest) in p17.TOOLS.items():
        if name != "usmap" and (not path.is_file() or (digest and sha(path) != digest)):
            sys.exit(f"{name} is not the 18 Oct run's: {path}")
    if not USMAP.is_file() or sha(USMAP) != USMAP_SHA256:
        sys.exit(f"SOURCE_USMAP {USMAP} is not the pinned patched map {USMAP_SHA256[:8]}")
    for f in (GUARD, CONVERTER):
        if not f.is_file():
            sys.exit(f"missing {f}")


def probe(out, requests, log):
    """One probe "assets" read (out must not exist). Returns the exit code."""
    if out.exists():
        sys.exit(f"Preserve {out}")
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "w", encoding="utf-8") as f:
        return subprocess.call([str(p17.TOOLS["dotnet"][0]), str(p17.TOOLS["probe"][0]), "assets", p17.PAKS, str(USMAP),
                                p17.OODLE, str(out), str(requests), p17.SETTINGS], stdout=f, stderr=subprocess.STDOUT)


def run_record(run):
    f = run / "run.json"
    if f.exists():
        record = json.loads(f.read_text(encoding="utf-8"))
        if record.get("usmapSha256") != USMAP_SHA256:
            sys.exit(f"{f} was started with another map ({record.get('usmapSha256', '?')[:8]})")
        return record
    return {"policy": "archetypes-light-bulk-run-v1", "usmap": str(USMAP), "usmapSha256": USMAP_SHA256,
            "probeSha256": p17.TOOLS["probe"][1], "batches": {}}


def save(run, record):
    # Read, change, write back: other batches' entries are kept as they are.
    tmp = run / "run.json.tmp"
    tmp.write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    tmp.replace(run / "run.json")


def source_run(folder):
    r = json.loads((folder / "source-run.json").read_text(encoding="utf-8-sig"))
    return {"mappingSha256": r["mappingSha256"].lower(), "parserVersion": r.get("parserVersion"),
            "containersNewest": max(c["lastWriteTimeUtc"] for c in r["sourceContainers"])}


def guard(folders):
    dirs = sorted({str(Path(f).parent) for d in folders for f in Path(d).glob("**/*.json")} | {str(d) for d in folders})
    done = subprocess.run([sys.executable, "-I", "-X", "utf8", str(GUARD), *dirs], capture_output=True, text=True)
    return {"exitCode": done.returncode, "folders": len(dirs), "output": (done.stdout + done.stderr)[-2000:]}


def control(args):
    pins()
    run = Path(args.run)
    run.mkdir(parents=True, exist_ok=True)
    record = run_record(run)
    proof = json.loads(Path(args.proof).read_text(encoding="utf-8"))
    identical = sorted(p for p, row in proof["packages"].items() if row.get("identical"))[:args.count]
    if len(identical) < args.count:
        sys.exit(f"only {len(identical)} proven-identical packages in {args.proof}")
    requests = run / "control-requests.json"
    requests.write_text(json.dumps(identical, indent=1) + "\n", encoding="utf-8")
    code = probe(run / "control", requests, run / "control.log")
    old, new = p17.rows(p17.OCT), p17.rows(run / "control")
    rows, differ = {}, []
    for p in identical:
        a, b = old[p.lower()], new.get(p.lower())
        same = bool(b) and a["sha256"].lower() == b["sha256"].lower() and \
            sha(Path(a["folder"]) / a["meshFile"]) == sha(Path(b["folder"]) / b["meshFile"])
        rows[p] = same
        if not same:
            differ.append(p)
    g = guard([run / "control"])
    record["control"] = {"ok": code == 0 and not differ and g["exitCode"] == 0, "probeExit": code,
                         "checked": len(identical), "differ": differ, "guard": g, **source_run(run / "control")}
    save(run, record)
    print(json.dumps({k: record["control"][k] for k in ("ok", "checked", "differ", "probeExit")}))
    sys.exit(0 if record["control"]["ok"] else 1)


def batch(args):
    pins()
    run, plan, nn = Path(args.run), Path(args.plan), f"b{int(args.batch):02d}"
    record = run_record(run)
    if not record.get("control", {}).get("ok"):
        sys.exit("run the control first (and it must pass)")
    if nn in record["batches"]:
        sys.exit(f"{nn} is already recorded in {run / 'run.json'}; a re-read needs a new run folder")
    requests = plan / "requests" / f"{nn}.json"
    wanted = json.loads(requests.read_text(encoding="utf-8"))
    if not wanted:
        sys.exit(f"{requests} requests nothing")
    read = run / f"read-{nn}"
    entry = {"requests": str(requests), "requestsSha256": sha(requests), "requested": len(wanted),
             "probeExit": probe(read, requests, run / f"read-{nn}.log")}
    got = p17.rows(read)
    missing = [p for p in wanted if p.lower() not in got]
    for i, p in enumerate(missing):
        single = run / f"read-{nn}-single-{i:03d}"
        (run / f"read-{nn}-single-{i:03d}.json").write_text(json.dumps([p]) + "\n", encoding="utf-8")
        probe(single, run / f"read-{nn}-single-{i:03d}.json", run / f"read-{nn}-single-{i:03d}.log")
        got.update(p17.rows(single))
    folders = [read] + sorted(run.glob(f"read-{nn}-single-*/"))
    entry["missing"] = [p for p in wanted if p.lower() not in got]
    entry.update(source_run(read))
    entry["guard"] = guard([f for f in folders if f.is_dir()])
    ok = entry["mappingSha256"] == USMAP_SHA256 and entry["guard"]["exitCode"] == 0 and not entry["missing"]
    if ok:
        jobs = run / f"jobs-{nn}.json"
        for i, folder in enumerate(f for f in folders if f.is_dir()):
            part = run / f"jobs-{nn}-{i:03d}.json"
            subprocess.check_call([sys.executable, "-I", str(PLANNER), "jobs", "--read", str(folder),
                                   "--glb-dir", str(run / "source-glb"), "--out", str(part)])
        all_jobs = [j for f in sorted(run.glob(f"jobs-{nn}-*.json")) for j in json.loads(f.read_text(encoding="utf-8"))]
        jobs.write_text(json.dumps(all_jobs, indent=1), encoding="utf-8")
        (run / "source-glb").mkdir(exist_ok=True)
        code = subprocess.call([sys.executable, "-I", str(CONVERTER), "build-glbs", "--jobs", str(jobs),
                                "--report", str(run / f"glb-{nn}.json")])
        report = json.loads((run / f"glb-{nn}.json").read_text(encoding="utf-8"))
        entry["glb"] = {"exit": code, "jobs": len(report),
                        "failed": [r["name"] for r in report if r["status"] != "converted"]}
    record["batches"][nn] = entry
    save(run, record)
    print(json.dumps({k: entry.get(k) for k in ("requested", "missing", "probeExit", "mappingSha256")}),
          "guard", entry["guard"]["exitCode"], "glb", entry.get("glb", {}).get("jobs"), "failed",
          len(entry.get("glb", {}).get("failed", [])) if ok else "not converted")
    sys.exit(0 if ok and not entry["glb"]["failed"] else 1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("control")
    c.add_argument("--run", required=True)
    c.add_argument("--proof", required=True)
    c.add_argument("--count", type=int, default=24)
    b = sub.add_parser("batch")
    b.add_argument("--run", required=True)
    b.add_argument("--plan", required=True)
    b.add_argument("--batch", required=True)
    args = ap.parse_args()
    (control if args.cmd == "control" else batch)(args)


if __name__ == "__main__":
    main()
