"""Prepare a data-only family request using current definitions and the shared mesh converter.

No family-specific code is generated. This stage does not activate items. The complete
frozen source/resolver, material, GPU and visual checks still run after this preflight.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

def read(p):
    return json.loads(Path(p).read_text(encoding='utf8'))

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def frozen(p, value):
    text = json.dumps(value, indent=2) + '\n'
    p = Path(p)
    if p.exists():
        if p.read_text(encoding='utf8') != text:
            raise ValueError(f'Preserve existing evidence: {p}')
    else:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf8')

def reuse_module():
    spec = importlib.util.spec_from_file_location('family_active_reuse', Path(__file__).resolve().parent / 'family_active_reuse.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def prepare(request_path, extract=True, include_materials=False):
    request = read(request_path)
    paths = request['paths']
    reuse = reuse_module()
    if reuse.FIELD in request:
        reuse.validate(request, request=True)  # opt-in, checked before anything is extracted
    root = Path.cwd().resolve()
    for key, value in paths.items():
        if key == 'appUrl':
            continue
        p = Path(value)
        if p.is_absolute() or '..' in p.parts or not p.resolve().is_relative_to(root):
            raise ValueError(f'Expected a path inside this checkout: {key}')
    docs = Path(paths['docs'])
    work = Path(paths['work'])
    runtime, preview, active = [Path(paths[k]).resolve() for k in ('runtime', 'preview', 'active')]
    if len({runtime, preview, active}) != 3 or any(a.is_relative_to(b) for a in (runtime, preview) for b in (active,)):
        raise ValueError('Runtime/preview must be isolated from active')
    # The legacy index stage consumes this preflight snapshot separately from the
    # resolver's adapter-baseline.json. Pin it before any extraction, never at index time.
    protected = [Path(paths['active']) / name for name in
                 ('assets.json', 'skin-pairs.json', 'supported-items.json')]
    protected.append(Path(paths['catalog']))
    protected.extend(p for name in ('wiki-catalog.json', 'source-catalog-names.json',
                                   'share-item-ids.json', 'reconstruction-reviews.json')
                     if (p := Path(paths['catalog']).with_name(name)).exists())
    pinned = {p.as_posix():sha(p) for p in protected}
    baseline = {'hashes':pinned}
    if reuse.FIELD in request:
        # The reused entry and its separate GLB/mask bytes are pinned with the index hashes, also before extraction.
        saved = docs/'frozen-baseline.json'
        baseline[reuse.FIELD] = reuse.early_pin(request, pinned, read(saved) if saved.exists() else None,
                                                (docs/'mesh-report.json').exists())
    frozen(docs/'frozen-baseline.json', baseline)
    cohort = read(docs / 'cohort.json')
    ids = [r['id'] for r in cohort['items']]
    if not ids or len(ids) != len(set(ids)) or cohort['meshes'] != [request['mesh']['source']]:
        raise ValueError('Invalid cohort IDs or mesh')
    source_index = Path(paths['sourceIndex'])
    records = {}
    with (Path(paths['refresh'])/'opus-definitions-01/records.jsonl').open(encoding='utf8') as stream:
        for line in stream:
            r = json.loads(line)
            if r.get('package', {}).get('path'):
                records.setdefault(r['package']['path'].casefold(), []).append(r)
    checked = []
    for item in cohort['items']:
        f = source_index/'items'/(item['id']+'.json')
        definition = read(f)
        matches = records.get(definition['source'].casefold(), [])
        if len(matches) != 1:
            raise ValueError(f'Missing or ambiguous current definition: {item["id"]}')
        current = matches[0]
        props = [e['properties'] for e in current.get('exports', []) if e['type']=='CharacterCustomizationItem']
        if current.get('status') != 'ok' or current['package']['sha256'] != definition['sourceSha256'] or props != [definition['properties']]:
            raise ValueError(f'Source definition drift: {item["id"]}')
        tags = definition['properties'].get('ActivatesTags', [])
        if sorted(tags) != sorted(request['fittingTags']):
            raise ValueError(f'Unexpected fitting tags: {item["id"]}')
        checked.append({'id':item['id'],'sourceSha256':definition['sourceSha256'],'definitionFileSha256':sha(f)})
    frozen(docs/'source-precheck.json', {'requestSha256':sha(request_path),'definitions':checked,'passed':True,
        'limits':'Source identity only; production resolver/material/GPU/visual acceptance remains pending.'})
    if not extract:
        return {'items':len(ids),'mesh':request['mesh']['source'],'sourceChecked':True}
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    spec = importlib.util.spec_from_file_location('family_preflight_legacy', here/'prepare-large-sneakers.py')
    stages = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stages)
    stages.DOCS, stages.WORK = docs, work
    stages.RUNTIME, stages.PREVIEW = Path(paths['runtime']), Path(paths['preview'])
    stages.MESH_REPORT = docs/'mesh-report.json'
    stages.d.configure(docs/'batch.json', work, stages.RUNTIME, stages.PREVIEW)
    stages.d.REUSE_EXPORTS, stages.d.REUSE_TEXTURES, stages.d.MESH_EVIDENCE = [], [], []
    if not stages.MESH_REPORT.exists():
        stages.mesh()
    mesh = read(stages.MESH_REPORT)
    if sha(mesh['glb']) != mesh['sha256'] or sha(mesh['meshJson']) != mesh['sourceDtoSha256']:
        raise ValueError('Preserved conversion drift')
    verification = stages.d.mesh_verifier.verify(Path(mesh['meshJson']), Path(mesh['glb']))
    if not verification.get('passed'):
        raise ValueError('Mesh attributes differ from the original DTO')
    assets = read(stages.d.SOURCE/'meshes-01/assets.json')
    slots = stages.d.dto_slots(stages.d.SOURCE/'meshes-01', assets[0])
    if [s['slot'] for s in slots] != [request['mesh']['slot']]:
        raise ValueError(f'Source slot differs from request: {slots}')
    manifest = {**request, 'mesh':{**request['mesh'], 'sha256':mesh['sha256'],
        'facts':{k:mesh[k] for k in ('vertices','triangles','uvSets','bones','materialSections')},
        'morphNames':mesh['morphs']}}
    if reuse.FIELD in request:
        # The current active bytes must still be the early pin and the fresh conversion its GLB byte for byte.
        manifest[reuse.FIELD] = reuse.preflight_pin(request, mesh, slots, cohort, baseline)
    frozen(docs/'family.json', manifest)
    if include_materials:
        targets = [stages.d.package_of(m) for m in cohort['materials']]
        if not (stages.d.SOURCE/'materials-01').exists():
            stages.extract('shaders', 'materials-01', targets)
        if read(stages.d.SOURCE/'materials-01.requests.json') != targets:
            raise ValueError('Material request drift')
        folders = [stages.d.SOURCE/'materials-01']
        for depth in range(1, 9):
            present = {}
            for folder in folders:
                present.update(stages.d.exported_packages(folder))
            absent = sorted({stages.d.package_of(r['parent']) for r in present.values() if r.get('parent')} - set(present))
            if not absent:
                break
            name = f'parents-{depth:02d}'
            if not (stages.d.SOURCE/name).exists():
                stages.extract('shaders', name, absent)
            if read(stages.d.SOURCE/(name+'.requests.json')) != absent:
                raise ValueError('Parent request drift')
            folders.append(stages.d.SOURCE/name)
        else:
            raise ValueError('Material parent chain did not close')
        identity = stages.d.build_identity(stages.d.SOURCE/'meshes-01')
        if any(stages.d.build_identity(f) != identity for f in folders):
            raise ValueError('Material/mesh source builds differ')
    return {'items':len(ids),'manifest':(docs/'family.json').as_posix(),'facts':manifest['mesh']['facts'],'morphNames':mesh['morphs']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--source-only', action='store_true')
    parser.add_argument('--include-materials', action='store_true')
    args = parser.parse_args()
    print(json.dumps(prepare(args.request, not args.source_only, args.include_materials)), flush=True)
