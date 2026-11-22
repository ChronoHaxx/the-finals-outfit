// The discovery checklist (22 Nov 2026), run in the real app on a production build: callouts, the tour, Show me, the
// nudges, persistence, phones, reduced motion, automation and broken storage. Headless Chrome as a visitor
// (navigator.webdriver hidden) except in the automation step. Screenshots go to <outDir>, outside git (game renders).
//   node _docs/diegetic-discovery-2026-11-22/discovery-check.mjs <url> <outDir>
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: discovery-check.mjs <url> <outDir>");
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const checks = [];
const check = (step, name, pass, detail = "") => {
  checks.push({ step, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${step}] ${name}${detail ? ` · ${detail}` : ""}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });

async function open({ width = 1440, height = 900, mobile = false, visitor = true, reducedMotion = "no-preference", storage = "ok" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion });
  if (visitor) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  if (storage === "broken") await context.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException("blocked", "QuotaExceededError"); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  if (visitor) {
    await page.waitForFunction(() => !!document.querySelector("dialog[open]"), null, { timeout: 30000 }).catch(() => {});
    await page.keyboard.press("Escape");
  }
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { context, page, errors };
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const tourName = page => page.evaluate(() => document.getElementById("tour-name")?.textContent ?? null);
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("finals-outfit.discovery") ?? "{}"));
const otherKeys = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort()
  .filter(key => !["finals-outfit.discovery", "finals-outfit.hints", "finals-outfit.drawer", "tfo:patch-notes-seen"].includes(key))
  .map(key => [key, localStorage.getItem(key)])));
const outfitCount = page => page.evaluate(() => new Promise(resolve => {
  const request = indexedDB.open("finals-outfit");
  request.onerror = () => resolve(-1);
  request.onsuccess = () => {
    const db = request.result;
    const names = [...db.objectStoreNames];
    if (!names.length) { resolve(0); return; }
    const tx = db.transaction(names, "readonly");
    let total = 0, left = names.length;
    for (const name of names) { const count = tx.objectStore(name).count(); count.onsuccess = () => { total += count.result; if (!--left) resolve(total); }; }
  };
}));

// 1. Start, desktop.
let { context, page, errors } = await open();
await shot(page, "1-builder");
const row = await page.evaluate(() => [...document.querySelectorAll("[data-viewer] [data-feature]")].slice(0, 6).map(e => e.dataset.feature));
check(1, "top row: instant actions, then the four panels", row.join(",").startsWith("full-screen,hide-ui,graphics,capture,camera,lighting"), row.join(","));
const fresh = await page.evaluate(() => [...document.querySelectorAll("[data-fresh]")].map(e => e.dataset.feature));
check(1, "at most three red corners", fresh.length > 0 && new Set(fresh).size <= 3, fresh.join(","));
const titles = await page.evaluate(() => document.querySelectorAll("[data-feature][title]").length);
check(1, "no native tooltip doubles a callout", titles === 0, String(titles));
const before = { keys: await otherKeys(page), outfits: await outfitCount(page) };

// 2. Approach callout.
const capture = await page.locator("[data-feature=capture]").boundingBox();
await page.mouse.move(capture.x - 80, capture.y + 120, { steps: 3 });
await page.mouse.move(capture.x + capture.width / 2, capture.y + capture.height + 18, { steps: 6 });
await page.waitForTimeout(500);
let callout = await page.evaluate(() => document.getElementById("discovery-callout")?.textContent ?? "");
check(2, "a callout comes up 18 px from Capture, before touching it", /Capture/.test(callout) && /PNG/.test(callout), callout);
await shot(page, "2-approach-capture");
await page.mouse.move(capture.x - 200, capture.y + 400, { steps: 4 });
await page.waitForTimeout(500);
check(2, "and goes when the pointer leaves", !(await page.evaluate(() => !!document.getElementById("discovery-callout"))));
await page.locator("[data-feature=capture]").click();
await page.waitForTimeout(400);
const header = await page.evaluate(() => document.querySelector("[role=group][aria-label=Capture] .hud")?.textContent);
check(2, "Capture opens with the shared panel header", header === "Capture", String(header));
await shot(page, "2-capture-panel");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.mouse.move(capture.x + capture.width / 2, capture.y + capture.height + 18, { steps: 4 });
await page.waitForTimeout(700);
check(2, "once used, the approach no longer calls it", !(await page.evaluate(() => !!document.getElementById("discovery-callout"))));
await page.mouse.move(capture.x + capture.width / 2, capture.y + capture.height / 2, { steps: 4 });
await page.waitForTimeout(900);
check(2, "a direct hover still names it", /Capture/.test(await page.evaluate(() => document.getElementById("discovery-callout")?.textContent ?? "")));
await page.mouse.move(700, 600);

