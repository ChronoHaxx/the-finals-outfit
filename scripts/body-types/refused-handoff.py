"""Hand-off list of the refused meshes for the Season 12 item refresh route (6 Nov 2026).

For every mesh the morph-only proof refused, records what Season 12 changed, the class from classify-refusals.py, and
what refreshing it would unlock:
- itemsShowing: supported items that can show it on Medium;
- itemsUnlockedAlone: how many more items become S12 throughout if this mesh alone were refreshed (it and every
  morph-only mesh it currently holds swap), from the index's own fixpoint rerun with the mesh counted as Season 12.

The fixpoint here mirrors build-preview-index.py; with no mesh added it must reproduce the index's effective set, or the
script stops. Meshes whose live GLB already carries the S12 morphs (keptUnchanged) block nothing; they are listed for
their other Season 12 changes.

  python -I scripts/body-types/refused-handoff.py PREVIEW_ASSETS_JSON PROOF_JSON REFUSAL_CLASSES_JSON CUSTOMIZATION_JSON \
      SUPPORTED_ITEMS_JSON MORPH_CENSUS_JSON OUT_JSON

Refuses an existing output.
"""
import importlib.util
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_preview_index', HERE / 'build-preview-index.py')
index_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index_tool)


def kinds(problems):
    """Plain-language kinds of change from the proof's problem strings."""
    found = set()
    for p in problems:
        p = re.sub(r'^primitive \d+ ', '', p)
        if p.startswith(('vertex count', 'indices', 'primitive count')):
            found.add('topology')
        elif p.startswith('POSITION'):
            found.add('positions')
        elif p.startswith(('NORMAL', 'TANGENT')):
            found.add('normals')
        elif p.startswith('TEXCOORD'):
            found.add('uvs')
        elif p.startswith('COLOR'):
            found.add('vertex colour')
        elif p.startswith(('WEIGHTS', 'JOINTS')):
            found.add('skin weights')
        elif p.startswith('skin joint names'):
            found.add('bones')
        elif p.startswith('inverse bind'):
            found.add('rest pose')
        elif p.startswith('morph names'):
            found.add('morph set')
        elif p.startswith('attribute sets'):
            found.add('attribute set')
        elif 'material' in p:
            found.add('materials')
        else:
            found.add(p)
    return sorted(found)


def main(preview_json, proof_json, classes_json, customization_json, supported_json, census_json, out_json):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    load = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    preview, proof, classes = load(preview_json), load(proof_json), load(classes_json)
    meta = preview['s12BodyTypePreview']
    custom, supported = load(customization_json), load(supported_json)['items']
    census = load(census_json)
    shaped = {m for m, row in census.items() if index_tool.BODY_TYPE_MORPHS & set(row.get('morphs', []))}
    body = preview['attachmentBody']['source']
    proven = {row['source'] for row in proof.values() if row.get('status') == 'morph-only'}
    unchanged = {row['source'] for row in proof.values() if row.get('status') == 'morph-only' and not row['morphsChanged']}
    kept = set(meta.get('keptUnchanged', []))
    item_sets = {item: meshes & shaped for item, meshes in
                 index_tool.item_meshes(custom['definitions'], custom['catalog'], supported).items()}
    users = defaultdict(list)
    for item, meshes in item_sets.items():
        for mesh in meshes:
            users[mesh].append(meshes)

    def fixpoint(extra):
        # A refreshed mesh joins the proven set: it swaps only when the item rule allows, like any other.
        base = proven | extra
        effective = base | kept
        while True:
            held = {s for s in base - {body}
                    if any(any(m not in effective and m != body and m != s for m in meshes) for meshes in users[s])}
            settled = (base - (held - unchanged)) | kept
            if settled == effective:
                return effective
            effective = settled

    def s12_items(effective):
        return {item for item, meshes in item_sets.items() if meshes and all(m in effective for m in meshes)}

    baseline = fixpoint(set())
    if baseline != set(meta['effective']):
        raise SystemExit('The fixpoint here does not reproduce the index; build-preview-index.py changed')
    base_items = s12_items(baseline)
    rows = {}
    for name, row in sorted(proof.items()):
        if row.get('status') != 'refused':
            continue
        source, c = row['source'], classes.get(name, {})
        showing = sorted(item for item, meshes in item_sets.items() if source in meshes)
        unlocked = sorted(s12_items(fixpoint({source})) - base_items) if source not in kept else []
        rows[name] = {
            'source': source, 'liveUrl': row['liveUrl'], 'class': c.get('class', 'unclassified'),
            'bodyTypeMorphsAlreadyS12': source in kept,
            'changedVsLive': kinds(row['problems']),
            'changedVsPrepatchSource': kinds(c['s12VsPrepatchSource']) if 's12VsPrepatchSource' in c else None,
            'bodyTypeMorphsChangedCm': {k: v['maxCm'] for k, v in row['morphsChanged'].items()
                                        if k in index_tool.BODY_TYPE_MORPHS} or None,
            'itemsShowing': showing, 'itemsUnlockedAlone': len(unlocked), 'unlockedExamples': unlocked[:8]}
    ranked = sorted(rows, key=lambda n: (-rows[n]['itemsUnlockedAlone'], -len(rows[n]['itemsShowing']), n))
    summary = {'refused': len(rows), 'blocking': sum(1 for r in rows.values() if not r['bodyTypeMorphsAlreadyS12']),
               'keptUnchanged': len(kept & {r['source'] for r in rows.values()}),
               'baselineS12Items': len(base_items),
               'top': [(n, rows[n]['itemsUnlockedAlone'], len(rows[n]['itemsShowing'])) for n in ranked[:30]]}
    out.write_text(json.dumps({'summary': summary, 'order': ranked, 'meshes': rows}, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:8])
