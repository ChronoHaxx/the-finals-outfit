// The functional checklist's 7 steps (functional-checklist.md), run by the agent on the owner's go-ahead ("do the checks
// for me, if pass, merge it", 22 Nov 2026) against the merge of main. It clicks the controls the steps name. Headless
// Chrome on the GPU, navigator.webdriver masked, so sounds load and the idle plays as they do for a person.
//   node _docs/capture-2026-11-21/user-steps.mjs <url> <outDir>      (Git Bash, worktree root, dev.sh running)
//   ONLY=1,2,3,4,5,6,7 picks steps (3-6 use the emote step 2 picks). Downloads and screenshots go to <outDir>, with
//   report.json; analyse-steps.py reads the files afterwards. Renders of game assets: keep <outDir> out of git.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: user-steps.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const only = new Set((process.env.ONLY ?? "1,2,3,4,5,6,7").split(","));
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
  await page.waitForFunction(() => window.__rigIdle === true && !!window.__captureContext && !!window.__rigAnim, null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  return { context, page, ...helpers(page) };
}

function helpers(page) {
  const panelButton = page.locator('button[aria-label^="Capture"]');
  const panel = page.locator('[role=group][aria-label=Capture]');
  const canvas = page.locator("canvas[data-engine]");
  const h = {
    panelButton, canvas,
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
      return { ...a.state, time: t ? t.time : null, duration: t ? t.duration : null, recording: a.recording,
        emoteScale: a.emoteAction ? a.emoteAction.getEffectiveTimeScale() : null };
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
    async videoSettings(format, sizeLabel, quality) {
      await h.open();
      await page.getByRole("tab", { name: "Video" }).click();
      await page.getByRole("radio", { name: new RegExp(`^${format}`) }).click();
      const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
      const size = sizes.find(s => s.startsWith(sizeLabel)) ?? null;
      if (size) await page.getByLabel("Video size").selectOption({ label: size });
      await page.getByLabel("Video quality").selectOption(quality);
      return { sizes, size };
    },
    /** Record with the settings shown; samples the panel button's label and two live-view grabs while it runs. */
    async record(tag, timeout = 1800000) {
      const t0 = Date.now(), progress = [];
      const poll = setInterval(async () => {
        const label = await panelButton.getAttribute("aria-label").catch(() => null);
        const text = await panel.locator("[role=status]").first().textContent().catch(() => null);
        progress.push({ s: +((Date.now() - t0) / 1000).toFixed(1), label, text });
      }, 1000);
      const grabs = (async () => {
        await page.waitForTimeout(5000);
        const a = await canvas.screenshot({ path: join(outDir, `${tag}-live-a.png`) });
        await page.waitForTimeout(1500);
        const b = await canvas.screenshot({ path: join(outDir, `${tag}-live-b.png`) });
        return !a.equals(b);
      })().catch(() => null);
      let file;
      try { file = await h.download(() => page.getByRole("button", { name: "Record video" }).click(), timeout); }
      finally { clearInterval(poll); }
      const ms = Date.now() - t0;
      const after = await h.state();
      await page.waitForTimeout(500);
      await h.open();
      const status = await h.status();
      return { ...file, ms, status, liveMoved: await grabs, progress: progress.filter((_, i) => i % 3 === 0).slice(0, 12), after };
    },
  };
  return h;
}

const desk = await openApp("desktop");
const { page } = desk;
report.renderer = await page.evaluate(() => {
  const gl = window.__captureContext.gl.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log("renderer:", report.renderer);

// ---- 1. Screenshot: Save PNG (1x for a same-size comparison with a screen grab, and the default 2x), Transparent, Copy.
if (only.has("1")) {
  await page.evaluate(() => window.__rigAnim.animator.setPaused(true)); // one pose for the grab and the PNGs
  await page.waitForTimeout(2500); // the live view's still path settles too, as on a person's screen
  await desk.canvas.screenshot({ path: join(outDir, "1-screen-grab.png") }); // what a snipping tool sees (DPR 1)
  await desk.open();
  await page.getByRole("tab", { name: "Image" }).click();
  await page.getByRole("radio", { name: "Backdrop" }).click();
  const sizes = await page.getByLabel("Screenshot size").locator("option").allTextContents();
  const shots = {};
  for (const scale of ["1", "2"]) {
    await page.getByLabel("Screenshot size").selectOption(scale);
    const t0 = Date.now();
    const file = await desk.download(() => page.getByRole("button", { name: "Save PNG" }).click(), 180000);
    shots[scale] = { ...file, ms: Date.now() - t0, status: await desk.status() };
  }
  await page.getByRole("radio", { name: "Transparent" }).click();
  const transparent = await desk.download(() => page.getByRole("button", { name: "Save PNG" }).click(), 180000);
  await page.getByRole("radio", { name: "Backdrop" }).click();
  await desk.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(url).origin });
  await page.getByRole("button", { name: "Copy" }).click();
  await page.locator('[role=group][aria-label=Capture] [role=status]', { hasText: /Copied|Couldn/ }).waitFor({ timeout: 180000 });
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]?.getType("image/png");
    return blob ? blob.size : 0;
  });
  const copyStatus = await desk.status();
  report.steps[1] = { sizes, shots, transparent, copied, copyStatus };
  check(1, "Save PNG at 1x and 2x", /Saved \d+ × \d+/.test(shots["1"].status) && /Saved \d+ × \d+/.test(shots["2"].status),
    `${shots["1"].status} (${shots["1"].ms} ms) · ${shots["2"].status} (${shots["2"].ms} ms)`);
  check(1, "Transparent PNG downloads", /transparent\.png$/.test(transparent.name), transparent.name);
  check(1, "Copy puts a PNG on the clipboard", copied > 1000 && /Copied/.test(copyStatus ?? ""), `${copied} bytes · ${copyStatus}`);
  await page.evaluate(() => window.__rigAnim.animator.setPaused(false));
  await desk.close();
  save();
}

