"""Prepare the ordinary Medium accessory preview (M_CharacterAttachment) from the opus source export.

Run from the repository root with Python 3.10+ (here, the `py` launcher):

  py scripts/shader-probe/prepare-accessories.py build   # classify all 44, compile, CPU-check, convert/verify meshes
  py scripts/shader-probe/prepare-accessories.py gpu     # check-webgl.mjs in headless Edge; needs the dev server
  py scripts/shader-probe/prepare-accessories.py index   # resolve, stage the implemented subset, write the preview
  py scripts/shader-probe/prepare-accessories.py all

Every effective slot material of Astra's 44 candidates, including mesh defaults, is compiled when its root
is M_CharacterAttachment. build-materials accepts only the ordinary surface (CR colour with its multiply,
desaturation and tint overlay, NOH normal and occlusion, roughness, specular, metallic) and rejects live
material opacity, emissive, other blend modes and shading models. The viewer's resolver decides support
over a candidate index; the runtime and preview folders then hold exactly the implemented subset. Astra's
sources, the active index and the catalog are only read; staged folders are verified, never overwritten.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

from material_inputs import material_inputs, parent_chain, read_json
from nail_sampler import effective_nail_sampler
from sm5_slice import Slice
from test_translation import evaluate_nodes, forward

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


materials_builder = load('build-materials')
meshes_builder = load('build-meshes')
mesh_verifier = load('verify-meshes')
assembly_index = load('build-assembly-assets')
stager = load('stage-validated-materials')
preview_tools = load('prepare-coverage-preview')

READY = Path('_docs/accessory-materials-2026-09-11/opus-source-ready.json')
ASTRA_AUDIT = Path('_docs/accessory-materials-2026-09-11/astra-initial-audit.json')
CATALOG = Path('src/data/items.json')
SOURCE_INDEX = Path('public/models/reconstructed-assembly-v2')
ACTIVE = Path('public/models/reconstructed-assemblies-v1')
RUNTIME = Path('public/models/reconstructed-accessories-v1')
PREVIEW = Path('public/models/reconstructed-accessories-preview-v1')
WORK = Path('scripts/generated/shader-probe/accessory-opus-v1')
LEGACY = Path('scripts/asset-sources.generated.json')
ROOT_NAME = 'M_CharacterAttachment'
MARKER = 'shader-probe/prepare-accessories'
OWNED = {'assets.json', 'skin-pairs.json', 'supported-items.json', 'preview.json'}
OUTPUTS = ('normal', 'roughness', 'ao', 'specular', 'baseColor', 'metalness')

# CPU/GPU fixtures: in-tile, mirrored, out-of-tile and negative UVs; NOH and CR take different samples,
# covering centred and off-centre normals, occlusion 0 (the pow guard), partial and 1, and colour/alpha.
UVS = [(0.30, 0.40), (0.62, 0.15), (0.85, 0.90), (-0.20, 0.70), (1.30, -0.25), (0.05, 0.97)]
SAMPLES = [[0.5, 0.5, 1.0, 0.0], [0.37, 0.62, 0.45, 0.5], [0.9, 0.12, 0.0, 1.0]]
MATERIAL_TEXTURES = {'NOH': 0, 'CR': 1}
ENGINE_SAMPLE = [0.5, 0.5, 0.5, 1.0]  # impact target and dissolve textures, dead in the surface


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def file_sha(path):
    return sha(Path(path).read_bytes())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def short(path):
    return (path or '').split('.')[-1]


def source():
    ready = read_json(READY)
    paths = {key: Path(ready[key]) for key in ('exports', 'meshes', 'textures', 'cohort', 'audit', 'materialRequests',
                                               'textureResolution')}
    for name, digest in ready['inputs'].items():
        if file_sha(name) != digest: raise ValueError(f'Source input changed since preparation: {name}')
    return ready, paths


def nonzero(values, neutral):
    return any(v != neutral for v in (values or {}).values())


def placement_blockers(item):
    """Placement features outside this batch, named by their source flag. The resolver rejects them too."""
    reasons = []
    for part in item['resolved']['parts']:
        if part['hidden']: continue
        d, i = part['definition'], part['sourceIndex']
        mesh = short(part['staticMesh'] or part['skeletalMesh'])
        socket = d.get('AttachmentSocket')
        if d.get('bAttachToHeadMesh'):
            reasons.append(f'part {i} {mesh}: head-mesh socket {socket} (bAttachToHeadMesh); head-component sockets and earring jiggle are deferred')
        if d.get('OptionalAttachmentMesh', {}).get('AssetPathName'):
            reasons.append(f'part {i} {mesh}: optional attachment mesh {short(d["OptionalAttachmentMesh"]["AssetPathName"])} '
                           f'on {socket}; the lumbar jiggle attachment is deferred')
        if part['skeletalMesh'] and not d.get('bIsAttached') and (nonzero(d.get('LocalPosition'), 0) or
                nonzero(d.get('LocalRotation'), 0) or nonzero(d.get('LocalScale'), 1)):
            reasons.append(f'part {i} {mesh}: skeletal part with an authored local transform but bIsAttached false '
                           f'(socket {socket}); how the engine places it is unverified')
        if part['unresolved']: reasons.append(f'part {i} {mesh}: unresolved rules {part["unresolved"]}')
        if part['effect']: reasons.append(f'part {i}: effect {short(part["effect"])}')
        if d.get('LogicModules'): reasons.append(f'part {i} {mesh}: logic modules')
    return reasons


def parameter_blockers(item, own_slots):
    rules = item['definition']['properties'].get('ActivatesMaterialParameters') or []
    return [f'activates {short(r["MaterialInstance"]["AssetPathName"])} {r["Behavior"].split("::")[-1]} on {r["SlotNames"]} '
            f'(another item\'s material); the viewer applies only hair overlays to the face, so it would silently disappear'
            for r in rules if not set(r['SlotNames']) <= own_slots]


def effective_overrides(chain):
    properties = chain[0]['Properties']
    result = {k: properties[k] for k in ('BlendMode', 'ShadingModel', 'TwoSided') if k in properties}
    for material in chain[1:]:
        override = material['Properties'].get('BasePropertyOverrides', {})
        for key in ('BlendMode', 'ShadingModel', 'TwoSided'):
            if override.get('bOverride_' + key): result[key] = override[key]
    return {k: v.split('::')[-1] if isinstance(v, str) else v for k, v in result.items()}


def classify(paths):
    """All 44 candidates with source identities, effective slot materials and placement/parameter blockers."""
    cohort, audit = read_json(paths['cohort']), read_json(paths['audit'])
    expected = read_json(ASTRA_AUDIT)['candidateIds']
    if [e['id'] for e in cohort['items']] != expected or [r['id'] for r in audit['items']] != expected:
        raise ValueError('Cohort or audit differs from the 44 recorded candidates')
    catalog = {item['id']: item for item in read_json(CATALOG)}
    resolution = {row['source']: row for row in read_json(paths['textureResolution'])}
    requests = {job['source']: job for job in read_json(paths['materialRequests'])}
    if set(requests) != set(resolution) or set(requests) != {m['source'] for m in audit['materials']}:
        raise ValueError('Material requests, texture resolution and audit name different materials')
    meshes = {preview_tools.object_path(r['path']): r for r in read_json(paths['meshes'] / 'assets.json')}
    rows = []
    for entry, slots in zip(cohort['items'], audit['items']):
        definition = read_json(SOURCE_INDEX / 'items' / f'{entry["id"]}.json')
        if definition != entry['definition'] or definition['sourceSha256'] != entry['definitionSha256'] or \
                catalog[entry['id']]['slot'] != entry['slot']:
            raise ValueError(f'Definition or catalog slot changed: {entry["id"]}')
        parts = []
        for part in slots['parts']:
            record = meshes.get(part['mesh'])
            if not record: raise ValueError(f'Mesh not extracted: {part["mesh"]}')
            parts.append({'sourceIndex': part['sourceIndex'], 'mesh': part['mesh'], 'meshPackageSha256': record['sha256'],
                          'slots': [{'slot': s['slot'], 'source': s['source'], 'default': s['default'],
                                     'root': resolution[s['source']].get('root'), 'owner': resolution[s['source']].get('owner'),
                                     'job': requests[s['source']]['id']} for s in part['slots']]})
        own_slots = {s['slot'] for part in parts for s in part['slots']}
        rows.append({'id': entry['id'], 'name': entry['name'], 'slot': entry['slot'],
                     'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                     'parts': parts, 'placementBlockers': placement_blockers(entry),
                     'parameterBlockers': parameter_blockers(entry, own_slots)})
    return rows, resolution, requests


def material_jobs(exports, resolution, requests):
    """Compile every M_CharacterAttachment slot material; every other one keeps its source reason."""
    jobs, foreign = [], {}
    for source_path, row in sorted(resolution.items()):
        job = requests[source_path]
        if 'error' in row:
            foreign[job['id']] = f'{row["instance"]}: {row["error"]}'
        elif row['root'] != ROOT_NAME:
            overrides = effective_overrides(parent_chain(exports, row['instance']))
            foreign[job['id']] = f'{row["instance"]}: master {row["root"]} ({overrides}), not the attachment surface contract'
        else:
            jobs.append({'id': job['id'], 'instance': job['instance']})
    return jobs, foreign


def texture_info(manifest):
    return {t['slot']: {'width': t['mips'][0]['width'], 'height': t['mips'][0]['height'], 'depth': t['depth'],
                        'mipCount': len(t['mips']), 'array': t['array'], 'cube': t.get('cube', False)}
            for t in manifest['textures']}


def cpu_check(exports, staging, jobs):
    """The forward SM5 reference runs the original assembly; the slice must match every output."""
    built = {row['itemId'] for row in read_json(staging / 'build-report.json')}
    checks, fixtures, errors, passed = [], [], [], []
    for job in jobs:
        if job['id'] not in built: continue
        try:
            (item_id, instance, owner, chain), = material_inputs(exports, [job])
            manifest = read_json(staging / f'{item_id}.json')
            stem = owner + '.SP_PCD3D_SM5'
            bindings = read_json(exports / 'bindings' / (stem + '.basepass-pixel.bindings.json'))
            if bindings['materialBufferIndex'] != 3: raise ValueError('The reference interpreter binds material constants to cb3')
            constants, _ = materials_builder.material_constants(read_json(exports / (stem + '.uniforms.json')), chain)
            assembly_file = exports / 'shaders' / (stem + '.basepass-pixel.dxbc.asm')
            if file_sha(assembly_file) != manifest['assemblySha256']: raise ValueError('Assembly changed since the build')
            assembly = assembly_file.read_text()
            info = texture_info(manifest)
            sliced = Slice(assembly, constants, info, material_buffer=3)
            if sha(sliced.emit()[0]) != manifest['shaderSha256']: raise ValueError('Staged shader differs from a fresh slice')
            by_slot = {b['slot']: b['parameter'] for b in bindings['textureBindings']}
            max_error, cases = 0.0, 0
            for case in range(len(SAMPLES)):
                def texture(slot, coords, dimensions, case=case):
                    if dimensions:
                        d = info.get(slot, {'width': 1, 'height': 1, 'depth': 1, 'mipCount': 1})
                        return [d[key] for key in ('width', 'height', 'depth', 'mipCount')]
                    offset = MATERIAL_TEXTURES.get(by_slot.get(slot))
                    return SAMPLES[(case + offset) % len(SAMPLES)] if offset is not None else ENGINE_SAMPLE
                for u, v in UVS:
                    uv = [u, v, 0.5, 0.5]
                    with np.errstate(all='ignore'):
                        expected, actual = forward(assembly, constants, texture, uv), evaluate_nodes(sliced, texture, uv)
                    if set(expected) != set(OUTPUTS) or set(actual) != set(OUTPUTS):
                        raise AssertionError(f'Surface outputs differ: {sorted(expected)} / {sorted(actual)}')
                    for key in OUTPUTS:
                        if not (np.isfinite(expected[key]).all() and np.isfinite(actual[key]).all()):
                            raise AssertionError(f'{key}: nonfinite result')
                        error = float(np.max(np.abs(expected[key] - actual[key])))
                        if error > 2e-5: raise AssertionError(f'{key} at uv {uv}: {expected[key]} != {actual[key]}')
                        max_error = max(max_error, error)
                    fixtures.append({'itemId': item_id, 'uv': uv, 'viewTangent': None,
                                     'textures': {slot: [texture(slot, None, False)] for slot in by_slot},
                                     'shaderSha256': manifest['shaderSha256'],
                                     'expected': {key: expected[key].tolist() for key in OUTPUTS}})
                    cases += 1
            checks.append({'itemId': item_id, 'material': instance, 'cases': cases, 'maxAbsoluteError': max_error})
            passed.append(job)
        except Exception as error:  # quarantined with its reason, like check-material-batch.py
            errors.append({**job, 'error': str(error)})
    folder = WORK / 'validation'
    for name, value in [('translation-checks.json', checks), ('translation-fixtures.json', fixtures),
                        ('translation-errors.json', errors), ('passed.requests.json', passed)]:
        write(folder / name, value)
    print(f'CPU: {len(passed)} materials passed {sum(c["cases"] for c in checks)} cases; {len(errors)} quarantined')


def build_meshes(paths):
    """Convert every candidate mesh without merging vertices or reducing weights; a rerun must reproduce it."""
    folder = WORK / 'meshes'
    records = read_json(paths['meshes'] / 'assets.json')
    if (folder / 'meshes.json').is_file():
        entries = read_json(folder / 'meshes.json')
        check = WORK / 'mesh-rebuilds'
        for record, entry in zip(records, entries):
            rebuilt = check / file_sha(paths['meshes'] / record['meshFile'])[:16] / entry['file']
            if not rebuilt.exists(): meshes_builder.build(paths['meshes'] / record['meshFile'], rebuilt)
            if file_sha(rebuilt) != entry['sha256'] or file_sha(folder / entry['file']) != entry['sha256']:
                raise ValueError(f'Preserved {entry["file"]} differs from a fresh conversion; use a new folder')
    else:
        if folder.exists() and any(folder.iterdir()): raise ValueError(f'Use an empty mesh folder: {folder}')
        folder.mkdir(parents=True, exist_ok=True)
        write(folder / 'meshes.json', [meshes_builder.build(paths['meshes'] / r['meshFile'],
                                                             folder / (r['meshFile'].removesuffix('.mesh.json') + '.glb'))
                                       for r in records])
    entries = read_json(folder / 'meshes.json')
    report = []
    for record, entry in zip(records, entries):
        if preview_tools.object_path(record['path']) != assembly_index.object_path(entry['source']):
            raise ValueError(f'Mesh order changed: {record["path"]}')
        verification = mesh_verifier.verify(paths['meshes'] / record['meshFile'], folder / entry['file'])
        report.append({**verification, 'source': record['path'], 'sourcePackageSha256': record['sha256'],
                       'sourceDtoSha256': file_sha(paths['meshes'] / record['meshFile']),
                       **{k: entry[k] for k in ('vertices', 'triangles', 'maxInfluences', 'uvSets', 'bones', 'morphs')}})
    write(WORK / 'mesh-verification.json', report)
    print(f'Meshes: {len(entries)} converted and verified ({sum(r["vertices"] for r in report)} vertices)')


def stage_build(args):
    ready, paths = source()
    rows, resolution, requests = classify(paths)
    jobs, foreign = material_jobs(paths['exports'], resolution, requests)
    write(WORK / 'classification.json', rows)
    write(WORK / 'requests.json', jobs)
    write(WORK / 'foreign-materials.json', foreign)
    staging = RUNTIME / 'staging'
    # Unsupported instances are recorded with their reasons and stay out of every later stage.
    materials_builder.build(paths['exports'], paths['textures'], staging, jobs, keep_going=True)
    print(f'Build: {len(read_json(staging / "build-report.json"))} built, '
          f'{len(read_json(staging / "build-errors.json"))} rejected; {len(foreign)} other masters')
    cpu_check(paths['exports'], staging, jobs)
    build_meshes(paths)


def stage_gpu(args):
    """Run the browser check into a fresh destination, then promote only this run's own result.

    A setup failure (no browser, no navigation) must never read as a pass, and must never leave an
    earlier successful report in place to be consumed: every run writes its own file, and the promoted
    report records the fixtures and bytes it came from. The checker also exits nonzero when individual
    materials fail, so that case is accepted only when this run's report names those failures.
    """
    folder = WORK / 'validation'
    fixtures = folder / 'translation-fixtures.json'
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    runs = folder / 'webgl-runs'
    runs.mkdir(parents=True, exist_ok=True)
    suffix = next(s for s in ('', *(f'-{i}' for i in range(1, 1000))) if not (runs / f'{stamp}{s}.json').exists())
    result, log = runs / f'{stamp}{suffix}.json', runs / f'{stamp}{suffix}.log'
    with log.open('w', encoding='utf-8') as out:
        code = subprocess.call(['node', 'scripts/shader-probe/check-webgl.mjs', str(fixtures),
                                '/models/reconstructed-accessories-v1/staging', str(result)],
                               stdout=out, stderr=subprocess.STDOUT)
    if not result.is_file(): raise SystemExit(f'GPU stage produced no result of its own (exit {code}); see {log}')
    rows, expected = read_json(result), read_json(folder / 'translation-checks.json')
    if {row['itemId'] for row in rows} != {row['itemId'] for row in expected}:
        raise SystemExit(f'GPU stage covered {len(rows)} of {len(expected)} CPU-checked materials (exit {code}); see {log}')
    failures = [row for row in rows if row.get('error')]
    if code and not failures:
        raise SystemExit(f'GPU stage failed outside the per-material checks (exit {code}); see {log}')
    write(folder / 'webgl-checks.json', rows)
    write(folder / 'webgl-run.json', {'at': stamp, 'result': result.as_posix(), 'log': log.as_posix(), 'exitCode': code,
                                      'materials': len(rows), 'failed': [row['itemId'] for row in failures],
                                      'fixturesSha256': file_sha(fixtures), 'checksSha256': file_sha(folder / 'webgl-checks.json')})
    print(f'GPU: {len(rows) - len(failures)} materials matched {sum(r["cases"] for r in rows)} cases, '
          f'max error {max((r["maxAbsoluteError"] for r in rows), default=0):.3g}; {len(failures)} failed (exit {code})')


def accepted_ids():
    """The same acceptance stage-validated-materials.py applies: equal nonzero CPU and GPU cases.

    Only a GPU report this preparation promoted, for the fixtures now on disk, is consumed: a stale or
    hand-edited result cannot stand in for a run that never happened.
    """
    folder = WORK / 'validation'
    cpu = {row['itemId']: row for row in read_json(folder / 'translation-checks.json')}
    if not (folder / 'webgl-run.json').is_file(): raise SystemExit('No promoted GPU result; run the gpu stage')
    run = read_json(folder / 'webgl-run.json')
    if file_sha(folder / 'webgl-checks.json') != run['checksSha256'] or \
            file_sha(folder / 'translation-fixtures.json') != run['fixturesSha256']:
        raise SystemExit('The promoted GPU result does not belong to the current fixtures; rerun the gpu stage')
    gpu = {row['itemId']: row for row in read_json(folder / 'webgl-checks.json')}
    if set(gpu) != set(cpu): raise SystemExit('The promoted GPU result does not cover the CPU-checked materials; rerun the gpu stage')
    return {i for i, c in cpu.items() if not gpu[i].get('error') and gpu[i]['cases'] == c['cases'] > 0}


def resolve_items(assets_file, output):
    """The runtime's own resolver over every catalog item, as check-assembly-coverage.mjs reports it."""
    output.parent.mkdir(parents=True, exist_ok=True)
    with (output.parent / (output.stem + '.log')).open('w', encoding='utf-8') as log:
        subprocess.check_call(['node', '--import', 'tsx', 'scripts/shader-probe/check-assembly-coverage.mjs',
                               str(SOURCE_INDEX / 'customization.json'), str(assets_file), str(output)],
                              stdout=log, stderr=subprocess.STDOUT)
    return read_json(output)


