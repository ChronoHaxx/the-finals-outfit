"""Read-only (26 Nov 2026): which proof 3' passes depended on the position tie-break.

Proof 3' pairs vertices by sorting on UV0 and then on the (class-scaled) position. Where every UV0 in a primitive is
distinct, the position never decides a pair. Where several vertices share one exact UV0 but sit at different positions
(mirrored islands: left and right halves mapped to the same texels), the position decided which Medium vertex each
class vertex was paired with. Each pair was still re-verified strictly afterwards, so this lists the rows the coordinator
asked to see, not suspect rows.

  python -I tiebreak.py REPORT_JSON MODELS_DIR OUT_TSV [STAGED_GLB_DIR ...]

For every pass in report.json "proof3Prime": the class GLB is report "meshes"[target]["file"] (models-relative), or, for
a pass the build did not add, the one copy in the staged folders given. The Medium it was proven against is the staged
sibling in the same folder (_L/_H -> _M). Writes one row per pass: the duplicate-UV0 vertex counts on each side and
whether the tie-break decided a pair.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve()
BUILDER = HERE.parents[3] / "scripts" / "archetypes" / "build-archetype-index.py"
spec = importlib.util.spec_from_file_location("builder", BUILDER)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def position_ties(prim):
    """Vertices that share an exact UV0 with another vertex at a different position."""
    uv, pos = prim["uvs"][0], prim["pos"]
    _, inverse, counts = np.unique(uv, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    tied = 0
    for group in np.flatnonzero(counts > 1):
        members = np.flatnonzero(inverse == group)
        if len(np.unique(pos[members], axis=0)) > 1:
            tied += len(members)
    return tied


def main(report_path, models, out, staged):
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    models = Path(models)
    rows = []
    for target, row in sorted(report.get("proof3Prime", {}).items()):
        if row.get("verdict") != "pass":
            continue
        short = target.rsplit(".", 1)[-1]
        if target in report["meshes"]:
            cls_file = models / report["meshes"][target]["file"]
        else:  # passed proof 3' but not added (currency or class): look in the staged folders given
            found = [d / f"{short}.glb" for d in staged if (d / f"{short}.glb").exists()]
            if len(found) != 1:
                sys.exit(f"{short}: {len(found)} staged copies in {[str(d) for d in staged]}")
            cls_file = found[0]
        stem = cls_file.stem
        med_file = cls_file.with_name(stem[:-2] + "_M" + cls_file.suffix)
        if not med_file.exists():
            sys.exit(f"no staged Medium beside {cls_file}")
        med, cls = b.mesh_data(med_file), b.mesh_data(cls_file)
        tm = sum(position_ties(p) for p in med["prims"])
        tc = sum(position_ties(p) for p in cls["prims"])
        verts = sum(len(p["pos"]) for p in cls["prims"])
        added = target in report.get("added", {}).get(row["class"], [])  # Heavy passes join only with a Heavy body
        rows.append((stem, row["class"], "yes" if added else "no", verts, tm, tc,
                     "yes" if (tm or tc) else "no", row.get("permutationSha256", "")))
    header = ("mesh", "class", "added", "vertices", "mediumTiedVertices", "classTiedVertices", "positionDecided",
              "permutationSha256")
    Path(out).write_text("\t".join(header) + "\n" + "".join("\t".join(map(str, r)) + "\n" for r in rows),
                         encoding="utf-8")
    decided = [r for r in rows if r[6] == "yes"]
    for cls in sorted({r[1] for r in rows}):
        mine = [r for r in rows if r[1] == cls]
        print(f"{cls}: {len(mine)} proof 3' passes ({sum(r[2] == 'yes' for r in mine)} added); "
              f"{sum(r[6] == 'yes' for r in mine)} decided by the position tie-break "
              f"({sum(r[6] == 'yes' and r[2] == 'yes' for r in mine)} of them added)")
    for r in decided:
        print(f"  {r[0]} (added: {r[2]}): {r[4]} Medium / {r[5]} class vertices in position-decided UV0 ties")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], [Path(d) for d in sys.argv[4:]])
