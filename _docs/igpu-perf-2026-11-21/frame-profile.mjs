// Frame cost of the viewer on a throttled profile (21 Nov 2026, integrated-GPU report, Shocka list item 7).
//
// Headless Chrome against a local production build (vite preview), vsync off so requestAnimationFrame runs as fast as
// a frame can be made: the rAF interval is then the frame's cost. The viewer is set to what Shocka used: the Low preset
// at 50% resolution. The default outfit's idle plays (`anim=outfit-idle`; automated browsers start still otherwise).
// DevTools CPU throttling slows the page's main thread by a factor, as a laptop processor would; the graphics card is
// not throttled, so what this measures is the processor side (the report's iGPU sat at ~33%: not GPU-bound).
//
// For each configuration it records, in separate page loads so one instrument does not distort another:
//   timing  the rAF interval over FRAMES frames (median, p95, fps);
//   gl      WebGL calls per frame by name (an init script counts calls on the context prototypes), incl. sync ones;
//   profile a sampled CPU profile, self time per function (top N), when --profile is given.
//
// Usage (from the worktree root, server running):
//   node _docs/igpu-perf-2026-11-21/frame-profile.mjs [--throttle=4] [--aa=taa,msaa,off] [--face=default,none]
//        [--profile] [--gl] [--frames=240] [--label=before] [--out=<file.json>] [--extra=<query>]
import { chromium, firefox } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};
// --bases=before=http://127.0.0.1:5191,after=http://127.0.0.1:5192 interleaves builds run by run (this machine is shared:
// background load only ever adds time, so the summary reports each configuration's median and best of the repeats).
const BASES = String(arg("bases", `run=${process.env.PROBE_BASE ?? "http://127.0.0.1:5191"}`)).split(",").map(b => b.split("="));
// --browser=firefox: Playwright's Firefox build (PROBE_FIREFOX = its firefox.exe), vsync off; no CPU throttling or
// profile there (no DevTools protocol), so it measures Firefox's own unthrottled cost.
const BROWSER = String(arg("browser", "chrome"));
const THROTTLE = BROWSER === "firefox" ? 1 : Number(arg("throttle", 4));
const AAS = String(arg("aa", "taa,msaa,off")).split(",");
const FACES = String(arg("face", "default,none")).split(",");
const FRAMES = Number(arg("frames", 240));
const PROFILE = !!arg("profile", false);
const GL = !!arg("gl", false);
const LABEL = String(arg("label", "run"));
const EXTRA = String(arg("extra", ""));
const OUT = arg("out", null);
const REPEAT = Number(arg("repeat", 2));
// A 1080p laptop screen at Windows' 125% scaling; Low + 50% resolution draws 0.625x density (1200x675 css -> ~750x420).
const VIEWPORT = { width: 1536, height: 864 }, DPR = 1.25;

const FACE_ITEMS = { default: "head-face-01-base", none: null, face02: "head-face-02-base" };
const outfitParam = face => {
  const slots = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
  if (FACE_ITEMS[face] !== null) slots.face = FACE_ITEMS[face] ?? face;
  return "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// Counts every call on the WebGL context prototypes, per frame (frames delimited by rAF callbacks).
const GL_COUNTER = () => {
  const counts = new Map();
  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || typeof d.value !== "function" || name === "constructor") continue;
      const original = d.value;
      proto[name] = function (...a) { counts.set(name, (counts.get(name) ?? 0) + 1); return original.apply(this, a); };
    }
  }
  window.__glCounts = counts;
};

