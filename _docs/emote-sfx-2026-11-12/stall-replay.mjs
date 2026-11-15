// Does BlackSmith's start stall only the first time its props draw? Play it twice in one page; record rAF gaps.
import { chromium } from "playwright-core";
const BASE = process.argv[2] ?? "http://127.0.0.1:5197/the-finals-outfit";
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const page = await context.newPage();
await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}`, { waitUntil: "load", timeout: 240000 });
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });
await page.evaluate(() => {
  window.__gaps = []; let last = performance.now();
  const tick = t => { window.__gaps.push([t, t - last, window.__rigAnim.state().current]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
async function play(label, id) {
  const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  if (!(await dialog.isVisible().catch(() => false))) { await trigger.click(); await dialog.waitFor(); }
  await dialog.getByRole("searchbox").fill(label);
  await dialog.getByRole("button", { name: new RegExp(label) }).first().click();
  await page.waitForFunction(i => window.__rigAnim.state().current === i, id, { timeout: 60000 });
  await page.keyboard.press("Escape").catch(() => {});
}
const result = {};
for (const run of ["first", "second"]) {
  await page.evaluate(() => window.__gaps.splice(0));
  await play("BlackSmith", "black-smith");
  await page.waitForTimeout(2500);
  const gaps = await page.evaluate(() => window.__gaps.splice(0));
  const on = gaps.filter(g => g[2] === "black-smith");
  const t0 = on[0]?.[0] ?? 0;
  result[run] = { frames: on.length, maxMs: Math.round(Math.max(...on.map(g => g[1]))),
    stalls: on.filter(g => g[1] > 100).map(g => [+((g[0] - t0) / 1000).toFixed(2), Math.round(g[1])]) };
  // back to idle before the replay
  await page.getByRole("button", { name: /Close|Stop the emote|✕/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
}
console.log(JSON.stringify(result));
await browser.close();
