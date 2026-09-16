"""Stage the frozen 35-choice Hoodie family (Medium) with the Large Sneakers orchestration.

prepare-large-sneakers.py supplies the stages (exact effective slots, fresh material/parent/texture
extraction, compile, CPU/GPU checks, surface audit, additive preview, derived A/idle coverage); this file
only re-points its paths at this batch and reuses the already staged, hash-recorded Medium hoodie
conversion instead of extracting the mesh again. The active index, catalogs and earlier folders are only
read. Run from the repository root with C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-hoodies.py mesh      # verify + reuse the staged DTO/GLB, attribute check
  node --import tsx _docs/hoodies-2026-09-13/opus-freeze.mjs  # definitions/slots -> resolved-cohort.json
  python scripts/shader-probe/prepare-hoodies.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-hoodies.py build     # compile, independent CPU check, surface audit
  python scripts/shader-probe/prepare-hoodies.py gpu       # fresh uniquely named check-webgl run (5173)
  python scripts/shader-probe/prepare-hoodies.py index     # runtime staging, additive preview
  python scripts/shader-probe/prepare-hoodies.py coverage  # derived A/idle body coverage (5173), then index again
"""
import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('prepare_large_sneakers', HERE / 'prepare-large-sneakers.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
d = s.d

DOCS = Path('_docs/hoodies-2026-09-13')
WORK = Path('scripts/generated/shader-probe/hoodies-v1')
RUNTIME = Path('public/models/reconstructed-hoodies-v1')
PREVIEW = Path('public/models/reconstructed-hoodies-preview-v1')
MESH_REPORT = DOCS / 'opus-mesh-report.json'
# Importing the sneaker stages configured them for that batch; every path they read is re-pointed here.
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = 'shader-probe/prepare-hoodies'
s.DOCS, s.WORK, s.RUNTIME, s.PREVIEW, s.MESH_REPORT = DOCS, WORK, RUNTIME, PREVIEW, MESH_REPORT

STAGING = Path('scripts/generated/shader-probe/season11-staging-20260912')
STAGED_DTO = STAGING / 'meshes-raw/chunk-015/SK_Streetwear_Hoodie_M.mesh.json'
STAGED_GLB = Path('public/models/season11-staging-20260912/source-glb/SK_Streetwear_Hoodie_M.glb')
REPORT_KEYS = ('source', 'sourceDtoSha256', 'sourceLod', 'coordinateConversion', 'pipelineVersion', 'file', 'sha256',
               'vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'maxInfluences', 'materialSections')


def mesh():
    """Reuse the staged conversion only when every recorded hash, the converter and the package agree."""
    cohort = d.read_json(DOCS / 'cohort.json')
    rows = [r for r in d.read_json(STAGING / 'reports/glb-01.json') if r.get('meshJson') == STAGED_DTO.as_posix()]
    if len(rows) != 1 or rows[0].get('status') != 'converted' or rows[0].get('glb') != STAGED_GLB.as_posix():
        raise ValueError('Expected one converted staging record for the hoodie DTO')
    row = rows[0]
    if d.file_sha(STAGED_DTO) != row['sourceDtoSha256'] or d.file_sha(STAGED_GLB) != row['sha256']:
        raise ValueError('Staged DTO/GLB bytes differ from their recorded hashes; extract fresh instead')
    tools = d.read_json(STAGING / 'tool-hashes.json')
    if tools['buildMeshes']['sha256'].lower() != d.file_sha(HERE / 'build-meshes.py'):
        raise ValueError('build-meshes.py changed since the staged conversion')
    folder = STAGED_DTO.parent
    records = [r for r in d.read_json(folder / 'assets.json') if r.get('meshFile') == STAGED_DTO.name]
    if len(records) != 1 or records[0].get('error') or d.assembly_index.object_path(records[0]['path']) != cohort['meshes'][0]:
        raise ValueError('Staged DTO is not the exact cohort mesh export')
    record = records[0]
    output = WORK / 'meshes' / STAGED_GLB.name
    if output.exists():
        if d.file_sha(output) != row['sha256']: raise ValueError('Preserve changed mesh: ' + str(output))
    else:
        output.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(STAGED_GLB, output)
    verification = d.mesh_verifier.verify(STAGED_DTO, output)
    if not verification.get('passed') or verification['sha256'] != row['sha256']:
        raise ValueError('Reused mesh attributes differ from the source DTO')
    report = {k: row[k] for k in REPORT_KEYS}
    d.write(WORK / 'mesh-verification.json', verification)
    d.write(WORK / 'meshes' / 'meshes.json', [{**report, 'glb': output.as_posix(), 'meshJson': STAGED_DTO.as_posix(),
                                               'sourcePackageSha256': record['sha256']}])
    dto = d.read_json(STAGED_DTO)
    d.write(MESH_REPORT, {**report, 'glb': output.as_posix(), 'meshJson': STAGED_DTO.as_posix(),
                          'sourceDtoSha256': d.file_sha(STAGED_DTO), 'sourcePackageSha256': record['sha256'],
                          'sourceRun': d.read_json(folder / 'source-run.json'), 'dtoKeys': sorted(dto),
                          'sections': dto['lods'][0]['sections'], 'uvSetCount': len(dto['lods'][0]['uvs']),
                          'colourSets': len(dto['lods'][0].get('colours') or []),
                          'reusedFrom': {'glb': STAGED_GLB.as_posix(), 'glbSha256': row['sha256'], 'report': (STAGING / 'reports/glb-01.json').as_posix(),
                                         'buildMeshesSha256': d.file_sha(HERE / 'build-meshes.py'), 'probeRun': 'meshes-raw/chunk-015 exit 0'},
                          'verification': verification})
    print(json.dumps({k: report[k] for k in ('vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'maxInfluences', 'materialSections')}), flush=True)


def source():
    d.stage_source(argparse.Namespace(fresh_sources=True))
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(STAGED_DTO.parent) != working:
        raise SystemExit('The reused mesh DTO comes from a different game build than the fresh material extraction')
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    roots = {}
    for row in resolution: roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
    s.progress('source', source={'materials': len(resolution), 'errors': [r['instance'] for r in resolution if r.get('error')],
                                 'roots': {k: len(v) for k, v in roots.items()}, 'meshBuildIdentityMatches': True})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['mesh', 'source', 'build', 'gpu', 'index', 'coverage']); args = p.parse_args()
    if args.stage == 'mesh': mesh()
    elif args.stage == 'source': source()
    elif args.stage == 'build': s.build()
    elif args.stage == 'gpu':
        d.stage_gpu(argparse.Namespace())
        run = d.read_json(WORK / 'validation' / 'webgl-run.json')
        s.progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')})
    elif args.stage == 'index': s.index()
    else: s.derive_coverage()
