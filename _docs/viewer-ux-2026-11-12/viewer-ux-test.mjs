// Viewer UX (12 Nov 2026): items drawer, hide UI (H), transparent screenshots. Headless Chrome against production
// builds. Full-size screenshots and saved PNGs go to <outDir> (renders of game assets: keep them out of git).
//   node _docs/viewer-ux-2026-11-12/viewer-ux-test.mjs <url> <baselineUrl> <outDir>
// ONLY=auto,desktop,shot,phone,landscape picks sections.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const [url, baselineUrl, outDir] = process.argv.slice(2);
if (!url || !baselineUrl || !outDir) throw new Error("usage: viewer-ux-test.mjs <url> <baselineUrl> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const report = { url, baselineUrl, when: new Date().toISOString(), errors: [], checks: [] };
const only = new Set((process.env.ONLY ?? "auto,desktop,shot,phone,landscape").split(","));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const check = (name, pass, detail = "") => { report.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

async function newPage({ person, viewport = { width: 1440, height: 900 }, mobile = false, scale = 1 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, reducedMotion: "reduce", deviceScaleFactor: scale,
    ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  if (person) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  return { context, page };
}

async function open(page, target) {
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 200; }, null, { timeout: 120000 });
  for (let i = 0; i < 10; i++) {
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
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

const shot = async (page, name, settle = 2500) => { await page.waitForTimeout(settle); await page.screenshot({ path: join(outDir, `${name}.png`) }); };
const box = (page, selector) => page.locator(selector).first().boundingBox();
const canvasBox = page => box(page, "[data-viewer] canvas");
const drawerTab = page => page.locator('button[aria-controls="items-drawer-panel"]');
const expanded = async page => (await drawerTab(page).getAttribute("aria-expanded")) === "true";
const uiHidden = page => page.evaluate(() => document.documentElement.classList.contains("ui-hidden"));
const equipped = page => page.locator('section[aria-label="Your outfit"] li').allInnerTexts();
// Stored outfit data, everything but this feature's own view keys and the lighting.
const outfitStorage = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort()
  .filter(k => !/drawer|screenshot|lighting/.test(k)).map(k => [k, localStorage.getItem(k)])));
// Element shots capture whatever overlaps the stage too: the drawer's edge tab sits over its corner. Hide the drawer.
const hideAside = (page, hidden) => page.evaluate(h => document.querySelectorAll("aside").forEach(a => { a.style.visibility = h ? "hidden" : ""; }), hidden);
async function canvasShot(page, path) {
  await hideAside(page, true);
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div").forEach(d => { if (!d.querySelector("canvas")) d.style.visibility = "hidden"; }));
  await page.locator("[data-viewer]").first().screenshot({ path });
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div").forEach(d => { d.style.visibility = ""; }));
  await hideAside(page, false);
}
// The CSS backdrop alone: canvas and overlays hidden.
async function backdropShot(page, path) {
  await hideAside(page, true);
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > *").forEach(d => { d.style.visibility = "hidden"; }));
  await page.locator("[data-viewer]").first().screenshot({ path });
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > *").forEach(d => { d.style.visibility = ""; }));
  await hideAside(page, false);
}
function diff(a, b) {
  const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b));
  if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: [A.width, A.height, B.width, B.height] };
  const differing = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0 });
  let maxChannel = 0;
  for (let i = 0; i < A.data.length; i++) maxChannel = Math.max(maxChannel, Math.abs(A.data[i] - B.data[i]));
  return { differing, total: A.width * A.height, maxChannel };
}