def packages(exports):
    return {record['name']: record['path'] for record in read_json(exports / 'probe-summary.json')['results']}


def candidate_support(paths, accepted, jobs_by_id):
    """Which cohort items the viewer's resolver completes when every verified mesh and material is offered."""
    active = read_json(ACTIVE / 'assets.json')
    candidate = copy.deepcopy(active)
    names = packages(paths['exports'])
    for entry in read_json(WORK / 'meshes' / 'meshes.json'):
        key = assembly_index.object_path(entry['source'])
        glb = (WORK / 'meshes' / entry['file']).read_bytes()
        size = int.from_bytes(glb[12:16], 'little')
        slots = [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
                 for m in json.loads(glb[20:20 + size])['materials']]
        if key in active['meshes']: raise ValueError(f'Candidate mesh already bound in the active index: {key}')
        candidate['meshes'][key] = {'url': f'candidate/{entry["file"]}', 'sha256': entry['sha256'], 'slots': slots,
                                    'kind': 'skeletal' if entry['bones'] else 'static'}
    for item_id in sorted(accepted):
        key = preview_tools.object_path(names[jobs_by_id[item_id]['instance']])
        if key in active['materials']: raise ValueError(f'Candidate material already bound in the active index: {key}')
        candidate['materials'][key] = f'candidate/{item_id}.json'
    write(WORK / 'resolver' / 'candidate-assets.json', candidate)
    return resolve_items(WORK / 'resolver' / 'candidate-assets.json', WORK / 'resolver' / 'candidate.json')