// ---- The emote: one with sound in the picker, 3-6 s, preferring several one-shot cues (claps, hits) to check sync on.
let emote = null;
if (["2", "3", "4", "5", "6"].some(s => only.has(s))) {
  const candidates = await page.evaluate(async () => {
    const animator = window.__rigAnim.animator, manifest = await animator.sounds.load();
    return animator.manifest.clips
      .filter(c => c.kind === "emote" && !c.loop && c.duration >= 3 && c.duration <= 6 && animator.sounds.hasSound(c.source))
      .map(c => ({ id: c.id, label: c.label, duration: c.duration, source: c.source, cues: manifest.emotes[c.source] ?? [] }))
      .sort((a, b) => b.cues.filter(q => q.kind !== "window").length - a.cues.filter(q => q.kind !== "window").length);
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
  if (!emote) throw new Error("no emote with sound in the picker");
}

// ---- 2. MP4 with sound, 1080p Standard, from the emote picker.
if (only.has("2")) {
  await desk.pickEmote(emote.label);
  const settings = await desk.videoSettings("MP4", "1080p", "standard");
  const result = await desk.record("2-mp4");
  report.steps[2] = { settings, ...result };
  check(2, "MP4 downloads", /\.mp4$/.test(result.name), `${result.name} in ${(result.ms / 1000).toFixed(1)} s · ${result.status}`);
  check(2, "progress counts frames", result.progress.some(p => /Frame \d+ of \d+/.test(p.text ?? "")),
    result.progress.map(p => p.text).filter(Boolean).slice(0, 3).join(" | "));
  check(2, "the live view shows the frames going by", result.liveMoved === true, String(result.liveMoved));
  save();
}

// ---- 3. Transparent WebM, same emote; also decoded by Chrome's own <video> (the "drag it into a Chrome tab" check).
if (only.has("3")) {
  await desk.pickEmote(emote.label);
  const settings = await desk.videoSettings("WebM", "1080p", "standard");
  const result = await desk.record("3-webm");
  const bytes = (await import("node:fs")).readFileSync(result.path).toString("base64");
  const played = await page.evaluate(async b64 => {
    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "video/webm" });
    const video = document.createElement("video");
    video.muted = true; video.src = URL.createObjectURL(blob);
    await new Promise((ok, no) => { video.onloadeddata = ok; video.onerror = () => no(new Error("video error")); });
    video.currentTime = video.duration / 2;
    await new Promise(ok => { video.onseeked = ok; });
    const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight;
    const g = c.getContext("2d"); g.drawImage(video, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let clear = 0, solid = 0, faint = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) clear++; else if (data[i] === 255) solid++; else if (data[i] < 8) faint++; }
    return { width: c.width, height: c.height, duration: video.duration, corner: data[3], clear, faint, solid, pixels: data.length / 4 };
  }, bytes);
  report.steps[3] = { settings, ...result, chrome: played };
  check(3, "WebM downloads", /\.webm$/.test(result.name), `${result.name} in ${(result.ms / 1000).toFixed(1)} s · ${result.status}`);
  // VP9's alpha is lossy: a stray 1/255 (invisible) at a block edge is codec noise, not a backdrop.
  check(3, "Chrome's <video> shows it see-through", played.corner <= 2 && played.clear > played.pixels * 0.3 && played.solid > 1000,
    JSON.stringify(played));
  save();
}

