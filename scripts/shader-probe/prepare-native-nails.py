"""Prepare the native Medium nail preview from Astra's exact source export.

Run from the repository root with Python 3.10+ (here, the `py` launcher):

  py scripts/shader-probe/prepare-native-nails.py build   # classify, compile, CPU-check, convert SK_Nails_M
  py scripts/shader-probe/prepare-native-nails.py gpu     # check-webgl.mjs in headless Edge; needs the dev server
  py scripts/shader-probe/prepare-native-nails.py index   # stage validated materials, write the preview index
  py scripts/shader-probe/prepare-native-nails.py all

Only the ordinary M_CharacterNails_Base family is compiled: its default program and the
UseColorTexture static sibling. Both read the same verified contract: hand side from uv0.y, the
left/right colour pairs, a mirrored and tiled pattern mask or colour texture, metallic/roughness and
desaturation, with Normal, Specular and AO left at their compiler-folded defaults. Every other nail
choice is recorded with an explicit blocker. Astra's export, the active index and the catalog are
only read; outputs go to three owned folders, and staged folders are verified, never overwritten.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import numpy as np

from material_inputs import material_inputs, read_json
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

READY = Path('_docs/native-nails-2026-09-11/astra-source-ready.json')
CATALOG = Path('src/data/items.json')
SOURCE_INDEX = Path('public/models/reconstructed-assembly-v2')
ACTIVE = Path('public/models/reconstructed-assemblies-v1')
RUNTIME = Path('public/models/reconstructed-nails-v1')
PREVIEW = Path('public/models/reconstructed-nails-preview-v1')
WORK = Path('scripts/generated/shader-probe/native-nails-opus-v1')
LEGACY = Path('scripts/asset-sources.generated.json')
NAILS_MESH = '/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M'
NAIL_ROOT = '/Game/Discovery/Characters/Nails/M_CharacterNails_Base.M_CharacterNails_Base'
HIDE_TAG = 'Customization.HideMesh.NailsCovered'
MARKER = 'shader-probe/prepare-native-nails'
OWNED = {'assets.json', 'skin-pairs.json', 'supported-items.json', 'preview.json'}
OUTPUTS = ('normal', 'roughness', 'ao', 'specular', 'baseColor', 'metalness')

# Evidence is the decoded instance parameters; none of these programs were translated here.
FAMILIES = {
    'M_CharacterNails_Jade': 'Separate Jade master whose instance overrides the shading model to MSM_Subsurface; not extracted or translated',
    'M_CharacterNails_ScreenGradient': 'Animated screen-gradient master (TimeMultiplier, FlickerPanSpeed, dots/numbers switch); time-driven live semantics unsupported',
    'M_CharacterNails_HalloweenGhosts': 'Glow-in-the-dark master (GlowInTheDarkStrength emissive); not extracted or translated',
    'M_CharacterNails_Hearts': 'Beating-hearts master with captured animation time and emissive (IconCaptureTime, IconCaptureEmissiveMultiplier); animated live semantics unsupported',
    'M_CharacterNails_Lavalamp': 'Lava-lamp master animated by SpeedMultiplier and NailTimeOffset with EmissiveIntensity; animated live semantics unsupported',
    'M_CharacterNails_OspuzeLiquidScreen': 'Liquid pixel-screen master (FluidHeight, NumPixels); not extracted or translated',
    'M_CharacterNails_OspuzeSourCore_01': 'Separate OspuzeSourCore master; not extracted or translated',
    'M_CharacterNails_Esports': 'Separate Esports master; not extracted or translated',
    'M_CharacterNails_Vaiiya': 'Separate Vaiiya master with a captured animation time (IconCaptureTime); not extracted or translated',
    'M_CharacterAttachment': 'Attachment material family (M_CharacterAttachment), not the nail master; outside this contract',
}

# CPU/GPU fixtures. Both hands (uv0.y > 0 selects the right colours, <= 0 the left, including the
# v = 0 boundary), mirrored and out-of-tile U, and pattern/colour samples at 0, partial and 1.
UVS = [(0.30, 0.40), (0.62, 0.15), (0.30, -0.40), (0.85, -0.90), (0.10, 0.0), (0.55, 0.0005),
       (-0.20, 0.70), (1.30, -0.25)]
SAMPLES = [[0.0, 0.2, 0.4, 0.0], [0.37, 0.6, 0.8, 0.5], [1.0, 0.9, 0.1, 1.0]]
ENGINE_SAMPLE = [0.5, 0.5, 0.5, 1.0]  # impact target and dissolve textures, dead in the surface
MATERIAL_TEXTURES = ('Pattern', 'ColorTexture')


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def file_sha(path):
    return sha(Path(path).read_bytes())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def source():
    ready = read_json(READY)
    paths = {key: Path(ready[key]) for key in ('exports', 'meshes', 'textures', 'cohort', 'materialRequests')}
    if not (paths['exports'] / 'probe-summary.json').is_file(): raise ValueError('Astra export is incomplete')
    return ready, paths


def classify(paths):
    """Every catalog nail with its source identity; a blocker names why it is not compiled."""
    catalog = [item for item in read_json(CATALOG) if item['slot'] == 'nailPolish']
    if len(catalog) != 124: raise ValueError(f'Nail catalog changed: {len(catalog)}')
    cohort = read_json(paths['cohort'])
    entries = {entry['id']: entry for entry in cohort['items']}
    ambiguous = set(cohort['deferredAmbiguousIds'])
    rows = []
    for item in catalog:
        definition = read_json(SOURCE_INDEX / 'items' / f'{item["id"]}.json')
        properties = definition['properties']
        parts, overrides = properties.get('VisualParts', []), properties.get('MaterialOverrides', [])
        if len(parts) != 1 or parts[0]['SkeletalMesh']['AssetPathName'] != NAILS_MESH or \
                [o['Key'] for o in overrides] != ['Nails'] or properties.get('ActivatesMaterialParameters'):
            raise ValueError(f'Unexpected nail definition shape: {item["id"]}')
        hides = [r for r in parts[0]['TagOverrides'] if HIDE_TAG in r['MatchingTags']]
        if len(hides) != 1 or hides[0]['MatchingTags'] != [HIDE_TAG] or not hides[0]['bOverrideMesh'] or \
                any(hides[0][key]['AssetPathName'] for key in ('ReplacementStaticMesh', 'ReplacementSkeletalMesh')):
            raise ValueError(f'Unexpected {HIDE_TAG} rule: {item["id"]}')
        (material,) = entries[item['id']]['materials']
        if material['requested'] != overrides[0]['Value']['AssetPathName']: raise ValueError('Cohort material changed')
        root = material.get('root')
        row = {'id': item['id'], 'name': item['name'],
               'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
               'material': {'object': material['requested'], 'root': root, 'program': material.get('outputHash'),
                            'shaderOwner': material.get('shaderOwner'), 'parentChain': material.get('parentChain')}}
        if root != NAIL_ROOT:
            row['blocker'] = FAMILIES[root.split('.')[-1]]
        elif item['id'] in ambiguous:
            paths_named = cohort['ambiguousPaths'][material['requested'].split('.')[-1]]
            row['blocker'] = 'Two source packages share this instance basename; the exact-name shader tools would conflate ' + \
                ' and '.join(paths_named)
        rows.append(row)
    return rows


def jobs_for(rows, paths):
    """Astra's exact requests, checked against the classification rather than trusted blindly."""
    jobs = read_json(paths['materialRequests'])
    candidates = {row['id']: row for row in rows if 'blocker' not in row}
    if sorted(job['id'] for job in jobs) != sorted(candidates):
        raise ValueError('Material requests differ from the M_CharacterNails_Base candidates')
    for job in jobs:
        if job['instance'] != candidates[job['id']]['material']['object'].split('.')[-1]:
            raise ValueError(f'Request instance differs from the definition: {job["id"]}')
    return jobs


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
            for sample in SAMPLES:
                def texture(slot, coords, dimensions, sample=sample):
                    if dimensions:
                        d = info.get(slot, {'width': 1, 'height': 1, 'depth': 1, 'mipCount': 1})
                        return [d[key] for key in ('width', 'height', 'depth', 'mipCount')]
                    return sample if by_slot.get(slot) in MATERIAL_TEXTURES else ENGINE_SAMPLE
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


