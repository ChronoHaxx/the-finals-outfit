// Hair grain probe (6 Nov): the user sees grain on hair during ANY movement (idle, emotes), not only while the camera
// settles. Plays a clip on the dev server and records every presented frame of the whole canvas:
// - per-frame temporal noise = mean |f(t) - (f(t-1) + f(t+1)) / 2| of luma (steady motion cancels, per-frame noise
//   stays), and a noise map (that quantity averaged over the run, x8) to show WHERE the noise is;
// - three consecutive full frames, then Pause and a converged still frame of the same pose.
// Usage: node probe-hair-grain.mjs <label> <clip id> [extra query]   (PROBE_OUT sets the output folder)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [label = "idle", clip = "outfit-idle", extra = ""] = process.argv.slice(2);
const OUT = process.env.PROBE_OUT ?? "scripts/generated/anim-export/hair-grain";
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh",
  feet: "casual-tallsneakers-canvas", hair: process.env.HAIR ?? "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: +(process.env.VW ?? 1500), height: +(process.env.VH ?? 1000) }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:5181/?reconstructed=1&outfit=${outfit}&anim=${clip}${extra}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const gl = document.querySelector("[data-viewer] canvas");
  const s = window.__hair = { frames: [], keep: {}, keepAt: [], last: [], on: false, sum: null, n: 0, w: 0, h: 0 };
  const c = document.createElement("canvas"); const ctx = c.getContext("2d", { willReadFrequently: true });
  let a = null, b = null; // two previous lumas
  const loop = () => {
    requestAnimationFrame(loop);
    if (!s.on) return;
    const w = gl.width, h = gl.height; c.width = w; c.height = h; ctx.drawImage(gl, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data, n = w * h, luma = new Float32Array(n);
    for (let i = 0; i < n; i++) luma[i] = .2126 * px[4 * i] + .7152 * px[4 * i + 1] + .0722 * px[4 * i + 2];
    let noise = 0;
    if (a && b && !s.paused) {
      if (!s.sum) { s.sum = new Float32Array(n); s.w = w; s.h = h; }
      for (let i = 0; i < n; i++) { const r = Math.abs(b[i] - (a[i] + luma[i]) / 2); noise += r; s.sum[i] += r; }
      s.n++;
    }
    const i = s.frames.length;
    s.frames.push({ noise: noise / n, motion: !!window.__temporalPreview?.motion, samples: window.__temporalPreview?.samples,
      motionFrames: window.__temporalPreview?.motionFrames });
    if (s.keepAt.includes(i)) s.keep[i] = c.toDataURL("image/png");
    if (!s.paused) { s.last.push({ i, px: new Uint8ClampedArray(px), w, h }); if (s.last.length > 9) s.last.shift(); }
    a = b; b = luma;
  };
  requestAnimationFrame(loop);
});
await page.evaluate(() => { window.__hair.keepAt = []; window.__hair.on = true; });
await page.waitForTimeout(4000);
// Freeze: Pause holds the pose; the still path then converges on exactly the last moving pose.
const pauseAt = await page.evaluate(() => { const s = window.__hair; s.paused = true; s.keepAt.push(s.frames.length + 120); return s.frames.length; });
const paused = await page.getByRole("button", { name: /^Pause$/ }).first().click({ timeout: 5000 }).then(() => true).catch(() => false);
await page.waitForTimeout(2500);
const r = await page.evaluate(() => { const s = window.__hair; s.on = false;
  // Noise map: mean residual per pixel over the moving frames, x8, as a grey PNG.
  const c = document.createElement("canvas"); c.width = s.w; c.height = s.h; const ctx = c.getContext("2d");
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.w * s.h; i++) { const v = Math.min(255, 8 * s.sum[i] / s.n); img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = 255 - v; img.data[4 * i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  for (const f of s.last) { const k = document.createElement("canvas"); k.width = f.w; k.height = f.h;
    k.getContext("2d").putImageData(new ImageData(f.px, f.w, f.h), 0, 0); s.keep[`moving${f.i}`] = k.toDataURL("image/png"); }
  return { frames: s.frames, keep: s.keep, map: c.toDataURL("image/png") }; });
const moving = r.frames.slice(5, pauseAt - 1), still = r.frames.slice(pauseAt + 60);
const mean = (l, k) => +(l.reduce((s, f) => s + (f[k] ?? 0), 0) / Math.max(1, l.length)).toFixed(3);
const summary = { label, clip, extra, paused, frames: r.frames.length, pauseAt,
  movingNoise: mean(moving, "noise"), movingMotionShare: +(moving.filter(f => f.motion).length / Math.max(1, moving.length)).toFixed(2),
  stillNoise: mean(still, "noise"), stillSamples: still.at(-1)?.samples };
writeFileSync(join(OUT, `${label}.json`), JSON.stringify({ summary, frames: r.frames }, null, 1));
writeFileSync(join(OUT, `${label}-noisemap.png`), Buffer.from(r.map.split(",")[1], "base64"));
for (const [k, url] of Object.entries(r.keep)) writeFileSync(join(OUT, `${label}-f${k}.png`), Buffer.from(url.split(",")[1], "base64"));
console.log(JSON.stringify(summary));
await browser.close();
