"""Prepare the source attachment-frame preview: head-component sockets and optional attachment meshes.

Run from the repository root with Python 3.10+ (here, the `py` launcher):

  py scripts/shader-probe/prepare-accessory-frames.py frames  # derive and verify the socket rest frames
  py scripts/shader-probe/prepare-accessory-frames.py index   # resolve, stage the supported subset, write the preview
  py scripts/shader-probe/prepare-accessory-frames.py all

The previous ordinary-accessory batch converted and verified every candidate mesh and compiled,
CPU/GPU-checked every M_CharacterAttachment slot material, then deferred these eleven choices
purely on placement: seven earrings carry `bAttachToHeadMesh` with a head socket, and four carry
`OptionalAttachmentMesh` SK_MeshMerge_LumbarJiggle with the socket `lumbar_attachment_jj`. Nothing
is re-extracted or recompiled here: this stage adds the missing rest frames, taken from the source
skeleton's own socket definitions and the optional mesh's own reference skeleton, and lets the
viewer's resolver decide which choices are complete. Rest placement and rigid body/head following
are reconstructed; jiggle-joint secondary motion is not simulated.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import shutil
import struct
from pathlib import Path

import numpy as np

from material_inputs import material_inputs, read_json

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


meshes_builder = load('build-meshes')
assembly_index = load('build-assembly-assets')
stager = load('stage-validated-materials')
preview_tools = load('prepare-coverage-preview')
accessories = load('prepare-accessories')

CATALOG = Path('src/data/items.json')
ACTIVE = Path('public/models/reconstructed-assemblies-v1')
RUNTIME = Path('public/models/reconstructed-accessory-frames-v1')
PREVIEW = Path('public/models/reconstructed-accessory-frames-preview-v1')
WORK = Path('scripts/generated/shader-probe/accessory-frames-opus-v1')
SOURCE = Path('scripts/generated/shader-probe/accessory-frames-source-v1')
PRIOR = Path('scripts/generated/shader-probe/accessory-opus-v1')
PRIOR_RUNTIME = Path('public/models/reconstructed-accessories-v1')
MESHES_V2 = Path('scripts/generated/shader-probe/meshes-v2')
LEGACY = Path('scripts/asset-sources.generated.json')
MARKER = 'shader-probe/prepare-accessory-frames'
OWNED = {'assets.json', 'skin-pairs.json', 'supported-items.json', 'preview.json'}

# The eleven choices the ordinary accessory batch deferred on placement alone.
COHORT = ['attachment-boombox-01-finals-lumbar', 'attachment-boombox-01-pink-lumbar',
          'attachments-oilbarrel-01-lumbar', 'bodycosmetics-earrings-chain-01-gold',
          'bodycosmetics-earrings-elfearring', 'bodycosmetics-earrings-elfearring-blue',
          'bodycosmetics-earrings-eventtgm25', 'bodycosmetics-earrings-gem-01',
          'bodycosmetics-earrings-logofinals-01-gold', 'bodycosmetics-earrings-skull-01-greenemissive',
          'fromtencent-asianspirithorn-silverblue']

# Bone rests come from the preserved GLB skins; a shared name must be the same rest, or the
# component cannot ride the body driver. 1e-5 m is two orders above the largest observed
# difference between the head/optional reference skeletons and the body (2.1e-7 m).
REST_TOLERANCE = 1e-5


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def file_sha(path):
    return sha(Path(path).read_bytes())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def glb_document(path):
    data = Path(path).read_bytes()
    size, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A: raise ValueError(f'Missing GLB JSON chunk: {path}')
    return data, size, json.loads(data[20:20 + size])


def glb_rest_bones(path):
    """Component-space rest of every joint, exactly as build-assembly-assets reads the body's."""
    data, size, gltf = glb_document(path)
    if len(gltf.get('skins', [])) != 1: raise ValueError(f'Expected one skeleton: {path}')
    skin = gltf['skins'][0]
    accessor = gltf['accessors'][skin['inverseBindMatrices']]
    view = gltf['bufferViews'][accessor['bufferView']]
    if accessor['componentType'] != 5126 or accessor['type'] != 'MAT4' or view.get('byteStride', 64) != 64:
        raise ValueError('Unsupported bind matrix layout')
    offset = 28 + size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    matrices = np.frombuffer(data, dtype='<f4', count=16 * accessor['count'], offset=offset).reshape(-1, 4, 4).transpose(0, 2, 1)
    frames = {gltf['nodes'][joint]['name']: np.linalg.inv(matrix.astype(float))
              for joint, matrix in zip(skin['joints'], matrices, strict=True)}
    if len(frames) != len(skin['joints']): raise ValueError(f'Repeated reference bone name: {path}')
    return frames


