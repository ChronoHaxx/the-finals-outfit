// Graphics panel check (10 Nov 2026): opens the panel at desktop and phone size (full-size screenshots), switches
// anti-aliasing / resolution / FPS, checks the accumulator and canvas follow, and that the settings survive a reload
// without dropping saved fields this version does not know.
// Usage (Git Bash or PowerShell, worktree root, dev server on 5182): node _docs/graphics-options-2026-11-10/check-graphics-ui.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const OUT = "scripts/generated/graphics-ui";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const check = (name, passed, details = {}) => { results.push({ name, passed: !!passed, ...details }); console.log(passed ? "PASS" : "FAIL", name, JSON.stringify(details)); };

async function open(viewport, deviceScaleFactor, extra = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, ...extra });
  // A saved object from a "future" version: its unknown field must survive every write.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("finals-outfit.graphics", JSON.stringify({ choice: "auto", futureField: { keep: true } }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/?reconstructed=1&anim=outfit-idle`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  // The dev-only recovered-shader panel (absent in production) sits over the phone layout's buttons.
  await page.addStyleTag({ content: "[data-viewer] > .absolute.left-2.top-2 { display: none !important; }" });
  return { context, page, errors };
}
const status = page => page.evaluate(() => ({ ...window.__temporalPreview, canvas: [document.querySelector("[data-viewer] canvas").width, document.querySelector("[data-viewer] canvas").height] }));
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.graphics") ?? "{}"));

// Desktop at 2x pixel density.
{
  const { context, page, errors } = await open({ width: 1400, height: 900 }, 2);
  const before = await status(page);
  check("TAA by default: motion vectors while the idle plays", before.motion && before.reprojected && before.msaa === 0, { motion: before.motion, reprojected: before.reprojected });
  await page.getByRole("button", { name: /^Graphics/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/desktop-panel.png` });
  // MSAA
  await page.getByRole("group", { name: "Graphics settings" }).getByText("MSAA", { exact: true }).click(); await page.waitForTimeout(800);
  const msaa = await status(page);
  check("MSAA: 4 samples, no motion path, no jitter history while moving", msaa.msaa === 4 && !msaa.motion && msaa.animating, { msaa: msaa.msaa, motion: msaa.motion, animating: msaa.animating });
  // Off
  await page.getByRole("group", { name: "Graphics settings" }).getByText("Off", { exact: true }).click(); await page.waitForTimeout(800);
  const off = await status(page);
  check("Off: no MSAA, no motion path", off.msaa === 0 && !off.motion && off.animating, { msaa: off.msaa, motion: off.motion });
  // Resolution 50%: 2x screen -> 1x canvas
  const wide = (await status(page)).canvas;
  await page.getByLabel("Render resolution").selectOption("0.5"); await page.waitForTimeout(800);
  const half = (await status(page)).canvas;
  check("Resolution 50% halves the canvas on a 2x screen", Math.abs(half[0] * 2 - wide[0]) <= 2, { wide, half });
  await page.getByLabel("Show FPS counter").check(); await page.waitForTimeout(1500);
  const fps = await page.getByLabel("Frame rate").innerText().catch(() => "");
  check("FPS counter shows a reading", /fps/.test(fps), { fps: fps.replace(/\n/g, " | ") });
  await page.screenshot({ path: `${OUT}/desktop-fps.png` });
  const stored = await saved(page);
  check("settings saved, unknown field kept", stored.aa === "off" && stored.resolution === 0.5 && stored.showFps === true && stored.futureField?.keep === true, stored);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 240000 });
  await page.waitForTimeout(2000);
  const after = await status(page);
  check("after reload: Off and 50% still in effect", after.msaa === 0 && !after.motion && Math.abs(after.canvas[0] - half[0]) <= 2, { canvas: after.canvas });
  check("after reload: FPS counter still on", await page.getByLabel("Frame rate").count() === 1);
  // Back to defaults (so the next run starts clean) and Escape closes the panel.
  await page.getByRole("button", { name: /^Graphics/ }).click();
  await page.getByRole("group", { name: "Graphics settings" }).getByText("TAA", { exact: true }).click();
  await page.getByLabel("Render resolution").selectOption("auto");
  await page.getByLabel("Show FPS counter").uncheck();
  await page.keyboard.press("Escape");
  check("Escape closes the panel", await page.getByRole("group", { name: "Graphics settings" }).count() === 0);
  check("desktop: no page errors", errors.length === 0, { errors });
  await context.close();
}

// Phone (coarse pointer, 3x screen).
{
  const { context, page, errors } = await open({ width: 375, height: 812 }, 3, { hasTouch: true, isMobile: true });
  await page.getByRole("button", { name: /^Graphics/ }).click();
  await page.waitForTimeout(400);
  const box = await page.getByRole("group", { name: "Graphics settings" }).boundingBox();
  check("phone: panel fits the screen width", box && box.x >= 0 && box.x + box.width <= 375, { box });
  await page.screenshot({ path: `${OUT}/phone-panel.png` });
  check("phone: no page errors", errors.length === 0, { errors });
  await context.close();
}
writeFileSync(`${OUT}/check.json`, JSON.stringify(results, null, 1));
console.log(`${results.filter(r => r.passed).length}/${results.length} pass`);
await browser.close();