def guard_preview():
    literal = PREVIEW.absolute()
    for parent in [literal, *literal.parents]:
        if preview_tools.linked_path(parent): raise ValueError(f'Preview path or ancestor is a link: {parent}')
    if not PREVIEW.exists() or not any(PREVIEW.iterdir()): return
    unowned = sorted(p.name for p in PREVIEW.iterdir() if p.name not in OWNED)
    if unowned: raise ValueError(f'Preview folder holds files this preparer does not write: {unowned}')
    marker = PREVIEW / 'preview.json'
    if not marker.is_file() or read_json(marker).get('marker') != MARKER:
        raise ValueError(f'Preview folder was not written by {MARKER}; use a new folder')


def rebase_supported(document, rebase):
    out = copy.deepcopy(document)
    for entry in out.get('ready', []):
        for part in entry['parts']:
            part['url'] = rebase(part['url'])
            if 'bodyMaskUrl' in part: part['bodyMaskUrl'] = rebase(part['bodyMaskUrl'])
            for binding in part['materials'].values(): binding['url'] = rebase(binding['url'])
            if part.get('attachment'): part['attachment']['bodyUrl'] = rebase(part['attachment']['bodyUrl'])
    return out


def references(assets, pairs, supported):
    urls = [m['url'] for m in assets['meshes'].values()] + [m['bodyMaskUrl'] for m in assets['meshes'].values() if 'bodyMaskUrl' in m]
    urls += list(assets['materials'].values()) + list(assets.get('materialVariants', {}).values())
    if 'attachmentBody' in assets: urls.append(assets['attachmentBody']['url'])
    for pair in pairs['items'].values():
        for side in ('head', 'body'):
            urls.append(pair[side]['url'])
            urls += [b['url'] for b in pair[side]['materials'].values() if b.get('url')]
    for entry in supported['ready']:
        for part in entry['parts']:
            urls += [part['url'], *[b['url'] for b in part['materials'].values()]]
            if 'bodyMaskUrl' in part: urls.append(part['bodyMaskUrl'])
            if part.get('attachment'): urls.append(part['attachment']['bodyUrl'])
    return sorted(set(urls))


