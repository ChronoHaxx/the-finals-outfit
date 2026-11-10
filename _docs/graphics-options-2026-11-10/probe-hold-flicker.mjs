// Held-pose flicker (10 Nov 2026). A shorter history on opaque pixels follows motion better but averages fewer jittered
// samples, so fine print can shimmer while the view is on the moving path. The clock freezes at a step with
// `frozenMoving` (the pose holds but the view keeps drawing as moving), and 24 consecutive frames are captured.
// Scores, on detail pixels of the printed jacket (3x3 truth contrast > 40 levels): mean |frame - previous frame| (flicker)
// and mean |frame - converged still frame| (error), in luma levels.
// Usage (worktree root, dev server on 5182): node _docs/graphics-options-2026-11-10/probe-hold-flicker.mjs [label=query,...]
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [list = "high=quality=high"] = process.argv.slice(2);
const runs = list.split(",").map(entry => { const i = entry.indexOf("="); return { label: entry.slice(0, i), query: entry.slice(i + 1) }; });
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const CAM = process.env.PROBE_CAM ?? "0,1.3,1.35,0,1.3,0";
const STEP = Number(process.env.PROBE_STEP ?? 90);
const OUT = join("scripts/generated/decal-ghost", process.env.PROBE_LABEL ?? "hold");
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function capture(query, still) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${CAM}&anim=0&${query}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && !!window.__temporalPreview", null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const shots = await page.evaluate(async ({ step, still }) => {
    const anim = window.__rigAnim, clock = anim.clock, status = window.__temporalPreview;
    const gl = document.querySelector("[data-viewer] canvas");
    clock.fixed = 1 / 60; clock.freezeAt = step; clock.frozenMoving = !still;
    await anim.play("outfit-idle");
    clock.steps = 0;
    const shots = [];
    await new Promise(resolve => {
      let held = 0;
      const loop = () => {
        requestAnimationFrame(loop);
        if (clock.steps < step) return;
        if (still) { if (status.motion || status.samples < status.maxSamples || status.fading) return; shots.push(gl.toDataURL("image/png")); resolve(); return; }
        if (++held <= 40) return; // let the held moving average settle first
        shots.push(gl.toDataURL("image/png"));
        if (shots.length >= 24) resolve();
      };
      requestAnimationFrame(loop);
    });
    clock.fixed = null; clock.freezeAt = Infinity; clock.frozenMoving = false;
    return shots;
  }, { step: STEP, still });
  await page.close();
  return shots;
}
const decode = async url => { const { data, info } = await sharp(Buffer.from(url.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const luma = (img, i) => { const a = img.data[4 * i + 3] / 255; return (.2126 * img.data[4 * i] + .7152 * img.data[4 * i + 1] + .0722 * img.data[4 * i + 2]) * a + 255 * (1 - a); };

const summary = { step: STEP, cam: CAM, runs: {} };
for (const { label, query } of runs) {
  const [truthUrl] = await capture(query, true);
  const truth = await decode(truthUrl);
  writeFileSync(join(OUT, `${label}-truth.png`), Buffer.from(truthUrl.split(",")[1], "base64"));
  const { w, h } = truth, detail = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (truth.data[4 * i + 3] < 250) continue;
    let lo = 255, hi = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = luma(truth, i + dy * w + dx); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    if (hi - lo > 40) detail.push(i);
  }
  const frames = await Promise.all((await capture(query, false)).map(decode));
  let flicker = 0, error = 0;
  for (let f = 0; f < frames.length; f++) for (const i of detail) {
    error += Math.abs(luma(frames[f], i) - luma(truth, i));
    if (f) flicker += Math.abs(luma(frames[f], i) - luma(frames[f - 1], i));
  }
  summary.runs[label] = { query, detailPixels: detail.length, flicker: +(flicker / ((frames.length - 1) * detail.length)).toFixed(3), error: +(error / (frames.length * detail.length)).toFixed(3) };
  console.log(JSON.stringify({ label, ...summary.runs[label] }));
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
