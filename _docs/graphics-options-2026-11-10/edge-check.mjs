// Edge check (10 Nov 2026): the builder in real Microsoft Edge, normally and with V8's optimising tiers off (what
// Edge's enhanced security does to JavaScript on unfamiliar sites; WebAssembly stays available). Records whether the
// slow-script notice shows, load time, frame times and per-frame script time with the idle playing.
// Usage (worktree root, dev server on 5182): node _docs/graphics-options-2026-11-10/edge-check.mjs [configs] [timing=1]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
const [only = "edge,edge-nojit,chrome", timing = "1"] = process.argv.slice(2);
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const OUT = "scripts/generated/browser-env";
mkdirSync(OUT, { recursive: true });
const NOJIT = "--js-flags=--no-opt --no-maglev --no-sparkplug";
const configs = {
  chrome: { channel: "chrome", args: [] },
  edge: { channel: "msedge", args: [] },
  "edge-nojit": { channel: "msedge", args: [NOJIT] },
};
const vsyncOff = ["--disable-gpu-vsync", "--disable-frame-rate-limit"];
const results = {};
for (const name of only.split(",")) {
  const { channel, args } = configs[name];
  const browser = await chromium.launch({ channel, headless: true, args: [...args, ...vsyncOff] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  const t0 = Date.now();
  await page.goto(`${BASE}/?reconstructed=1&anim=outfit-idle`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 600000 });
  const ready = (Date.now() - t0) / 1000;
  await page.waitForTimeout(6000);
  const notice = await page.getByText("JavaScript speed-up").count();
  await page.screenshot({ path: `${OUT}/${name}-notice.png`, clip: { x: 0, y: 0, width: 1500, height: 160 } });
  let frames = null;
  if (timing === "1") frames = await page.evaluate(() => new Promise(resolve => {
    const d = []; let last = performance.now();
    const loop = now => {
      d.push(now - last); last = now;
      if (d.length < 240) requestAnimationFrame(loop);
      else { const dd = [...d].sort((x, y) => x - y);
        resolve({ median: +dd[120].toFixed(1), p95: +dd[228].toFixed(1), fps: +(1000 / dd[120]).toFixed(1), motion: window.__temporalPreview.motion }); }
    };
    requestAnimationFrame(loop);
  }));
  results[name] = { ready, notice: notice > 0, frames, errors: errors.slice(0, 5),
    speed: await page.evaluate(() => import("/src/lib/script-speed.ts").then(m => +m.scriptSpeedMs().toFixed(1))) };
  console.log(name, JSON.stringify(results[name]));
  await browser.close();
}
writeFileSync(`${OUT}/edge-check.json`, JSON.stringify(results, null, 1));
