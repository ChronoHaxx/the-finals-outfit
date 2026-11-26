"""Pair Light | Medium T-shirt shots (id.class.pose.view.png), central 700 px of each frame, native pixels."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
rows = json.loads((src / "report.json").read_text(encoding="utf-8"))
seen = set()
for r in rows:
    key = (r["id"], r["pose"], r["view"])
    if key in seen:
        continue
    seen.add(key)
    a, b = (src / f"{r['id']}.{c}.{r['pose']}.{r['view']}.png" for c in ("light", "medium"))
    if not (a.exists() and b.exists()):
        continue
    sheet = Image.new("RGB", (1400, 1100), "white")
    for i, f in enumerate((a, b)):
        im = Image.open(f).convert("RGB")
        x0 = (im.width - 700) // 2
        sheet.paste(im.crop((x0, 0, x0 + 700, im.height)), (i * 700, 0))
    d = ImageDraw.Draw(sheet)
    d.text((10, 10), f"LIGHT {r['id']} {r['pose']} {r['view']}", fill="black")
    d.text((710, 10), "MEDIUM", fill="black")
    d.line((700, 0, 700, 1100), fill="black")
    sheet.save(out / f"{r['id']}.{r['pose']}.{r['view']}.png")
print(len(seen), "pairs")
