// The MOV checklist (functional-checklist.md), run by the agent under the owner's standing waiver of manual checks
// (22 Nov 2026), against a production build served by `vite preview`. It clicks the controls the steps name. Headless
// Chrome on the GPU, navigator.webdriver masked, so sounds load and the idle plays as they do for a person.
//   node _docs/mov-export-2026-11-22/mov-steps.mjs <url> <outDir>      (Git Bash, worktree root, preview running)
//   ONLY=1,2,3,4,5,6 picks steps (2-4 use the emote step 2 picks). Downloads and screenshots go to <outDir>, with
//   report.json; analyse-mov.py reads the files afterwards. Renders of game assets: keep <outDir> out of git.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: mov-steps.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const only = new Set((process.env.ONLY ?? "1,2,3,4,5,6").split(","));
const report = { url, when: new Date().toISOString(), checks: [], steps: {}, errors: [] };
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
  page.on("crash", () => report.errors.push(`${tag}: the page crashed`));
  await gotoApp(page);
  return { context, page, ...helpers(page) };
}

async function gotoApp(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 200; }, null, { timeout: 180000 });
  for (let i = 0; i < 20; i++) {
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
  await page.waitForFunction(() => window.__rigIdle === true && !!window.__rigAnim, null, { timeout: 300000 });
  await page.waitForTimeout(4000);
}

function helpers(page) {
  const panelButton = page.locator('button[aria-label^="Capture"]');
  const panel = page.locator('[role=group][aria-label=Capture]');
  const canvas = page.locator("canvas[data-engine]");
  const h = {
    panelButton, panel, canvas,
    async open() { if (await panelButton.getAttribute("aria-expanded") !== "true") await panelButton.click(); await page.waitForTimeout(300); },
    async close() { if (await panelButton.getAttribute("aria-expanded") === "true") await panelButton.click(); await page.waitForTimeout(300); },
    status: () => panel.locator("[role=status]").last().textContent(),
    async download(trigger, timeout) {
      const [file] = await Promise.all([page.waitForEvent("download", { timeout }), trigger()]);
      const path = join(outDir, file.suggestedFilename());
      await file.saveAs(path);
      return { path, name: file.suggestedFilename() };
    },
    state: () => page.evaluate(() => {
      const a = window.__rigAnim.animator, t = a.timeline();
      return { ...a.state, time: t ? t.time : null, duration: t ? t.duration : null, recording: a.recording };
    }),
    async pickEmote(label) {
      await h.close(); // the open Capture panel covers the emote button
      await page.locator('button[title="Play an emote"]').click();
      const dialog = page.getByRole("dialog", { name: "Emotes" });
      await dialog.waitFor({ timeout: 30000 });
      const tile = dialog.locator(`button[title^="${label}"]`).first();
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await page.waitForFunction(l => {
        const a = window.__rigAnim.animator, info = a.manifest.clips.find(c => c.id === a.state.current);
        return info && info.label === l && a.state.loading === null;
      }, label, { timeout: 120000 });
      if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close emotes" }).click();
      await page.waitForTimeout(300);
    },
    formatRadio: format => page.getByRole("radio", { name: new RegExp(`^${format}`) }),
    async videoSettings(format, sizeLabel, quality) {
      await h.open();
      await page.getByRole("tab", { name: "Video" }).click();
      await h.formatRadio(format).click();
      const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
      const size = sizes.find(s => s.startsWith(sizeLabel)) ?? null;
      if (size) await page.getByLabel("Video size").selectOption({ label: size });
      await page.getByLabel("Video quality").selectOption(quality);
      return { sizes, size };
    },
    /** Record with the settings shown; samples the panel's progress while it runs. */
    async record(timeout = 1800000) {
      const t0 = Date.now(), progress = [];
      const poll = setInterval(async () => {
        const text = await panel.locator("[role=status]").first().textContent().catch(() => null);
        progress.push({ s: +((Date.now() - t0) / 1000).toFixed(1), text });
      }, 1000);
      let file;
      try { file = await h.download(() => page.getByRole("button", { name: "Record video" }).click(), timeout); }
      finally { clearInterval(poll); }
      const ms = Date.now() - t0;
      const after = await h.state();
      await page.waitForTimeout(500);
      await h.open();
      const status = await h.status();
      return { ...file, ms, status, progress: progress.filter((_, i) => i % 2 === 0).slice(0, 10), after };
    },
  };
  return h;
}

