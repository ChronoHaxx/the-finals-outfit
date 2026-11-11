// Frame cost of the moving view with and without motion vectors at a given device pixel ratio (10 Nov 2026), adapted
// from _docs/hair-motion-vectors-2026-11-06/evidence/frame-cost.mjs. Headless Chrome with vsync off: rAF deltas
// approximate the per-frame cost. ?quality= picks the accumulator path (balanced = screen-locked, high = motion
// vectors), so both run at the same resolution.
// Usage: node _docs/graphics-options-2026-11-10/frame-cost.mjs [dpr list, default 1,2] [extra query, e.g. aa=off]
import { chromium } from "playwright-core";
const [dprList = "1,2", extra = ""] = process.argv.slice(2);
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true, args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
const slots = { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const out = {};
for (const dpr of dprList.split(",").map(Number)) {
  for (const quality of ["balanced", "high", "balanced", "high"]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: dpr });
    await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&anim=outfit-idle&quality=${quality}${extra ? "&" + extra : ""}`, { waitUntil: "load", timeout: 240000 });
    await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 240000 });
    await page.waitForTimeout(4000);
    const key = `dpr${dpr}-${quality}${out[`dpr${dpr}-${quality}`] ? "-2" : ""}`;
    out[key] = await page.evaluate(() => new Promise(resolve => {
      const d = []; let last = performance.now(); const s = window.__temporalPreview;
      const loop = now => { d.push(now - last); last = now; if (d.length < 300) requestAnimationFrame(loop); else { d.sort((a, b) => a - b);
        resolve({ median: +d[150].toFixed(2), p95: +d[285].toFixed(2), canvas: document.querySelector("[data-viewer] canvas").width, motion: s.motion, reprojected: s.reprojected }); } };
      requestAnimationFrame(loop);
    }));
    console.log(key, JSON.stringify(out[key]));
    await page.close();
  }
}
await browser.close();
