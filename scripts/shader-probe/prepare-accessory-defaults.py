"""Prepare a default-material accessory batch: choices whose slots keep the mesh's own material.

Run from the repository root with Python 3.12 (`py -3.12`):

  py -3.12 scripts/shader-probe/prepare-accessory-defaults.py source  --batch <batch.json>  # exact extraction
  py -3.12 scripts/shader-probe/prepare-accessory-defaults.py build   --batch <batch.json>  # compile, CPU, meshes
  py -3.12 scripts/shader-probe/prepare-accessory-defaults.py gpu     --batch <batch.json>  # check-webgl, dev server
  py -3.12 scripts/shader-probe/prepare-accessory-defaults.py index   --batch <batch.json>  # resolve, stage, preview
  py -3.12 scripts/shader-probe/prepare-accessory-defaults.py all     --batch <batch.json>

A batch file names a frozen cohort (source definitions with no MaterialOverrides) and the choice ids to
prepare. Every visible part's mesh supplies its slot defaults: from the active index when the mesh is
already preserved there, otherwise from a fresh exact extraction of that mesh. Each default material is
exported by exact package, its unexported parents are reused byte-for-byte from an earlier export of the
same game build (or extracted), disassembled and bound by validate.ps1, and its bound textures are reused
by exact object path and hash (or extracted). The ordinary M_CharacterAttachment surface contract of
build-materials.py decides what compiles: live opacity, emissive, other blend or shading models stay
rejected with their reason. prepare-accessories.py's CPU reference check and GPU contract apply unchanged.
Only the viewer's resolver decides which choices are complete; attachment frames come from the active
index and are not changed here. The active index, catalog and earlier folders are only read. The preview
index is additive: every active binding is rebased and preserved, the batch's bindings are added.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from material_inputs import material_inputs, parent_chain, read_json, texture_paths
import source_package_identity as package_identity

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
accessories = load('prepare-accessories')

CATALOG = Path('src/data/items.json')
SOURCE_INDEX = Path('public/models/reconstructed-assembly-v2')
ACTIVE = Path('public/models/reconstructed-assemblies-v1')
LEGACY = Path('scripts/asset-sources.generated.json')
PROBE = Path('scripts/generated/shader-probe/native-nails-source-v1/probe-bin/ShaderProbe.dll')
PAKS = r'C:\Program Files (x86)\Steam\steamapps\common\The Finals\Discovery\Content\Paks'
USMAP = Path('scripts/generated/shader-probe/tools/507_TheFinals_21_08_26.usmap')
OODLE = r'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll'
ROOT_NAME = 'M_CharacterAttachment'
MARKER = 'shader-probe/prepare-accessory-defaults'
OWNED = {'assets.json', 'skin-pairs.json', 'supported-items.json', 'preview.json'}

# Earlier raw exports of the same game build. A package found here is copied byte-for-byte instead of
# being extracted again; its build identity (mapping and container hashes) must equal the fresh run's.
REUSE_EXPORTS = [Path('scripts/generated/shader-probe/accessory-source-v1/exports'),
                 Path('scripts/generated/shader-probe/accessory-source-v1/opus-parents-01')]
REUSE_TEXTURES = [Path('scripts/generated/shader-probe/accessory-source-v1/opus-textures-01')]
# Source DTOs of the meshes already preserved in the active index, for slot evidence.
MESH_EVIDENCE = [Path('scripts/generated/shader-probe/accessory-source-v1/meshes-02')]

# Configured from the command line; module globals so the shared GPU-stage tests can drive them.
BATCH = WORK = SOURCE = RUNTIME = PREVIEW = None


def configure(batch, work, runtime, preview):
    global BATCH, WORK, SOURCE, RUNTIME, PREVIEW
    BATCH, WORK, RUNTIME, PREVIEW = Path(batch), Path(work), Path(runtime), Path(preview)
    SOURCE = WORK / 'source'


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def file_sha(path):
    return sha(Path(path).read_bytes())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def short(path):
    return (path or '').split('.')[-1]


def package_of(object_path):
    """'/Game/A/B/X.X' or '/Game/A/B/X.0' -> 'Discovery/Content/A/B/X.uasset'."""
    return 'Discovery/Content/' + object_path.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


def job_id(instance):
    return instance.lower().replace('_', '-')


# ---------------------------------------------------------------------------------------------- source

def extract(mode, folder, requests):
    """The accepted read-only probe call: exact requests, a fresh folder, the log kept in a file only.

    FModel settings are passed by path and never read, printed or copied here.
    """
    target = SOURCE / folder
    if target.exists() and any(target.iterdir()): raise RuntimeError(f'Preserve existing extraction {target}')
    exact = (lambda r: r.startswith('/Game/') and '.' in r.split('/')[-1]) if mode == 'textures' else \
        (lambda r: r.startswith('Discovery/Content/') and r.endswith('.uasset'))
    if not requests or len(set(requests)) != len(requests) or not all(exact(r) for r in requests):
        raise SystemExit('Requests must be unique exact paths for this mode')
    request_file = SOURCE / f'{folder}.requests.json'
    if request_file.is_file() and read_json(request_file) != requests: raise SystemExit(f'{folder} request set changed; use a new folder')
    write(request_file, requests)
    target.mkdir(parents=True, exist_ok=True)
    cmd = ['dotnet', str(PROBE.resolve()), mode, PAKS, str(USMAP.resolve()), OODLE, str(target.resolve()),
           str(request_file.resolve()), str(Path(os.environ['APPDATA']) / 'FModel/AppSettings.json')]
    start = time.time()
    with (SOURCE / f'{folder}.log').open('wb') as log:
        code = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT).returncode
    record = {'at': now(), 'mode': mode, 'folder': folder, 'requests': request_file.name, 'requestCount': len(requests),
              'exitCode': code, 'seconds': round(time.time() - start, 3)}
    write(SOURCE / f'{folder}.run.json', record)
    print(json.dumps(record), flush=True)
    if code: raise SystemExit(f'{folder} extraction failed; see {folder}.log')


def build_identity(folder):
    run = read_json(folder / 'source-run.json')
    return {'mapping': run['mappingSha256'], 'containers': sorted([c['name'], c['sha256']] for c in run['sourceContainers'])}


def load_batch():
    batch = read_json(BATCH)
    ids = batch['ids']
    if not ids or len(set(ids)) != len(ids): raise ValueError('A batch names unique choice ids')
    cohort = {row['id']: row for row in read_json(Path(batch['cohort']))['items']}
    missing = [i for i in ids if i not in cohort]
    if missing: raise ValueError(f'Batch ids outside the frozen cohort: {missing}')
    return batch, [cohort[i] for i in ids]


def glb_slots(path):
    data = Path(path).read_bytes()
    size = int.from_bytes(data[12:16], 'little')
    return [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
            for m in json.loads(data[20:20 + size])['materials']]


def dto_slots(folder, record):
    dto = read_json(folder / record['meshFile'])
    natives = dto.get('sourceMaterials') or []
    if len(natives) != len(dto['materials']): raise ValueError(f'Mesh DTO slots are incomplete: {record["path"]}')
    return [{'slot': n['MaterialSlotName'], 'material': m['path']} for n, m in zip(natives, dto['materials'])]


def mesh_records(folders):
    out = {}
    for folder in folders:
        if not (folder / 'assets.json').is_file(): continue
        for record in read_json(folder / 'assets.json'):
            if 'error' in record: continue
            out.setdefault(assembly_index.object_path(record['path']), (folder, record))
    return out


def plan():
    """Every visible part, its mesh and slot defaults; definitions re-checked against the frozen cohort."""
    batch, rows = load_batch()
    catalog = {item['id']: item for item in read_json(CATALOG)}
    active = read_json(ACTIVE / 'assets.json')
    evidence = mesh_records(MESH_EVIDENCE)
    fresh = mesh_records([SOURCE / 'meshes-01'])
    items, missing_meshes = [], set()
    for row in rows:
        definition = read_json(SOURCE_INDEX / 'items' / f'{row["id"]}.json')
        if definition != row['definition'] or definition['sourceSha256'] != row['definitionSha256'] or \
                catalog[row['id']]['slot'] != row['slot']:
            raise ValueError(f'Definition or catalog slot changed since the cohort was frozen: {row["id"]}')
        if definition['properties'].get('MaterialOverrides') or row['resolved'].get('materialParameters'):
            raise ValueError(f'Not a default-material choice: {row["id"]}')
        parts = []
        for part in row['resolved']['parts']:
            if part['hidden']: continue
            if part['materials']: raise ValueError(f'{row["id"]} part {part["sourceIndex"]} carries explicit materials')
            mesh = part['staticMesh'] or part['skeletalMesh']
            d = part['definition']
            entry = {'sourceIndex': part['sourceIndex'], 'mesh': mesh, 'socket': d.get('AttachmentSocket'),
                     'attachToHeadMesh': bool(d.get('bAttachToHeadMesh')),
                     'optionalAttachmentMesh': d.get('OptionalAttachmentMesh', {}).get('AssetPathName') or None,
                     'effect': part['effect'] or None, 'unresolved': part['unresolved']}
            if not mesh:
                entry['slots'], entry['meshOrigin'] = [], 'no mesh'
            elif mesh in active['meshes']:
                binding = active['meshes'][mesh]
                glb = (ACTIVE / binding['url']).resolve()
                if file_sha(glb) != binding['sha256'] or glb_slots(glb) != binding['slots']:
                    raise ValueError(f'Active mesh binding differs from its preserved GLB: {mesh}')
                entry.update({'meshOrigin': 'active', 'url': binding['url'], 'glbSha256': binding['sha256'], 'slots': binding['slots']})
                if mesh in evidence:
                    folder, record = evidence[mesh]
                    if dto_slots(folder, record) != binding['slots']:
                        raise ValueError(f'Active slot defaults differ from the source mesh DTO: {mesh}')
                    entry['sourcePackage'] = {'path': record['path'], 'sha256': record['sha256'].lower(),
                                              'dto': (folder / record['meshFile']).as_posix()}
            elif mesh in fresh:
                folder, record = fresh[mesh]
                entry.update({'meshOrigin': 'extracted', 'slots': dto_slots(folder, record),
                              'sourcePackage': {'path': record['path'], 'sha256': record['sha256'].lower(),
                                                'dto': (folder / record['meshFile']).as_posix()}})
            else:
                entry.update({'meshOrigin': 'missing', 'slots': None})
                missing_meshes.add(mesh)
            parts.append(entry)
        items.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                      'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                      'parameterBlockers': accessories.parameter_blockers(
                          row, {s['slot'] for p in parts for s in (p['slots'] or [])}),
                      'parts': parts})
    return batch, items, sorted(missing_meshes)


def default_materials(items):
    return sorted({s['material'] for item in items for part in item['parts'] for s in (part['slots'] or [])})


def raw_files(folder, name):
    """A package's raw probe outputs: its property export, package, uniforms and extracted shaders."""
    files = [p.name for p in folder.iterdir() if p.is_file() and p.name.startswith(name + '.')]
    shaders = [e for e in read_json(folder / 'shader-extraction.json') if e['Name'] == name]
    return sorted(files) + [f'shaders/{e["file"]}' for e in shaders], shaders


