"""Mask proof for Season 12 mesh swaps (S12 item refresh tier 2, 23 Nov 2026).

A body mask (`bodyMaskUrl`) or an item mask (`itemBodyMasks`) is derived from the garment's geometry in the supported
poses, so a mesh whose weights, normals or surface changed can make it stale. For each mesh, every mask the active index
names for it must be regenerated twice with its recorded policy (build-companion-masks.mjs): from the live mesh, which
must reproduce the published file exactly (so the generator and inputs are right), and from the S12 mesh. The runner
reports (run-masks-*.py, run-item-masks.py) hold the counts and the files; this tool judges them per mesh:

- unchanged: every mask regenerates identically from the S12 mesh. The swap keeps the published masks.
- body-changed: only the body mask differs; the S12 one can ship instead (build-preview-index.py --ship-s12-masks).
- unproven: a mask was not regenerated, the generator did not reproduce it, or an item mask changed.

  python -I mask-proof.py OUT_JSON ACTIVE_ASSETS_JSON LIVE_INDEX_DIR S12_INDEX_DIR --body REPORT.json[,...] \
      [--item ITEM_REPORT.json[,...]] [--meshes NAME,...]

LIVE_INDEX_DIR and S12_INDEX_DIR are the indexes the masks were regenerated from; each mesh's GLB sha256 in them is
recorded so the builder can check the proof judged the files it swaps. Refuses an existing OUT_JSON.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def judge(name, key, active, body_rows, item_rows):
    entry = active['meshes'][key]
    masks, reasons, changed = [], [], []
    wanted = []
    if entry.get('bodyMaskUrl'):
        wanted.append(('body', entry['bodyMaskUrl'], None))
    for da, meshes in sorted(active.get('itemBodyMasks', {}).items()):
        if key in meshes:
            wanted.append(('item', meshes[key]['url'], da))
    for kind, url, da in wanted:
        rows = [body_rows.get(name)] if kind == 'body' else [r for r in item_rows if r['mesh'] == name]
        row = next((r for r in rows if r and r.get('files', {}).get('published', [None])[0] == url), None)
        mask = {'kind': kind, 'url': url, **({'da': da} if da else {})}
        if row is None:
            reasons.append(f'{kind} mask {url}: not regenerated')
            masks.append(mask)
            continue
        files = row['files']
        mask.update({'publishedSha256': files['published'][1], 'liveRegen': files['live'][0],
                     'liveRegenSha256': files['live'][1], 's12Regen': files['s12'][0], 's12RegenSha256': files['s12'][1],
                     'liveVsPublished': row['liveVsPublished'], 's12VsLive': row['s12VsLive']})
        masks.append(mask)
        if files['live'][1] is None or files['s12'][1] is None:
            reasons.append(f'{kind} mask {url}: a regeneration wrote no file')
        elif row['liveVsPublished'] != 0:
            reasons.append(f'{kind} mask {url}: the live regeneration differs from the published file '
                           f'({row["liveVsPublished"]} texels); the generator or its inputs are not the published ones')
        elif row['s12VsLive'] != 0:
            (changed if kind == 'body' else reasons).append(
                f'{kind} mask {url}: the S12 mesh changes it ({row["s12VsLive"]} texels)')
    if not wanted:
        reasons.append('no mask names this mesh; the mask proof is not needed')
    status = 'unproven' if reasons else ('body-changed' if changed else 'unchanged')
    row = {'source': key, 'status': status, 'masks': masks, **({'reasons': reasons + changed} if reasons or changed else {})}
    if status == 'body-changed':
        body = next(m for m in masks if m['kind'] == 'body')
        row['s12BodyMask'] = {'file': body['s12Regen'], 'sha256': body['s12RegenSha256']}
    return row


def main(argv):
    options = {}
    for flag in ('--body', '--item', '--meshes'):
        if flag in argv:
            i = argv.index(flag)
            options[flag] = argv[i + 1].split(',')
            del argv[i:i + 2]
    if len(argv) != 4 or '--body' not in options:
        raise SystemExit(__doc__)
    out_json, active_json, live_dir, s12_dir = argv
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active = json.loads(Path(active_json).read_text(encoding='utf-8'))
    live = json.loads((Path(live_dir) / 'assets.json').read_text(encoding='utf-8'))
    s12 = json.loads((Path(s12_dir) / 'assets.json').read_text(encoding='utf-8'))
    body_rows = {}
    for f in options['--body']:
        for name, row in json.loads(Path(f).read_text(encoding='utf-8')).items():
            if name in body_rows:
                raise SystemExit(f'{name}: in two body reports')
            body_rows[name] = row
    item_rows = [r for f in options.get('--item', []) for r in json.loads(Path(f).read_text(encoding='utf-8'))]
    names = options.get('--meshes') or sorted(body_rows)
    by_name = {k.rsplit('.', 1)[-1]: k for k in active['meshes']}
    meshes = {}
    for name in names:
        key = by_name[name]
        if live['meshes'][key] != active['meshes'][key]:
            raise SystemExit(f'{name}: the live index the masks came from is not the active entry')
        meshes[name] = {**judge(name, key, active, body_rows, item_rows),
                        'liveSha256': live['meshes'][key]['sha256'], 's12Sha256': s12['meshes'][key]['sha256']}
    doc = {'note': 'Masks regenerated from the live and the S12 mesh with their recorded policies; see mask-proof.py.',
           'inputs': {'activeIndexSha256': sha(active_json), 'liveIndexSha256': sha(Path(live_dir) / 'assets.json'),
                      's12IndexSha256': sha(Path(s12_dir) / 'assets.json'),
                      'reports': {f: sha(f) for f in options['--body'] + options.get('--item', [])}},
           'meshes': meshes}
    out.write_text(json.dumps(doc, indent=1) + '\n', encoding='utf-8')
    counts = {}
    for row in meshes.values():
        counts[row['status']] = counts.get(row['status'], 0) + 1
    print(json.dumps({'meshes': len(meshes), **counts,
                      'notUnchanged': {n: r['status'] for n, r in meshes.items() if r['status'] != 'unchanged'},
                      'out': str(out)}))


if __name__ == '__main__':
    main(sys.argv[1:])
