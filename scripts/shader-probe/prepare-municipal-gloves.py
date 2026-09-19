"""Stage the 10-choice Municipal Gloves family (Medium) with the Large Sneakers orchestration.

prepare-large-sneakers.py supplies the stages (planner, effective slots, fresh material/parent/texture
extraction, compile, independent CPU/GPU checks, surface audit, additive preview, derived A/idle coverage);
this file only re-points its paths and hooks at this batch and rechecks the source mesh, its original UV sets,
skinning and its two named body-type morphs, the frozen cohort with its three full-glove fitting tags (nails and
wrists covered, push inside clothes), active baseline and build pairing around every stage. The municipal-gloves
mesh was already exported and converted into this batch before handoff, so the mesh stage only validates and
reuses that exact conversion (pinned GLB hash) and never converts again. Body coverage is the shared derived
A/idle pipeline, unchanged. The active index, catalogs and earlier folders are only read. Run from the
repository root with C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-municipal-gloves.py mesh      # validate/reuse the exact mesh, GLB, attributes, morphs
  node --import tsx _docs/municipal-gloves-2026-09-16/freeze.mjs    # definitions/slots/tags/baseline -> resolved-cohort.json
  python scripts/shader-probe/prepare-municipal-gloves.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-municipal-gloves.py build     # compile, independent CPU check, surface/UV audit
  python scripts/shader-probe/prepare-municipal-gloves.py gpu       # fresh uniquely named check-webgl run
  python scripts/shader-probe/prepare-municipal-gloves.py index     # runtime staging, additive preview (no body mask)
  python scripts/shader-probe/prepare-municipal-gloves.py coverage  # derived A/idle body coverage, then index again
"""
import argparse
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('prepare_large_sneakers', HERE / 'prepare-large-sneakers.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
d = s.d

DOCS = Path('_docs/municipal-gloves-2026-09-16')
WORK = Path('scripts/generated/shader-probe/municipal-gloves-v1')
RUNTIME = Path('public/models/reconstructed-municipal-gloves-v1')
PREVIEW = Path('public/models/reconstructed-municipal-gloves-preview-v1')
MESH_REPORT = DOCS / 'mesh-report.json'
SOURCE_MESH = '/Game/Discovery/Characters/Municipal/Assets/Gloves/SK_Municipal_Gloves_M.SK_Municipal_Gloves_M'
MATERIAL_SLOT = 'Gloves'
ITEM_SLOT = 'hands'
MARKER = 'shader-probe/prepare-municipal-gloves'
EXPECTED_COUNT = 10
CONTEXT = 'Customization.Archetype.Medium'
# The preserved conversion handed over with this batch; a report naming any other GLB is not reused.
GLB_SHA256 = '052a3728535b550e942265f31db62969c653a0bbef60b0380b302671d8634435'
# The exported Medium mesh as handed over: original morph targets in source order, and the report summary.
# This mesh has only the two body-type morphs (no sleeve-shrink morphs); none is invented or activated here.
MORPH_NAMES = ['medium_male', 'medium_female']
MESH_FACTS = {'vertices': 3104, 'triangles': 5416, 'uvSets': 2, 'bones': 55, 'materialSections': 1}
# Every full-glove definition activates exactly these tags (source order is not significant): these gloves hide
# nail polish and wrist cosmetics through the shared coverage/fitting path.
FITTING_TAGS = ['Customization.HideMesh.NailsCovered', 'Customization.HideMesh.WristsCovered',
                'Customization.Shape.PushInsideClothes.push_gloves']
# Active index before this batch. Its one structurally ready but unadvertised entry (the knight pants)
# must stay ready and unadvertised in the preview. Indexed: catalog choices with an advertised assembly
# or a skin pair, as the source-index loader counts them (not the picker's full touched total).
BASELINE_ADVERTISED, BASELINE_STRUCTURAL = 532, 533
BASELINE_INDEXED, CATALOG_ITEMS = 533, 2866
INDEX_FILES = ('assets.json', 'skin-pairs.json', 'supported-items.json')

# Importing the sneaker stages configured them for that batch; every path and hook they use is set here.
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
# No earlier extraction or mesh evidence is trusted; source/parents/textures are fresh for this batch.
d.REUSE_EXPORTS, d.REUSE_TEXTURES, d.MESH_EVIDENCE = [], [], []
d.MARKER = MARKER
d.extract, d.plan = s.extract, s.plan
s.DOCS, s.WORK, s.RUNTIME, s.PREVIEW, s.MESH_REPORT = DOCS, WORK, RUNTIME, PREVIEW, MESH_REPORT


def progress(milestone, **fields):
    """Batch-local milestone log; keep this family's progress in its own file."""
    path = WORK / 'progress.json'
    doc = d.read_json(path) if path.is_file() else {}
    history = doc.get('history', [])
    history.append({'at': d.now(), 'milestone': milestone, **fields})
    d.write(path, {**doc, 'at': d.now(), 'milestone': milestone, 'marker': MARKER, **fields, 'history': history})


# prepare-large-sneakers.py resolves `progress` in its own globals, so this replaces its stage writer.
s.progress = progress

_surface_blocked = s.audit_blocked


def geometry_blocked():
    """A shader passing fixtures must still be compatible with the actual source mesh."""
    blocked = _surface_blocked()
    available = set(range(_require_mesh_contract()[0]['uvSets']))
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


def _require_configuration():
    """Refuse to run with any shared global or hook still pointing at another batch."""
    stale = [name for name, value in {'BATCH': DOCS / 'batch.json', 'WORK': WORK, 'SOURCE': WORK / 'source',
                                      'RUNTIME': RUNTIME, 'PREVIEW': PREVIEW, 'MARKER': MARKER, 'REUSE_EXPORTS': [],
                                      'REUSE_TEXTURES': [], 'MESH_EVIDENCE': []}.items() if getattr(d, name) != value]
    stale += ['s.' + name for name, value in {'DOCS': DOCS, 'WORK': WORK, 'RUNTIME': RUNTIME, 'PREVIEW': PREVIEW,
                                              'MESH_REPORT': MESH_REPORT}.items() if getattr(s, name) != value]
    if s.progress is not progress or s.audit_blocked is not geometry_blocked or d.extract is not s.extract \
            or d.plan is not s.plan:
        stale.append('stage hooks')
    if stale:
        raise SystemExit(f'Shared stage globals are not configured for this batch: {stale}')


def _object_path(value):
    return d.assembly_index.object_path(value) if isinstance(value, str) and value else value


def _is_source_mesh(value):
    """Accept either the exact object path or a package path that resolves to it."""
    if not isinstance(value, str) or not value:
        return False
    return value == SOURCE_MESH or _object_path(value) == SOURCE_MESH


def _is_fitting_tags(tags):
    """Exactly the full-glove fitting tags in any order; missing, empty, duplicated or other tags are drift."""
    return isinstance(tags, list) and all(isinstance(tag, str) for tag in tags) and sorted(tags) == sorted(FITTING_TAGS)


def _require_cohort():
    cohort = d.read_json(DOCS / 'cohort.json')
    items = cohort.get('items') or []
    ids = [item.get('id') for item in items]
    if cohort.get('meshes') != [SOURCE_MESH] or cohort.get('attached'):
        raise SystemExit('The cohort must name exactly the one unattached municipal-gloves skeletal mesh')
    if len(items) != EXPECTED_COUNT or cohort.get('count') != EXPECTED_COUNT or len(set(ids)) != len(ids):
        raise SystemExit(f'The cohort must name {EXPECTED_COUNT} unique choices')
    if any(item.get('slot') != ITEM_SLOT or len(item.get('materials') or []) != 1 for item in items):
        raise SystemExit(f'Every choice must be in the {ITEM_SLOT} slot with one {MATERIAL_SLOT} material')
    if sorted({m for item in items for m in item['materials']}) != sorted(cohort.get('materials') or []):
        raise SystemExit('The cohort material list differs from its choices')
    return cohort


def _require_mesh_request():
    """The extracted mesh folder is reused only when its request manifest is exactly this mesh package."""
    folder = d.SOURCE / 'meshes-01'
    if not folder.is_dir() or not any(folder.iterdir()):
        return False
    manifest, run = d.SOURCE / 'meshes-01.requests.json', d.SOURCE / 'meshes-01.run.json'
    if not manifest.is_file() or d.read_json(manifest) != [d.package_of(SOURCE_MESH)]:
        raise SystemExit('meshes-01 was not extracted for exactly the municipal-gloves mesh request; use a new folder')
    if not run.is_file() or d.read_json(run).get('exitCode') != 0:
        raise SystemExit('meshes-01 has no successful extraction run record')
    return True


def _glb_document(path):
    data = Path(path).read_bytes()
    size = int.from_bytes(data[12:16], 'little') if len(data) >= 20 else 0
    if data[:4] != b'glTF' or data[16:20] != b'JSON' or not size or 20 + size > len(data):
        raise SystemExit(f'Not a binary glTF with a JSON chunk: {path}')
    return json.loads(data[20:20 + size])


def _dto_morph_names(dto):
    """Morph target names of the exported LOD0, in source order; they must be the handed-over Medium morphs."""
    lods = dto.get('lods') or []
    if not lods or not isinstance(lods[0], dict):
        raise SystemExit('The exported DTO has no LOD0')
    names = [morph.get('name') if isinstance(morph, dict) else None for morph in lods[0].get('morphs') or []]
    if not all(isinstance(name, str) and name for name in names) or len(set(names)) != len(names):
        raise SystemExit(f'The exported DTO morph names are missing or not unique: {names}')
    if names != MORPH_NAMES:
        raise SystemExit(f'The exported DTO morphs {names} are not the original {MORPH_NAMES}')
    return names


def _require_mesh_facts(report):
    """The report summary is the exported Medium mesh: counts, original UV sets, bones and one section."""
    wrong = {}
    for key, expected in MESH_FACTS.items():
        value = report.get(key)
        if key in ('bones', 'materialSections') and isinstance(value, list):
            value = len(value)
        if isinstance(value, bool) or not isinstance(value, int) or value != expected:
            wrong[key] = value
    if wrong:
        raise SystemExit(f'The mesh report {wrong} differs from the exported mesh {MESH_FACTS}')


def _require_glb_geometry(report, dto):
    """Original UV sets, skinning and named morph targets survive conversion exactly: nothing invented or dropped."""
    _require_mesh_facts(report)
    uv_sets = report.get('uvSets')
    if not isinstance(uv_sets, int) or isinstance(uv_sets, bool) or uv_sets < 1:
        raise SystemExit('The mesh report records no original UV sets')
    if not report.get('bones'):
        raise SystemExit('The mesh report has no rest bones; expected a SkeletalMesh')
    names = _dto_morph_names(dto)
    recorded = report.get('morphs')
    if isinstance(recorded, list):
        recorded = [m.get('name') if isinstance(m, dict) else m for m in recorded]
        if recorded != names:
            raise SystemExit(f'The mesh report morphs {recorded} differ from the source DTO morphs {names}')
    elif isinstance(recorded, bool) or not isinstance(recorded, int) or recorded != len(names):
        raise SystemExit(f'The mesh report morph count {recorded!r} differs from the {len(names)} source DTO morphs')
    doc = _glb_document(report['glb'])
    expected = {f'TEXCOORD_{i}' for i in range(uv_sets)}
    meshes = [mesh for mesh in doc.get('meshes', []) if mesh.get('primitives')]
    if not meshes:
        raise SystemExit('The converted GLB has no mesh primitives')
    for mesh in meshes:
        # The viewer addresses morphs by name through the glTF mesh-level extras.targetNames dictionary.
        target_names = (mesh.get('extras') or {}).get('targetNames') or []
        if target_names != names:
            raise SystemExit(f'GLB morph target names {target_names} differ from the source DTO morphs {names}')
        for primitive in mesh['primitives']:
            attributes = set(primitive.get('attributes', {}))
            found = {name for name in attributes if name.startswith('TEXCOORD_')}
            if found != expected:
                raise SystemExit(f'GLB UV channels {sorted(found)} differ from the {uv_sets} original source UV sets')
            if not {'JOINTS_0', 'WEIGHTS_0'} <= attributes:
                raise SystemExit('A converted GLB primitive is not skinned')
            targets = primitive.get('targets') or []
            if len(targets) != len(names) or not all('POSITION' in target for target in targets):
                raise SystemExit(f'A converted GLB primitive has {len(targets)} position morph targets; '
                                 f'the source DTO has {len(names)}')
    # Default weights (mesh or node) would apply a body-type morph to every outfit.
    if any(weight != 0 for owner in (*meshes, *doc.get('nodes', [])) for weight in owner.get('weights') or []):
        raise SystemExit('The converted GLB activates morph targets by default; fitting rules must drive them')
    skins = doc.get('skins') or []
    if not skins or not all(skin.get('joints') and 'inverseBindMatrices' in skin for skin in skins):
        raise SystemExit('The converted GLB lacks rest-bone joints and inverse bind matrices')
    return names


def _require_mesh_contract():
    """Hash-current preserved report, exact skeletal source identity/package, one Gloves slot, bones, UVs, morphs."""
    if not MESH_REPORT.is_file():
        raise SystemExit('Run the mesh stage first: mesh-report.json is missing')
    report = d.read_json(MESH_REPORT)
    missing = [key for key in ('glb', 'meshJson', 'file', 'sha256', 'sourceDtoSha256', 'sourcePackageSha256') if not report.get(key)]
    if missing:
        raise SystemExit(f'The mesh report lacks {missing}')
    if d.file_sha(report['glb']) != report['sha256'] or d.file_sha(report['meshJson']) != report['sourceDtoSha256']:
        raise SystemExit('The mesh report no longer matches its GLB/DTO; preserve evidence and inspect the drift')
    if report['sha256'] != GLB_SHA256:
        raise SystemExit('The mesh report GLB hash is not the preserved municipal-gloves conversion; do not reconvert')
    if Path(report['glb']).resolve() != (WORK / 'meshes' / report['file']).resolve():
        raise SystemExit("The mesh report GLB is not this batch's converted mesh")
    if not (report.get('verification') or {}).get('passed'):
        raise SystemExit('The recorded mesh attribute verification did not pass')
    if not _require_mesh_request():
        raise SystemExit('The exact mesh extraction folder is missing')
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
    dto = d.read_json(expected)
    if not _is_source_mesh(dto.get('source')):
        raise SystemExit('DTO source identity differs from the requested mesh')
    # A DTO that carries an explicit object path must name this mesh; other identity fields are hashes.
    parsed = dto.get('objectPath')
    if isinstance(parsed, str) and parsed.startswith(('/Game/', 'Discovery/Content/')) and not _is_source_mesh(parsed):
        raise SystemExit('The exported DTO objectPath names a different mesh')
    slots = d.dto_slots(d.SOURCE / 'meshes-01', record)
    if [slot['slot'] for slot in slots] != [MATERIAL_SLOT]:
        raise SystemExit(f'The exported mesh must carry exactly the {MATERIAL_SLOT} material slot')
    if d.glb_slots(report['glb']) != slots:
        raise SystemExit('The converted GLB material slots differ from the source DTO')
    _require_glb_geometry(report, dto)
    return report, slots


def _require_frozen_cohort(report, slots):
    """freeze.mjs evidence still describes this cohort, this mesh report, Medium, the fitting tags and the definitions."""
    cohort = _require_cohort()
    path, batch_path = DOCS / 'resolved-cohort.json', DOCS / 'batch.json'
    if not path.is_file() or not batch_path.is_file():
        raise SystemExit('Run freeze.mjs first: resolved-cohort.json/batch.json are missing')
    frozen, batch = d.read_json(path), d.read_json(batch_path)
    ids = [item['id'] for item in cohort['items']]
    if batch.get('cohort') != path.as_posix() or batch.get('ids') != ids or [r.get('id') for r in frozen.get('items', [])] != ids:
        raise SystemExit('The frozen batch/cohort ids differ from cohort.json')
    if frozen.get('meshes') != [SOURCE_MESH] or frozen.get('meshReport') != report or frozen.get('sourceSlots') != slots:
        raise SystemExit('The frozen cohort refers to a different mesh report or source slots')
    if frozen.get('context') != CONTEXT:
        raise SystemExit(f'The frozen cohort was not resolved for {CONTEXT}')
    for row, item in zip(frozen['items'], cohort['items']):
        if any(row.get(key) != item[key] for key in ('id', 'name', 'slot', 'materials')):
            raise SystemExit(f'Frozen choice differs from cohort.json: {item["id"]}')
        parts = row.get('effectiveParts') or []
        if len(parts) != 1 or parts[0].get('mesh') != SOURCE_MESH or parts[0].get('slots') != [
                {'slot': MATERIAL_SLOT, 'material': item['materials'][0]}]:
            raise SystemExit(f'Frozen choice is not one {MATERIAL_SLOT} part on the municipal-gloves mesh: {item["id"]}')
        # Both the source definition and the production resolver result carry exactly the full-glove tags.
        properties = (row.get('definition') or {}).get('properties') or {}
        if not _is_fitting_tags(properties.get('ActivatesTags')) or not _is_fitting_tags(row.get('fittingTags')):
            raise SystemExit(f'Frozen choice does not activate exactly {FITTING_TAGS}: {item["id"]}')
        if d.file_sha(d.SOURCE_INDEX / 'items' / (item['id'] + '.json')) != row.get('definitionFileSha256'):
            raise SystemExit(f'Source definition changed since the freeze: {item["id"]}')
    return frozen


def _require_source_build():
    """Recheck the mesh/material build pairing at every downstream stage, not just at extraction."""
    identity = d.build_identity(d.SOURCE / 'meshes-01')
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if identity != working:
        raise SystemExit('Mesh and material sources come from different game builds')
    ready = d.read_json(WORK / 'source-ready.json')
    if ready.get('buildIdentity') != working or ready.get('batch') != (DOCS / 'batch.json').as_posix() \
            or ready.get('marker') != MARKER + '/source':
        raise SystemExit('source-ready.json does not belong to this batch and build')


def _require_downstream():
    _require_configuration()
    report, slots = _require_mesh_contract()
    _require_frozen_cohort(report, slots)
    _require_source_build()
    return report


def _active_hashes():
    """The active index and catalog are read-only for preparation and preview."""
    files = [d.ACTIVE / name for name in INDEX_FILES] + [d.CATALOG]
    return {path.as_posix(): d.file_sha(path) for path in files}


def _indexed(index):
    """Catalog ids and the advertised/indexed choices of one index, as the source-index loader counts them; UI review and body-paint statuses are separate."""
    catalog = {item['id'] for item in d.read_json(d.CATALOG)}
    advertised = set(d.read_json(index / 'supported-items.json')['items'])
    pairs = set(d.read_json(index / 'skin-pairs.json')['items'])
    return catalog, advertised, (advertised | pairs) & catalog


def _require_active_baseline():
    catalog, advertised, indexed = _indexed(d.ACTIVE)
    counts = (len(advertised), len(indexed), len(catalog))
    if counts != (BASELINE_ADVERTISED, BASELINE_INDEXED, CATALOG_ITEMS):
        raise SystemExit(f'The active index is not the stated baseline: advertised/indexed/catalog {counts}, expected '
                         f'{(BASELINE_ADVERTISED, BASELINE_INDEXED, CATALOG_ITEMS)}; inspect before continuing')
    return indexed


def _require_frozen_baseline():
    """Validate this adapter checkpoint before staging; preserve the preflight frozen-baseline.json separately."""
    path = DOCS / 'adapter-baseline.json'
    if not path.is_file():
        raise SystemExit('Run freeze.mjs first: adapter-baseline.json is missing')
    if d.read_json(path).get('hashes') != _active_hashes():
        raise SystemExit('The active index or catalog differs from adapter-baseline.json; inspect before continuing')
    _require_active_baseline()


def mesh():
    """Validate and reuse the preserved conversion; a missing report is restored, never replaced by a new conversion."""
    _require_configuration()
    _require_cohort()
    _require_active_baseline()
    if not MESH_REPORT.is_file():
        raise SystemExit('The preserved mesh report is missing; restore it and its conversion instead of converting again')
    report, slots = _require_mesh_contract()
    verification = d.mesh_verifier.verify(Path(report['meshJson']), Path(report['glb']))
    if not verification.get('passed'):
        raise SystemExit('The preserved GLB attributes no longer verify against the source DTO')
    if (DOCS / 'resolved-cohort.json').exists():
        _require_frozen_cohort(report, slots)
    morphs = _dto_morph_names(d.read_json(Path(report['meshJson'])))
    progress('mesh', mesh={'source': SOURCE_MESH, 'reusedConversion': True, 'glbSha256': report['sha256'],
                           'slots': slots, 'morphNames': morphs,
                           **{k: report.get(k) for k in ('vertices', 'triangles', 'uvSets', 'morphs',
                                                         'bones', 'materialSections')}})
    print(f'Mesh: {SOURCE_MESH} -> {report["file"]} (slot {MATERIAL_SLOT}; morphs {morphs}; '
          'validated preserved conversion)', flush=True)


def source():
    """Fresh material/parent/texture extraction must come from the same game build as the mesh export."""
    _require_configuration()
    report, slots = _require_mesh_contract()
    _require_frozen_cohort(report, slots)
    d.stage_source(argparse.Namespace(fresh_sources=True))
    _require_downstream()
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    roots = {}
    for row in resolution:
        roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
    expected_roots = set(_require_cohort().get('roots') or [])
    progress('source', source={'materials': len(resolution),
                               'errors': [r['instance'] for r in resolution if r.get('error')],
                               'roots': {k: len(v) for k, v in roots.items()},
                               'unexpectedRoots': sorted(set(roots) - expected_roots - {'error'}),
                               'meshBuildIdentityMatches': True})
    print(f'Source: {len(resolution)} materials; roots {sorted(roots)}; mesh build identity matches', flush=True)


def build():
    _require_downstream()
    s.build()
    _require_downstream()
    geometry_blocked()
    uv = {r['itemId']: r['blockers'] for r in d.read_json(WORK / 'geometry-contracts.json') if r['blockers']}
    progress('build-geometry', geometry={'checked': len(d.read_json(WORK / 'geometry-contracts.json')), 'uvBlockers': uv})


def _preserve_gpu_run(path):
    """Keep every GPU result under a unique content-addressed name; never replace differing evidence."""
    run, digest = d.read_json(path), d.file_sha(path)
    stamp = re.sub(r'[^0-9A-Za-z]', '', str(run.get('at', ''))) or 'undated'
    target = WORK / 'validation' / 'gpu-runs' / f'webgl-run-{stamp}-{digest[:16]}.json'
    if target.exists():
        if d.file_sha(target) != digest:
            raise SystemExit(f'Preserve existing GPU evidence: {target}')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    return target


def gpu():
    _require_downstream()
    run_file = WORK / 'validation' / 'webgl-run.json'
    previous = _preserve_gpu_run(run_file) if run_file.is_file() else None
    d.stage_gpu(argparse.Namespace())
    _require_downstream()
    if not run_file.is_file():
        raise SystemExit('The GPU stage recorded no run')
    archived = _preserve_gpu_run(run_file)
    if archived == previous:
        raise SystemExit('The GPU stage did not record a fresh run')
    run = d.read_json(run_file)
    progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')},
             evidence=archived.as_posix())


