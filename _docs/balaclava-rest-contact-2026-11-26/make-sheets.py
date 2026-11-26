"""Contact sheets and the push table for the rest-contact PR, from sweep.mjs output.
  python make-sheets.py <fix dir> <base dir> <out dir>
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

FIX, BASE, OUT = map(Path, sys.argv[1:4])
OUT.mkdir(parents=True, exist_ok=True)
FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
CROP = (100, 140, 636, 720)
TILE = (240, 260)
FACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30, 31, 32]


def rows(d):
    out = {}
    for line in (d / 'sweep.jsonl').read_text(encoding='utf-8').splitlines():
        r = json.loads(line); out[r['name']] = r
    return out


fix, base = rows(FIX), rows(BASE) if (BASE / 'sweep.jsonl').exists() else {}


def push(r):
    return max([p['pushMm'] for p in r.get('parts', [])] or [0])


def tile(path, label, red=False, crop=CROP, size=TILE):
    im = Image.open(path).convert('RGB').crop(crop).resize(size, Image.LANCZOS)
    d = ImageDraw.Draw(im)
    w = d.textlength(label, font=FONT) + 10
    d.rectangle((0, 0, w, 22), fill=(200, 30, 45) if red else (30, 30, 30))
    d.text((5, 3), label, font=FONT, fill='white')
    return im


def sheet(tiles, cols, name):
    w, h = tiles[0].size
    out = Image.new('RGB', (w * cols, h * ((len(tiles) + cols - 1) // cols)), 'white')
    for i, t in enumerate(tiles): out.paste(t, ((i % cols) * w, (i // cols) * h))
    out.save(OUT / name, quality=88)
    print(name, out.size)


table = {}
for tag in ['m-black', 'm-leo', 'a-black', 'a-leo']:
    tiles = []
    for n in FACES:
        r = fix.get(f'{tag}-f{n:02d}')
        if not r or 'failed' in r: continue
        p = push(r); table.setdefault(n, {})[tag] = p
        tiles.append(tile(FIX / f'{tag}-f{n:02d}.png', f'Face {n:02d}  {p:.2f} mm' if p else f'Face {n:02d}', red=p > 0))
    sheet(tiles, 6, f'after-all-faces-{tag}.jpg')
    # before | after for the faces the contact changed
    pairs = []
    for n in FACES:
        r = fix.get(f'{tag}-f{n:02d}'); b = base.get(f'{tag}-f{n:02d}')
        if not r or not b or push(r) == 0: continue
        pairs += [tile(BASE / f'{tag}-f{n:02d}.png', f'Face {n:02d} before'),
                  tile(FIX / f'{tag}-f{n:02d}.png', f'after ({push(r):.2f} mm)', red=True)]
    if pairs: sheet(pairs, 6, f'before-after-{tag}.jpg')

extra = []
for name in sorted(fix):
    if not name.startswith(('jawc-', 'jaw-', 'beard', 'cow-', 'win-', 'lucha-')): continue
    r, b = fix[name], base.get(name)
    row = {'name': name, 'fixPushMm': {p['mesh']: p['pushMm'] for p in r.get('parts', [])}, 'errors': r.get('errors')}
    if b and (BASE / f'{name}.png').exists() and (FIX / f'{name}.png').exists():
        a, c = Image.open(BASE / f'{name}.png').convert('RGB'), Image.open(FIX / f'{name}.png').convert('RGB')
        if a.size == c.size:
            diff = ImageChops.difference(a, c).convert('L').point(lambda v: 255 if v > 8 else 0)
            row['pixelsDiffering'] = sum(1 for v in diff.getdata() if v)
    extra.append(row)
(OUT / 'sweep-summary.json').write_text(json.dumps({'pushMmByFace': table, 'other': extra}, indent=1), encoding='utf-8')

for group, names, crop in [('jaw', [f'jawc-f{n:02d}' for n in (1, 23, 30, 32)], (60, 60, 676, 760)),
                           ('beard-scarf', [f'{k}-f{n:02d}' for k in ('beard', 'beardscarf') for n in (1, 23, 32)], CROP)]:
    tiles = []
    for name in names:
        if name in base and (BASE / f'{name}.png').exists():
            tiles.append(tile(BASE / f'{name}.png', f'{name} before', crop=crop))
        if name in fix:
            p = push(fix[name])
            tiles.append(tile(FIX / f'{name}.png', f'after ({p:.2f} mm)' if p else 'after', red=p > 0, crop=crop))
    if tiles: sheet(tiles, 6, f'{group}.jpg')