def exported_packages(folder):
    return {r['path']: r for r in read_json(folder / 'probe-summary.json')['results']}


def exported_inventory(folder):
    """Every exported package path of a probe summary, duplicates and case variants included."""
    return [r['path'] for r in read_json(folder / 'probe-summary.json')['results']]


def case_evidence(member):
    """A chain member's directory-case resolutions; nothing for an exact member, so exact rows stay unchanged."""
    evidence = {}
    if member['match'] != package_identity.EXACT:
        evidence['exported'] = {'object': member['exportedObject'], 'match': member['match']}
    if member['parent'] and member['parent']['match'] != package_identity.EXACT:
        evidence['parentLink'] = member['parent']
    return evidence


def stage_source(args):
    global REUSE_EXPORTS, REUSE_TEXTURES
    if getattr(args, 'fresh_sources', False):
        REUSE_EXPORTS, REUSE_TEXTURES = [], []
    SOURCE.mkdir(parents=True, exist_ok=True)
    # 1. Meshes the active index does not preserve, extracted by exact package.
    batch, items, missing = plan()
    if missing and not (SOURCE / 'meshes-01' / 'assets.json').is_file():
        extract('assets', 'meshes-01', [package_of(m) for m in missing])
        batch, items, missing = plan()
    if missing: raise SystemExit(f'Meshes still missing after extraction: {missing}')
    extracted = read_json(SOURCE / 'meshes-01' / 'assets.json') if (SOURCE / 'meshes-01' / 'assets.json').is_file() else []
    if any('error' in r for r in extracted): raise SystemExit('Mesh extraction reported an error')

    # 2. Default materials by exact package, unless an earlier export of the same build holds them.
    wanted = [package_of(m) for m in default_materials(items)]
    reusable = {path: folder for folder in REUSE_EXPORTS for path in exported_packages(folder)}
    fresh = [p for p in wanted if p not in reusable]
    if fresh and not (SOURCE / 'materials-01' / 'probe-summary.json').is_file():
        extract('shaders', 'materials-01', fresh)
    folders = [SOURCE / 'materials-01'] if fresh else []
    identity = build_identity(folders[0]) if folders else build_identity(REUSE_EXPORTS[0])

    # 3. Close every parent chain: reuse exact parents from earlier exports, extract any other.
    def packages_now():
        found = {}
        for folder in folders:
            found.update({path: folder for path in exported_packages(folder)})
        return found
    reuse = {p: reusable[p] for p in wanted if p not in fresh}
    for _ in range(8):
        present = {**{p: f for p, f in reuse.items()}, **packages_now()}
        parents = set()
        for path, folder in present.items():
            record = exported_packages(folder)[path]
            if record.get('parent'): parents.add(package_of(record['parent']))
        absent = sorted(parents - set(present))
        if not absent: break
        for path in absent:
            if path in reusable: reuse[path] = reusable[path]
        still = [p for p in absent if p not in reusable]
        if still:
            name = f'parents-{len([f for f in folders if f.name.startswith("parents-")]) + 1:02d}'
            if not (SOURCE / name / 'probe-summary.json').is_file(): extract('shaders', name, still)
            folders.append(SOURCE / name)
    else:
        raise SystemExit('Parent chains did not close')
    for folder in {*reuse.values(), *folders}:
        if build_identity(folder) != identity:
            raise SystemExit(f'{folder} comes from a different game build or mapping than this extraction')

    # 4. Working export: fresh exports plus reused packages, every copied byte hash-checked.
    working = SOURCE / 'working-01'
    files, results, extraction, origins = {}, [], [], {}
    for folder in folders:
        for path in sorted(p for p in folder.rglob('*') if p.is_file()):
            rel = path.relative_to(folder).as_posix()
            if rel in ('probe-summary.json', 'shader-extraction.json', 'source-run.json'): continue
            if rel in files and files[rel]['sha256'] != file_sha(path): raise SystemExit(f'Colliding file: {rel}')
            files.setdefault(rel, {'from': folder.as_posix(), 'sha256': file_sha(path)})
        results += exported_packages(folder).values()
        extraction += read_json(folder / 'shader-extraction.json')
    for path, folder in sorted(reuse.items()):
        record = exported_packages(folder)[path]
        names, shaders = raw_files(folder, record['name'])
        for rel in names:
            if rel in files and files[rel]['sha256'] != file_sha(folder / rel): raise SystemExit(f'Colliding file: {rel}')
            files.setdefault(rel, {'from': folder.as_posix(), 'sha256': file_sha(folder / rel)})
        results.append(record); extraction += shaders
        origins[path] = {'folder': folder.as_posix(), 'uassetSha256': file_sha(folder / f'{record["name"]}.uasset')}
    by_name = {}
    for record in results:
        if by_name.setdefault(record['name'], record['path']) != record['path']: raise SystemExit(f'Basename names two packages: {record["name"]}')
    manifest = {'formatVersion': 1, 'marker': MARKER + '/working', 'buildIdentity': identity,
                'folders': [f.as_posix() for f in folders], 'reused': origins,
                'files': dict(sorted((rel, e['sha256']) for rel, e in files.items())),
                'origins': dict(sorted((rel, e['from']) for rel, e in files.items()))}
    if working.exists() and any(working.iterdir()):
        previous = read_json(working / 'working-export.json')
        if {k: previous.get(k) for k in manifest} != manifest: raise SystemExit('Working export differs from its sources; use a new folder')
        changed = [rel for rel, digest in manifest['files'].items() if file_sha(working / rel) != digest]
        if changed: raise SystemExit(f'Working export files changed: {changed[:5]}')
    else:
        (working / 'shaders').mkdir(parents=True)
        for rel, entry in files.items():
            shutil.copyfile(Path(entry['from']) / rel, working / rel)
            if file_sha(working / rel) != entry['sha256']: raise SystemExit(f'Copy changed bytes: {rel}')
        base = read_json((folders[0] if folders else REUSE_EXPORTS[0]) / 'probe-summary.json')
        write(working / 'probe-summary.json', {**base, 'results': results, 'requestedShaders': len(extraction),
                                               'extractedShaders': len(extraction), 'mergedFrom': manifest['folders'],
                                               'reusedPackages': sorted(origins)})
        write(working / 'shader-extraction.json', extraction)
        write(working / 'working-export.json', {**manifest, 'at': now()})
    if not (working / 'validation.json').is_file():
        with (SOURCE / 'working-01.validate.log').open('wb') as log:
            code = subprocess.call(['pwsh', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(HERE / 'validate.ps1'),
                                    '-Exports', str(working), '-Python', sys.executable], stdout=log, stderr=subprocess.STDOUT)
        if code: raise SystemExit('validate.ps1 failed; see working-01.validate.log')

    # 5. Every default material resolved through its exported chain; bound textures reused or extracted.
    # Identities are checked against every exported package, never a basename dictionary; only a unique
    # directory-case variant is accepted besides the exact path, and it is recorded with its actual package.
    inventory = exported_inventory(working)
    resolution = []
    for source in default_materials(items):
        name = short(source)
        row = {'source': source, 'instance': name}
        try:
            found = package_identity.resolve(source, inventory)
            chain = parent_chain(working, name)
            try:
                members = package_identity.chain_identity(chain, inventory)
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(f'Chain member does not match its exported package: {error}')
            if chain[-1]['Name'] != name or members[-1]['package'] != found['package']:
                raise ValueError(f'Chain member {chain[-1]["Name"]} does not match its exported package')
            if found['match'] != package_identity.EXACT:
                row['sourcePackage'] = {'match': found['match'], 'requested': {'object': source, 'package': package_of(source)},
                                        'actual': {'object': found['object'], 'package': found['package'],
                                                   'uassetSha256': file_sha(working / f'{name}.uasset')}}
            row['chain'] = [{'object': m['object'], 'package': m['package'],
                             'uassetSha256': file_sha(working / f'{r["Name"]}.uasset'),
                             **case_evidence(m)} for r, m in zip(chain, members)]
            row['root'] = chain[0]['Name']
            (_, _, owner, _), = material_inputs(working, [{'id': job_id(name), 'instance': name}])
            row['owner'] = owner
            bindings = read_json(working / 'bindings' / f'{owner}.SP_PCD3D_SM5.basepass-pixel.bindings.json')
            row['textures'] = [{'slot': slot, 'path': path} for slot, path in texture_paths(chain, bindings)]
        except Exception as error:
            row['error'] = str(error)
        resolution.append(row)
    write(SOURCE / 'material-resolution.json', resolution)

    wanted_textures = sorted({t['path'] for row in resolution for t in row.get('textures', [])})
    reusable_textures = {}
    for folder in REUSE_TEXTURES:
        for record in read_json(folder / 'textures.json'):
            reusable_textures.setdefault(record['path'], (folder, record))
    fresh_textures = [p for p in wanted_textures if p not in reusable_textures]
    if fresh_textures and not (SOURCE / 'textures-extract-01' / 'textures.json').is_file():
        extract('textures', 'textures-extract-01', fresh_textures)
    sources = dict(reusable_textures)
    if fresh_textures:
        for record in read_json(SOURCE / 'textures-extract-01' / 'textures.json'):
            sources[record['path']] = (SOURCE / 'textures-extract-01', record)
    textures = SOURCE / 'textures-01'
    records, texture_origins = [], {}
    for path in wanted_textures:
        folder, record = sources[path]
        for mip in record['mips']:
            if file_sha(folder / mip['file']).upper() != mip['sha256']: raise SystemExit(f'Texture mip hash mismatch: {mip["file"]}')
        records.append(record); texture_origins[path] = folder.as_posix()
    if (textures / 'textures.json').is_file():
        if read_json(textures / 'textures.json') != records: raise SystemExit('Texture set changed; use a new texture folder')
        for record in records:
            for mip in record['mips']:
                if file_sha(textures / mip['file']).upper() != mip['sha256']: raise SystemExit(f'Texture changed: {mip["file"]}')
    else:
        textures.mkdir(parents=True, exist_ok=True)
        for record in records:
            folder = Path(texture_origins[record['path']])
            for mip in record['mips']:
                if (textures / mip['file']).exists(): raise SystemExit(f'Colliding texture payload: {mip["file"]}')
                shutil.copyfile(folder / mip['file'], textures / mip['file'])
        write(textures / 'textures.json', records)
        write(textures / 'origins.json', texture_origins)

    write(WORK / 'source-ready.json', {
        'at': now(), 'marker': MARKER + '/source', 'batch': BATCH.as_posix(), 'buildIdentity': identity,
        'plan': items, 'defaultMaterials': default_materials(items), 'freshMaterialPackages': fresh,
        'reusedPackages': origins, 'freshTextures': fresh_textures,
        'reusedTextures': sorted(p for p in wanted_textures if p not in fresh_textures),
        'inputs': {p.as_posix(): file_sha(p) for p in [BATCH, Path(batch['cohort']), CATALOG, ACTIVE / 'assets.json',
                   working / 'working-export.json', working / 'validation.json', SOURCE / 'material-resolution.json',
                   textures / 'textures.json', *([SOURCE / 'meshes-01' / 'assets.json'] if extracted else [])]}})
    errors = [row for row in resolution if 'error' in row]
    print(f'Source: {len(items)} choices, {len(default_materials(items))} default materials ({len(fresh)} extracted, '
          f'{len(wanted) - len(fresh)} reused), {len(origins)} reused packages, {len(extracted)} meshes extracted, '
          f'{len(wanted_textures)} textures ({len(fresh_textures)} extracted); unresolved: {[r["instance"] for r in errors]}')