def _require_baseline(preview):
    """The preview adds only this batch to the stated active baseline and keeps its unadvertised entry as it was."""
    implemented = preview.get('implemented') or []
    unadvertised = preview.get('unadvertisedStructurallyReady')
    if (preview.get('previousAdvertised'), preview.get('previousAssemblies')) != (BASELINE_ADVERTISED, BASELINE_STRUCTURAL) \
            or not isinstance(unadvertised, list) or len(unadvertised) != BASELINE_STRUCTURAL - BASELINE_ADVERTISED:
        raise SystemExit(f'The preview was not built on the {BASELINE_ADVERTISED} advertised / {BASELINE_STRUCTURAL} '
                         'structurally ready active baseline; inspect before continuing')
    if (preview.get('previewAdvertised'), preview.get('previewAssemblies')) != (
            BASELINE_ADVERTISED + len(implemented), BASELINE_STRUCTURAL + len(implemented)):
        raise SystemExit('The preview changed advertising or readiness outside this batch')
    after = WORK / 'resolver' / 'after.json'
    if not after.is_file():
        raise SystemExit('The preview resolver result is missing')
    ready = {row['id'] for row in d.read_json(after)['ready']}
    advertised = set(d.read_json(PREVIEW / 'supported-items.json')['items'])
    if sorted(ready - advertised) != sorted(unadvertised):
        raise SystemExit(f'The previously unadvertised structurally ready entry was not preserved: {unadvertised}')
    indexed = _require_active_baseline()
    if _indexed(PREVIEW)[2] != indexed | set(implemented):
        raise SystemExit(f'The preview changed catalog progress outside this batch (baseline {BASELINE_INDEXED} '
                         f'of {CATALOG_ITEMS} indexed)')


