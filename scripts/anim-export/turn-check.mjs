// Turn-sway check (5 Nov 2026): orbit the viewer with a real mouse drag while the idle plays, and measure how far the
// tiger tail and Santa-hat tips swing in the character's frame compared with the same time without a drag. Also saves
// a screenshot just after the drag. Headless Chrome/Edge via playwright-core, against the isolated 5181 dev server.
//
//   node scripts/anim-export/turn-check.mjs [--out=<dir>] [--sway=0]   (Git Bash or PowerShell, worktree root)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5181";
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "_docs/showcase-animation-2026-11-05/captures/turn");
const SWAY = !process.argv.includes("--sway=0");
mkdirSync(OUT, { recursive: true });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", lowerBack: "cute-tigertail-tiger", headwear: "attachment-santahat-cotton-green" };
const code = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let browser;
for (const channel of ["chrome", "msedge"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ } }
if (!browser) throw new Error("no Chrome/Edge found for playwright-core");
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`${BASE}/?reconstructed=1&outfit=${code}&anim=outfit-idle${SWAY ? "" : "&sway=0"}`, { waitUntil: "load" });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && window.__rigAnim.state().moving", null, { timeout: 180000 });
await page.waitForTimeout(3000); // let the springs settle into the idle

// Tip positions in the frame of the body bone each chain hangs from (the tail's pelvis-side anchor, the hat's head):
// the idle's own body motion cancels out, so what is left is the chain swinging relative to its anchor. Rigid
// (sway off) chains stay put in that frame.
const CHAINS = { "tail_04_JJ": "tail_00_JJRoot", "hat_tail_03_jj": "hat_tail_01_jj" };
const sample = () => page.evaluate(chains => {
  const out = {};
  for (const [name, rootName] of Object.entries(chains)) {
    let tip = null, chainRoot = null;
    window.__rigRoot.traverse(o => {
      if (!o.isBone || !o.parent?.isBone) return;
      if (!tip && o.name === name) tip = o;
      if (!chainRoot && o.name === rootName) chainRoot = o;
    });
    if (!tip || !chainRoot?.parent) continue;
    tip.updateWorldMatrix(true, false);
    const anchor = chainRoot.parent;
    const p = anchor.worldToLocal(tip.getWorldPosition(tip.position.clone()));
    out[name] = [p.x, p.y, p.z];
  }
  return out;
}, CHAINS);
async function record(ms) {
  const series = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { series.push(await sample()); await page.waitForTimeout(40); }
  return series;
}
// Largest distance (m) of a chain tip from where it hung in the quiet window, in its anchor's frame.
let reference = {};
const spread = (series, name) => {
  const pts = series.map(s => s[name]).filter(Boolean), r = reference[name];
  return Math.max(...pts.map(p => Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2])));
};
const mean = (series, name) => {
  const pts = series.map(s => s[name]).filter(Boolean);
  return [0, 1, 2].map(i => pts.reduce((a, p) => a + p[i], 0) / pts.length);
};

const quiet = await record(1500);
reference = Object.fromEntries(Object.keys(CHAINS).map(n => [n, mean(quiet, n)]));
const box = await page.locator("canvas").first().boundingBox();
const y = box.y + box.height * 0.5, x0 = box.x + box.width * 0.35;
const dragAndRecord = (async () => {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 + i * 25, y); await page.waitForTimeout(16); } // ~300 px in ~0.3 s
  await page.mouse.up();
})();
const turned = await record(2500);
await dragAndRecord;
await page.screenshot({ path: join(OUT, `after-drag${SWAY ? "" : "-sway-off"}.png`), clip: box });
const settled = await record(1500);
const result = {
  sway: SWAY,
  quietSpreadM: Object.fromEntries(Object.keys(CHAINS).map(n => [n, +spread(quiet, n).toFixed(4)])),
  duringTurnSpreadM: Object.fromEntries(Object.keys(CHAINS).map(n => [n, +spread(turned, n).toFixed(4)])),
  settledSpreadM: Object.fromEntries(Object.keys(CHAINS).map(n => [n, +spread(settled, n).toFixed(4)])),
};
writeFileSync(join(OUT, `turn-check${SWAY ? "" : "-sway-off"}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
