"""Refresh patch for batch C (Season 12 item refresh, 25 Nov 2026): repoint garment meshes, their body masks and the
material instances they draw, pinned to the active index, for apply-merge-patch.py --garments-only.

  python -X utf8 -I scripts/body-types/make-refresh-patch.py ACTIVE_DIR SPEC_JSON OUT_PATCH_JSON

SPEC_JSON names only the targets; every "from" value and every sha256 is read here:

  {"note": "...",
   "meshes": {"/Game/.../SK_X_M.SK_X_M": {"toUrl": "../folder/SK_X_M.glb",
                                          "bodyMask": {"toUrl": "../folder/SK_X_M.bodymask.png"}}},
   "materials": {"/Game/.../MI_X.MI_X": {"toUrl": "../folder/x.json"}}}

URLs resolve from ACTIVE_DIR, as the index's own do, and every target file must already be there: stage the new files
in a mirror of ACTIVE_DIR first. The body is never repointed. A material instance with parameter variants is refused,
as apply-merge-patch.py refuses it. Read-only on the inputs; refuses an existing output.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def target(active_dir, url, what):
    path = active_dir / url
    if not path.is_file():
        raise SystemExit(f'{what}: {path} is not in place')
    return sha(path)


def main(active_dir, spec_json, out_json):
    active_dir, out = Path(active_dir), Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    assets_path = active_dir / 'assets.json'
    assets = json.loads(assets_path.read_text(encoding='utf-8'))
    spec = json.loads(Path(spec_json).read_text(encoding='utf-8'))
    unknown = set(spec) - {'note', 'meshes', 'materials'}
    if unknown:
        raise SystemExit(f'Unknown spec keys {sorted(unknown)}')
    body = assets['attachmentBody']
    meshes = {}
    for source, want in sorted(spec.get('meshes', {}).items()):
        entry = assets['meshes'].get(source)
        if entry is None:
            raise SystemExit(f'{source}: not in the active index (a refresh never adds a mesh)')
        if source == body['source']:
            raise SystemExit('The body is never part of a garment refresh')
        if want['toUrl'] == entry['url']:
            raise SystemExit(f'{source}: toUrl is the live URL; never overwrite a live file')
        change = {'fromUrl': entry['url'], 'toUrl': want['toUrl'], 'fromSha256': entry['sha256'],
                  'toSha256': target(active_dir, want['toUrl'], source)}
        if 'bodyMask' in want:
            if not entry.get('bodyMaskUrl'):
                raise SystemExit(f'{source}: has no body mask to repoint')
            change['bodyMask'] = {'fromUrl': entry['bodyMaskUrl'], 'toUrl': want['bodyMask']['toUrl'],
                                  'toSha256': target(active_dir, want['bodyMask']['toUrl'], source + ' mask')}
        meshes[source] = change
    variant_recipients = {json.loads(k)[0] for k in assets.get('materialVariants', {})}
    materials = {}
    for source, want in sorted(spec.get('materials', {}).items()):
        live = assets.get('materials', {}).get(source)
        if live is None:
            raise SystemExit(f'{source}: no live material (a refresh never adds one)')
        if source in variant_recipients:
            raise SystemExit(f'{source}: has material variants, which a refresh does not rebuild')
        if want['toUrl'] == live:
            raise SystemExit(f'{source}: toUrl is the live URL')
        materials[source] = {'fromUrl': live, 'toUrl': want['toUrl'],
                             'toSha256': target(active_dir, want['toUrl'], source)}
    patch = {
        'note': spec.get('note', '') + ' Apply with scripts/body-types/apply-merge-patch.py --garments-only, only to '
                'the active index whose sha256 is activeIndexSha256.',
        'activeIndexSha256': sha(assets_path),
        'activeSkinPairsSha256': sha(active_dir / 'skin-pairs.json'),
        'body': {'source': body['source'], 'url': body['url'], 'fromSha256': body['sha256'], 'toSha256': body['sha256']},
        'meshes': meshes,
        'materials': materials}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(patch, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'meshes': len(meshes), 'bodyMasks': sum('bodyMask' in m for m in meshes.values()),
                      'materials': len(materials), 'out': str(out)}))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:4])
