// Flicker probe (6 Nov): drag the view, release, and record every presented frame while the orbit damping settles.
// For each frame the page copies a crop of the WebGL canvas (same frame, before presentation) and measures, per pixel,
// how much the change since the previous frame REVERSES the change before it: flicker oscillates, a steady pan or a
// slow idle sway does not. Usage: node probe-flicker.mjs <label> [extra query, e.g. "&anim=outfit-idle"] [--resize]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [label = "run", extra = "", ...flags] = process.argv.slice(2);
const RESIZE = flags.includes("--resize");
const OUT = process.env.PROBE_OUT ?? "scripts/generated/anim-export/flicker";
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh",
  feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:5181/?reconstructed=1&outfit=${outfit}${extra}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.waitForTimeout(2500);
const box = await page.locator("[data-viewer] canvas").first().boundingBox();
// Recorder: a rAF loop registered after R3F's draws the canvas crop into a 2D canvas each frame.
await page.evaluate(() => {
  const gl = document.querySelector("[data-viewer] canvas");
  const s = window.__flicker = { frames: [], keep: [], on: false };
  const c = document.createElement("canvas"); const ctx = c.getContext("2d", { willReadFrequently: true });
  let prev = null, prevDelta = null;
  const loop = () => {
    requestAnimationFrame(loop);
    if (!s.on) return;
    // Crop: the middle 40% x 70% of the canvas (head to knees).
    const w = Math.round(gl.width * .4), h = Math.round(gl.height * .7), x = Math.round(gl.width * .3), y = Math.round(gl.height * .1);
    c.width = w; c.height = h; ctx.drawImage(gl, x, y, w, h, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data, n = w * h;
    const luma = new Float32Array(n);
    for (let i = 0; i < n; i++) luma[i] = .2126 * px[4 * i] + .7152 * px[4 * i + 1] + .0722 * px[4 * i + 2];
    let change = 0, reversal = 0, reversing = 0;
    const delta = prev ? new Float32Array(n) : null;
    if (prev) for (let i = 0; i < n; i++) {
      const d = luma[i] - prev[i]; delta[i] = d; change += Math.abs(d);
      if (prevDelta) { const r = -d * prevDelta[i]; if (r > 0) { reversal += Math.sqrt(r); if (r > 25) reversing++; } }
    }
    s.frames.push({ t: performance.now(), change: change / n, reversal: reversal / n, reversingPct: 100 * reversing / n,
      motion: !!window.__temporalPreview?.motion, samples: window.__temporalPreview?.samples, motionFrames: window.__temporalPreview?.motionFrames, reason: window.__temporalPreview?.reason, resets: window.__temporalPreview?.resets });
    if (s.keep.length < 400) s.keep.push(c.toDataURL("image/png"));
    prev = luma; prevDelta = delta;
  };
  requestAnimationFrame(loop);
});
const cx = box.x + box.width / 2, cy = box.y + box.height * .45;
await page.evaluate(() => { window.__flicker.on = true; });
await page.waitForTimeout(500); // baseline: camera still
const mark = await page.evaluate(() => window.__flicker.frames.length);
if (RESIZE) {
  await page.setViewportSize({ width: 1000, height: 770 }); // like a browser bar appearing
} else {
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 22, cy); await page.waitForTimeout(16); }
  await page.mouse.up();
}
const release = await page.evaluate(() => window.__flicker.frames.length);
await page.waitForTimeout(3000);
const result = await page.evaluate(() => { window.__flicker.on = false; return window.__flicker; });
const frames = result.frames.map((f, i) => ({ i, ...f, t: Math.round(f.t - result.frames[0].t) }));
const span = (a, b) => frames.slice(a, b).filter(f => f.i > 1);
const mean = (list, k) => list.reduce((s, f) => s + f[k], 0) / Math.max(1, list.length);
const summary = { label, extra, resize: RESIZE, frames: frames.length, release,
  baseline: { n: span(0, mark).length, reversal: +mean(span(0, mark), "reversal").toFixed(3), reversingPct: +mean(span(0, mark), "reversingPct").toFixed(2) },
  settle: { n: span(release, release + 90).length, reversal: +mean(span(release, release + 90), "reversal").toFixed(3), reversingPct: +mean(span(release, release + 90), "reversingPct").toFixed(2),
    peakReversingPct: +Math.max(...span(release, release + 90).map(f => f.reversingPct)).toFixed(2) } };
writeFileSync(join(OUT, `${label}.json`), JSON.stringify({ summary, frames }, null, 1));
// Keep three consecutive settle frames for looking, from the worst reversal after release.
const worst = span(release, release + 90).sort((a, b) => b.reversingPct - a.reversingPct)[0];
if (worst) for (const k of [worst.i - 1, worst.i, worst.i + 1]) {
  const url = result.keep[k]; if (url) writeFileSync(join(OUT, `${label}-f${k}.png`), Buffer.from(url.split(",")[1], "base64"));
}
// And the first still frame with 2 samples in the damping tail, with its neighbours (the frames the scale bug flashed).
const two = frames.find(f => f.i > release + 30 && f.samples === 2);
if (two) for (const k of [two.i - 1, two.i, two.i + 1]) {
  const url = result.keep[k]; if (url) writeFileSync(join(OUT, `${label}-two-f${k}-s${frames[k].samples}.png`), Buffer.from(url.split(",")[1], "base64"));
}
console.log(JSON.stringify(summary));
await browser.close();
