"""Reuse verified face/scalp inputs for one shared neck-coverage batch."""
import hashlib
import json
import shutil
from pathlib import Path
from material_inputs import read_json


def prepare():
    source = Path('scripts/generated/shader-probe/reference-hair-variants-01')
    output = Path('scripts/generated/shader-probe/reference-neck-01')
    output.mkdir(parents=True, exist_ok=True)
    evidence = []
    for folder in ('exports', 'textures'):
        for path in sorted((source / folder).rglob('*')):
            if not path.is_file(): continue
            if folder == 'exports' and path.name.startswith(('translation-', 'passed.')): continue
            dest = output / path.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            evidence.append({'source': path.as_posix(), 'file': dest.relative_to(output).as_posix(),
                             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    # The bare face binds stubble, whereas every scalp composition substitutes
    # an Afro Fade atlas. Include both sets and verify repeated cooked identities.
    textures = {t['path']: t for t in read_json(output / 'textures/textures.json')}
    original = Path('scripts/generated/shader-probe/reference-skin-01/textures')
    for texture in read_json(original / 'textures.json'):
        if texture['path'] in textures:
            if [m['sha256'] for m in texture['mips']] != [m['sha256'] for m in textures[texture['path']]['mips']]:
                raise ValueError('Conflicting source texture versions')
            continue
        textures[texture['path']] = texture
        for mip in texture['mips']:
            src = original / mip['file']; dest = output / 'textures' / mip['file']
            dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dest)
            digest = hashlib.sha256(src.read_bytes()).hexdigest()
            if digest.lower() != mip['sha256'].lower(): raise ValueError('Cooked mip hash mismatch')
            evidence.append({'source': src.as_posix(), 'file': dest.relative_to(output).as_posix(), 'sha256': digest})
    (output / 'textures/textures.json').write_text(json.dumps(list(textures.values()), indent=2) + '\n')
    requests = [{'id': 'head-face-01', 'instance': 'MI_Head_Face_01_Base_Head'},
                {'id': 'head-face-01-afrofade', 'instance': 'MI_Head_Face_01_Base_Head',
                 'parameterOverrides': ['MI_Head_Scalp_AfroFade_Base']}]
    requests.extend(job for job in read_json(source / 'requests.json') if job['instance'] == 'MI_Head_Face_01_Base_Head')
    if len(requests) != 8 or len({r['id'] for r in requests}) != 8: raise ValueError('Unexpected face/scalp batch')
    (output / 'requests.json').write_text(json.dumps(requests, indent=2) + '\n')
    (output / 'provenance.json').write_text(json.dumps({
        'scope': 'Source neck-fade input and existing source fitting shape. Preview alpha hashing; native dither/discard and depth offset are excluded.',
        'inputs': evidence}, indent=2) + '\n')
    print(f'Prepared {len(requests)} face/scalp compositions from {len(evidence)} cached input files')


if __name__ == '__main__': prepare()
