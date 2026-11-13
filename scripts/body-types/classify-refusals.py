"""Why did the morph-only proof refuse a mesh? (Season 12 body-type refresh, 6 Nov 2026.)

morph-only-proof.py compares a Season 12 rebuild with the LIVE GLB. A refusal therefore has two possible causes:
- Season 12 reworked the source mesh (new geometry, UVs, bones, weights...); or
- the live GLB is not a plain build of its source: our pipeline changed it after extraction (proxy weight transfer,
  the null-colour default, part-hide UVs...), or it was built with other options.

This script separates them with the source itself. For every refused mesh it rebuilds the PRE-Season-12 source DTO
(a clean pre-patch extraction from scripts/generated/shader-probe/prepatch-source-index-v1) with the same builder, then
runs the proof's own compare() twice:
- S12 source vs pre-S12 source. Morph-only means Season 12 did not rework the mesh; anything else means it did.
- live GLB vs pre-S12 source. Equal means the live GLB is a plain build of that source.

Classes:
- reworked-in-s12: the S12 source differs from the pre-S12 source beyond morph deltas. S12 item refresh route.
- live-derived: the S12 source differs from the pre-S12 source only in morph deltas; the live GLB differs from both
  because of our own processing. The derivation must be re-run on (or its morphs carried onto) the S12 source.
- no-prepatch-source: no clean pre-patch copy is indexed, so the cause is not decided here.

  python -I scripts/body-types/classify-refusals.py PROOF_JSON REBUILT_DIR PREPATCH_INDEX_DIR PREPATCH_GLB_DIR OUT_JSON

PREPATCH_INDEX_DIR holds index-a (Oct 2026 build 7001883b, preferred) and the two September indexes. PREPATCH_GLB_DIR
must be new. Read-only on every input; refuses an existing output.
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
# The root checkout holds public/models and scripts/generated (as serve-preview.mjs: three levels above a worktree).
DATA = next(p for p in (ROOT, (ROOT / '../../..').resolve())
            if (p / 'public/models/reconstructed-assemblies-v1/assets.json').is_file())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


proof = load('morph_only_proof', HERE / 'morph-only-proof.py')
builder = load('build_meshes', ROOT / 'scripts/shader-probe/build-meshes.py')

# Preferred first: the October pre-patch build that most blue items came from, then the two September builds.
INDEXES = ['index-a', 'index-sept-7dd31d46', 'index-sept-c9e49a85']


def package_of(object_path):
    return 'Discovery/Content/' + object_path.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


def prepatch_copies(index_dir, wanted):
    """{package: (index name, mesh.json path)} for the first index holding a clean copy of each wanted package."""
    found = {}
    for name in INDEXES:
        index = json.loads((Path(index_dir) / name / 'index.json').read_text(encoding='utf-8'))
        for package in sorted(wanted - set(found)):
            copies = index['keys'].get(f'assets|{package}')
            if not copies:
                continue
            call = index['calls'][copies[0]['call']]['call']
            mesh = DATA / call['path'] / (package.rsplit('/', 1)[-1].removesuffix('.uasset') + '.mesh.json')
            if mesh.is_file():
                found[package] = (name, mesh)
    return found


def main(proof_json, rebuilt_dir, index_dir, glb_dir, out_json):
    out, glbs = Path(out_json), Path(glb_dir)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    if glbs.exists() and any(glbs.iterdir()):
        raise SystemExit(f'Preserve existing {glbs}')
    rows = json.loads(Path(proof_json).read_text(encoding='utf-8'))
    live_root = DATA / 'public/models/reconstructed-assemblies-v1'
    refused = {name: row for name, row in rows.items() if row.get('status') == 'refused'}
    copies = prepatch_copies(index_dir, {package_of(row['source']) for row in refused.values()})
    report = {}
    for name, row in sorted(refused.items()):
        package = package_of(row['source'])
        entry = {'source': row['source'], 'liveUrl': row['liveUrl'], 'liveProblems': row['problems']}
        if package not in copies:
            report[name] = {**entry, 'class': 'no-prepatch-source'}
            continue
        index_name, mesh_json = copies[package]
        pre_glb = glbs / f'{name}.glb'
        builder.build(mesh_json, pre_glb)
        source_problems, source_morphs = proof.compare(pre_glb, Path(rebuilt_dir) / f'{name}.glb')
        live_problems, _ = proof.compare(live_root / row['liveUrl'], pre_glb)
        report[name] = {**entry, 'class': 'reworked-in-s12' if source_problems else 'live-derived',
                        'prepatch': {'index': index_name, 'meshJson': mesh_json.relative_to(DATA).as_posix()},
                        's12VsPrepatchSource': source_problems, 's12MorphsChangedVsPrepatch': source_morphs,
                        'liveVsPrepatchSource': live_problems}
    out.write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8')
    counts = {}
    for row in report.values():
        counts[row['class']] = counts.get(row['class'], 0) + 1
    print(json.dumps({'refused': len(report), **counts, 'out': str(out)}))


if __name__ == '__main__':
    main(*sys.argv[1:6])
