// Production-build run of functional-checklist.md (22 Nov 2026), by the agent under the owner's standing waiver.
// Builds the app with deploy.yml's production settings (a separate one-file public folder, so the local public/models
// is never copied), serves it at /the-finals-outfit/ and drives it as a visitor (navigator.webdriver masked), each
// scenario in its own browser context so saved outfits never leak between them. The camera is placed with the app's
// own `view` link parameter. Screenshots and prod-steps.json go to scripts/generated/player-number/prod (gitignored).
//   node _docs/player-number-2026-11-22/prod-steps.mjs [--skip-build] [--only=<scenario,...>]
// The share step reads the share panel's short link; a preview-card upload from 127.0.0.1 is refused by the Worker's
// origin check before anything is stored, so this run never writes to the live share Worker.
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const deploy = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const host = name => {
  const value = new RegExp("^\\s+" + name + ":\\s*(https://[^\\s'\"]+)", "m").exec(deploy)?.[1];
  if (!value) throw new Error(`deploy.yml has no ${name}`);
  return value;
};
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
const scratch = path.join(root, "scripts/generated/player-number/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public"), shots = path.join(scratch, "shots");
Object.assign(process.env, {
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: host("ASSETS_BASE"), VITE_MODELS_BASE: host("MODELS_BASE"),
  VITE_RECONSTRUCTION_BASE: host("RECONSTRUCTION_BASE"), VITE_SHARE_PREVIEW_BASE: host("SHARE_PREVIEW_BASE"),
  VITE_SCENES_BASE: host("SCENES_BASE"), VITE_ANIMATIONS_BASE: host("ANIMATIONS_BASE"),
  VITE_CHINALS_ANIMATIONS_BASE: host("CHINALS_ANIMATIONS_BASE"),
  VITE_RECONSTRUCTION_ROUTES_FILE: "src/data/reconstruction-routes.json",
});
mkdirSync(shots, { recursive: true });
if (!process.argv.includes("--skip-build")) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // this script's own scratch output only
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg"));
  await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
    build: { outDir, emptyOutDir: true } });
}
const server = await preview({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir },
  preview: { port: 4361, strictPort: true, host: "127.0.0.1" } });
const APP = "http://127.0.0.1:4361/the-finals-outfit/";

