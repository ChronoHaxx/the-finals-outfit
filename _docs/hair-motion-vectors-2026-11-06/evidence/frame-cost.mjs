// Frame cost per graphics tier with the idle playing (headless Chrome: rAF is not tied to a display, so deltas
// approximate the real per-frame cost). Also GPU time via EXT_disjoint_timer_query_webgl2 when available.
import { chromium } from "playwright-core";
const [w = "1500", h = "1000"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
await page.goto(`http://127.0.0.1:5181/?reconstructed=1&outfit=${outfit}&anim=outfit-idle`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 180000 });
await page.waitForTimeout(6000);
const select = page.getByLabel("Graphics quality");
const out = {};
for (const choice of ["balanced", "high", "low", "balanced", "high"]) {
  await select.selectOption(choice); await page.waitForTimeout(1500);
  out[choice + (out[choice] ? "2" : "")] = await page.evaluate(() => new Promise(resolve => {
    const d = []; let last = performance.now(); const s = window.__temporalPreview;
    const loop = now => { d.push(now - last); last = now; if (d.length < 240) requestAnimationFrame(loop); else { d.sort((a, b) => a - b);
      resolve({ median: +d[120].toFixed(2), p95: +d[228].toFixed(2), canvas: document.querySelector("[data-viewer] canvas").width, reprojected: s.reprojected, velocityRenders: s.velocityRenders }); } };
    requestAnimationFrame(loop);
  }));
}
console.log(JSON.stringify(out));
await browser.close();