def stage_runtime_meshes(needed):
    """Copy exactly the implemented items' verified GLBs; a rerun proves the folder is still that set."""
    folder = RUNTIME / 'meshes'
    entries = [e for e in read_json(WORK / 'meshes' / 'meshes.json') if assembly_index.object_path(e['source']) in needed]
    if len(entries) != len(needed): raise ValueError('An implemented mesh has no verified conversion')
    if (folder / 'meshes.json').is_file():
        if read_json(folder / 'meshes.json') != entries: raise ValueError('Runtime meshes differ from the implemented set')
    else:
        if folder.exists() and any(folder.iterdir()): raise ValueError(f'Use an empty mesh folder: {folder}')
        folder.mkdir(parents=True, exist_ok=True)
        for entry in entries: shutil.copyfile(WORK / 'meshes' / entry['file'], folder / entry['file'])
        write(folder / 'meshes.json', entries)
    for entry in entries:
        if file_sha(folder / entry['file']) != entry['sha256']: raise ValueError(f'Runtime mesh changed: {entry["file"]}')


def stage_runtime_materials(needed_ids):
    """Stage exactly the implemented items' CPU/GPU-validated materials."""
    folder, staged = WORK / 'validation-implemented', RUNTIME / 'materials'
    validation = WORK / 'validation'
    write(folder / 'passed.requests.json', [j for j in read_json(validation / 'passed.requests.json') if j['id'] in needed_ids])
    write(folder / 'translation-checks.json', [r for r in read_json(validation / 'translation-checks.json') if r['itemId'] in needed_ids])
    write(folder / 'webgl-checks.json', [r for r in read_json(validation / 'webgl-checks.json') if r['itemId'] in needed_ids])
    staging = RUNTIME / 'staging'
    if staged.exists() and any(staged.iterdir()):
        reports = read_json(staged / 'build-report.json')
        if {row['itemId'] for row in reports} != needed_ids: raise ValueError('Staged set differs from the implemented materials')
        for row in reports:
            manifest = read_json(staged / f'{row["itemId"]}.json')
            for name in [f'{row["itemId"]}.json', manifest['shader'], *[t['file'] for t in manifest['textures']]]:
                if file_sha(staged / name) != file_sha(staging / name): raise ValueError(f'Staged file differs: {name}')
    else:
        stager.stage(staging, folder, folder / 'webgl-checks.json', staged)
    return read_json(staged / 'build-report.json')