def rotator_quaternion(pitch, yaw, roll):
    """FRotator::Quaternion(), the conversion the runtime's attachment local transform also uses."""
    p, y, r = (np.radians([pitch, yaw, roll]) / 2)
    sp, cp, sy, cy, sr, cr = np.sin(p), np.cos(p), np.sin(y), np.cos(y), np.sin(r), np.cos(r)
    return [cr * sp * sy - sr * cp * cy, -cr * sp * cy - sr * cp * sy,
            cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]


def converted_transform(translation, rotation, scale):
    """One source FTransform in the converted (X, Z, Y) * 0.01 axes of every preserved GLB."""
    _, matrix = meshes_builder.transform({'name': '', 'translation': translation, 'rotation': rotation, 'scale': scale})
    return matrix


def converted_scale(scale):
    return [float(scale[0]), float(scale[2]), float(scale[1])]


def rigid(matrix):
    """A rest frame with its own diagonal removed must be a rotation and a translation."""
    linear = matrix[:3, :3]
    scale = np.linalg.norm(linear, axis=0)
    if np.any(scale < 1e-9): return False
    return bool(np.allclose(linear.T @ linear, np.diag(scale ** 2), atol=1e-5))


def socket_entry(parent_rest, bone, local, scale):
    rest = parent_rest @ local
    frame = rest @ np.diag([1 / scale[0], 1 / scale[1], 1 / scale[2], 1.0])
    if not rigid(frame) or abs(np.linalg.det(frame[:3, :3]) - 1) > 1e-4:
        raise ValueError(f'Socket rest on {bone} does not factor into a rigid frame and one diagonal')
    if not np.isfinite(rest).all() or not np.isfinite(parent_rest).all():
        raise ValueError(f'Nonfinite socket rest on {bone}')
    return {'bone': bone, 'parentRest': parent_rest.T.flatten().tolist(), 'rest': rest.T.flatten().tolist(),
            'restScale': [float(v) for v in scale]}


def head_component_frames():
    """Sockets the head skeleton itself defines, anchored on that head's own converted bone rests."""
    pairs = read_json(ACTIVE / 'skin-pairs.json')
    extraction = {r['path']: r for r in read_json(SOURCE / 'skeletons-01' / 'assets.json')}
    packages = {r['request']: r for r in read_json(MESHES_V2 / 'assets.json')}
    out, evidence = {}, []
    for item_id, pair in sorted(pairs['items'].items()):
        source = pair['head']['sourceMesh']
        name = source.split('.')[-1]
        glb = (ACTIVE / pair['head']['url']).resolve()
        skeleton_path = f'{source.rsplit(".", 1)[0].removeprefix("/Game/")}_Skeleton'
        skeleton_package = f'Discovery/Content/{skeleton_path}.uasset'
        record = extraction.get(skeleton_package)
        if not record or 'error' in record:
            raise ValueError(f'No extracted skeleton for the active head {source}; extract {skeleton_package}')
        properties = read_json(SOURCE / 'skeletons-01' / record['propertiesFile'])
        rests = glb_rest_bones(glb)
        sockets, skipped = {}, []
        for export in properties:
            if export['type'] != 'SkeletalMeshSocket': continue
            p = export['properties']
            bone, socket = p.get('BoneName'), p.get('SocketName')
            if not bone or not socket: raise ValueError(f'Unnamed socket on {skeleton_package}')
            if bone not in rests:
                skipped.append({'socket': socket, 'bone': bone, 'reason': 'bone is not in the preserved head skin'})
                continue
            if socket in sockets: raise ValueError(f'Repeated socket {socket} on {skeleton_package}')
            location = [p.get('RelativeLocation', {}).get(k, 0.0) for k in 'XYZ']
            rotation = [p.get('RelativeRotation', {}).get(k, 0.0) for k in ('Pitch', 'Yaw', 'Roll')]
            scale = [p.get('RelativeScale', {}).get(k, 1.0) for k in 'XYZ']
            if not all(np.isfinite([*location, *rotation, *scale])) or any(v == 0 for v in scale):
                raise ValueError(f'Unsupported socket transform {socket} on {skeleton_package}')
            local = converted_transform(location, rotator_quaternion(*rotation), scale)
            sockets[socket] = socket_entry(rests[bone], bone, local, converted_scale(scale))
        if not sockets: raise ValueError(f'No usable sockets on {skeleton_package}')
        out[source] = {
            'sourceSha256': packages[name]['sha256'].lower(),
            'socketSource': record['path'], 'socketSha256': record['sha256'].lower(),
            'meshUrl': pair['head']['url'], 'meshSha256': file_sha(glb),
            'sockets': dict(sorted(sockets.items()))}
        evidence.append({'item': item_id, 'head': source, 'sockets': sorted(sockets), 'skipped': skipped,
                         'mirrored': sorted(s for s, v in sockets.items() if np.prod(v['restScale']) < 0)})
    return out, evidence


