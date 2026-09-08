"""Copy only CPU/GPU-validated material instances into a local runtime asset set."""
import argparse
import gzip
import hashlib
import json
import shutil
from pathlib import Path
from material_inputs import read_json


def stage(materials, exports, gpu, output):
    if not output.resolve().is_relative_to(Path('public/models').resolve()):
        raise ValueError('Runtime staging must stay in public/models')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use a new empty runtime output directory')
    jobs = read_json(exports / 'passed.requests.json')
    cpu_rows = read_json(exports / 'translation-checks.json')
    cpu = {row['itemId']: row for row in cpu_rows if 'itemId' in row}
    gpu_checks = {row['itemId']: row for row in read_json(gpu)}
    accepted = set()
    for job in jobs:
        c, g = cpu.get(job['id']), gpu_checks.get(job['id'])
        if c is None:
            legacy = [row for row in cpu_rows if 'itemId' not in row and row['material'] == job['instance']]
            if len(legacy) == 1 and sum(j['instance'] == job['instance'] for j in jobs) == 1: c = legacy[0]
        if c and c['material'] != job['instance']: raise ValueError('CPU material identity mismatch')
        if c and g and not g.get('error') and g['cases'] == c['cases'] and g['cases'] > 0:
            accepted.add(job['id'])
    reports = [row for row in read_json(materials / 'build-report.json') if row['itemId'] in accepted]
    if len(reports) != len(accepted) or not reports:
        raise ValueError('Missing validated material manifests')
    output.mkdir(parents=True, exist_ok=True)
    copied = set()
    for row in reports:
        name = row['itemId'] + '.json'
        manifest = read_json(materials / name)
        shader = (materials / manifest['shader']).read_bytes()
        if hashlib.sha256(shader).hexdigest() != manifest['shaderSha256']:
            raise ValueError('Shader hash mismatch')
        if manifest.get('coverageShader'):
            coverage=(materials/manifest['coverageShader']).read_bytes()
            if hashlib.sha256(coverage).hexdigest()!=manifest['coverageShaderSha256']:
                raise ValueError('Coverage shader hash mismatch')
            shutil.copy2(materials/manifest['coverageShader'],output/manifest['coverageShader'])
        for texture in manifest['textures']:
            filename = texture['file']
            if filename in copied: continue
            data = gzip.decompress((materials / filename).read_bytes())
            if hashlib.sha256(data).hexdigest() != texture['sha256']:
                raise ValueError('Texture hash mismatch')
            if len(data) != sum(mip['bytes'] for mip in texture['mips']):
                raise ValueError('Texture mip payload length mismatch')
            shutil.copy2(materials / filename, output / filename)
            copied.add(filename)
        shutil.copy2(materials / name, output / name)
        shutil.copy2(materials / manifest['shader'], output / manifest['shader'])
    (output / 'build-report.json').write_text(json.dumps(reports, indent=2) + '\n')
    print(f'Staged {len(reports)} validated materials and {len(copied)} unique textures')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('materials', 'exports', 'gpu', 'output'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    stage(a.materials, a.exports, a.gpu, a.output)
