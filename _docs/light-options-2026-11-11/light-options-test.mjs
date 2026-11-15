// Lighting and backdrop (11-12 Nov 2026), headless Chrome against production builds.
// 1. Automated (navigator.webdriver true): this build and the main baseline (43aefec) render the same pixels in Studio,
//    even with a custom look stored in localStorage (automation must ignore it); and the Lobby look against main's Lobby.
// 2. As a person (webdriver reported false): looks, sun looks, colour pickers on lights and backdrop, an added light,
//    reflections, exposure and tone mapping, a reload in the middle of a drag, saved looks, Reset and Undo, a travelling
//    emote with the floor shadow, and the phone layout. Full-size screenshots of every look (renders of game assets:
//    shots/ stays local).
//   node _docs/light-options-2026-11-11/light-options-test.mjs <url> <baselineUrl> <outDir>    (ONLY=auto,person,emote,phone)
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const [url, baselineUrl, outDir] = process.argv.slice(2);
if (!url || !baselineUrl || !outDir) throw new Error("usage: light-options-test.mjs <url> <baselineUrl> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const report = { url, baselineUrl, when: new Date().toISOString(), errors: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const only = new Set((process.env.ONLY ?? "auto,person,emote,phone").split(","));

// A custom look stored as PR #40's first version wrote it: automation must ignore it.
const CUSTOM = JSON.stringify({ current: { sunAzimuth: 90, sunElevation: 20, floorShadow: true, backdrop: { studio: "black" } } });

async function newPage({ person, viewport = { width: 1600, height: 1000 }, mobile = false, seed = null }) {
  const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  if (person) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  if (seed) await context.addInitScript(value => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem("finals-outfit.lighting", value); sessionStorage.setItem("seeded", "1"); }
  }, seed);
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  return { context, page };
}

async function open(page, target) {
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 300; }, null, { timeout: 120000 });
  for (let i = 0; i < 10; i++) {
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog], dialog[open]");
      if (!dialog) return true;
      const button = [...dialog.querySelectorAll("button")].find(b => /close|start|got it|continue|build/i.test(b.textContent + (b.getAttribute("aria-label") ?? "")));
      button?.click();
      return false;
    });
    if (closed) break;
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 }).catch(() => report.errors.push("rig never idle"));
  await page.waitForTimeout(3000);
}

