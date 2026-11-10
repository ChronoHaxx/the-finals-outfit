"""SEO basics refresh (6 Nov 2026): cut the two link-card panels out of og-card-capture.mjs renders. Each crop is sized
from the figure's bounding box (background = the per-row colour of the render's edge columns) and the studio gradient
is extended vertically when the figure needs it, so nothing is clipped. Panels are written at 2x the card's panel size;
og-card-compose.mjs lays them out. Refuses to overwrite.
  python -I -X utf8 _docs/seo-2026-11-06/og-card-panels.py RENDERS WORK_DIR"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

renders, work = Path(sys.argv[1]), Path(sys.argv[2])
PANELS = ['sentinel.y-36.t2.png', 'street.y0.t2.png']
PW, PH = 316 * 2, 566 * 2  # the card's panel size (og-card-compose.mjs), at 2x
if work.exists(): raise SystemExit(f'Preserve {work}')
work.mkdir(parents=True)

def framed(im):
    a = np.asarray(im, np.float32)
    bg = (a[:, :8].mean(axis=1, keepdims=True) + a[:, -8:].mean(axis=1, keepdims=True)) / 2
    fg = np.abs(a - bg).max(axis=2) > 18
    ys, xs = np.nonzero(fg)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    margin = 0.05 * (y1 - y0)
    cw = (x1 - x0) + 2 * margin
    ch = max((y1 - y0) + 2 * margin, cw * PH / PW)
    cw = ch * PW / PH
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left, top = round(cx - cw / 2), round(cy - ch / 2)
    if left < 0 or left + round(cw) > a.shape[1]: raise SystemExit('Figure too wide for the panel aspect')
    pad_top, pad_bottom = max(0, -top), max(0, top + round(ch) - a.shape[0])
    a = np.concatenate([np.repeat(a[:1], pad_top, axis=0), a, np.repeat(a[-1:], pad_bottom, axis=0)], axis=0)
    top += pad_top
    out = Image.fromarray(a[top:top + round(ch), left:left + round(cw)].clip(0, 255).astype(np.uint8))
    return out.resize((PW, PH), Image.LANCZOS), (x0, y0, x1, y1)

for k, name in enumerate(PANELS):
    panel, box = framed(Image.open(renders / name).convert('RGB'))
    panel.save(work / f'panel-{k + 1}.png')
    print(name, 'figure box', box, '->', work / f'panel-{k + 1}.png')
