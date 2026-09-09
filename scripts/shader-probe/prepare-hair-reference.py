"""Prepare the first scalp-override job from already extracted source records.

No guessed parameters or asset names are used for the activation: the DA supplies
the scalp instance, and the recovered skin-pair index supplies the recipient.
"""
import json
import shutil
from pathlib import Path
from material_inputs import parent_chain, material_inputs, texture_paths, read_json

base = Path('scripts/generated/shader-probe')
out = base / 'reference-hair-01'
exports = out / 'exports'
exports.mkdir(parents=True, exist_ok=True)
source = base / 'reference-outfit-01/exports'
definition = read_json(Path('public/models/reconstructed-assembly-v2/items/hairs-afrofade.json'))
activation, = definition['properties']['ActivatesMaterialParameters']
assert activation['Behavior'] == 'ECustomizationMaterialBehavior::OverrideParameters'
assert activation['MatchingTags'] == [] and activation['SlotNames'] == ['shader_head_shader']
overlay = activation['MaterialInstance']['AssetPathName'].split('.')[-1]
pair = read_json(Path('public/models/reconstructed-assemblies-v1/skin-pairs.json'))['items']['head-face-01-base']
target = pair['head']['materials']['shader_head_shader']['source'].split('.')[-1]
jobs = [{'id': 'head-face-01-afrofade', 'instance': target, 'parameterOverrides': [overlay]}]
(out / 'requests.json').write_text(json.dumps(jobs, indent=2) + '\n')
for name in {m['Name'] for instance in (target, overlay) for m in parent_chain(source, instance)}:
    for file in source.glob(name + '.*'):
        if file.is_file(): shutil.copy2(file, exports / file.name)
    for kind in ('bindings', 'shaders'):
        (exports / kind).mkdir(exist_ok=True)
        for file in (source / kind).glob(name + '.*'):
            shutil.copy2(file, exports / kind / file.name)
shutil.copy2(source / 'probe-summary.json', exports / 'probe-summary.json')
paths = set()
for _, _, owner, chain in material_inputs(exports, jobs):
    bindings = read_json(exports / 'bindings' / (owner + '.SP_PCD3D_SM5.basepass-pixel.bindings.json'))
    paths.update(path for _, path in texture_paths(chain, bindings))
(out / 'textures.requests.json').write_text(json.dumps(sorted(paths), indent=2) + '\n')
print(f'Prepared {target} with the explicit {overlay} override and {len(paths)} bound textures')
