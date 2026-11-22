// Phase 2 real-app probe (22 Nov 2026): the squad page in the dev build.
// - Builds a squad of three: the first through the page's own "Add the builder's outfit" button (the Fnatic jersey
//   outfit with player number 45 set in the builder), then the same jersey with each piece's own number, then a
//   T-shirt outfit (through the page's store, as the button does).
// - Checks they load one at a time, the squad survives a reload, and Remove + Undo bring the same contestant back.
// - Saves a wide shot and close-ups of both jerseys' left sleeves (45 vs the jersey's own 32), with the automation
//   flag on (still pose, deterministic), a wide shot under a low sun from the side with the floor shadow on (every
//   contestant's whole shadow inside the fitted shadow camera), and a wide shot as a visitor (idle playing) with each
//   contestant's pelvis checked for motion.
// Usage (Git Bash, worktree root, dev server: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/squad-probe.mjs <outdir>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2] ?? "squad-probe-out";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const JERSEY = "2.36o.81qz.a1bl.cct"; // Fnatic Jersey + Hedge Hunter Cargos (PR #60's checklist outfit)
const TSHIRT = { face: "head-face-03-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", hair: "hairs-afrofade-black" };
const log = (what, value) => console.log(`${what}: ${JSON.stringify(value)}`);

const idle = page => page.waitForFunction(() => window.__squadIdle === true && window.__squad?.members().length > 0, null, { timeout: 300000 });
const members = page => page.evaluate(() => window.__squad.members());
const canvasShot = (page, name) => page.locator("[data-viewer] canvas").first().screenshot({ path: path.join(OUT, name) });
const converged = page => page.waitForFunction(() => { const s = window.__temporalPreview; return !s || s.samples >= s.maxSamples; }, null, { timeout: 120000 });

async function buildSquad(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${BASE}/?reconstructed=1#/?o=${JERSEY}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 300000 });
  const intro = page.getByRole("button", { name: /^(Enter builder|View shared outfit)$/ });
  if (await intro.count()) await intro.first().click();
  const jerseySlots = await page.evaluate(async () => {
    const { useBuildStore } = await import("/src/store/useBuildStore.ts");
    useBuildStore.getState().setPlayerNumber(45);
    return Object.fromEntries(Object.entries(useBuildStore.getState().build).filter(e => e[1]));
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = "#/squad"; });
  await page.getByRole("button", { name: "Add the builder’s outfit" }).click();
  await idle(page);
  log("after the button", await members(page));
  // The page's own actions (useSquads.ts), for the other two: the same jersey with its own number, a T-shirt outfit.
  await page.evaluate(async ([jersey, tshirt]) => {
    const squads = await import("/src/store/useSquads.ts");
    squads.addContestant({ slots: jersey, name: "Jersey, own number" });
    squads.addContestant({ slots: tshirt, name: "T-shirt" });
  }, [jerseySlots, TSHIRT]);
  // One at a time: never two loading together.
  const seen = [];
  for (let i = 0; i < 600; i++) {
    const states = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Contestants"] .hud.text-fg-dim')].map(e => e.textContent));
    seen.push(states.filter(s => s === "Loading…").length);
    if (await page.evaluate(() => window.__squadIdle === true && window.__squad.members().length === 3)) break;
    await page.waitForTimeout(250);
  }
  log("most loading at once", Math.max(...seen));
  log("members", await members(page));
  await page.reload({ waitUntil: "load" });
  await idle(page);
  log("after reload", (await members(page)).map(m => m.settled));
  const names = () => page.locator('[aria-label="Contestants"] p.truncate').allTextContents();
  log("names", await names());
  await page.getByRole("button", { name: "Remove T-shirt" }).click();
  log("after remove", await names());
  await page.getByRole("button", { name: "Undo" }).click();
  await idle(page);
  log("after undo", await names());
  await converged(page);
  await canvasShot(page, "squad-still-wide.png");
  log("errors", errors);
  return context;
}

async function closeUps(context) {
  const page = await context.newPage();
  for (const [x, name] of [[0, "sleeve-45"], [-0.9, "sleeve-own"]]) {
    const cam = [x + 0.75, 1.38, 0.3, x + 0.17, 1.3, 0].map(v => +v.toFixed(3)).join(",");
    await page.goto(`${BASE}/?reconstructed=1&cam=${cam}#/squad`, { waitUntil: "load", timeout: 300000 });
    await idle(page);
    await page.waitForTimeout(1000);
    await converged(page);
    await canvasShot(page, `${name}.png`);
  }
  await page.goto(`${BASE}/?reconstructed=1#/squad`, { waitUntil: "load", timeout: 300000 });
  await idle(page);
  await page.evaluate(async () => {
    const { useLightingStore } = await import("/src/lib/lighting-store.ts");
    const { positionFrom } = await import("/src/lib/stage-lighting.ts");
    useLightingStore.getState().edit(look => {
      look.floorShadow = true;
      look.floorShadowOpacity = 0.5;
      const sun = look.lights.find(l => l.role === "sun");
      Object.assign(sun, { position: positionFrom(80, 18, 7.63), castShadow: true, enabled: true });
      return look;
    });
  });
  await page.waitForTimeout(1500);
  await converged(page);
  await canvasShot(page, "shadows-low-side-sun.png");
  await page.close();
}

async function visitor(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  await page.goto(`${BASE}/?reconstructed=1#/squad`, { waitUntil: "load", timeout: 300000 });
  const intro = page.getByRole("button", { name: /^(Enter builder|View shared outfit)$/ });
  await page.waitForTimeout(1500);
  if (await intro.count()) await intro.first().click();
  await page.evaluate(async (tshirt) => {
    const squads = await import("/src/store/useSquads.ts");
    await squads.startSquads();
    squads.addContestant({ slots: tshirt, name: "One" });
    squads.addContestant({ slots: { ...tshirt, hair: "hairs-highponytail-black" }, name: "Two" });
  }, TSHIRT);
  await idle(page);
  await page.waitForFunction(() => window.__squad.members().length === 2 && window.__squadIdle, null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const motion = await page.evaluate(async () => {
    const pelvises = window.__squad.roots().map(root => root.getObjectByName("pelvis"));
    const before = pelvises.map(p => p?.quaternion.toArray().join(","));
    await new Promise(r => setTimeout(r, 700));
    return pelvises.map((p, i) => !!p && p.quaternion.toArray().join(",") !== before[i]);
  });
  log("visitor: each pelvis moving", motion);
  await canvasShot(page, "squad-visitor-wide.png");
  await context.close();
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true });
const context = await buildSquad(browser);
await closeUps(context);
await context.close();
await visitor(browser);
await browser.close();