def build_mesh(paths):
    """Convert SK_Nails_M without merging vertices or reducing weights; a rerun must reproduce it."""
    dto = paths['meshes'] / 'SK_Nails_M.mesh.json'
    folder = RUNTIME / 'meshes'
    if (folder / 'meshes.json').is_file():
        (entry,) = read_json(folder / 'meshes.json')
        check = WORK / 'mesh-rebuilds' / file_sha(dto)[:16]
        rebuilt = check / 'SK_Nails_M.glb'
        if not rebuilt.exists(): meshes_builder.build(dto, rebuilt)
        if file_sha(rebuilt) != entry['sha256'] or file_sha(folder / entry['file']) != entry['sha256']:
            raise ValueError('Preserved SK_Nails_M differs from a fresh conversion; use a new runtime folder')
    else:
        if folder.exists() and any(folder.iterdir()): raise ValueError(f'Use an empty mesh folder: {folder}')
        folder.mkdir(parents=True, exist_ok=True)
        write(folder / 'meshes.json', [meshes_builder.build(dto, folder / 'SK_Nails_M.glb')])
    (entry,) = read_json(folder / 'meshes.json')
    glb = (folder / entry['file']).read_bytes()
    size = int.from_bytes(glb[12:16], 'little')
    materials = json.loads(glb[20:20 + size])['materials']
    if [(m['extras']['sourceSlot']['MaterialSlotName'], m['extras']['sourceMaterial']) for m in materials] != \
            [('Nails', NAIL_ROOT)]: raise ValueError('SK_Nails_M must have exactly its source Nails slot')
    verification = mesh_verifier.verify(dto, folder / entry['file'])
    mesh = read_json(paths['meshes'] / 'assets.json')[0]
    write(WORK / 'mesh-verification.json', {**verification, 'sourcePackage': mesh['path'],
                                           'sourcePackageSha256': mesh['sha256'], 'sourceDtoSha256': file_sha(dto),
                                           'vertices': entry['vertices'], 'triangles': entry['triangles'],
                                           'maxInfluences': entry['maxInfluences'], 'uvSets': entry['uvSets'],
                                           'bones': entry['bones']})
    print(f'Mesh: {entry["file"]} {entry["vertices"]} vertices, {entry["maxInfluences"]} influence, verified')