def optional_mesh_frames():
    """An optional attachment mesh's own reference skeleton, anchored on the preserved body bone."""
    body = read_json(ACTIVE / 'assets.json')['attachmentBody']
    body_rests = {name: np.array(matrix).reshape(4, 4).T for name, matrix in body['restBones'].items()}
    extraction = {r['path']: r for r in read_json(SOURCE / 'frames-01' / 'assets.json')}
    out, evidence = {}, []
    for record in read_json(SOURCE / 'frames-01' / 'assets.json'):
        if 'error' in record: raise ValueError(f'Optional attachment mesh extraction failed: {record["request"]}')
        dto = read_json(SOURCE / 'frames-01' / record['meshFile'])
        source = assembly_index.object_path(record['path'])
        bones = dto['bones']
        rests, parents = {}, {}
        for index, bone in enumerate(bones):
            if bone['parent'] >= index or bone['parent'] < -1: raise ValueError('Unordered optional mesh skeleton')
            local = converted_transform(bone['translation'], bone['rotation'], bone['scale'])
            rests[bone['name']] = rests[bones[bone['parent']]['name']] @ local if bone['parent'] >= 0 else local
            parents[bone['name']] = bones[bone['parent']]['name'] if bone['parent'] >= 0 else None
        sockets, chains = {}, {}
        for name in rests:
            if name in body_rests: continue  # a shared body bone is reached through the body itself
            anchor, chain = parents[name], []
            while anchor is not None and anchor not in body_rests:
                chain.append(anchor)
                anchor = parents[anchor]
            if anchor is None:
                raise ValueError(f'Optional mesh bone {name} never reaches a preserved body bone')
            difference = float(np.max(np.abs(rests[anchor] - body_rests[anchor])))
            if difference > REST_TOLERANCE:
                raise ValueError(f'Optional mesh bone {anchor} differs from the preserved body rest by {difference}')
            sockets[name] = socket_entry(rests[anchor], anchor, np.linalg.inv(rests[anchor]) @ rests[name], [1.0, 1.0, 1.0])
            chains[name] = {'anchor': anchor, 'through': chain, 'anchorRestDifference': difference}
        if not sockets: raise ValueError(f'Optional attachment mesh {source} adds no bones of its own')
        out[source] = {'sourceSha256': record['sha256'].lower(), 'sockets': dict(sorted(sockets.items()))}
        evidence.append({'source': source, 'sourcePackage': record['path'], 'bones': [b['name'] for b in bones],
                         'sockets': chains})
    if not extraction: raise ValueError('No optional attachment mesh extraction')
    return out, evidence


