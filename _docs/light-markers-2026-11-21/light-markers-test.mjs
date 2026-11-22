// Light markers and the new looks (21 Nov 2026). Headless Chrome against a dev server (DEV hooks: __rigRoot, __THREE).
// Screenshots and saved PNGs go to <outDir>: renders of game assets, keep them out of git.
//   node _docs/light-markers-2026-11-21/light-markers-test.mjs <url> <outDir>
// e.g. url = http://127.0.0.1:5261/?reconstructed=1. ONLY=looks,markers,captures,hide,persist,scene,phone picks sections.
// The page runs as a person (navigator.webdriver false), so it reads and writes this browser's stored look, as a visitor's
// does; each run starts from a fresh browser profile.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: light-markers-test.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const only = new Set((process.env.ONLY ?? "looks,markers,captures,hide,persist,scene,phone").split(","));
const report = { url, when: new Date().toISOString(), errors: [], checks: [] };
const check = (name, pass, detail = "") => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });

async function newPage({ viewport = { width: 1440, height: 900 }, mobile = false } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, reducedMotion: "reduce",
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  return { context, page };
}

async function open(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const c = document.querySelector("[data-viewer] > div:not([aria-hidden=true]) canvas"); return c && c.width > 200; }, null, { timeout: 120000 });
  // The welcome screen (a dialog over the builder): its Enter builder button.
  for (let i = 0; i < 20; i++) {
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
  // The items drawer closed, so the stage is wide.
  await page.evaluate(() => {
    const tab = document.querySelector('button[aria-controls="items-drawer-panel"]');
    if (tab?.getAttribute("aria-expanded") === "true") tab.click();
  });
  // Pause the idle animation: still frames converge, and a marker's place on screen holds still.
  await page.evaluate(() => [...document.querySelectorAll("button")].find(b => /^pause$/i.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(2500);
}

const panelOpen = page => page.locator('[role=group][aria-label="Lighting and backdrop"]').count().then(n => n > 0);
async function setPanel(page, wanted) {
  if ((await panelOpen(page)) !== wanted) await page.locator('button[title="Lighting and backdrop"]').click();
  await page.waitForTimeout(200);
}
// The button's text is upper-cased by its style, so names compare case-blind.
const lookName = page => page.locator('button[title="Lighting and backdrop"]').textContent().then(t => (t ?? "").toLowerCase());
async function applyLook(page, label) {
  await setPanel(page, true);
  await page.locator('[role=group][aria-label="Lighting and backdrop"] button[aria-pressed]', { hasText: new RegExp(`^${label}$`) }).first().click();
  await setPanel(page, false);
}
async function setMarkers(page, on) {
  await setPanel(page, true);
  const box = page.getByRole("checkbox", { name: "Show lights in the 3D view" });
  if ((await box.isChecked()) !== on) await box.click();
  await setPanel(page, false);
}
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.lighting") ?? "{}"));

// Stage only: the overlay controls and drawer hidden for the shot, then shown again.
async function stageShot(page, path) {
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div, aside").forEach(d => {
    if (!d.querySelector("canvas")) d.dataset.shotHidden = d.style.visibility = "hidden";
  }));
  await page.locator("[data-viewer]").first().screenshot({ path });
  await page.evaluate(() => document.querySelectorAll("[data-shot-hidden]").forEach(d => { d.style.visibility = ""; delete d.dataset.shotHidden; }));
}

// The selected marker's ring is #ec2c4c; nothing else on the default outfit is that red.
function ringPixels(buffer) {
  const png = PNG.sync.read(buffer);
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    if (a > 128 && r > 190 && g < 90 && b < 110) n++;
  }
  return n;
}

// Where each marker is on screen (page pixels): the markers' world positions, projected with the live camera's numbers.
// Outside scene mode and before any orbit, the camera is the viewer's default (0, 1, 3.6) looking at (0, 0.9, 0), 35°.
async function markerPoints(page) {
  return page.evaluate(() => {
    const THREE = window.__THREE, root = window.__rigRoot;
    const scene = root?.parent;
    const group = scene?.getObjectByName("Light markers");
    const canvas = document.querySelector("[data-viewer] > div:not([aria-hidden=true]) canvas");
    if (!THREE || !group || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const camera = window.__viewerCamera ?? new THREE.PerspectiveCamera(35, rect.width / rect.height, 0.05, 100);
    if (!window.__viewerCamera) { camera.position.set(0, 1, 3.6); camera.lookAt(0, 0.9, 0); }
    camera.updateMatrixWorld();
    return group.children.map(marker => {
      const p = marker.getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    });
  });
}
const sliders = page => page.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="Lighting and backdrop"] input[type=range]')]
  .map(r => [r.getAttribute("aria-label"), Number(r.value)]));
