"""Apply a Season 12 body-type merge patch to a copy of the active reconstructed-assembly index.

Usage (Git Bash or PowerShell; paths are examples):
  python -I scripts/body-types/apply-merge-patch.py PATCH_JSON ACTIVE_DIR OUT_DIR --garments-only
  python -I scripts/body-types/apply-merge-patch.py PATCH_JSON ACTIVE_DIR OUT_DIR --body-url ../NEW/SK_Body_M.glb

- PATCH_JSON: merge-patch-v2.json (or later), pinned to one active index.
- ACTIVE_DIR: the folder that holds the active assets.json and skin-pairs.json. It is only read.
- OUT_DIR: a new folder. The tool refuses an existing one, so nothing is overwritten. The caller swaps the files into
  place after backing up the originals.

Modes (exactly one):
- --garments-only: repoint every patched mesh except the body. The body entry, attachmentBody and skin-pairs stay
  byte-identical. No app change is needed: the body keeps its preserved URL.
- --body-url URL: also repoint the body (meshes[body], attachmentBody and every skin pair's body.url) to URL, which must
  differ from the preserved URL. The live app pins the preserved body path in several places (HANDOFF.md); those must
  change in the same merge.

Guards: the active assets.json and skin-pairs.json must hash to the patch's pins; every patched entry must still hold
its "from" URL and sha256; only url and sha256 change. Files are read, changed and written back whole, keeping every
field and the source formatting (2-space JSON, CRLF), so the diff is exactly the repointed lines.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(obj):
    return (json.dumps(obj, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8')


def load_exact(path):
    raw = Path(path).read_bytes()
    obj = json.loads(raw)
    if dump(obj) != raw:
        raise SystemExit(f'{path} does not round-trip byte-exactly; refusing to rewrite it')
    return obj


def main(argv):
    garments_only = '--garments-only' in argv
    if garments_only:
        argv.remove('--garments-only')
    body_url = None
    if '--body-url' in argv:
        i = argv.index('--body-url')
        body_url = argv[i + 1]
        del argv[i:i + 2]
    if garments_only == (body_url is not None) or len(argv) != 3:
        raise SystemExit(__doc__)
    patch_json, active_dir, out_dir = map(Path, argv)
    if out_dir.exists():
        raise SystemExit(f'Preserve existing {out_dir}')
    patch = json.loads(patch_json.read_text(encoding='utf-8'))
    assets_path, pairs_path = active_dir / 'assets.json', active_dir / 'skin-pairs.json'
    if sha(assets_path) != patch['activeIndexSha256']:
        raise SystemExit(f'{assets_path} moved since the patch was built; rebuild the candidate (HANDOFF.md)')
    if sha(pairs_path) != patch['activeSkinPairsSha256']:
        raise SystemExit(f'{pairs_path} moved since the patch was built; rebuild the candidate (HANDOFF.md)')
    assets, pairs = load_exact(assets_path), load_exact(pairs_path)
    body = patch['body']['source']

    applied = 0
    for key, change in patch['meshes'].items():
        entry = assets['meshes'].get(key)
        if entry is None or entry['url'] != change['fromUrl'] or entry['sha256'] != change['fromSha256']:
            raise SystemExit(f'{key} no longer matches the patch; rebuild the candidate (HANDOFF.md)')
        if key == body:
            continue
        entry['url'], entry['sha256'] = change['toUrl'], change['toSha256']
        applied += 1

    body_pairs = 0
    if body_url is not None:
        attachment = assets['attachmentBody']
        if body_url == patch['body']['url']:
            raise SystemExit('--body-url must differ from the preserved body URL; never overwrite the preserved file')
        if attachment['url'] != patch['body']['url'] or attachment['sha256'] != patch['body']['fromSha256']:
            raise SystemExit('attachmentBody no longer matches the patch')
        attachment['url'], attachment['sha256'] = body_url, patch['body']['toSha256']
        entry = assets['meshes'][body]
        entry['url'], entry['sha256'] = body_url, patch['body']['toSha256']
        applied += 1
        for item, row in pairs['items'].items():
            if row['body']['url'] != patch['body']['url']:
                raise SystemExit(f'skin pair {item} names another body: {row["body"]["url"]}')
            row['body']['url'] = body_url
            body_pairs += 1

    out_dir.mkdir(parents=True)
    (out_dir / 'assets.json').write_bytes(dump(assets))
    (out_dir / 'skin-pairs.json').write_bytes(dump(pairs) if body_pairs else pairs_path.read_bytes())
    print(json.dumps({'mode': 'garments-only' if garments_only else 'with-body', 'meshesRepointed': applied,
                      'skinPairsRewritten': body_pairs, 'out': str(out_dir),
                      'assetsSha256': sha(out_dir / 'assets.json'),
                      'skinPairsSha256': sha(out_dir / 'skin-pairs.json')}, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
