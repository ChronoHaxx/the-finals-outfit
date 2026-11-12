// Lighting and backdrop options (11 Nov 2026), headless Chrome against production builds.
// 1. Automated (navigator.webdriver true): this build and the main baseline (43aefec) render the same pixels in Studio
//    and Lobby, even with custom lighting stored in localStorage (automation must ignore it).
// 2. As a person (webdriver reported false): floor shadow, sun height, built-in looks, backdrops, Lobby rim hues, saved
//    looks surviving a reload, Reset and Undo, a travelling emote with the floor on, a hologram over the floor shadow,
//    and the phone layout. Full-size screenshots of every look (renders of game assets: shots/ stays local).
//   node _docs/light-options-2026-11-11/light-options-test.mjs <url> <baselineUrl> <outDir>
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
const only = new Set((process.env.ONLY ?? "auto,person,lobby,emote,hologram,phone").split(","));

const CUSTOM = JSON.stringify({ current: { sunAzimuth: 90, sunElevation: 20, floorShadow: true, lobbyHue: 0,
  backdrop: { studio: "black", lobby: "white" } } });

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
// Only the canvas and the backdrop: overlays hidden, so builds with different controls compare.
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
const floorBox = page => page.locator(`${PANEL} label:has-text("Floor shadow") input`);
async function openPanel(page) { if (!(await panel(page).count())) await page.click('button[aria-label="Lighting and backdrop"]'); }
async function closePanel(page) { if (await panel(page).count()) await page.keyboard.press("Escape"); }
async function setRange(page, label, value) {
  await page.evaluate(([selector, value]) => {
    const input = document.querySelector(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [`${PANEL} input[aria-label="${label}"]`, value]);
}
async function look(page, name) { await openPanel(page); await panel(page).getByRole("button", { name, exact: true }).click(); }
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting") ?? "null"));
const background = page => page.evaluate(() => document.querySelector("[data-viewer]").style.background);
const still = page => page.evaluate(() => window.__rigAnim?.stop());

// ---- 1. Automated: the default look is unchanged, whatever is stored.
if (only.has("auto")) {
  report.automated = {};
  for (const [name, target] of [["baseline", baselineUrl], ["build", url]]) {
    const { context, page } = await newPage({ person: false, seed: CUSTOM });
    await open(page, target);
    await page.waitForTimeout(6000);
    await canvasShot(page, join(outDir, `auto-studio-${name}.png`));
    report.automated[`${name}Background`] = await background(page);
    await page.click('button[title="Toggle scene lighting"]');
    await page.waitForTimeout(9000);
    await canvasShot(page, join(outDir, `auto-lobby-${name}.png`));
    await context.close();
  }
  report.automated.studioDiff = diff(join(outDir, "auto-studio-baseline.png"), join(outDir, "auto-studio-build.png"));
  report.automated.lobbyDiff = diff(join(outDir, "auto-lobby-baseline.png"), join(outDir, "auto-lobby-build.png"));
  console.log("automated", JSON.stringify(report.automated));
}

// ---- 2. As a person: Studio looks, backdrops, persistence, Reset/Undo, then the Lobby and a travelling emote.
if (only.has("person")) {
  const { context, page } = await newPage({ person: true });
  await open(page, url);
  await still(page);
  await shot(page, "studio-default", 5000);
  await openPanel(page);
  await shot(page, "panel-studio", 500);
  await floorBox(page).check();
  await closePanel(page);
  await shot(page, "floor-reviewed-sun");
  for (const name of ["Side light", "Low sun", "Overhead", "Backlit"]) {
    await look(page, name);
    await closePanel(page);
    await shot(page, `look-${name.toLowerCase().replace(/ /g, "-")}`);
  }
  await openPanel(page);
  await setRange(page, "Sun direction", 30); await setRange(page, "Sun height", 10);
  await closePanel(page);
  await shot(page, "sun-30-height-10");
  report.lowSunStored = (await stored(page))?.current;
  await openPanel(page);
  await floorBox(page).uncheck();
  await closePanel(page);
  await shot(page, "sun-30-height-10-no-floor");
  await openPanel(page);
  await floorBox(page).check();
  await look(page, "Side light");
  for (const backdrop of ["Black", "White", "Green screen", "Dusk", "Lobby navy"]) {
    await openPanel(page);
    await panel(page).getByRole("radio", { name: backdrop, exact: true }).click();
    await closePanel(page);
    await shot(page, `studio-backdrop-${backdrop.toLowerCase().replace(/ /g, "-")}`, 2500);
  }
  // Saved look, reload, Reset, Undo.
  await look(page, "Low sun");
  await panel(page).getByRole("radio", { name: "Charcoal", exact: true }).click();
  await panel(page).getByRole("button", { name: "Save current look" }).click();
  const before = { stored: await stored(page), background: await background(page) };
  await open(page, url);
  await still(page);
  await openPanel(page);
  report.persistence = {
    before: before.stored.current, after: (await stored(page)).current,
    backgroundBefore: before.background, backgroundAfter: await background(page),
    floorChecked: await floorBox(page).isChecked(),
    sunHeight: await page.locator(`${PANEL} input[aria-label="Sun height"]`).inputValue(),
    savedLooks: before.stored.looks?.length, savedLooksShown: await panel(page).locator("li").count(),
  };
  await shot(page, "after-reload-panel", 4000);
  await panel(page).getByRole("button", { name: "Reset to default" }).click();
  report.reset = { current: (await stored(page)).current, background: await background(page),
    previous: (await stored(page)).previous, undoShown: await panel(page).getByRole("button", { name: "Undo" }).count() };
  await closePanel(page);
  await shot(page, "after-reset");
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Undo" }).click();
  report.undo = { current: (await stored(page)).current, background: await background(page) };
  await closePanel(page);
  await shot(page, "after-undo");

  if (only.has("lobby")) {
    await page.click('button[title="Toggle scene lighting"]');
    await page.waitForTimeout(6000);
    await still(page);
    await shot(page, "lobby-default", 5000);
    await openPanel(page);
    await shot(page, "panel-lobby", 500);
    for (const name of ["Red", "Gold", "Green", "Violet"]) {
      await look(page, name);
      await closePanel(page);
      await shot(page, `lobby-rim-${name.toLowerCase()}`);
    }
    await openPanel(page);
    await setRange(page, "Rim colour", 60);
    await closePanel(page);
    await shot(page, "lobby-rim-hue-60");
    await openPanel(page);
    await panel(page).getByRole("radio", { name: "Studio grey", exact: true }).click();
    await closePanel(page);
    await shot(page, "lobby-backdrop-studio-grey", 2500);
    report.lobbyStored = (await stored(page)).current;
    await page.click('button[title="Toggle scene lighting"]');
    await page.waitForTimeout(6000);
  }

  if (only.has("emote")) {
    // The clip whose pelvis travels furthest, held at that moment, with the floor shadow on.
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
          if (d > best.distance) best = { id: clip.id, distance: +d.toFixed(3), time: +(duration * f).toFixed(3), x: +x.toFixed(3), z: +z.toFixed(3) };
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

// A hologram (Holtow Halo, additive) over the floor shadow: the sun low in front, the camera above it on the sun's
// side, so the line of sight through the halo lands on the body's shadow behind the character. With the floor off,
// the same view for comparison.
if (only.has("hologram")) {
  const code = "1." + Buffer.from(JSON.stringify({ slots: { headwear: "attachment-holtowhalohologram-gold" } })).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  for (const [dx, dy, floor] of [[-60, 90, true], [60, 90, true], [-60, 90, false]]) {
    const { context, page } = await newPage({ person: true,
      seed: JSON.stringify({ current: { sunAzimuth: 0, sunElevation: 25, floorShadow: floor } }) });
    await open(page, `${url}?outfit=${code}`);
    await still(page);
    await page.waitForTimeout(2000);
    const box = await viewer(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 20 });
    await page.mouse.up();
    await shot(page, `hologram-${dx > 0 ? "right" : "left"}-${floor ? "floor" : "no-floor"}`, 7000);
    await context.close();
  }
}

if (only.has("phone")) {
  const { context, page } = await newPage({ person: true, viewport: { width: 390, height: 844 }, mobile: true });
  await open(page, url);
  await still(page);
  report.phone = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
    topRow: [...document.querySelectorAll("[data-viewer] button")].filter(b => b.getBoundingClientRect().top < 60)
      .map(b => { const r = b.getBoundingClientRect(); return [b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 24), Math.round(r.left), Math.round(r.right)]; }) }));
  await page.screenshot({ path: join(outDir, "phone-closed.png") });
  await openPanel(page);
  await floorBox(page).check();
  await page.waitForTimeout(3000);
  report.phonePanel = await panel(page).evaluate(el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; });
  await page.screenshot({ path: join(outDir, "phone-panel.png") });
  await closePanel(page);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(outDir, "phone-floor.png") });
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify(report, null, 1));
