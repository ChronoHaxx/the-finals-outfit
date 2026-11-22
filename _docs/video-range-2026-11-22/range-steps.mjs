// The video-range checklist (functional-checklist.md), run by the agent under the owner's standing waiver of manual
// checks (22 Nov 2026), against a production build served by `vite preview`. It uses the controls the steps name:
// the timeline's Video range button and markers, the I and O keys, the Video tab's typed times, Loops and the emote
// speed slider. Headless Chrome on the GPU, navigator.webdriver masked so sounds load.
//   node _docs/video-range-2026-11-22/range-steps.mjs <url> <outDir>      (Git Bash, worktree root, preview running)
// Downloads and screenshots go to <outDir> with report.json; analyse-range.py reads them. Keep <outDir> out of git.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: range-steps.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const EMOTE = process.env.EMOTE ?? "Applause Pause";
const report = { url, emote: EMOTE, when: new Date().toISOString(), checks: [], steps: {}, errors: [] };
const check = (step, name, pass, detail = "") => {
  report.checks.push({ step, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}. ${name}${detail ? ` · ${detail}` : ""}`);
};
const save = () => writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

async function openApp(tag, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...options });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(`${tag} pageerror: ${String(e).slice(0, 300)}`));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`${tag} console: ${m.text().slice(0, 300)}`); });
  await gotoApp(page);
  return { context, page };
}
async function gotoApp(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 200; }, null, { timeout: 180000 });
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
  await page.waitForFunction(() => window.__rigIdle === true && !!window.__rigAnim, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
}

const { context, page } = await openApp("desktop");
const panelButton = page.locator('button[aria-label^="Capture"]');
const panel = page.locator('[role=group][aria-label=Capture]');
const timeline = page.getByRole("group", { name: /timeline$/ });
const open = async () => { if (await panelButton.getAttribute("aria-expanded") !== "true") await panelButton.click(); await page.waitForTimeout(300); await page.getByRole("tab", { name: "Video" }).click(); };
const close = async () => { if (await panelButton.getAttribute("aria-expanded") === "true") await panelButton.click(); await page.waitForTimeout(300); };
const state = () => page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline(); return { ...a.state, time: t?.time ?? null, duration: t?.duration ?? null, recording: a.recording }; });
const fields = async () => ({ start: await page.getByLabel("Video start (seconds)").inputValue(), end: await page.getByLabel("Video end (seconds)").inputValue() });
const summary = () => panel.locator("span", { hasText: "frames at 60 fps" }).first().textContent();
async function pickEmote(label) {
  await close();
  await page.locator('button[title="Play an emote"]').click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor({ timeout: 30000 });
  await dialog.locator(`button[title^="${label}"]`).first().scrollIntoViewIfNeeded();
  await dialog.locator(`button[title^="${label}"]`).first().click();
  await page.waitForFunction(l => { const a = window.__rigAnim.animator, i = a.manifest.clips.find(c => c.id === a.state.current); return i && i.label === l && a.state.loading === null; }, label, { timeout: 120000 });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close emotes" }).click();
  await page.waitForTimeout(300);
}
async function record(tag, format, sizeLabel = "480p", quality = "draft") {
  await open();
  await page.getByRole("radio", { name: new RegExp(`^${format}`) }).click();
  const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
  await page.getByLabel("Video size").selectOption({ label: sizes.find(s => s.startsWith(sizeLabel)) });
  await page.getByLabel("Video quality").selectOption(quality);
  const text = await summary();
  const t0 = Date.now();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 1800000 }), page.getByRole("button", { name: "Record video" }).click()]);
  const path = join(outDir, `${tag}-${file.suggestedFilename()}`);
  await file.saveAs(path);
  await page.waitForTimeout(500);
  const status = await panel.locator("[role=status]").last().textContent();
  return { path, name: file.suggestedFilename(), ms: Date.now() - t0, summary: text, status };
}
/** Pause and put the playhead on a frame with the slider's own keys (Home, then arrows), as a keyboard user would. */
async function toFrame(frame) {
  if (!(await state()).paused) await timeline.getByRole("button", { name: "Pause" }).click();
  const slider = timeline.getByRole("slider", { name: /: frame$/ });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < frame; i++) await slider.press("ArrowRight");
  await page.waitForTimeout(200);
}

// ---- 1. Range on the timeline: the button, the markers, I and O at frames, the typed times follow.
await pickEmote(EMOTE);
await page.evaluate(() => { const a = window.__rigAnim.animator; a.setSpeed(1); });
const rangeButton = timeline.getByRole("button", { name: "Video range" });
const pressedBefore = await rangeButton.getAttribute("aria-pressed");
await rangeButton.click();
const marks = await timeline.getByRole("slider", { name: /^Video (start|end)$/ }).count();
await toFrame(12); // 0.4 s
await page.keyboard.press("i");
await toFrame(60); // 2.0 s
await page.keyboard.press("o");
await timeline.screenshot({ path: join(outDir, "1-timeline-range.png") });
await open();
const typed = await fields();
check(1, "Video range turns on and shows two markers", pressedBefore === "false" && marks === 2, `pressed ${pressedBefore} → on · ${marks} markers`);
check(1, "I and O set the range at the frame on screen; the Video tab shows it", typed.start === "0.40" && typed.end === "2.00", JSON.stringify(typed));
await panel.screenshot({ path: join(outDir, "1-video-tab-range.png") });
report.steps[1] = { pressedBefore, marks, typed, summary: await summary() };
save();

// ---- 2. Dragging a marker and typing a time move the same range; Whole goes back to the full emote.
await close();
const end = timeline.getByRole("slider", { name: "Video end" });
const box = await end.boundingBox(), track = await timeline.locator("input[type=range]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(track.x + 5 + 0.7 * (track.width - 10), box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await open();
const dragged = await fields();
await page.getByLabel("Video end (seconds)").fill("2");
await page.getByLabel("Video end (seconds)").press("Enter");
const typedBack = await fields();
await page.getByRole("button", { name: "Whole" }).click();
const whole = { ...(await fields()), pressed: await rangeButton.getAttribute("aria-pressed"), summary: await summary() };
check(2, "dragging the end marker moves the end (snapped to a frame)", Math.abs(Number(dragged.end) - 0.7 * 4.333) < 0.08 && dragged.start === "0.40", JSON.stringify(dragged));
check(2, "a typed end moves it back", typedBack.end === "2.00" && typedBack.start === "0.40", JSON.stringify(typedBack));
check(2, "Whole goes back to the full emote and turns the markers off", whole.start === "0.00" && whole.end === "4.33" && whole.pressed === "false", JSON.stringify(whole));
report.steps[2] = { dragged, typedBack, whole };
save();

// ---- 3. Recordings (PNG sequence, 480p Draft): the whole emote; the range 0.4-2.0 s; the range twice at half speed;
//         and a MOV of the range (the same frames and sound as its PNGs).
const results = {};
await page.getByLabel("Video start (seconds)").fill("0.4"); await page.getByLabel("Video start (seconds)").press("Enter");
await page.getByLabel("Video end (seconds)").fill("2"); await page.getByLabel("Video end (seconds)").press("Enter");
await page.getByRole("button", { name: "Whole" }).click();
await close();
await pickEmote(EMOTE);
results.whole = await record("A-whole", "PNG sequence");
await close();
await pickEmote(EMOTE);
await open();
await page.getByLabel("Video start (seconds)").fill("0.4"); await page.getByLabel("Video start (seconds)").press("Enter");
await page.getByLabel("Video end (seconds)").fill("2"); await page.getByLabel("Video end (seconds)").press("Enter");
results.range = await record("B-range", "PNG sequence");
await close();
await pickEmote(EMOTE);
const speed = page.getByRole("slider", { name: "Emote speed" });
await speed.focus();
for (let i = 0; i < 6 && (await state()).speed > 0.5; i++) await speed.press("ArrowLeft");
const halfSpeed = (await state()).speed;
await open();
await page.getByLabel("Loops").fill("2"); await page.getByLabel("Loops").press("Enter");
results.slowLoops = await record("C-range-x2-half", "PNG sequence");
await page.getByLabel("Loops").fill("1"); await page.getByLabel("Loops").press("Enter");
await page.evaluate(() => window.__rigAnim.animator.setSpeed(1));
await close();
await pickEmote(EMOTE);
results.mov = await record("D-range", "MOV");
const after = await state();
check(3, "the whole emote records 261 frames", /261 frames/.test(results.whole.status ?? ""), results.whole.status);
check(3, "the range 0.40-2.00 s records 97 frames", /97 frames/.test(results.range.status ?? "") && /Clip 0\.40–2\.00 s/.test(results.range.summary ?? ""), `${results.range.summary} · ${results.range.status}`);
check(3, "twice at half speed records 385 frames, and says so", halfSpeed === 0.5 && /385 frames/.test(results.slowLoops.status ?? "") && /2 times, at 0\.5x speed/.test(results.slowLoops.summary ?? ""),
  `speed ${halfSpeed} · ${results.slowLoops.summary} · ${results.slowLoops.status}`);
check(3, "the MOV of the range records 97 frames", /97 frames/.test(results.mov.status ?? "") && /\.mov$/.test(results.mov.name), results.mov.status);
check(3, "the viewer is given back", !after.recording && after.current !== null, JSON.stringify({ current: after.current, recording: after.recording, paused: after.paused }));
report.steps[3] = { ...results, halfSpeed };
save();

// ---- 4. Kept per emote, across a reload: another emote has none; the range comes back with its emote.
await close();
await page.reload();
await gotoApp(page);
await pickEmote(EMOTE);
await open();
const reloaded = { ...(await fields()), pressed: await timeline.getByRole("button", { name: "Video range" }).getAttribute("aria-pressed") };
const other = await page.evaluate(l => window.__rigAnim.animator.manifest.clips.find(c => c.kind === "emote" && !c.loop && c.label !== l && c.duration > 3)?.label, EMOTE);
await pickEmote(other);
await open();
const otherFields = { ...(await fields()), pressed: await timeline.getByRole("button", { name: "Video range" }).getAttribute("aria-pressed") };
await pickEmote(EMOTE);
await open();
const back = await fields();
check(4, "after a reload the emote's range is still set", reloaded.start === "0.40" && reloaded.end === "2.00" && reloaded.pressed === "true", JSON.stringify(reloaded));
check(4, "another emote starts whole; the first keeps its range", otherFields.start === "0.00" && otherFields.pressed === "false" && back.start === "0.40" && back.end === "2.00",
  `${other}: ${JSON.stringify(otherFields)} · back: ${JSON.stringify(back)}`);
report.steps[4] = { reloaded, other, otherFields, back };
save();

// ---- 5. Ordinary use with markers on: the playhead still drags under them; typing I in a field types; Pause, Loop.
await close();
const slider = timeline.getByRole("slider", { name: /: frame$/ });
const sliderBox = await slider.boundingBox();
if (!(await state()).paused) await timeline.getByRole("button", { name: "Pause" }).click();
await page.mouse.click(sliderBox.x + 5 + 0.25 * (sliderBox.width - 10), sliderBox.y + sliderBox.height / 2);
await page.waitForTimeout(400);
const clicked = await state();
await open();
const field = page.getByLabel("Video start (seconds)");
await field.click();
await page.keyboard.press("i");
await page.keyboard.press("Escape");
const afterTyping = await fields();
await close();
await timeline.getByRole("button", { name: "Play" }).click();
const p1 = await state(); await page.waitForTimeout(500); const p2 = await state();
check(5, "a click on the track under the range moves the playhead", Math.abs(clicked.time - 0.25 * clicked.duration) < 0.15, `${clicked.time?.toFixed(3)} of ${clicked.duration?.toFixed(3)}`);
check(5, "I typed into a field does not move the range", afterTyping.start === "0.40", JSON.stringify(afterTyping));
check(5, "Play runs on", !p2.paused && p2.time !== p1.time, `${p1.time?.toFixed(3)} → ${p2.time?.toFixed(3)}`);
report.steps[5] = { clicked, afterTyping, p1, p2 };
save();
await context.close();

// ---- 6. Phone (390x844, touch): the timeline shows Video range and its markers within the screen.
const phone = await openApp("phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
const pp = phone.page;
await pp.locator('button[title="Play an emote"]').click();
const dialog = pp.getByRole("dialog", { name: "Emotes" });
await dialog.locator(`button[title^="${EMOTE}"]`).first().scrollIntoViewIfNeeded();
await dialog.locator(`button[title^="${EMOTE}"]`).first().click();
await pp.waitForFunction(() => window.__rigAnim.animator.state.loading === null && !!window.__rigAnim.animator.timeline(), null, { timeout: 120000 });
if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close emotes" }).click();
const phoneTimeline = pp.getByRole("group", { name: /timeline$/ });
const markBoxes = await phoneTimeline.getByRole("slider", { name: /^Video (start|end)$/ }).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.width, r.height]; }));
await phoneTimeline.screenshot({ path: join(outDir, "6-phone-timeline.png") });
const phoneButton = phoneTimeline.getByRole("button", { name: "Video range" });
await phoneButton.click();
const phoneMarks = await phoneTimeline.getByRole("slider", { name: /^Video (start|end)$/ }).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; }));
await phoneTimeline.screenshot({ path: join(outDir, "6-phone-timeline-range.png") });
check(6, "on a phone Video range shows both markers on screen, with touch-sized tabs", phoneMarks.length === 2 && phoneMarks.every(([l, r, w, h]) => l >= 0 && r <= 390 && w >= 16 && h >= 14),
  JSON.stringify({ before: markBoxes, after: phoneMarks }));
report.steps[6] = { phoneMarks };
await phone.context.close();

save();
console.log("errors:", report.errors.length ? report.errors : "none");
await browser.close();
