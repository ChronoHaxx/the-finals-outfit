// Live check for PR #25 (6 Nov): on the deployed site, does the still view still flash after a resize?
// Under automation the viewer opens still (navigator.webdriver), so this measures the still path. Production has no
// __temporalPreview, so the probe reads only the canvas: a crop's mean luma and mean per-pixel change on every frame
// around a 30 px viewport shrink (like Firefox's Alt bar). With the #22 bug, frames 2-4 after the resize were drawn
// 2x / 1.5x / 1.33x bright: a jump UP in mean luma right after the resize, then a decay.
//   node scripts/generated/anim-export/live-flicker-check.mjs [url]   (writes live-flicker-check.json + PNGs beside it)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "https://chronohaxx.github.io/the-finals-outfit/";
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh",
  feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
const result = { url: BASE };
try {
  const resp = await page.goto(`${BASE}?outfit=${outfit}`, { waitUntil: "load", timeout: 180000 });
  result.bundle = (await page.content()).match(/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
  result.status = resp?.status();
  await page.keyboard.press("Escape");
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 180000 });
  result.animateButton = await page.getByRole("button", { name: /^(Animate|Animated)$/ }).first().textContent().catch(() => null);
  await page.waitForTimeout(8000); // converge
  await page.evaluate(() => {
    const gl = document.querySelector("[data-viewer] canvas");
    const s = window.__live = { frames: [], keep: [], on: false };
    const c = document.createElement("canvas"); const ctx = c.getContext("2d", { willReadFrequently: true });
    let prev = null;
    const loop = () => {
      requestAnimationFrame(loop);
      if (!s.on) return;
      const w = Math.round(gl.width * .4), h = Math.round(gl.height * .7), x = Math.round(gl.width * .3), y = Math.round(gl.height * .1);
      c.width = w; c.height = h; ctx.drawImage(gl, x, y, w, h, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data, n = w * h, luma = new Float32Array(n);
      let sum = 0, change = 0;
      for (let i = 0; i < n; i++) { luma[i] = .2126 * px[4 * i] + .7152 * px[4 * i + 1] + .0722 * px[4 * i + 2]; sum += luma[i]; }
      if (prev && prev.length === n) for (let i = 0; i < n; i++) change += Math.abs(luma[i] - prev[i]);
      s.frames.push({ mean: +(sum / n).toFixed(2), change: prev && prev.length === n ? +(change / n).toFixed(2) : null, w: gl.width, h: gl.height });
      if (s.keep.length < 120) s.keep.push(c.toDataURL("image/png"));
      prev = luma;
    };
    requestAnimationFrame(loop);
  });
  await page.evaluate(() => { window.__live.on = true; });
  await page.waitForTimeout(500);
  const mark = await page.evaluate(() => window.__live.frames.length);
  await page.setViewportSize({ width: 1000, height: 770 });
  await page.waitForTimeout(2000);
  const live = await page.evaluate(() => { window.__live.on = false; return window.__live; });
  const frames = live.frames.map((f, i) => ({ i, ...f }));
  const first = frames.findIndex((f, i) => i >= mark && f.h !== frames[mark - 1].h); // first frame at the new size
  const settled = frames.at(-1).mean;
  const after = frames.slice(first, first + 8);
  result.resizeFrame = first;
  result.settledMean = settled;
  result.afterResize = after.map(f => ({ i: f.i, mean: f.mean, vsSettled: +(f.mean - settled).toFixed(2), change: f.change }));
  result.maxBrighterThanSettled = Math.max(...after.map(f => f.mean - settled)).toFixed(2);
  result.beforeResizeChange = +(frames.slice(1, mark).reduce((s, f) => s + (f.change ?? 0), 0) / Math.max(1, mark - 1)).toFixed(2);
  for (const k of [first, first + 1, first + 2, frames.length - 1]) {
    const url = live.keep[k]; if (url) writeFileSync(join(here, `live-flicker-f${k}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
} catch (e) { result.error = String(e).slice(0, 300); }
result.errors = [...new Set(errors)].slice(0, 8);
writeFileSync(join(here, "live-flicker-check.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
