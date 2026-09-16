"""Stage the frozen 24-choice Baseball Cap family (Medium): one static mesh on the body head socket.

prepare-large-sneakers.py supplies the material stages (fresh material/parent/texture extraction, compile,
CPU/GPU checks, surface audit, additive preview). This file re-points its paths at this batch, reuses the
already staged, hash-recorded cap conversion, and replaces the skeletal-only planner with one that accepts
exactly the authored static attachment: bIsAttached on the body `head` socket, the original per-part
LocalPosition/Rotation/Scale and the exact BaseballCap slot override. The viewer's resolver builds the
attachment frame from the active attachmentBody; nothing here fits, offsets or masks the cap. No body
coverage is derived or attached: a rigid cap hides no body, and any legacy mask found by the index builder
is stripped. The active index, catalogs and earlier folders are only read. Run from the repository root
with C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-baseball-caps.py mesh      # verify + reuse the staged static DTO/GLB
  node --import tsx _docs/baseball-caps-2026-09-13/opus-freeze.mjs  # definitions/slots/frames -> resolved-cohort.json
  python scripts/shader-probe/prepare-baseball-caps.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-baseball-caps.py build     # compile, independent CPU check, surface audit
  python scripts/shader-probe/prepare-baseball-caps.py gpu       # fresh uniquely named check-webgl run (5173)
  python scripts/shader-probe/prepare-baseball-caps.py index     # runtime staging, additive preview (no coverage)
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

DOCS = Path('_docs/baseball-caps-2026-09-13')
WORK = Path('scripts/generated/shader-probe/baseball-caps-v1')
RUNTIME = Path('public/models/reconstructed-baseball-caps-v1')
PREVIEW = Path('public/models/reconstructed-baseball-caps-preview-v1')
MESH_REPORT = DOCS / 'opus-mesh-report.json'
# Importing the sneaker stages configured them for that batch; every path they read is re-pointed here.
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = 'shader-probe/prepare-baseball-caps'
s.DOCS, s.WORK, s.RUNTIME, s.PREVIEW, s.MESH_REPORT = DOCS, WORK, RUNTIME, PREVIEW, MESH_REPORT

STAGING = Path('scripts/generated/shader-probe/season11-staging-20260912')
STAGED_DTO = STAGING / 'meshes-raw/chunk-014/SM_Streetwear_BaseballCap.mesh.json'
STAGED_GLB = Path('public/models/season11-staging-20260912/source-glb/SM_Streetwear_BaseballCap.glb')
REPORT_KEYS = ('source', 'sourceDtoSha256', 'sourceLod', 'coordinateConversion', 'pipelineVersion', 'file', 'sha256',
               'vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'maxInfluences', 'materialSections')
SOCKET = 'head'


def mesh():
    """Reuse the staged conversion only when every recorded hash, the converter and the package agree."""
    cohort = d.read_json(DOCS / 'cohort.json')
    rows = [r for r in d.read_json(STAGING / 'reports/glb-01.json') if r.get('meshJson') == STAGED_DTO.as_posix()]
    if len(rows) != 1 or rows[0].get('status') != 'converted' or rows[0].get('glb') != STAGED_GLB.as_posix():
        raise ValueError('Expected one converted staging record for the cap DTO')
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
    if [e['type'] for e in record['exports']].count('StaticMesh') != 1:
        raise ValueError('Expected exactly one StaticMesh export')
    if row['bones'] or row['maxInfluences'] or row['morphs']:
        raise ValueError('A static cap mesh must carry no bones, influences or morphs')
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
    lod = dto['lods'][0]
    d.write(MESH_REPORT, {**report, 'glb': output.as_posix(), 'meshJson': STAGED_DTO.as_posix(),
                          'sourceDtoSha256': d.file_sha(STAGED_DTO), 'sourcePackageSha256': record['sha256'],
                          'sourceRun': d.read_json(folder / 'source-run.json'), 'dtoKeys': sorted(dto),
                          'sections': lod['sections'], 'uvSetCount': len(lod['uvs']), 'colourSets': len(lod.get('colours') or []),
                          'dtoBones': len(dto.get('bones') or []), 'dtoLods': len(dto['lods']),
                          'reusedFrom': {'glb': STAGED_GLB.as_posix(), 'glbSha256': row['sha256'], 'report': (STAGING / 'reports/glb-01.json').as_posix(),
                                         'buildMeshesSha256': d.file_sha(HERE / 'build-meshes.py'), 'probeRun': 'meshes-raw/chunk-014 exit 0'},
                          'verification': verification})
    s.progress('mesh', mesh={k: report[k] for k in ('vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'materialSections', 'sha256')})
    print(json.dumps({k: report[k] for k in ('vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'maxInfluences', 'materialSections')}), flush=True)


def plan():
    """Exactly one visible static part on the body head socket, with its authored transform and slot override."""
    batch, cohort = d.load_batch()
    exact, = d.read_json(DOCS / 'cohort.json')['meshes']
    rows = []
    for row in cohort:
        definition = d.read_json(d.SOURCE_INDEX / 'items' / (row['id'] + '.json'))
        if definition != row['definition']: raise ValueError('Frozen definition changed: ' + row['id'])
        if row['resolved'].get('materialParameters') or definition['properties'].get('ActivatesMaterialParameters'):
            raise ValueError('Unexpected material parameter rules: ' + row['id'])
        visible = [p for p in row['resolved']['parts'] if not p['hidden']]
        if len(visible) != 1 or len(row['effectiveParts']) != 1: raise ValueError('Expected one visible part: ' + row['id'])
        part, = visible
        p = part['definition']
        wrap = p.get('WrapDeformation') or {}
        if part['unresolved'] or part['effect'] or part['skeletalMesh'] or part['staticMesh'] != exact:
            raise ValueError('Not the exact static cap part: ' + row['id'])
        if not p.get('bIsAttached') or p.get('bAttachToHeadMesh') or p.get('bIsHeadMesh') or p.get('AttachmentSocket') != SOCKET \
                or (p.get('OptionalAttachmentMesh') or {}).get('AssetPathName') or p.get('LogicModules') \
                or wrap.get('bIsWrapDeformed') or wrap.get('bIsWrapDeformedByHeadComponent') \
                or (wrap.get('OptionalWrapDeformerMesh') or {}).get('AssetPathName'):
            raise ValueError('Not a plain body-socket static attachment: ' + row['id'])
        rows.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                     'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                     'parameterBlockers': [], 'parts': [{'sourceIndex': part['sourceIndex'], 'mesh': part['staticMesh'], 'kind': 'static',
                         'socket': p['AttachmentSocket'], 'localPosition': p['LocalPosition'], 'localRotation': p['LocalRotation'],
                         'localScale': p['LocalScale'], 'slots': row['effectiveParts'][0]['slots'], 'effect': None, 'unresolved': []}]})
    return batch, rows, []
d.plan = plan


def source():
    d.stage_source(argparse.Namespace(fresh_sources=True))
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(STAGED_DTO.parent) != working:
        raise SystemExit('The reused mesh DTO comes from a different game build than the fresh material extraction')
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    roots = {}
    for row in resolution: roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
    s.progress('source', source={'materials': len(resolution), 'errors': {r['instance']: r['error'] for r in resolution if r.get('error')},
                                 'roots': {k: len(v) for k, v in roots.items()}, 'meshBuildIdentityMatches': True})


def index():
    s.index()
    additions = d.read_json(RUNTIME / 'assets-additions.json')
    entry = additions['meshes'][d.read_json(DOCS / 'cohort.json')['meshes'][0]]
    if entry.get('kind') != 'static' or any(k in entry for k in ('bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource')):
        raise ValueError('The cap binding must be a static mesh with no body mask')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['mesh', 'source', 'build', 'gpu', 'index']); args = p.parse_args()
    if args.stage == 'mesh': mesh()
    elif args.stage == 'source': source()
    elif args.stage == 'build': s.build()
    elif args.stage == 'gpu':
        d.stage_gpu(argparse.Namespace())
        run = d.read_json(WORK / 'validation' / 'webgl-run.json')
        s.progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')})
    else: index()
