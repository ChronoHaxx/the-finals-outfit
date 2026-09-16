"""Stage the frozen 21-choice Large Sneakers family (Medium) using the existing source/compiler checks.

Adapted from prepare-tactical-boots.py. The frozen resolved cohort supplies each choice's exact
effective mesh-slot overrides; prepare-accessory-defaults.py supplies extraction/provenance plumbing.
The active index, catalogs and earlier folders are only read. Run from the repository root with
C:/ProgramData/anaconda3/python.exe:

  python scripts/shader-probe/prepare-large-sneakers.py mesh      # fresh exact mesh export, GLB, attribute check
  node --import tsx _docs/large-sneakers-2026-09-13/opus-freeze.mjs  # definitions/slots -> resolved-cohort.json
  python scripts/shader-probe/prepare-large-sneakers.py source    # exact materials, parent chains, validate, textures
  python scripts/shader-probe/prepare-large-sneakers.py build     # compile, independent CPU check, mesh verify
  python scripts/shader-probe/prepare-large-sneakers.py gpu       # fresh uniquely named check-webgl run
  python scripts/shader-probe/prepare-large-sneakers.py index     # runtime staging, additive preview
  python scripts/shader-probe/prepare-large-sneakers.py coverage  # derived A/idle body coverage, then index again
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
import importlib.util

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

d = load('prepare-accessory-defaults')
cpu = load('check-material-batch')
DOCS = Path('_docs/large-sneakers-2026-09-13')
WORK = Path('scripts/generated/shader-probe/large-sneakers-v1')
RUNTIME = Path('public/models/reconstructed-large-sneakers-v1')
PREVIEW = Path('public/models/reconstructed-large-sneakers-preview-v1')
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = 'shader-probe/prepare-large-sneakers'
DOTNET = Path('scripts/generated/shader-probe/tools/dotnet/dotnet.exe')
PROBE = Path('scripts/generated/shader-probe/catalog-refresh-20260912/opus-probe-bin/ShaderProbe.dll')
SETTINGS = 'C:/Users/ChronoHax/AppData/Roaming/FModel/AppSettings.json'
MESH_REPORT = DOCS / 'opus-mesh-report.json'


def plan():
    batch, cohort = d.load_batch()
    rows = []
    for row in cohort:
        definition = d.read_json(d.SOURCE_INDEX / 'items' / (row['id'] + '.json'))
        if definition != row['definition']: raise ValueError('Frozen definition changed: ' + row['id'])
        if row['resolved'].get('materialParameters'): raise ValueError('Unexpected per-item material parameters')
        visible = [p for p in row['resolved']['parts'] if not p['hidden']]
        if len(visible) != 1 or len(row['effectiveParts']) != 1: raise ValueError('Expected one visible part: ' + row['id'])
        part, = visible
        if part['unresolved'] or part['effect']: raise ValueError('Incomplete source part: ' + row['id'])
        rows.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                     'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                     'parameterBlockers': [], 'parts': [{'sourceIndex': part['sourceIndex'],
                         'mesh': part['skeletalMesh'], 'slots': row['effectiveParts'][0]['slots'], 'effect': None, 'unresolved': []}]})
    return batch, rows, []
d.plan = plan


def extract(mode, folder, requests):
    target = d.SOURCE / folder
    if target.exists() and any(target.iterdir()): raise ValueError('Preserve source extraction: ' + str(target))
    # TextureExport.cs resolves plugin-mount object paths by unique content suffix; the shared
    # character template textures of these chains live under the /EmbarkScript/ mount.
    check = (lambda r: r.startswith(('/Game/', '/EmbarkScript/')) and '.' in r.split('/')[-1]) if mode == 'textures' else \
        (lambda r: r.startswith('Discovery/Content/') and r.endswith('.uasset'))
    if not requests or len(requests) != len(set(requests)) or not all(check(r) for r in requests):
        raise ValueError('Expected unique exact source requests')
    request = d.SOURCE / (folder + '.requests.json')
    if request.exists() and d.read_json(request) != requests: raise ValueError('Request changed')
    d.write(request, requests); target.mkdir(parents=True, exist_ok=True)
    command = [str(DOTNET.resolve()), str(PROBE.resolve()), mode, d.PAKS, str(d.USMAP.resolve()), d.OODLE,
               str(target.resolve()), str(request.resolve()), SETTINGS]
    started = time.time()
    with (d.SOURCE / (folder + '.log')).open('wb') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    record = {'at': d.now(), 'mode': mode, 'folder': folder, 'count': len(requests), 'exitCode': result.returncode,
              'seconds': round(time.time() - started, 3)}
    d.write(d.SOURCE / (folder + '.run.json'), record); print(json.dumps(record), flush=True)
    if result.returncode:
        # Instances with no static permutation legitimately export zero shaders; the closed
        # parent chain must still supply and validate the actual program before any build.
        summary = d.read_json(target / 'probe-summary.json') if (target / 'probe-summary.json').exists() else {}
        rows = summary.get('results', [])
        inherited = mode == 'shaders' and result.returncode == 1 and len(rows) == len(requests) and all(
            not r.get('error') and r.get('parent') for r in rows) and summary.get('requestedShaders') == 0
        if not inherited: raise RuntimeError('Source extraction failed: ' + str(folder))
d.extract = extract


def mesh():
    cohort = d.read_json(DOCS / 'cohort.json')
    folder = d.SOURCE / 'meshes-01'
    if not (folder / 'assets.json').is_file():
        extract('assets', 'meshes-01', [d.package_of(m) for m in cohort['meshes']])
    records = d.read_json(folder / 'assets.json')
    if len(records) != 1 or records[0].get('error'): raise ValueError('Expected one exact mesh export')
    record = records[0]
    if d.assembly_index.object_path(record['path']) != cohort['meshes'][0]: raise ValueError('Exported a different mesh')
    source = folder / record['meshFile']
    output = WORK / 'meshes' / (source.name.removesuffix('.mesh.json') + '.glb')
    if output.exists(): raise ValueError('Preserve converted mesh: ' + str(output))
    report = d.meshes_builder.build(source, output)
    verification = d.mesh_verifier.verify(source, output)
    if not verification.get('passed'): raise ValueError('Converted mesh attributes differ from the source DTO')
    d.write(WORK / 'mesh-verification.json', verification)
    d.write(WORK / 'meshes' / 'meshes.json', [report])
    dto = d.read_json(source)
    d.write(MESH_REPORT, {**report, 'glb': output.as_posix(), 'meshJson': source.as_posix(),
                          'sourceDtoSha256': d.file_sha(source), 'sourcePackageSha256': record['sha256'],
                          'sourceRun': d.read_json(folder / 'source-run.json') if (folder / 'source-run.json').is_file() else None,
                          'dtoKeys': sorted(dto), 'verification': verification})
    print(json.dumps({k: report[k] for k in ('vertices', 'triangles', 'uvSets', 'morphs', 'bones', 'materialSections')}), flush=True)


def progress(milestone, **fields):
    path = DOCS / 'opus-progress.json'
    doc = d.read_json(path) if path.is_file() else {}
    history = doc.get('history', [])
    history.append({'at': d.now(), 'milestone': milestone, **fields})
    d.write(path, {**doc, 'at': d.now(), 'milestone': milestone, **fields, 'history': history})


def surface_audit(exports, jobs):
    """Independent read of each compiled program for branches the static clothing slice drops.

    build-materials.py applies these rules only to M_CharacterAttachment. For these clothing roots a live,
    nonzero emissive strength read by the shader, or a surface texture reaching the masked discard other
    than through the surface normal (material opacity), would render as a plausible solid surface.
    """
    from sm5_slice import Slice
    from material_inputs import material_inputs, texture_paths, neck_fade_inputs
    textures = {t['path']: t for t in d.read_json(d.SOURCE / 'textures-01' / 'textures.json')}
    rows = []
    for item_id, instance, owner, chain in material_inputs(exports, jobs):
        row = {'itemId': item_id, 'instance': instance, 'owner': owner, 'root': chain[0]['Name'], 'blockers': []}
        blend, shading = chain[0]['Properties'].get('BlendMode', 'EBlendMode::BLEND_Opaque'), chain[0]['Properties'].get('ShadingModel')
        for material in chain[1:]:
            override = material['Properties'].get('BasePropertyOverrides', {})
            if 'BlendMode' in override: blend = override['BlendMode']
            if 'ShadingModel' in override: shading = override['ShadingModel']
        row.update({'blendMode': blend, 'shadingModel': shading})
        try:
            stem = owner + '.SP_PCD3D_SM5'
            uniforms = d.read_json(exports / (stem + '.uniforms.json'))
            bindings = d.read_json(exports / 'bindings' / (stem + '.basepass-pixel.bindings.json'))
            assembly = (exports / 'shaders' / (stem + '.basepass-pixel.dxbc.asm')).read_text()
            constants, parameters = d.materials_builder.material_constants(uniforms, chain)
        except Exception as error:
            # material_constants rejects active EmissiveStrength parameters before any slice exists.
            row['blockers'].append(f'Source contract: {error}')
            emissive = {k: v for k, v in (_parameters(uniforms, chain)).items() if 'Emissive' in k and any(v)}
            row['liveEmissiveParameters'] = emissive
            rows.append(row); continue
        read = {(int(r), lane) for r, lanes in re.findall(rf"cb{bindings['materialBufferIndex']}\[(\d+)\]\.([xyzw]+)", assembly)
                for lane in lanes}
        live = []
        for field in bindings['uniformFields']:
            if 'Emissive' not in field['expression']: continue
            register, lanes = re.fullmatch(r'cb\d+\[(\d+)\]\.([xyzw]+)', field['register']).groups()
            if not any((int(register), lane) in read for lane in lanes): continue
            values = [constants[field['floatOffset'] + i] for i in range(int(field['type'][-1]))]
            live.append({'expression': field['expression'], 'values': values})
            if 'Strength' in field['expression'] and any(values):
                row['blockers'].append(f'Live nonzero emissive input read by the compiled shader: {field["expression"]}')
        row['liveEmissiveFields'] = live
        slots = {}
        for slot, path in texture_paths(chain, bindings):
            if path in textures:
                t = textures[path]; first = t['mips'][0]
                slots[slot] = {'path': path, 'width': first['width'], 'height': first['height'], 'depth': t['slices'],
                               'mipCount': len(t['mips']), 'array': t['type'] == 'UTexture2DArray', 'cube': t['type'] == 'UTextureCube'}
        cloth = any(any(v) for name, v in parameters.items() if name.endswith('_ShadeAsCloth'))
        try:
            sliced = Slice(assembly, constants, slots, view_dependent=cloth, geometry_dependent=chain[0]['Name'] == 'M_Character_8Layers_Master',
                           material_buffer=bindings['materialBufferIndex'], neck_fade=neck_fade_inputs(chain, bindings, constants))
            _, used, _ = sliced.emit()
            reached = set()
            for condition in sliced.discards:
                reached |= Slice.sampled_slots([condition], sliced.outputs['normal']) & set(used)
            row['discards'] = len(sliced.discards)
            row['discardSurfaceTextures'] = sorted(reached)
            row['clipTail'] = clip_tail(assembly)
            if reached:
                components = sorted(c for c in reaching_components(sliced.discards, sliced.outputs['normal']) if c[0] in reached)
                row['discardSurfaceComponents'] = [{'slot': s, 'component': 'xyzw'[c] if c is not None else 'all',
                                                    'texture': slots[s]['path']} for s, c in components]
                # M_Character_Layered takes min(opacity, OCM alpha) before the dithered clip. When the only surface
                # input is an alpha channel that decodes to exactly 1.0 on every texel of every mip, that min is
                # neutral and the clip reduces to the engine-only terms shared with the 8Layers programs.
                alphas = {s: alpha_range(textures[slots[s]['path']]) for s, c in components if c == 3}
                row['discardAlphaRanges'] = alphas
                tail = clip_tail(assembly)
                row['clipTail'] = tail
                # The alpha enters only through min(); below the clip threshold nothing it can change is discarded
                # unless the shared engine fade/dissolve terms are already active (excluded as in the 8Layers programs).
                neutral = bool(tail) and all(c == 3 and alphas[s][0] / 255 > tail['threshold'] for s, c in components)
                row['discardAlphaNeutral'] = neutral
                if not neutral:
                    row['blockers'].append(f'Surface texture {sorted(reached)} reaches the masked discard other than through the '
                                           'surface normal: material opacity is not reproduced')
        except Exception as error:
            row['blockers'].append(f'Slice: {error}')
        rows.append(row)
    return rows


def reaching_components(nodes, barriers):
    """(slot, component) pairs of texture samples beneath these nodes, not looking past any barrier node."""
    seen, found, stack = set(barriers), set(), list(nodes)
    while stack:
        node = stack.pop()
        if node in seen: continue
        seen.add(node)
        if node.op == 'component' and node.args and node.args[0].op == 'sample':
            found.add((node.args[0].value[0], node.value)); seen.add(node.args[0]); stack.extend(node.args[0].args); continue
        if node.op == 'sample': found.add((node.value[0], None))
        stack.extend(node.args)
    return found


CLIP_TAIL = re.compile(
    r"add (r\d+)\.(\w), r\d+\.\w, l\((-?[\d.]+)\)\n"                     # opacity - bias
    r"(?:(?!discard|add \1\.\2).*\n){0,12}?"                             # screen position -> blue-noise texel
    r"ld_indexable\(texture2d\)\(float,float,float,float\) (r\d+)\.(\w), r\d+\.\w+, t0\.\w+\n"
    r"mul \4\.\5, \4\.\5, l\(([\d.]+)\)\n"                               # dither scale
    r"mad (r\d+)\.(\w), \1\.\2, l\(([\d.]+)\), \4\.\5\n"                 # opacity * scale + dither
    r"add \7\.\8, \7\.\8, l\((-?[\d.]+)\)\n"                             # - clip
    r"lt \7\.\8, \7\.\8, l\(0\.000000\)\n"
    r"discard_nz \7\.\8\n")


def clip_tail(assembly):
    """The compiled dithered masked clip: discard when (opacity + bias) * scale + dither * d + clip < 0, dither >= 0."""
    matches = list(CLIP_TAIL.finditer('\n'.join(l.strip() for l in assembly.splitlines()) + '\n'))
    if len(matches) != 1: return None
    bias, dither, scale, clip = (float(matches[0].group(i)) for i in (3, 6, 9, 10))
    if bias > 0 or dither < 0 or scale <= 0 or clip >= 0: return None
    return {'bias': bias, 'scale': scale, 'ditherScale': dither, 'clip': clip, 'threshold': -clip / scale - bias}


def alpha_range(record):
    """Decoded 8-bit alpha [min, max] over every mip of a cooked texture, via the builder's own decoder."""
    low, high = 255, 0
    for mip in record['mips']:
        raw = (d.SOURCE / 'textures-01' / mip['file']).read_bytes()
        if d.sha(raw).upper() != mip['sha256']: raise ValueError('Mip hash mismatch')
        rgba = d.materials_builder.decode_mip(raw, mip['width'], mip['height'], record['slices'], record['format'])
        alpha = rgba[3::4]
        low, high = min(low, min(alpha)), max(high, max(alpha))
    return [low, high]