const angles = position => {
  const [x, y, z] = position, d = Math.hypot(x, y, z);
  return { bearing: Math.atan2(x, z) * 180 / Math.PI, height: Math.asin(y / d) * 180 / Math.PI };
};

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

const { page } = await newPage();
await open(page);
check("starts on Studio, markers off", (await lookName(page)).includes("studio") && !(await stored(page)).markers);

if (only.has("looks")) {
  for (const label of ["Studio", "Lobby", "Season 12 menu", "Dramatic", "Cool", "Warm", "Fullbright", "Nighttime"]) {
    await applyLook(page, label);
    await page.waitForTimeout(3500);
    await stageShot(page, join(outDir, `look-${label.toLowerCase().replace(/ /g, "-")}.png`));
    check(`look ${label} applies and is named`, (await lookName(page)).includes(label.toLowerCase()));
  }
  await applyLook(page, "Studio");
}

if (only.has("markers")) {
  await setMarkers(page, true);
  await page.waitForTimeout(1500);
  const points = await markerPoints(page);
  check("markers mount, one per light", points?.length === 2, JSON.stringify(points));
  await stageShot(page, join(outDir, "markers-studio.png"));
  // Drag the sun's bulb a third of the stage to the left: the light follows, the panel's sliders read the same.
  const before = (await stored(page)).current?.lights?.[0]?.position ?? [2.5, 6, 4];
  const canvas = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").boundingBox();
  await setPanel(page, true);
  // The target is inside the dome's outline on screen (past it the bulb slides round the rim, by design).
  const target = { x: canvas.x + canvas.width * 0.42, y: points[0].y + 20 };
  await drag(page, points[0], target);
  check("the panel stays open through a marker drag", await panelOpen(page));
  await page.waitForTimeout(500);
  const look = (await stored(page)).current;
  const sun = look?.lights?.find(l => l.id === "sun");
  const a = sun ? angles(sun.position) : null;
  const s = await sliders(page);
  check("the dragged sun turned to the left of the character", a && a.bearing < -20, JSON.stringify(a));
  check("the sun keeps its distance", sun && Math.abs(Math.hypot(...sun.position) - Math.hypot(...before)) < 1e-6);
  check("Direction and Height sliders show the dragged light", a && s[1]?.[0] === "Direction" && s[1][1] === Math.round(a.bearing)
    && s[2]?.[0] === "Height" && s[2][1] === Math.round(a.height), JSON.stringify(s.slice(0, 3)));
  const after = await markerPoints(page);
  check("the bulb ends under the pointer", Math.hypot(after[0].x - target.x, after[0].y - target.y) < 6,
    `${after[0].x.toFixed(1)},${after[0].y.toFixed(1)} vs ${target.x.toFixed(1)},${target.y.toFixed(1)}`);
  check("the sun's card is picked in the panel", await page.locator("details.border-finals").count() === 1);
  await stageShot(page, join(outDir, "markers-dragged.png"));
  // The orbit camera did not move during the marker drag: the default camera still projects the bulb where it is drawn.
  const shot = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").screenshot();
  check("the selected bulb's ring is drawn on screen", ringPixels(shot) > 20, `${ringPixels(shot)} px`);
  // A slider moves the bulb.
  const sliderBox = await page.locator('[role=group][aria-label="Lighting and backdrop"] input[aria-label="Direction"]').first().boundingBox();
  await page.mouse.click(sliderBox.x + sliderBox.width * 0.85, sliderBox.y + sliderBox.height / 2);
  await page.waitForTimeout(500);
  const moved = await markerPoints(page);
  check("moving the Direction slider moves the bulb", moved[0].x > after[0].x + 50, `${after[0].x.toFixed(0)} → ${moved[0].x.toFixed(0)}`);
  await setPanel(page, false);
}

