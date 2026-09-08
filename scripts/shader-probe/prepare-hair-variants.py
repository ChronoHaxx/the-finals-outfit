"""Prepare all Afro Fade colour jobs from decoded activation arrays and saved inputs.

Only the donor's explicit dynamic parameters are copied. The within-item array
order is a bounded preview policy; this does not recover cross-item priority.
"""
import hashlib
import json
import shutil
from pathlib import Path
from material_inputs import read_json, material_inputs, texture_paths

base = Path('scripts/generated/shader-probe')
out = base / 'reference-hair-variants-01'
exports, textures = out / 'exports', out / 'textures'
exports.mkdir(parents=True, exist_ok=True)
textures.mkdir(exist_ok=True)
inventory_file = base / 'material-inventory-v2/materials.json'
inventory = {}
for record in read_json(inventory_file)['records']:
    inventory.setdefault(record['path'].split('.')[-1], []).append(record)
index = read_json(Path('public/models/reconstructed-assemblies-v1/assets.json'))
pair = read_json(Path('public/models/reconstructed-assemblies-v1/skin-pairs.json'))['items']['head-face-01-base']
definition_root = Path('public/models/reconstructed-assembly-v2/items')
base_definition = read_json(definition_root / 'hairs-afrofade.json')
mesh = base_definition['properties']['VisualParts'][0]['StaticMesh']['AssetPathName']
hair_source, = [s['material'] for s in index['meshes'][mesh]['slots'] if s['slot'] == 'M_Hair']
head_source = pair['head']['materials']['shader_head_shader']['source']
source_folders = [base / 'reference-details-01/exports', base / 'reference-hair-01/exports']
copied, provenance = set(), []

def ensure_material(name):
    if name in copied: return
    copied.add(name)
    existing = next((folder for folder in source_folders if (folder / (name + '.json')).exists()), None)
    if existing:
        record = read_json(existing / (name + '.json'))[0]
        for file in existing.glob(name + '.*'):
            if file.is_file(): shutil.copy2(file, exports / file.name)
        for kind in ('bindings', 'shaders'):
            (exports / kind).mkdir(exist_ok=True)
            for file in (existing / kind).glob(name + '.*'):
                shutil.copy2(file, exports / kind / file.name)
        origin = {'file': (existing / (name + '.json')).as_posix(), 'sha256': hashlib.sha256((existing / (name + '.json')).read_bytes()).hexdigest()}
    else:
        candidates = inventory[name]
        if len(candidates) != 1: raise ValueError('Ambiguous source material name: ' + name)
        saved, = candidates
        record = {'Name': name, 'Package': saved['path'].split('.')[0], 'Properties': saved['properties'],
                  'bHasStaticPermutationResource': saved['declaresStaticPermutation']}
        (exports / (name + '.json')).write_text(json.dumps([record], indent=2) + '\n', encoding='utf-8')
        origin = {'inventory': inventory_file.as_posix(), 'source': saved['source'], 'sourceSha256': saved['sha256']}
    provenance.append({'name': name, 'path': 'Discovery/Content/' + record['Package'].removeprefix('/Game/') + '.uasset', **origin})
    parent = record['Properties'].get('Parent', {}).get('ObjectPath')
    if parent: ensure_material(parent.split('/')[-1].split('.')[0])

jobs, variants = [], []
for file in sorted(definition_root.glob('hairs-afrofade-*.json')):
    definition = read_json(file)
    def comparable_parts(parts):
        return [{**part, 'TagOverrides': sorted(part['TagOverrides'], key=lambda rule: json.dumps(rule, sort_keys=True))} for part in parts]
    if comparable_parts(definition['properties']['VisualParts']) != comparable_parts(base_definition['properties']['VisualParts']):
        raise ValueError('Variant changes source geometry or rules: ' + definition['id'])
    activations = definition['properties']['ActivatesMaterialParameters']
    for activation in activations:
        if activation['Behavior'] != 'ECustomizationMaterialBehavior::OverrideParameters' or activation['MatchingTags'] not in ([], ['Customization.Slot.Head']):
            raise ValueError('Unsupported material activation: ' + definition['id'])
    variant = {'id': definition['id'], 'definition': file.as_posix(), 'sourceSha256': definition['sourceSha256'], 'jobs': {}}
    for slot, source, prefix in [('M_Hair', hair_source, definition['id']), ('shader_head_shader', head_source, definition['id'].replace('hairs-', 'head-face-01-'))]:
        overlays = [a['MaterialInstance']['AssetPathName'] for a in activations if slot in a['SlotNames']]
        if len(overlays) != (1 if slot == 'M_Hair' else 2): raise ValueError('Unexpected hair/scalp activation count')
        job = {'id': prefix, 'instance': source.split('.')[-1], 'parameterOverrides': [p.split('.')[-1] for p in overlays]}
        jobs.append(job); variant['jobs'][slot] = {'id': prefix, 'source': source, 'overlays': overlays}
        for name in [job['instance'], *job['parameterOverrides']]: ensure_material(name)
    variants.append(variant)

requested = set()
for _, _, owner, chain in material_inputs(exports, jobs):
    bindings = read_json(exports / 'bindings' / (owner + '.SP_PCD3D_SM5.basepass-pixel.bindings.json'))
    requested.update(path for _, path in texture_paths(chain, bindings))
available = {}
for folder in [base / 'reference-details-01/textures-v2', base / 'reference-hair-01/textures']:
    for record in read_json(folder / 'textures.json'):
        if record.get('mips'): available[record['path']] = (folder, record)
records = []
for path in sorted(requested):
    if path not in available: raise ValueError('Missing previously extracted texture: ' + path)
    folder, record = available[path]
    for mip in record['mips']:
        for payload in [mip, *([mip['decoded']] if mip.get('decoded') else [])]:
            data = (folder / payload['file']).read_bytes()
            if hashlib.sha256(data).hexdigest().upper() != payload['sha256']: raise ValueError('Cooked payload hash mismatch')
            (textures / payload['file']).write_bytes(data)
    records.append(record)

for path, value in [
    (out / 'requests.json', jobs), (out / 'variants.json', variants), (textures / 'textures.json', records),
    (exports / 'probe-summary.json', {'results': provenance}),
    (out / 'provenance.json', {'inventorySha256': hashlib.sha256(inventory_file.read_bytes()).hexdigest(),
       'materialSources': provenance, 'policy': 'Explicit dynamic parameters; preserve recipient shader; within-item source array order'}),
]: path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(variants)} source variants, {len(jobs)} hair/scalp jobs, {len(copied)} material records and {len(records)} existing cooked textures')