const viewer = page => page.locator("[data-viewer]").first();
async function canvasShot(page, path) {
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div").forEach(d => { if (!d.querySelector("canvas")) d.style.visibility = "hidden"; }));
  await viewer(page).screenshot({ path });
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div").forEach(d => { d.style.visibility = ""; }));
}
async function shot(page, name, settle = 4000) {
  await page.waitForTimeout(settle);
  await viewer(page).screenshot({ path: join(outDir, `${name}.png`) });
}
function diff(a, b) {
  const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b));
  if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: [A.width, A.height, B.width, B.height] };
  const out = new PNG({ width: A.width, height: A.height });
  const differing = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0 });
  let maxChannel = 0;
  for (let i = 0; i < A.data.length; i++) maxChannel = Math.max(maxChannel, Math.abs(A.data[i] - B.data[i]));
  return { differing, total: A.width * A.height, maxChannel };
}
const PANEL = '[role=group][aria-label="Lighting and backdrop"]';
const panel = page => page.locator(PANEL);
const card = (page, name) => page.locator(`${PANEL} details:has(> summary:has-text("${name}"))`).first();
async function openPanel(page) { if (!(await panel(page).count())) await page.click('button[title="Lighting and backdrop"]'); }
async function closePanel(page) { if (await panel(page).count()) await page.keyboard.press("Escape"); }
async function setRange(locator, value) {
  await locator.evaluate((input, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function chip(page, name) { await openPanel(page); await panel(page).getByRole("button", { name, exact: true }).click(); }
async function expand(page, name) {
  const details = card(page, name);
  if (!(await details.evaluate(d => d.open))) await details.locator("> summary").click();
  return details;
}
async function section(page, title) {
  const details = page.locator(`${PANEL} details.group:has(> summary:text-is("${title}"))`);
  if (!(await details.evaluate(d => d.open))) await details.locator("> summary").click();
  return details;
}
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting") ?? "null"));
const background = page => page.evaluate(() => document.querySelector("[data-viewer]").style.background);
const still = page => page.evaluate(() => window.__rigAnim?.stop());

// ---- 1. Automated: the default look is unchanged, whatever is stored; the Lobby look is main's Lobby.
if (only.has("auto")) {
  report.automated = {};
  for (const [name, target] of [["baseline", baselineUrl], ["build", url]]) {
    const { context, page } = await newPage({ person: false, seed: CUSTOM });
    await open(page, target);
    await page.waitForTimeout(6000);
    await canvasShot(page, join(outDir, `auto-studio-${name}.png`));
    report.automated[`${name}Background`] = await background(page);
    if (name === "baseline") await page.click('button[title="Toggle scene lighting"]');
    else { await chip(page, "Lobby"); await closePanel(page); }
    await page.waitForTimeout(9000);
    await canvasShot(page, join(outDir, `auto-lobby-${name}.png`));
    report.automated[`${name}LobbyBackground`] = await background(page);
    await context.close();
  }
  report.automated.studioDiff = diff(join(outDir, "auto-studio-baseline.png"), join(outDir, "auto-studio-build.png"));
  report.automated.lobbyDiff = diff(join(outDir, "auto-lobby-baseline.png"), join(outDir, "auto-lobby-build.png"));
  console.log("automated", JSON.stringify(report.automated));
}

// ---- 2. As a person.
if (only.has("person")) {
  const { context, page } = await newPage({ person: true });
  await open(page, url);
  await still(page);
  await shot(page, "studio-default", 5000);
  await openPanel(page);
  await shot(page, "panel-1-top", 500);
  await panel(page).evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  await shot(page, "panel-2-middle", 300);
  for (const title of ["Sky and reflections", "Camera"]) await section(page, title);
  await panel(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await shot(page, "panel-3-bottom", 300);
  await panel(page).evaluate(el => { el.scrollTop = 0; });

  // Sun looks.
  for (const name of ["Low sun", "Side light", "Overhead", "Backlit"]) {
    await chip(page, name);
    await closePanel(page);
    await shot(page, `sunlook-${name.toLowerCase().replace(/ /g, "-")}`);
  }
  // A warm sun, low and to the left, with a blue rim and an added green light from the right.
  await chip(page, "Low sun");
  const sun = await expand(page, "Sun");
  await sun.locator('input[type=color][aria-label="Colour"]').fill("#ffb060");
  const rim = await expand(page, "Rim");
  await rim.locator('input[type=color][aria-label="Colour"]').fill("#3060ff");
  await setRange(rim.locator('input[aria-label="Brightness"]'), 3);
  await panel(page).getByRole("button", { name: "Add light" }).click();
  await page.waitForTimeout(500);
  const added = await expand(page, "Light 3");
  await added.locator('input[type=color][aria-label="Colour"]').fill("#30ff70");
  await setRange(added.locator('input[aria-label="Direction"]'), 100);
  await setRange(added.locator('input[aria-label="Brightness"]'), 2);
  await closePanel(page);
  await shot(page, "colours-warm-sun-blue-rim-green-light", 6000);
  report.colours = (await stored(page))?.current?.lights?.map(l => [l.name, l.color, l.intensity]);

  // Backdrop: preset, solid picker, gradient pickers.
  await openPanel(page);
  await panel(page).getByRole("radio", { name: "Black", exact: true }).click();
  await closePanel(page);
  await shot(page, "backdrop-black", 2500);
  await openPanel(page);
  await panel(page).locator('input[type=color][aria-label="Colour"]').first().fill("#224466");
  await closePanel(page);
  await shot(page, "backdrop-solid-picked", 2500);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Gradient", exact: true }).click();
  await panel(page).locator('input[type=color][aria-label="Centre"]').fill("#ffe0a0");
  await panel(page).locator('input[type=color][aria-label="Edge"]').fill("#402010");
  await closePanel(page);
  await shot(page, "backdrop-gradient-picked", 2500);
  report.backdrop = await background(page);

  // Reflections, exposure, tone mapping.
  await openPanel(page);
  const sky = await section(page, "Sky and reflections");
  await sky.locator('select[aria-label="Reflections"]').selectOption("room");
  await setRange(sky.locator('input[aria-label="Reflection turn"]'), 90);
  const camera = await section(page, "Camera");
  await setRange(camera.locator('input[aria-label="Exposure"]'), 1.4);
  await camera.locator('select[aria-label="Tone mapping"]').selectOption("agx");
  await closePanel(page);
  await shot(page, "room-reflections-agx-exposure", 6000);
  await openPanel(page);
  await (await section(page, "Camera")).locator('select[aria-label="Tone mapping"]').selectOption("aces");
  await closePanel(page);
  await shot(page, "aces-live-switch", 6000);

  // Reload in the middle of a drag: the change is flushed when the page hides.
  await openPanel(page);
  await setRange((await section(page, "Camera")).locator('input[aria-label="Exposure"]'), 0.8);
  const exposureNow = await page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting")).current.exposure);
  await open(page, url); // navigates away at once: pagehide must write it
  report.reloadMidDrag = { storedBeforeReload: exposureNow, afterReload: (await stored(page)).current.exposure };
  await still(page);
  await shot(page, "after-reload", 5000);

  // Save, reset, undo, Lobby.
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Save current look" }).click();
  report.savedLooks = (await stored(page)).looks.length;
  report.buttonLabel = await page.locator('button[title="Lighting and backdrop"]').innerText();
  await panel(page).getByRole("button", { name: "Reset to Studio" }).click();
  report.reset = { background: await background(page), label: await page.locator('button[title="Lighting and backdrop"]').innerText(),
    undoShown: await panel(page).getByRole("button", { name: "Undo" }).count() };
  await closePanel(page);
  await shot(page, "after-reset");
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Undo" }).click();
  report.undo = { background: await background(page), exposure: (await stored(page)).current.exposure };
  await chip(page, "Lobby");
  await closePanel(page);
  await shot(page, "lobby", 6000);
  await openPanel(page);
  const rimLeft = await expand(page, "Rim left");
  await rimLeft.locator('input[type=color][aria-label="Colour"]').fill("#ff2020");
  const rimRight = await expand(page, "Rim right");
  await rimRight.locator('input[type=color][aria-label="Colour"]').fill("#ff6020");
  await closePanel(page);
  await shot(page, "lobby-red-rims", 6000);
  report.lobbyLabel = await page.locator('button[title="Lighting and backdrop"]').innerText();

  if (only.has("emote")) {
    await chip(page, "Studio");
    await chip(page, "Low sun");
    await closePanel(page);
    report.travel = await page.evaluate(async () => {
      const rig = window.__rigAnim, a = rig.animator;
      const pelvisAt = () => { const p = a.root?.getObjectByName("pelvis"); p?.updateWorldMatrix(true, false); return p ? [p.matrixWorld.elements[12], p.matrixWorld.elements[14]] : [0, 0]; };
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      let best = { id: null, distance: 0, time: 0 };
      for (const clip of a.manifest.clips.filter(c => !c.loop).slice(0, 60)) {
        try { await rig.play(clip.id); } catch { continue; }
        const duration = a.timeline()?.duration ?? 0;
        for (const f of [0.25, 0.5, 0.75, 0.95]) {
          rig.seek(duration * f); await frame();
          const [x, z] = pelvisAt(), d = Math.hypot(x, z);
          if (d > best.distance) best = { id: clip.id, distance: +d.toFixed(3), time: +(duration * f).toFixed(3) };
        }
      }
      return best;
    });
    if (report.travel.id) {
      await page.evaluate(({ id, time }) => window.__rigAnim.play(id, time), report.travel);
      await page.waitForTimeout(300);
      await page.evaluate(({ time }) => window.__rigAnim.seek(time), report.travel);
      await shot(page, "travelling-emote-floor", 6000);
    }
  }
  await context.close();
}

if (only.has("phone")) {
  const { context, page } = await newPage({ person: true, viewport: { width: 390, height: 844 }, mobile: true });
  await open(page, url);
  await still(page);
  report.phone = { scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) };
  await page.screenshot({ path: join(outDir, "phone-closed.png") });
  await openPanel(page);
  report.phonePanel = await panel(page).evaluate(el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; });
  await page.screenshot({ path: join(outDir, "phone-panel.png") });
  await chip(page, "Low sun");
  await closePanel(page);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(outDir, "phone-low-sun.png") });
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify(report, null, 1));
