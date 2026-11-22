// Scene backdrops (#57): the user checklist (functional-review.md, steps 1-7) run by an agent on a PRODUCTION build, as
// a visitor would: the same clicks, drags, wheel, keys and (step 7) CDP touch, a full-page screenshot at each point to
// judge by looking, and the page's stored settings read back. Screenshots are game renders: keep <outDir> out of git.
//   node checklist-run.mjs <url> <outDir>      e.g. url = http://127.0.0.1:5261/the-finals-outfit/
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: checklist-run.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const report = { url, when: new Date().toISOString(), errors: [], checks: [] };
const check = (step, name, pass, detail = "") => {
  report.checks.push({ step, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${step}] ${name}${detail ? ` · ${detail}` : ""}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const CANVAS = "[data-viewer] > div:not([aria-hidden=true]) canvas";
const PANEL = '[role=group][aria-label="Lighting and backdrop"]';

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  return { context, page };
}
async function open(page, closeDrawer = true) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(sel => { const c = document.querySelector(sel); return c && c.width > 200; }, CANVAS, { timeout: 120000 });
  for (let i = 0; i < 20; i++) {
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      if (!dialog) return true;
      [...dialog.querySelectorAll("button")].find(b => /enter builder|close|start|got it|continue/i.test(b.textContent + (b.getAttribute("aria-label") ?? "")))?.click();
      return false;
    });
    if (closed) break;
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 }).catch(() => report.errors.push("rig never idle"));
  if (closeDrawer) await setDrawer(page, false);
  await page.waitForTimeout(2500);
}
async function setDrawer(page, open) {
  await page.evaluate(wanted => {
    const tab = document.querySelector('button[aria-controls="items-drawer-panel"]');
    if (tab && (tab.getAttribute("aria-expanded") === "true") !== wanted) tab.click();
  }, open);
  await page.waitForTimeout(1500);
}
const lookName = page => page.locator('button[title="Lighting and backdrop"]').textContent().then(t => (t ?? "").trim().toLowerCase());
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting") ?? "{}"));
async function setPanel(page, wanted) {
  if ((await page.locator(PANEL).count() > 0) !== wanted) await page.locator('button[title="Lighting and backdrop"]').click();
  await page.waitForTimeout(300);
}
async function pickScene(page, label) {
  await setPanel(page, true);
  await page.locator('[role=radiogroup][aria-label="Scenes"] [role=radio]', { hasText: label }).click();
  await page.waitForTimeout(6000);
}
async function pickLook(page, label) {
  await setPanel(page, true);
  await page.locator(`${PANEL} button[aria-pressed]`, { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(2500);
}
async function dragAcross(page, fromX, toX, yFraction = 0.6) {
  const box = await page.locator(CANVAS).boundingBox();
  const y = box.y + box.height * yFraction;
  await page.mouse.move(box.x + box.width * fromX, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
}
async function wheel(page, deltaY, times) {
  const box = await page.locator(CANVAS).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let i = 0; i < times; i++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(120); }
  await page.waitForTimeout(1500);
}

const { page } = await newPage();
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) });
await open(page);

// 1. The default is unchanged, and a drag orbits the camera.
await shot("s1-studio");
check(1, "opens on Studio, no scene stored", (await lookName(page)).includes("studio") && !(await stored(page)).current?.backdrop?.scene, await lookName(page));
await dragAcross(page, 0.4, 0.6);
await shot("s1-orbited");

// 2. The menu stage; the drawer open and closed; the screenshot panel's note.
await pickScene(page, "Season 12 menu");
await shot("s2-menu-panel");
await setPanel(page, false);
await setDrawer(page, true);
await shot("s2-drawer-open");
await setDrawer(page, false);
await shot("s2-drawer-closed");
await page.locator('button[title="Save a screenshot (PNG)"]').click();
await page.waitForTimeout(500);
const note = await page.getByText("the scene itself isn’t in screenshots yet").count();
await shot("s2-screenshot-panel");
check(2, "the screenshot panel says the scene isn't in screenshots", note > 0);
await page.locator('button[title="Save a screenshot (PNG)"]').click();
await page.waitForTimeout(400);
check(2, "the scene is stored", (await stored(page)).current?.backdrop?.scene === "s12-menu");

