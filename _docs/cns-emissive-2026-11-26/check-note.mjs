// Checklist step: the Facewear picker tile for military-rebreather-rubber-cns carries the new review note.
//   node _docs/cns-emissive-2026-11-26/check-note.mjs <base> <out.png>
// Equips the item through the outfit link (viewerUrl adds reconstructed=1), opens the Facewear slot, reads the
// equipped tile's status badge (title, aria-label, data-reconstruction-status) and screenshots the tile row.
import { chromium } from "playwright-core";
import { viewerUrl } from "../../scripts/visual-diff/viewer-url.mjs";

const [base, shot] = process.argv.slice(2);
const enc = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(viewerUrl(base, `outfit=${enc({ face: "head-face-23-base", facewear: "military-rebreather-rubber-cns" })}`),
    { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 120000 });
  await page.getByRole("navigation", { name: "Cosmetic slots" }).getByRole("button", { name: /^Facewear/ }).click();
  const tile = page.locator('button[aria-pressed="true"]').filter({ has: page.locator("[data-reconstruction-status]") }).first();
  await tile.waitFor({ state: "visible", timeout: 30000 });
  const badge = tile.locator("[data-reconstruction-status]");
  const result = {
    tileTitle: await tile.getAttribute("title"),
    status: await badge.getAttribute("data-reconstruction-status"),
    ariaLabel: await badge.getAttribute("aria-label"),
    errors,
  };
  await tile.scrollIntoViewIfNeeded();
  if (shot) await tile.screenshot({ path: shot });
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close();
}
