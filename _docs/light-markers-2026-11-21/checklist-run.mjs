// The user checklist (functional-review.md, steps 1-6), run by an agent on a PRODUCTION build (no DEV hooks), as a
// visitor would: the same clicks and drags, a full-page screenshot at each step to judge by looking, and the page's own
// text, sliders and stored settings read back. Screenshots and saved PNGs are game renders: keep <outDir> out of git.
//   node --import tsx _docs/light-markers-2026-11-21/checklist-run.mjs <url> <outDir>
// e.g. url = http://127.0.0.1:5261/the-finals-outfit/?reconstructed=1 (vite preview --base /the-finals-outfit/).
// Bulbs are found with the viewer's default camera (0, 1, 3.6) → (0, 0.9, 0), 35°, and confirmed by hovering them: the
// bulb under the pointer shows its DOM label "Name · bearing° / height°".
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { markerPosition, studioLook } from "../../src/lib/stage-lighting.ts";
const require = createRequire(import.meta.url);
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const page = await context.newPage();
page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error") report.errors.push(`console: ${m.text().slice(0, 300)}`); });

const CANVAS = "[data-viewer] > div:not([aria-hidden=true]) canvas";
const PANEL = '[role=group][aria-label="Lighting and backdrop"]';
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting") ?? "{}"));
const lookName = () => page.locator('button[title="Lighting and backdrop"]').textContent().then(t => (t ?? "").trim().toLowerCase());
const panelOpen = () => page.locator(PANEL).count().then(n => n > 0);
async function setPanel(wanted) {
  if ((await panelOpen()) !== wanted) await page.locator('button[title="Lighting and backdrop"]').click();
  await page.waitForTimeout(250);
}
async function open() {
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
  await page.evaluate(() => {
    const tab = document.querySelector('button[aria-controls="items-drawer-panel"]');
    if (tab?.getAttribute("aria-expanded") === "true") tab.click();
  });
  await page.waitForTimeout(2500);
}

// Screen point of a light's bulb with the default camera.
async function bulbAt(light) {
  const box = await page.locator(CANVAS).boundingBox();
  const camera = new THREE.PerspectiveCamera(35, box.width / box.height, 0.05, 100);
  camera.position.set(0, 1, 3.6); camera.lookAt(0, 0.9, 0); camera.updateMatrixWorld();
  const p = new THREE.Vector3(...markerPosition(light)).project(camera);
  return { x: box.x + (p.x + 1) / 2 * box.width, y: box.y + (1 - p.y) / 2 * box.height };
}
const lights = async () => (await stored()).current?.lights ?? studioLook().lights;
// The marker labels on the page: [{ name, bearing, height }].
const labels = () => page.evaluate(() => [...document.querySelectorAll("[data-viewer] *")]
  .filter(e => e.children.length === 0 && /^.+ · -?\d+° \/ -?\d+°$/.test(e.textContent.trim()))
  .map(e => { const m = e.textContent.trim().match(/^(.+) · (-?\d+)° \/ (-?\d+)°$/); return { name: m[1], bearing: +m[2], height: +m[3] }; }));
