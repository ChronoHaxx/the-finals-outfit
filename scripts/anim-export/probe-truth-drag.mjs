// Ground truth for a drag in the still pose (6 Nov 2026, hair motion vectors): the character root turns along a damped
// curve (fast, then easing out like OrbitControls' damping: 0.06 rad on the first frame, x0.9 per frame), one step per
// rendered frame. Reference run: at each scored step the turn holds and the still path converges; moving runs (one
// per quality) keep turning. Scored over the hair and the whole character as in probe-truth.mjs; also reports the
// still view's sample count at each step (Balanced restarts from one sample on every move; High reprojects).
// Usage: TEMPORAL_BASE=http://127.0.0.1:5181 node scripts/anim-export/probe-truth-drag.mjs [qualities] [steps]
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [qualityList = "balanced,high", stepList = "3,6,10,15,22,30,45,70"] = process.argv.slice(2);
const qualities = qualityList.split(","), steps = stepList.split(",").map(Number);
const BASE = process.env.TEMPORAL_BASE ?? "http://127.0.0.1:5181";
const CAM = process.env.TRUTH_CAM ?? "0.55,1.72,0.75,0,1.62,-0.05";
const OUT = join(process.env.TRUTH_OUT ?? "scripts/generated/anim-export/truth", "drag");
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh",
  feet: "casual-tallsneakers-canvas", hair: process.env.HAIR ?? "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(quality, freeze) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${CAM}&anim=0&quality=${quality}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot && !!window.__temporalPreview", null, { timeout: 180000 });
  await page.waitForTimeout(3000); // converged still before the drag
  const frames = await page.evaluate(async ({ steps, freeze }) => {
    const root = window.__rigRoot, status = window.__temporalPreview, gl = document.querySelector("[data-viewer] canvas");
    const base = root.rotation.y, angle = s => base + .06 * (1 - .9 ** s) / (1 - .9);
    const shots = {}, log = [], pending = [...steps];
    let step = 0, shown = -1;
    await new Promise(resolve => {
      const loop = () => {
        // This callback runs after the viewer drew the frame for the angle set in the previous one (`shown`).
        const k = pending[0];
        if (k === undefined) { resolve(); return; }
        requestAnimationFrame(loop);
        if (shown === k && (!freeze || (!status.motion && status.samples >= status.maxSamples && !status.fading))) {
          shots[k] = gl.toDataURL("image/png");
          log.push({ k, motion: status.motion, samples: status.samples, reprojected: status.reprojected, reason: status.reason });
          pending.shift();
        }
        if (freeze && shown === k) return; // hold this angle until it has converged
        step = shown + 1;
        root.rotation.y = angle(step); root.updateMatrixWorld(true);
        shown = step;
      };
      requestAnimationFrame(loop);
    });
    return { shots, log };
  }, { steps, freeze });
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
const summary = { steps, reference: { log: reference.log, errors: reference.errors }, runs: {} };
for (const quality of qualities) {
  const moving = await run(quality, false);
  const rows = [];
  for (const k of steps) {
    writeFileSync(join(OUT, `${quality}-${k}.png`), Buffer.from(moving.shots[k].split(",")[1], "base64"));
    rows.push({ k, ...score(await decode(reference.shots[k]), await decode(moving.shots[k])) });
  }
  const mean = key => +(rows.reduce((s, r) => s + r[key].error, 0) / rows.length).toFixed(2);
  summary.runs[quality] = { hairError: mean("hair"), bodyError: mean("body"), rows, log: moving.log, errors: moving.errors };
  console.log(JSON.stringify({ quality, hairError: mean("hair"), bodyError: mean("body"), perStep: rows.map(r => [r.k, r.hair.error, r.body.error]),
    samples: moving.log.map(l => [l.k, l.motion ? "motion" : l.samples]), errors: moving.errors.length }));
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
