// Capture checks (21 Nov 2026): supersampled screenshots and the emote video export, in the real app (dev server,
// _docs/capture-2026-11-21/dev.sh). Headless Chrome as a person (navigator.webdriver hidden, so emote sounds load and
// the idle plays). Saved files go to <outDir> (renders of game assets: keep them out of git).
//   node _docs/capture-2026-11-21/capture-test.mjs <url> <outDir>
// ONLY=shot,ui,mp4,webm,png,repeat picks sections; GPU=1 tries the GPU instead of SwiftShader.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: capture-test.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const only = new Set((process.env.ONLY ?? "shot,ui,mp4,webm,png").split(","));
const report = { url, when: new Date().toISOString(), errors: [], checks: [], timings: {} };
const check = (name, pass, detail = "") => { report.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const args = process.env.GPU === "1" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ channel: "chrome", headless: true, args });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, deviceScaleFactor: 1 });
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const page = await context.newPage();
page.on("pageerror", e => report.errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || /\[video\]|\[screenshot\]/.test(m.text())) report.errors.push(`console ${m.type()}: ${m.text().slice(0, 400)}`); });

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
report.renderer = await page.evaluate(() => {
  const gl = window.__captureContext.gl.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log("renderer:", report.renderer);
await page.screenshot({ path: join(outDir, "page.png") });

const save = (name, base64) => writeFileSync(join(outDir, name), Buffer.from(base64, "base64"));

if (only.has("shot")) {
  // The same frame through the old pipeline's settings (no supersampling, 32 samples) and the new (2x, 16 samples),
  // at 2x the stage, the emote paused so both see the same pose.
  const result = await page.evaluate(async () => {
    const { ViewCapture } = await import("/src/rig/ViewerScreenshot.ts");
    const { encodePngAsync } = await import("/src/lib/png-encode.ts");
    const { backdropPaint, STUDIO_BACKDROP } = await import("/src/lib/stage-lighting.ts");
    window.__rigAnim.animator.setPaused(true);
    await new Promise(r => setTimeout(r, 500));
    const ctx = window.__captureContext, canvas = ctx.gl.domElement;
    const width = canvas.clientWidth * 2, height = canvas.clientHeight * 2;
    const out = {};
    for (const [name, supersample, samples] of [["before-1x32", 1, 32], ["after-2x16", 2, 16], ["after-4x8", 4, 8]]) {
      const t0 = performance.now();
      const capture = new ViewCapture(ctx.gl, ctx.scene, ctx.camera, { width, height, supersample, samples, transparent: false,
        keepFloor: false, backdrop: backdropPaint(STUDIO_BACKDROP), maxTile: 2048 });
      capture.draw();
      const pixels = await capture.read();
      const ms = performance.now() - t0;
      capture.dispose();
      const png = await encodePngAsync(width, height, pixels);
      let binary = "";
      for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
      out[name] = { ms: Math.round(ms), base64: btoa(binary), width, height };
    }
    return out;
  });
  for (const [name, r] of Object.entries(result)) { save(`shot-${name}.png`, r.base64); report.timings[`shot-${name}`] = r.ms; console.log(`shot ${name}: ${r.width}x${r.height} in ${r.ms} ms`); }
}

const panelButton = () => page.locator('button[aria-label^="Capture"]');
async function openPanel() {
  if (await panelButton().getAttribute("aria-expanded") !== "true") await panelButton().click();
  await page.waitForTimeout(300);
}
async function download(trigger, timeout) {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout }), trigger()]);
  const path = join(outDir, file.suggestedFilename());
  await file.saveAs(path);
  return { path, name: file.suggestedFilename() };
}