if (only.has("captures")) {
  // The PNG screenshot, on the backdrop and transparent, while the selected bulb's red ring shows on screen.
  for (const transparent of [false, true]) {
    await page.locator('button[title="Save a screenshot or an emote video"]').click();
    if (transparent) await page.getByRole("radio", { name: "Transparent" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save PNG" }).click()]);
    const file = join(outDir, `screenshot-${transparent ? "transparent" : "backdrop"}.png`);
    await download.saveAs(file);
    check(`screenshot (${transparent ? "transparent" : "backdrop"}) has no marker`, ringPixels(readFileSync(file)) === 0,
      `${ringPixels(readFileSync(file))} ring px`);
    if (transparent) await page.getByRole("radio", { name: "Backdrop" }).click();
    await page.locator('button[title="Save a screenshot or an emote video"]').click();
  }
  // The share card (a JPEG), drawn by the same module the Share button uses; decoded and counted in the page.
  const card = await page.evaluate(async () => {
    const handle = await import("/src/lib/viewer-handle.ts");
    const render = await import("/src/rig/SharePreviewRender.ts");
    const blob = await render.renderSharePreview(handle.getPreviewScene(), null);
    const bitmap = await createImageBitmap(blob);
    const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ring = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 190 && data[i + 1] < 90 && data[i + 2] < 110) ring++;
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), ring };
  });
  writeFileSync(join(outDir, "share-card.jpg"), Buffer.from(card.bytes));
  check("share card has no marker", card.ring === 0, `${card.ring} ring px`);
  const shot = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").screenshot();
  check("the markers are still on screen after the captures", ringPixels(shot) > 20, `${ringPixels(shot)} px`);
}

if (only.has("hide")) {
  await page.keyboard.press("h");
  await page.waitForTimeout(1200);
  const hidden = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").screenshot();
  check("H hides the markers with the rest of the UI", ringPixels(hidden) === 0, `${ringPixels(hidden)} px`);
  await page.keyboard.press("h");
  await page.waitForTimeout(1200);
  const back = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").screenshot();
  check("H again brings them back", ringPixels(back) > 20, `${ringPixels(back)} px`);
}

if (only.has("persist")) {
  await setPanel(page, true);
  await page.getByRole("button", { name: "Save current look" }).click();
  await setPanel(page, false);
  const savedBefore = (await stored(page)).looks?.length ?? 0;
  const lookBefore = JSON.stringify((await stored(page)).current?.lights);
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page);
  const after = await stored(page);
  check("after a reload: markers still on, the look and saved looks kept",
    after.markers === true && JSON.stringify(after.current?.lights) === lookBefore && (after.looks?.length ?? 0) === savedBefore && savedBefore >= 1,
    `saved ${savedBefore} → ${after.looks?.length}`);
  check("markers mount again after the reload", (await markerPoints(page))?.length === 2);
  // A ready-made look and Undo leave the saved looks alone.
  await applyLook(page, "Warm");
  await setPanel(page, true);
  await page.getByRole("button", { name: "Undo" }).click();
  await setPanel(page, false);
  check("Undo after a look brings the dragged look back", JSON.stringify((await stored(page)).current?.lights) === lookBefore);
}

if (only.has("scene")) {
  // In the Season 12 menu scene the camera is fixed and a drag turns the character; a drag on a bulb must not.
  // (The stage draws in a second canvas behind the viewer's: the viewer's own is the one outside the aria-hidden stage layer.)
  await setMarkers(page, true);
  await applyLook(page, "Season 12 menu");
  await page.waitForTimeout(3000);
  await stageShot(page, join(outDir, "markers-s12-menu.png"));
  const points = await markerPoints(page);
  const turn = () => page.evaluate(() => window.__rigRoot.rotation.y);
  const canvas = await page.locator("[data-viewer] > div:not([aria-hidden=true]) canvas").boundingBox();
  const blue = points?.[1];
  const before = (await stored(page)).current.lights.find(l => l.id === "blue-side");
  await drag(page, blue, { x: blue.x + canvas.width * 0.15, y: blue.y - 30 });
  const afterLight = (await stored(page)).current.lights.find(l => l.id === "blue-side");
  check("scene: a bulb drag moves its light", JSON.stringify(before.position) !== JSON.stringify(afterLight.position));
  check("scene: a bulb drag does not turn the character", Math.abs(await turn()) < 1e-9, `turn ${await turn()}`);
  await drag(page, { x: canvas.x + canvas.width * 0.15, y: canvas.y + canvas.height * 0.8 },
    { x: canvas.x + canvas.width * 0.3, y: canvas.y + canvas.height * 0.8 });
  check("scene: a drag elsewhere still turns the character", Math.abs(await turn()) > 0.05, `turn ${await turn()}`);
  await applyLook(page, "Studio");
}

if (only.has("phone")) {
  const { page: phone, context } = await newPage({ viewport: { width: 390, height: 844 }, mobile: true });
  await open(phone);
  await setMarkers(phone, true);
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: join(outDir, "phone-markers.png") });
  const points = await markerPoints(phone);
  check("phone: markers mount", points?.length === 2, JSON.stringify(points));
  await context.close();
}

report.errors = [...new Set(report.errors)];
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter(c => !c.pass).length;
console.log(`${report.checks.length - failed}/${report.checks.length} pass; ${report.errors.length} page errors${report.errors.length ? `: ${report.errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
