"""Stage the 20-choice Military Tactical Gloves family (Medium) with the Large Sneakers orchestration.

prepare-large-sneakers.py supplies the stages (fresh exact mesh extraction, planner, effective slots,
fresh material/parent/texture extraction, compile, independent CPU/GPU checks, surface audit, additive
preview, derived A/idle coverage); this file only re-points its paths at this batch. The tactical-glove
mesh has no earlier staged conversion, so unlike prepare-hoodies.py the shared fresh s.mesh() is used
instead of the reuse branch. The active index, catalogs and earlier folders are only read. Run from the
repository root with C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-tactical-gloves.py mesh      # fresh exact mesh export, GLB, attribute check
  node --import tsx _docs/tactical-gloves-2026-09-13/freeze.mjs    # definitions/slots -> resolved-cohort.json
  python scripts/shader-probe/prepare-tactical-gloves.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-tactical-gloves.py build     # compile, independent CPU check, surface audit
  python scripts/shader-probe/prepare-tactical-gloves.py gpu       # fresh uniquely named check-webgl run
  python scripts/shader-probe/prepare-tactical-gloves.py index     # runtime staging, additive preview (no body mask)
  python scripts/shader-probe/prepare-tactical-gloves.py coverage  # derived A/idle body coverage, then index again
"""
import argparse
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('prepare_large_sneakers', HERE / 'prepare-large-sneakers.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
d = s.d

DOCS = Path('_docs/tactical-gloves-2026-09-13')
WORK = Path('scripts/generated/shader-probe/tactical-gloves-v1')
RUNTIME = Path('public/models/reconstructed-tactical-gloves-v1')
PREVIEW = Path('public/models/reconstructed-tactical-gloves-preview-v1')
MESH_REPORT = DOCS / 'mesh-report.json'
SOURCE_MESH = ('/Game/Discovery/Characters/Military/Assets/TacticalGloves/SK_Military_TacticalGloves_M.'
               'SK_Military_TacticalGloves_M')
MATERIAL_SLOT = 'TacticalGloves'
MARKER = 'shader-probe/prepare-tactical-gloves'

# Importing the sneaker stages configured them for that batch; every path they read is re-pointed here.
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
# This batch has no earlier extraction of the same build to trust; source/parents/textures are fresh.
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = MARKER
s.DOCS, s.WORK, s.RUNTIME, s.PREVIEW, s.MESH_REPORT = DOCS, WORK, RUNTIME, PREVIEW, MESH_REPORT


def progress(milestone, **fields):
    """Batch-local milestone log; keep this family's progress in its own file."""
    path = WORK / 'progress.json'
    doc = d.read_json(path) if path.is_file() else {}
    history = doc.get('history', [])
    history.append({'at': d.now(), 'milestone': milestone, **fields})
    d.write(path, {**doc, 'at': d.now(), 'milestone': milestone, **fields, 'history': history})


# prepare-large-sneakers.py resolves `progress` in its own globals, so this replaces its stage writer.
s.progress = progress

_surface_blocked = s.audit_blocked


def geometry_blocked():
    """A shader passing fixtures must still be compatible with the actual source mesh."""
    blocked = _surface_blocked()
    available = set(range(_require_current_mesh()['uvSets']))
    records = []
    for job in d.read_json(WORK / 'validation' / 'passed.requests.json'):
        manifest = d.read_json(RUNTIME / 'staging' / (job['id'] + '.json'))
        required = manifest.get('requiredUvSets', [0, 1])
        missing = sorted(set(required) - available)
        reasons = [f'Source mesh lacks original UV sets {missing}; shader requires {required}'] if missing else []
        if reasons:
            blocked.setdefault(job['id'], []).extend(reasons)
        records.append({'itemId': job['id'], 'availableUvSets': sorted(available),
                        'requiredUvSets': required, 'blockers': reasons})
    d.write(WORK / 'geometry-contracts.json', records)
    return blocked


s.audit_blocked = geometry_blocked


def _object_path(value):
    return d.assembly_index.object_path(value) if isinstance(value, str) and value else value


def _is_source_mesh(value):
    """Accept either the exact object path or a package path that resolves to it."""
    if not isinstance(value, str) or not value:
        return False
    return value == SOURCE_MESH or _object_path(value) == SOURCE_MESH


def _require_current_mesh():
    """Downstream stages only proceed on a mesh report whose recorded GLB and DTO hashes are current."""
    if not MESH_REPORT.is_file():
        raise SystemExit('Run the mesh stage first: mesh-report.json is missing')
    report = d.read_json(MESH_REPORT)
    if d.file_sha(report['glb']) != report['sha256'] or d.file_sha(report['meshJson']) != report['sourceDtoSha256']:
        raise SystemExit('The mesh report no longer matches its GLB/DTO; preserve evidence and inspect the drift')
    records = d.read_json(d.SOURCE / 'meshes-01' / 'assets.json')
    if len(records) != 1 or records[0].get('error'):
        raise SystemExit('Expected one successful mesh export')
    record, = records
    types = [export.get('type') for export in record.get('exports', [])]
    if types.count('SkeletalMesh') != 1 or 'StaticMesh' in types:
        raise SystemExit('Expected exactly one SkeletalMesh export')
    if not _is_source_mesh(record.get('path')) or not _is_source_mesh(report.get('source')):
        raise SystemExit('Missing or different mesh source identity')
    if record.get('sha256') != report.get('sourcePackageSha256'):
        raise SystemExit('Mesh package hash differs from the converted report')
    expected = d.SOURCE / 'meshes-01' / record['meshFile']
    if Path(report['meshJson']).resolve() != expected.resolve():
        raise SystemExit('Report refers to a different exported DTO')
    if not _is_source_mesh(d.read_json(expected).get('source')):
        raise SystemExit('DTO source identity differs from the requested mesh')
    return report


def _require_source_build():
    """Recheck the mesh/material build pairing at every downstream stage, not just at extraction."""
    _require_current_mesh()
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(d.SOURCE / 'meshes-01') != working:
        raise SystemExit('Mesh and material sources come from different game builds')


def mesh():
    """Fresh exact extraction through the shared stage; the one record and DTO must be this skeletal mesh."""
    cohort = d.read_json(DOCS / 'cohort.json')
    if cohort.get('meshes') != [SOURCE_MESH]:
        raise SystemExit('The frozen cohort must name exactly the one tactical-glove skeletal mesh')
    # Shared fresh extraction plus build; it refuses to overwrite an already preserved conversion.
    s.mesh()
    report = d.read_json(MESH_REPORT)
    if not _is_source_mesh(report.get('source')):
        raise SystemExit('The mesh report source identity is not the requested skeletal mesh')
    records = d.read_json(d.SOURCE / 'meshes-01' / 'assets.json')
    if len(records) != 1 or records[0].get('error'):
        raise SystemExit('Expected exactly one converted mesh record')
    record, = records
    if not _is_source_mesh(record.get('path')):
        raise SystemExit('The exported record is not the requested tactical-glove skeletal mesh')
    slots = d.dto_slots(d.SOURCE / 'meshes-01', record)
    if [slot['slot'] for slot in slots] != [MATERIAL_SLOT]:
        raise SystemExit(f'The exported mesh must carry exactly the {MATERIAL_SLOT} material slot')
    dto = d.read_json(d.SOURCE / 'meshes-01' / record['meshFile'])
    # A DTO that carries an explicit source path must name this mesh; other identity fields are hashes.
    for key in ('source', 'objectPath'):
        parsed = dto.get(key)
        if isinstance(parsed, str) and parsed.startswith(('/Game/', 'Discovery/Content/')) and not _is_source_mesh(parsed):
            raise SystemExit(f'The exported DTO {key} names a different mesh')
    if not report.get('bones'):
        raise SystemExit('The exported mesh has no rest bones; expected a SkeletalMesh')
    _require_current_mesh()
    print(f'Mesh: {SOURCE_MESH} -> {report["file"]} (slot {MATERIAL_SLOT})', flush=True)


def source():
    """Fresh material/parent/texture extraction must come from the same game build as the mesh export."""
    _require_current_mesh()
    d.stage_source(argparse.Namespace(fresh_sources=True))
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(d.SOURCE / 'meshes-01') != working:
        raise SystemExit('Fresh material extraction comes from a different build than the mesh extraction')
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    roots = {}
    for row in resolution:
        roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
    progress('source', source={'materials': len(resolution),
                               'errors': [r['instance'] for r in resolution if r.get('error')],
                               'roots': {k: len(v) for k, v in roots.items()}, 'meshBuildIdentityMatches': True})
    print(f'Source: {len(resolution)} materials; mesh build identity matches', flush=True)


def gpu():
    _require_source_build()
    d.stage_gpu(argparse.Namespace())
    run = d.read_json(WORK / 'validation' / 'webgl-run.json')
    progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['mesh', 'source', 'build', 'gpu', 'index', 'coverage']); args = p.parse_args()
    if args.stage == 'mesh': mesh()
    elif args.stage == 'source': source()
    elif args.stage == 'build':
        _require_source_build(); s.build()
    elif args.stage == 'gpu': gpu()
    elif args.stage == 'index':
        _require_source_build(); s.index()
    else:
        _require_source_build(); s.derive_coverage()
