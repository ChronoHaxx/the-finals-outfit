"""C2 index diff (27 Nov 2026; c1-patch-v1/index-diff.py with C2's paths, item masks and holds): apply merge-patch-c2.json
in memory (apply-merge-patch.apply, as the apply will) and compare every field with the active index. Also the scope
checks: the run built 168 materials and rebinds 100, so the 68 extras must reach no patch row or publish entry; the
preview's path rewrites stay out; the three source-stage gaps (EngimoS4, SponsorTrackS6, TechJoggersGlitch) keep their
live entries; no held mesh moves. Read-only; run from the root checkout."""
import hashlib, importlib.util, json
from collections import Counter
from pathlib import Path
W = Path('.claude/worktrees/angry-darwin-c51aab')
spec = importlib.util.spec_from_file_location('apply_merge_patch', W / 'scripts/body-types/apply-merge-patch.py')
applier = importlib.util.module_from_spec(spec); spec.loader.exec_module(applier)
A = Path('public/models/reconstructed-assemblies-v1')
PV = Path('public/models/reconstructed-s12-c2-preview-v1')
M = Path('public/models/reconstructed-s12-c2-v1/materials')
G = W / 'scripts/generated/s12-refresh-tier2-v1'
O = G / 'c2-patch-v1'
sha = lambda b: hashlib.sha256(b).hexdigest()
patch = json.loads((O / 'merge-patch-c2.json').read_text(encoding='utf-8'))
cspec = json.loads((G / 'c2-patch/refresh-spec.json').read_text(encoding='utf-8'))
rb = json.loads(Path(cspec['reboundMaterialsFrom']).read_text(encoding='utf-8'))['reboundMaterials']
pub = [l.strip().replace(chr(92), '/') for l in (O / 'merge-patch-c2.publish.txt').read_text(encoding='utf-8').splitlines() if l.strip()]
holds = [l.split('=', 1)[0] for l in (W / '_docs/s12-refresh-tier2-2026-11-22/holds.txt').read_text(encoding='utf-8').splitlines()
         if l.strip() and not l.startswith('#')]
active_bytes = (A / 'assets.json').read_bytes()
new_bytes, pairs, counts = applier.apply(patch, A)
old, new = json.loads(active_bytes), json.loads(new_bytes)
diffs = []
def walk(x, y, path):
    if isinstance(x, dict) and isinstance(y, dict):
        for k in set(x) | set(y):
            if k not in x: diffs.append(('added', path + [k]))
            elif k not in y: diffs.append(('removed', path + [k]))
            else: walk(x[k], y[k], path + [k])
    elif x != y: diffs.append(('changed', path))
walk(old, new, [])
mesh_names = {p[1] for kind, p in diffs if p[0] == 'meshes'}
mat_names = {p[1] for kind, p in diffs if p[0] == 'materials'}
item_mask_paths = sorted('/'.join(p[1:]) for kind, p in diffs if p[0] == 'itemBodyMasks')
spec_meshes = set(cspec['meshes'])
wrong_target = sorted(m.rsplit('.', 1)[-1] for m in spec_meshes if new['meshes'][m]['url'] != cspec['meshes'][m]['toUrl']
                      or ('bodyMask' in cspec['meshes'][m] and new['meshes'][m].get('bodyMaskUrl') != cspec['meshes'][m]['bodyMask']['toUrl']))
item_wrong = sorted(f'{da} {m}' for da, rows in cspec['itemBodyMasks'].items() for m, v in rows.items()
                    if new['itemBodyMasks'][da][m] != {**old['itemBodyMasks'][da][m], 'url': v['toUrl']})

# Scope: the run's extra built materials, the preview's path rewrites, and the source-stage gaps.
def is_manifest(p):
    d = json.loads(p.read_text(encoding='utf-8'))
    return isinstance(d, dict) and 'shader' in d
manifests = sorted(p.name for p in M.glob('*.json') if is_manifest(p))
rebind_manifests = {Path(v['to']).name for v in rb.values()}
extras = [m for m in manifests if m not in rebind_manifests]
pub_run = {p.rsplit('/', 1)[-1] for p in pub if '/reconstructed-s12-c2-v1/materials/' in '/' + p}
patch_text = json.dumps(patch)
preview = json.loads((PV / 'assets.json').read_text(encoding='utf-8'))
rewrites = {k.rsplit('.', 1)[-1]: {'sameFile': (A / old['materials'][k]).resolve() == (PV / url).resolve(),
                                   'inPatch': k in patch['materials'], 'candidateIsLive': new['materials'][k] == old['materials'][k]}
            for k, url in preview['materials'].items() if k not in rb and url != old['materials'].get(k)}
gaps = {}
for k in old['materials']:
    n = k.rsplit('.', 1)[-1]
    if n in ('MI_FloatingHologram_EngimoS4', 'MI_FloatingHologram_SponsorTrackS6', 'MI_TechJoggersGlitch'):
        gaps[n] = {'active': old['materials'][k], 'candidateIsLive': new['materials'][k] == old['materials'][k],
                   'inPatch': k in patch['materials']}
out = {'activeSha256': sha(active_bytes), 'patchedSha256': sha(new_bytes), 'skinPairsSha256': sha(pairs), 'counts': counts,
       'diffs': len(diffs), 'byTopKey': dict(Counter(f'{p[0]} {k}' for k, p in diffs)),
       'meshFieldsChanged': {'/'.join(k): v for k, v in Counter(tuple(p[2:]) for kind, p in diffs if p[0] == 'meshes').items()},
       'meshesChanged': sorted(m.rsplit('.', 1)[-1] for m in mesh_names), 'meshesOutsideSpec': sorted(mesh_names - spec_meshes),
       'targetsNotAsSpec': wrong_target, 'itemMasksChanged': item_mask_paths, 'itemMasksNotAsSpec': item_wrong,
       'materialsChanged': len(mat_names), 'materialsEqualRebinds': mat_names == set(rb),
       'materialFromsWereLive': all(old['materials'][k] == v['from'] for k, v in rb.items()),
       'lightEntriesTouched': sorted(m.rsplit('.', 1)[-1] for m in mesh_names if m.rsplit('.', 1)[-1].endswith(('_L', '_H'))),
       'heldMeshesMoved': sorted(m.rsplit('.', 1)[-1] for m in mesh_names if m.rsplit('.', 1)[-1] in holds),
       'holds': len(holds),
       'extras': {'manifestsInRunFolder': len(manifests), 'rebindManifests': len(rebind_manifests), 'extraManifests': len(extras),
                  'extraManifestsInPublishList': sorted(set(extras) & pub_run),
                  'extraManifestsNamedInPatch': [m for m in extras if m in patch_text]},
       'previewPathRewrites': rewrites, 'sourceStageGaps': gaps,
       'publishFiles': len(pub), 'publishOutsideRunAndCoverage': sorted(p for p in pub if '/reconstructed-s12-c2-v1/' not in '/' + p
                                                                       and '/s12-refresh-tier2-v1/coverage-c2/' not in '/' + p)}
(Path('_docs/s12-refresh-tier2-2026-11-22/c2-apply') / 'index-diff.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
print(json.dumps(out, indent=1))