async function hoverLabel(point) {
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.waitForTimeout(350);
  return labels();
}
async function drag(from, to, steps = 16, midShot) {
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: steps / 2 });
  if (midShot) await shot(midShot);
  await page.mouse.move(to.x, to.y, { steps: steps / 2 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}
const sunCard = () => page.locator(`${PANEL} details`).first();
const sliderValue = (card, label) => card.locator(`input[aria-label="${label}"]`).first().inputValue().then(Number);
async function dragSlider(card, label, fraction) {
  const box = await card.locator(`input[aria-label="${label}"]`).first().boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
const angles = ([x, y, z]) => ({ bearing: Math.round(Math.atan2(x, z) * 180 / Math.PI), height: Math.round(Math.asin(y / Math.hypot(x, y, z)) * 180 / Math.PI) });

await open();
await shot("step0-builder");

// 1. Show the lights.
await setPanel(true);
check(1, "the top button says Studio", (await lookName()).includes("studio"), await lookName());
await page.getByRole("checkbox", { name: "Show lights in the 3D view" }).click();
await page.waitForTimeout(1500);
await page.mouse.move(5, 5);
await shot("step1-show-lights");
check(1, "the panel stays open", await panelOpen());
const studio = await lights();
const found = [];
for (const light of studio) found.push((await hoverLabel(await bulbAt(light))).map(l => l.name).join(","));
check(1, "a bulb for each light, where its light is (hovering shows its label)", found.join("|") === studio.map(l => l.name).join("|"), found.join(" | "));
await page.mouse.move(5, 5);

// 2. Drag the Sun's bulb across to the left of his head.
const sun = studio.find(l => l.role === "sun");
const from = await bulbAt(sun);
const to = await bulbAt({ ...sun, position: [-Math.sin(55 * Math.PI / 180) * 6, 4.5, Math.cos(55 * Math.PI / 180) * 6] });
await drag(from, to, 16, "step2-mid-drag");
await shot("step2-after-drag");
const afterDrag = (await lights()).find(l => l.id === sun.id);
const a = angles(afterDrag.position);
const card = sunCard();
const label2 = (await labels()).find(l => l.name === sun.name);
check(2, "the panel stays open through the drag", await panelOpen());
check(2, "the sun moved round to the left", a.bearing < -30, JSON.stringify(a));
check(2, "the label shows Sun · bearing / height", label2 && label2.bearing === a.bearing && label2.height === a.height, JSON.stringify(label2));
check(2, "the Sun card is outlined and its Direction/Height read the label's numbers",
  (await card.getAttribute("class")).includes("border-finals") && await sliderValue(card, "Direction") === a.bearing && await sliderValue(card, "Height") === a.height,
  `${await sliderValue(card, "Direction")} / ${await sliderValue(card, "Height")}`);
const under = await hoverLabel(await bulbAt(afterDrag));
check(2, "the camera did not turn: the bulb is drawn where the default camera puts it", under.some(l => l.name === sun.name), JSON.stringify(under));
await page.mouse.move(5, 5);

// 3. Slider to bulb: Direction moves the bulb; Brightness the cone; Colour the bulb and cone.
await dragSlider(card, "Direction", 0.9);
const turned = (await lights()).find(l => l.id === sun.id);
check(3, "the Direction slider turns the light", Math.abs(angles(turned.position).bearing - a.bearing) > 40, `${a.bearing} → ${angles(turned.position).bearing}`);
const under3 = await hoverLabel(await bulbAt(turned));
check(3, "the bulb followed the slider", under3.some(l => l.name === sun.name), JSON.stringify(under3));
await page.mouse.move(5, 5);
await shot("step3-direction");
await dragSlider(card, "Brightness", 1.0);
await shot("step3-brightness-high");
await dragSlider(card, "Brightness", 0.08);
await shot("step3-brightness-low");
check(3, "Brightness changes the light", (await lights()).find(l => l.id === sun.id).intensity < turned.intensity);
await dragSlider(card, "Brightness", 0.5);
await card.locator('input[type="color"]').first().fill("#33ff66");
await page.waitForTimeout(700);
await shot("step3-colour");
check(3, "the Colour picker recolours the light", (await lights()).find(l => l.id === sun.id).color === "#33ff66");

// 4. Never in a picture: Save PNG while the bulbs show; then H and H again.
await setPanel(false);
// The camera button (its title since the capture panel gained video, 22 Nov 2026).
const CAPTURE = 'button[title="Save a screenshot or an emote video"]';
await page.locator(CAPTURE).click();
await page.waitForTimeout(400);
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }), page.getByRole("button", { name: "Save PNG" }).click()]);
await download.saveAs(join(outDir, "step4-saved.png"));
// The capture panel's video (#63) draws through the same capture camera: record the idle as an MP4 while the bulbs
// show; frames are pulled out with ffmpeg afterwards and judged by eye.
await page.getByRole("tab", { name: "Video" }).click();
await page.waitForTimeout(300);
const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
await page.getByLabel("Video size").selectOption({ label: sizes[sizes.length - 1] });
const [video] = await Promise.all([page.waitForEvent("download", { timeout: 900000 }), page.getByRole("button", { name: "Record video" }).click()]);
await video.saveAs(join(outDir, `step4-video${video.suggestedFilename().replace(/^.*(\.[a-z0-9]+)$/i, "$1")}`));
check(4, "a video was recorded with the bulbs showing (judge its frames by looking)", true, `${video.suggestedFilename()} · size ${sizes[sizes.length - 1]}`);
await page.getByRole("tab", { name: "Image" }).click();
await page.locator(CAPTURE).click();
await page.waitForTimeout(400);
await shot("step4-before-h");
await page.keyboard.press("h");
await page.waitForTimeout(1200);
await shot("step4-after-h");
await page.keyboard.press("h");
await page.waitForTimeout(1200);
await shot("step4-h-again");
check(4, "a PNG was saved (judge it by looking)", true, "step4-saved.png");

