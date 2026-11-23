// The takes checklist (functional-checklist.md), run by the agent under the owner's standing waiver of manual checks
// (22 Nov 2026), against a production build served by `vite preview`. It uses the controls the steps name: Capture,
// Video, Take, Record a take, the Stop button, the camera (mouse drags on the canvas), the emote picker, the timeline,
// the Lighting panel's looks, Render and Discard. Headless Chrome on the GPU, navigator.webdriver masked so sounds load.
//   node _docs/video-takes-2026-11-22/takes-steps.mjs <url> <outDir>      (Git Bash, worktree root, preview running)
// Downloads, screenshots and the takes' stored samples go to <outDir> with report.json; analyse-takes.py reads them.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: takes-steps.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const EMOTE = process.env.EMOTE ?? "Applause Pause";
const report = { url, emote: EMOTE, when: new Date().toISOString(), checks: [], steps: {}, errors: [] };
const check = (step, name, pass, detail = "") => {
  report.checks.push({ step, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}. ${name}${detail ? ` · ${detail}` : ""}`);
};
const save = () => writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const progress = what => console.log(`[${new Date().toISOString().slice(11, 19)}] ${what}`);
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

const desktop = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await desktop.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const watch = (page, tag) => {
  page.on("pageerror", e => report.errors.push(`${tag} pageerror: ${String(e).slice(0, 300)}`));
  page.on("console", m => { if (m.type() === "error") report.errors.push(`${tag} console: ${m.text().slice(0, 300)}`); });
};
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

let page = await desktop.newPage();
watch(page, "desktop");
await gotoApp(page);

const ui = p => ({
  button: p.locator('button[aria-label^="Capture"]'),
  panel: p.locator('[role=group][aria-label=Capture]'),
  stop: p.getByRole("button", { name: "Stop recording the take" }),
});
let u = ui(page);
const openTakes = async () => {
  if (await u.button.getAttribute("aria-expanded") !== "true") await u.button.click();
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("radio", { name: "Take" }).click();
  await page.waitForTimeout(300);
};
const closePanel = async () => { if (await u.button.getAttribute("aria-expanded") === "true") await u.button.click(); await page.waitForTimeout(300); };
const takeRows = async () => (await u.panel.getByRole("list", { name: "Takes" }).locator("li").allTextContents().catch(() => [])).map(t => t.replace(/\s+/g, " ").trim());
const animState = () => page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline(); return { current: a.state.current, paused: a.state.paused, time: t?.time ?? null, recording: a.recording }; });
async function pickEmote(label) {
  await closePanel();
  await page.locator('button[title="Play an emote"]').click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor({ timeout: 30000 });
  await dialog.locator(`button[title^="${label}"]`).first().scrollIntoViewIfNeeded();
  await dialog.locator(`button[title^="${label}"]`).first().click();
  await page.waitForFunction(l => { const a = window.__rigAnim.animator, i = a.manifest.clips.find(c => c.id === a.state.current); return i && i.label === l && a.state.loading === null; }, label, { timeout: 120000 });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close emotes" }).click();
  await page.waitForTimeout(200);
}
/** Drag on the canvas: orbit the camera, `dx` pixels across, over `ms`, in `steps` moves (one every 25 ms by default). */
async function orbit(dx, ms, steps = Math.max(2, Math.round(ms / 25))) {
  const box = await page.locator("canvas[data-engine]").boundingBox();
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x + dx * i / steps, y); await page.waitForTimeout(ms / steps); }
  await page.mouse.up();
}
/** Every stored take: its record and its chunks (samples as plain numbers), read straight from IndexedDB. */
const storedTakes = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("finals-take");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, tx = db.transaction(["takes", "chunks"], "readonly");
    const takes = tx.objectStore("takes").getAll(), chunks = tx.objectStore("chunks").getAll();
    tx.oncomplete = () => resolve({ takes: takes.result, chunks: chunks.result.map(c => ({ ...c, samples: Array.from(c.samples) })) });
  };
}));
async function render(name, format, tag) {
  await openTakes();
  await page.getByRole("radio", { name: new RegExp(`^${format}`) }).click();
  const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
  await page.getByLabel("Video size").selectOption({ label: sizes.find(s => s.startsWith("480p")) });
  await page.getByLabel("Video quality").selectOption("draft");
  const t0 = Date.now();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 1800000 }), page.getByRole("button", { name: `Render ${name}`, exact: true }).click()]);
  const path = join(outDir, `${tag}-${file.suggestedFilename()}`);
  await file.saveAs(path);
  await page.waitForTimeout(800);
  const status = await u.panel.locator("[role=status]").last().textContent();
  return { path, name: file.suggestedFilename(), ms: Date.now() - t0, status };
}

progress('step 1');
// ---- 1. Record a take: the panel steps aside; REC, the time and Stop on the button row; orbit, an emote with sound,
//         a timeline drag, a lighting change; Stop shows the take in the list.
await page.evaluate(() => window.__rigAnim.animator.setSpeed(1));
await openTakes();
await u.panel.screenshot({ path: join(outDir, "1-take-tab.png") });
const before = await animState();
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(700);
const closedOnStart = await u.panel.isVisible() === false;
const recLabel = await u.button.getAttribute("aria-label");
const stopShown = await u.stop.isVisible();
await page.locator("div[data-viewer]").screenshot({ path: join(outDir, "1-recording-viewer.png") });
await orbit(260, 1200);
const lookTimes = {};
await pickEmote(EMOTE);
lookTimes.emote = await page.evaluate(() => performance.now());
await page.waitForTimeout(1500); // the clap at 0.53 s sounds
const timeline = page.getByRole("group", { name: /timeline$/ });
await timeline.getByRole("button", { name: "Pause" }).click();
const slider = timeline.getByRole("slider", { name: /: frame$/ });
await slider.focus();
for (let i = 0; i < 20; i++) { await slider.press("ArrowRight"); await page.waitForTimeout(40); }
await timeline.getByRole("button", { name: "Play" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Lighting and backdrop:/ }).click();
await page.getByRole("button", { name: "Lobby", exact: true }).click();
await page.getByRole("button", { name: /^Lighting and backdrop:/ }).click();
await orbit(-180, 900);
await page.waitForTimeout(1200);
const recText = await u.button.textContent();
await u.stop.click();
await page.waitForTimeout(1200);
const rows1 = await takeRows();
const panelOpenAfter = await u.panel.isVisible();
await u.panel.screenshot({ path: join(outDir, "1-after-stop.png") });
check(1, "recording starts with the panel closed, REC and the time on the Capture button, Stop beside it",
  closedOnStart && /recording a take/.test(recLabel ?? "") && stopShown && /REC/.test(recText ?? ""), `closed ${closedOnStart} · "${recLabel}" · stop ${stopShown} · "${recText?.trim()}"`);
check(1, "Stop opens the panel on the new take", panelOpenAfter && rows1.length === 1 && /^Take 1\s*0:(0[89]|[1-2]\d)/.test(rows1[0]), JSON.stringify(rows1));
let stored = await storedTakes();
writeFileSync(join(outDir, "takes-after-1.json"), JSON.stringify(stored));
const take1 = stored.takes.find(t => t.name === "Take 1");
check(1, "the take is saved in this browser as it records, done when stopped", take1?.status === "done" && take1.chunks >= 8
  && stored.chunks.filter(c => c.take === take1.id).length === take1.chunks, `${take1?.status}, ${take1?.chunks} chunks, ${take1?.duration?.toFixed(2)} s, clips ${take1?.clips}`);
report.steps[1] = { closedOnStart, recLabel, stopShown, recText, rows1, take: take1 };
save();

progress('step 2');
// ---- 2. Render it: PNG frames with WAV, then MOV (analysed: frame count, the same frames twice, the camera moved, the
//         lights changed, the clap where the samples put it). The take stays, marked rendered.
const png = await render("Take 1", "PNG", "2-png");
const mov = await render("Take 1", "MOV", "2-mov");
const rows2 = await takeRows();
const after = await animState();
const lightingButton = await page.getByRole("button", { name: /^Lighting and backdrop:/ }).textContent();
check(2, "both renders save a file and say so", /Saved .*\.zip: 474 × 480, \d+ frames, sound as WAV/.test(png.status ?? "") && /Saved .*\.mov: .*with sound/.test(mov.status ?? ""),
  `${png.status} | ${mov.status} | ${Math.round(png.ms / 1000)} s and ${Math.round(mov.ms / 1000)} s`);
check(2, "rendering keeps the take, marked rendered", rows2.length === 1 && /rendered/.test(rows2[0]), JSON.stringify(rows2));
// The take's own lights (Studio, then Lobby) were drawn while it rendered; the viewer's own look (Lobby, set during the
// take) is what the Lighting button names afterwards, and the clock is the viewer's again.
check(2, "the viewer is given back: its clip, its own look, no recording", !after.recording && after.current !== null && /Lobby/.test(lightingButton ?? ""),
  `${JSON.stringify(after)} · lighting "${lightingButton}"`);
report.steps[2] = { png, mov, rows2, after, lightingButton };
save();

progress('step 3');
// ---- 3. A slow machine: record with the CPU slowed twenty times while orbiting; the render has a new frame every 1/60 s.
const cdp = await desktop.newCDPSession(page);
await closePanel();
await openTakes();
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(400);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
await orbit(400, 3000, 30);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await u.stop.click();
await page.waitForTimeout(1000);
stored = await storedTakes();
writeFileSync(join(outDir, "takes-after-3.json"), JSON.stringify(stored));
const take2 = stored.takes.find(t => t.name === "Take 2");
const slow = await render("Take 2", "PNG", "3-slow");
check(3, "a take recorded on a slowed machine renders", /Saved .*\.zip/.test(slow.status ?? ""), `${slow.status} · ${take2?.duration?.toFixed(2)} s recorded`);
report.steps[3] = { slow, take: take2 };
save();

progress('step 4');
// ---- 4. Saved as it records: the tab crashes about 3 s into a take; the next visit lists it as interrupted and renders
// it. The renderer dies some time after Page.crash is sent (it never answers the command), so the check bounds the loss
// from below: everything recorded before the command, less at most one chunk (a second), must have been saved.
await closePanel();
await openTakes();
const recordedFrom = Date.now();
await page.getByRole("button", { name: "Record a take" }).click();
await orbit(200, 2500);
await page.waitForTimeout(300);
const beforeCrash = (Date.now() - recordedFrom) / 1000;
const crashed = await Promise.race([cdp.send("Page.crash").then(() => true, () => true), new Promise(resolve => setTimeout(() => resolve(true), 3000))]);
await new Promise(resolve => setTimeout(resolve, 1500));
progress("4: crashed; reopening");
page = await desktop.newPage();
watch(page, "desktop-2");
u = ui(page);
await gotoApp(page);
await page.waitForTimeout(3000); // past STALE_MS since its last save
await openTakes();
const rows4 = await takeRows();
stored = await storedTakes();
writeFileSync(join(outDir, "takes-after-4.json"), JSON.stringify(stored));
const take3 = stored.takes.find(t => t.name === "Take 3");
const crashedRow = rows4.find(r => r.startsWith("Take 3"));
check(4, "a crashed tab's take is kept: interrupted, saved so far, losing at most its last second", crashed
  && /interrupted, saved so far/.test(crashedRow ?? "") && take3 && take3.duration >= beforeCrash - 1.25 && take3.duration <= beforeCrash + 4.5,
  `${crashedRow} · ${take3?.duration?.toFixed(2)} s saved in ${take3?.chunks} chunks; ${beforeCrash.toFixed(2)} s recorded when the crash was sent`);
const crashRender = await render("Take 3", "PNG", "4-interrupted");
check(4, "an interrupted take renders", /Saved .*\.zip/.test(crashRender.status ?? ""), crashRender.status);
await u.panel.screenshot({ path: join(outDir, "4-after-reload.png") });
report.steps[4] = { rows4, take: take3, crashRender };
save();

progress('step 5');
// ---- 5. Discard asks first; Keep keeps it; Discard deletes it, for good (a reload agrees). Rendering never deleted one.
const discardButton = u.panel.getByRole("button", { name: "Discard Take 2", exact: true });
await discardButton.click();
const confirmShown = await u.panel.getByRole("button", { name: "Discard", exact: true }).isVisible();
await u.panel.getByRole("button", { name: "Keep", exact: true }).click();
const keptRows = await takeRows();
await discardButton.click();
await u.panel.getByRole("button", { name: "Discard", exact: true }).click();
await page.waitForTimeout(600);
const discardedRows = await takeRows();
await page.reload({ waitUntil: "domcontentloaded" });
await gotoApp(page);
await openTakes();
const reloadRows = await takeRows();
stored = await storedTakes();
check(5, "Discard asks first, and Keep keeps the take", confirmShown && keptRows.some(r => r.startsWith("Take 2")), JSON.stringify(keptRows));
check(5, "Discard deletes the take and its samples, still gone after a reload; the others stay",
  !discardedRows.some(r => r.startsWith("Take 2")) && !reloadRows.some(r => r.startsWith("Take 2")) && reloadRows.length === 2
  && !stored.chunks.some(c => c.take === take2?.id), JSON.stringify(reloadRows));
report.steps[5] = { confirmShown, keptRows, discardedRows, reloadRows };
save();

progress('step 6');
// ---- 6. A tab hidden while recording stops the take there, saved.
await closePanel();
await openTakes();
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(800);
await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(500);
const hiddenNotice = await u.panel.locator("[role=status]").first().textContent().catch(() => "");
stored = await storedTakes();
const take4 = stored.takes.find(t => t.name === "Take 4");
check(6, "a hidden tab stops the take, saved, and says so", !(await u.stop.isVisible()) && /tab was hidden/.test(hiddenNotice ?? "") && take4?.status === "done",
  `${hiddenNotice} · ${take4?.status} ${take4?.duration?.toFixed(2)} s`);
report.steps[6] = { hiddenNotice, take: take4 };
save();

progress('step 7');
// ---- 7. The cap: ten takes waiting to be rendered refuse an eleventh (nothing evicted); once one is rendered, the next
//         take makes room by removing the oldest rendered one, and says so.
const count = async () => (await storedTakes()).takes.length;
while (await count() < 10) {
  await page.getByRole("button", { name: "Record a take" }).click();
  await page.waitForTimeout(500);
  await u.stop.click();
  await page.waitForTimeout(500);
  await openTakes();
}
// Takes 1 and 3 are rendered: make every take unrendered for the refusal (as if none were), straight in storage.
await page.evaluate(() => new Promise(resolve => {
  const open = indexedDB.open("finals-take");
  open.onsuccess = () => {
    const tx = open.result.transaction("takes", "readwrite"), store = tx.objectStore("takes"), all = store.getAll();
    all.onsuccess = () => { for (const t of all.result) store.put({ ...t, renderedAt: null }); };
    tx.oncomplete = () => resolve(null);
  };
}));
await page.reload({ waitUntil: "domcontentloaded" });
await gotoApp(page);
await openTakes();
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(800);
const refusedNotice = await u.panel.locator("[role=status]").first().textContent().catch(() => "");
const refusedCount = await count();
const oldest = (await storedTakes()).takes.sort((a, b) => a.createdAt - b.createdAt)[0];
await render(oldest.name, "PNG", "7-make-room");
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(800);
await u.stop.click();
await page.waitForTimeout(800);
await openTakes();
const roomNotice = await u.panel.locator("[role=status]").first().textContent().catch(() => "");
const capNames = (await storedTakes()).takes.map(t => t.name);
check(7, "ten unrendered takes refuse an eleventh, keeping all ten", /10 takes are waiting to be rendered/.test(refusedNotice ?? "") && refusedCount === 10 && !(await u.stop.isVisible()),
  `${refusedNotice} · ${refusedCount}`);
check(7, "a rendered take makes room for the next, which says so", new RegExp(`Made room: ${oldest.name}`).test(roomNotice ?? "") && capNames.length === 10 && !capNames.includes(oldest.name),
  `${roomNotice} · ${capNames.join(", ")}`);
report.steps[7] = { refusedNotice, refusedCount, roomNotice, capNames };
save();

progress('step 8');
// ---- 8. Ordinary use: the Emote choice is the emote export as before.
await page.getByRole("radio", { name: "Emote" }).click();
const emoteSide = { record: await page.getByRole("button", { name: "Record video" }).isVisible(), loops: await page.getByLabel("Loops").isVisible() };
check(8, "Emote shows the emote export as before", emoteSide.record && emoteSide.loops, JSON.stringify(emoteSide));
report.steps[8] = emoteSide;
await desktop.close();

progress('step 9');
// ---- 9. Phone (390x844, touch): Take records with a touch drag; Stop sits on the button row.
const phone = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
await phone.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
page = await phone.newPage();
watch(page, "phone");
u = ui(page);
await gotoApp(page);
await openTakes();
await page.getByRole("button", { name: "Record a take" }).click();
await page.waitForTimeout(1500);
const phoneStop = await u.stop.isVisible();
const phoneStopText = (await u.stop.innerText())?.trim(); // what shows: the hidden "Stop" word is in textContent
// The whole top row stays on screen while recording (23 Nov: REC and Stop both pushed Full screen, Hide UI and half of
// Graphics off the left edge at 390 px; Stop now carries the time on a narrow view and the trigger steps aside).
const offRow = await page.evaluate(() => {
  let row = document.querySelector('button[aria-label^="Capture"]').parentElement;
  while (row && !row.querySelector('[aria-label="Hide UI"]')) row = row.parentElement;
  const view = document.querySelector("div[data-viewer]").getBoundingClientRect();
  return [...row.querySelectorAll("button")].filter(b => b.offsetParent && !b.closest("[role=group]"))
    .filter(b => { const r = b.getBoundingClientRect(); return r.left < view.left || r.right > view.right; })
    .map(b => b.getAttribute("aria-label") ?? b.textContent.trim());
});
await page.screenshot({ path: join(outDir, "9-phone-recording.png") });
await u.stop.click();
await page.waitForTimeout(1000);
const phoneRows = await takeRows();
await page.screenshot({ path: join(outDir, "9-phone-takes.png") });
check(9, "on a phone a take records: Stop shows the time, the whole button row stays on screen, the take is listed",
  phoneStop && /^\d:\d\d$/.test(phoneStopText ?? "") && offRow.length === 0 && phoneRows.length === 1,
  `stop ${phoneStop} "${phoneStopText}" · off screen: ${offRow.length ? offRow.join(", ") : "none"} · ${JSON.stringify(phoneRows)}`);
report.steps[9] = { phoneStop, phoneStopText, offRow, phoneRows };
await phone.close();

save();
await browser.close();
console.log(`errors: ${report.errors.length ? report.errors.join("\n") : "none"}`);
