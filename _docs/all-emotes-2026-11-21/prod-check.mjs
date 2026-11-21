// Production check (21 Nov 2026): build the app with deploy.yml's production settings and the new animations host,
// serve it at /the-finals-outfit/, and check in headless Chrome that
//   - the hosted manifest gives the picker 295 emotes with Season 2 and Season 1 sections;
//   - old share links still open their clip (`wave` now labelled What's Up?, `tap-dance` still in More);
//   - two new prop emotes (Coop Caper, Gimme Five) load their props from props-10 and a new emote its face curves
//     from faces-2, with no failed request to the host and no page error;
//   - Chinals mode (the production Chinals host) ends with Uncategorised;
//   - as a visitor (automation masked), clicking Coop Caper plays it to the end with its sound from sounds-2.
// Screenshots and prod-check.json go to scripts/generated/all-emotes-2026-11-21/prod (gitignored); the summary is
// copied beside this file.
//   node _docs/all-emotes-2026-11-21/prod-check.mjs --anim=https://<hash>.the-finals-outfit-assets.pages.dev/ [--skip-build]
//   (Git Bash or PowerShell, worktree root)
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ANIM = arg("anim");
if (!ANIM?.endsWith("/")) throw new Error("--anim=<host URL ending in /> is required");
const CHINALS = "https://dcb131a5.the-finals-outfit-chinals-assets.pages.dev/"; // deploy.yml CHINALS_ANIMATIONS_BASE
const root = process.cwd();
const here = path.join(root, "_docs/all-emotes-2026-11-21");
const scratch = path.join(root, "scripts/generated/all-emotes-2026-11-21/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public");
Object.assign(process.env, { // .github/workflows/deploy.yml, production build
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: "https://f4a8e069.the-finals-outfit-assets.pages.dev/",
  VITE_MODELS_BASE: "https://a029b249.the-finals-outfit-assets.pages.dev/",
  VITE_RECONSTRUCTION_BASE: "https://c062af24.the-finals-outfit-assets.pages.dev/",
  VITE_SHARE_PREVIEW_BASE: "https://the-finals-outfit-share.chronohaxx.workers.dev",
  VITE_ANIMATIONS_BASE: ANIM,
  VITE_CHINALS_ANIMATIONS_BASE: CHINALS,
  VITE_RECONSTRUCTION_ROUTES_FILE: "src/data/reconstruction-routes.json",
});
mkdirSync(scratch, { recursive: true });
if (!process.argv.includes("--skip-build")) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // our own scratch build output only
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg")); // what CI's public/ holds
  await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
    build: { outDir, emptyOutDir: true } });
}
const server = await preview({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir },
  preview: { port: 4353, strictPort: true, host: "127.0.0.1" } });
const APP = "http://127.0.0.1:4353/the-finals-outfit/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [], hosted = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
page.on("response", r => {
  for (const base of [ANIM, CHINALS]) if (r.url().startsWith(base)) hosted.push({ status: r.status(), file: r.url().slice(base.length), host: base === ANIM ? "anim" : "chinals" });
});