def ready_source():
    ready = read_json(WORK / 'source-ready.json')
    for name, digest in ready['inputs'].items():
        if file_sha(name) != digest: raise SystemExit(f'Source input changed since the source stage: {name}')
    _, items, missing = plan()
    if items != ready['plan'] or missing: raise SystemExit('The batch plan changed since the source stage; rerun source')
    return ready


def shared_helpers():
    # These existing helpers write only within their configured batch directories.
    accessories.WORK, accessories.RUNTIME, accessories.PREVIEW = WORK, RUNTIME, PREVIEW
    accessories.MARKER = MARKER
    accessories.ACTIVE, accessories.CATALOG, accessories.SOURCE_INDEX = ACTIVE, CATALOG, SOURCE_INDEX
    accessories.RESOLVER = globals().get('RESOLVER', Path('src/rig/SourceAssembly.ts'))
    return accessories


def stage_build(args):
    ready_source()
    helper = shared_helpers()
    resolution = {row['source']: row for row in read_json(SOURCE / 'material-resolution.json')}
    requests = {s: {'id': job_id(short(s)), 'instance': short(s)} for s in resolution}
    jobs, foreign = helper.material_jobs(SOURCE / 'working-01', resolution, requests)
    write(WORK / 'requests.json', jobs)
    write(WORK / 'foreign-materials.json', foreign)
    materials_builder.build(SOURCE / 'working-01', SOURCE / 'textures-01', RUNTIME / 'staging', jobs, keep_going=True)
    helper.cpu_check(SOURCE / 'working-01', RUNTIME / 'staging', jobs)
    if (SOURCE / 'meshes-01' / 'assets.json').exists():
        helper.build_meshes({'meshes': SOURCE / 'meshes-01'})
    else:
        write(WORK / 'meshes' / 'meshes.json', [])
        write(WORK / 'mesh-verification.json', [])