// 3. Keyboard focus.
await page.locator("[data-feature=camera]").focus();
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const focus = await page.evaluate(() => ({ described: document.activeElement?.getAttribute("aria-describedby"), text: document.getElementById("discovery-callout")?.textContent, role: document.getElementById("discovery-callout")?.getAttribute("role") }));
check(3, "keyboard focus shows the callout as the control's description", focus.described === "discovery-callout" && focus.role === "tooltip" && /Camera/.test(focus.text ?? ""), JSON.stringify(focus));
await shot(page, "3-focus-camera");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check(3, "Esc dismisses it", !(await page.evaluate(() => !!document.getElementById("discovery-callout"))));

// 4. Tour.
await page.mouse.click(1000, 600);
await page.locator("[data-feature=guide]").click();
await page.waitForTimeout(400);
await shot(page, "4-guide");
await page.locator("#feature-guide button", { hasText: /tour/i }).first().click();
await page.waitForTimeout(1000);
const names = [];
for (let i = 0; i < 12; i++) {
  const name = await tourName(page);
  if (!name) break;
  names.push(name);
  await shot(page, `4-tour-${i + 1}`);
  if (i === 1) { // the page stays usable: a press goes through the dim
    const before = await page.evaluate(() => document.querySelector("[aria-label='Cosmetic slots'] button[aria-current=true]")?.textContent);
    await page.locator("[aria-label='Cosmetic slots'] button", { hasText: "Eyes" }).click();
    const after = await page.evaluate(() => document.querySelector("[aria-label='Cosmetic slots'] button[aria-current=true]")?.textContent);
    check(4, "the page under the tour still works", before !== after && /Eyes/.test(after ?? ""), `${before} → ${after}`);
    await page.locator("#tour-name").waitFor();
    await page.getByRole("button", { name: "Next", exact: true }).focus();
  }
  if (i === 3) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(4, "Esc stops the tour where it is", !(await tourName(page)) && (await stored(page)).tour?.status === "paused");
    await page.locator("[data-feature=guide]").click();
    await page.waitForTimeout(400);
    const label = await page.locator("#feature-guide button", { hasText: /tour/i }).first().textContent();
    check(4, "the Guide offers to resume from that stop", /Resume the tour/.test(label) && /Stop 4 of 9/.test(label), label);
    await shot(page, "4-guide-resume");
    await page.locator("#feature-guide button", { hasText: /tour/i }).first().click();
    await page.waitForTimeout(1000);
    check(4, "and resumes there", (await tourName(page)) === name, await tourName(page));
  }
  await page.keyboard.press(i === 5 ? "Enter" : "ArrowRight");
  await page.waitForTimeout(800);
}
check(4, "nine stops, in order", names.join(",") === "Items,In-game outfits,Saved outfits,Share outfit,Emotes,Lighting,Capture,Camera,Hide controls", names.join(","));
check(4, "finishing records it as done", (await stored(page)).tour?.status === "done");
await page.locator("[data-feature=guide]").click();
await page.waitForTimeout(400);
check(4, "the Guide then offers a replay", /Replay the tour/.test(await page.locator("#feature-guide button", { hasText: /tour/i }).first().textContent()));

// 5. Show me.
await page.locator("#feature-guide button[aria-label^='Show me Camera']").click();
await page.waitForTimeout(900);
const shown = await page.evaluate(() => ({ text: [...document.querySelectorAll("[role=status].fixed")].map(e => e.textContent).join(" | "), frame: !!document.querySelector(".brackets.fixed") }));
check(5, "Show me frames the control and names it", shown.frame && /Camera/.test(shown.text ?? ""), JSON.stringify(shown));
await shot(page, "5-show-camera");
await page.waitForTimeout(5000);
check(5, "and lets go by itself", !(await page.evaluate(() => !!document.querySelector(".brackets.fixed"))));

// 6. Nudges.
await page.locator("[data-feature=emotes]").click();
await page.waitForTimeout(600);
await page.locator("[role=dialog][aria-label=Emotes] button.group").nth(3).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(3000);
let nudge = await page.evaluate(() => [...document.querySelectorAll("[role=status].fixed")].map(e => e.textContent).join(" | "));
check(6, "a first emote shows the frame-by-frame keys", /Frame by frame/.test(nudge), nudge);
await shot(page, "6-nudge-keys");
await page.locator("[data-feature=timeline] button[aria-label=Pause]").click();
await page.waitForTimeout(800);
nudge = await page.evaluate(() => [...document.querySelectorAll("[role=status].fixed")].map(e => e.textContent).join(" | "));
check(6, "pausing it brings the share-this-pose nudge", /Share this pose/.test(nudge), nudge);
await shot(page, "6-nudge-share");
await page.waitForTimeout(2000);