def _parameters(uniforms, chain):
    overrides = {}
    for material in chain:
        for group in ('ScalarParameterValues', 'VectorParameterValues'):
            for entry in material['Properties'].get(group, []):
                overrides[entry['ParameterInfo']['Name']] = entry['ParameterValue']
    out = {}
    for parameter in uniforms['UniformNumericParameters']:
        name = parameter['ParameterInfo']['Name']; value = overrides.get(name, parameter['Value'])
        out[name] = [value[k] for k in 'RGBA'] if isinstance(value, dict) else [value]
    return out


def build():
    d.ready_source()
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    jobs = [{'id': d.job_id(r['instance']), 'instance': r['instance']} for r in resolution if not r.get('error')]
    d.write(WORK / 'requests.json', jobs)
    d.materials_builder.build(d.SOURCE / 'working-01', d.SOURCE / 'textures-01', RUNTIME / 'staging', jobs, keep_going=True)
    cpu.check(d.SOURCE / 'working-01', RUNTIME / 'staging', WORK / 'requests.json')
    for name in ['translation-checks.json', 'translation-fixtures.json', 'translation-errors.json', 'passed.requests.json']:
        dest = WORK / 'validation' / name; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(d.SOURCE / 'working-01' / name, dest)
    audit = surface_audit(d.SOURCE / 'working-01', jobs)
    d.write(WORK / 'surface-audit.json', audit)
    r = d.read_json(MESH_REPORT)
    if d.file_sha(r['glb']) != r['sha256'] or d.file_sha(r['meshJson']) != r['sourceDtoSha256']: raise ValueError('Frozen mesh changed')
    dest = WORK / 'meshes' / r['file']
    if d.file_sha(dest) != r['sha256']: raise ValueError('Preserve changed mesh')
    verification = d.mesh_verifier.verify(Path(r['meshJson']), dest)
    if not verification.get('passed'): raise ValueError('Mesh verification failed')
    d.write(WORK / 'mesh-verification.json', verification)
    d.write(WORK / 'meshes' / 'meshes.json', [{k: v for k, v in r.items() if k not in ('verification', 'sourceRun', 'dtoKeys')}])
    errors = d.read_json(RUNTIME / 'staging' / 'build-errors.json')
    unverified = d.read_json(WORK / 'validation' / 'translation-errors.json')
    summary = {'built': len(d.read_json(RUNTIME / 'staging' / 'build-report.json')), 'buildErrors': {e['itemId']: e['error'] for e in errors},
               'cpuPassed': len(d.read_json(WORK / 'validation' / 'passed.requests.json')),
               'cpuErrors': {e['id']: e['error'] for e in unverified},
               'auditBlockers': {a['itemId']: a['blockers'] for a in audit if a['blockers']}}
    progress('build', build=summary)
    print(json.dumps(summary, indent=1), flush=True)