const desk = await openApp("desktop");
const { page } = desk;

// ---- 1. The Video tab offers the MOV on a computer, with its description; the guide knows the Video tab.
if (only.has("1")) {
  await desk.open();
  await page.getByRole("tab", { name: "Video" }).click();
  const radio = desk.formatRadio("MOV");
  const text = (await radio.textContent())?.trim() ?? "";
  const enabled = await radio.isEnabled();
  const order = await page.getByRole("radiogroup", { name: "Video format" }).getByRole("radio").evaluateAll(rs => rs.map(r => r.querySelector("span")?.textContent));
  const feature = await page.locator('[data-feature="video"]').getAttribute("role").catch(() => null);
  await desk.panel.screenshot({ path: join(outDir, "1-video-tab.png") });
  report.steps[1] = { text, enabled, order, feature };
  check(1, "MOV, transparent (lossless) is offered and enabled", enabled && /^MOV, transparent \(lossless\)/.test(text), `${order.join(" | ")} · ${text}`);
  check(1, "the Video tab is a guide control", feature === "tab", String(feature));
  await desk.close();
  save();
}

// ---- The emote: the shortest one with sound in the picker (a short test file; none is under 3.5 s, 22 Nov 2026).
let emote = null;
if (["2", "3", "4", "5"].some(s => only.has(s))) {
  const candidates = await page.evaluate(async () => {
    const animator = window.__rigAnim.animator, manifest = await animator.sounds.load();
    return animator.manifest.clips
      .filter(c => c.kind === "emote" && !c.loop && c.duration >= 1 && c.duration <= 6 && animator.sounds.hasSound(c.source))
      .map(c => ({ id: c.id, label: c.label, duration: c.duration, source: c.source, cues: manifest.emotes[c.source] ?? [] }))
      .sort((a, b) => a.duration - b.duration);
  });
  await desk.close();
  await page.locator('button[title="Play an emote"]').click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor({ timeout: 30000 });
  const titles = await dialog.locator("section[aria-label] button").evaluateAll(bs => bs.map(b => b.title));
  await dialog.getByRole("button", { name: "Close emotes" }).click();
  emote = candidates.find(c => titles.some(t => t.startsWith(c.label))) ?? null;
  report.emote = emote;
  console.log("emote:", emote?.id, emote?.label, emote?.duration, "cues at", emote?.cues.map(q => q.start));
  if (!emote) throw new Error("no short emote with sound in the picker");
}

// ---- 2. MOV at 720p Standard with sound; then the PNG sequence of the same frames, for the pixel comparison.
if (only.has("2")) {
  await desk.pickEmote(emote.label);
  const settings = await desk.videoSettings("MOV", "720p", "standard");
  const mov = await desk.record();
  check(2, "MOV downloads", /\.mov$/.test(mov.name), `${mov.name} in ${(mov.ms / 1000).toFixed(1)} s · ${mov.status}`);
  check(2, "progress counts frames and megabytes", mov.progress.some(p => /Frame \d+ of \d+ · \d+ MB/.test(p.text ?? "")),
    mov.progress.map(p => p.text).filter(Boolean).slice(0, 3).join(" | "));
  check(2, "the status says it has sound", /with sound/.test(mov.status ?? ""), mov.status);
  check(2, "the emote is back, not recording", !mov.after.recording && mov.after.current === emote.id, JSON.stringify(mov.after));
  await desk.pickEmote(emote.label);
  const pngSettings = await desk.videoSettings("PNG sequence", "720p", "standard");
  const png = await desk.record();
  check(2, "the PNG sequence of the same emote downloads", /\.zip$/.test(png.name), `${png.name} · ${png.status}`);
  report.steps[2] = { settings, mov, pngSettings, png };
  save();
}

