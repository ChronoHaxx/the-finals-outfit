// Where a frame's time goes with 1 and with 4 characters (11 Nov 2026, multi-character design, Phase 0). The Fable
// plan review pointed out that 228 draw calls and 2.3 M triangles cannot explain 38-58 ms on a desktop GPU and asked for
// a CPU profile before the character cap is fixed. Read-only probe of the running dev app.
//
// Outfit B with the idle playing, graphics pinned to High (localStorage, as a viewer's own choice would be), pixel
// ratio 1. Three extra copies of the rig are cloned in as in measure-character-cost.mjs (shared geometry and materials,
// own skeletons, still pose). Chrome's sampling profiler runs for a fixed window; self time is summed per function.
//
// Usage (Git Bash, worktree root, dev server running: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/profile-frame.mjs > _docs/multi-character-2026-11-11/profile-v1.json
import { chromium } from "playwright-core";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const WINDOW_MS = 4000;
const code = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const B = { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };

const ADD_COPIES = () => {
  const root = window.__rigRoot, THREE = window.__THREE;
  window.__copies = [-1.2, 1.2, 2.4].map((x) => {
    const pairs = new Map(), copy = root.clone(true);
    const walk = (a, b) => { pairs.set(a, b); a.children.forEach((c, i) => walk(c, b.children[i])); };
    walk(root, copy);
    copy.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const source = [...pairs].find(([, b]) => b === o)[0];
      o.bind(new THREE.Skeleton(source.skeleton.bones.map(b => pairs.get(b) ?? b), source.skeleton.boneInverses), source.bindMatrix);
    });
    copy.position.x = x; root.parent.add(copy); return copy;
  });
};

const FRAMES = (ms) => new Promise((resolve) => {
  let frames = 0; const end = performance.now() + ms;
  const loop = (now) => { frames++; if (now < end) requestAnimationFrame(loop); else resolve(frames); };
  requestAnimationFrame(loop);
});

function summarise(profile, frames) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]); const f = node.callFrame;
    const file = f.url.replace(/^.*\/(src|node_modules\/\.vite\/deps|node_modules)\//, "$1/").replace(/\?.*$/, "");
    const key = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  const idle = [...self].filter(([k]) => /^\((idle|program|garbage collector)\)/.test(k)).reduce((s, [, v]) => s + v, 0);
  const total = [...self.values()].reduce((s, v) => s + v, 0);
  const top = [...self].filter(([k]) => !/^\(idle\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([k, v]) => `${(v / frames).toFixed(2)} ms/frame  ${k}`);
  return { frames, msPerFrame: +(total / frames).toFixed(2), busyMsPerFrame: +((total - (self.get("(idle) :0") ?? 0)) / frames).toFixed(2),
    idleOrProgramMsPerFrame: +(idle / frames).toFixed(2), top };
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true,
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  try { localStorage.setItem("finals-outfit.graphics", JSON.stringify({ choice: "high" })); } catch { /* ignore */ }
});
await page.goto(`${BASE}/?reconstructed=1&anim=0&outfit=${code(B)}`, { waitUntil: "load", timeout: 300000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot && !!window.__rigAnim", null, { timeout: 300000 });
const intro = page.getByRole("button", { name: /View shared outfit|Enter builder/ });
if (await intro.count()) await intro.first().click();
await page.evaluate(() => window.__rigAnim.play("outfit-idle"));
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
const result = { base: BASE, when: new Date().toISOString(), window: WINDOW_MS };
for (const label of ["one", "four"]) {
  if (label === "four") { await page.evaluate(ADD_COPIES); await page.waitForTimeout(3000); }
  await cdp.send("Profiler.start");
  const frames = await page.evaluate(FRAMES, WINDOW_MS);
  const { profile } = await cdp.send("Profiler.stop");
  result[label] = summarise(profile, frames);
  console.error(label, result[label].frames, "frames", result[label].busyMsPerFrame, "busy ms/frame");
}
await browser.close();
console.log(JSON.stringify(result, null, 1));
