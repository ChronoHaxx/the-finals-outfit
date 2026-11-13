"""Coverage of a Season 12 body-type refresh index (6 Nov 2026): which supported items are S12 throughout, which stay
mixed and why, and the refused meshes with the items they block.

  python -I scripts/body-types/refresh-coverage.py PREVIEW_ASSETS_JSON PROOF_JSON REFUSAL_CLASSES_JSON \
      CUSTOMIZATION_JSON SUPPORTED_ITEMS_JSON MORPH_CENSUS_JSON READ_ASSETS_JSON OUT_JSON

- PREVIEW_ASSETS_JSON: build-preview-index.py output (its s12BodyTypePreview block: swapped, held).
- PROOF_JSON / REFUSAL_CLASSES_JSON: morph-only-proof.py and classify-refusals.py outputs.
- READ_ASSETS_JSON: the probe's assets.json for the Season 12 read (every request, failed ones included).

An item counts only its body-type meshes (medium_male / medium_female carriers), as the index's item rule does.
- s12: every body-type mesh it can show on Medium is shown with its Season 12 morphs: swapped, or proven morph-only
  with unchanged morphs (holding those changes nothing).
- mixed: at least one is shown pre-S12. Each blocker names its reason:
  refused (with the classify-refusals class), not-in-s12-paks, or held (proven, but another item that shows it is mixed).
- no-body-type-mesh: it shows no body-type mesh (statics, hairs); it stands on the S12 body like every item.
- no-definition: the customization index has no definition for it.
Refuses an existing output.
"""
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_preview_index', HERE / 'build-preview-index.py')
index_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index_tool)


def short(path):
    return path.rsplit('.', 1)[-1]


def package_of(object_path):
    return 'Discovery/Content/' + object_path.removeprefix('/Game/').rsplit('.', 1)[0] + '.uasset'


def main(preview_json, proof_json, classes_json, customization_json, supported_json, census_json, read_json, out_json):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    load = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    preview, proof, classes = load(preview_json), load(proof_json), load(classes_json)
    meta = preview['s12BodyTypePreview']
    custom, supported = load(customization_json), load(supported_json)['items']
    census = load(census_json)
    if set(census) != set(preview['meshes']):
        raise SystemExit('The census and the preview index hold different meshes')
    shaped = {m for m, row in census.items() if index_tool.BODY_TYPE_MORPHS & set(row.get('morphs', []))}
    proof_by_source = {row['source']: (name, row) for name, row in proof.items() if 'source' in row}
    read_failed = {row['request'] for row in load(read_json) if row.get('error') or not row.get('meshFile')}
    unchanged = {row['source'] for row in proof.values() if row.get('status') == 'morph-only' and not row['morphsChanged']}
    swapped, held = set(meta['swapped']), meta['held']
    # Shown with Season 12 morphs: the swapped meshes, proven meshes whose S12 morphs equal the live ones, and refused
    # meshes that keep their vertices and whose morphs did not change (the index records the set it computed).
    effective = set(meta['effective']) if 'effective' in meta else swapped | unchanged
    kept = set(meta.get('keptUnchanged', []))

    def reason(mesh):
        if mesh in proof_by_source:
            name, row = proof_by_source[mesh]
            if row['status'] == 'refused':
                return {'reason': 'refused', 'class': classes.get(name, {}).get('class', 'unclassified')}
            return {'reason': 'held', 'heldBecause': held.get(mesh, {}).get('items', [])[:5]}
        if package_of(mesh) in read_failed:
            return {'reason': 'not-in-s12-paks'}
        return {'reason': 'not-read'}

    items, shows = {}, defaultdict(list)
    all_meshes = index_tool.item_meshes(custom['definitions'], custom['catalog'], supported)
    for item in supported:
        if custom['catalog'].get(item) not in custom['definitions']:
            items[item] = {'status': 'no-definition'}
            continue
        meshes = sorted(all_meshes[item] & shaped)
        for mesh in meshes:
            shows[mesh].append(item)
        if not meshes:
            items[item] = {'status': 'no-body-type-mesh'}
            continue
        blockers = {short(m): reason(m) for m in meshes if m not in effective}
        own = sorted(n for n, b in blockers.items() if b['reason'] != 'held')
        items[item] = {'status': 'mixed' if blockers else 's12', 'bodyTypeMeshes': [short(m) for m in meshes],
                       **({'blockers': blockers, 'ownRoot': own} if blockers else {})}

    refused = {}
    for name, row in sorted(proof.items()):
        if row.get('status') != 'refused':
            continue
        c = classes.get(name, {})
        refused[name] = {'source': row['source'], 'liveUrl': row['liveUrl'], 'class': c.get('class', 'unclassified'),
                         'bodyTypeMorphsAlreadyS12': row['source'] in kept,
                         'morphsChangedVsLive': row['morphsChanged'],
                         'items': sorted(shows.get(row['source'], [])), 'itemCount': len(shows.get(row['source'], [])),
                         'problems': row['problems'], **({'s12VsPrepatchSource': c['s12VsPrepatchSource']}
                                                         if 's12VsPrepatchSource' in c else {})}
    not_in_paks = {short(m): {'source': m, 'items': sorted(shows.get(m, []))}
                   for m in sorted(shaped) if package_of(m) in read_failed}

    status_count = defaultdict(int)
    for row in items.values():
        status_count[row['status']] += 1
    mixed = [row for row in items.values() if row['status'] == 'mixed']
    by_reason = defaultdict(int)
    for row in mixed:
        kinds = {b['class'] if b['reason'] == 'refused' else b['reason'] for b in row['blockers'].values()}
        by_reason[' + '.join(sorted(kinds))] += 1
    summary = {
        'supportedItems': len(supported), 'status': dict(status_count),
        'mixedOnlyByCascade': sum(1 for row in mixed if not row['ownRoot']),
        'mixedByBlockerKinds': dict(sorted(by_reason.items(), key=lambda kv: -kv[1])),
        'meshes': {'bodyTypeMeshes': len(shaped), 'swapped': len(swapped), 'held': len(held),
                   'unchangedProven': len(unchanged), 'refused': len(refused),
                   'refusedKeptUnchanged': len(kept), 'notInS12Paks': len(not_in_paks)},
        'refusedByClass': {k: sum(1 for r in refused.values() if r['class'] == k)
                           for k in sorted({r['class'] for r in refused.values()})},
    }
    out.write_text(json.dumps({'summary': summary, 'items': items, 'refused': refused, 'notInS12Paks': not_in_paks},
                              indent=1) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:9])
