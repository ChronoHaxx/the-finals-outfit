// Production check (22 Nov 2026): build the app with deploy.yml's production settings and the new Chinals host, serve
// it at /the-finals-outfit/, and check in headless Chrome that
//   - in Chinals mode a paused Unrivaled Master (WeaponMaster) at its surprise peak loads the face index, the head, its
//     pose asset and the clip's curves from the Chinals host's faces-1 (screenshot for a look at full size);
//   - as a visitor (automation masked, so the app plays sound), the banner and the picker footer say facial
//     expressions are shown, and clicking Unrivaled Master plays it to the end with its sound from sounds-1;
//   - no request to either animations host fails and the page logs no error.
// Screenshots and prod-check.json go to scripts/generated/chinals-faces-2026-11-21/prod (gitignored); the summary is
// copied beside this file.
//   node _docs/chinals-faces-2026-11-21/prod-check.mjs [--chinals=<host URL ending in />] [--skip-build]
//   (Git Bash or PowerShell, worktree root)
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = process.cwd();
// The hosts come from deploy.yml itself (22 Nov: the copies first written here went stale when main's release #67 moved
// the asset and reconstruction hosts, and the new code then refused the old reconstruction's skin pairs).
const deploy = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const host = name => {
  const value = new RegExp("^\\s+" + name + ":\\s*(https://[^\\s'\"]+)", "m").exec(deploy)?.[1];
  if (!value) throw new Error(`deploy.yml has no ${name}`);
  return value;
};
const ANIM = host("ANIMATIONS_BASE");
const CHINALS = arg("chinals", host("CHINALS_ANIMATIONS_BASE"));
if (!CHINALS.endsWith("/")) throw new Error("--chinals=<host URL ending in />");
const here = path.join(root, "_docs/chinals-faces-2026-11-21");
const scratch = path.join(root, "scripts/generated/chinals-faces-2026-11-21/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public");
Object.assign(process.env, { // .github/workflows/deploy.yml, production build
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: host("ASSETS_BASE"),
  VITE_MODELS_BASE: host("MODELS_BASE"),
  VITE_RECONSTRUCTION_BASE: host("RECONSTRUCTION_BASE"),
  VITE_SHARE_PREVIEW_BASE: host("SHARE_PREVIEW_BASE"),
  VITE_SCENES_BASE: host("SCENES_BASE"), // main's scene backdrops (#57)
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
  preview: { port: 4357, strictPort: true, host: "127.0.0.1" } });