def stage_frames(args):
    heads, head_evidence = head_component_frames()
    optional, optional_evidence = optional_mesh_frames()
    frames = {'headComponents': heads, 'optionalMeshes': optional}
    write(WORK / 'attachment-frames.json', frames)
    write(WORK / 'frame-evidence.json', {
        'formatVersion': 1, 'marker': MARKER,
        'meaning': 'Component-space socket rest frames in the converted (X, Z, Y) * 0.01 axes of the preserved GLBs. '
                   'Rest placement and rigid driver following only: jiggle joints are not simulated.',
        'restTolerance': REST_TOLERANCE, 'headComponents': head_evidence, 'optionalMeshes': optional_evidence,
        'inputs': {p.as_posix(): file_sha(p) for p in sorted([
            *(SOURCE / 'skeletons-01').glob('*.json'), *(SOURCE / 'frames-01').glob('*.json'),
            ACTIVE / 'assets.json', ACTIVE / 'skin-pairs.json'])}})
    mirrored = sum(len(e['mirrored']) for e in head_evidence)
    print(f'Frames: {sum(len(h["sockets"]) for h in heads.values())} head sockets ({mirrored} mirrored) on '
          f'{len(heads)} head components, {sum(len(o["sockets"]) for o in optional.values())} optional-mesh sockets')


def resolve_items(assets_file, output):
    """The runtime's own resolver over every catalog item, as check-assembly-coverage.mjs reports it."""
    import subprocess
    output.parent.mkdir(parents=True, exist_ok=True)
    with (output.parent / (output.stem + '.log')).open('w', encoding='utf-8') as log:
        subprocess.check_call(['node', '--import', 'tsx', 'scripts/shader-probe/check-assembly-coverage.mjs',
                               'public/models/reconstructed-assembly-v2/customization.json', str(assets_file), str(output)],
                              stdout=log, stderr=subprocess.STDOUT)
    return read_json(output)


def prior_mesh_entries():
    return {assembly_index.object_path(e['source']): e for e in read_json(PRIOR / 'meshes' / 'meshes.json')}


def stage_runtime_meshes(needed):
    """Copy exactly this cohort's already verified GLBs; a rerun proves the folder is still that set."""
    folder = RUNTIME / 'meshes'
    by_source = prior_mesh_entries()
    verified = {row['source']: row for row in read_json(PRIOR / 'mesh-verification.json') if row['passed']}
    entries = []
    for key in sorted(needed):
        entry = by_source.get(key)
        if not entry: raise ValueError(f'No verified conversion for {key}')
        record = verified.get(entry['source'])
        if not record or record['sha256'] != entry['sha256']:
            raise ValueError(f'No passing verification for the preserved conversion: {entry["file"]}')
        if file_sha(PRIOR / 'meshes' / entry['file']) != entry['sha256']:
            raise ValueError(f'Preserved conversion changed: {entry["file"]}')
        entries.append(entry)
    if (folder / 'meshes.json').is_file():
        if read_json(folder / 'meshes.json') != entries: raise ValueError('Runtime meshes differ from the supported set')
    else:
        if folder.exists() and any(folder.iterdir()): raise ValueError(f'Use an empty mesh folder: {folder}')
        folder.mkdir(parents=True, exist_ok=True)
        for entry in entries: shutil.copyfile(PRIOR / 'meshes' / entry['file'], folder / entry['file'])
        write(folder / 'meshes.json', entries)
    for entry in entries:
        if file_sha(folder / entry['file']) != entry['sha256']: raise ValueError(f'Runtime mesh changed: {entry["file"]}')


def stage_runtime_materials(needed_ids):
    """Stage exactly this cohort's materials from the previous batch's CPU/GPU-validated set."""
    folder, staged = WORK / 'validation-implemented', RUNTIME / 'materials'
    validation = PRIOR / 'validation'
    write(folder / 'passed.requests.json', [j for j in read_json(validation / 'passed.requests.json') if j['id'] in needed_ids])
    write(folder / 'translation-checks.json', [r for r in read_json(validation / 'translation-checks.json') if r['itemId'] in needed_ids])
    write(folder / 'webgl-checks.json', [r for r in read_json(validation / 'webgl-checks.json') if r['itemId'] in needed_ids])
    staging = PRIOR_RUNTIME / 'staging'
    if staged.exists() and any(staged.iterdir()):
        reports = read_json(staged / 'build-report.json')
        if {row['itemId'] for row in reports} != needed_ids: raise ValueError('Staged set differs from the supported materials')
        for row in reports:
            manifest = read_json(staged / f'{row["itemId"]}.json')
            for name in [f'{row["itemId"]}.json', manifest['shader'], *[t['file'] for t in manifest['textures']]]:
                if file_sha(staged / name) != file_sha(staging / name): raise ValueError(f'Staged file differs: {name}')
    else:
        stager.stage(staging, folder, folder / 'webgl-checks.json', staged)
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


