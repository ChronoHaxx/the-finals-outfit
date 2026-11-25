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
its "from" URL and sha256; only url and sha256 change, plus bodyMaskUrl where the patch carries a bodyMask change
(tier 2, 23 Nov 2026): the entry must still name the old mask, and the new mask file must already be in place,
resolved from ACTIVE_DIR, with the patch's sha256. A "materials" section (batch C, 25 Nov 2026) repoints
assets.materials[source] the same way: the entry must still name the old file, the new one must be in place with its
sha256, and a source with materialVariants is refused. Files are read, changed and written back whole, keeping every
field and the source formatting, so nothing but the repointed values changes. Two formats are known: 2-space JSON with
CRLF (the diff is exactly the repointed lines) and compact JSON on one line (23 Nov 2026: the Light apply writes the
index that way); a file in any other format is refused.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


FORMATS = {
    'pretty-crlf': lambda obj: (json.dumps(obj, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8'),
    'compact': lambda obj: json.dumps(obj, separators=(',', ':')).encode('utf-8'),
    'compact-utf8': lambda obj: json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8'),
}


def dump(obj, fmt='pretty-crlf'):
    return FORMATS[fmt](obj)


def load_exact(path):
    """(object, format): the file must round-trip byte-exactly in one known format, which is kept on write."""
    raw = Path(path).read_bytes()
    obj = json.loads(raw)
    for fmt, write in FORMATS.items():
        if write(obj) == raw:
            return obj, fmt
    raise SystemExit(f'{path} does not round-trip byte-exactly in a known format; refusing to rewrite it')


def apply(patch, active_dir, body_url=None):
    """Check PATCH against the index in ACTIVE_DIR and apply it in memory (garments only unless body_url is given).
    Returns (assets bytes, skin-pairs bytes, counts), each file in its source format. Every stale or unexpected value
    raises SystemExit and nothing is written. make-refresh-patch.py calls this to state the expected result."""
    active_dir = Path(active_dir)
    assets_path, pairs_path = active_dir / 'assets.json', active_dir / 'skin-pairs.json'
    if sha(assets_path) != patch['activeIndexSha256']:
        raise SystemExit(f'{assets_path} moved since the patch was built; rebuild the candidate (HANDOFF.md)')
    if sha(pairs_path) != patch['activeSkinPairsSha256']:
        raise SystemExit(f'{pairs_path} moved since the patch was built; rebuild the candidate (HANDOFF.md)')
    (assets, assets_fmt), (pairs, pairs_fmt) = load_exact(assets_path), load_exact(pairs_path)
    body = patch['body']['source']

    applied = masks = 0
    for key, change in patch['meshes'].items():
        entry = assets['meshes'].get(key)
        if entry is None or entry['url'] != change['fromUrl'] or entry['sha256'] != change['fromSha256']:
            raise SystemExit(f'{key} no longer matches the patch; rebuild the candidate (HANDOFF.md)')
        if key == body:
            continue
        mask = change.get('bodyMask')
        if mask:
            if entry.get('bodyMaskUrl') != mask['fromUrl']:
                raise SystemExit(f'{key}: its body mask no longer matches the patch; rebuild the candidate')
            target = active_dir / mask['toUrl']
            if not target.is_file() or sha(target) != mask['toSha256']:
                raise SystemExit(f'{key}: the new body mask {target} is missing or differs; copy the tier-2 data first')
            entry['bodyMaskUrl'] = mask['toUrl']
            masks += 1
        entry['url'], entry['sha256'] = change['toUrl'], change['toSha256']
        applied += 1

    for key, change in patch.get('bodyMasks', {}).items():
        # Mask-only (tier 2, 23 Nov 2026): the mesh is already the file the mask was regenerated from.
        entry = assets['meshes'].get(key)
        if entry is None or entry['sha256'] != change['meshSha256'] or entry.get('bodyMaskUrl') != change['fromUrl']:
            raise SystemExit(f'{key} no longer matches the patch; rebuild the candidate')
        target = active_dir / change['toUrl']
        if not target.is_file() or sha(target) != change['toSha256']:
            raise SystemExit(f'{key}: the new body mask {target} is missing or differs; copy the tier-2 data first')
        entry['bodyMaskUrl'] = change['toUrl']
        masks += 1

    materials = 0
    variant_recipients = {json.loads(k)[0] for k in assets.get('materialVariants', {})}
    for source, change in patch.get('materials', {}).items():
        # Batch C (25 Nov 2026): a garment whose Season 12 UVs changed takes its 17 Nov material too. The entry must still
        # name the old material file, and the new one must already be in place with the patch's sha256. A parameter
        # variant built on the old material would keep the old layout, so a recipient with variants is refused.
        if assets.get('materials', {}).get(source) != change['fromUrl']:
            raise SystemExit(f'{source}: its material no longer matches the patch; rebuild the patch')
        if source in variant_recipients:
            raise SystemExit(f'{source}: has material variants, which this patch does not rebuild')
        target = active_dir / change['toUrl']
        if not target.is_file() or sha(target) != change['toSha256']:
            raise SystemExit(f'{source}: the new material {target} is missing or differs; copy the batch C data first')
        assets['materials'][source] = change['toUrl']
        materials += 1

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

    counts = {'mode': 'with-body' if body_url is not None else 'garments-only', 'meshesRepointed': applied,
              'bodyMasksRepointed': masks, 'materialsRepointed': materials, 'skinPairsRewritten': body_pairs,
              'assetsFormat': assets_fmt}
    return dump(assets, assets_fmt), (dump(pairs, pairs_fmt) if body_pairs else pairs_path.read_bytes()), counts


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
    assets_bytes, pairs_bytes, counts = apply(patch, active_dir, body_url)
    out_dir.mkdir(parents=True)
    (out_dir / 'assets.json').write_bytes(assets_bytes)
    (out_dir / 'skin-pairs.json').write_bytes(pairs_bytes)
    print(json.dumps({**counts, 'out': str(out_dir), 'assetsSha256': sha(out_dir / 'assets.json'),
                      'skinPairsSha256': sha(out_dir / 'skin-pairs.json')}, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