// 3. Turntable: drags, wheel, arrow keys.
await dragAcross(page, 0.4, 0.6);
await shot("s3-drag-right");
await dragAcross(page, 0.6, 0.3);
await shot("s3-drag-left");
await wheel(page, -200, 6);
await shot("s3-zoom-in");
await wheel(page, 400, 12);
await shot("s3-zoom-out");
const box = await page.locator(CANVAS).boundingBox();
await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85);
for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(150); }
await page.waitForTimeout(1200);
await shot("s3-arrow-left");
for (let i = 0; i < 6; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); }
await page.waitForTimeout(1200);
await shot("s3-arrow-right");

// 4. The tunnel; zoomed in the shoes stay on the same tiles.
await pickScene(page, "Season 12 intro tunnel");
await setPanel(page, false);
await shot("s4-tunnel");
await wheel(page, -200, 8);
await shot("s4-tunnel-zoom");
await wheel(page, 400, 12);

// 5. Leave the scene: turn part way, pick Studio; it faces forward and orbits again; a reload keeps Studio.
await dragAcross(page, 0.4, 0.55);
await shot("s5-turned");
await pickLook(page, "Studio");
await setPanel(page, false);
await shot("s5-studio");
check(5, "Studio stores no scene", !(await stored(page)).current?.backdrop?.scene);
await dragAcross(page, 0.4, 0.6);
await shot("s5-orbit");
await page.reload({ waitUntil: "domcontentloaded" });
await open(page);
await shot("s5-reload");
check(5, "after a reload: Studio, and the scene does not come back",
  (await lookName(page)).includes("studio") && !(await stored(page)).current?.backdrop?.scene, await lookName(page));

// 6. Saved across a reload: the menu stage comes back.
await pickScene(page, "Season 12 menu");
await setPanel(page, false);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(sel => { const c = document.querySelector(sel); return c && c.width > 200; }, CANVAS, { timeout: 120000 });
await page.waitForTimeout(400);
await shot("s6-loading");
await open(page);
await shot("s6-after-reload");
check(6, "the menu scene is still chosen after a reload", (await stored(page)).current?.backdrop?.scene === "s12-menu");

// 7. Phone: one-finger drag turns, a pinch zooms (CDP touch, not a real finger).
{
  const { context, page: phone } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pshot = name => phone.screenshot({ path: join(outDir, `${name}.png`) });
  await open(phone, false);
  await pshot("s7-phone-start");
  const cdp = await context.newCDPSession(phone);
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  for (const label of ["Season 12 menu", "Season 12 intro tunnel"]) {
    await setPanel(phone, true);
    await phone.locator('[role=radiogroup][aria-label="Scenes"] [role=radio]', { hasText: label }).click();
    await phone.waitForTimeout(6000);
    await setPanel(phone, false);
    const slug = label.toLowerCase().replace(/ /g, "-");
    await pshot(`s7-${slug}`);
    const c = await phone.locator(CANVAS).boundingBox();
    const y = c.y + c.height * 0.45;
    await touch("touchStart", [[c.x + c.width * 0.3, y]]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [[c.x + c.width * (0.3 + 0.04 * i), y]]);
    await touch("touchEnd", []);
    await phone.waitForTimeout(1500);
    await pshot(`s7-${slug}-drag`);
    const cx = c.x + c.width * 0.5;
    await touch("touchStart", [[cx - 30, y], [cx + 30, y]]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [[cx - 30 - 8 * i, y], [cx + 30 + 8 * i, y]]);
    await touch("touchEnd", []);
    await phone.waitForTimeout(1500);
    await pshot(`s7-${slug}-pinch`);
  }
  await context.close();
}

report.errors = [...new Set(report.errors)];
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter(c => !c.pass).length;
console.log(`${report.checks.length - failed}/${report.checks.length} scripted pass (the rest is judged from the screenshots); ${report.errors.length} page errors${report.errors.length ? `: ${report.errors.slice(0, 6).join(" | ")}` : ""}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