def stage_index(args):
    ready, paths = accessories.source()
    rows, resolution, requests = accessories.classify(paths)
    if read_json(PRIOR / 'classification.json') != rows:
        raise ValueError('The preserved accessory classification changed; this batch reuses it unchanged')
    rows = [row for row in rows if row['id'] in COHORT]
    if sorted(r['id'] for r in rows) != sorted(COHORT): raise ValueError('The cohort is not the eleven deferred choices')
    jobs_by_id = {job['id']: job for job in read_json(PRIOR / 'requests.json')}
    accepted = accessories.accepted_ids()
    frames = read_json(WORK / 'attachment-frames.json')

    # 1. Readiness: the viewer's resolver over the active index plus this cohort's meshes,
    #    materials and the new socket frames. Nothing else is offered, so nothing else can change.
    active = {name: read_json(ACTIVE / name) for name in ('assets.json', 'skin-pairs.json', 'supported-items.json')}
    candidate = copy.deepcopy(active['assets.json'])
    names = {record['name']: record['path'] for record in read_json(paths['exports'] / 'probe-summary.json')['results']}
    cohort_meshes = {p['mesh'] for row in rows for p in row['parts']}
    for key, entry in prior_mesh_entries().items():
        if key not in cohort_meshes: continue
        _, size, gltf = glb_document(PRIOR / 'meshes' / entry['file'])
        slots = [{'slot': m['extras']['sourceSlot']['MaterialSlotName'], 'material': m['extras']['sourceMaterial']}
                 for m in gltf['materials']]
        if key in candidate['meshes']: raise ValueError(f'Candidate mesh already bound in the active index: {key}')
        candidate['meshes'][key] = {'url': f'candidate/{entry["file"]}', 'sha256': entry['sha256'], 'slots': slots,
                                    'kind': 'skeletal' if entry['bones'] else 'static'}
    for job_id in sorted({s['job'] for row in rows for part in row['parts'] for s in part['slots']} & accepted):
        key = preview_tools.object_path(names[jobs_by_id[job_id]['instance']])
        if key in candidate['materials']: raise ValueError(f'Candidate material already bound in the active index: {key}')
        candidate['materials'][key] = f'candidate/{job_id}.json'
    candidate['attachmentFrames'] = frames
    write(WORK / 'resolver' / 'candidate-assets.json', candidate)
    candidate_report = resolve_items(WORK / 'resolver' / 'candidate-assets.json', WORK / 'resolver' / 'candidate.json')
    candidate_ready = {entry['id']: entry for entry in candidate_report['ready']}
    candidate_exceptions = {entry['id']: entry['reason'] for entry in candidate_report['exceptions']}
    gated = {row['id'] for row in rows if row['parameterBlockers']}
    supported = [item_id for item_id in COHORT if item_id in candidate_ready and item_id not in gated]
    needed_meshes = {part['sourceMesh'] for i in supported for part in candidate_ready[i]['parts']}
    needed_sources = {b['source'] for i in supported for part in candidate_ready[i]['parts'] for b in part['materials'].values()}
    by_source = {s['source']: s['job'] for row in rows for part in row['parts'] for s in part['slots']}
    needed_ids = {by_source[s] for s in needed_sources}
    if not needed_ids <= accepted: raise ValueError('A supported item binds an unvalidated material')

    # 2. Runtime folder: exactly the supported meshes, materials and frames, by exact source paths.
    stage_runtime_meshes(needed_meshes)
    reports = stage_runtime_materials(needed_ids)
    frames_file = RUNTIME / 'frames-assets.json'
    assembly_index.build([RUNTIME / 'meshes'], [RUNTIME / 'materials'], [paths['exports']], LEGACY, frames_file, [], None)
    added_index = read_json(frames_file)
    if set(added_index['meshes']) != needed_meshes or set(added_index['materials']) != needed_sources or \
            added_index.get('materialVariants') or any('bodyMaskUrl' in m for m in added_index['meshes'].values()):
        raise ValueError('The frame index must hold exactly the supported meshes and materials, without masks or variants')

    # 3. Preview: every active binding rebased and preserved, this cohort's bindings and frames added.
    guard_preview()
    rebase = preview_tools.Rebaser(ACTIVE, PREVIEW)
    assets = preview_tools.rebase_assets(active['assets.json'], rebase)
    pairs = preview_tools.rebase_skin_pairs(active['skin-pairs.json'], rebase)
    stored = accessories.rebase_supported(active['supported-items.json'], rebase)
    if rebase.missing: raise ValueError(f'Active index references missing files: {sorted(set(rebase.missing))}')
    for name, document in (('assets.json', assets), ('skin-pairs.json', pairs), ('supported-items.json', stored)):
        if preview_tools.resolved_shape(active[name], ACTIVE) != preview_tools.resolved_shape(document, PREVIEW):
            raise ValueError(f'Rebased {name} does not resolve to the active files')
        if rebase.unrebased(document): raise ValueError(f'Unrebased references in {name}: {rebase.unrebased(document)}')
    rebase_added = preview_tools.Rebaser(RUNTIME, PREVIEW)
    added = preview_tools.rebase_assets(added_index, rebase_added)
    if rebase_added.missing: raise ValueError(f'Frame index references missing files: {rebase_added.missing}')
    conflicts = [k for k in added['meshes'] if k in assets['meshes']] + [k for k in added['materials'] if k in assets['materials']]
    if conflicts: raise ValueError(f'Frame entries would replace active bindings: {conflicts}')
    if 'attachmentFrames' in assets: raise ValueError('The active index already carries attachment frames')
    assets['meshes'] = {**assets['meshes'], **added['meshes']}
    assets['materials'] = dict(sorted({**assets['materials'], **added['materials']}.items()))
    assets['attachmentFrames'] = frames
    PREVIEW.mkdir(parents=True, exist_ok=True)
    write(PREVIEW / 'assets.json', assets)
    write(PREVIEW / 'skin-pairs.json', pairs)

    # 4. Only the resolver decides support: every other catalog item must resolve exactly as before.
    before = resolve_items(ACTIVE / 'assets.json', WORK / 'resolver' / 'active.json')
    after = resolve_items(PREVIEW / 'assets.json', WORK / 'resolver' / 'preview.json')
    ready_before = {entry['id']: entry for entry in before['ready']}
    ready_after = {entry['id']: entry for entry in after['ready']}
    cohort = set(COHORT)
    if sorted(ready_before) != sorted(i for i in ready_after if i not in cohort) or any(i in ready_before for i in cohort):
        raise ValueError('The preview changes which non-cohort items resolve')
    for item_id, entry in ready_before.items():
        if preview_tools.resolved_shape(entry, ACTIVE) != preview_tools.resolved_shape(ready_after[item_id], PREVIEW):
            raise ValueError(f'The preview resolves {item_id} to different files')
    if sorted(i for i in ready_after if i in cohort) != sorted(supported):
        raise ValueError(f'Preview readiness differs from the supported set: {sorted(i for i in ready_after if i in cohort)}')
    stale = sorted(i for i in {e['id'] for e in stored['ready']}
                   if preview_tools.resolved_shape({e['id']: e for e in stored['ready']}[i], PREVIEW) !=
                   preview_tools.resolved_shape(ready_after[i], PREVIEW))

    # 5. Every deferred choice keeps a concrete reason, and every supported one its frame evidence.
    exceptions = {entry['id']: entry['reason'] for entry in after['exceptions']}
    build_errors = {row['itemId']: row['error'] for row in read_json(PRIOR_RUNTIME / 'staging' / 'build-errors.json')}
    cpu_errors = {row['id']: row['error'] for row in read_json(PRIOR / 'validation' / 'translation-errors.json')}
    gpu_rows = {row['itemId']: row for row in read_json(PRIOR / 'validation' / 'webgl-checks.json')}
    cpu_rows = {row['itemId']: row for row in read_json(PRIOR / 'validation' / 'translation-checks.json')}
    foreign = read_json(PRIOR / 'foreign-materials.json')

    def material_status(job_id):
        if job_id in foreign: return f'not compiled: {foreign[job_id]}'
        if job_id in build_errors: return f'translation rejected: {build_errors[job_id]}'
        if job_id in cpu_errors: return f'CPU check quarantined: {cpu_errors[job_id]}'
        if job_id not in accepted: return f'GPU check failed: {gpu_rows.get(job_id, {}).get("error", "no GPU result")}'
        return 'validated'

    report_rows = []
    for row in copy.deepcopy(rows):
        blockers = []
        for part in row['parts']:
            for s in part['slots']:
                s['status'] = material_status(s['job'])
                if s['status'] != 'validated': blockers.append(f'part {part["sourceIndex"]} slot {s["slot"]}: {s["status"]}')
        blockers += row['parameterBlockers']
        status = 'implemented' if row['id'] in supported else 'deferred'
        if status == 'deferred' and not blockers:
            blockers.append(f'Resolver: {exceptions.get(row["id"]) or candidate_exceptions.get(row["id"])}')
        if status == 'implemented' and blockers: raise ValueError(f'Supported item carries blockers: {row["id"]} {blockers}')
        entry = {**row, 'status': status, 'blockers': blockers,
                 'resolver': 'ready' if row['id'] in ready_after else exceptions.get(row['id'])}
        if status == 'implemented':
            runtime_parts = []
            for part in ready_after[row['id']]['parts']:
                materials = {}
                for slot, binding in part['materials'].items():
                    job_id = by_source[binding['source']]
                    manifest = read_json(RUNTIME / 'materials' / f'{job_id}.json')
                    (_, _, owner, _), = material_inputs(paths['exports'], [jobs_by_id[job_id]])
                    materials[slot] = {'url': binding['url'], 'source': binding['source'], 'owner': owner,
                                       'assemblySha256': manifest['assemblySha256'], 'shaderSha256': manifest['shaderSha256'],
                                       'twoSided': manifest['twoSided'], 'blendMode': manifest['blendMode'],
                                       'textures': [{'slot': t['slot'], 'source': t['source'], 'sha256': t['sha256']}
                                                    for t in manifest['textures']],
                                       'cpu': {k: cpu_rows[job_id][k] for k in ('cases', 'maxAbsoluteError')},
                                       'gpu': {k: gpu_rows[job_id][k] for k in ('cases', 'maxAbsoluteError')}}
                runtime_parts.append({'sourceIndex': part['sourceIndex'], 'mesh': part['sourceMesh'], 'url': part['url'],
                                      'attachment': part.get('attachment'), 'materials': materials})
            entry['runtime'] = runtime_parts
        report_rows.append(entry)

    document = copy.deepcopy(stored)
    document['items'] = [*stored['items'], *supported]
    document['ready'] = [*stored['ready'], *[ready_after[i] for i in supported]]
    document['exceptions'] = [e for e in stored['exceptions'] if e['id'] not in cohort] + \
        [{'id': e['id'], 'reason': 'Attachment frame preview blocker: ' + ' | '.join(e['blockers'])}
         for e in report_rows if e['status'] == 'deferred']
    document['attachmentFramesPreview'] = {
        'preparedBy': MARKER, 'implemented': len(supported), 'deferred': len(rows) - len(supported),
        'scope': 'Additive preview only: source-authored head-component sockets and optional attachment-mesh rest frames '
                 'for choices whose every visible part and slot already resolves. Static A-pose rest placement and rigid '
                 'body/head following; jiggle-joint secondary motion is not simulated. Not active; Astra review pending.'}
    write(PREVIEW / 'supported-items.json', document)
    urls = accessories.references(assets, pairs, document)
    absent = [url for url in urls if not (PREVIEW / url).resolve().is_file()]
    if absent: raise ValueError(f'Preview index references missing files: {absent}')

    summary = {
        'formatVersion': 1, 'marker': MARKER, 'base': ACTIVE.as_posix(), 'frames': RUNTIME.as_posix(),
        'meaning': 'Additive attachment-frame preview index. Every active entry is preserved and rebased; head-component '
                   'and optional attachment-mesh sockets are added with their exact component rest frames. Serve through '
                   'servePreviewIndex; not active. Binding and frame checks are not visual acceptance.',
        'inputs': {p.as_posix(): file_sha(p) for p in [CATALOG, WORK / 'attachment-frames.json', WORK / 'frame-evidence.json',
                   PRIOR / 'classification.json', PRIOR / 'requests.json', *[ACTIVE / name for name in active]]},
        'counts': {'candidates': len(rows), 'implemented': len(supported), 'deferred': len(rows) - len(supported),
                   'addedMeshes': len(needed_meshes), 'addedMaterials': len(needed_sources),
                   'meshes': len(assets['meshes']), 'materials': len(assets['materials']),
                   'materialVariants': len(assets.get('materialVariants', {})), 'skinPairs': len(pairs['items']),
                   'attachmentRestBones': len(assets.get('attachmentBody', {}).get('restBones', {})),
                   'headComponents': len(frames['headComponents']),
                   'headSockets': sum(len(h['sockets']) for h in frames['headComponents'].values()),
                   'optionalMeshes': len(frames['optionalMeshes']),
                   'optionalSockets': sum(len(o['sockets']) for o in frames['optionalMeshes'].values()),
                   'supportedItems': len(document['items']), 'checkedReferences': len(urls)},
        'storedActiveEntriesDifferingFromResolver': stale,
        'implemented': supported,
        'deferred': {e['id']: e['blockers'] for e in report_rows if e['status'] == 'deferred'},
        'rebasedUrls': dict(sorted({**rebase.moved, **rebase_added.moved}.items())),
    }
    write(PREVIEW / 'preview.json', summary)
    write(WORK / 'cohort-report.json', {'formatVersion': 1, 'marker': MARKER, 'items': report_rows})

    # Activation candidate for review only: exactly what would be added to the active index.
    write(WORK / 'activation-candidate' / 'assets-additions.json',
          {'meshes': added['meshes'], 'materials': added['materials'], 'attachmentFrames': frames})
    write(WORK / 'activation-candidate' / 'supported-items-additions.json',
          {'items': supported, 'ready': [ready_after[i] for i in supported],
           'exceptions': [e for e in document['exceptions'] if e['id'] in cohort],
           'attachmentFramesPreview': document['attachmentFramesPreview']})
    write(WORK / 'activation-candidate' / 'candidate.json', {
        'formatVersion': 1, 'marker': MARKER, 'meaning': 'Review candidate only; the active index is untouched.',
        'target': ACTIVE.as_posix(), 'runtime': RUNTIME.as_posix(), 'preview': PREVIEW.as_posix(),
        'apply': ['merge assets-additions.json meshes/materials into assets.json',
                  'add assets-additions.json attachmentFrames as a new top-level section',
                  'append supported-items-additions.json items/ready and replace the listed exceptions',
                  'keep every existing entry unchanged; the preview proves they resolve to the same files'],
        'activeInputs': {(ACTIVE / name).as_posix(): file_sha(ACTIVE / name) for name in active}})
    print(f'Preview: {len(supported)} choices added, {len(rows) - len(supported)} deferred; {len(needed_meshes)} meshes, '
          f'{len(needed_sources)} materials ({len(reports)} staged); {summary["counts"]["checkedReferences"]} references '
          f'checked; stale active entries: {stale or "none"}')


if __name__ == '__main__':
    if not CATALOG.is_file(): raise SystemExit('Run from the repository root')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('stage', choices=('frames', 'index', 'all'))
    a = parser.parse_args()
    for name, run in (('frames', stage_frames), ('index', stage_index)):
        if a.stage in (name, 'all'): run(a)
