"""Live vs preview capture diffs (S12 item refresh tier 1, 12 Nov 2026).

For every shot capture-review.mjs took on both servers: how many pixels differ beyond the capture noise, by how much,
and where. Writes diff.json, and for each shot with a difference a pair image (live | preview | difference x AMP on a
dimmed live frame) cropped to the changed region plus a margin, at full resolution, for looking at.

The numbers only find where to look; whether a difference is acceptable is judged by eye on the pair images
(verify-by-looking). Noise: a repeated capture of the same frame on one server differs in about 20 pixels by 1 level,
so NOISE = 1.

  python -I scripts/body-types/diff-captures.py CAPTURE_DIR OUT_DIR [--amp 30]

Refuses an existing non-empty OUT_DIR.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

NOISE = 1
MARGIN = 60


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int16)


def main(capture_dir, out_dir, amp=30):
    capture, out = Path(capture_dir), Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f'Preserve existing {out}')
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for live in sorted((capture / 'live').rglob('*.png')):
        rel = live.relative_to(capture / 'live')
        s12 = capture / 's12' / rel
        if not s12.exists():
            rows.append({'shot': rel.as_posix(), 'missing': 's12'})
            continue
        a, b = load(live), load(s12)
        d = np.abs(a - b).max(2)
        mask = d > NOISE
        row = {'shot': rel.as_posix(), 'pixels': int(mask.sum()), 'max': int(d.max()),
               'over8': int((d > 8).sum()), 'over32': int((d > 32).sum())}
        if mask.any():
            ys, xs = np.nonzero(mask)
            x0, y0 = max(0, xs.min() - MARGIN), max(0, ys.min() - MARGIN)
            x1, y1 = min(a.shape[1], xs.max() + MARGIN), min(a.shape[0], ys.max() + MARGIN)
            row['bbox'] = [int(x0), int(y0), int(x1), int(y1)]
            heat = (a * 0.35).astype(np.uint8)
            heat[..., 0] = np.maximum(heat[..., 0], np.clip(d * amp, 0, 255).astype(np.uint8))
            tiles = [x[y0:y1, x0:x1].astype(np.uint8) for x in (a, b, heat)]
            pair = Image.fromarray(np.concatenate(tiles, 1))
            draw = ImageDraw.Draw(pair)
            for i, label in enumerate(('LIVE', 'PILOT', f'DIFF x{amp}')):
                draw.text((i * (x1 - x0) + 8, 6), f'{label}  {rel.as_posix()}', fill=(230, 40, 60))
            target = out / rel.with_suffix('').as_posix().replace('/', '__')
            pair.save(f'{target}.png')
            row['pair'] = f'{target.name}.png'
        rows.append(row)
    (out / 'diff.json').write_text(json.dumps(rows, indent=1) + '\n', encoding='utf-8')
    changed = [r for r in rows if r.get('pixels')]
    print(json.dumps({'shots': len(rows), 'changed': len(changed), 'over8': sum(1 for r in rows if r.get('over8')),
                      'missing': sum(1 for r in rows if 'missing' in r), 'out': str(out)}))


if __name__ == '__main__':
    a = sys.argv[1:]
    opts = dict(zip(a[2::2], a[3::2]))
    main(a[0], a[1], int(opts.get('--amp', 30)))