def stage_build(args):
    ready, paths = source()
    rows = classify(paths)
    jobs = jobs_for(rows, paths)
    write(WORK / 'classification.json', rows)
    write(WORK / 'requests.json', jobs)
    staging = RUNTIME / 'staging'
    # Unsupported instances are recorded with their reasons and stay out of every later stage.
    materials_builder.build(paths['exports'], paths['textures'], staging, jobs, keep_going=True)
    print(f'Build: {len(read_json(staging / "build-report.json"))} built, '
          f'{len(read_json(staging / "build-errors.json"))} rejected')
    cpu_check(paths['exports'], staging, jobs)
    build_mesh(paths)


def stage_gpu(args):
    folder = WORK / 'validation'
    log = WORK / 'webgl-check.log'
    with log.open('w', encoding='utf-8') as out:
        code = subprocess.call(['node', 'scripts/shader-probe/check-webgl.mjs', str(folder / 'translation-fixtures.json'),
                                '/models/reconstructed-nails-v1/staging', str(folder / 'webgl-checks.json')],
                               stdout=out, stderr=subprocess.STDOUT)
    rows = read_json(folder / 'webgl-checks.json') if (folder / 'webgl-checks.json').is_file() else []
    failures = [row for row in rows if row.get('error')]
    print(f'GPU: {len(rows) - len(failures)} materials matched {sum(r["cases"] for r in rows)} cases, '
          f'max error {max((r["maxAbsoluteError"] for r in rows), default=0):.3g}; {len(failures)} failed (exit {code})')