// ---- Screenshot panel helpers.
const SHOT_PANEL = '[role=group][aria-label="Screenshot"]';
async function openShotPanel(page) { if (!(await page.locator(SHOT_PANEL).count())) await page.click('button[aria-label="Screenshot"]'); }
async function saveShot(page, { transparent, keepFloor = false, scale = 1 }, path) {
  await openShotPanel(page);
  await page.locator(`${SHOT_PANEL} [role=radio]`, { hasText: transparent ? "Transparent" : "Backdrop" }).click();
  if (transparent) {
    const floor = page.locator(`${SHOT_PANEL} input[type=checkbox]`);
    if ((await floor.isChecked()) !== keepFloor) await floor.click();
  }
  const options = await page.locator(`${SHOT_PANEL} select option`).evaluateAll(o => o.map(x => `${x.value}:${x.textContent}`));
  if (!options.some(o => o.startsWith(`${scale}:`))) throw new Error(`no ${scale}x size offered: ${options.join(" | ")}`);
  await page.selectOption(`${SHOT_PANEL} select`, String(scale));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }),
    page.locator(`${SHOT_PANEL} button`, { hasText: "Save PNG" }).click()]);
  await download.saveAs(path);
  const status = await page.locator(`${SHOT_PANEL} [role=status]`).innerText();
  await page.keyboard.press("Escape");
  return { name: download.suggestedFilename(), status };
}
function readPng(path) {
  const buffer = readFileSync(path);
  return { png: PNG.sync.read(buffer), colorType: buffer[25], depth: buffer[24] };
}
// Straight-alpha image over another image (or a checkerboard), as an editor composites: out = c*a + b*(1-a).
function over(top, below) {
  const out = new PNG({ width: top.width, height: top.height });
  for (let i = 0; i < top.data.length; i += 4) {
    const a = top.data[i + 3] / 255;
    const x = (i / 4) % top.width, y = Math.floor(i / 4 / top.width);
    for (let c = 0; c < 3; c++) {
      const b = below ? below.data[i + c] : (((x >> 4) + (y >> 4)) % 2 ? 200 : 120);
      out.data[i + c] = Math.round(top.data[i + c] * a + b * (1 - a));
    }
    out.data[i + 3] = 255;
  }
  return out;
}
function alphaStats(png) {
  let clear = 0, solid = 0, partial = 0;
  for (let i = 3; i < png.data.length; i += 4) { const a = png.data[i]; if (a === 0) clear++; else if (a === 255) solid++; else partial++; }
  return { clear, solid, partial };
}
function compare(A, B, mask) {
  let n = 0, sum = 0, max = 0, over4 = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (mask && !mask(i)) continue;
    n++;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A.data[i + c] - B.data[i + c]); sum += d; max = Math.max(max, d); if (d > 4) over4++; }
  }
  return { pixels: n, meanDiff: +(sum / Math.max(1, n * 3)).toFixed(3), maxDiff: max, channelsOver4: over4 };
}

// ---- 1. Automation contract: the harnesses' canvas box at their phone-layout viewport, this build vs PR #40.
if (only.has("auto")) {
  const boxes = {};
  for (const [name, target] of [["baseline", baselineUrl], ["build", url]]) {
    const { context, page } = await newPage({ person: false, viewport: { width: 760, height: 1100 } });
    await open(page, target);
    await page.waitForTimeout(6000);
    boxes[name] = await canvasBox(page);
    await canvasShot(page, join(outDir, `auto-760-${name}.png`));
    await context.close();
  }
  report.autoBoxes = boxes;
  check("automation: canvas box at 760x1100 unchanged", JSON.stringify(boxes.baseline) === JSON.stringify(boxes.build),
    `${JSON.stringify(boxes.baseline)} vs ${JSON.stringify(boxes.build)}`);
  const d = diff(join(outDir, "auto-760-baseline.png"), join(outDir, "auto-760-build.png"));
  report.autoDiff = d;
  check("automation: canvas pixels at 760x1100", !d.sizeMismatch && d.differing / d.total < 0.002, JSON.stringify(d));
}