// 5. The new looks.
for (const label of ["Dramatic", "Cool", "Warm", "Fullbright", "Nighttime", "Season 12 menu"]) {
  await setPanel(true);
  await page.locator(`${PANEL} button[aria-pressed]`, { hasText: new RegExp(`^${label}$`) }).first().click();
  await setPanel(false);
  await page.waitForTimeout(label === "Season 12 menu" ? 5000 : 3000);
  await page.mouse.move(5, 5);
  const slug = label.toLowerCase().replace(/ /g, "-");
  await shot(`step5-${slug}`);
  const ls = await lights();
  const seen = [];
  for (const light of ls) seen.push((await hoverLabel(await bulbAt(light))).map(l => l.name).join(","));
  await page.mouse.move(5, 5);
  check(5, `${label}: the button shows its name, and the bulbs are its lights`,
    (await lookName()).includes(label.toLowerCase()) && seen.join("|") === ls.map(l => l.name).join("|"), `${await lookName()} · ${seen.join(" | ") || "no lights"}`);
}
// In the Season 12 menu: drag the blue light's bulb; the light moves, the character does not turn (judge by looking).
{
  const blue = (await lights()).find(l => l.id === "blue-side");
  const p = await bulbAt(blue);
  await drag(p, { x: p.x + 160, y: p.y - 40 }, 16, "step5-s12-mid-drag");
  await page.mouse.move(5, 5);
  await shot("step5-s12-after-drag");
  const moved = (await lights()).find(l => l.id === "blue-side");
  check(5, "Season 12 menu: dragging the blue bulb moves its light", JSON.stringify(moved.position) !== JSON.stringify(blue.position),
    `${JSON.stringify(angles(blue.position))} → ${JSON.stringify(angles(moved.position))}`);
}

// 6. Kept after a reload: pick a look, drag a bulb, Save current look, reload.
await setPanel(true);
await page.locator(`${PANEL} button[aria-pressed]`, { hasText: /^Warm$/ }).first().click();
await page.waitForTimeout(1500);
const warmSun = (await lights()).find(l => l.role === "sun");
const w = await bulbAt(warmSun);
await drag(w, { x: w.x - 120, y: w.y + 30 });
await page.getByRole("button", { name: "Save current look" }).click();
await page.waitForTimeout(800);
await page.mouse.move(5, 5);
await shot("step6-before-reload");
const before6 = await stored();
await page.reload({ waitUntil: "domcontentloaded" });
await open();
await setPanel(true);
await page.mouse.move(5, 5);
await page.waitForTimeout(800);
await shot("step6-after-reload");
const after6 = await stored();
check(6, "the bulbs are still shown", after6.markers === true && await page.getByRole("checkbox", { name: "Show lights in the 3D view" }).isChecked());
check(6, "the look is as left, and the button says Custom", JSON.stringify(after6.current?.lights) === JSON.stringify(before6.current?.lights) && (await lookName()).includes("custom"), await lookName());
check(6, "the saved look is still in the list", (after6.looks?.length ?? 0) >= 1 && (after6.looks?.length ?? 0) === (before6.looks?.length ?? 0),
  `${before6.looks?.length} → ${after6.looks?.length}: ${(after6.looks ?? []).map(l => l.name).join(", ")}`);
const back = await hoverLabel(await bulbAt((await lights()).find(l => l.role === "sun")));
check(6, "the dragged sun's bulb is where it was left", back.some(l => l.name === warmSun.name), JSON.stringify(back));

report.errors = [...new Set(report.errors)];
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter(c => !c.pass).length;
console.log(`${report.checks.length - failed}/${report.checks.length} pass; ${report.errors.length} page errors${report.errors.length ? `: ${report.errors.slice(0, 6).join(" | ")}` : ""}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
