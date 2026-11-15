"""Merge patch from a preview index (Season 12 item refresh, 12 Nov 2026): the from/to of every repointed mesh, pinned
to the active index the preview was built on, for apply-merge-patch.py.

  python -I scripts/body-types/make-merge-patch.py ACTIVE_ASSETS_JSON CANDIDATE_ASSETS_JSON OUT_PATCH_JSON

The candidate must differ from the active index only in mesh url/sha256 and the s12BodyTypePreview block (the body's
sha256 may change in place: the preview server answers the preserved body URL with the S12 body). Anything else stops
the tool. Read-only on both inputs; refuses an existing output.
"""
import hashlib
import json
import sys
from pathlib import Path


def main(active_json, candidate_json, out_json):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    active, candidate = Path(active_json), Path(candidate_json)
    a = json.loads(active.read_text(encoding='utf-8'))
    c = json.loads(candidate.read_text(encoding='utf-8'))
    meta = c.pop('s12BodyTypePreview')
    if meta['activeIndexSha256'] != hashlib.sha256(active.read_bytes()).hexdigest():
        raise SystemExit('The candidate was built on another active index')
    body = a['attachmentBody']['source']
    c_body, a_body = dict(c['attachmentBody']), dict(a['attachmentBody'])
    c_body.pop('sha256'), a_body.pop('sha256')
    if c_body != a_body or set(a) != set(c) or any(a[k] != c[k] for k in a if k not in ('meshes', 'attachmentBody')):
        raise SystemExit('The candidate changes more than mesh urls and hashes')
    if set(a['meshes']) != set(c['meshes']):
        raise SystemExit('The candidate adds or removes meshes')
    meshes = {}
    for key in sorted(a['meshes']):
        x, y = a['meshes'][key], c['meshes'][key]
        if {k: v for k, v in x.items() if k not in ('url', 'sha256')} != {k: v for k, v in y.items() if k not in ('url', 'sha256')}:
            raise SystemExit(f'{key}: the candidate changes more than url and sha256')
        if (x['url'], x['sha256']) != (y['url'], y['sha256']):
            meshes[key] = {'fromUrl': x['url'], 'toUrl': y['url'], 'fromSha256': x['sha256'], 'toSha256': y['sha256'],
                           **({'admitted': meta['swapped'][key]['admitted']} if 'admitted' in meta['swapped'].get(key, {}) else {}),
                           'morphsChanged': {k: v['maxCm'] for k, v in meta['swapped'].get(key, {}).get('morphsChanged', {}).items()}}
    if set(meshes) != set(meta['swapped']):
        raise SystemExit('The repointed meshes differ from the preview record')
    patch = {
        'note': 'Season 12 item refresh. Apply with scripts/body-types/apply-merge-patch.py --garments-only, only to the '
                'active index whose sha256 is activeIndexSha256; otherwise rebuild the candidate.',
        'activeIndexSha256': meta['activeIndexSha256'],
        'activeSkinPairsSha256': hashlib.sha256((active.parent / 'skin-pairs.json').read_bytes()).hexdigest(),
        'candidateAssetsSha256': hashlib.sha256(candidate.read_bytes()).hexdigest(),
        'body': {'source': body, 'url': a['attachmentBody']['url'], 'fromSha256': a['attachmentBody']['sha256'],
                 'toSha256': c['attachmentBody']['sha256'],
                 'servedFrom': meta['swapped'].get(body, {}).get('servedFrom'),
                 'note': 'The S12 body is not part of a garments-only merge; it ships with stage 3 and its app changes.'},
        'admitted': meta.get('admitted', {}),
        'meshes': meshes}
    out.write_text(json.dumps(patch, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'meshes': len(meshes), 'garments': len([k for k in meshes if k != body]), 'out': str(out)}))


if __name__ == '__main__':
    main(*sys.argv[1:4])