// Fnatic Jersey + Hedge Hunter Cargos (PR #60's outfit), and the Baseball Jersey (authored 8, newly changeable).
// The waist is checked without the jersey: its hem covers the middle of the cargos' number, where one digit prints.
const JERSEY_CARGOS = "2.36o.81qz.a1bl.cct", CARGOS = "2.36o.a1bl.cct", BASEBALL = "2.36o.81z3.a1bl.cct";
const VIEWS = {
  sleeve: "0.62_1.45_-0.42_0.2_1.36_0", // behind the character's left shoulder, at the sleeve print
  waist: "0.42_0.98_-0.62_0.13_0.96_-0.1", // behind the character's left hip, at the cargos' waistband print
  back: "0_1.25_-1.7_0_1.2_0", // the baseball jersey's back
  front: "0_1.25_1.7_0_1.2_0",
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [], errors = [], bad = [];
const record = (step, pass, detail) => { results.push({ step, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${step}: ${detail}`); };

async function visitor() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  return { context, page };
}
const settle = (page, ms) => page.waitForTimeout(ms);
const ready = page => page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false,
  null, { timeout: 240000 });
async function open(page, hash) {
  await page.goto(`${APP}#/?${hash}`);
  await loaded(page);
}
// After a load: close the welcome screen, return the outfit-screen idle to the still pose once it starts (so the
// character stands as it did when the camera was placed), and dismiss one-time tips that cover the canvas.
async function loaded(page) {
  await ready(page);
  await page.keyboard.press("Escape"); // the welcome screen
  const still = page.locator('button[title="Return to the still pose"]');
  try { await still.waitFor({ timeout: 60000 }); await still.click(); } catch { /* the idle never started */ }
  for (const tip of await page.getByLabel("Dismiss tip").all()) await tip.click().catch(() => {});
  await settle(page, 6000);
}
const box = page => page.getByLabel(/^Player number, /);
const row = page => page.getByRole("group", { name: "Player number" });
async function setNumber(page, text) {
  await box(page).click();
  await box(page).fill("");
  await box(page).pressSequentially(text, { delay: 60 });
  await box(page).press("Enter"); // blurs: the field shows the number as stored
  await settle(page, 4000);
}
const shot = async (page, name) => {
  const file = path.join(shots, `${name}.png`);
  await page.locator("canvas").first().screenshot({ path: file });
  return file;
};

async function jerseySleeve() {
  const { context, page } = await visitor();
  await open(page, `o=${JERSEY_CARGOS}&view=${VIEWS.sleeve}`);
  const start = (await row(page).innerText()).replace(/\s+/g, " ");
  record("1 start", /Own/i.test(start) && /On 2 pieces · each shows its own/i.test(start) && await box(page).inputValue() === "",
    `row "${start}", placeholder "${await box(page).getAttribute("placeholder")}"`);
  await shot(page, "sleeve-own");
  for (const n of ["7", "10", "99", "0"]) {
    await setNumber(page, n);
    const hint = (await row(page).innerText()).replace(/\s+/g, " ");
    record(`set ${n}`, await box(page).inputValue() === n && /On 2 pieces$/i.test(hint), `field "${await box(page).inputValue()}", row "${hint}"`);
    await shot(page, `sleeve-${n}`);
  }
  await setNumber(page, "07");
  record("07 is 7", await box(page).inputValue() === "7", `field "${await box(page).inputValue()}" after typing 07`);
  await page.reload(); // the address bar no longer has the link: the saved outfit opens
  await loaded(page);
  record("reload keeps 7", await box(page).inputValue() === "7", `field "${await box(page).inputValue()}" after reload`);
  await shot(page, "reload-7-default-framing");
  await open(page, `view=${VIEWS.sleeve}`); // the saved outfit again, framed on the sleeve
  record("reopen keeps 7", await box(page).inputValue() === "7", `field "${await box(page).inputValue()}" after reopening`);
  await shot(page, "sleeve-reload-7");
  await page.getByRole("button", { name: /Share outfit/i }).first().click();
  await settle(page, 1500);
  await page.getByLabel("Share link style").selectOption("short");
  await settle(page, 800);
  const link = await page.getByLabel("Outfit share link").inputValue();
  record("share link", /[?&]pn=7(&|$)/.test(link), link);
  await page.getByLabel("Close share panel").click();
  await row(page).getByRole("button", { name: "Own", exact: true }).click();
  await settle(page, 4000);
  const again = (await row(page).innerText()).replace(/\s+/g, " ");
  record("Own again", await box(page).inputValue() === "" && /each shows its own/i.test(again), `field "${await box(page).inputValue()}", row "${again}"`);
  await shot(page, "sleeve-own-again");
  await context.close();
  return link;
}

async function cargosWaist() {
  const { context, page } = await visitor();
  await open(page, `o=${CARGOS}&view=${VIEWS.waist}`);
  const start = (await row(page).innerText()).replace(/\s+/g, " ");
  record("cargos alone", /On 1 piece · each shows its own/i.test(start), `row "${start}"`);
  await shot(page, "waist-own");
  for (const n of ["7", "10", "99", "0"]) { await setNumber(page, n); await shot(page, `waist-${n}`); }
  await context.close();
}

async function sharedLink(link) {
  const { context, page } = await visitor();
  const hash = new URL(link.replace("#/", "")).search.slice(1);
  await open(page, `${hash}&view=${VIEWS.sleeve}`);
  record("link opens at 7", await box(page).inputValue() === "7", `field "${await box(page).inputValue()}" from ${hash}`);
  await shot(page, "link-7");
  await context.close();
}

async function baseball() {
  const { context, page } = await visitor();
  await open(page, `o=${BASEBALL}&view=${VIEWS.back}`);
  const start = (await row(page).innerText()).replace(/\s+/g, " ");
  record("baseball prints a number", /On [1-9]\d* piece/i.test(start), `row "${start}"`);
  await shot(page, "baseball-back-own");
  for (const n of ["42", "7"]) { await setNumber(page, n); await shot(page, `baseball-back-${n}`); }
  await context.close();
}

try {
  let link = null;
  if (!only || only.includes("sleeve")) link = await jerseySleeve();
  if (!only || only.includes("waist")) await cargosWaist();
  if (link && (!only || only.includes("link"))) await sharedLink(link);
  if (!only || only.includes("baseball")) await baseball();
} finally {
  writeFileSync(path.join(scratch, "prod-steps.json"), JSON.stringify({ when: new Date().toISOString(), results, errors, bad }, null, 2));
  console.log(`errors: ${errors.length}, failed responses: ${bad.length}`);
  for (const e of [...errors, ...bad].slice(0, 12)) console.log(`  ${e}`);
  await browser.close();
  server.httpServer.close();
}
