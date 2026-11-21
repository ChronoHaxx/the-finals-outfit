// Mode switches must not leak audio devices (15 Nov 2026). Chinals mode (#/chinals) replaces the clip set, and with it
// the animator and its EmoteSounds; dispose() must close the old AudioContext and remove its gesture listeners, or the
// next click makes one more context for a discarded player. Counts every AudioContext the page makes while switching
// Global -> Chinals -> Global three times, playing an emote with sound in between.
//   node _docs/emote-sfx-2026-11-12/check-mode-switch.mjs [--base=http://127.0.0.1:5197/the-finals-outfit]
// (Git Bash or PowerShell, worktree root, the app served). Writes check-mode-switch.json beside this file.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv.find(a => a.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:5197/the-finals-outfit";
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  window.__contexts = [];
  const Original = window.AudioContext;
  window.AudioContext = class extends Original { constructor(...args) { super(...args); window.__contexts.push(this); } };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}`, { waitUntil: "load", timeout: 240000 });
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });

async function playWithSound() {
  const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await trigger.click(); await dialog.waitFor();
  await dialog.getByRole("searchbox").fill("Valkyria");
  await dialog.getByRole("button", { name: /Valkyria/ }).first().click();
  await page.waitForFunction(() => window.__rigAnim?.state().current === "ace-pilot", null, { timeout: 120000 });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => window.__rigAnim.animator.sounds.log.some(e => e.event === "start" || e.event === "schedule"));
}
const counts = () => page.evaluate(() => ({ made: window.__contexts.length, open: window.__contexts.filter(c => c.state !== "closed").length }));

const steps = [];
steps.push({ step: "global, first emote", sounded: await playWithSound(), ...(await counts()) });
for (let i = 1; i <= 3; i++) {
  await page.evaluate(() => { location.hash = "#/chinals"; });
  await page.waitForTimeout(4000);
  await page.mouse.click(5, 300); // a gesture while the Chinals clip set is in front (it has no sounds)
  await page.waitForTimeout(500);
  steps.push({ step: `chinals ${i}`, ...(await counts()) });
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });
  steps.push({ step: `global ${i}, emote`, sounded: await playWithSound(), ...(await counts()) });
}
await page.waitForTimeout(1000); // a disposed context closes after its fade
const end = await counts();
const result = { base: BASE, steps, end, errors,
  ok: end.open <= 1 && steps.filter(s => "sounded" in s).every(s => s.sounded) && !errors.length };
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "check-mode-switch.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
await browser.close();
