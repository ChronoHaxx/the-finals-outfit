// Emote picker captures (5 Nov 2026): the thumbnail picker on desktop and phone widths, a search, the "complete only"
// filter, the More tab, and a prop emote playing with the picker closed (its "Not shown" line). Full-size PNGs for
// review by eye, plus how many thumbnails the open picker actually downloaded (they load lazily).
//
//   node scripts/anim-export/capture-picker.mjs [--out=<dir>]   (Git Bash or PowerShell, worktree root; dev server 5181)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5181";
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "scripts/generated/anim-export/captures/picker");
mkdirSync(OUT, { recursive: true });
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}
const browser = await launch();
const report = {};
for (const [name, options] of Object.entries({
  desktop: { viewport: { width: 1600, height: 1000 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})) {
  const page = await browser.newPage(options);
  const errors = [], icons = new Set();
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("request", r => { if (r.url().includes("/icons/")) icons.add(r.url()); });
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&anim=outfit-idle`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && window.__rigAnim.state().moving", null, { timeout: 180000 });
  const shot = async file => { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${name}-${file}.png`) }); };
  const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] img')].slice(0, 12).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
  await shot("1-open");
  const opened = icons.size;
  await dialog.getByRole("searchbox").fill("disco");
  await shot("2-search-disco");
  await dialog.getByRole("searchbox").fill("");
  await dialog.getByRole("button", { name: "Complete only" }).click();
  await shot("3-complete-only");
  await dialog.getByRole("button", { name: "Complete only" }).click();
  await dialog.getByRole("button", { name: /Valkyria/ }).click();
  await page.waitForFunction(() => window.__rigAnim.state().current === "ace-pilot", null, { timeout: 30000 });
  await page.waitForTimeout(2200);
  await shot("4-playing-in-picker");
  await dialog.getByRole("button", { name: "More" }).click();
  await shot("5-more-tab");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.evaluate(() => window.__rigAnim.play("mariachi-guitar"));
  await page.waitForTimeout(3000);
  await shot("6-closed-prop-emote");
  report[name] = { iconsOnOpen: opened, iconsTotal: icons.size, errors: [...new Set(errors)],
    focusAfterClose: await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40)) };
  console.log(name, report[name]);
  await page.close();
}
await browser.close();
writeFileSync(join(OUT, "picker-report.json"), JSON.stringify(report, null, 2));
console.log(`done -> ${OUT}`);
