"""Re-emit every staged material shader and compare it with the bytes its manifest recorded.

Run before and after a translator change. A manifest that reproduced byte-identically with the
old translator must still reproduce: that is the proof an edit left existing contracts intact.
Historical manifests that no longer reproduce are listed rather than hidden. No output is written
anywhere except the report path; staged materials and extracted exports are only read.
"""
import argparse
import glob
import hashlib
import importlib.util
import json
from pathlib import Path

from material_inputs import material_inputs, neck_fade_inputs, read_json
from sm5_slice import Slice

spec = importlib.util.spec_from_file_location('build_materials', Path(__file__).with_name('build-materials.py'))
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
KINDS = {'M_EyeRefractive_2': 'eye', 'M_Teeth': 'teeth', 'M_EyelashMaster': 'eyelash', 'M_Hair_Metahuman_01': 'hair'}
STEM = '.SP_PCD3D_SM5.basepass-pixel.dxbc.asm'


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def assemblies(root):
    """Every extracted SM5 base pass, keyed by content hash: (exports folder, shader owner)."""
    found = {}
    for file in glob.glob(str(root / 'scripts/generated/shader-probe/**/shaders') + '/*' + STEM, recursive=True):
        path = Path(file)
        found.setdefault(sha(path.read_bytes()), []).append((path.parent.parent, path.name.removesuffix(STEM)))
    return found


def reemit(manifest, exports, owner):
    """Rebuild the slice exactly as build-materials.build_one does, from the manifest's own inputs."""
    overlays = [path.split('.')[-1] for path in manifest.get('parameterOverrides', [])]
    job = {'id': manifest['itemId'], 'instance': manifest['sourceInstance'], 'parameterOverrides': overlays}
    (_, _, resolved_owner, chain), = material_inputs(exports, [job])
    if resolved_owner != owner: raise ValueError(f'Owner changed: {resolved_owner} != {owner}')
    stem = owner + '.SP_PCD3D_SM5'
    bindings = read_json(exports / 'bindings' / (stem + '.basepass-pixel.bindings.json'))
    constants, parameters = builder.material_constants(read_json(exports / (stem + '.uniforms.json')), chain)
    # Sampled slots are exactly the manifest textures; their recorded dimensions feed resinfo.
    slots = {t['slot']: {'width': t['mips'][0]['width'], 'height': t['mips'][0]['height'], 'depth': t['depth'],
                         'mipCount': len(t['mips']), 'array': t['array'], 'cube': t.get('cube', False)}
             for t in manifest['textures']}
    root = chain[0]['Name']
    sliced = Slice((exports / 'shaders' / (stem + '.basepass-pixel.dxbc.asm')).read_text(), constants, slots,
                   view_dependent=any(any(v) for k, v in parameters.items() if k.endswith('_ShadeAsCloth')),
                   geometry_dependent=root == 'M_Character_8Layers_Master', skin_surface=root in ('M_Skin', 'M_Face'),
                   surface_kind=KINDS.get(root), material_buffer=bindings['materialBufferIndex'],
                   neck_fade=neck_fade_inputs(chain, bindings, constants))
    shader, _, _ = sliced.emit()
    result = {'shaderSha256': sha(shader)}
    if manifest.get('coverageShader'):
        result['coverageShaderSha256'] = sha(sliced.emit(['opacity'])[0])
    return result


def check(root, output, baseline=None):
    by_hash = assemblies(root)
    rows, cache = [], {}
    for file in sorted(glob.glob(str(root / 'public/models/reconstructed*/*.json'))):
        try: manifest = read_json(Path(file))
        except (ValueError, UnicodeDecodeError): continue
        if not (isinstance(manifest, dict) and manifest.get('formatVersion') == 1
                and 'shaderSha256' in manifest and 'sourceInstance' in manifest): continue
        row = {'manifest': Path(file).relative_to(root).as_posix(), 'shaderSha256': manifest['shaderSha256']}
        key = json.dumps([manifest['assemblySha256'], manifest['sourceInstance'], manifest.get('parameterOverrides'),
                          manifest['textures']], sort_keys=True)
        if key not in cache:
            attempts = []
            for exports, owner in by_hash.get(manifest['assemblySha256'], []):
                try:
                    cache[key] = {**reemit(manifest, exports, owner), 'exports': exports.relative_to(root).as_posix()}
                    break
                except Exception as error:  # a different extraction folder may lack this chain
                    attempts.append(f'{exports.relative_to(root).as_posix()}: {error}')
            else:
                cache[key] = {'error': '; '.join(attempts) or 'no extracted assembly with the recorded hash'}
        emitted = cache[key]
        row.update(emitted)
        row['reproduced'] = 'error' not in emitted and emitted['shaderSha256'] == manifest['shaderSha256'] and \
            emitted.get('coverageShaderSha256') == manifest.get('coverageShaderSha256')
        rows.append(row)
    report = {'formatVersion': 1, 'manifests': len(rows), 'reproduced': sum(r['reproduced'] for r in rows), 'rows': rows}
    regressions = []
    if baseline:
        before = {r['manifest']: r['reproduced'] for r in read_json(baseline)['rows']}
        regressions = [r['manifest'] for r in rows if before.get(r['manifest']) and not r['reproduced']]
        report['baseline'] = baseline.as_posix()
        report['regressions'] = regressions
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'{report["reproduced"]}/{len(rows)} staged shaders re-emit byte-identically'
          + (f'; {len(regressions)} regressions against {baseline}' if baseline else ''))
    return not regressions


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--baseline', type=Path, help='Earlier report; fail if anything it reproduced no longer does')
    a = p.parse_args()
    if not check(Path.cwd(), a.output, a.baseline): raise SystemExit(1)
