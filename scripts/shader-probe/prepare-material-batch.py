"""Queue materials by verified bytecode reuse, preserving explicit exceptions.

Candidates still require extraction, translation, asset checks and representative
render validation. Sharing compiled code is not a completed-material count.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from material_inputs import read_json


def prepare(inventory, coverage, references, verified, output, limit, definitions=None, built=None, root='M_Character_Layered'):
    records = {r['path']: r for r in read_json(inventory)['records']}
    report = read_json(coverage)
    refs = read_json(references)
    built_folders = built if isinstance(built, list) else [built] if built else []
    built_names = {read_json(folder / (r['itemId'] + '.json'))['sourceInstance']
                   for folder in built_folders for r in read_json(folder / 'build-report.json')}
    priorities = {}
    if definitions:
        # First expand the main clothing slots using decoded occupancy, before
        # optional attachments. This is a product priority, not a rendering rule.
        for definition in read_json(definitions)['definitions'].values():
            props = definition['properties']
            rank = min(({'EBodySlot::BodyUpper': 0, 'EBodySlot::BodyLower': 0, 'EBodySlot::Shoes': 1,
                         'EBodySlot::Hands': 2}.get(slot, 3) for slot in props.get('Slots', [])), default=3)
            for m in props.get('MaterialOverrides', []):
                path = m['Value']['AssetPathName']
                priorities[path] = min(rank, priorities.get(path, 3))
    owners = {e['Name'] for e in read_json(verified / 'shader-extraction.json') if e.get('Platform') == 'SP_PCD3D_SM5' and not e.get('error')}
    hashes = {r['outputHash'] for r in report['resolved'] if r['path'].split('.')[-1] in owners}
    candidates, blocked = [], []
    for r in report['resolved']:
        if r['path'] not in refs or r['root'].split('.')[-1] != root: continue
        if r['outputHash'] not in hashes:
            blocked.append({'path': r['path'], 'reason': 'different compiled shader variant'}); continue
        overrides = {}
        for p in reversed(r['parentChain']):
            overrides.update({v['ParameterInfo']['Name']: v['ParameterValue']
                              for v in records[p]['properties'].get('ScalarParameterValues', [])})
        unsupported = [k for k,v in overrides.items() if 'EmissiveStrength' in k and v]
        if unsupported:
            blocked.append({'path': r['path'], 'reason': 'active unsupported emissive input', 'parameters': unsupported}); continue
        candidates.append({**r, 'referenceCount': refs[r['path']]})
    total_candidates = len(candidates)
    candidates = [r for r in candidates if r['path'].split('.')[-1] not in built_names]
    candidates.sort(key=lambda r: (priorities.get(r['path'], 3), -r['referenceCount'], r['path']))
    # Spread the first batch across actual mesh families instead of many colourways
    # of the same garment. Remaining variants stay queued for the subsequent batch.
    selected, families = [], set()
    for r in candidates:
        family = r['path'].split('/Skins/')[0]
        if family in families: continue
        families.add(family); selected.append(r)
        if len(selected) == limit: break
    names = sorted({p.split('.')[-1] for r in selected for p in r['parentChain']})
    jobs = [{'id': r['path'].split('.')[-1].removeprefix('MI_').lower().replace('_','-') + '-' + hashlib.sha256(r['path'].encode()).hexdigest()[:10],
             'instance': r['path'].split('.')[-1]} for r in selected]
    output.mkdir(parents=True, exist_ok=True)
    data = {'formatVersion': 1, 'sharedShaderCandidates': total_candidates, 'alreadyBuilt': total_candidates-len(candidates),
            'pendingCandidates': len(candidates), 'selected': len(selected),
            'exceptionCounts': dict(Counter(r['reason'] for r in blocked)),
            'meaning': f'Candidates for batch compilation, not verified rendering. Scope: explicit customization material references in {root}.',
            'batch': selected, 'queued': candidates, 'exceptions': blocked}
    for filename, value in [('queue.json', data), ('shaders.requests.json', names), ('materials.requests.json', jobs)]:
        (output / filename).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in data.items() if k not in ['batch','queued','exceptions']}, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('inventory','coverage','references','verified','output'): p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--definitions',type=Path); p.add_argument('--built',type=Path,nargs='+')
    p.add_argument('--limit',type=int,default=16)
    p.add_argument('--root',choices=['M_Character_Layered','M_Character_8Layers_Master'],default='M_Character_Layered')
    a = p.parse_args()
    if a.limit < 1: p.error('--limit must be positive')
    prepare(a.inventory,a.coverage,a.references,a.verified,a.output,a.limit,a.definitions,a.built,a.root)
