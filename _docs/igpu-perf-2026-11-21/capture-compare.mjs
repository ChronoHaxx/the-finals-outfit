// Same pose, two builds (21 Nov 2026): proves the performance changes draw the same pixels. Each case loads the viewer at
// desktop settings (High preset, full resolution), plays the idle on a fixed clock, holds one pose and captures the
// canvas: `still` lets the still view converge on the held pose (every anti-aliasing setting); `moving` keeps the held
// pose counted as moving (MSAA and Off then draw each frame fresh, which is deterministic; TAA's moving average is not
// compared, its jitter phase differs run to run). Writes PNGs and a pixel comparison per case.
// Usage: node _docs/igpu-perf-2026-11-21/capture-compare.mjs <out dir> [--bases=before=url,after=url]
//        [--cases=default:taa:still,...]
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "capture-compare";
const BASES = arg("bases", "before=http://127.0.0.1:5191,after=http://127.0.0.1:5192").split(",").map(b => b.split("="));
const CASES = arg("cases", ["default:taa:still", "default:msaa:still", "default:off:still", "default:msaa:moving", "default:off:moving",
  "head-face-11-base:taa:still", "head-face-11-base:off:moving"].join(",")).split(",").map(c => c.split(":"));
const FACE_ITEMS = { default: "head-face-01-base", none: null };
const outfitParam = face => {
  const slots = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
  if (FACE_ITEMS[face] !== null) slots.face = FACE_ITEMS[face] ?? face;
  return "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const summary = [];
for (const [face, aa, hold] of CASES) {
  const files = [];
  for (const [build, base] of BASES) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1 });
    await context.addInitScript(([aa]) => {
      try { localStorage.setItem("finals-outfit.graphics", JSON.stringify({ choice: "high", aa, resolution: "auto", showFps: false })); } catch {}
    }, [aa]);
    const page = await context.newPage();
    // A camera close on the head, where the face's change would show.
    await page.goto(`${base}/?outfit=${outfitParam(face)}&anim=outfit-idle`, { waitUntil: "load", timeout: 300000 });
    await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 300000 });
    // Restart the idle at 0 on a fixed 1/60 s clock, run 90 steps, then hold that pose.
    await page.evaluate(async movingHold => {
      const anim = window.__rigAnim;
      anim.clock.fixed = 1 / 60; anim.clock.frozenMoving = movingHold;
      await anim.play("outfit-idle", 0);
      anim.clock.steps = 0; anim.clock.freezeAt = 90;
    }, hold === "moving");
    await page.waitForFunction("window.__rigAnim.clock.steps >= 90", null, { timeout: 120000 });
    await page.waitForTimeout(4000); // the still view converges (32 samples) or the moving view settles
    const file = path.join(OUT, `${face}-${aa}-${hold}-${build}.png`);
    await page.locator("[data-viewer] canvas").screenshot({ path: file });
    files.push(file);
    await context.close();
  }
  const [a, b] = files.map(f => PNG.sync.read(readFileSync(f)));
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0 }) : -1;
  let maxDelta = 0;
  if (changed >= 0) for (let i = 0; i < a.data.length; i++) maxDelta = Math.max(maxDelta, Math.abs(a.data[i] - b.data[i]));
  writeFileSync(path.join(OUT, `${face}-${aa}-${hold}-diff.png`), PNG.sync.write(diff));
  const row = { case: `${face} ${aa} ${hold}`, size: `${a.width}x${a.height}`, changedPixels: changed, maxChannelDelta: maxDelta };
  summary.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