// ---- 2. Desktop: drawer, memory, picker state, hide UI.
if (only.has("desktop")) {
  const { context, page } = await newPage({ person: true });
  await open(page, url);
  const before = { equipped: await equipped(page), storage: await outfitStorage(page) };
  await shot(page, "desktop-open");
  const openBox = await canvasBox(page);
  check("desktop: drawer open by default", await expanded(page));
  // Picker state: a slot, a search and a scrolled grid survive a close and an open.
  await page.click('nav[aria-label="Cosmetic slots"] button:has-text("Upper Body")');
  await page.fill('input[type=search]', "jacket");
  await page.waitForTimeout(800);
  await page.evaluate(() => { const g = document.querySelector('[aria-label="Cosmetic results"]'); g.scrollTop = 300; });
  const pickerBefore = await page.evaluate(() => ({ search: document.querySelector("input[type=search]").value,
    slot: document.querySelector('nav[aria-label="Cosmetic slots"] [aria-current=true]')?.textContent,
    scroll: document.querySelector('[aria-label="Cosmetic results"]').scrollTop }));
  await drawerTab(page).click();
  await shot(page, "desktop-closed");
  const closedBox = await canvasBox(page);
  check("desktop: closing widens the stage to the window", closedBox.width === 1440 && closedBox.width > openBox.width,
    `${openBox.width} -> ${closedBox.width}`);
  check("desktop: closed drawer is inert", await page.evaluate(() => document.getElementById("items-drawer-panel").inert));
  check("desktop: tab stays reachable", await drawerTab(page).isVisible());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 });
  check("desktop: closed state remembered after reload", !(await expanded(page)));
  // The reload resets the picker (not remembered across reloads, as before); state across toggles is checked next.
  await drawerTab(page).click();
  await page.click('nav[aria-label="Cosmetic slots"] button:has-text("Upper Body")');
  await page.fill('input[type=search]', "jacket");
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelector('[aria-label="Cosmetic results"]').scrollTop = 300; });
  const mid = await page.evaluate(() => document.querySelector('[aria-label="Cosmetic results"]').scrollTop);
  await drawerTab(page).click();
  await page.waitForTimeout(300);
  await drawerTab(page).click();
  const pickerAfter = await page.evaluate(() => ({ search: document.querySelector("input[type=search]").value,
    slot: document.querySelector('nav[aria-label="Cosmetic slots"] [aria-current=true]')?.textContent,
    scroll: document.querySelector('[aria-label="Cosmetic results"]').scrollTop }));
  check("desktop: slot, search and grid scroll survive close/open", pickerAfter.search === "jacket"
    && pickerAfter.slot === pickerBefore.slot && pickerAfter.scroll === mid, `${JSON.stringify(pickerBefore)} / ${JSON.stringify(pickerAfter)} mid=${mid}`);
  // Keyboard: the tab is a button; Enter toggles it.
  await drawerTab(page).focus();
  await page.keyboard.press("Enter");
  check("desktop: Enter on the tab closes", !(await expanded(page)));
  await page.keyboard.press("Enter");
  check("desktop: Enter on the tab opens", await expanded(page));

  // Typing H in a field never hides.
  await page.fill('input[type=search]', "");
  await page.focus('input[type=search]');
  await page.keyboard.type("hh");
  check("hide UI: H typed in search is text, UI stays", !(await uiHidden(page))
    && (await page.inputValue('input[type=search]')) === "hh");
  await page.fill('input[type=search]', "");
  await page.locator("[data-viewer] canvas").click({ position: { x: 600, y: 400 } });
  // H hides.
  await page.keyboard.press("h");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, "desktop-hidden-hint.png") });
  const hidden = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains("ui-hidden"),
    cursor: getComputedStyle(document.querySelector("[data-viewer] canvas")).cursor,
    header: getComputedStyle(document.querySelector("header")).visibility,
    hint: document.querySelector("[role=status] .animate-hint")?.textContent ?? null,
    hintOpacity: (() => { const e = document.querySelector(".animate-hint"); return e ? Number(getComputedStyle(e).opacity) : null; })(),
    canvas: (() => { const r = document.querySelector("[data-viewer] canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
  }));
  check("hide UI: H hides UI and cursor", hidden.cls && hidden.cursor === "none" && hidden.header === "hidden", JSON.stringify(hidden));
  check("hide UI: hint shown (and visible with reduced motion)", hidden.hint === "Press H to show UI" && hidden.hintOpacity > 0.9,
    `${hidden.hint} opacity ${hidden.hintOpacity}`);
  check("hide UI: stage fills the window", JSON.stringify(hidden.canvas) === JSON.stringify([0, 0, 1440, 900]), JSON.stringify(hidden.canvas));
  await shot(page, "desktop-hidden-clean", 3200);
  check("hide UI: hint gone after a few seconds", !(await page.locator(".animate-hint").count()));
  await page.keyboard.press("h");
  check("hide UI: H again restores", !(await uiHidden(page)));
  await page.keyboard.press("h");
  await page.keyboard.press("Escape");
  check("hide UI: Esc restores", !(await uiHidden(page)));
  await page.keyboard.press("h");
  await page.mouse.dblclick(700, 450);
  await page.waitForTimeout(200);
  check("hide UI: double-click restores", !(await uiHidden(page)));
  await page.keyboard.press("Control+h").catch(() => {});
  check("hide UI: Ctrl+H ignored", !(await uiHidden(page)));
  // The eye button does the same.
  await page.click('button[aria-label="Hide UI"]');
  check("hide UI: eye button hides", await uiHidden(page));
  await page.keyboard.press("h");
  // Full screen and hidden UI together: Esc takes one layer at a time.
  await page.click('button[aria-label="Full screen"]');
  await page.waitForTimeout(800);
  await page.keyboard.press("h");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const layers = await page.evaluate(() => ({ hidden: document.documentElement.classList.contains("ui-hidden"),
    exitButton: !!document.querySelector('button[aria-label="Exit full screen"]') }));
  report.fullscreenEsc = layers;
  check("full screen + hidden UI: first Esc brings the UI back", !layers.hidden, JSON.stringify(layers));
  if (layers.exitButton) await page.click('button[aria-label="Exit full screen"]');
  await page.waitForTimeout(500);
  const after = { equipped: await equipped(page), storage: await outfitStorage(page) };
  check("outfit untouched by every toggle", JSON.stringify(before) === JSON.stringify(after));
  await shot(page, "desktop-after-toggles");
  await context.close();
}

