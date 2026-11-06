"""Comparison sheets for the body-type review captures (capture-review.mjs output).

One sheet per outfit and camera: rows are the body types, columns live vs Season 12 preview, each tile labelled.
Tiles are cropped to the centre CROP fraction (the character), never resampled up.

  python -I scripts/body-types/review-sheets.py CAPTURE_DIR OUT_DIR [--crop 0.62] [--tile 700]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BODY_TYPES = ['masculine', 'feminine', 'androgynous']
SERVERS = ['live', 's12']


def main(capture_dir, out_dir, crop=0.62, tile=700):
    capture, out = Path(capture_dir), Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f'Preserve existing {out}')
    out.mkdir(parents=True, exist_ok=True)
    outfits = sorted({p.name for s in SERVERS for p in (capture / s).glob('*') if p.is_dir()})
    cameras = sorted({p.stem.split('-', 1)[1] for p in capture.glob('*/*/*.png')})
    for outfit in outfits:
        for camera in cameras:
            tiles = []
            for body in BODY_TYPES:
                row = []
                for server in SERVERS:
                    f = capture / server / outfit / f'{body}-{camera}.png'
                    if not f.exists():
                        row.append(None)
                        continue
                    im = Image.open(f).convert('RGB')
                    w, h = im.size
                    cw, ch = int(w * crop), int(h * min(1.0, crop * 1.25))
                    im = im.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2))
                    scale = min(1.0, tile / im.width)
                    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
                    ImageDraw.Draw(im).text((8, 6), f'{server.upper()}  {body}  {camera}', fill=(200, 20, 40))
                    row.append(im)
                tiles.append(row)
            sample = next(t for r in tiles for t in r if t is not None)
            sheet = Image.new('RGB', (sample.width * len(SERVERS), sample.height * len(BODY_TYPES)), (40, 40, 40))
            for r, row in enumerate(tiles):
                for c, im in enumerate(row):
                    if im is not None:
                        sheet.paste(im, (c * sample.width, r * sample.height))
            sheet.save(out / f'{outfit}-{camera}.png')
    print(f'{len(outfits) * len(cameras)} sheets -> {out}')


if __name__ == '__main__':
    a = sys.argv[1:]
    opts = dict(zip(a[2::2], a[3::2]))
    main(a[0], a[1], float(opts.get('--crop', 0.62)), int(opts.get('--tile', 700)))
