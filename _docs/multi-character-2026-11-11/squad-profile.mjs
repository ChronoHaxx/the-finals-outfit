// Phase 2 check (22 Nov 2026): frame time and memory with 1, 2 and 3 real contestants on the squad page (not clones,
// as profile-frame.mjs used in Phase 0), the idle playing on each. Same method as profile-frame.mjs: graphics pinned
// to High, pixel ratio 1, Chrome's sampling profiler over a fixed window, busy JS per frame = everything but idle.
// Memory: the renderer's live geometries, textures and shader programs, and the JS heap after a forced collection
// (Chrome's performance.memory).
// Desktop only; a phone's memory needs a phone.
//
// Usage (Git Bash, worktree root, dev server: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/squad-profile.mjs > _docs/multi-character-2026-11-11/squad-profile.json
import { chromium } from "playwright-core";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const WINDOW_MS = 4000;
const B = { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const OUTFITS = [B, { ...B, face: "head-face-03-base", hair: "hairs-afrofade-black" }, { ...B, upperBody: "casual-basictshirt-cotton-black" }];

const FRAMES = (ms) => new Promise((resolve) => {
  let frames = 0; const end = performance.now() + ms;
  const loop = (now) => { frames++; if (now < end) requestAnimationFrame(loop); else resolve(frames); };
  requestAnimationFrame(loop);
});

function busyPerFrame(profile, frames) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  let total = 0, idle = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const ms = (profile.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    if (byId.get(profile.samples[i]).callFrame.functionName === "(idle)") idle += ms;
  }
  return { frames, msPerFrame: +(total / frames).toFixed(2), busyMsPerFrame: +((total - idle) / frames).toFixed(2) };
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true,
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--enable-precise-memory-info"] });
const result = { base: BASE, when: new Date().toISOString(), window: WINDOW_MS };
for (const count of [1, 2, 3]) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    try { localStorage.setItem("finals-outfit.graphics", JSON.stringify({ choice: "high" })); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?reconstructed=1#/squad`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(1500);
  const intro = page.getByRole("button", { name: /^(Enter builder|View shared outfit)$/ });
  if (await intro.count()) await intro.first().click();
  await page.evaluate(async (outfits) => {
    const squads = await import("/src/store/useSquads.ts");
    await squads.startSquads();
    for (const [i, slots] of outfits.entries()) squads.addContestant({ slots, name: `Contestant ${i + 1}` });
  }, OUTFITS.slice(0, count));
  await page.waitForFunction((n) => window.__squadIdle === true && window.__squad?.members().length === n, count, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const moving = await page.evaluate(async () => {
    const pelvises = window.__squad.roots().map(root => root.getObjectByName("pelvis"));
    const before = pelvises.map(p => p.quaternion.toArray().join());
    await new Promise(r => setTimeout(r, 500));
    return pelvises.map((p, i) => p.quaternion.toArray().join() !== before[i]);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const frames = await page.evaluate(FRAMES, WINDOW_MS);
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage"); // the live heap, not garbage waiting for a collection
  const memory = await page.evaluate(() => {
    const gl = window.__squadRenderer;
    // (gl.info.render counts only the last draw, the still view's full-screen copy: not reported.)
    return { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs.length,
      jsHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
  });
  result[count] = { ...busyPerFrame(profile, frames), moving, ...memory };
  console.error(count, JSON.stringify(result[count]));
  await context.close();
}
await browser.close();
console.log(JSON.stringify(result, null, 1));