// ---- 3. Screenshots: backdrop and transparent PNGs against the screen.
if (only.has("shot")) {
  const { context, page } = await newPage({ person: true });
  await open(page, url);
  await page.waitForTimeout(5000);
  await openShotPanel(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, "shot-panel.png") });
  await page.keyboard.press("Escape");
  for (const theme of ["studio", "lobby"]) {
    if (theme === "lobby") { await page.click('button[title="Toggle scene lighting"]'); await page.waitForFunction(() => window.__rigIdle === true); await page.waitForTimeout(8000); }
    await canvasShot(page, join(outDir, `${theme}-screen.png`));
    await backdropShot(page, join(outDir, `${theme}-css-backdrop.png`));
    // The floor kept: the backdrop file has the contact shadow, so the like-for-like transparent file needs it too
    // (leaving it out is checked separately below).
    const b = await saveShot(page, { transparent: false }, join(outDir, `${theme}-png-backdrop.png`));
    const t = await saveShot(page, { transparent: true, keepFloor: true }, join(outDir, `${theme}-png-transparent.png`));
    report[`${theme}Saved`] = { b, t };
    const screen = PNG.sync.read(readFileSync(join(outDir, `${theme}-screen.png`)));
    const css = PNG.sync.read(readFileSync(join(outDir, `${theme}-css-backdrop.png`)));
    const backdrop = readPng(join(outDir, `${theme}-png-backdrop.png`));
    const transparent = readPng(join(outDir, `${theme}-png-transparent.png`));
    check(`${theme}: transparent PNG is RGBA 8-bit`, transparent.colorType === 6 && transparent.depth === 8, `type ${transparent.colorType} depth ${transparent.depth}`);
    const stats = alphaStats(transparent.png);
    report[`${theme}Alpha`] = stats;
    check(`${theme}: transparent PNG has clear, solid and soft-edge pixels`, stats.clear > 0 && stats.solid > 0 && stats.partial > 0, JSON.stringify(stats));
    check(`${theme}: 1x PNG is the stage size`, transparent.png.width === screen.width && backdrop.png.width === screen.width,
      `${transparent.png.width}x${transparent.png.height} vs ${screen.width}x${screen.height}`);
    writeFileSync(join(outDir, `${theme}-transparent-over-checker.png`), PNG.sync.write(over(transparent.png, null)));
    const recomposed = over(transparent.png, css);
    writeFileSync(join(outDir, `${theme}-transparent-over-css-backdrop.png`), PNG.sync.write(recomposed));
    // Where nothing is drawn, the painted backdrop must be the CSS one.
    const clearOnly = i => transparent.png.data[i + 3] === 0;
    report[`${theme}BackdropVsCss`] = compare(backdrop.png, css, clearOnly);
    check(`${theme}: PNG backdrop matches the CSS gradient`, report[`${theme}BackdropVsCss`].maxDiff <= 3, JSON.stringify(report[`${theme}BackdropVsCss`]));
    // The transparent PNG over the CSS backdrop equals the backdrop PNG (same render, two encodings).
    report[`${theme}TransparentVsBackdrop`] = compare(recomposed, backdrop.png);
    check(`${theme}: transparent over backdrop == backdrop PNG`, report[`${theme}TransparentVsBackdrop`].maxDiff <= 4, JSON.stringify(report[`${theme}TransparentVsBackdrop`]));
    // And both match the screen (a converged still view either way; jitter patterns differ slightly at edges).
    report[`${theme}BackdropVsScreen`] = compare(backdrop.png, screen);
    check(`${theme}: backdrop PNG matches the screen`, report[`${theme}BackdropVsScreen`].meanDiff < 1.5, JSON.stringify(report[`${theme}BackdropVsScreen`]));
  }
  // Floor: with the floor shadow on, a transparent shot leaves it out unless kept.
  await page.click('button[title="Toggle scene lighting"]');
  await page.waitForFunction(() => window.__rigIdle === true);
  await page.click('button[aria-label="Lighting and backdrop"]');
  await page.locator('[role=group][aria-label="Lighting and backdrop"] label:has-text("Floor shadow") input').check();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(5000);
  await saveShot(page, { transparent: true, keepFloor: false }, join(outDir, "floor-off.png"));
  await saveShot(page, { transparent: true, keepFloor: true }, join(outDir, "floor-kept.png"));
  const off = alphaStats(readPng(join(outDir, "floor-off.png")).png), kept = alphaStats(readPng(join(outDir, "floor-kept.png")).png);
  report.floor = { off, kept };
  check("floor: kept shadow adds covered pixels", kept.clear < off.clear, JSON.stringify(report.floor));
  writeFileSync(join(outDir, "floor-kept-over-checker.png"), PNG.sync.write(over(readPng(join(outDir, "floor-kept.png")).png, null)));
  writeFileSync(join(outDir, "floor-off-over-checker.png"), PNG.sync.write(over(readPng(join(outDir, "floor-off.png")).png, null)));
  // 2x.
  const big = await saveShot(page, { transparent: true, scale: 2 }, join(outDir, "studio-2x-transparent.png"));
  const bigPng = readPng(join(outDir, "studio-2x-transparent.png")).png;
  const stage = await canvasBox(page);
  check("2x: twice the stage size", bigPng.width === Math.round(stage.width * 2) && bigPng.height === Math.round(stage.height * 2),
    `${bigPng.width}x${bigPng.height} for ${stage.width}x${stage.height} · ${big.status}`);
  writeFileSync(join(outDir, "studio-2x-over-checker.png"), PNG.sync.write(over(bigPng, null)));
  await context.close();
}