def _require_preview():
    cohort = _require_cohort()
    preview = d.read_json(PREVIEW / 'preview.json')
    implemented = set(preview.get('implemented') or [])
    if preview.get('marker') != MARKER or preview.get('activeUnchanged') is not True \
            or not implemented <= {item['id'] for item in cohort['items']}:
        raise SystemExit('The preview is not an additive preview of this cohort')
    by_material = {r['source']: d.job_id(r['instance']) for r in d.read_json(d.SOURCE / 'material-resolution.json')}
    uv_blocked = {r['itemId'] for r in d.read_json(WORK / 'geometry-contracts.json') if r['blockers']}
    leaked = [item['id'] for item in cohort['items'] if item['id'] in implemented
              and any(by_material.get(m) in uv_blocked for m in item['materials'])]
    if leaked:
        raise SystemExit(f'Preview advertises choices whose shader needs absent UV sets: {leaked}')
    _require_baseline(preview)


def index():
    _require_downstream()
    _require_frozen_baseline()
    s.index()
    _require_downstream()
    _require_preview()


def coverage():
    _require_downstream()
    _require_frozen_baseline()
    s.derive_coverage()
    _require_downstream()
    _require_preview()


STAGES = {'mesh': mesh, 'source': source, 'build': build, 'gpu': gpu, 'index': index, 'coverage': coverage}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=list(STAGES)); args = p.parse_args()
    before = _active_hashes()
    STAGES[args.stage]()
    if _active_hashes() != before:
        raise SystemExit('The active index or catalog changed during this stage; inspect before continuing')
