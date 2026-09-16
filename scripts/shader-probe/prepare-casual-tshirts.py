"""Stage the frozen 19-choice T-shirt family using the existing source/compiler checks.

The source exporter closes explicit effective slot overrides here; the older defaults
preparer supplies only reusable extraction/provenance plumbing. No active index writes.
"""
import argparse
import copy
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
import importlib.util

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

d = load('prepare-accessory-defaults')
cpu = load('check-material-batch')
DOCS = Path('_docs/coverage-return-2026-09-13')
WORK = Path('scripts/generated/shader-probe/casual-tshirts-v1')
RUNTIME = Path('public/models/reconstructed-casual-tshirts-v1')
PREVIEW = Path('public/models/reconstructed-casual-tshirts-preview-v1')
d.configure(DOCS / 'batch.json', WORK, RUNTIME, PREVIEW)
d.REUSE_EXPORTS, d.REUSE_TEXTURES = [], []
d.MARKER = 'shader-probe/prepare-casual-tshirts'
DOTNET = Path('scripts/generated/shader-probe/tools/dotnet/dotnet.exe')
PROBE = Path('scripts/generated/shader-probe/catalog-refresh-20260912/opus-probe-bin/ShaderProbe.dll')

def plan():
    batch, cohort = d.load_batch()
    rows = []
    for row in cohort:
        definition = d.read_json(d.SOURCE_INDEX / 'items' / (row['id'] + '.json'))
        if definition != row['definition']: raise ValueError('Frozen definition changed: ' + row['id'])
        if row['resolved'].get('materialParameters'): raise ValueError('Unexpected per-item material parameters')
        part, = [p for p in row['resolved']['parts'] if not p['hidden']]
        if part['unresolved'] or part['effect']: raise ValueError('Incomplete source part')
        rows.append({'id': row['id'], 'name': row['name'], 'slot': row['slot'],
                     'definition': {'source': definition['source'], 'sourceSha256': definition['sourceSha256']},
                     'parameterBlockers': [], 'parts': [{'sourceIndex': part['sourceIndex'],
                         'mesh': part['skeletalMesh'], 'slots': row['effectiveSlots'], 'effect': None, 'unresolved': []}]})
    return batch, rows, []
d.plan = plan

def extract(mode, folder, requests):
    target = d.SOURCE / folder
    if target.exists() and any(target.iterdir()): raise ValueError('Preserve source extraction: ' + str(target))
    check = (lambda r:r.startswith('/Game/') and '.' in r.split('/')[-1]) if mode=='textures' else (lambda r:r.startswith('Discovery/Content/') and r.endswith('.uasset'))
    if not requests or len(requests)!=len(set(requests)) or not all(check(r) for r in requests): raise ValueError('Expected unique exact source requests')
    request = d.SOURCE / (folder + '.requests.json')
    if request.exists() and d.read_json(request)!=requests: raise ValueError('Request changed')
    d.write(request, requests); target.mkdir(parents=True, exist_ok=True)
    command = [str(DOTNET.resolve()), str(PROBE.resolve()), mode, d.PAKS, str(d.USMAP.resolve()), d.OODLE,
               str(target.resolve()), str(request.resolve()), 'C:/Users/ChronoHax/AppData/Roaming/FModel/AppSettings.json']
    started = time.time()
    with (d.SOURCE / (folder + '.log')).open('wb') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    record = {'at':d.now(), 'mode':mode, 'folder':folder, 'count':len(requests), 'exitCode':result.returncode,'seconds':round(time.time()-started,3)}
    d.write(d.SOURCE / (folder+'.run.json'),record); print(json.dumps(record),flush=True)
    if result.returncode:
        # Instances with no static permutation legitimately export zero shaders.
        # Keep that exit in the record; the closed parent chain must supply and
        # validate the actual program before any material can build.
        summary = d.read_json(target / 'probe-summary.json') if (target / 'probe-summary.json').exists() else {}
        rows = summary.get('results', [])
        inherited = mode=='shaders' and result.returncode==1 and len(rows)==len(requests) and all(
            not r.get('error') and r.get('parent') for r in rows) and summary.get('requestedShaders')==0
        if not inherited: raise RuntimeError('Source extraction failed: ' + str(folder))
d.extract = extract

def build():
    d.ready_source()
    resolution = d.read_json(d.SOURCE / 'material-resolution.json')
    jobs = [{'id':d.job_id(r['instance']), 'instance':r['instance']} for r in resolution if not r.get('error')]
    d.write(WORK / 'requests.json',jobs)
    d.materials_builder.build(d.SOURCE / 'working-01', d.SOURCE / 'textures-01', RUNTIME / 'staging', jobs, keep_going=True)
    cpu.check(d.SOURCE / 'working-01', RUNTIME / 'staging', WORK / 'requests.json')
    for name in ['translation-checks.json','translation-fixtures.json','translation-errors.json','passed.requests.json']:
        dest = WORK / 'validation' / name; dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(d.SOURCE / 'working-01' / name,dest)
    cohort = d.read_json(DOCS / 'resolved-cohort.json'); r = cohort['meshReport']
    if d.file_sha(r['glb'])!=r['sha256'] or d.file_sha(r['meshJson'])!=r['sourceDtoSha256']: raise ValueError('Frozen mesh changed')
    dest = WORK / 'meshes' / r['file']; dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and d.file_sha(dest)!=r['sha256']: raise ValueError('Preserve changed mesh')
    if not dest.exists(): shutil.copyfile(r['glb'],dest)
    verification = d.mesh_verifier.verify(Path(r['meshJson']),dest)
    d.write(WORK / 'mesh-verification.json',verification)
    d.write(WORK / 'meshes' / 'meshes.json',[r])
    print('Mesh attributes verified against current source DTO',flush=True)

