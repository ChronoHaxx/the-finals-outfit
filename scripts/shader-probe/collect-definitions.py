"""Select character DA candidates from the mounted package inventory.

Only the later property decode establishes the class of each candidate. Persistence
and UI metadata packages are excluded; no filename tokens become runtime rules.
"""
import argparse
import json
from pathlib import Path, PurePosixPath

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = json.loads(args.packages.read_text())
    requests = sorted(set(p for p in files if "/Characters/" in p and PurePosixPath(p).name.startswith("DA_")
                          and not PurePosixPath(p).name.startswith(("DA_Persistence_", "DA_MetaData_", "DA_UIMetaData_"))))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(requests, indent=2))
    print(f"{len(requests)} character data-asset candidates")
