"""Stage the frozen 43-choice Flag Shirt + Worn Cape family (Medium): two skeletal parts per choice.

prepare-large-sneakers.py supplies the stages (fresh exact extraction, compile, independent CPU/GPU checks,
surface audit, additive preview, derived A/idle coverage) and prepare-tactical-gloves.py the latest guards
(fail-closed mesh identity/type/package/DTO hashes, mesh/material build identity on every downstream stage,
material UV requirements against the ORIGINAL mesh). Those plan/mesh/index/coverage steps assume one mesh;
this batch adapter generalises them to the two exact parts, Shirt (VisualParts[0]) and WornCape
(VisualParts[1]), and requires both parts and every used material slot before a choice is complete. Each
material's UV requirement is checked against the source mesh of the part(s) that actually bind it.

The cape part is bIsWrapDeformed with an _ClothSim deformer mesh. The runtime renders it as its own skinned
mesh on the preserved body skeleton: a static skeletal preview, with no wrap deformer and no cloth
simulation. The deformer mesh is extracted for evidence only and never staged.

The active index, catalogs and earlier folders are only read. Run from the repository root with
C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-flag-shirts.py mesh      # fresh exact export of both meshes, GLBs, attribute checks
  node --import tsx _docs/flag-shirts-2026-09-13/opus-freeze.mjs  # definitions/two effective parts -> resolved-cohort.json
  python scripts/shader-probe/prepare-flag-shirts.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-flag-shirts.py build     # compile, CPU check, source twoSided policy, surface/UV/side guards
  python scripts/shader-probe/prepare-flag-shirts.py policy    # (existing build only) apply the twoSided policy, rerun guards
  python scripts/shader-probe/prepare-flag-shirts.py gpu       # fresh uniquely named check-webgl run (5173)
  python scripts/shader-probe/prepare-flag-shirts.py index     # runtime staging, additive preview (no body masks)
  python scripts/shader-probe/prepare-flag-shirts.py coverage  # derived A/idle coverage for both meshes (5173), then index
"""
import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('prepare_large_sneakers', HERE / 'prepare-large-sneakers.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
d = s.d

DOCS = Path('_docs/flag-shirts-2026-09-13')
WORK = Path('scripts/generated/shader-probe/flag-shirts-v1')
RUNTIME = Path('public/models/reconstructed-flag-shirts-v1')
PREVIEW = Path('public/models/reconstructed-flag-shirts-preview-v1')
MESH_REPORT = DOCS / 'opus-mesh-report.json'
SHIRT = '/Game/Discovery/Characters/StarterSet/Assets/Shirt/SK_Shirt_M.SK_Shirt_M'
CAPE = '/Game/Discovery/Characters/Samurai/Assets/WornCape/SK_Samurai_WornCape_M.SK_Samurai_WornCape_M'
CLOTH_SIM = '/Game/Discovery/Characters/Samurai/Assets/WornCape/SK_Samurai_WornCape_M_ClothSim.SK_Samurai_WornCape_M_ClothSim'
PARTS = [SHIRT, CAPE]  # VisualParts order in every frozen definition
DEFINITIONS_RUN = Path('scripts/generated/shader-probe/catalog-refresh-20260912/opus-definitions-01/source-run.json')
STAGING_REPORT = Path('scripts/generated/shader-probe/season11-staging-20260912/reports/glb-01.json')
MARKER = 'shader-probe/prepare-flag-shirts'

# Importing the sneaker stages configured them for that batch; every path they read is re-pointed here.
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = MARKER
s.DOCS, s.WORK, s.RUNTIME, s.PREVIEW, s.MESH_REPORT = DOCS, WORK, RUNTIME, PREVIEW, MESH_REPORT


# ------------------------------------------------------------------------------------------------ meshes

def _mesh_records():
    records = d.read_json(d.SOURCE / 'meshes-01' / 'assets.json')
    if len(records) != 2 or any(r.get('error') for r in records):
        raise SystemExit('Expected exactly two successful mesh exports')
    by_path = {}
    for record in records:
        types = [e.get('type') for e in record.get('exports', [])]
        if types.count('SkeletalMesh') != 1 or 'StaticMesh' in types:
            raise SystemExit(f'Expected exactly one SkeletalMesh export: {record.get("path")}')
        key = d.assembly_index.object_path(record.get('path') or '')
        if key not in PARTS or key in by_path: raise SystemExit(f'Unexpected or repeated mesh export: {record.get("path")}')
        dto = d.read_json(d.SOURCE / 'meshes-01' / record['meshFile'])
        if d.assembly_index.object_path(dto.get('source') or '') != key: raise SystemExit(f'DTO source identity differs: {key}')
        by_path[key] = record
    return by_path


def _require_current_meshes():
    """Both recorded GLB/DTO/package identities must still be current before any downstream stage."""
    if not MESH_REPORT.is_file(): raise SystemExit('Run the mesh stage first: opus-mesh-report.json is missing')
    report = d.read_json(MESH_REPORT)
    records = _mesh_records()
    if [m['object'] for m in report['meshes']] != PARTS: raise SystemExit('Mesh report does not name the two parts in order')
    for entry in report['meshes']:
        record = records[entry['object']]
        if d.file_sha(entry['glb']) != entry['sha256'] or d.file_sha(entry['meshJson']) != entry['sourceDtoSha256']:
            raise SystemExit(f'Mesh report no longer matches its GLB/DTO: {entry["file"]}')
        if record['sha256'] != entry['sourcePackageSha256']: raise SystemExit(f'Mesh package hash differs: {entry["file"]}')
        if Path(entry['meshJson']).resolve() != (d.SOURCE / 'meshes-01' / record['meshFile']).resolve():
            raise SystemExit(f'Report refers to a different exported DTO: {entry["file"]}')
        if entry['originalUvSets'] != len(d.read_json(Path(entry['meshJson']))['lods'][0]['uvs']):
            raise SystemExit(f'Recorded original UV set count differs from the DTO: {entry["file"]}')
    if d.build_identity(d.SOURCE / 'meshes-01') != d.build_identity(DEFINITIONS_RUN.parent):
        raise SystemExit('Mesh export and the frozen definitions come from different game builds')
    return report


def _require_source_build():
    report = _require_current_meshes()
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(d.SOURCE / 'meshes-01') != working:
        raise SystemExit('Mesh and material sources come from different game builds')
    return report


def _lod_summary(dto):
    lod = dto['lods'][0]
    return {'vertices': len(lod['positions']), 'triangles': len(lod['indices']) // 3, 'uvSets': len(lod['uvs']),
            'colourSets': len(lod.get('colours') or []), 'morphs': [m['name'] for m in lod['morphs']],
            'sections': lod['sections'], 'bones': len(dto.get('bones') or []),
            'maxInfluences': max((len(x) for x in lod['influences']), default=0)}


def _cloth_evidence(cape_dto):
    """The wrap deformer's driver mesh, read for evidence only; it is never converted or staged."""
    folder = d.SOURCE / 'cloth-evidence-01'
    try:
        if not (folder / 'assets.json').is_file(): s.extract('assets', 'cloth-evidence-01', [d.package_of(CLOTH_SIM)])
        record, = d.read_json(folder / 'assets.json')
        if record.get('error') or d.assembly_index.object_path(record['path']) != CLOTH_SIM: raise ValueError('Different or failed export')
        dto = d.read_json(folder / record['meshFile'])
    except (Exception, SystemExit) as error:
        return {'object': CLOTH_SIM, 'error': str(error)}
    cape_bones = [b['name'] for b in cape_dto.get('bones') or []]
    sim_bones = [b['name'] for b in dto.get('bones') or []]
    cape_used = sorted({cape_bones[i['Bone']] for v in cape_dto['lods'][0]['influences'] for i in v if i['Weight'] > 0})
    return {'object': CLOTH_SIM, 'package': record['path'], 'packageSha256': record['sha256'],
            'dtoSha256': d.file_sha(folder / record['meshFile']), 'exports': sorted({e['type'] for e in record['exports']}),
            'lod': {k: v for k, v in _lod_summary(dto).items() if k != 'sections'},
            'slots': [n['MaterialSlotName'] for n in dto.get('sourceMaterials') or []],
            'sameBuildAsMeshes': d.build_identity(folder) == d.build_identity(d.SOURCE / 'meshes-01'),
            'renderCapeWeightedBones': cape_used, 'simBonesAbsentFromRenderCape': sorted(set(sim_bones) - set(cape_bones))}


def mesh():
    cohort = d.read_json(DOCS / 'cohort.json')
    if sorted(cohort.get('meshes', [])) != sorted(PARTS): raise SystemExit('The frozen cohort must name exactly the shirt and cape meshes')
    staged = [r for r in d.read_json(STAGING_REPORT) if Path(r.get('meshJson') or '').name in
              {Path(m).name.split('.')[0] + '.mesh.json' for m in PARTS}]
    if staged: raise SystemExit(f'A staged conversion exists; verify and reuse it instead: {[r["meshJson"] for r in staged]}')
    if not (d.SOURCE / 'meshes-01' / 'assets.json').is_file():
        s.extract('assets', 'meshes-01', [d.package_of(m) for m in PARTS])
    records = _mesh_records()
    entries, meshes = [], []
    for key in PARTS:
        record = records[key]
        source = d.SOURCE / 'meshes-01' / record['meshFile']
        output = WORK / 'meshes' / (source.name.removesuffix('.mesh.json') + '.glb')
        if output.exists():
            # Resume only onto a byte-identical fresh reconversion of the same DTO; never overwrite.
            rebuilt = WORK / 'mesh-rebuilds' / d.file_sha(source)[:16] / output.name
            built = d.meshes_builder.build(source, rebuilt) if not rebuilt.exists() else None
            if built is None or d.file_sha(output) != built['sha256']: raise SystemExit(f'Preserve converted mesh: {output}')
        else:
            built = d.meshes_builder.build(source, output)
        verification = d.mesh_verifier.verify(source, output)
        if not verification.get('passed') or verification['sha256'] != built['sha256']:
            raise SystemExit(f'Converted mesh attributes differ from the source DTO: {key}')
        dto = d.read_json(source)
        slots = d.dto_slots(d.SOURCE / 'meshes-01', record)
        if not built['bones']: raise SystemExit(f'No rest bones; expected a SkeletalMesh: {key}')
        entries.append(built)
        meshes.append({'object': key, **built, 'glb': output.as_posix(), 'meshJson': source.as_posix(),
                       'sourceDtoSha256': d.file_sha(source), 'sourcePackageSha256': record['sha256'],
                       'originalUvSets': len(dto['lods'][0]['uvs']), 'slots': slots, 'lod': _lod_summary(dto),
                       'dtoKeys': sorted(dto), 'verification': verification})
    d.write(WORK / 'mesh-verification.json', [m['verification'] for m in meshes])
    d.write(WORK / 'meshes' / 'meshes.json', entries)
    cape_dto = d.read_json(Path(meshes[1]['meshJson']))
    d.write(MESH_REPORT, {'marker': MARKER + '/mesh', 'at': d.now(), 'meshes': meshes,
                          'buildIdentityMatchesDefinitions': d.build_identity(d.SOURCE / 'meshes-01') == d.build_identity(DEFINITIONS_RUN.parent),
                          'sourceRun': {k: v for k, v in d.read_json(d.SOURCE / 'meshes-01' / 'source-run.json').items() if k != 'sourceContainers'},
                          'stagedReuse': f'none: {STAGING_REPORT.as_posix()} has no converted record for either mesh',
                          'clothSimEvidence': _cloth_evidence(cape_dto)})
    _require_current_meshes()
    s.progress('mesh', meshes=[{k: m[k] for k in ('file', 'vertices', 'triangles', 'uvSets', 'bones', 'maxInfluences', 'materialSections')}
                               | {'slots': [x['slot'] for x in m['slots']], 'morphs': len(m['morphs'])} for m in meshes])
    for m in meshes:
        print(json.dumps({k: m[k] for k in ('file', 'vertices', 'triangles', 'uvSets', 'bones', 'maxInfluences', 'materialSections')}
                         | {'slots': [x['slot'] for x in m['slots']], 'morphs': m['morphs']}), flush=True)


# ------------------------------------------------------------------------------------------------ plan

def plan():
    """Both visible parts, each with its own effective slots; definitions re-checked against the freeze."""
    batch, cohort = d.load_batch()
    report = d.read_json(MESH_REPORT)
    mesh_slots = {m['object']: [x['slot'] for x in m['slots']] for m in report['meshes']}
    rows = []
    for row in cohort:
        definition = d.read_json(d.SOURCE_INDEX / 'items' / (row['id'] + '.json'))
        if definition != row['definition']: raise ValueError('Frozen definition changed: ' + row['id'])
        if row['resolved'].get('materialParameters'): raise ValueError('Unexpected per-item material parameters')
        visible = [p for p in row['resolved']['parts'] if not p['hidden']]
        if len(visible) != 2 or len(row['effectiveParts']) != 2: raise ValueError('Expected two visible parts: ' + row['id'])
        parts = []
        for part, effective in zip(visible, row['effectiveParts']):
            if part['unresolved'] or part['effect'] or part['staticMesh'] or part['sourceIndex'] != effective['sourceIndex'] \
                    or part['skeletalMesh'] != effective['mesh']:
                raise ValueError(f'Incomplete or inconsistent source part: {row["id"]}:{part["sourceIndex"]}')
            if [x['slot'] for x in effective['slots']] != mesh_slots[effective['mesh']]:
                raise ValueError(f'Effective slots differ from the source mesh DTO: {row["id"]}:{part["sourceIndex"]}')
            parts.append({'sourceIndex': part['sourceIndex'], 'mesh': part['skeletalMesh'], 'slots': effective['slots'],
                          'effect': None, 'unresolved': []})
        if [p['mesh'] for p in parts] != PARTS or [p['sourceIndex'] for p in parts] != [0, 1]:
            raise ValueError('Parts are not Shirt[0] and WornCape[1]: ' + row['id'])
        rows.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                     'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                     'parameterBlockers': [], 'parts': parts})
    return batch, rows, []


d.plan = plan


def source():
    _require_current_meshes()
    d.stage_source(argparse.Namespace(fresh_sources=True))
    working = d.read_json(d.SOURCE / 'working-01' / 'working-export.json')['buildIdentity']
    if d.build_identity(d.SOURCE / 'meshes-01') != working:
        raise SystemExit('Fresh material extraction comes from a different build than the mesh extraction')
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    roots = {}
    for row in resolution: roots.setdefault(row.get('root', 'error'), []).append(row['instance'])
    s.progress('source', source={'materials': len(resolution), 'errors': {r['instance']: r['error'] for r in resolution if r.get('error')},
                                 'roots': {k: len(v) for k, v in roots.items()}, 'meshBuildIdentityMatches': True})
    print(json.dumps({'materials': len(resolution), 'roots': {k: len(v) for k, v in roots.items()}}), flush=True)


# ------------------------------------------------------------------------------------------------ build

def _material_uses():
    """job id -> the (source mesh, slot) pairs whose effective binding is that material, from the frozen resolution."""
    uses = {}
    for row in d.read_json(DOCS / 'resolved-cohort.json')['items']:
        for part in row['effectiveParts']:
            for slot in part['slots']:
                uses.setdefault(d.job_id(d.short(slot['material'])), set()).add((part['mesh'], slot['slot']))
    return uses


def _glb_double_sided(path):
    raw = Path(path).read_bytes(); size = int.from_bytes(raw[12:16], 'little')
    return {m['extras']['sourceSlot']['MaterialSlotName']: bool(m.get('doubleSided')) for m in json.loads(raw[20:20 + size])['materials']}


def _source_two_sided(chain):
    value = chain[0]['Properties'].get('TwoSided', False)
    for material in chain[1:]:
        override = material['Properties'].get('BasePropertyOverrides', {})
        if override.get('bOverride_TwoSided'): value = override['TwoSided']
    return bool(value)


def apply_source_two_sided():
    """Record each 8Layers manifest's exact source-chain TwoSided in its twoSided field.

    build-materials.py writes twoSided only for attachment and face/hair manifests, so the runtime would draw
    the TwoSided WornCape instances with the GLB's single-sided material and cull the open WornCape_Cloth
    sheet's back faces. This batch-local step writes the field exactly as the proposed one-line builder
    prerequisite does (_docs/flag-shirts-2026-09-13/opus-prerequisite-twosided.diff), byte for byte; shaders,
    textures and fixtures are untouched. A manifest that already carries the field must equal the source.
    """
    from material_inputs import parent_chain
    staging = RUNTIME / 'staging'
    policy_file = WORK / 'two-sided-policy.json'
    previous = {r['itemId']: r for r in d.read_json(policy_file)['materials']} if policy_file.is_file() else {}
    records = []
    for row in d.read_json(staging / 'build-report.json'):
        path = staging / (row['itemId'] + '.json')
        before = d.file_sha(path)
        manifest = json.loads(path.read_text(encoding='utf8'))
        if manifest['sourceRoot'] != 'M_Character_8Layers_Master': raise SystemExit(f'Unexpected root for the twoSided policy: {path}')
        source = _source_two_sided(parent_chain(d.SOURCE / 'working-01', manifest['sourceInstance']))
        record = {'itemId': row['itemId'], 'sourceTwoSided': source}
        if 'twoSided' in manifest:
            if manifest['twoSided'] is not source: raise SystemExit(f'Manifest twoSided differs from the source chain: {path}')
            # Keep the amendment's provenance when this step added the field in an earlier run.
            earlier = previous.get(row['itemId'], {})
            if earlier.get('manifestSha256') == before and 'unamendedSha256' in earlier: record['unamendedSha256'] = earlier['unamendedSha256']
        else:
            manifest['twoSided'] = source
            path.write_text(json.dumps(manifest, indent=2), encoding='utf8')
            record['unamendedSha256'] = before
        records.append({**record, 'manifestSha256': d.file_sha(path)})
    document = {'marker': MARKER + '/two-sided',
        'rule': 'manifest.twoSided = effective TwoSided of the exact exported chain (root property, then each bOverride_TwoSided)',
        'pendingPrerequisite': 'build-materials.py: emit twoSided for M_Character_8Layers_Master manifests (kind or geometry)',
        'counts': {'true': sum(r['sourceTwoSided'] for r in records), 'false': sum(not r['sourceTwoSided'] for r in records),
                   'amendedByThisStep': sum('unamendedSha256' in r for r in records)},
        'materials': records}
    if not policy_file.is_file() or {k: v for k, v in d.read_json(policy_file).items() if k != 'at'} != document:
        d.write(policy_file, {**document, 'at': d.now()})
    return records


def geometry_blocked():
    """A shader passing fixtures must also be compatible with the ORIGINAL mesh of every part that binds it:
    its UV sets, and the face culling the runtime will apply. ReconstructedMaterial.ts renders a manifest's
    twoSided when present, otherwise the GLB material's side; either must equal the source chain's TwoSided."""
    from material_inputs import parent_chain
    blocked = s_audit_blocked()
    report = _require_current_meshes()
    available = {m['object']: set(range(m['originalUvSets'])) for m in report['meshes']}
    sides = {m['object']: _glb_double_sided(m['glb']) for m in report['meshes']}
    uses = _material_uses()
    records = []
    for job in d.read_json(WORK / 'validation' / 'passed.requests.json'):
        manifest = d.read_json(RUNTIME / 'staging' / (job['id'] + '.json'))
        required = manifest.get('requiredUvSets', [0, 1])
        reasons, bound = [], sorted(uses.get(job['id'], ()))
        meshes = sorted({key for key, _ in bound})
        if not meshes: reasons.append('No frozen part binds this material')
        for key in meshes:
            missing = sorted(set(required) - available[key])
            if missing: reasons.append(f'{key.split(".")[-1]} lacks original UV sets {missing}; shader requires {required}')
        source_two_sided = _source_two_sided(parent_chain(d.SOURCE / 'working-01', job['instance']))
        rendered = {f'{key.split(".")[-1]}:{slot}': manifest['twoSided'] if 'twoSided' in manifest else sides[key][slot] for key, slot in bound}
        wrong = sorted(name for name, value in rendered.items() if value != source_two_sided)
        if wrong:
            reasons.append(f'Source material is {"TwoSided" if source_two_sided else "one-sided"} but the runtime would render '
                           f'{wrong} {"single-sided (manifest has no twoSided; GLB material is not doubleSided)" if source_two_sided else "double-sided"}')
        if reasons: blocked.setdefault(job['id'], []).extend(reasons)
        records.append({'itemId': job['id'], 'meshes': [k.split('.')[-1] for k in meshes],
                        'availableUvSets': {k.split('.')[-1]: sorted(available[k]) for k in meshes},
                        'requiredUvSets': required, 'sourceTwoSided': source_two_sided, 'renderedTwoSided': rendered, 'blockers': reasons})
    d.write(WORK / 'geometry-contracts.json', records)
    return blocked


s_audit_blocked = s.audit_blocked
s.audit_blocked = geometry_blocked


def build():
    report = _require_source_build()
    d.ready_source()
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    jobs = [{'id': d.job_id(r['instance']), 'instance': r['instance']} for r in resolution if not r.get('error')]
    d.write(WORK / 'requests.json', jobs)
    d.materials_builder.build(d.SOURCE / 'working-01', d.SOURCE / 'textures-01', RUNTIME / 'staging', jobs, keep_going=True)
    s.cpu.check(d.SOURCE / 'working-01', RUNTIME / 'staging', WORK / 'requests.json')
    for name in ['translation-checks.json', 'translation-fixtures.json', 'translation-errors.json', 'passed.requests.json']:
        dest = WORK / 'validation' / name; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(d.SOURCE / 'working-01' / name, dest)
    audit = s.surface_audit(d.SOURCE / 'working-01', jobs)
    d.write(WORK / 'surface-audit.json', audit)
    for entry in report['meshes']:
        verification = d.mesh_verifier.verify(Path(entry['meshJson']), WORK / 'meshes' / entry['file'])
        if not verification.get('passed') or verification['sha256'] != entry['sha256']: raise SystemExit(f'Mesh verification failed: {entry["file"]}')
    apply_source_two_sided()
    blocked = geometry_blocked()
    errors = d.read_json(RUNTIME / 'staging' / 'build-errors.json')
    unverified = d.read_json(WORK / 'validation' / 'translation-errors.json')
    summary = {'built': len(d.read_json(RUNTIME / 'staging' / 'build-report.json')), 'buildErrors': {e['itemId']: e['error'] for e in errors},
               'cpuPassed': len(d.read_json(WORK / 'validation' / 'passed.requests.json')),
               'cpuErrors': {e['id']: e['error'] for e in unverified},
               'auditBlockers': {k: v for k, v in blocked.items()}}
    s.progress('build', build={**summary, 'auditBlockers': len(blocked)})
    print(json.dumps({**summary, 'buildErrors': len(errors), 'cpuErrors': len(unverified), 'auditBlockers': sorted(blocked)}, indent=1), flush=True)


def policy():
    """Apply the source twoSided policy to an existing build and rerun the contract guards, without recompiling."""
    _require_source_build()
    d.ready_source()
    records = apply_source_two_sided()
    blocked = geometry_blocked()
    s.progress('policy', policy={'twoSided': {'true': sum(r['sourceTwoSided'] for r in records), 'false': sum(not r['sourceTwoSided'] for r in records),
                                              'amended': sum('unamendedSha256' in r for r in records)}, 'guardBlocked': len(blocked)})
    print(json.dumps({'materials': len(records), 'amended': sum('unamendedSha256' in r for r in records),
                      'twoSided': sum(r['sourceTwoSided'] for r in records), 'guardBlocked': sorted(blocked)}), flush=True)


def gpu():
    _require_source_build()
    d.stage_gpu(argparse.Namespace())
    run = d.read_json(WORK / 'validation' / 'webgl-run.json')
    s.progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')})


# ------------------------------------------------------------------------------------------------ index

def _coverage_records(staged):
    """Derived records bound to their own staged source mesh; a mesh the projection found no body under is
    recorded as zero coverage only when this run's log shows it was evaluated."""
    coverage = RUNTIME / 'coverage'
    if not (coverage / 'derived-coverage.json').exists(): return None
    derived = d.read_json(coverage / 'derived-coverage.json')
    if derived.get('geometryMode') != 'source' or Path(derived.get('indexFolder') or '') != PREVIEW:
        raise ValueError('Derived coverage was not projected from this preview index')
    log = (WORK / 'coverage.log').read_text(encoding='utf-8')
    records, evaluated = {}, {}
    for record in derived['records']:
        if record['source'] not in PARTS or record['source'] in records: raise ValueError('Unexpected or repeated coverage record')
        if record['meshSha256'] != staged[record['source']] or d.file_sha(coverage / record['file']) != record['sha256']:
            raise ValueError('Derived coverage does not belong to the staged source mesh: ' + record['source'])
        if record['sourceIndex'] != PARTS.index(record['source']) or [p['pose'] for p in record['poseCounts']] != ['a', 'idle']:
            raise ValueError('Coverage record part index or poses differ: ' + record['source'])
        records[record['source']] = record
    for key in PARTS:
        match = re.search(rf'^COVERAGE {re.escape(key.split(".")[-1])}: (\d+) texels$', log, re.M)
        if not match: raise ValueError('Coverage log does not show this mesh was evaluated: ' + key)
        evaluated[key] = int(match.group(1))
        if (key in records) != (evaluated[key] > 0) or (key in records and records[key]['coveredPixels'] != evaluated[key]):
            raise ValueError('Coverage records and log disagree: ' + key)
    return {'records': records, 'texels': evaluated}


def index():
    _require_source_build()
    d.ready_source()
    helper = d.shared_helpers()
    apply_source_two_sided()
    blocked = geometry_blocked()
    accepted = helper.accepted_ids() - set(blocked)
    cohort = d.read_json(DOCS / 'resolved-cohort.json')
    by_material = {r['source']: d.job_id(r['instance']) for r in d.read_json(d.SOURCE / 'material-resolution.json')}
    implemented = [r['id'] for r in cohort['items']
                   if all(by_material[x['material']] in accepted for p in r['effectiveParts'] for x in p['slots'])]
    needed = {by_material[x['material']] for r in cohort['items'] if r['id'] in implemented for p in r['effectiveParts'] for x in p['slots']}
    if not implemented:
        # Nothing is staged or indexed; publish each choice's exact blockers per part and slot instead.
        dispositions = {}
        for r in cohort['items']:
            reasons = {f'{p["mesh"].split(".")[-1]}:{x["slot"]}': blocked.get(by_material[x['material']]) or
                       ([] if by_material[x['material']] in accepted else ['CPU/GPU check did not pass'])
                       for p in r['effectiveParts'] for x in p['slots']}
            dispositions[r['id']] = {k: v for k, v in reasons.items() if v}
        shapes = {}
        for item_id, reasons in dispositions.items():
            shapes.setdefault(json.dumps({k: [re.sub(r'\[.*?\]', '[..]', m) for m in v] for k, v in reasons.items()}, sort_keys=True), []).append(item_id)
        s.progress('blocked', previewAvailable=False, coverageReady=False, implemented=[],
                   blocker={'summary': f'0 of {len(cohort["items"])} choices have every used material slot compatible',
                            'shapes': [{'count': len(ids), 'reasons': json.loads(k)} for k, ids in shapes.items()]})
        d.write(WORK / 'dispositions.json', dispositions)
        raise SystemExit(f'No fully validated candidate; nothing staged. See {WORK / "dispositions.json"}')
    helper.stage_runtime_meshes(set(PARTS))
    staged = {d.assembly_index.object_path(e['source']): e['sha256'] for e in d.read_json(RUNTIME / 'meshes' / 'meshes.json')}
    helper.stage_runtime_materials(needed)
    coverage = RUNTIME / 'coverage'
    derived = _coverage_records(staged)
    coverage_ready = derived is not None
    addition_file = RUNTIME / 'assets-additions.json'
    d.assembly_index.build([RUNTIME / 'meshes'], [RUNTIME / 'materials'], [d.SOURCE / 'working-01'],
                           d.LEGACY, addition_file, [coverage] if coverage_ready else [], None)
    additions = d.read_json(addition_file)
    for key, entry in additions['meshes'].items():
        # Never fall back to an older legacy mask: only this run's projection for this exact mesh binds.
        if entry.get('coverageSource') != 'derived-projection':
            for field in ('bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource'): entry.pop(field, None)
        if coverage_ready and (key in derived['records']) != ('bodyMaskUrl' in entry):
            raise ValueError('Mask binding differs from the derived coverage record: ' + key)
    d.write(addition_file, additions)
    if set(additions['meshes']) != set(PARTS) or not all(isinstance(v, str) for v in additions['materials'].values()):
        raise ValueError('Additions are not exactly the two staged meshes and URL-string material bindings')
    baseline = WORK / 'active-before'
    active = {}
    frozen = d.read_json(DOCS / 'frozen-baseline.json')['hashes']
    for name in ['assets.json', 'skin-pairs.json', 'supported-items.json']:
        src = d.ACTIVE / name; dest = baseline / name
        if d.file_sha(src) != frozen[src.as_posix()]: raise ValueError('Active index differs from frozen-baseline.json: ' + name)
        if dest.exists() and d.file_sha(dest) != d.file_sha(src): raise ValueError('Active baseline changed: ' + name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists(): shutil.copyfile(src, dest)
        active[name] = d.read_json(src)
    rebase = d.preview_tools.Rebaser(d.ACTIVE, PREVIEW)
    assets = d.preview_tools.rebase_assets(active['assets.json'], rebase)
    pairs = d.preview_tools.rebase_skin_pairs(active['skin-pairs.json'], rebase)
    supported = helper.rebase_supported(active['supported-items.json'], rebase)
    for name, doc in [('assets.json', assets), ('skin-pairs.json', pairs), ('supported-items.json', supported)]:
        if d.preview_tools.resolved_shape(doc, PREVIEW) != d.preview_tools.resolved_shape(active[name], d.ACTIVE): raise ValueError('Rebase changed ' + name)
    added_rebase = d.preview_tools.Rebaser(RUNTIME, PREVIEW)
    added = d.preview_tools.rebase_assets(additions, added_rebase)
    if rebase.missing or added_rebase.missing: raise ValueError('Missing indexed dependency')
    for field in ('meshes', 'materials'):
        if set(added[field]) & set(assets[field]): raise ValueError('Would replace existing ' + field)
        assets[field].update(added[field])
    helper.guard_preview()
    d.write(PREVIEW / 'assets.json', assets); d.write(PREVIEW / 'skin-pairs.json', pairs)
    before = helper.resolve_items(d.ACTIVE / 'assets.json', WORK / 'resolver' / 'before.json')
    after = helper.resolve_items(PREVIEW / 'assets.json', WORK / 'resolver' / 'after.json')
    old = {r['id']: r for r in before['ready']}; new = {r['id']: r for r in after['ready']}
    if set(new) - set(old) != set(implemented) or set(old) - set(new): raise ValueError('Readiness changed outside validated candidates')
    for item_id, row in old.items():
        if d.preview_tools.resolved_shape(row, d.ACTIVE) != d.preview_tools.resolved_shape(new[item_id], PREVIEW): raise ValueError('Existing assembly changed: ' + item_id)
    for item_id in implemented:
        frozen_row = next(r for r in cohort['items'] if r['id'] == item_id)
        parts = new[item_id]['parts']
        expected = [(p['sourceIndex'], p['mesh'], {x['slot']: x['material'] for x in p['slots']}) for p in frozen_row['effectiveParts']]
        if [(p['sourceIndex'], p['sourceMesh'], {k: v['source'] for k, v in p['materials'].items()}) for p in parts] != expected:
            raise ValueError('Resolved runtime parts differ from the frozen two-part resolution: ' + item_id)
    advertised = set(supported['items'])
    if advertised & set(implemented): raise ValueError('Candidate already advertised')
    supported['items'].extend(implemented)
    supported['ready'].extend(new[i] for i in implemented)
    supported['exceptions'] = [r for r in supported['exceptions'] if r['id'] not in implemented]
    d.write(PREVIEW / 'supported-items.json', supported)
    missing = [r for r in helper.references(assets, pairs, supported) if not (PREVIEW / r).resolve().is_file()]
    if missing: raise ValueError('Missing preview dependency: ' + str(missing[:5]))
    unadvertised_ready = sorted(set(old) - advertised)
    coverage_summary = None if not coverage_ready else {
        **{k.split('.')[-1]: {'texels': derived['texels'][k], 'mask': k in derived['records']} for k in PARTS}, 'tool': coverage_tool()[1]}
    d.write(PREVIEW / 'preview.json', {'marker': MARKER, 'at': d.now(), 'implemented': implemented,
             'coverageReady': coverage_ready, 'coverage': coverage_summary,
             'previousAdvertised': len(advertised), 'previewAdvertised': len(supported['items']),
             'previousAssemblies': len(old), 'previewAssemblies': len(new), 'unadvertisedStructurallyReady': unadvertised_ready,
             'limitations': ['WornCape is rendered as a static skinned mesh on the preserved body skeleton: no wrap deformer, no cloth simulation'],
             'activeUnchanged': True, 'visualAcceptance': 'pending', 'humanAcceptance': 'pending'})
    d.write(WORK / 'supported-items-additions.json', {'items': implemented, 'ready': [new[i] for i in implemented]})
    d.write(WORK / 'assets-additions.json', {field: added[field] for field in ('meshes', 'materials')})
    s.progress('preview-coverage' if coverage_ready else 'preview-structural', previewAvailable=True,
               preview=PREVIEW.as_posix(), previewUrlBase='/' + PREVIEW.relative_to('public').as_posix(),
               implemented=implemented, deferred=sorted(r['id'] for r in cohort['items'] if r['id'] not in implemented),
               coverageReady=coverage_ready, coverage=coverage_summary,
               counts={'advertisedBefore': len(advertised), 'advertisedPreview': len(supported['items']),
                       'structuralBefore': len(old), 'structuralPreview': len(new)},
               unadvertisedStructurallyReady=unadvertised_ready)
    print(f'Preview advertised {len(advertised)} -> {len(supported["items"])}; structural {len(old)} -> {len(new)}; '
          f'coverage ready: {coverage_ready} {coverage_summary}; unadvertised ready: {unadvertised_ready}', flush=True)


SHARED_MASKS = Path('scripts/shader-probe/build-companion-masks.mjs')
SHARED_MASKS_UNPATCHED = '8904ff666aa9038ea2b3bf2b718bfecc2f1d9c6f91b53c9d54f4e5ffb4b5d52a'
UNION_MASKS = WORK / 'prerequisite-check' / 'build-companion-masks.mjs'


def coverage_tool():
    """The existing helper writes one record per loaded section; the cape's two sections then share one
    mask file name and the second overwrites the first (coverage-helper-collision-01). While the shared helper
    is still that version, use the checked copy that projects a source mesh's sections together: its shirt
    record and mask are byte-identical to the helper's (prerequisite-check/coverage-compare.json)."""
    if d.file_sha(SHARED_MASKS) != SHARED_MASKS_UNPATCHED: return SHARED_MASKS, 'shared helper (changed since this batch; records are still guarded)'
    compare = d.read_json(WORK / 'prerequisite-check' / 'coverage-compare.json')
    if compare['helperSha256'] != SHARED_MASKS_UNPATCHED or compare['patchedSha256'] != d.file_sha(UNION_MASKS) \
            or not compare['shirtMaskBytesIdentical'] or not compare['shirtRecordIdenticalExceptNothing']:
        raise SystemExit('The per-source-mesh coverage copy is not the checked one')
    return UNION_MASKS, 'batch copy of build-companion-masks.mjs with sections of one source mesh projected together (pending prerequisite)'


def derive_coverage():
    _require_source_build()
    preview = d.read_json(PREVIEW / 'preview.json')
    if preview['coverageReady']: raise SystemExit('Coverage already derived; preserve it')
    target = RUNTIME / 'coverage'
    if target.exists() and any(target.iterdir()): raise SystemExit('Preserve existing coverage folder')
    tool, _ = coverage_tool()
    log = WORK / 'coverage.log'
    with log.open('w', encoding='utf-8') as out:
        code = subprocess.call(['node', tool.as_posix(), '--all', '--items', ','.join(preview['implemented']),
                                '--index', PREVIEW.as_posix(), '--output', target.as_posix()], stdout=out, stderr=subprocess.STDOUT)
    if code: raise SystemExit(f'Coverage derivation failed (exit {code}); see {log}')
    index()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['mesh', 'source', 'build', 'policy', 'gpu', 'index', 'coverage']); args = p.parse_args()
    {'mesh': mesh, 'source': source, 'build': build, 'policy': policy, 'gpu': gpu, 'index': index, 'coverage': derive_coverage}[args.stage]()
