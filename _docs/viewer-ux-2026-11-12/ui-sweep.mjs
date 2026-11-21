// UI sweep (15 Nov 2026): open every popover and panel of the builder at desktop and phone size, take a full-size
// screenshot of each, and check that it is on screen and not cut off by a scrolling or clipping ancestor.
//   node _docs/viewer-ux-2026-11-12/ui-sweep.mjs <url> <outDir>
// Use a local build: the Share step presses Share, which on the live site would upload a preview image.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: ui-sweep.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const report = { url, when: new Date().toISOString(), results: [], errors: [] };
const check = (name, pass, detail = "") => { report.results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

async function open(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 200; }, null, { timeout: 120000 });
  for (let i = 0; i < 10; i++) {
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      if (!dialog) return true;
      [...dialog.querySelectorAll("button")].find(b => /close|start|got it|continue|build/i.test(b.textContent + (b.getAttribute("aria-label") ?? "")))?.click();
      return false;
    });
    if (closed) break;
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 }).catch(() => report.errors.push("rig never idle"));
  await page.waitForTimeout(2500);
}

// Where the element is, and how much of it its clipping ancestors (overflow other than visible) and the window show.
const geometry = (page, selector) => page.evaluate(sel => {
  const el = typeof sel === "string" ? document.querySelector(sel) : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  let visible = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) };
  let clippedBy = null;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const b = a.getBoundingClientRect();
    const next = { left: Math.max(visible.left, b.left), top: Math.max(visible.top, b.top), right: Math.min(visible.right, b.right), bottom: Math.min(visible.bottom, b.bottom) };
    if ((next.right - next.left) * (next.bottom - next.top) < (visible.right - visible.left) * (visible.bottom - visible.top) - 4 && !clippedBy)
      clippedBy = `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""}.${[...a.classList].slice(0, 3).join(".")}`;
    visible = next;
  }
  const area = Math.max(1, r.width * r.height);
  const shown = Math.max(0, visible.right - visible.left) * Math.max(0, visible.bottom - visible.top);
  const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  return { box: round({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }), shownFraction: +(shown / area).toFixed(3), clippedBy };
}, selector);

async function sweep(name, viewport, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: "reduce", ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(`${name}: ${String(e).slice(0, 300)}`));
  const press = async locator => { await (mobile ? locator.tap() : locator.click()); await page.waitForTimeout(700); };
  const shot = async step => page.screenshot({ path: join(outDir, `${name}-${step}.png`) });
  const panel = async (step, selector) => {
    await shot(step);
    const g = await geometry(page, selector);
    check(`${name} ${step}: open and fully shown`, !!g && g.shownFraction >= 0.99, JSON.stringify(g));
  };
  await open(page);
  await shot("start");

  await press(page.locator('button[title="Graphics settings"]'));
  await panel("graphics", '[role="group"][aria-label="Graphics settings"]');
  await press(page.locator('button[title="Graphics settings"]'));

  await press(page.locator('button[title="Lighting and backdrop"]'));
  await panel("lighting", '[role="group"][aria-label="Lighting and backdrop"]');
  await press(page.locator('button[title="Lighting and backdrop"]'));

  await press(page.locator('button[aria-label="Screenshot"]'));
  await panel("screenshot", '[role="group"][aria-label="Screenshot"]');
  await press(page.locator('button[aria-label="Screenshot"]'));

  await press(page.locator('button[aria-label^="Saved outfits:"]'));
  await panel("saved-outfits", '[role="dialog"][aria-label="Saved outfits"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await press(page.locator('section[aria-label="Your outfit"] button', { hasText: /^Share/ }).first());
  await page.waitForTimeout(800);
  await panel("share", 'div.absolute:has(> * input[aria-label="Outfit share link"]), div.absolute:has(input[aria-label="Outfit share link"])');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await press(page.locator('nav[aria-label="Project links"] button').first());
  await panel("patch-notes", "dialog[open]");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const chinals = page.locator('[role="group"][aria-label="Game version"]:visible button', { hasText: "Chinals" });
  if (await chinals.count()) {
    await press(chinals.first());
    await page.waitForTimeout(2500);
    await shot("chinals");
    check(`${name} chinals: route and banner`, /chinals/i.test(page.url()) || /chinals/i.test(await page.locator("body").innerText()), page.url());
    await press(page.locator('[role="group"][aria-label="Game version"]:visible button', { hasText: "Global" }).first());
    await page.waitForTimeout(2500);
  } else check(`${name} chinals: toggle shown`, false);

  // An emote with its timeline.
  await press(page.locator('[data-viewer] button[title="Play an emote"]'));
  await panel("emote-picker", '[role="dialog"][aria-label="Emotes"]');
  await press(page.locator('[role="dialog"][aria-label="Emotes"] button:has(img)').first());
  await page.waitForTimeout(500);
  if (await page.locator('[role="dialog"][aria-label="Emotes"]').count()) await page.keyboard.press("Escape");
  await page.waitForTimeout(3000);
  await panel("emote-timeline", '[role="group"][aria-label$=" timeline"]');

  // Hidden UI.
  if (mobile) await press(page.locator('button[aria-label="Hide UI"]'));
  else { await page.locator("[data-viewer] canvas").click({ position: { x: 20, y: 300 } }); await page.keyboard.press("h"); }
  await page.waitForTimeout(800);
  await shot("hidden-ui");
  check(`${name} hidden UI: hidden`, await page.evaluate(() => document.documentElement.classList.contains("ui-hidden")));
  if (mobile) { await page.touchscreen.tap(195, 400); await page.waitForTimeout(120); await page.touchscreen.tap(195, 400); }
  else await page.keyboard.press("h");
  await page.waitForTimeout(800);

  await press(page.locator('nav[aria-label="Project links"] a', { hasText: "Roadmap" }).first());
  await page.waitForTimeout(2500);
  await shot("roadmap");
  check(`${name} roadmap: page shown`, /roadmap/i.test(page.url()), page.url());
  await context.close();
}

await sweep("desktop-1568x770", { width: 1568, height: 770 }, false);
await sweep("phone-390x844", { width: 390, height: 844 }, true);
await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = report.results.filter(r => !r.pass);
console.log(`\n${report.results.length - failed.length}/${report.results.length} checks pass; ${report.errors.length} page errors`);
for (const e of report.errors) console.log(e);
