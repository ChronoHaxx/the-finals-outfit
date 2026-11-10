// Hair-region stats for probe-hair-grain.mjs output: hair mask = dark covered pixels of the converged still frame
// (luma < 50, alpha > 8) dilated by 2 px (to include edges). For the 9 moving frames before Pause:
// - error vs still: mean |moving - still| (luma of the frame composited over white, as the page shows it), and the
//   share of hair pixels off by more than 16 levels;
// - shimmer: per-pixel standard deviation over the 9 frames, mean over the mask.
// Usage: node hair-grain-stats.mjs <label>   (reads scripts/generated/anim-export/hair-grain/<label>-*.png)
import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2]; const d = "scripts/generated/anim-export/hair-grain";
const files = readdirSync(d);
const moving = files.filter(f => f.startsWith(`${label}-fmoving`)).sort((a, b) => parseInt(a.match(/moving(\d+)/)[1]) - parseInt(b.match(/moving(\d+)/)[1]));
const still = files.find(f => new RegExp(`^${label}-f\\d+\\.png$`).test(f));
const load = async f => { const { data, info } = await sharp(join(d, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const S = await load(still); const n = S.w * S.h;
const overWhite = (img, i) => { const a = img.data[4 * i + 3] / 255; const l = .2126 * img.data[4 * i] + .7152 * img.data[4 * i + 1] + .0722 * img.data[4 * i + 2]; return l * a + 255 * (1 - a); };
const core = new Uint8Array(n);
for (let i = 0; i < n; i++) { const a = S.data[4 * i + 3]; const l = .2126 * S.data[4 * i] + .7152 * S.data[4 * i + 1] + .0722 * S.data[4 * i + 2]; core[i] = a > 8 && l < 50 ? 1 : 0; }
const mask = new Uint8Array(n);
for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) { let m = 0; for (let dy = -2; dy <= 2 && !m; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < S.w && yy < S.h && core[yy * S.w + xx]) { m = 1; break; } } mask[y * S.w + x] = m; }
const M = await Promise.all(moving.map(load));
let count = 0, err = 0, off = 0, sd = 0;
for (let i = 0; i < n; i++) if (mask[i]) {
  count++; const s = overWhite(S, i); const v = M.map(m => overWhite(m, i));
  const last = v.at(-1); err += Math.abs(last - s); if (Math.abs(last - s) > 16) off++;
  const mu = v.reduce((a, b) => a + b, 0) / v.length; sd += Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length);
}
const out = { label, still, moving: moving.length, hairPixels: count, errorVsStill: +(err / count).toFixed(2), offBy16Pct: +(100 * off / count).toFixed(1), shimmerSd: +(sd / count).toFixed(2) };
writeFileSync(join(d, `${label}-stats.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
