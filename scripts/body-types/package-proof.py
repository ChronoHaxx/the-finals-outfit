"""Package proof across a game update (S12 item refresh tier 2, 23 Nov 2026).

The Season 12 rebuilds come from the probe's `assets` runs of 6 Nov (12.00 build), which record each package's sha256.
The game updated on 17 Nov. The probe's `package-hashes` mode hashes the same package bytes in today's containers
without loading them (no mapping needed). A mesh whose package is byte-identical still describes today's game; any
other is held (coordinator, 22 Nov).

  python -I package-proof.py OUT_JSON PACKAGE_HASHES_JSON ASSETS_JSON [ASSETS_JSON ...] [--list PUBLISH_LIST]

`all` has one row per mesh read; `--list` adds `batch` rows for the GLBs in a publish list. Refuses an existing
OUT_JSON, a package read twice with different hashes, and a package with companion bulk files (their bytes are not
in the old record).
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(out_json, hashes_json, assets_jsons, publish_list=None):
    out = Path(out_json)
    if out.exists():
        raise SystemExit(f'Preserve existing {out}')
    old = {}
    for f in assets_jsons:
        for row in json.loads(Path(f).read_text(encoding='utf-8')):
            if 'sha256' not in row:
                continue
            key = row['path'].lower()
            if key in old and old[key][1] != row['sha256']:
                raise SystemExit(f'{row["path"]}: two reads disagree')
            old[key] = (row['path'], row['sha256'])
    new = {row['request'].lower(): row for row in json.loads(Path(hashes_json).read_text(encoding='utf-8'))}
    rows = []
    for key, (path, before) in sorted(old.items()):
        now = new.get(key)
        if now is None:
            raise SystemExit(f'{path}: not in the new hashes')
        if now.get('companions'):
            raise SystemExit(f'{path}: has companion bulk files the old record does not cover')
        rows.append({'mesh': Path(path).stem, 'package': path, 'sha256_before': before, 'sha256_now': now.get('sha256'),
                     'bytes_now': now.get('bytes'), 'identical': now.get('sha256') == before,
                     **({'error': now['error']} if 'error' in now else {})})
    doc = {'note': 'Package bytes, before (the assets runs) vs now (package-hashes); no mapping used.',
           'inputs': {'packageHashes': sha(hashes_json), 'assets': {f: sha(f) for f in assets_jsons}},
           'all': rows}
    if publish_list:
        by_mesh = {row['mesh'].lower(): row for row in rows}
        names = [Path(line.strip()).stem for line in open(publish_list, encoding='utf-8') if line.strip()]
        doc['inputs']['publishList'] = sha(publish_list)
        doc['batch'] = [by_mesh[n.lower()] for n in names]
    out.write_text(json.dumps(doc, indent=1) + '\n', encoding='utf-8')
    same = sum(row['identical'] for row in rows)
    print(json.dumps({'packages': len(rows), 'identical': same, 'changed': len(rows) - same,
                      **({'batch': len(doc['batch']), 'batchChanged': [r['mesh'] for r in doc['batch'] if not r['identical']]}
                         if publish_list else {}), 'out': str(out)}))


if __name__ == '__main__':
    argv = sys.argv[1:]
    listed = None
    if '--list' in argv:
        i = argv.index('--list')
        listed = argv[i + 1]
        del argv[i:i + 2]
    main(argv[0], argv[1], argv[2:], listed)