if (only.has("ui")) {
  await page.evaluate(() => window.__rigAnim.animator.setPaused(false));
  await openPanel();
  await page.getByRole("tab", { name: "Image" }).click();
  await page.getByRole("radio", { name: "Backdrop" }).click();
  const t0 = Date.now();
  const saved = await download(() => page.getByRole("button", { name: "Save PNG" }).click(), 180000);
  report.timings.uiSave = Date.now() - t0;
  const status = await page.locator('[role=group][aria-label=Capture] [role=status]').last().textContent();
  check("Save PNG downloads a supersampled PNG", /Saved \d+ × \d+/.test(status ?? ""), `${saved.name} · ${status} · ${report.timings.uiSave} ms`);
  await page.getByRole("radio", { name: "Transparent" }).click();
  const transparent = await download(() => page.getByRole("button", { name: "Save PNG" }).click(), 180000);
  check("transparent PNG downloads", /transparent\.png$/.test(transparent.name), transparent.name);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(url).origin });
  await page.getByRole("button", { name: "Copy" }).click();
  await page.locator('[role=group][aria-label=Capture] [role=status]', { hasText: /Copied|Couldn/ }).waitFor({ timeout: 180000 });
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]?.getType("image/png");
    return blob ? blob.size : 0;
  });
  const copyStatus = await page.locator('[role=group][aria-label=Capture] [role=status]').last().textContent();
  check("Copy puts a PNG on the clipboard", copied > 1000 && /Copied/.test(copyStatus ?? ""), `${copied} bytes · ${copyStatus}`);
  await page.getByRole("radio", { name: "Backdrop" }).click();
}

// An emote with sound, 2-5 s long.
let emote = null;
if (["mp4", "webm", "png", "repeat"].some(s => only.has(s))) {
  emote = await page.evaluate(async () => {
    const animator = window.__rigAnim.animator;
    await animator.sounds.load();
    const preferred = (window.__EMOTE ?? "").trim();
    const clips = animator.manifest.clips.filter(c => c.kind === "emote" && !c.loop && c.duration >= 2 && c.duration <= 5 && animator.sounds.hasSound(c.source));
    const pick = clips.find(c => c.id === preferred) ?? clips.find(c => (c.emote?.props ?? []).length > 0) ?? clips[0];
    await window.__rigAnim.play(pick.id);
    return { id: pick.id, label: pick.label, duration: pick.duration, source: pick.source, cues: (await animator.sounds.load()).emotes[pick.source] };
  });
  console.log("emote:", emote.id, emote.label, emote.duration, "first cue at", emote.cues?.[0]?.start);
  report.emote = emote;
  await page.waitForTimeout(1500);
}

async function record(format, label, quality, sizeLabel) {
  await openPanel();
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("radio", { name: new RegExp(`^${label}`) }).click();
  const sizes = await page.getByLabel("Video size").locator("option").allTextContents();
  const size = sizes.find(s => s.startsWith(sizeLabel)) ?? sizes[0];
  await page.getByLabel("Video size").selectOption({ label: size });
  await page.getByLabel("Video quality").selectOption(quality);
  const t0 = Date.now();
  const progress = [];
  const poll = setInterval(async () => {
    const text = await panelButton().getAttribute("aria-label").catch(() => null);
    if (text) progress.push(text);
  }, 2000);
  try {
    const file = await download(() => page.getByRole("button", { name: "Record video" }).click(), 1800000);
    const ms = Date.now() - t0;
    await page.waitForTimeout(500);
    await openPanel();
    const status = await page.locator('[role=group][aria-label=Capture] [role=status]').last().textContent();
    report.timings[`video-${format}-${quality}-${sizeLabel}`] = ms;
    console.log(`${format}: ${file.name} in ${(ms / 1000).toFixed(1)} s · ${status}`);
    return { ...file, ms, status, progress: progress.slice(-3), size };
  } finally { clearInterval(poll); }
}

if (only.has("mp4")) report.mp4 = await record("mp4", "MP4", process.env.QUALITY ?? "draft", process.env.SIZE ?? "720p");
if (only.has("webm")) report.webm = await record("webm", "WebM", process.env.QUALITY ?? "draft", process.env.SIZE ?? "720p");
if (only.has("png")) report.png = await record("png", "PNG sequence", process.env.QUALITY ?? "draft", process.env.SIZE ?? "720p");
if (only.has("repeat")) report.repeat = await record("png", "PNG sequence", "draft", "480p");

// The viewer is back where it was: the emote's timeline still there, the animator not recording.
report.after = await page.evaluate(() => ({ recording: window.__rigAnim.animator.recording, state: window.__rigAnim.animator.state }));
check("the viewer gets its clock back", report.after.recording === false, JSON.stringify(report.after.state));
await page.screenshot({ path: join(outDir, "page-after.png") });
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log("errors:", report.errors.length ? report.errors : "none");
await browser.close();