def audit_blocked():
    return {a['itemId']: a['blockers'] for a in d.read_json(WORK / 'surface-audit.json') if a['blockers']}


def index():
    d.ready_source()
    helper = d.shared_helpers()
    accepted = helper.accepted_ids() - set(audit_blocked())
    cohort = d.read_json(DOCS / 'resolved-cohort.json')
    by_material = {r['source']: d.job_id(r['instance']) for r in d.read_json(d.SOURCE / 'material-resolution.json')}
    implemented = [r['id'] for r in cohort['items'] if all(by_material[m] in accepted for m in r['materials'])]
    needed = {by_material[m] for r in cohort['items'] if r['id'] in implemented for m in r['materials']}
    if not implemented: raise ValueError('No fully validated candidate')
    helper.stage_runtime_meshes(set(cohort['meshes']))
    helper.stage_runtime_materials(needed)
    coverage = RUNTIME / 'coverage'
    coverage_ready = (coverage / 'derived-coverage.json').exists()
    if coverage_ready:
        derived = d.read_json(coverage / 'derived-coverage.json')
        mesh_sha = d.read_json(RUNTIME / 'meshes' / 'meshes.json')[0]['sha256']
        if [r['source'] for r in derived['records']] != cohort['meshes'] or derived['records'][0]['meshSha256'] != mesh_sha \
                or d.file_sha(coverage / derived['records'][0]['file']) != derived['records'][0]['sha256']:
            raise ValueError('Derived coverage does not belong to the staged source mesh')
    addition_file = RUNTIME / 'assets-additions.json'
    d.assembly_index.build([RUNTIME / 'meshes'], [RUNTIME / 'materials'], [d.SOURCE / 'working-01'],
                           d.LEGACY, addition_file, [coverage] if coverage_ready else [], None)
    additions = d.read_json(addition_file)
    if not coverage_ready:
        # Do not silently use an older legacy mask while deriving this source mesh.
        for entry in additions['meshes'].values():
            for key in ('bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource'): entry.pop(key, None)
        d.write(addition_file, additions)
    if set(additions['meshes']) != set(cohort['meshes']) or not all(isinstance(v, str) for v in additions['materials'].values()):
        raise ValueError('Additions are not exactly the staged mesh and URL-string material bindings')
    baseline = WORK / 'active-before'
    files = ['assets.json', 'skin-pairs.json', 'supported-items.json']
    active = {}
    frozen = d.read_json(DOCS / 'frozen-baseline.json')['hashes']
    for name in files:
        source = d.ACTIVE / name; destination = baseline / name
        if d.file_sha(source) != frozen[source.as_posix()]: raise ValueError('Active index differs from frozen-baseline.json: ' + name)
        if destination.exists() and d.file_sha(destination) != d.file_sha(source): raise ValueError('Active baseline changed: ' + name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists(): shutil.copyfile(source, destination)
        active[name] = d.read_json(source)
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
    advertised = set(supported['items'])
    if advertised & set(implemented): raise ValueError('Candidate already advertised')
    supported['items'].extend(implemented)
    supported['ready'].extend(new[i] for i in implemented)
    supported['exceptions'] = [r for r in supported['exceptions'] if r['id'] not in implemented]
    d.write(PREVIEW / 'supported-items.json', supported)
    missing = [r for r in helper.references(assets, pairs, supported) if not (PREVIEW / r).resolve().is_file()]
    if missing: raise ValueError('Missing preview dependency: ' + str(missing))
    unadvertised_ready = sorted(set(old) - advertised)
    d.write(PREVIEW / 'preview.json', {'marker': d.MARKER, 'at': d.now(), 'implemented': implemented,
             'coverageReady': coverage_ready, 'previousAdvertised': len(advertised), 'previewAdvertised': len(supported['items']),
             'previousAssemblies': len(old), 'previewAssemblies': len(new), 'unadvertisedStructurallyReady': unadvertised_ready,
             'activeUnchanged': True, 'visualAcceptance': 'pending', 'humanAcceptance': 'pending'})
    d.write(WORK / 'supported-items-additions.json', {'items': implemented, 'ready': [new[i] for i in implemented]})
    d.write(WORK / 'assets-additions.json', {field: added[field] for field in ('meshes', 'materials')})
    progress('preview-coverage' if coverage_ready else 'preview-structural', previewAvailable=True,
             preview=PREVIEW.as_posix(), previewUrlBase='/' + PREVIEW.relative_to('public').as_posix(),
             implemented=implemented, coverageReady=coverage_ready,
             counts={'advertisedBefore': len(advertised), 'advertisedPreview': len(supported['items']),
                     'structuralBefore': len(old), 'structuralPreview': len(new)},
             unadvertisedStructurallyReady=unadvertised_ready)
    print(f'Preview advertised {len(advertised)} -> {len(supported["items"])}; structural {len(old)} -> {len(new)}; '
          f'coverage ready: {coverage_ready}; unadvertised ready: {unadvertised_ready}', flush=True)


def derive_coverage():
    preview = d.read_json(PREVIEW / 'preview.json')
    if preview['coverageReady']: raise SystemExit('Coverage already derived; preserve it')
    target = RUNTIME / 'coverage'
    if target.exists() and any(target.iterdir()): raise SystemExit('Preserve existing coverage folder')
    log = WORK / 'coverage.log'
    with log.open('w', encoding='utf-8') as out:
        code = subprocess.call(['node', 'scripts/shader-probe/build-companion-masks.mjs', '--all', '--items', ','.join(preview['implemented']),
                                '--index', PREVIEW.as_posix(), '--output', target.as_posix()], stdout=out, stderr=subprocess.STDOUT)
    if code: raise SystemExit(f'Coverage derivation failed (exit {code}); see {log}')
    index()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['mesh', 'source', 'build', 'gpu', 'index', 'coverage']); args = p.parse_args()
    if args.stage == 'mesh': mesh()
    elif args.stage == 'source': d.stage_source(argparse.Namespace(fresh_sources=True))
    elif args.stage == 'build': build()
    elif args.stage == 'gpu':
        d.stage_gpu(argparse.Namespace())
        run = d.read_json(WORK / 'validation' / 'webgl-run.json')
        progress('gpu', gpu={k: run[k] for k in ('at', 'result', 'exitCode', 'materials', 'failed')})
    elif args.stage == 'index': index()
    else: derive_coverage()
