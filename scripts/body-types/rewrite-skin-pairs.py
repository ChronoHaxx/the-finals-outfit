"""Preview skin-pairs.json for the Season 12 body-type review (6 Nov 2026).

Faces load their head mesh through skin-pairs.json (items[*].head.url), not through assets.json. This copies the active
skin-pairs.json and replaces exactly the URLs that build-preview-index.py swapped: the s12BodyTypePreview.swapped map in
the preview assets.json, from the live URL to the proven morph-only Season 12 rebuild. Any other value stays as it is.

  python -I scripts/body-types/rewrite-skin-pairs.py ACTIVE_SKIN_PAIRS PREVIEW_ASSETS_JSON OUT_SKIN_PAIRS

Refuses an existing output.
"""
import json
import sys
from pathlib import Path


def main(active_pairs, preview_assets, out_path):
    out = Path(out_path)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    swapped = json.loads(Path(preview_assets).read_text(encoding='utf-8'))['s12BodyTypePreview']['swapped']
    urls = {row['from']: row['to'] for row in swapped.values()}
    count = 0

    def rewrite(value):
        nonlocal count
        if isinstance(value, dict):
            return {k: rewrite(v) for k, v in value.items()}
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, str) and value in urls:
            count += 1
            return urls[value]
        return value

    pairs = rewrite(json.loads(Path(active_pairs).read_text(encoding='utf-8')))
    out.write_text(json.dumps(pairs, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'rewritten': count, 'out': str(out)}))


if __name__ == '__main__':
    main(*sys.argv[1:4])
