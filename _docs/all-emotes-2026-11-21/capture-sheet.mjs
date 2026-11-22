// Contact sheets of emote clips (21 Nov 2026): each clip held at several moments, front and side, on the default
// outfit, stitched into one JPEG per clip for review by eye. Same harness as scripts/anim-export/capture-face.mjs
// (headless Chrome/Edge through playwright-core, each frame held until the still view has converged).
//
//   node _docs/all-emotes-2026-11-21/capture-sheet.mjs --base=http://127.0.0.1:5203 --clips=id1,id2 [--chinals]
//     [--times=0.1,0.3,0.5,0.7,0.9] [--out=<dir>]          (Git Bash or PowerShell, worktree root)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://127.0.0.1:5203");
const CHINALS = process.argv.includes("--chinals");
const CLIPS = arg("clips", "").split(",").filter(Boolean);
const TIMES = arg("times", "0.1,0.3,0.5,0.7,0.9").split(",").map(Number);
const OUT = resolve(arg("out", "scripts/generated/all-emotes-2026-11-21/sheets"));
if (!CLIPS.length) throw new Error("--clips=<id,...> is required");
// Whole body, front and from the character's left side (the character faces +z).
const CAMS = { front: [0, 1.0, 4.2, 0, 0.95, 0], side: [4.2, 1.0, 0, 0, 0.95, 0] };

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
const converged = () => page.waitForFunction(() => {
  const t = window.__temporalPreview;
  return !t || !t.active || t.samples >= t.maxSamples;
}, null, { timeout: 60000 }).then(() => page.waitForTimeout(200));

mkdirSync(OUT, { recursive: true });
const report = [];
for (const clip of CLIPS) {
  const tiles = [];
  let duration = null, label = clip;
  for (const [view, cam] of Object.entries(CAMS)) {
    await page.goto(`${BASE}/?reconstructed=1&cam=${cam.join(",")}&fov=30${CHINALS ? "#/chinals" : ""}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
    const info = await page.evaluate(id => { const c = window.__rigAnim.animator.manifest.clips.find(x => x.id === id); return c ? { duration: c.duration, label: c.label } : null; }, clip);
    if (!info) { report.push({ clip, error: "not in the manifest" }); break; }
    duration = info.duration; label = info.label;
    const box = await page.locator("canvas").first().boundingBox();
    for (const f of TIMES) {
      const t = +(f * duration).toFixed(3);
      // The body can still be loading when the idle flag is up (first load after a server start): retry for 30 s.
      for (let attempt = 0; ; attempt++) {
        try { await page.evaluate(([id, time]) => window.__rigAnim.play(id, time), [clip, t]); break; }
        catch (error) { if (attempt >= 30 || !/Body not loaded/.test(String(error))) throw error; await page.waitForTimeout(1000); }
      }
      await converged();
      tiles.push({ view, t, png: await page.screenshot({ clip: box }) });
    }
  }
  if (!tiles.length) continue;
  const meta = await sharp(tiles[0].png).metadata();
  const w = Math.round(meta.width / 2), h = Math.round(meta.height / 2), cols = TIMES.length;
  const composites = await Promise.all(tiles.map(async (tile, i) => ({
    input: await sharp(tile.png).resize(w, h).toBuffer(), left: (i % cols) * w, top: Math.floor(i / cols) * h })));
  const file = join(OUT, `${clip}.jpg`);
  await sharp({ create: { width: w * cols, height: h * 2, channels: 3, background: "#101010" } }).composite(composites).jpeg({ quality: 85 }).toFile(file);
  report.push({ clip, label, duration, times: tiles.slice(0, cols).map(t => t.t), file, errors: [...errors] });
  errors.length = 0;
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