def accepted_ids():
    """The same acceptance stage-validated-materials.py applies: equal nonzero CPU and GPU cases."""
    folder = WORK / 'validation'
    cpu = {row['itemId']: row for row in read_json(folder / 'translation-checks.json')}
    gpu = {row['itemId']: row for row in read_json(folder / 'webgl-checks.json')}
    return {i for i, c in cpu.items() if i in gpu and not gpu[i].get('error') and gpu[i]['cases'] == c['cases'] > 0}


def stage_materials():
    staging, staged = RUNTIME / 'staging', RUNTIME / 'materials'
    if staged.exists() and any(staged.iterdir()):
        # Prove the earlier staging is exactly this validation's result instead of copying again.
        reports = read_json(staged / 'build-report.json')
        if {row['itemId'] for row in reports} != accepted_ids(): raise ValueError('Staged set differs from validation')
        for row in reports:
            manifest = read_json(staged / f'{row["itemId"]}.json')
            for name in [f'{row["itemId"]}.json', manifest['shader'], *[t['file'] for t in manifest['textures']]]:
                if file_sha(staged / name) != file_sha(staging / name): raise ValueError(f'Staged file differs: {name}')
    else:
        stager.stage(staging, WORK / 'validation', WORK / 'validation' / 'webgl-checks.json', staged)
    return read_json(staged / 'build-report.json')


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


def resolve_items(assets_file, output):
    """The runtime's own resolver over every catalog item, as check-assembly-coverage.mjs reports it."""
    with (WORK / (output.stem + '.log')).open('w', encoding='utf-8') as log:
        subprocess.check_call(['node', '--import', 'tsx', 'scripts/shader-probe/check-assembly-coverage.mjs',
                               str(SOURCE_INDEX / 'customization.json'), str(assets_file), str(output)],
                              stdout=log, stderr=subprocess.STDOUT)
    return read_json(output)


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


