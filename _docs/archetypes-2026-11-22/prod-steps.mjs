// Production-build run of functional-checklist.md part A (23 Nov 2026), by the agent under the owner's standing waiver.
// Builds the app with deploy.yml's production settings (a separate one-file public folder, so the local public/models
// is never copied), serves it at /the-finals-outfit/ and drives it as a visitor (navigator.webdriver masked), each
// scenario in its own browser context so saved outfits never leak between them. The live index carries no classes, so
// this checks that archetypes change nothing in production, flag or not, and that a class is kept, never lost.
// Screenshots and prod-steps.json go to scripts/generated/archetypes/prod (gitignored).
//   node _docs/archetypes-2026-11-22/prod-steps.mjs [--skip-build] [--keep-serving]
// The share step reads the share panel's short link; nothing is uploaded to the live share Worker.
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
const scratch = path.join(root, "scripts/generated/archetypes/prod");
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
const PORT = 4363;
const server = await preview({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir },
  preview: { port: PORT, strictPort: true, host: "127.0.0.1" } });
const APP = `http://127.0.0.1:${PORT}/the-finals-outfit/`;
const CARGOS = "2.36o.a1bl.cct"; // Hedge Hunter Cargos and the starting pieces (PR #60's outfit, minus the jersey)
const FLAG = "finals-archetypes:preview";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [], errors = [], bad = [];
const record = (step, pass, detail) => { results.push({ step, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${step}: ${detail}`); };

async function visitor() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
async function loaded(page) {
  await ready(page);
  await page.keyboard.press("Escape"); // the welcome screen
  for (const tip of await page.getByLabel("Dismiss tip").all()) await tip.click().catch(() => {});
  await settle(page, 4000);
}
async function open(page, search, hash) {
  await page.goto(`${APP}${search ? `?${search}` : ""}#/${hash ? `?${hash}` : ""}`);
  await loaded(page);
}
const picker = page => page.getByRole("radiogroup", { name: "Archetype" });
// The status line ("Medium · 3 pieces"), once it shows (up to 15 s after the load settles).
const hud = page => page.waitForFunction(() => [...document.querySelectorAll("span.hud")].map(s => s.textContent ?? "")
  .find(t => / · \d+ piece/.test(t)), null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => "");
const notice = page => page.evaluate(() => document.querySelector("[data-class-notice]")?.textContent ?? "");
const flag = page => page.evaluate(key => { try { return localStorage.getItem(key); } catch { return "unreadable"; } }, FLAG);
const shot = (page, name) => page.locator("canvas").first().screenshot({ path: path.join(shots, `${name}.png`) });

async function plain() {
  const { context, page } = await visitor();
  await open(page, "", `o=${CARGOS}`);
  const label = await hud(page);
  record("1 start", await picker(page).count() === 0 && /^Medium · \d+ piece/.test(label) && await flag(page) === null,
    `picker rows ${await picker(page).count()}, hud "${label}", flag ${await flag(page)}`);
  await shot(page, "1-start");
  await page.getByRole("button", { name: /Share outfit/i }).first().click();
  await settle(page, 1500);
  await page.getByLabel("Share link style").selectOption("short");
  await settle(page, 800);
  const link = await page.getByLabel("Outfit share link").inputValue();
  record("4 Medium link has no ar", /[#?&]o=/.test(link) && !/[?&]ar=/.test(link), link);
  await context.close();
}

async function flagged() {
  const { context, page } = await visitor();
  await open(page, "archetypes=on", `o=${CARGOS}`);
  record("2 flag on, no classes", await picker(page).count() === 0 && await flag(page) === "1" && /^Medium · /.test(await hud(page)),
    `picker rows ${await picker(page).count()}, flag ${await flag(page)}, hud "${await hud(page)}"`);
  await open(page, "", `o=${CARGOS}&ar=l`);
  const text = await notice(page);
  record("3 Light link shows Medium with a notice", /Light contestants aren.t available here yet; showing Medium/.test(text)
    && /^Medium · /.test(await hud(page)), `notice "${text}", hud "${await hud(page)}"`);
  await shot(page, "3-light-link");
  await page.goto(`${APP}#/`); // the saved outfit, not the link
  await loaded(page);
  const again = await notice(page);
  record("3 reload keeps Light", /Light contestants aren.t available here yet/.test(again), `notice after reload "${again}"`);
  await page.getByRole("button", { name: /Share outfit/i }).first().click();
  await settle(page, 1500);
  await page.getByLabel("Share link style").selectOption("short");
  await settle(page, 800);
  const link = await page.getByLabel("Outfit share link").inputValue();
  record("3 the outfit's link keeps ar=l", /[?&]ar=l(&|$)/.test(link), link);
  await page.getByLabel("Close share panel").click();
  await open(page, "archetypes=off", "");
  record("flag off clears it", await flag(page) === null && await notice(page) === "" && await picker(page).count() === 0,
    `flag ${await flag(page)}, notice "${await notice(page)}"`);
  await context.close();
}

try {
  await plain();
  await flagged();
} finally {
  writeFileSync(path.join(scratch, "prod-steps.json"), JSON.stringify({ when: new Date().toISOString(), results, errors, bad }, null, 2));
  console.log(`${results.filter(r => r.pass).length}/${results.length} pass; errors: ${errors.length}, failed responses: ${bad.length}`);
  for (const e of [...errors, ...bad].slice(0, 12)) console.log(`  ${e}`);
  await browser.close();
  if (!process.argv.includes("--keep-serving")) server.httpServer.close();
}