// ---- 4. PNG sequence, 720p.
if (only.has("4")) {
  await desk.pickEmote(emote.label);
  const settings = await desk.videoSettings("PNG sequence", "720p", "standard");
  const result = await desk.record("4-png");
  report.steps[4] = { settings, ...result };
  check(4, "zip downloads", /\.zip$/.test(result.name), `${result.name} in ${(result.ms / 1000).toFixed(1)} s · ${result.status}`);
  save();
}

// ---- 5. Cancel and close: start a recording, close the panel, reopen, Cancel. Nothing saved; the emote carries on.
if (only.has("5")) {
  await desk.pickEmote(emote.label);
  await desk.videoSettings("MP4", "1080p", "standard");
  let downloads = 0;
  const count = () => downloads++;
  page.on("download", count);
  await page.getByRole("button", { name: "Record video" }).click();
  await page.waitForFunction(() => window.__rigAnim.animator.recording, null, { timeout: 60000 });
  const saved = await page.evaluate(() => window.__rigAnim.animator.recorder?.time ?? null); // where the emote was
  await page.waitForFunction(() => /recording video, ([1-9]\d*)%/.test(document.querySelector('button[aria-label^="Capture"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 120000 });
  await desk.close();
  await page.waitForTimeout(1500);
  const closedLabel = await desk.panelButton.getAttribute("aria-label");
  const box = await desk.panelButton.boundingBox();
  await page.screenshot({ path: join(outDir, "5-button-while-closed.png"), clip: { x: box.x - 40, y: box.y - 8, width: box.width + 80, height: box.height + 16 } });
  const stillRecording = await page.evaluate(() => window.__rigAnim.animator.recording);
  await desk.open();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator('[role=group][aria-label=Capture] [role=status]', { hasText: /Cancelled/ }).waitFor({ timeout: 30000 });
  const status = await desk.status();
  const a = await desk.state();
  await page.waitForTimeout(600);
  const b = await desk.state();
  await page.waitForTimeout(2000);
  page.off("download", count);
  report.steps[5] = { saved, closedLabel, stillRecording, status, a, b, downloads };
  check(5, "closing the panel keeps recording; the button shows the %", stillRecording && /recording video, \d+%/.test(closedLabel ?? ""), closedLabel);
  check(5, "Cancel says so and saves nothing", /Cancelled\. Nothing was saved\./.test(status ?? "") && downloads === 0, `${status} · downloads ${downloads}`);
  check(5, "the emote carries on from where it was", !a.recording && a.current === emote.id && !a.paused && saved !== null
    && Math.abs(a.time - saved) < 0.5 && b.time > a.time, `saved ${saved?.toFixed(3)} · after ${a.time?.toFixed(3)} → ${b.time?.toFixed(3)} · ${a.current}`);
  await desk.close();
  save();
}

// ---- 6. Afterwards, ordinary use: pause, scrub, step, play, speed (and a recording at 2x), another emote, orbit.
if (only.has("6")) {
  const results = {};
  await desk.pickEmote(emote.label);
  await page.waitForTimeout(1200); // far enough in to scrub 20 frames back
  const timeline = page.getByRole("group", { name: /timeline$/ });
  await timeline.getByRole("button", { name: "Pause" }).click();
  const p1 = await desk.state(); await page.waitForTimeout(500); const p2 = await desk.state();
  results.pause = { p1: p1.time, p2: p2.time, paused: p2.paused };
  check(6, "Pause holds the frame", p2.paused && p1.time === p2.time, `${p1.time?.toFixed(3)} = ${p2.time?.toFixed(3)}`);
  const slider = timeline.getByRole("slider", { name: /: frame$/ });
  await slider.focus();
  for (let i = 0; i < 20; i++) await slider.press("ArrowLeft");
  await page.waitForTimeout(300);
  const s1 = await desk.state();
  await timeline.getByRole("button", { name: "Next frame" }).click();
  await page.waitForTimeout(300);
  const s2 = await desk.state();
  results.scrub = { before: p2.time, scrubbed: s1.time, stepped: s2.time };
  check(6, "scrub and step move the frame", s1.time < p2.time - 0.2 && Math.abs(s2.time - s1.time - 1 / 30) < 0.02,
    `${p2.time?.toFixed(3)} → ${s1.time?.toFixed(3)} → ${s2.time?.toFixed(3)}`);
  await timeline.getByRole("button", { name: "Play" }).click();
  const g1 = await desk.state(); await page.waitForTimeout(500); const g2 = await desk.state();
  check(6, "Play runs it again", !g2.paused && g2.time > g1.time, `${g1.time?.toFixed(3)} → ${g2.time?.toFixed(3)}`);
  // Speed 2x (the speed control from main, #58), then a recording: it records at normal speed and leaves 2x set.
  const speed = page.getByRole("slider", { name: "Emote speed" });
  await speed.focus();
  for (let i = 0; i < 8 && (await desk.state()).speed < 2; i++) await speed.press("ArrowRight");
  await desk.pickEmote(emote.label);
  const v1 = await desk.state(); await page.waitForTimeout(800); const v2 = await desk.state();
  results.speed = { speed: v2.speed, scale: v2.emoteScale, advanced: v2.time - v1.time };
  check(6, "speed 2x plays twice as fast", v2.speed === 2 && v2.emoteScale === 2 && (v2.time - v1.time) > 1.2,
    `${v2.speed}x · scale ${v2.emoteScale} · ${(v2.time - v1.time).toFixed(2)} s of clip in 0.8 s`);
  // Paused early, so the same emote is still in front afterwards: the recording must hand its 2x back to that action.
  await desk.pickEmote(emote.label);
  await page.waitForTimeout(300);
  await timeline.getByRole("button", { name: "Pause" }).click();
  await desk.videoSettings("MP4", "480p", "draft");
  const fast = await desk.record("6-mp4-at-2x");
  await desk.close();
  await timeline.getByRole("button", { name: "Play" }).click();
  const r1 = await desk.state(); await page.waitForTimeout(500); const r2 = await desk.state();
  results.recordAt2x = { ...fast, resumed: { from: r1.time, to: r2.time, scale: r2.emoteScale } };
  check(6, "after a recording at 2x the same emote is still at 2x", fast.after.speed === 2 && fast.after.emoteScale === 2 && fast.after.paused
    && fast.after.current === emote.id && r2.emoteScale === 2 && r2.time - r1.time > 0.75,
    `${fast.name} · ${fast.status} · after: ${fast.after.speed}x, scale ${fast.after.emoteScale}, paused ${fast.after.paused} · played ${(r2.time - r1.time).toFixed(2)} s of clip in 0.5 s`);
  await page.evaluate(() => window.__rigAnim.animator.setSpeed(1)); // teardown (the 1x button hides with the emote)
  // Another emote, then orbit the camera and check the picture moves.
  const other = await page.evaluate(id => {
    const a = window.__rigAnim.animator;
    return a.manifest.clips.find(c => c.kind === "emote" && c.id !== id && c.duration > 4 && !c.loop)?.label ?? null;
  }, emote.id);
  await desk.pickEmote(other);
  const o = await desk.state();
  const cam = () => page.evaluate(() => window.__captureContext.camera.position.toArray().map(v => +v.toFixed(3)));
  const before = await cam();
  const box = await desk.canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await cam();
  const f1 = await desk.canvas.screenshot({ path: join(outDir, "6-after-a.png") });
  await page.waitForTimeout(400);
  const f2 = await desk.canvas.screenshot({ path: join(outDir, "6-after-b.png") });
  results.other = { label: other, current: o.current, before, after, moving: !f1.equals(f2) };
  check(6, "another emote plays", o.current !== emote.id && !o.paused && !o.recording, `${other} → ${o.current}`);
  check(6, "the camera orbits", JSON.stringify(before) !== JSON.stringify(after), `${before} → ${after}`);
  check(6, "nothing stays frozen", !f1.equals(f2), "two frames 0.4 s apart differ");
  report.steps[6] = results;
  save();
}
await desk.context.close();

// ---- 7. Phone (emulated: 390x844, touch, DPR 3, Android Chrome): record an MP4 at 720p.
if (only.has("7")) {
  const phone = await openApp("phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
  const settings = await phone.videoSettings("MP4", "720p", "draft");
  const record = phone.page.getByRole("button", { name: "Record video" });
  const box = await record.boundingBox();
  await phone.page.screenshot({ path: join(outDir, "7-phone-panel.png") });
  let result = null, failure = null;
  try { result = await phone.record("7-phone", 900000); } catch (error) { failure = String(error).slice(0, 300); }
  const status = failure ? await phone.status().catch(() => null) : result.status;
  const alive = await phone.page.evaluate(() => !!document.querySelector("canvas[data-engine]")).catch(() => false);
  report.steps[7] = { settings, recordButton: box, result, failure, status, alive };
  check(7, "Record is on screen", box && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  check(7, "it finishes or says why, and the page lives", alive && (result ? /\.mp4$/.test(result.name) : /Couldn/.test(status ?? "")),
    `${result ? `${result.name} in ${(result.ms / 1000).toFixed(1)} s` : failure} · ${status} · sizes ${settings.sizes.join(", ")}`);
  await phone.context.close();
  save();
}

save();
console.log("errors:", report.errors.length ? report.errors : "none");
await browser.close();