async function open(query = "", hash = "") {
  await page.goto(`${APP}${query}${hash}`, { waitUntil: "load", timeout: 180000 });
  await page.keyboard.press("Escape"); // welcome dialog, if any
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
}
async function pickerSections() {
  await page.getByRole("button", { name: /emotes/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  const tabText = (await dialog.getByRole("button", { name: /^Emotes \d+/ }).innerText()).replace(/\s+/g, " ").trim();
  const sections = await dialog.locator("section[aria-label]").evaluateAll(list =>
    list.map(s => ({ title: s.getAttribute("aria-label"), tiles: s.querySelectorAll("button").length })));
  return { tabText, sections, dialog };
}
async function hold(id, time, shot) {
  for (let attempt = 0; ; attempt++) { // the body can still be loading just after the idle flag
    try { await page.evaluate(([c, t]) => window.__rigAnim.play(c, t), [id, time]); break; }
    catch (error) { if (attempt >= 30 || !/Body not loaded/.test(String(error))) throw error; await page.waitForTimeout(1000); }
  }
  await page.waitForTimeout(5000); // props, face curves and the still view
  await page.screenshot({ path: path.join(scratch, `${shot}.png`) });
  return page.evaluate(() => { const s = window.__rigAnim.animator.state; return { current: s.current, paused: s.paused }; });
}

const result = { anim: ANIM, chinals: CHINALS, checks: {} };
try {
  // 1. Global picker.
  await open();
  result.checks.manifest = await page.evaluate(() => {
    const clips = window.__rigAnim.animator.manifest.clips;
    return { clips: clips.length, emotes: clips.filter(c => c.kind === "emote" && c.emote && !c.emote.unlisted).length,
      wave: clips.find(c => c.id === "wave")?.label, tapDance: clips.find(c => c.id === "tap-dance")?.kind ?? null };
  });
  const global = await pickerSections();
  result.checks.globalPicker = { tab: global.tabText, sections: global.sections };
  const s1 = global.dialog.locator('section[aria-label="Season 1"]');
  await s1.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
  await global.dialog.screenshot({ path: path.join(scratch, "picker-season-1.png") });
  // 2. Old share links.
  hosted.length = 0;
  await open("?anim=wave&animTime=1");
  await page.waitForFunction(() => window.__rigAnim.animator.state.current === "wave", null, { timeout: 60000 });
  result.checks.waveLink = await page.evaluate(() => { const a = window.__rigAnim.animator; return { current: a.state.current, label: a.manifest.clips.find(c => c.id === a.state.current)?.label }; });
  // 3. New prop emotes and a new face-curve file.
  result.checks.coopCaper = await hold("fox-chicken", 2.0, "coop-caper"); // ids come from the item ids, not the names
  result.checks.gimmeFive = await hold("high-five", 1.5, "gimme-five");
  result.checks.makeItRain = await hold("make-it-rain", 1.5, "make-it-rain");
  // 4. Chinals picker.
  await open("", "#/chinals");
  const chinals = await pickerSections();
  result.checks.chinalsPicker = { tab: chinals.tabText, sections: chinals.sections };
  const unc = chinals.dialog.locator('section[aria-label="Uncategorised"]');
  if (await unc.count()) { await unc.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500); }
  await chinals.dialog.screenshot({ path: path.join(scratch, "picker-chinals-uncategorised.png") });
  await page.close();
  // 5. Sound, as a visitor. The app turns sound off under automation (src/lib/automation.ts, navigator.webdriver), so
  // this page masks that flag (the welcome dialog then opens and the idle plays), waits for the page to settle (an
  // emote picked in the first seconds can be cut back to the idle: a startup race, also on main, README), opens the
  // picker and clicks a new emote's tile for real: the gesture browsers require before audio.
  const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await viewer.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  viewer.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  viewer.on("response", r => { if (r.url().startsWith(ANIM)) hosted.push({ status: r.status(), file: r.url().slice(ANIM.length), host: "anim" }); });
  await viewer.goto(APP, { waitUntil: "load", timeout: 180000 });
  await viewer.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  await viewer.keyboard.press("Escape"); // the welcome dialog
  await viewer.waitForTimeout(20000);
  await viewer.locator('button[title="Play an emote"]').click();
  const picker = viewer.getByRole("dialog", { name: "Emotes" });
  await picker.waitFor();
  await viewer.waitForFunction(() => window.__rigAnim.animator.sounds.available, null, { timeout: 60000 }); // sounds.json
  await viewer.waitForTimeout(300);
  result.checks.footer = (await picker.locator("p").last().innerText()).replace(/\s+/g, " ").trim();
  await picker.locator('button[title^="Coop Caper"]').first().click();
  const samples = [];
  for (let i = 0; i < 40; i++) { // until it returns to the idle
    samples.push(await viewer.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
      return { clip: a.state.current, time: t ? +t.time.toFixed(2) : null, audio: a.sounds.unlocked }; }));
    if (samples.length > 1 && samples.at(-1).clip === "outfit-idle" && samples.some(s => s.clip === "fox-chicken")) break;
    await viewer.waitForTimeout(500);
  }
  const played = samples.filter(s => s.clip === "fox-chicken");
  result.checks.clickPlayed = { clip: played.length ? "fox-chicken" : samples.at(-1)?.clip, reached: played.at(-1)?.time ?? null,
    audioRunning: samples.some(s => s.audio), thenIdle: samples.at(-1)?.clip === "outfit-idle" };
  await viewer.close();
} catch (e) { result.error = String(e).slice(0, 400); }
result.checks.hostedRequests = {
  props10: hosted.filter(h => h.file.startsWith("props-10/")).length,
  faces2: hosted.filter(h => h.file.startsWith("faces-2/")).length,
  sounds2: hosted.filter(h => h.file.startsWith("sounds-2/")).map(h => `${h.status} ${h.file}`),
  set6: hosted.filter(h => h.file.startsWith("set-6/")).length,
};
result.non200 = hosted.filter(h => h.status !== 200 && h.status !== 304);
result.errors = [...new Set(errors)].slice(0, 10);
const sec = (list, title) => list?.sections.find(s => s.title === title)?.tiles ?? 0;
const g = result.checks.globalPicker, c = result.checks.chinalsPicker, r = result.checks.hostedRequests;
result.ok = !result.error && result.checks.manifest?.emotes === 295 && /295/.test(g?.tab ?? "")
  && sec(g, "Season 1") === 41 && sec(g, "Season 2") === 16 && result.checks.waveLink?.current === "wave"
  && result.checks.coopCaper?.current === "fox-chicken" && result.checks.gimmeFive?.current === "high-five"
  && r?.props10 > 0 && r?.faces2 > 0 && r?.sounds2.some(f => f.endsWith(".m4a"))
  && result.checks.clickPlayed?.clip === "fox-chicken" && result.checks.clickPlayed.reached > 7 && result.checks.clickPlayed.audioRunning
  && /sound and facial expressions/.test(result.checks.footer ?? "")
  && sec(c, "Uncategorised") === 5 && !result.non200.length && !result.errors.length;
writeFileSync(path.join(scratch, "prod-check.json"), JSON.stringify(result, null, 2));
writeFileSync(path.join(here, "prod-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close(); await server.close();