def stage_index(args):
    ready, paths = source()
    rows = read_json(WORK / 'classification.json')
    if rows != classify(paths): raise ValueError('Classification changed since the build stage; rerun build')
    reports = stage_materials()
    staged = RUNTIME / 'materials'
    nails_file = RUNTIME / 'nails-assets.json'
    assembly_index.build([RUNTIME / 'meshes'], [staged], [paths['exports']], LEGACY, nails_file, [], None)
    nails = read_json(nails_file)
    if list(nails['meshes']) != [NAILS_MESH] or 'bodyMaskUrl' in nails['meshes'][NAILS_MESH] or nails.get('materialVariants'):
        raise ValueError('The nail index must add SK_Nails_M alone, without a synthesized body mask or variants')

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
    rebase_nails = preview_tools.Rebaser(RUNTIME, PREVIEW)
    added = preview_tools.rebase_assets(nails, rebase_nails)
    if rebase_nails.missing: raise ValueError(f'Nail index references missing files: {rebase_nails.missing}')
    conflicts = [key for key in added['meshes'] if key in assets['meshes']] + \
                [key for key in added['materials'] if key in assets['materials']]
    if conflicts: raise ValueError(f'Nail entries would replace active bindings: {conflicts}')
    assets['meshes'][NAILS_MESH] = added['meshes'][NAILS_MESH]
    assets['materials'] = dict(sorted({**assets['materials'], **added['materials']}.items()))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    write(PREVIEW / 'assets.json', assets)
    write(PREVIEW / 'skin-pairs.json', pairs)

    # Only the viewer's resolver decides support. It must reproduce the active result for every
    # other item, so the preview adds nails and changes nothing else.
    before = resolve_items(ACTIVE / 'assets.json', WORK / 'resolver-active.json')
    after = resolve_items(PREVIEW / 'assets.json', WORK / 'resolver-preview.json')
    nail_ids = {row['id'] for row in rows}
    ready_before = {entry['id']: entry for entry in before['ready']}
    ready_after = {entry['id']: entry for entry in after['ready']}
    if sorted(ready_before) != sorted(i for i in ready_after if i not in nail_ids):
        raise ValueError('The preview changes which non-nail items resolve')
    for item_id, entry in ready_before.items():
        if preview_tools.resolved_shape(entry, ACTIVE) != preview_tools.resolved_shape(ready_after[item_id], PREVIEW):
            raise ValueError(f'The preview resolves {item_id} to different files')
    stored = {entry['id']: entry for entry in supported['ready']}
    stale = sorted(i for i in stored if preview_tools.resolved_shape(stored[i], PREVIEW) !=
                   preview_tools.resolved_shape(ready_after[i], PREVIEW))

    staged_ids = {row['itemId'] for row in reports}
    exceptions = {entry['id']: entry['reason'] for entry in after['exceptions']}
    implemented = [row for row in rows if row['id'] in ready_after]
    if any(row['id'] not in staged_ids or 'blocker' in row for row in implemented):
        raise ValueError('An unvalidated nail resolved')
    build_errors = {row['itemId']: row['error'] for row in read_json(RUNTIME / 'staging' / 'build-errors.json')}
    cpu_errors = {row['id']: row['error'] for row in read_json(WORK / 'validation' / 'translation-errors.json')}
    gpu_rows = {row['itemId']: row for row in read_json(WORK / 'validation' / 'webgl-checks.json')}
    cpu_rows = {row['itemId']: row for row in read_json(WORK / 'validation' / 'translation-checks.json')}
    for row in rows:
        if row['id'] in ready_after: continue
        row['blocker'] = row.get('blocker') or (
            f'Translation rejected: {build_errors[row["id"]]}' if row['id'] in build_errors else
            f'CPU check quarantined: {cpu_errors[row["id"]]}' if row['id'] in cpu_errors else
            f'GPU check failed: {gpu_rows.get(row["id"], {}).get("error", "no GPU result")}')
    for entry in ready_after.values():
        if entry['id'] not in nail_ids: continue
        (part,) = entry['parts']
        if part['sourceMesh'] != NAILS_MESH or 'bodyMaskUrl' in part or part.get('attachment') or list(part['materials']) != ['Nails']:
            raise ValueError(f'Unexpected nail binding: {entry["id"]}')

    implemented_ids = [row['id'] for row in implemented]
    document = copy.deepcopy(supported)
    document['items'] = [*supported['items'], *implemented_ids]
    document['ready'] = [*supported['ready'], *[ready_after[i] for i in implemented_ids]]
    document['exceptions'] = [e for e in supported['exceptions'] if e['id'] not in nail_ids] + \
        [{'id': row['id'], 'reason': f'Native nail preview blocker: {row["blocker"]}. Resolver: {exceptions[row["id"]]}'}
         for row in rows if row['id'] not in ready_after]
    document['nativeNailsPreview'] = {
        'preparedBy': MARKER, 'implemented': len(implemented_ids), 'deferred': len(rows) - len(implemented_ids),
        'scope': 'Additive preview only: exact SK_Nails_M and source material instances for the ordinary '
                 'M_CharacterNails_Base family on the Medium body. Not active; Astra review pending.'}
    write(PREVIEW / 'supported-items.json', document)

    urls = references(assets, pairs, document)
    absent = [url for url in urls if not (PREVIEW / url).resolve().is_file()]
    if absent: raise ValueError(f'Preview index references missing files: {absent}')

    # Per-item source identities, validation and blockers.
    exports = paths['exports']
    mesh_verification = read_json(WORK / 'mesh-verification.json')
    packages = {record['name']: record['path'] for record in read_json(exports / 'probe-summary.json')['results']}
    report_rows = []
    for row in rows:
        entry = {**row, 'status': 'implemented' if row['id'] in ready_after else 'deferred'}
        chain = row['material']['parentChain'] or []
        entry['material']['packages'] = [{'object': path, 'package': packages.get(path.split('.')[-1]),
                                          'sha256': file_sha(exports / (path.split('.')[-1] + '.uasset'))
                                          if (exports / (path.split('.')[-1] + '.uasset')).is_file() else None}
                                         for path in chain]
        if entry['status'] == 'implemented':
            manifest = read_json(staged / f'{row["id"]}.json')
            (part,) = ready_after[row['id']]['parts']
            entry['runtime'] = {'mesh': part['url'], 'material': part['materials']['Nails']['url'],
                                'shaderOwner': manifest['sourceShaderOwner'], 'assemblySha256': manifest['assemblySha256'],
                                'shaderSha256': manifest['shaderSha256'], 'scalarNodes': manifest['scalarNodes'],
                                'foldedMaterialDefaults': manifest.get('foldedMaterialDefaults'),
                                'textures': [{'slot': t['slot'], 'source': t['source'], 'sourceFormat': t['sourceFormat'],
                                              'srgb': t['srgb'], 'sha256': t['sha256']} for t in manifest['textures']],
                                'cpu': {k: cpu_rows[row['id']][k] for k in ('cases', 'maxAbsoluteError')},
                                'gpu': {k: gpu_rows[row['id']][k] for k in ('cases', 'maxAbsoluteError')}}
        report_rows.append(entry)
    inputs = {str(p).replace('\\', '/'): file_sha(p) for p in [CATALOG, READY, paths['cohort'], paths['materialRequests'],
              exports / 'probe-summary.json', paths['meshes'] / 'SK_Nails_M.mesh.json',
              *[ACTIVE / name for name in active]]}
    families = {}
    for row in report_rows:
        if row['status'] == 'deferred': families.setdefault(row['blocker'], []).append(row['id'])
    summary = {
        'formatVersion': 1, 'marker': MARKER, 'base': ACTIVE.as_posix(), 'nails': RUNTIME.as_posix(),
        'meaning': 'Additive native-nail preview index. Every active entry is preserved and rebased; ordinary '
                   'M_CharacterNails_Base nails are added with SK_Nails_M and their exact source material instances. '
                   'Serve through servePreviewIndex; not active. Binding and arithmetic checks are not visual acceptance.',
        'inputs': inputs,
        'counts': {'catalogNails': len(rows), 'implemented': len(implemented_ids), 'deferred': len(rows) - len(implemented_ids),
                   'meshes': len(assets['meshes']), 'materials': len(assets['materials']),
                   'materialVariants': len(assets.get('materialVariants', {})), 'skinPairs': len(pairs['items']),
                   'attachmentRestBones': len(assets.get('attachmentBody', {}).get('restBones', {})),
                   'coverageMasks': sum('bodyMaskUrl' in m for m in assets['meshes'].values()),
                   'supportedItems': len(document['items']), 'checkedReferences': len(urls)},
        'mesh': {'object': NAILS_MESH, 'url': assets['meshes'][NAILS_MESH]['url'], 'sha256': assets['meshes'][NAILS_MESH]['sha256'],
                 'slots': assets['meshes'][NAILS_MESH]['slots'], **{k: mesh_verification[k] for k in
                 ('sourcePackage', 'sourcePackageSha256', 'sourceDtoSha256', 'vertices', 'triangles', 'maxInfluences', 'uvSets')}},
        'storedActiveEntriesDifferingFromResolver': stale,
        'implemented': implemented_ids,
        'deferredByBlocker': families,
        'rebasedUrls': dict(sorted({**rebase.moved, **rebase_nails.moved}.items())),
    }
    write(PREVIEW / 'preview.json', summary)
    write(WORK / 'cohort-report.json', {'formatVersion': 1, 'marker': MARKER, 'items': report_rows})
    print(f'Preview: {len(implemented_ids)} nails added, {len(rows) - len(implemented_ids)} deferred; '
          f'{summary["counts"]["meshes"]} meshes, {summary["counts"]["materials"]} materials, '
          f'{summary["counts"]["checkedReferences"]} references checked; stale active entries: {stale or "none"}')


if __name__ == '__main__':
    if not CATALOG.is_file(): raise SystemExit('Run from the repository root')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('stage', choices=('build', 'gpu', 'index', 'all'))
    a = parser.parse_args()
    for name, run in (('build', stage_build), ('gpu', stage_gpu), ('index', stage_index)):
        if a.stage in (name, 'all'): run(a)
