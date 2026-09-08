"""Index preserved GLBs and reconstructed material manifests by exact source paths."""
import argparse
import json
import struct
import hashlib
from pathlib import Path
from material_inputs import read_json


def object_path(package):
    path = package.removeprefix('Discovery/Content/').removesuffix('.uasset')
    return '/Game/' + path + '.' + path.split('/')[-1]


def build(meshes, materials, exports, legacy, output, coverage_folders=None, attachment_body=None):
    meshes = meshes if isinstance(meshes, list) else [meshes]
    materials = materials if isinstance(materials, list) else [materials]
    exports = exports if isinstance(exports, list) else [exports]
    public = Path('public').resolve()
    base = output.resolve().parent
    def relative(path):
        import os
        if not path.resolve().is_relative_to(public): raise ValueError('Runtime assets must be in public')
        return Path(os.path.relpath(path.resolve(), base)).as_posix()
    sources = {a['src']: a['dst'] for a in read_json(legacy)['assets']}
    index = {'formatVersion': 1, 'meshes': {}, 'materials': {}, 'materialVariants': {}}
    derived = {}
    for folder in coverage_folders if coverage_folders is not None else materials:
        coverage_file = folder / 'derived-coverage.json'
        coverage = read_json(coverage_file) if coverage_file.exists() else None
        if coverage:
            body_path=(public / coverage.get('bodyFile','models/body/SK_Body_M.glb')).resolve()
            if not body_path.is_relative_to(public) or hashlib.sha256(body_path.read_bytes()).hexdigest() != coverage['bodySha256']:
                raise ValueError('Derived coverage belongs to a different body geometry')
        for record in coverage['records'] if coverage else []:
            if record['source'] in derived: raise ValueError('Conflicting derived coverage sources')
            derived[record['source']] = {**record, 'folder': folder}
    mesh_entries = [(folder, entry) for folder in meshes for entry in read_json(folder / 'meshes.json')]
    for folder, entry in mesh_entries:
        data = (folder / entry['file']).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError(f'Mesh payload hash mismatch: {entry["file"]}')
        existing = index['meshes'].get(object_path(entry['source']))
        if existing:
            if existing['sha256'] != entry['sha256']: raise ValueError(f'Conflicting source mesh: {entry["source"]}')
            continue # successive extraction batches may contain identical assets
        size, kind = struct.unpack_from('<II', data, 12)
        if kind != 0x4E4F534A: raise ValueError('Missing GLB JSON chunk')
        gltf = json.loads(data[20:20+size])
        if object_path(entry['source']) == attachment_body:
            import numpy as np
            if len(gltf.get('skins', [])) != 1: raise ValueError('Attachment reference requires one source skeleton')
            skin = gltf['skins'][0]
            accessor = gltf['accessors'][skin['inverseBindMatrices']]
            view = gltf['bufferViews'][accessor['bufferView']]
            if accessor['componentType'] != 5126 or accessor['type'] != 'MAT4' or view.get('byteStride', 64) != 64:
                raise ValueError('Unsupported attachment bind matrix layout')
            offset = 28 + size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            matrices = np.frombuffer(data, dtype='<f4', count=16*accessor['count'], offset=offset).reshape(-1,4,4).transpose(0,2,1)
            frames = {gltf['nodes'][joint]['name']: np.linalg.inv(matrix.astype(float)).T.flatten().tolist()
                      for joint, matrix in zip(skin['joints'], matrices, strict=True)}
            if len(frames) != len(skin['joints']): raise ValueError('Repeated reference bone name')
            index['attachmentBody'] = {'source': attachment_body, 'url': relative(folder / entry['file']),
                                       'sha256': entry['sha256'], 'restBones': frames}
        slots = [{'slot': m['extras']['sourceSlot']['MaterialSlotName'],
                  'material': m['extras']['sourceMaterial']}
                 for m in gltf['materials']]
        source = entry['source']
        legacy_path = sources.get(source.split('/Characters/')[-1].removesuffix('.uasset') + '.uemodel')
        mask = public / 'models' / legacy_path.replace('.glb', '.bodymask.png') if legacy_path else None
        projected = derived.get(object_path(source))
        if projected:
            mask = projected['folder'] / projected['file']
            if projected['meshSha256'] != entry['sha256'] or hashlib.sha256(mask.read_bytes()).hexdigest() != projected['sha256']:
                raise ValueError('Derived coverage mesh or mask hash mismatch')
        index['meshes'][object_path(source)] = {
            'url': relative(folder / entry['file']), 'sha256': entry['sha256'], 'slots': slots,
            'kind': 'skeletal' if entry['bones'] else 'static',
            **({'bodyMaskUrl': relative(mask), 'bodyMaskUvTiles': projected['uvTiles'] if projected else [1,1],
                'coverageSource': 'derived-projection' if projected else 'legacy-generated'} if mask and mask.exists() else {})}
    packages = {}
    for folder in exports:
        for record in read_json(folder / 'probe-summary.json')['results']:
            name, path = record['name'], record['path']
            if name in packages and packages[name] != path: raise ValueError(f'Ambiguous source material: {name}')
            packages[name] = path
    for folder, report in [(folder, report) for folder in materials for report in read_json(folder / 'build-report.json')]:
        file = folder / (report['itemId'] + '.json')
        manifest = read_json(file)
        source = object_path(packages[manifest['sourceInstance']])
        overlays = manifest.get('parameterOverrides')
        key = json.dumps([source, *overlays], separators=(',', ':')) if overlays else source
        target = index['materialVariants'] if overlays else index['materials']
        if key in target: raise ValueError(f'Duplicate source material: {key}')
        target[key] = relative(file)
    if attachment_body and 'attachmentBody' not in index: raise ValueError('Missing attachment reference body')
    output.write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
    print(f'Indexed {len(index["meshes"])} meshes, {len(index["materials"])} materials and {len(index["materialVariants"])} parameter variants')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('meshes', 'materials', 'exports'): p.add_argument('--'+name, type=Path, nargs='+', required=True)
    for name in ('legacy', 'output'): p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--coverage',type=Path,nargs='+',help='Use these coverage folders instead of masks stored with materials')
    p.add_argument('--attachment-body', help='Exact preserved source body object path for socket attachment frames')
    a = p.parse_args()
    build(a.meshes, a.materials, a.exports, a.legacy, a.output,a.coverage,a.attachment_body)
