// Production check (6 Nov): build the app with deploy.yml's production settings plus the new animation host, serve it
// at /the-finals-outfit/, and play a prop emote headless. Proves the hosted clips/props load cross-origin in a
// production bundle (no dev server, no local /animations/).
//   node scripts/generated/anim-export/upload/prod-check.mjs [--skip-build]
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const here = path.join(root, "scripts/generated/anim-export/upload");
const outDir = path.join(here, "dist-prod"), publicDir = path.join(here, "public-prod");
const ANIM = "https://cd858839.the-finals-outfit-assets.pages.dev/";
Object.assign(process.env, {
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: "https://d0b954a8.the-finals-outfit-assets.pages.dev/",
  VITE_MODELS_BASE: "https://a029b249.the-finals-outfit-assets.pages.dev/",
  VITE_RECONSTRUCTION_BASE: "https://29ae13de.the-finals-outfit-assets.pages.dev/",
  VITE_SHARE_PREVIEW_BASE: "https://the-finals-outfit-share.chronohaxx.workers.dev",
  VITE_ANIMATIONS_BASE: ANIM,
  VITE_RECONSTRUCTION_ROUTES_FILE: "src/data/reconstruction-routes.json",
});
if (false) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // our own scratch build output only
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg")); // what CI's public/ holds
  await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
    build: { outDir, emptyOutDir: true } });
}
const server = { close: async () => {} };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const errors = [], anim = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("response", r => { if (r.url().startsWith(ANIM)) anim.push(`${r.status()} ${r.url().slice(ANIM.length)}`); });
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const result = {};
try {
  await page.goto(`https://chronohaxx.github.io/the-finals-outfit/?outfit=${outfit}`, { waitUntil: "load", timeout: 180000 });
  await page.keyboard.press("Escape"); // welcome dialog, if any
  const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
  await trigger.waitFor({ timeout: 180000 });
  result.controls = await page.getByRole("button", { name: /^(Animate|Animated)$/ }).first().textContent().catch(() => null);
  await page.waitForTimeout(8000); // outfit settles
  await page.screenshot({ path: path.join(here, "live-still.png") });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.getByRole("searchbox").fill("cuppa");
  await dialog.getByRole("button", { name: /Fancy a Cuppa/ }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(3600);
  await page.getByRole("button", { name: /^Pause$/ }).first().click().catch(() => { result.pause = "no Pause button"; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(here, "live-cuppa.png") });
} catch (e) { result.error = String(e).slice(0, 300); }
result.animResponses = anim.length; result.animSample = anim.slice(0, 12); result.animNon200 = anim.filter(a => !a.startsWith("200"));
result.errors = [...new Set(errors)].slice(0, 10);
writeFileSync(path.join(here, "live-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close(); await server.close();