def stage_index(args):
    ready, paths = source()
    rows, resolution, requests = classify(paths)
    if read_json(WORK / 'classification.json') != rows: raise ValueError('Classification changed since the build stage; rerun build')
    jobs = read_json(WORK / 'requests.json')
    jobs_by_id = {job['id']: job for job in jobs}
    accepted = accepted_ids()
    cohort_ids = [row['id'] for row in rows]

    # 1. Readiness: the viewer's resolver over the active index plus every verified candidate mesh and material.
    candidate = candidate_support(paths, accepted, jobs_by_id)
    candidate_ready = {entry['id']: entry for entry in candidate['ready']}
    candidate_exceptions = {entry['id']: entry['reason'] for entry in candidate['exceptions']}
    gated = {row['id']: row['parameterBlockers'] for row in rows if row['parameterBlockers']}
    implemented = [i for i in cohort_ids if i in candidate_ready and i not in gated]
    for row in rows:
        if row['id'] in candidate_ready and row['placementBlockers']:
            raise ValueError(f'The resolver accepted a placement this batch classifies as unsupported: {row["id"]}')
    needed_meshes = {part['sourceMesh'] for i in implemented for part in candidate_ready[i]['parts']}
    needed_sources = {binding['source'] for i in implemented for part in candidate_ready[i]['parts']
                      for binding in part['materials'].values()}
    by_source = {s['source']: s['job'] for row in rows for part in row['parts'] for s in part['slots']}
    needed_ids = {by_source[s] for s in needed_sources}
    if not needed_ids <= accepted: raise ValueError('An implemented item binds an unvalidated material')

    # 2. Runtime folder: exactly the implemented meshes and materials, indexed by exact source paths.
    stage_runtime_meshes(needed_meshes)
    reports = stage_runtime_materials(needed_ids)
    accessories_file = RUNTIME / 'accessories-assets.json'
    assembly_index.build([RUNTIME / 'meshes'], [RUNTIME / 'materials'], [paths['exports']], LEGACY, accessories_file, [], None)
    accessories = read_json(accessories_file)
    if set(accessories['meshes']) != needed_meshes or set(accessories['materials']) != needed_sources or accessories.get('materialVariants') \
            or any('bodyMaskUrl' in m for m in accessories['meshes'].values()):
        raise ValueError('The accessory index must hold exactly the implemented meshes and materials, without masks or variants')

    # 3. Preview: every active binding rebased and preserved, the accessory bindings added.
    guard_preview()
    rebase = preview_tools.Rebaser(ACTIVE, PREVIEW)
    active = {name: read_json(ACTIVE / name) for name in ('assets.json', 'skin-pairs.json', 'supported-items.json')}
    assets = preview_tools.rebase_assets(active['assets.json'], rebase)
    pairs = preview_tools.rebase_skin_pairs(active['skin-pairs.json'], rebase)
    supported = rebase_supported(active['supported-items.json'], rebase)
    if rebase.missing: raise ValueError(f'Active index references missing files: {sorted(set(rebase.missing))}')
    for name, document in (('assets.json', assets), ('skin-pairs.json', pairs), ('supported-items.json', supported)):
        if preview_tools.resolved_shape(active[name], ACTIVE) != preview_tools.resolved_shape(document, PREVIEW):
            raise ValueError(f'Rebased {name} does not resolve to the active files')
        if rebase.unrebased(document): raise ValueError(f'Unrebased references in {name}: {rebase.unrebased(document)}')
    rebase_added = preview_tools.Rebaser(RUNTIME, PREVIEW)
    added = preview_tools.rebase_assets(accessories, rebase_added)
    if rebase_added.missing: raise ValueError(f'Accessory index references missing files: {rebase_added.missing}')
    conflicts = [k for k in added['meshes'] if k in assets['meshes']] + [k for k in added['materials'] if k in assets['materials']]
    if conflicts: raise ValueError(f'Accessory entries would replace active bindings: {conflicts}')
    assets['meshes'] = {**assets['meshes'], **added['meshes']}
    assets['materials'] = dict(sorted({**assets['materials'], **added['materials']}.items()))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    write(PREVIEW / 'assets.json', assets)
    write(PREVIEW / 'skin-pairs.json', pairs)

    # 4. Only the resolver decides support: every other catalog item must resolve exactly as before.
    before = resolve_items(ACTIVE / 'assets.json', WORK / 'resolver' / 'active.json')
    after = resolve_items(PREVIEW / 'assets.json', WORK / 'resolver' / 'preview.json')
    ready_before = {entry['id']: entry for entry in before['ready']}
    ready_after = {entry['id']: entry for entry in after['ready']}
    cohort = set(cohort_ids)
    if sorted(ready_before) != sorted(i for i in ready_after if i not in cohort) or any(i in ready_before for i in cohort):
        raise ValueError('The preview changes which non-cohort items resolve')
    for item_id, entry in ready_before.items():
        if preview_tools.resolved_shape(entry, ACTIVE) != preview_tools.resolved_shape(ready_after[item_id], PREVIEW):
            raise ValueError(f'The preview resolves {item_id} to different files')
    if sorted(i for i in ready_after if i in cohort) != sorted(implemented):
        raise ValueError(f'Preview readiness differs from the implemented set: {sorted(i for i in ready_after if i in cohort)}')
    stored = {entry['id']: entry for entry in supported['ready']}
    stale = sorted(i for i in stored if preview_tools.resolved_shape(stored[i], PREVIEW) !=
                   preview_tools.resolved_shape(ready_after[i], PREVIEW))

    # 5. Blockers for every deferred choice: source placement, material and resolver reasons, all kept.
    build_errors = {row['itemId']: row['error'] for row in read_json(RUNTIME / 'staging' / 'build-errors.json')}
    cpu_errors = {row['id']: row['error'] for row in read_json(WORK / 'validation' / 'translation-errors.json')}
    gpu_rows = {row['itemId']: row for row in read_json(WORK / 'validation' / 'webgl-checks.json')}
    cpu_rows = {row['itemId']: row for row in read_json(WORK / 'validation' / 'translation-checks.json')}
    foreign = read_json(WORK / 'foreign-materials.json')

    def material_status(job_id):
        if job_id in foreign: return f'not compiled: {foreign[job_id]}'
        if job_id in build_errors: return f'translation rejected: {build_errors[job_id]}'
        if job_id in cpu_errors: return f'CPU check quarantined: {cpu_errors[job_id]}'
        if job_id not in accepted: return f'GPU check failed: {gpu_rows.get(job_id, {}).get("error", "no GPU result")}'
        return 'validated'

    exceptions = {entry['id']: entry['reason'] for entry in after['exceptions']}
    report_rows = []
    for row in copy.deepcopy(rows):
        blockers = list(row['placementBlockers'])
        for part in row['parts']:
            for s in part['slots']:
                s['status'] = material_status(s['job'])
                s['packages'] = [{'object': o, 'sha256': file_sha(paths['exports'] / (short(o) + '.uasset'))}
                                 for o in resolution[s['source']].get('chain', [])]
                if s['status'] != 'validated': blockers.append(f'part {part["sourceIndex"]} slot {s["slot"]}: {s["status"]}')
        blockers += row['parameterBlockers']
        status = 'implemented' if row['id'] in implemented else 'deferred'
        if status == 'deferred' and not blockers:
            blockers.append(f'Resolver: {exceptions.get(row["id"]) or candidate_exceptions.get(row["id"])}')
        if status == 'implemented' and blockers: raise ValueError(f'Implemented item carries blockers: {row["id"]} {blockers}')
        entry = {**row, 'status': status, 'blockers': blockers,
                 'resolver': 'ready' if row['id'] in ready_after else exceptions.get(row['id'])}
        if status == 'implemented':
            runtime_parts = []
            for part in ready_after[row['id']]['parts']:
                materials = {}
                for slot, binding in part['materials'].items():
                    job_id = by_source[binding['source']]
                    manifest = read_json(RUNTIME / 'materials' / f'{job_id}.json')
                    (_, _, owner, chain), = material_inputs(paths['exports'], [jobs_by_id[job_id]])
                    raw = (paths['exports'] / 'shaders' / (owner + '.SP_PCD3D_SM5.basepass-pixel.ue-shader.bin')).read_bytes()
                    asm = (paths['exports'] / 'shaders' / (owner + '.SP_PCD3D_SM5.basepass-pixel.dxbc.asm')).read_text()
                    materials[slot] = {'url': binding['url'], 'source': binding['source'], 'owner': manifest['sourceShaderOwner'],
                                       'assemblySha256': manifest['assemblySha256'], 'shaderSha256': manifest['shaderSha256'],
                                       'scalarNodes': manifest['scalarNodes'], 'twoSided': manifest['twoSided'],
                                       'blendMode': manifest['blendMode'], 'foldedMaterialDefaults': manifest.get('foldedMaterialDefaults'),
                                       'textures': [{'slot': t['slot'], 'source': t['source'], 'sourceFormat': t['sourceFormat'],
                                                     'srgb': t['srgb'], 'wrap': [t['wrapS'], t['wrapT']], 'sha256': t['sha256'],
                                                     'effectiveSampler': effective_nail_sampler(raw, asm, t['slot'])}
                                                    for t in manifest['textures']],
                                       'cpu': {k: cpu_rows[job_id][k] for k in ('cases', 'maxAbsoluteError')},
                                       'gpu': {k: gpu_rows[job_id][k] for k in ('cases', 'maxAbsoluteError')}}
                runtime_parts.append({'sourceIndex': part['sourceIndex'], 'mesh': part['sourceMesh'], 'url': part['url'],
                                      'attachment': part.get('attachment'), 'materials': materials})
            entry['runtime'] = runtime_parts
        report_rows.append(entry)

    document = copy.deepcopy(supported)
    document['items'] = [*supported['items'], *implemented]
    document['ready'] = [*supported['ready'], *[ready_after[i] for i in implemented]]
    document['exceptions'] = [e for e in supported['exceptions'] if e['id'] not in cohort] + \
        [{'id': e['id'], 'reason': 'Accessory preview blocker: ' + ' | '.join(e['blockers'])}
         for e in report_rows if e['status'] == 'deferred']
    document['accessoriesPreview'] = {
        'preparedBy': MARKER, 'implemented': len(implemented), 'deferred': len(rows) - len(implemented),
        'scope': 'Additive preview only: exact Medium meshes and source material instances for ordinary M_CharacterAttachment '
                 'accessories whose every visible part and slot resolves. Not active; Astra review pending.'}
    write(PREVIEW / 'supported-items.json', document)
    urls = references(assets, pairs, document)
    absent = [url for url in urls if not (PREVIEW / url).resolve().is_file()]
    if absent: raise ValueError(f'Preview index references missing files: {absent}')

    inputs = {p.as_posix(): file_sha(p) for p in [CATALOG, READY, ASTRA_AUDIT, paths['cohort'], paths['audit'], paths['materialRequests'],
              paths['textureResolution'], paths['exports'] / 'working-export.json', paths['exports'] / 'probe-summary.json',
              *[ACTIVE / name for name in active]]}
    blocked = {}
    for entry in report_rows:
        if entry['status'] == 'deferred': blocked[entry['id']] = entry['blockers']
    summary = {
        'formatVersion': 1, 'marker': MARKER, 'base': ACTIVE.as_posix(), 'accessories': RUNTIME.as_posix(),
        'meaning': 'Additive accessory preview index. Every active entry is preserved and rebased; ordinary M_CharacterAttachment '
                   'accessories are added with their exact Medium meshes and source material instances. Serve through '
                   'servePreviewIndex; not active. Binding and arithmetic checks are not visual acceptance.',
        'inputs': inputs,
        'counts': {'candidates': len(rows), 'implemented': len(implemented), 'deferred': len(rows) - len(implemented),
                   'addedMeshes': len(needed_meshes), 'addedMaterials': len(needed_sources),
                   'meshes': len(assets['meshes']), 'materials': len(assets['materials']),
                   'materialVariants': len(assets.get('materialVariants', {})), 'skinPairs': len(pairs['items']),
                   'attachmentRestBones': len(assets.get('attachmentBody', {}).get('restBones', {})),
                   'coverageMasks': sum('bodyMaskUrl' in m for m in assets['meshes'].values()),
                   'supportedItems': len(document['items']), 'checkedReferences': len(urls)},
        'storedActiveEntriesDifferingFromResolver': stale,
        'implemented': implemented,
        'deferred': blocked,
        'rebasedUrls': dict(sorted({**rebase.moved, **rebase_added.moved}.items())),
    }
    write(PREVIEW / 'preview.json', summary)
    write(WORK / 'cohort-report.json', {'formatVersion': 1, 'marker': MARKER, 'items': report_rows})

    # Activation candidate for review only: exactly what would be added to the active index. Both
    # folders are siblings of the accessory runtime, so these relative urls hold in either one.
    # Nothing here is written to the active index; activation stays a separate, reviewed step.
    write(WORK / 'activation-candidate' / 'assets-additions.json',
          {'meshes': added['meshes'], 'materials': added['materials']})
    write(WORK / 'activation-candidate' / 'supported-items-additions.json',
          {'items': implemented, 'ready': [ready_after[i] for i in implemented],
           'exceptions': [e for e in document['exceptions'] if e['id'] in cohort],
           'accessoriesPreview': document['accessoriesPreview']})
    write(WORK / 'activation-candidate' / 'candidate.json', {
        'formatVersion': 1, 'marker': MARKER, 'meaning': 'Review candidate only; the active index is untouched.',
        'target': ACTIVE.as_posix(), 'runtime': RUNTIME.as_posix(), 'preview': PREVIEW.as_posix(),
        'apply': ['merge assets-additions.json meshes/materials into assets.json',
                  'append supported-items-additions.json items/ready and replace the listed exceptions',
                  'keep every existing entry unchanged; the preview proves they resolve to the same files'],
        'activeInputs': {(ACTIVE / name).as_posix(): file_sha(ACTIVE / name) for name in active}})
    print(f'Preview: {len(implemented)} accessories added, {len(rows) - len(implemented)} deferred; {len(needed_meshes)} meshes, '
          f'{len(needed_sources)} materials ({len(reports)} staged); {summary["counts"]["checkedReferences"]} references checked; '
          f'stale active entries: {stale or "none"}')


if __name__ == '__main__':
    if not CATALOG.is_file(): raise SystemExit('Run from the repository root')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('stage', choices=('build', 'gpu', 'index', 'all'))
    a = parser.parse_args()
    for name, run in (('build', stage_build), ('gpu', stage_gpu), ('index', stage_index)):
        if a.stage in (name, 'all'): run(a)
