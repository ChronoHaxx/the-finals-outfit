// Phase 1.5 real-app check (21 Nov 2026, multi-character design): a legacy head static swapped in mid-emote must end
// up where the same item equipped at rest does. In the reconstructed builder the bullet earring is such a static (on
// the head's FACIAL_L_Earlobe bone); the glasses here are a source assembly and take another path.
//
// Case A: a paused pose link (ace-pilot at 2 s) without earrings; the earrings go on through the app's build store
// while posed; then the emote stops (the facial branch returns from the driver's head to the head's own armature).
// Case B: the same outfit at rest, earrings equipped the same way. Both record the earring mesh's parent bone, its
// local matrix and its matrix relative to the rig root. They must match.
//
// --legacy opens the dev build's legacy mode (no reconstructed=1): there the earring is a legacy head static
// (CharacterRig.equip), the path Phase 1.5 changed; the default mode routes them through source
// assemblies, whose attachment placement already works from rest frames (a control).
//
// Usage (Git Bash, worktree root, dev server running: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/head-static-swap.mjs [--legacy]
import { chromium } from "playwright-core";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const BASE_SLOTS = { face: "head-face-03-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-afrofade-black" };
const LEGACY = process.argv.includes("--legacy");
const MODE = LEGACY ? "" : "reconstructed=1&";
// (The round sunglasses and the ancient mask have no legacy model: legacy mode leaves them off.)
const ADDED = { earrings: "bodycosmetics-earrings-bullet-01" };
const IDS = Object.values(ADDED);
const outfitCode = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const READ = (ids) => {
  const root = window.__rigRoot;
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const out = [];
  root.traverse(o => {
    if (!o.isMesh || !ids.includes(o.userData.rigItemId) || !o.parent?.isBone) return;
    out.push({ name: `${o.userData.rigItemId}/${o.name}`, parent: o.parent.name,
      local: o.matrix.elements.map(v => +v.toFixed(6)),
      rig: toRoot.clone().multiply(o.matrixWorld).elements.map(v => +v.toFixed(6)) });
  });
  return out;
};

async function open(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.goto(url, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot && !!window.__rigAnim", null, { timeout: 300000 });
  const intro = page.getByRole("button", { name: /View shared outfit|Enter builder/ });
  if (await intro.count()) await intro.first().click();
  return page;
}

async function equipEarrings(page) {
  await page.evaluate(async (slots) => {
    const m = await import("/src/store/useBuildStore.ts");
    m.useBuildStore.getState().load(slots, "masculine");
  }, { ...BASE_SLOTS, ...ADDED });
  await page.waitForFunction((ids) => {
    if (window.__rigIdle !== true) return false;
    const found = new Set();
    window.__rigRoot.traverse(o => { if (o.isMesh && ids.includes(o.userData.rigItemId)) found.add(o.userData.rigItemId); });
    return found.size === ids.length;
  }, IDS, { timeout: 300000 });
  await page.waitForTimeout(1000);
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true });
// A: equipped mid-emote, then the emote stops.
const a = await open(browser, `${BASE}/?${MODE}outfit=${outfitCode(BASE_SLOTS)}&emote=ace-pilot&t=2&paused=1`);
await a.waitForFunction(() => { const s = window.__rigAnim.state(); return s.current === "ace-pilot" && s.paused && !s.loading; }, null, { timeout: 120000 });
await a.waitForTimeout(1500);
await equipEarrings(a);
const posed = await a.evaluate(READ, IDS);
await a.evaluate(() => window.__rigAnim.stop());
await a.waitForFunction(() => !window.__rigAnim.state().active, null, { timeout: 60000 });
await a.waitForTimeout(1500);
const afterStop = await a.evaluate(READ, IDS);
// B: equipped at rest.
const b = await open(browser, `${BASE}/?${MODE}outfit=${outfitCode(BASE_SLOTS)}`);
await b.evaluate(() => window.__rigAnim.stop());
await b.waitForTimeout(1500);
await equipEarrings(b);
const rest = await b.evaluate(READ, IDS);
await browser.close();

const worst = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
console.log(JSON.stringify({ posedParents: posed.map(m => m.parent), afterStop: afterStop.map(m => m.parent), rest: rest.map(m => m.parent) }));
let same = afterStop.length === rest.length && rest.length > 0;
for (let i = 0; i < Math.min(afterStop.length, rest.length); i++) {
  const dl = worst(afterStop[i].local, rest[i].local), dr = worst(afterStop[i].rig, rest[i].rig);
  console.log(`${rest[i].name}: parent ${afterStop[i].parent} vs ${rest[i].parent}; local differs by ${dl.toExponential(2)}, rig by ${dr.toExponential(2)}`);
  if (afterStop[i].parent !== rest[i].parent || dl > 1e-4 || dr > 1e-4) same = false;
}
console.log(same ? "SAME: the mid-emote swap lands where the equip at rest does" : "DIFFERENT");
process.exit(same ? 0 : 1);