// ---- 3. MOV at 1080p (the size the panel quotes), Draft.
if (only.has("3")) {
  await desk.pickEmote(emote.label);
  const settings = await desk.videoSettings("MOV", "1080p", "draft");
  const mov = await desk.record();
  report.steps[3] = { settings, mov };
  check(3, "1080p MOV downloads", /\.mov$/.test(mov.name), `${mov.name} in ${(mov.ms / 1000).toFixed(1)} s · ${mov.status}`);
  save();
}

// ---- 4. The choice is remembered: reload, the Video tab still has MOV picked; ordinary use carries on.
if (only.has("4")) {
  await desk.close();
  await page.reload();
  await gotoApp(page);
  await desk.open();
  await page.getByRole("tab", { name: "Video" }).click();
  const checked = await desk.formatRadio("MOV").getAttribute("aria-checked");
  check(4, "MOV is still picked after a reload", checked === "true", String(checked));
  await desk.close();
  await desk.pickEmote(emote.label);
  const a = await desk.state(); await page.waitForTimeout(500); const b = await desk.state();
  check(4, "an emote plays after the recordings", !b.paused && !b.recording && b.time > a.time, `${a.time?.toFixed(3)} → ${b.time?.toFixed(3)}`);
  report.steps[4] = { checked, a, b };
  save();
}

// ---- 5. Cancel: start a MOV, Cancel. Nothing saved.
if (only.has("5")) {
  await desk.pickEmote(emote?.label ?? (await page.evaluate(() => window.__rigAnim.animator.manifest.clips.find(c => c.kind === "emote" && !c.loop).label)));
  await desk.videoSettings("MOV", "1080p", "standard");
  let downloads = 0;
  const count = () => downloads++;
  page.on("download", count);
  await page.getByRole("button", { name: "Record video" }).click();
  await page.waitForFunction(() => window.__rigAnim.animator.recording, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator('[role=group][aria-label=Capture] [role=status]', { hasText: /Cancelled/ }).waitFor({ timeout: 30000 });
  const status = await desk.status();
  await page.waitForTimeout(2000);
  page.off("download", count);
  const after = await desk.state();
  report.steps[5] = { status, downloads, after };
  check(5, "Cancel says so and saves nothing", /Cancelled\. Nothing was saved\./.test(status ?? "") && downloads === 0 && !after.recording, `${status} · downloads ${downloads}`);
  await desk.close();
  save();
}
await desk.context.close();

// ---- 6. Phone (emulated: 390x844, touch, DPR 3): MOV is shown but not offered, and says why; PNG is.
if (only.has("6")) {
  const phone = await openApp("phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
  await phone.open();
  await phone.page.getByRole("tab", { name: "Video" }).click();
  await phone.page.waitForTimeout(800);
  const mov = phone.formatRadio("MOV");
  const enabled = await mov.isEnabled(), text = (await mov.textContent())?.trim() ?? "";
  const pngEnabled = await phone.formatRadio("PNG sequence").isEnabled();
  await phone.page.screenshot({ path: join(outDir, "6-phone-video-tab.png") });
  report.steps[6] = { enabled, text, pngEnabled };
  check(6, "a phone shows MOV disabled, with the reason", !enabled && /On a computer only/.test(text), text);
  check(6, "the PNG sequence stays available on a phone", pngEnabled, String(pngEnabled));
  await phone.context.close();
  save();
}

save();
console.log("errors:", report.errors.length ? report.errors : "none");
await browser.close();
