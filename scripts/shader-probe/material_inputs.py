"""Resolve a requested material through its exported parent chain, without name guesses."""
import json
from pathlib import Path


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def parent_chain(exports, instance):
    chain, visited, name = [], set(), instance
    while name:
        if name in visited or Path(name).name != name:
            raise ValueError(f'Invalid material parent chain: {name}')
        visited.add(name)
        material = read_json(exports / (name + '.json'))[0]
        chain.insert(0, material)
        parent = material['Properties'].get('Parent', {}).get('ObjectPath')
        name = parent.split('/')[-1].split('.')[0] if parent else None
    return chain


def static_parameters(chain):
    result = {}
    for material in chain:
        for kind, parameters in material['Properties'].get('StaticParametersRuntime', {}).items():
            for entry in parameters:
                if not entry.get('bOverride'): continue
                info = entry['ParameterInfo']
                key = (kind, info['Name'], info['Association'], info['Index'])
                result[key] = {k: v for k, v in entry.items() if k not in ('ParameterInfo', 'bOverride', 'ExpressionGUID')}
    return result


def neck_fade_inputs(chain, bindings, constants):
    """Identify the observed face mask and scalar inputs from decoded bindings.

    This is the material's fade input, before native temporal dithering, clipping,
    depth offset and engine effects. The preview uses its existing alpha hashing.
    """
    if chain[0]['Name'] != 'M_Face': return None
    textures = [slot for slot, path in texture_paths(chain, bindings)
                if path == '/Game/Discovery/Characters/Heads/Shared/Textures/T_Face_NeckFade.0']
    if len(textures) != 1: raise ValueError('Expected one bound source neck-fade texture')
    result = {'texture': textures[0]}
    for key, name in [('amount', 'FadeAmount'), ('enabled', 'NeckFadeEnabled')]:
        fields = [f for f in bindings['uniformFields'] if f['expression'] == name and f['type'] == 'Float1']
        if len(fields) != 1: raise ValueError(f'Expected one direct {name} uniform')
        field = fields[0]
        value = constants[field['floatOffset']]
        if not (0 <= value < float('inf')) or (key == 'enabled' and value not in (0, 1)):
            raise ValueError(f'Unsupported neck-fade control: {name}={value}')
        result[key] = field['register']
    return result


def material_inputs(exports, requests=None):
    jobs = requests if isinstance(requests, list) else read_json(requests) if requests else [
        {'id': 'casual-longcoat-' + suffix.lower().replace('_', '-'),
         'instance': 'MI_Casual_LongCoat_' + suffix}
        for suffix in ('Leather_Black', 'Leather_Camo', 'Satin')]
    ids = set()
    for job in jobs:
        item_id, instance = job['id'], job['instance']
        if not item_id or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in item_id) or item_id in ids:
            raise ValueError(f'Invalid or repeated material id: {item_id}')
        ids.add(item_id)
        chain, visited, owner, name = [], set(), None, instance
        while name:
            if name in visited or Path(name).name != name:
                raise ValueError(f'Invalid material parent chain: {name}')
            visited.add(name)
            material = read_json(exports / (name + '.json'))[0]
            chain.insert(0, material)
            if owner is None and (exports / (name + '.SP_PCD3D_SM5.uniforms.json')).exists():
                owner = name
            elif owner is None and (material.get('LoadedMaterialResources') or material.get('bHasStaticPermutationResource')):
                raise ValueError(f'Material {name} declares its own permutation without the selected shader; do not borrow a parent shader')
            parent = material['Properties'].get('Parent', {}).get('ObjectPath')
            name = parent.split('/')[-1].split('.')[0] if parent else None
        if not owner:
            raise ValueError(f'No selected shader in the parent chain for {instance}')
        if chain[0]['Name'] not in ('M_Character_Layered', 'M_Character_8Layers_Master', 'M_Skin', 'M_Face',
                                  'M_EyeRefractive_2', 'M_Teeth', 'M_EyelashMaster', 'M_Hair_Metahuman_01'):
            raise ValueError(f'Unsupported master material for {instance}: {chain[0]["Name"]}')
        overlays = job.get('parameterOverrides', [])
        if len(set(overlays)) != len(overlays): raise ValueError('Repeated parameter override')
        for overlay in overlays:
            source_chain = parent_chain(exports, overlay)
            if source_chain[0]['Package'] != chain[0]['Package']:
                raise ValueError(f'Parameter override has a different material root: {overlay}')
            # OverrideParameters copies only the explicit dynamic values from the
            # selected instance. Its parent's skin defaults must not replace the
            # recipient's face identity, and its shader is not the recipient shader.
            # Static switches on the donor do not change the recipient's compiled
            # permutation. In particular colour donors may enable secondary-colour
            # code absent from the actual hair material. Copy dynamic values only.
            record = source_chain[-1]
            chain.append({**record, '_parameterOverride': True, 'Properties': {
                k: record['Properties'][k] for k in ('ScalarParameterValues', 'VectorParameterValues', 'TextureParameterValues')
                if k in record['Properties']}})
        yield item_id, instance, owner, chain


def texture_paths(chain, bindings):
    overrides = {}
    bound_parameters = {binding['parameter'] for binding in bindings['textureBindings']}
    for material in chain:
        for texture in material['Properties'].get('TextureParameterValues', []):
            info = texture['ParameterInfo']
            # Instances retain parameters removed from this compiled permutation.
            # They cannot affect this shader, including unused null decal values.
            if info['Name'] not in bound_parameters:
                continue
            if info['Index'] != -1 or 'GlobalParameter' not in info['Association']:
                raise ValueError('Only global texture parameters are supported')
            value = texture.get('ParameterValue')
            if value is None:
                raise ValueError(f'Unresolved null override for bound texture {info["Name"]} in {material["Name"]}')
            overrides[info['Name']] = value['ObjectPath']
    defaults = chain[0]['CachedExpressionData']['ReferencedTextures']
    for binding in bindings['textureBindings']:
        path = overrides.get(binding['parameter'])
        if path is None:
            path = defaults[binding['defaultTextureIndex']]['ObjectPath']
        if not path.startswith('/') or '.' not in path:
            raise ValueError(f'Invalid texture object path: {path}')
        yield binding['slot'], path