// One browser context per build, so its HTTP cache keeps the models between runs (a fresh context downloaded them
// again every run); each run is a new page with its own settings.
const contexts = new Map();
async function measure(browser, { aa, face, mode, base: [build, BASE] }) {
  let context = contexts.get(build);
  if (!context) contexts.set(build, context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR }));
  const page = await context.newPage();
  await page.addInitScript(([aa]) => {
    try { localStorage.setItem("finals-outfit.graphics", JSON.stringify({ choice: "low", aa, resolution: 0.5, showFps: false })); } catch {}
  }, [aa]);
  if (mode === "gl") await page.addInitScript(GL_COUNTER);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const url = `${BASE}/?outfit=${outfitParam(face)}&anim=outfit-idle${EXTRA ? "&" + EXTRA : ""}`;
  await page.goto(url, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 300000 });
  await page.waitForTimeout(5000); // shader compiles, first frames, the idle under way
  const cdp = BROWSER === "firefox" ? null : await context.newCDPSession(page);
  if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.waitForTimeout(1500);
  const result = { build, aa, face, mode };
  if (mode === "timing") {
    Object.assign(result, await page.evaluate(n => new Promise(resolve => {
      const d = []; let last = 0;
      const loop = now => { if (last) d.push(now - last); last = now; if (d.length < n) requestAnimationFrame(loop); else {
        const s = [...d].sort((a, b) => a - b), at = p => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
        const mean = d.reduce((a, b) => a + b, 0) / d.length;
        resolve({ median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), mean: +mean.toFixed(2), fps: +(1000 / mean).toFixed(1),
          canvas: [document.querySelector("[data-viewer] canvas").width, document.querySelector("[data-viewer] canvas").height] });
      } };
      requestAnimationFrame(loop);
    }), FRAMES));
  } else if (mode === "gl") {
    Object.assign(result, await page.evaluate(n => new Promise(resolve => {
      let frames = -1;
      const loop = () => { frames++; if (frames === 0) window.__glCounts.clear(); if (frames < n) requestAnimationFrame(loop); else {
        const per = Object.fromEntries([...window.__glCounts].map(([k, v]) => [k, +(v / n).toFixed(1)]).sort((a, b) => b[1] - a[1]));
        resolve({ perFrame: per, total: +Object.values(per).reduce((a, b) => a + b, 0).toFixed(0) });
      } };
      requestAnimationFrame(loop);
    }), 60));
  } else if (mode === "profile") {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
    const frames = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now();
      const loop = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(loop); else r(n); }; requestAnimationFrame(loop); }));
    const { profile } = await cdp.send("Profiler.stop");
    // Self time per function (sample count x interval), and inclusive time for a few named functions.
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const self = new Map(), total = new Map();
    const dt = profile.timeDeltas, samples = profile.samples;
    const key = n => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
    for (let i = 0; i < samples.length; i++) {
      const ms = (dt[i + 1] ?? dt[i]) / 1000;
      const node = byId.get(samples[i]);
      self.set(key(node), (self.get(key(node)) ?? 0) + ms);
      const seen = new Set();
      for (let id = samples[i]; id !== undefined; id = parent.get(id)) {
        const k = key(byId.get(id)); if (seen.has(k)) continue; seen.add(k);
        total.set(k, (total.get(k) ?? 0) + ms);
      }
    }
    const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +(v / frames).toFixed(3)]);
    Object.assign(result, { frames, selfPerFrame: top(self, 30), totalPerFrame: top(total, 45) });
  }
  if (errors.length) result.errors = errors.slice(0, 5);
  await cdp?.detach().catch(() => {});
  await page.close();
  return result;
}

const browser = BROWSER === "firefox"
  ? await firefox.launch({ headless: true, executablePath: process.env.PROBE_FIREFOX,
    firefoxUserPrefs: { "layout.frame_rate": 0, "privacy.reduceTimerPrecision": false, "webgl.force-enabled": true } })
  : await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true,
    args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist"] });
const results = [];
const modes = ["timing", ...(GL ? ["gl"] : []), ...(PROFILE ? ["profile"] : [])];
for (const face of FACES) for (const aa of AAS) for (const mode of modes) {
  for (let r = 0; r < (mode === "timing" ? REPEAT : 1); r++) for (const base of BASES) {
    const res = await measure(browser, { aa, face, mode, base });
    results.push(res);
    const tag = `${LABEL} ${res.build}`;
    if (mode === "timing") console.log(tag, `x${THROTTLE}`, face, aa, JSON.stringify({ median: res.median, p95: res.p95, fps: res.fps, canvas: res.canvas, errors: res.errors }));
    else if (mode === "gl") console.log(tag, face, aa, "gl/frame", res.total, JSON.stringify(Object.entries(res.perFrame).slice(0, 25)));
    else { console.log(tag, face, aa, "profile frames", res.frames); console.log(" self/frame ms:", JSON.stringify(res.selfPerFrame.slice(0, 20), null, 0)); console.log(" total/frame ms:", JSON.stringify(res.totalPerFrame, null, 0)); }
  }
}
await browser.close();
// Summary: per configuration and build, the median and the best of the repeats' median frame times (ms) and fps.
const timing = results.filter(r => r.mode === "timing");
const groups = new Map();
for (const r of timing) { const k = `${r.face} ${r.aa} ${r.build}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
console.log(`\nsummary x${THROTTLE} (frame ms: median of repeats / best; fps from the best run's mean)`);
for (const [k, rs] of groups) {
  const medians = rs.map(r => r.median).sort((a, b) => a - b), best = rs.reduce((a, b) => a.median <= b.median ? a : b);
  console.log(k.padEnd(40), `median ${medians[Math.floor((medians.length - 1) / 2)]}`.padEnd(14), `best ${best.median}`.padEnd(12), `fps ${best.fps}`, `runs ${medians.join("/")}`);
}
if (OUT) { mkdirSync(path.dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ label: LABEL, throttle: THROTTLE, viewport: VIEWPORT, dpr: DPR, results }, null, 1)); }