def stage_gpu(args):
    ready_source()
    args.material_base = '/' + (RUNTIME / 'staging').relative_to('public').as_posix()
    shared_helpers().stage_gpu(args)


def stage_index(args):
    ready = ready_source()
    helper = shared_helpers()
    accepted = helper.accepted_ids()
    jobs = {j['id']: j for j in read_json(WORK / 'requests.json')}
    rows = ready['plan']
    cohort = {r['id'] for r in rows}
    active = {f: read_json(ACTIVE / f) for f in ('assets.json', 'supported-items.json', 'skin-pairs.json')}
    # Both index directories are siblings. All inherited URLs must resolve identically,
    # including head/optional attachment frames; do not rebuild or omit unknown fields.
    for name, document in active.items():
        if preview_tools.resolved_shape(document, ACTIVE) != preview_tools.resolved_shape(document, PREVIEW):
            raise ValueError(f'Inherited {name} needs explicit rebasing')
    candidate = copy.deepcopy(active['assets.json'])
    verified_meshes = {}
    for e in read_json(WORK / 'meshes' / 'meshes.json'):
        key = assembly_index.object_path(e['source'])
        if key in candidate['meshes']: raise ValueError(f'Would replace existing mesh {key}')
        f = WORK / 'meshes' / e['file']
        if file_sha(f) != e['sha256']: raise ValueError(f'Converted mesh changed: {f}')
        candidate['meshes'][key] = {'url': f'candidate/{e["file"]}', 'sha256': e['sha256'],
                                  'slots': glb_slots(f), 'kind': 'skeletal' if e['bones'] else 'static'}
        verified_meshes[key] = e
    for s in ready['defaultMaterials']:
        j = job_id(short(s))
        if j not in accepted: continue
        if s in candidate['materials']: raise ValueError(f'Would replace existing material {s}')
        candidate['materials'][s] = f'candidate/{j}.json'
    write(WORK / 'resolver' / 'candidate-assets.json', candidate)
    probe = helper.resolve_items(WORK / 'resolver' / 'candidate-assets.json', WORK / 'resolver' / 'candidate.json')
    candidate_ready = {r['id']: r for r in probe['ready']}
    gated = {r['id'] for r in rows if r['parameterBlockers']}
    implemented = [r['id'] for r in rows if r['id'] in candidate_ready and r['id'] not in gated]
    needed_sources = {b['source'] for i in implemented for p in candidate_ready[i]['parts'] for b in p['materials'].values()}
    needed_ids = {job_id(short(s)) for s in needed_sources}
    if not needed_ids <= accepted: raise ValueError('Candidate uses an unvalidated material')
    needed_meshes = {p['sourceMesh'] for i in implemented for p in candidate_ready[i]['parts']} - set(active['assets.json']['meshes'])
    helper.stage_runtime_meshes(needed_meshes)
    helper.stage_runtime_materials(needed_ids)
    added_file = RUNTIME / 'defaults-assets.json'
    assembly_index.build([RUNTIME / 'meshes'], [RUNTIME / 'materials'], [SOURCE / 'working-01'], LEGACY, added_file, [], None)
    added = preview_tools.rebase_assets(read_json(added_file), preview_tools.Rebaser(RUNTIME, PREVIEW))
    # build-assembly-assets keys a material by its exported package. Meshes name the requested source, so a
    # directory-case resolution recorded by the source stage (re-checked here) is bound by that source.
    added['materials'] = package_identity.requested_keys(added['materials'], read_json(SOURCE / 'material-resolution.json'),
                                                 exported_inventory(SOURCE / 'working-01'))
    if set(added['meshes']) != needed_meshes or set(added['materials']) != needed_sources:
        raise ValueError('Staged dependencies do not match the complete candidates')
    helper.guard_preview()
    assets = copy.deepcopy(active['assets.json'])
    for field in ('meshes', 'materials'):
        if set(added[field]) & set(assets[field]): raise ValueError(f'Conflicting {field}')
        assets[field].update(added[field])
    write(PREVIEW / 'assets.json', assets)
    write(PREVIEW / 'skin-pairs.json', active['skin-pairs.json'])
    before = helper.resolve_items(ACTIVE / 'assets.json', WORK / 'resolver' / 'active.json')
    after = helper.resolve_items(PREVIEW / 'assets.json', WORK / 'resolver' / 'preview.json')
    old = {e['id']: e for e in before['ready']}
    new = {e['id']: e for e in after['ready']}
    if set(old) != set(new) - cohort or set(old) & cohort:
        raise ValueError('The batch changed readiness outside its declared cohort')
    for i, e in old.items():
        if preview_tools.resolved_shape(e, ACTIVE) != preview_tools.resolved_shape(new[i], PREVIEW):
            raise ValueError(f'Existing source assembly changed: {i}')
    if set(new) & cohort != set(implemented): raise ValueError('Preview differs from candidate readiness')
    failures = {e['id']: e['reason'] for e in after['exceptions']}
    build_errors = {e['itemId']: e['error'] for e in read_json(RUNTIME / 'staging' / 'build-errors.json')}
    foreign = read_json(WORK / 'foreign-materials.json')
    report_rows = []
    for row in rows:
        reasons = list(row['parameterBlockers'])
        if row['id'] not in implemented:
            reasons.append(failures.get(row['id'], 'Candidate not complete'))
            for part in row['parts']:
                for slot in part['slots']:
                    j = job_id(short(slot['material']))
                    if j not in accepted: reasons.append(build_errors.get(j) or foreign.get(j) or f'{j}: CPU/GPU check did not pass')
        report_rows.append({**row, 'status': 'implemented' if row['id'] in implemented else 'deferred',
                            'blockers': sorted(set(reasons)), 'runtime': new.get(row['id'])})
    supported = copy.deepcopy(active['supported-items.json'])
    supported['items'].extend(implemented)
    supported['ready'].extend(new[i] for i in implemented)
    supported['exceptions'] = [e for e in supported['exceptions'] if e['id'] not in implemented]
    write(PREVIEW / 'supported-items.json', supported)
    absent = [url for url in helper.references(assets, active['skin-pairs.json'], supported) if not (PREVIEW / url).resolve().is_file()]
    if absent: raise ValueError(f'Missing runtime dependency: {absent}')
    summary = {'formatVersion': 1, 'marker': MARKER, 'at': now(), 'implemented': implemented,
               'deferred': {e['id']: e['blockers'] for e in report_rows if e['status'] == 'deferred'},
               'counts': {'candidates': len(rows), 'implemented': len(implemented), 'addedMeshes': len(needed_meshes),
                          'addedMaterials': len(needed_sources), 'supportedItems': len(supported['items'])},
               'meaning': 'Additive Medium preview; visual and human acceptance remain separate.',
               'inputs': {str(ACTIVE / f): file_sha(ACTIVE / f) for f in active}}
    write(PREVIEW / 'preview.json', summary)
    write(WORK / 'cohort-report.json', {'items': report_rows})
    activation = WORK / 'activation-candidate'
    write(activation / 'assets-additions.json', {field: added[field] for field in ('meshes','materials')})
    write(activation / 'supported-items-additions.json', {'items': implemented, 'ready': [new[i] for i in implemented]})
    write(activation / 'candidate.json', {**summary, 'target': ACTIVE.as_posix(), 'preview': PREVIEW.as_posix(),
          'runtimeFiles': {f.as_posix(): file_sha(f) for directory in ['meshes', 'materials'] for f in (RUNTIME / directory).iterdir() if f.is_file()}})
    print(json.dumps(summary['counts']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('stage', choices=['source', 'build', 'gpu', 'index', 'all'])
    parser.add_argument('--batch', required=True)
    parser.add_argument('--work', default='scripts/generated/shader-probe/accessory-defaults-v1')
    parser.add_argument('--runtime', default='public/models/reconstructed-accessory-defaults-v1')
    parser.add_argument('--preview', default='public/models/reconstructed-accessory-defaults-preview-v1')
    parser.add_argument('--fresh-sources', action='store_true', help='Extract all materials, parents and textures after a game update')
    args = parser.parse_args()
    configure(args.batch, args.work, args.runtime, args.preview)
    for name, run in [('source',stage_source),('build',stage_build),('gpu',stage_gpu),('index',stage_index)]:
        if args.stage in (name, 'all'): run(args)