// ---- 4. Phone, upright: sheet, swipe, hide UI by double tap, panels within the screen.
if (only.has("phone")) {
  const { context, page } = await newPage({ person: true, viewport: { width: 390, height: 844 }, mobile: true, scale: 2 });
  await open(page, url);
  await shot(page, "phone-open");
  const stageOpen = await canvasBox(page);
  check("phone: sheet open by default, stage keeps the 44% height", await expanded(page) && Math.abs(stageOpen.height - Math.max(0.44 * 844, 256)) <= 1,
    JSON.stringify(stageOpen));
  check("phone: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const topRow = await page.evaluate(() => {
    const anchor = document.querySelector('[data-viewer] button[title="Toggle scene lighting"]').parentElement;
    return [...anchor.querySelectorAll(":scope > *")].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; });
  });
  check("phone: viewer top row fits the screen", topRow.every(([l, r]) => l >= 0 && r <= 390), JSON.stringify(topRow));
  await drawerTab(page).tap();
  await shot(page, "phone-closed");
  const stageClosed = await canvasBox(page);
  const handle0 = await drawerTab(page).boundingBox();
  check("phone: closed handle fits the screen", handle0.x >= 0 && handle0.x + handle0.width <= 390, JSON.stringify(handle0));
  check("phone: closed sheet gives the stage the screen", stageClosed.height > stageOpen.height + 300, JSON.stringify(stageClosed));
  // Swipe up on the handle opens.
  const handle = await drawerTab(page).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("phone: swipe up opens", await expanded(page));
  // Deep in the list, picking a slot brings the strip back to the sheet's top.
  await page.evaluate(() => { document.getElementById("items-drawer-panel").scrollTop = 1500; });
  await page.waitForTimeout(300);
  await shot(page, "phone-scrolled", 600);
  await page.locator('nav[aria-label="Cosmetic slots"] button').nth(3).tap();
  await page.waitForTimeout(500);
  const strip = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Cosmetic slots"]').getBoundingClientRect();
    const panel = document.getElementById("items-drawer-panel").getBoundingClientRect();
    return { nav: nav.top, panel: panel.top };
  });
  check("phone: slot strip sticks at the sheet's top", Math.abs(strip.nav - strip.panel) <= 2, JSON.stringify(strip));
  // Hide UI by the eye button, back by a double tap.
  await page.locator('button[aria-label="Hide UI"]').tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, "phone-hidden-hint.png") });
  check("phone: eye button hides", await uiHidden(page));
  const hint = await page.locator(".animate-hint").textContent().catch(() => null);
  check("phone: hint says double-tap", hint === "Double-tap to show UI", String(hint));
  await page.touchscreen.tap(200, 400);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(202, 402);
  await page.waitForTimeout(300);
  check("phone: double tap restores", !(await uiHidden(page)));
  // The share panel opens inside the sheet, unclipped. (No preview upload: this build has no share Worker set.)
  await page.evaluate(() => { document.getElementById("items-drawer-panel").scrollTop = 0; });
  await page.locator('button:has-text("Share")').first().tap();
  await page.waitForTimeout(600);
  await shot(page, "phone-share-panel", 300);
  const share = await page.evaluate(() => {
    const panel = document.querySelector('input[aria-label="Outfit share link"]')?.closest("div.absolute")?.getBoundingClientRect();
    const sheet = document.getElementById("items-drawer-panel").getBoundingClientRect();
    return panel && { top: panel.top, bottom: panel.bottom, sheetTop: sheet.top, sheetBottom: sheet.bottom };
  });
  check("phone: share panel inside the sheet", !!share && share.top >= share.sheetTop && share.bottom <= share.sheetBottom, JSON.stringify(share));
  await page.locator('button[aria-label="Close share panel"]').tap().catch(() => {});
  await page.click('button[aria-label="Screenshot"]');
  await shot(page, "phone-shot-panel", 500);
  const panelBox = await box(page, SHOT_PANEL);
  check("phone: screenshot panel within the screen", panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, JSON.stringify(panelBox));
  await page.keyboard.press("Escape");
  // Full screen: the wider exit button and the new buttons share the top row.
  await page.locator('button[aria-label="Full screen"]').tap();
  await page.waitForTimeout(800);
  await shot(page, "phone-fullscreen", 500);
  const row = await page.evaluate(() => [...document.querySelectorAll('[data-viewer] button[aria-label="Hide UI"], [data-viewer] button[aria-label="Exit full screen"], [data-viewer] button[title="Toggle scene lighting"]')]
    .map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
  check("phone: full-screen top row fits", row.length === 3 && row.every(([l, r]) => l >= 0 && r <= 390), JSON.stringify(row));
  await page.locator('button[aria-label="Exit full screen"]').tap();
  await context.close();
}

