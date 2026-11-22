"""Route census (Season 12 item refresh, tier 2 onward, 22 Nov 2026): which refused meshes to refresh first, and by
which route.

Joins the three proofs on one active index and runs the item rule of build-preview-index.py (an item is Season 12
throughout only when every body-type mesh it can show on Medium is S12) for cumulative route stages:

  stage 1  tier 1: skin-by-name classes (re-encoded, weights, normals, morph set, extension bones) - GLB swap
  stage 2  + permuted surfaces (surface-match-proof "permuted*")                                   - GLB swap
  stage 3  + reworked, same UVs or tile shifts only                     - GLB swap + re-derived body/item masks
  stage 4  + reworked, UVs changed                                      - also needs the S12 textures (fresh read)

and, per refused mesh: its route, the items that can show it, and the items it unlocks on its own on top of each
stage. Ranking = most items shown first ("most worn"), ties by unlocks.

  python -I scripts/body-types/refresh-route-census.py ACTIVE_ASSETS_JSON MORPH_PROOF_JSON SKIN_PROOF_JSON \
      SURFACE_PROOF_JSON CUSTOMIZATION_JSON MORPH_CENSUS_JSON OUT_JSON

Read-only on every input; refuses an existing output.
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_preview_index', HERE / 'build-preview-index.py')
bpi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bpi)

STAGES = ('tier 1', 'permuted', 'reworked, same UVs', 'reworked, UVs changed')


def route(skin_row, surface_row):
    cls = skin_row['class']
    if cls == 'loader refuses':
        return 'loader refuses', cls
    if cls != 'surface differs':
        return 'tier 1', cls
    s = (surface_row or {}).get('class', 'not judged')
    if s.startswith('permuted'):
        return 'permuted', s
    if s.startswith(('reworked: same UVs', 'reworked: UV0 tile shifts only')):
        return 'reworked, same UVs', s
    if s.startswith('reworked: UVs changed'):
        return 'reworked, UVs changed', s
    return 'other', s


def s12_items(users_by_item, ok):
    return {item for item, meshes in users_by_item.items() if meshes <= ok}


class Rule:
    """build-preview-index.py's item rule (settle) over one index, for any set of admitted refused meshes."""

    def __init__(self, morph, by_item_shaped, body):
        self.body = body
        self.morph_only = {r['source'] for r in morph.values() if r.get('status') == 'morph-only'}
        self.unchanged = {r['source'] for r in morph.values() if r.get('status') == 'morph-only' and not r['morphsChanged']}
        self.kept = {r['source'] for r in morph.values() if r.get('status') == 'refused' and not r['morphsChanged']
                     and not any(bpi.GEOMETRY_PROBLEM.match(p) for p in r['problems'])}
        self.users = {}
        for item, meshes in by_item_shaped.items():
            for m in meshes:
                self.users.setdefault(m, []).append((item, meshes))
        self.by_item = {i: m - {body} for i, m in by_item_shaped.items() if m - {body}}

    def items(self, admitted):
        effective, _ = bpi.settle(self.morph_only | set(admitted), self.kept - set(admitted), self.unchanged,
                                  self.users, self.body)
        return s12_items(self.by_item, effective)


def main(active_json, morph_json, skin_json, surface_json, custom_json, census_json, out_json):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active = Path(active_json)
    assets = json.loads(active.read_text(encoding='utf-8'))
    morph = json.loads(Path(morph_json).read_text(encoding='utf-8'))
    skin = json.loads(Path(skin_json).read_text(encoding='utf-8'))['meshes']
    surface = json.loads(Path(surface_json).read_text(encoding='utf-8'))['meshes']
    custom = json.loads(Path(custom_json).read_text(encoding='utf-8'))
    supported = json.loads((active.parent / 'supported-items.json').read_text(encoding='utf-8'))['items']
    shaped = bpi.body_type_meshes(census_json, assets['meshes'])
    body = assets.get('attachmentBody', {}).get('source')
    by_item = {item: (meshes & shaped) - {body}
               for item, meshes in bpi.item_meshes(custom['definitions'], custom['catalog'], supported).items()}
    by_item = {i: m for i, m in by_item.items() if m}
    showing = {}
    for item, meshes in by_item.items():
        for m in meshes:
            showing.setdefault(m, set()).add(item)
    # Already S12 (or S12-shaped): morph-only meshes and refused meshes kept on live because their morphs did not change.
    s12 = {r['source'] for r in morph.values() if r.get('status') == 'morph-only'}
    s12 |= {r['source'] for r in morph.values() if r.get('status') == 'refused' and not r['morphsChanged']
            and not any(bpi.GEOMETRY_PROBLEM.match(p) for p in r['problems'])}
    refused = {r['source']: n for n, r in morph.items() if r.get('status') == 'refused' and r['source'] not in s12}
    # Meshes the index shows that no proof covers (no S12 rebuild) stay pre-S12.
    rows = {}
    for source, name in refused.items():
        rt, cls = route(skin.get(name, {'class': 'not judged'}), surface.get(name))
        rows[source] = {'name': name, 'route': rt, 'class': cls, 'itemsShowing': len(showing.get(source, ()))}
    # The item rule couples items: a morph-only mesh shared with an item that still shows a pre-S12 mesh is held, so
    # stage totals come from the rule's fixpoint (build-preview-index.settle), not from per-item subsets.
    shaped_items = {item: meshes & shaped for item, meshes in
                    bpi.item_meshes(custom['definitions'], custom['catalog'], supported).items()}
    rule = Rule(morph, shaped_items, body)
    baseline = rule.items(set())
    stages, admitted, prev = [], set(), {}
    for stage in STAGES:
        prev[stage] = set(admitted)
        admitted |= {s for s, r in rows.items() if r['route'] == stage}
        stages.append({'stage': stage, 'meshes': sum(r['route'] == stage for r in rows.values()),
                       's12Items': len(rule.items(admitted)),
                       'upperBound': len(s12_items(by_item, s12 | admitted))})
    # Unlocks of one mesh on top of the stages before its own, and on top of everything else (what holding it costs).
    before = {stage: len(rule.items(prev[stage])) for stage in STAGES}
    everything = len(rule.items(admitted))
    for source, r in rows.items():
        base = prev.get(r['route'], admitted)
        r['unlocksOnStage'] = len(rule.items(base | {source})) - before.get(r['route'], everything)
        r['costIfHeld'] = everything - len(rule.items(admitted - {source}))
    unknown = sorted({m for ms in by_item.values() for m in ms} - s12 - set(rows))
    ranked = sorted(rows.items(), key=lambda kv: (STAGES.index(kv[1]['route']) if kv[1]['route'] in STAGES else 9,
                                                   -kv[1]['itemsShowing'], -kv[1]['unlocksOnStage'], kv[1]['name']))
    report = {'activeIndexSha256': __import__('hashlib').sha256(active.read_bytes()).hexdigest(),
              'supportedItems': len(supported), 'itemsWithBodyTypeMeshes': len(by_item),
              's12ItemsNow': len(baseline), 'stages': stages,
              'bodyTypeMeshesWithoutProof': unknown,
              'meshes': {s: r for s, r in ranked}}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('supportedItems', 'itemsWithBodyTypeMeshes', 's12ItemsNow', 'stages')}))
    print(f'body-type meshes no proof covers: {len(unknown)}')


if __name__ == '__main__':
    main(*sys.argv[1:8])