def index():
    d.ready_source()
    helper = d.shared_helpers()
    accepted = helper.accepted_ids()
    jobs = {j['id']: j for j in d.read_json(WORK / 'requests.json')}
    cohort = d.read_json(DOCS / 'resolved-cohort.json')
    by_material = {r['source']: d.job_id(r['instance']) for r in d.read_json(d.SOURCE / 'material-resolution.json')}
    implemented = [r['id'] for r in cohort['items'] if all(by_material[m] in accepted for m in r['materials'])]
    needed = {by_material[m] for r in cohort['items'] if r['id'] in implemented for m in r['materials']}
    if not implemented: raise ValueError('No fully validated candidate')
    helper.stage_runtime_meshes(set(cohort['meshes']))
    helper.stage_runtime_materials(needed)
    coverage = RUNTIME / 'coverage'
    coverage_ready = (coverage / 'derived-coverage.json').exists()
    addition_file = RUNTIME / 'assets-additions.json'
    d.assembly_index.build([RUNTIME / 'meshes'],[RUNTIME / 'materials'],[d.SOURCE / 'working-01'],
                          d.LEGACY,addition_file,[coverage] if coverage_ready else [],None)
    additions = d.read_json(addition_file)
    if not coverage_ready:
        # Do not silently use an older legacy mask while deriving this source mesh.
        for entry in additions['meshes'].values():
            for key in ('bodyMaskUrl','bodyMaskUvTiles','coverageSource'): entry.pop(key,None)
        d.write(addition_file,additions)
    baseline = DOCS / 'active-before'
    files = ['assets.json','skin-pairs.json','supported-items.json']
    active = {}
    for name in files:
        source = d.ACTIVE / name; destination = baseline / name
        if destination.exists() and d.file_sha(destination)!=d.file_sha(source): raise ValueError('Active baseline changed: '+name)
        destination.parent.mkdir(parents=True,exist_ok=True)
        if not destination.exists(): shutil.copyfile(source,destination)
        active[name]=d.read_json(source)
    rebase = d.preview_tools.Rebaser(d.ACTIVE,PREVIEW)
    assets = d.preview_tools.rebase_assets(active['assets.json'],rebase)
    pairs = d.preview_tools.rebase_skin_pairs(active['skin-pairs.json'],rebase)
    supported = helper.rebase_supported(active['supported-items.json'],rebase)
    for name,doc in [('assets.json',assets),('skin-pairs.json',pairs),('supported-items.json',supported)]:
        if d.preview_tools.resolved_shape(doc,PREVIEW)!=d.preview_tools.resolved_shape(active[name],d.ACTIVE): raise ValueError('Rebase changed '+name)
    added_rebase = d.preview_tools.Rebaser(RUNTIME,PREVIEW)
    added = d.preview_tools.rebase_assets(additions,added_rebase)
    if rebase.missing or added_rebase.missing: raise ValueError('Missing indexed dependency')
    for field in ('meshes','materials'):
        if set(added[field]) & set(assets[field]): raise ValueError('Would replace existing '+field)
        assets[field].update(added[field])
    helper.guard_preview()
    d.write(PREVIEW / 'assets.json',assets); d.write(PREVIEW / 'skin-pairs.json',pairs)
    before = helper.resolve_items(d.ACTIVE / 'assets.json',WORK / 'resolver' / 'before.json')
    after = helper.resolve_items(PREVIEW / 'assets.json',WORK / 'resolver' / 'after.json')
    old = {r['id']:r for r in before['ready']}; new = {r['id']:r for r in after['ready']}
    if set(new)-set(old)!=set(implemented) or set(old)-set(new): raise ValueError('Readiness changed outside validated candidates')
    for item_id,row in old.items():
        if d.preview_tools.resolved_shape(row,d.ACTIVE)!=d.preview_tools.resolved_shape(new[item_id],PREVIEW): raise ValueError('Existing assembly changed: '+item_id)
    supported['items'].extend(implemented)
    supported['ready'].extend(new[i] for i in implemented)
    supported['exceptions']=[r for r in supported['exceptions'] if r['id'] not in implemented]
    d.write(PREVIEW / 'supported-items.json',supported)
    missing=[r for r in helper.references(assets,pairs,supported) if not (PREVIEW/r).resolve().is_file()]
    if missing: raise ValueError('Missing preview dependency: '+str(missing))
    d.write(PREVIEW / 'preview.json',{'marker':d.MARKER,'at':d.now(),'implemented':implemented,
             'coverageReady':coverage_ready,'previousAssemblies':len(old),'previewAssemblies':len(new),
             'activeUnchanged':True,'visualAcceptance':'pending','humanAcceptance':'pending'})
    d.write(WORK / 'supported-items-additions.json',{'items':implemented,'ready':[new[i] for i in implemented]})
    print(f'Preview {len(old)} -> {len(new)} assemblies; coverage ready: {coverage_ready}',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('stage',choices=['source','build','gpu','index']); args=p.parse_args()
    if args.stage=='source': d.stage_source(argparse.Namespace(fresh_sources=True))
    elif args.stage=='build': build()
    elif args.stage=='gpu': d.stage_gpu(argparse.Namespace())
    else: index()