// 7. Persistence: reload keeps what was found and the tour's state; nothing else stored changed.
const found = await stored(page);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(1500);
const again = await stored(page);
check(7, "tried controls and the tour's state survive a reload", JSON.stringify(found) === JSON.stringify(again) && again.tour?.status === "done");
await page.locator("[data-feature=timeline] button[aria-label=Pause]").click().catch(() => {});
await page.locator("[data-feature=emotes]").click();
await page.waitForTimeout(500);
await page.locator("[role=dialog][aria-label=Emotes] button.group").nth(5).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(2500);
await page.locator("[data-feature=timeline] button[aria-label=Pause]").click().catch(() => {});
await page.waitForTimeout(800);
check(7, "a nudge already had does not come back", !(await page.evaluate(() => [...document.querySelectorAll("[role=status].fixed")].some(e => /Share this pose|Frame by frame/.test(e.textContent)))));
const after = { keys: await otherKeys(page), outfits: await outfitCount(page) };
const changed = Object.keys({ ...before.keys, ...after.keys }).filter(key => before.keys[key] !== after.keys[key]);
// Playing emotes may store emote preferences, and the Auto graphics measurer stores what it measured: both are the app's
// own doing. Anything else changing, or the saved outfits, would be the guide or the tour touching a visitor's work.
const ownDoing = key => /emote|anim|speed/i.test(key) || (key === "finals-outfit.graphics"
  && JSON.stringify({ ...JSON.parse(before.keys[key] ?? "{}"), auto: 0 }) === JSON.stringify({ ...JSON.parse(after.keys[key] ?? "{}"), auto: 0 }));
check(7, "saved outfits and every other stored setting are untouched by the guide and the tour",
  after.outfits === before.outfits && changed.every(ownDoing),
  `outfits ${before.outfits}→${after.outfits}; changed: ${changed.map(key => `${key} ${before.keys[key]} → ${after.keys[key]}`).join("; ") || "none"}`);
check(7, "no page errors", errors.length === 0, errors.join(" | "));
await context.close();

// 8. Phone: no pointer callouts; tour and Show me open the closed sheet.
({ context, page, errors } = await open({ width: 390, height: 844, mobile: true }));
await page.locator("button[aria-label='Hide items']").click().catch(() => {});
await page.waitForTimeout(400);
await shot(page, "8-phone-closed");
const outfits = await page.locator("[data-feature=in-game-outfits]").first().boundingBox();
check(8, "the items sheet starts closed for this step", !outfits || outfits.height === 0);
await page.locator("[data-feature=guide]").click();
await page.waitForTimeout(400);
await shot(page, "8-phone-guide");
await page.locator("#feature-guide button[aria-label^='Show me In-game outfits']").click();
await page.waitForTimeout(1200);
const phoneShown = await page.evaluate(() => ({ text: [...document.querySelectorAll("[role=status].fixed")].map(e => e.textContent).join(" | "), open: document.querySelector("button[aria-label='Hide items']") !== null }));
check(8, "Show me opens the sheet and frames the control", phoneShown.open && /In-game outfits/.test(phoneShown.text ?? ""), JSON.stringify(phoneShown));
await shot(page, "8-phone-show");
await page.waitForTimeout(5000);
await page.locator("[data-feature=capture]").tap();
await page.waitForTimeout(500);
check(8, "a tap opens a panel with no callout over it", !(await page.evaluate(() => !!document.getElementById("discovery-callout"))));
await shot(page, "8-phone-capture");
check(8, "no page errors", errors.length === 0, errors.join(" | "));
await context.close();

// 9. Reduced motion.
({ context, page, errors } = await open({ reducedMotion: "reduce" }));
await page.locator("[data-feature=lighting]").click();
await page.waitForTimeout(200);
const motion = await page.evaluate(() => getComputedStyle(document.querySelector("[role=group][aria-label='Lighting and backdrop']")).animationName);
check(9, "panels open without the drop", motion === "none", motion);
await page.keyboard.press("Escape");
await page.locator("[data-feature=guide]").click();
await page.locator("#feature-guide button", { hasText: /tour/i }).first().click();
await page.waitForTimeout(800);
const spot = await page.evaluate(() => getComputedStyle(document.querySelector(".brackets.fixed")).transitionDuration);
check(9, "the tour's frame jumps instead of gliding", parseFloat(spot) < 0.01, spot);
await context.close();

// 10. Automation: harness scripts see the builder as before.
({ context, page, errors } = await open({ visitor: false }));
const automated = await page.evaluate(() => ({
  fresh: document.querySelectorAll("[data-fresh]").length,
  lightingTitle: !!document.querySelector("button[title='Lighting and backdrop']"),
  layer: !!document.querySelector(".brackets.fixed, #discovery-callout"),
  dialog: !!document.querySelector("dialog[open]"),
}));
check(10, "no corners, callouts or welcome dialog; titles the scripts use are kept",
  automated.fresh === 0 && automated.lightingTitle && !automated.layer && !automated.dialog, JSON.stringify(automated));
await context.close();

// 11. Storage that refuses every write.
({ context, page, errors } = await open({ storage: "broken" }));
await page.locator("[data-feature=guide]").click();
await page.locator("#feature-guide button", { hasText: /tour/i }).first().click();
await page.waitForTimeout(800);
const first = await tourName(page);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(800);
check(11, "with storage refusing writes the tour still runs", first === "Items" && (await tourName(page)) === "In-game outfits");
check(11, "no page errors", errors.length === 0, errors.join(" | "));
await context.close();

await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify({ url, when: new Date().toISOString(), checks }, null, 2));
const failed = checks.filter(c => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} pass`);
process.exitCode = failed.length ? 1 : 0;
