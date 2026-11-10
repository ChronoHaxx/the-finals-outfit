// Per-pose ground truth for the moving view (6 Nov 2026, hair motion vectors). The pause-and-compare probe mixed real
// smudge with the pose shift of the pause itself; this one replays a clip deterministically instead.
// - The dev clock (window.__rigAnim.clock, AnimationControls frameClock) advances the animation exactly 1/60 s per
//   rendered frame and counts the steps, so every run reaches the same poses whatever the machine's frame rate.
// - Reference run: at each scored step the clock freezes there; the view then counts as still and the still path
//   converges (32 samples) on exactly that pose. That frame is the truth.
// - Moving runs (one per quality): the same steps without freezing; the presented frame at each scored step is scored
//   against the truth over the hair (dark covered pixels of the truth, dilated 2 px) and over the whole character.
// Scores are luma levels (/255) of the frame composited over white, as the page shows it.
// Usage: TEMPORAL_BASE=http://127.0.0.1:5181 node scripts/anim-export/probe-truth.mjs <clip> [qualities, default
//   balanced,high; an entry may be label=query, e.g. high-b8=high&rpBlend=0.125] [steps, default 30,60,90,120,180,240]   (TRUTH_OUT sets the output folder)
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [clip = "outfit-idle", qualityList = "balanced,high", stepList = "30,60,90,120,180,240"] = process.argv.slice(2);
// A quality entry is a label, optionally with its own query: "high", or "high-b8=high&rpBlend=0.125".
// Split at the first "=" only: the query itself holds "=" (10 Nov fix; "high-b8=high&rpBlend=0.125" used to lose rpBlend).
const qualities = qualityList.split(",").map(entry => { const at = entry.indexOf("="); return at < 0 ? { label: entry, query: entry } : { label: entry.slice(0, at), query: entry.slice(at + 1) }; }), steps = stepList.split(",").map(Number);
const BASE = process.env.TEMPORAL_BASE ?? "http://127.0.0.1:5181";
const CAM = process.env.TRUTH_CAM ?? "0.55,1.72,0.75,0,1.62,-0.05";
const OUT = join(process.env.TRUTH_OUT ?? "scripts/generated/anim-export/truth", clip);
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh",
  feet: "casual-tallsneakers-canvas", hair: process.env.HAIR ?? "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(query, freeze) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${CAM}&anim=0&quality=${query}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && !!window.__temporalPreview", null, { timeout: 180000 });
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
        // Frozen: wait for the still path to converge (and, in High, its crossfade to finish).
        if (freeze && (status.motion || status.samples < status.maxSamples || status.fading)) return;
        shots[k] = gl.toDataURL("image/png");
        log.push({ k, motion: status.motion, samples: status.samples, motionFrames: status.motionFrames, reprojected: status.reprojected, reason: status.reason });
        pending.shift();
        if (freeze) clock.freezeAt = pending[0] ?? Infinity;
      };
      requestAnimationFrame(loop);
    });
    clock.fixed = null; clock.freezeAt = Infinity;
    return { shots, log };
  }, { clip, steps, freeze });
  await page.close();
  return { ...frames, errors };
}

const decode = async url => { const { data, info } = await sharp(Buffer.from(url.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const overWhite = (img, i) => { const a = img.data[4 * i + 3] / 255; return (.2126 * img.data[4 * i] + .7152 * img.data[4 * i + 1] + .0722 * img.data[4 * i + 2]) * a + 255 * (1 - a); };
function score(truth, frame) {
  const n = truth.w * truth.h, core = new Uint8Array(n), body = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = truth.data[4 * i + 3], l = .2126 * truth.data[4 * i] + .7152 * truth.data[4 * i + 1] + .0722 * truth.data[4 * i + 2];
    core[i] = a > 8 && l < 50 ? 1 : 0; body[i] = a > 8 || frame.data[4 * i + 3] > 8 ? 1 : 0;
  }
  const hair = new Uint8Array(n);
  for (let y = 0; y < truth.h; y++) for (let x = 0; x < truth.w; x++) {
    let m = 0;
    for (let dy = -2; dy <= 2 && !m; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < truth.w && yy < truth.h && core[yy * truth.w + xx]) { m = 1; break; }
    }
    hair[y * truth.w + x] = m;
  }
  const region = mask => { let c = 0, e = 0, off = 0; for (let i = 0; i < n; i++) if (mask[i]) { c++; const d = Math.abs(overWhite(frame, i) - overWhite(truth, i)); e += d; if (d > 16) off++; } return { pixels: c, error: +(e / c).toFixed(2), offBy16Pct: +(100 * off / c).toFixed(1) }; };
  return { hair: region(hair), body: region(body) };
}

const reference = await run("balanced", true);
for (const [k, url] of Object.entries(reference.shots)) writeFileSync(join(OUT, `truth-${k}.png`), Buffer.from(url.split(",")[1], "base64"));
const summary = { clip, steps, reference: { log: reference.log, errors: reference.errors }, runs: {} };
for (const { label: quality, query } of qualities) {
  const moving = await run(query, false);
  const rows = [];
  for (const k of steps) {
    const url = moving.shots[k];
    writeFileSync(join(OUT, `${quality}-${k}.png`), Buffer.from(url.split(",")[1], "base64"));
    rows.push({ k, ...score(await decode(reference.shots[k]), await decode(url)) });
  }
  const mean = key => +(rows.reduce((s, r) => s + r[key].error, 0) / rows.length).toFixed(2);
  const meanOff = key => +(rows.reduce((s, r) => s + r[key].offBy16Pct, 0) / rows.length).toFixed(1);
  summary.runs[quality] = { hairError: mean("hair"), hairOffBy16Pct: meanOff("hair"), bodyError: mean("body"), bodyOffBy16Pct: meanOff("body"),
    rows, log: moving.log, errors: moving.errors };
  console.log(JSON.stringify({ clip, quality, hairError: mean("hair"), hairOffBy16Pct: meanOff("hair"), bodyError: mean("body"), errors: moving.errors.length }));
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
