// Decal ghosting probe (10 Nov 2026). Feedback: on Low, garment print text smears while the idle plays and is stable
// when paused. Same deterministic rig as scripts/anim-export/probe-truth.mjs (fixed 1/60 s clock; the reference freezes
// at each scored step and lets the still path converge), but on a printed jacket, scored over the whole character and
// over "detail" pixels (where the truth has strong local contrast: print edges, seams, logos).
// Usage (Git Bash or PowerShell, worktree root, dev server on 5182):
//   node _docs/graphics-options-2026-11-10/probe-decal-ghost.mjs [qualities, default balanced,high] [steps]
//   env: PROBE_BASE (http://127.0.0.1:5182), PROBE_CAM (x,y,z,tx,ty,tz), PROBE_CLIP (outfit-idle), PROBE_DPR (1),
//        PROBE_OUT (scripts/generated/decal-ghost/<label>), PROBE_LABEL, PROBE_UPPER (jacket id)
// A quality entry is label or label=query (the query is appended to the URL, e.g. "low=quality=balanced").
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [qualityList = "balanced=quality=balanced,high=quality=high", stepList = "30,60,90,120,150,180"] = process.argv.slice(2);
const qualities = qualityList.split(",").map(entry => { const i = entry.indexOf("="); return i < 0 ? { label: entry, query: `quality=${entry}` } : { label: entry.slice(0, i), query: entry.slice(i + 1) }; });
const steps = stepList.split(",").map(Number);
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const CAM = process.env.PROBE_CAM ?? "0,1.3,1.35,0,1.3,0";
const CLIP = process.env.PROBE_CLIP ?? "outfit-idle";
const DPR = Number(process.env.PROBE_DPR ?? 1);
const LABEL = process.env.PROBE_LABEL ?? "chest";
const OUT = process.env.PROBE_OUT ?? join("scripts/generated/decal-ghost", LABEL);
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: process.env.PROBE_UPPER ?? "streetwear-oversizedbomberjacket-nylon-redurban",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(query, freeze) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: DPR });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${CAM}&anim=0&${query}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && !!window.__temporalPreview", null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(async ({ clip, steps, freeze }) => {
    const anim = window.__rigAnim, clock = anim.clock, status = window.__temporalPreview;
    const gl = document.querySelector("[data-viewer] canvas");
    const shots = {}, log = [];
    clock.fixed = 1 / 60; clock.freezeAt = Infinity;
    await anim.play(clip);
    clock.steps = 0;
    const pending = [...steps];
    if (freeze) clock.freezeAt = pending[0];
    await new Promise(resolve => {
      const loop = () => {
        const k = pending[0];
        if (k === undefined) { resolve(); return; }
        requestAnimationFrame(loop);
        if (clock.steps !== k) return;
        if (freeze && (status.motion || status.samples < status.maxSamples || status.fading)) return;
        shots[k] = gl.toDataURL("image/png");
        log.push({ k, motion: status.motion, samples: status.samples, motionFrames: status.motionFrames, reprojected: status.reprojected, reason: status.reason, w: status.width, h: status.height });
        pending.shift();
        if (freeze) clock.freezeAt = pending[0] ?? Infinity;
      };
      requestAnimationFrame(loop);
    });
    clock.fixed = null; clock.freezeAt = Infinity;
    return { shots, log };
  }, { clip: CLIP, steps, freeze });
  await page.close();
  return { ...frames, errors };
}

const decode = async url => { const { data, info } = await sharp(Buffer.from(url.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const luma = (img, i) => { const a = img.data[4 * i + 3] / 255; return (.2126 * img.data[4 * i] + .7152 * img.data[4 * i + 1] + .0722 * img.data[4 * i + 2]) * a + 255 * (1 - a); };
function score(truth, frame) {
  const { w, h } = truth, n = w * h, body = new Uint8Array(n), detail = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    body[i] = truth.data[4 * i + 3] > 8 || frame.data[4 * i + 3] > 8 ? 1 : 0;
    if (truth.data[4 * i + 3] < 250) continue; // inside the character only: silhouettes are not print detail
    let lo = 255, hi = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = luma(truth, i + dy * w + dx); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    detail[i] = hi - lo > 40 ? 1 : 0;
  }
  const region = mask => { let c = 0, e = 0, off = 0; for (let i = 0; i < n; i++) if (mask[i]) { c++; const d = Math.abs(luma(frame, i) - luma(truth, i)); e += d; if (d > 24) off++; } return { pixels: c, error: +(e / c).toFixed(2), offBy24Pct: +(100 * off / c).toFixed(1) }; };
  // Sharpness: gradient energy (central differences of luma) of the frame over the truth's, on detail pixels. 1 = as
  // sharp as the converged still frame; below 1 = softer (blur); above 1 = harsher (aliasing, noise).
  const gradient = (img, i) => { const gx = luma(img, i + 1) - luma(img, i - 1), gy = luma(img, i + w) - luma(img, i - w); return Math.sqrt(gx * gx + gy * gy); };
  let gf = 0, gt = 0;
  for (let i = 0; i < n; i++) if (detail[i]) { gf += gradient(frame, i); gt += gradient(truth, i); }
  return { detail: { ...region(detail), sharpness: +(gf / gt).toFixed(3) }, body: region(body) };
}

const reference = await run(qualities[0].query, true);
for (const [k, url] of Object.entries(reference.shots)) writeFileSync(join(OUT, `truth-${k}.png`), Buffer.from(url.split(",")[1], "base64"));
const summary = { clip: CLIP, cam: CAM, dpr: DPR, steps, reference: { log: reference.log, errors: reference.errors }, runs: {} };
for (const { label, query } of qualities) {
  const moving = await run(query, false);
  const rows = [];
  for (const k of steps) {
    const url = moving.shots[k];
    writeFileSync(join(OUT, `${label}-${k}.png`), Buffer.from(url.split(",")[1], "base64"));
    rows.push({ k, ...score(await decode(reference.shots[k]), await decode(url)) });
  }
  const mean = (key, f) => +(rows.reduce((s, r) => s + r[key][f], 0) / rows.length).toFixed(3);
  const result = { detailError: mean("detail", "error"), detailOffBy24Pct: mean("detail", "offBy24Pct"), sharpness: +mean("detail", "sharpness").toFixed(3), bodyError: mean("body", "error") };
  summary.runs[label] = { query, ...result, rows, log: moving.log, errors: moving.errors };
  console.log(JSON.stringify({ label, query, ...result, errors: moving.errors.length }));
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
