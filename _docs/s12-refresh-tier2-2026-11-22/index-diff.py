"""What changed between two assets.json files, by entry and field (tier 2, 23 Nov 2026).

The active index is one line of compact JSON since the Light apply, so a line diff says nothing. This lists every
changed mesh with the fields that changed, and every changed top-level block. Read-only.

  python -X utf8 -I index-diff.py OLD_ASSETS NEW_ASSETS
"""
import json
import sys
from pathlib import Path


def main(old_path, new_path):
    old, new = (json.loads(Path(p).read_text(encoding='utf-8')) for p in (old_path, new_path))
    blocks = sorted(k for k in set(old) | set(new) if k != 'meshes' and old.get(k) != new.get(k))
    added = sorted(set(new['meshes']) - set(old['meshes']))
    removed = sorted(set(old['meshes']) - set(new['meshes']))
    changed = {}
    for key in sorted(set(old['meshes']) & set(new['meshes'])):
        x, y = old['meshes'][key], new['meshes'][key]
        fields = sorted(f for f in set(x) | set(y) if x.get(f) != y.get(f))
        if fields:
            changed[key.rsplit('.', 1)[-1]] = fields
    by_fields = {}
    for name, fields in changed.items():
        by_fields.setdefault(' '.join(fields), []).append(name)
    print(json.dumps({'meshes': [len(old['meshes']), len(new['meshes'])], 'added': added, 'removed': removed,
                      'blocksChanged': blocks, 'meshesChanged': len(changed),
                      'byFields': {k: len(v) for k, v in sorted(by_fields.items())}}, indent=1))
    for fields, names in sorted(by_fields.items()):
        print(f'[{fields}]')
        for name in names:
            print(f'  {name}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