// ---- 5. Phone held sideways: the side drawer.
if (only.has("landscape")) {
  const { context, page } = await newPage({ person: true, viewport: { width: 844, height: 390 }, mobile: true, scale: 2 });
  await open(page, url);
  await shot(page, "landscape-open");
  const stage = await canvasBox(page);
  check("landscape: side drawer, stage beside it", stage.x > 300 && stage.height > 300, JSON.stringify(stage));
  const row = await page.evaluate(() => {
    const anchor = document.querySelector('[data-viewer] button[title="Toggle scene lighting"]').parentElement;
    const viewer = document.querySelector("[data-viewer]").getBoundingClientRect();
    return { viewer: [viewer.left, viewer.right], row: [...anchor.querySelectorAll(":scope > *")].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }) };
  });
  check("landscape: viewer top row fits the stage", row.row.every(([l, r]) => l >= row.viewer[0] && r <= row.viewer[1]), JSON.stringify(row));
  await drawerTab(page).tap();
  await shot(page, "landscape-closed");
  check("landscape: closed gives the full width", (await canvasBox(page)).width === 844);
  check("landscape: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // Rotation switches side <-> sheet: the picker is not remounted (its search survives) and the viewer is not reloaded.
  await drawerTab(page).tap();
  await page.fill('input[type=search]', "cap");
  const rigBefore = await page.evaluate(() => { window.__rotationMarker = document.querySelector("[data-viewer] canvas"); return true; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const portrait = await page.evaluate(() => ({ search: document.querySelector("input[type=search]").value,
    sameCanvas: window.__rotationMarker === document.querySelector("[data-viewer] canvas"),
    sheet: !!document.querySelector('button[aria-controls="items-drawer-panel"][title*="swipe"]') }));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => ({ search: document.querySelector("input[type=search]").value,
    sameCanvas: window.__rotationMarker === document.querySelector("[data-viewer] canvas") }));
  check("rotation: picker search survives side -> sheet -> side, same 3D canvas", rigBefore && portrait.sheet
    && portrait.search === "cap" && back.search === "cap" && portrait.sameCanvas && back.sameCanvas, JSON.stringify({ portrait, back }));
  await context.close();
}

await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter(c => !c.pass);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks pass; ${report.errors.length} page errors`);
if (report.errors.length) console.log(report.errors.slice(0, 10).join("\n"));
