// The picker's new sections, by eye (21 Nov 2026): global mode scrolled to Season 1, Chinals mode to Uncategorised.
// node _docs/all-emotes-2026-11-21/capture-picker-groups.mjs <base> <out dir>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [mode, section, hash] of [["global", "Season 1", ""], ["global-s2", "Season 2", ""], ["chinals", "Uncategorised", "#/chinals"]]) {
  await page.goto(`${base}/?reconstructed=1${hash}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
  await page.getByRole("button", { name: /emotes/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  const target = dialog.locator(`section[aria-label="${section}"]`);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500); // lazy thumbnails
  await dialog.screenshot({ path: join(out, `${mode}.png`) });
  console.log(mode, await dialog.locator("h3").allInnerTexts());
}
await browser.close();