const APP = "http://127.0.0.1:4357/the-finals-outfit/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [], hosted = [];
const watch = page => {
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("response", r => {
    for (const [host, base] of [["anim", ANIM], ["chinals", CHINALS]])
      if (r.url().startsWith(base)) hosted.push({ status: r.status(), file: r.url().slice(base.length), host });
  });
};
const EMOTE = "cn-emote-weaponmaster", CURVES = "faces-1/curves/HM_Frontend_Emote_A_WeaponMaster_00.json";
const SOUND = "sounds-1/Emote_Frontend_A_WeaponMaster_00.m4a";
const result = { anim: ANIM, chinals: CHINALS, checks: {} };
try {
  // 1. Paused at the surprise peak, close on the face (automation: the page starts still, no sound).
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  watch(page);
  const slots = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
    feet: "casual-tallsneakers-canvas", face: "head-face-01-base" };
  const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await page.goto(`${APP}?outfit=${outfit}#/chinals`, { waitUntil: "load", timeout: 180000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
  for (let attempt = 0; ; attempt++) { // the body can still be loading just after the idle flag
    try { await page.evaluate(([c, t]) => window.__rigAnim.play(c, t), [EMOTE, 3.2]); break; }
    catch (error) { if (attempt >= 30 || !/Body not loaded/.test(String(error))) throw error; await page.waitForTimeout(1000); }
  }
  await page.waitForFunction(f => performance.getEntriesByType("resource").some(e => e.name.endsWith(f)), CURVES, { timeout: 60000 });
  await page.waitForTimeout(6000); // the pose files and the still view
  result.checks.paused = await page.evaluate(() => { const a = window.__rigAnim.animator; return {
    current: a.state.current, paused: a.state.paused, faceAvailable: a.face.available, soundsAvailable: a.sounds.available }; });
  await page.screenshot({ path: path.join(scratch, "weaponmaster-3.2s.png") });
  await page.close();
  // 2. As a visitor: the app turns sound off under automation (src/lib/automation.ts, navigator.webdriver), so this
  // page masks that flag, waits for the page to settle (an emote picked in the first seconds could be cut back to the
  // idle before PR #69), and clicks the tile for real: the gesture browsers require before audio.
  const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await viewer.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  watch(viewer);
  await viewer.goto(`${APP}#/chinals`, { waitUntil: "load", timeout: 180000 });
  await viewer.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  await viewer.keyboard.press("Escape"); // the welcome dialog
  await viewer.waitForTimeout(15000);
  result.checks.banner = (await viewer.locator("details").filter({ hasText: "Chinals mode" }).first().textContent())
    .replace(/\s+/g, " ").match(/Props[^.]*\./)?.[0] ?? null;
  await viewer.locator('button[title="Play an emote"]').click();
  const picker = viewer.getByRole("dialog", { name: "Emotes" });
  await picker.waitFor();
  await viewer.waitForFunction(() => window.__rigAnim.animator.sounds.available, null, { timeout: 60000 });
  await viewer.waitForTimeout(300);
  result.checks.footer = (await picker.locator("p").last().innerText()).replace(/\s+/g, " ").trim();
  await picker.locator('button[title^="Unrivaled Master"]').first().click();
  const samples = [];
  for (let i = 0; i < 40; i++) { // until it returns to the idle
    samples.push(await viewer.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
      return { clip: a.state.current, time: t ? +t.time.toFixed(2) : null, audio: a.sounds.unlocked }; }));
    if (samples.length > 1 && samples.some(s => s.clip === "cn-emote-weaponmaster") && samples.at(-1).clip !== "cn-emote-weaponmaster") break;
    await viewer.waitForTimeout(500);
  }
  const played = samples.filter(s => s.clip === EMOTE);
  result.checks.clickPlayed = { clip: played.length ? EMOTE : samples.at(-1)?.clip, reached: played.at(-1)?.time ?? null,
    audioRunning: samples.some(s => s.audio), after: samples.at(-1)?.clip };
  await viewer.close();
} catch (e) { result.error = String(e).slice(0, 400); }
const fromChinals = prefix => hosted.filter(h => h.host === "chinals" && h.file.startsWith(prefix)).map(h => `${h.status} ${h.file}`);
result.checks.hostedRequests = { faces: fromChinals("faces-1/"), sounds: fromChinals("sounds-1/"),
  clips: fromChinals("set-3/").length, props: fromChinals("props-3/").length };
result.non200 = hosted.filter(h => h.status !== 200 && h.status !== 304);
result.errors = [...new Set(errors)].slice(0, 10);
const faces = result.checks.hostedRequests.faces, c = result.checks;
// soundsAvailable is false on the first page by design (sound is off under automation); part 2 checks the sound.
result.ok = !result.error && c.paused?.current === EMOTE && c.paused.faceAvailable
  && ["faces-1/faces.json", "faces-1/heads/SK_Head_Face_01_Base.json", "faces-1/poses/Head_Face_01_Base_PoseAsset.json", CURVES]
    .every(f => faces.some(r => r.endsWith(` ${f}`)))
  && c.hostedRequests.sounds.some(r => r.endsWith(SOUND))
  && c.banner === "Props, sound and facial expressions are shown; effects are not."
  && /sound and facial expressions\. Effects are not shown yet\./.test(c.footer ?? "")
  && c.clickPlayed?.clip === EMOTE && c.clickPlayed.reached > 5 && c.clickPlayed.audioRunning
  && !result.non200.length && !result.errors.length;
writeFileSync(path.join(scratch, "prod-check.json"), JSON.stringify(result, null, 2));
writeFileSync(path.join(here, "prod-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close(); await server.close();
