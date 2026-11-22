// Diff of the turned-character captures (turned-invariance.mjs) against the unturned one: mean absolute difference
// over pixels the character covers, the share over 16/255, and a heat map (diff-*.png, 8x scaled) per capture.
// Usage: node _docs/multi-character-2026-11-11/turned-diff.mjs _docs/multi-character-2026-11-11/shots
import sharp from "sharp";
import path from "node:path";
const dir = process.argv[2];
const load = async f => { const { data, info } = await sharp(path.join(dir, f)).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
for (const outfit of ["street", "cel"]) {
  const base = await load(`turn-${outfit}-0.png`);
  for (const other of [`turn-${outfit}-90-minus.png`, `turn-${outfit}-90-plus.png`, `turn-${outfit}-180.png`]) {
    const b = await load(other);
    const c = base.info.channels; let sum = 0, n = 0, over = 0, max = 0; const heat = Buffer.alloc(base.info.width * base.info.height);
    for (let i = 0, p = 0; i < base.data.length; i += c, p++) {
      const a = base.data[i + 3] ?? 255, bb = b.data[i + 3] ?? 255;
      if (a < 8 && bb < 8) continue; // both background (transparent canvas)
      const d = (Math.abs(base.data[i] - b.data[i]) + Math.abs(base.data[i + 1] - b.data[i + 1]) + Math.abs(base.data[i + 2] - b.data[i + 2])) / 3;
      sum += d; n++; if (d > 16) over++; if (d > max) max = d; heat[p] = Math.min(255, d * 8);
    }
    await sharp(heat, { raw: { width: base.info.width, height: base.info.height, channels: 1 } }).png().toFile(path.join(dir, `diff-${other}`));
    console.log(outfit, other, { pixels: n, meanAbs: +(sum / n).toFixed(2), over16pct: +(100 * over / n).toFixed(2), max });
  }
}
