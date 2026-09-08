"""Upgrade the eight indexed face/scalp compositions after CPU/GPU staging."""
import hashlib
import json
from pathlib import Path
from material_inputs import read_json


def activate():
    root = Path('public/models/reconstructed-assemblies-v1')
    runtime = Path('public/models/reconstructed-neck-v1')
    evidence = Path('scripts/generated/shader-probe/reference-neck-01')
    assets, pairs = read_json(root / 'assets.json'), read_json(root / 'skin-pairs.json')
    reports = read_json(runtime / 'build-report.json')
    if len(reports) != 8: raise ValueError('Missing staged face/scalp materials')
    updates = []
    for row in reports:
        manifest = read_json(runtime / (row['itemId'] + '.json'))
        source = '/Game/Discovery/Characters/Heads/Face_01/Base/MI_Head_Face_01_Base_Head.MI_Head_Face_01_Base_Head'
        overlays = manifest.get('parameterOverrides')
        key = json.dumps([source, *overlays], separators=(',', ':')) if overlays else source
        table = assets['materialVariants' if overlays else 'materials']
        old_url = table[key]; old = read_json(root / old_url)
        for field in ('itemId', 'sourceInstance', 'sourceShaderOwner', 'sourceRoot', 'assemblySha256', 'parameterOverrides'):
            if manifest.get(field) != old.get(field): raise ValueError(f'Unexpected change to {field}')
        if manifest.get('skinCoverage') != 'neck-fade': raise ValueError('Missing validated neck coverage')
        for field, digest in [('shader', 'shaderSha256'), ('coverageShader', 'coverageShaderSha256')]:
            if hashlib.sha256((runtime / manifest[field]).read_bytes()).hexdigest() != manifest[digest]:
                raise ValueError('Staged shader hash mismatch')
        new_textures = {t['slot']: t for t in manifest['textures']}
        for texture in old['textures']:
            if new_textures[texture['slot']] != texture: raise ValueError('Existing source texture changed')
        new_url = '../reconstructed-neck-v1/' + row['itemId'] + '.json'
        table[key] = new_url
        for pair in pairs['items'].values():
            for binding in pair['head']['materials'].values():
                if binding.get('url') == old_url: binding['url'] = new_url
        updates.append({'key': key, 'before': old_url, 'after': new_url})
    # Keep the original manifests for matched before/after captures on reruns.
    for name in ('assets.json', 'skin-pairs.json'):
        baseline = evidence / ('before-' + name)
        if not baseline.exists(): baseline.write_bytes((root / name).read_bytes())
    pairs['scope'] = 'Partial head/body adapter with recovered neck-fade input and shared matching morph. Preview lighting/alpha hashing; native dither, depth offset, translucent eye layers and scattering remain pending.'
    for name, value in [('assets.json', assets), ('skin-pairs.json', pairs)]:
        (root / name).write_text(json.dumps(value, indent=2) + '\n')
    (evidence / 'activation.json').write_text(json.dumps(updates, indent=2) + '\n')
    print(f'Upgraded {len(updates)} face/scalp bindings; mesh and item counts unchanged')


if __name__ == '__main__': activate()
