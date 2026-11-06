// Deformation-rig captures (5 Nov 2026): the same paused frame with the game's twist/volume rig on and off
// (window.__rigAnim.deform), close on forearms, elbows and knees, full size for review by eye.
//
//   node scripts/anim-export/capture-deform.mjs [--out=<dir>]   (Git Bash or PowerShell, worktree root; dev server 5181)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5181";
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "scripts/generated/anim-export/captures/deform");
mkdirSync(OUT, { recursive: true });
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");
// [label, clip, times, camera x,y,z,tx,ty,tz]: close on the joints the rig drives (positions read at these frames).
const SHOTS = [
  ["forearm-front", "tea-bag", [2.5, 3.5, 4.5], [0.05, 1.32, 0.95, 0.03, 1.23, 0.3]],
  ["forearm-side", "tea-bag", [2.5, 3.5, 4.5], [0.72, 1.3, 0.55, 0.03, 1.23, 0.3]],
  ["elbow", "flex", [1.5], [0.8, 1.35, 0.6, 0.29, 1.2, 0.12]],
  ["knee", "frog", [3], [0.95, 0.62, 0.8, 0.35, 0.45, 0.16]],
];
async function launch() {
  for (const channel of ["chrome", "msedge"]) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } }
  throw new Error("no Chrome/Edge found for playwright-core");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
const log = [];
for (const [label, clip, times, cam] of SHOTS) {
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${cam.join(",")}&fov=35&anim=${clip}&animTime=${times[0]}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && window.__rigAnim.state().current", null, { timeout: 180000 });
  const box = await page.locator("canvas").first().boundingBox();
  for (const time of times) for (const deform of [true, false]) {
    await page.evaluate(([on, t]) => { window.__rigAnim.deform(on); window.__rigAnim.seek(t); }, [deform, time]);
    await page.waitForFunction(() => { const t = window.__temporalPreview; return !t || !t.active || t.samples >= t.maxSamples; }, null, { timeout: 30000 });
    await page.waitForTimeout(250);
    const file = join(OUT, `${label}-${clip}@${time}-${deform ? "rig" : "norig"}.png`);
    await page.screenshot({ path: file, clip: box });
    log.push({ label, clip, time, deform, file });
    console.log(label, clip, time, deform ? "rig on" : "rig off");
  }
}
await browser.close();
writeFileSync(join(OUT, "capture-log.json"), JSON.stringify({ log, errors }, null, 2));
console.log(`errors: ${errors.length}; done -> ${OUT}`);
