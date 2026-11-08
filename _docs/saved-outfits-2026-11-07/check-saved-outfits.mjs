// Real-browser check of saved outfits (7 Nov 2026). Serve the app, then:
//   OUTFIT_URL=http://localhost:5191/ node _docs/saved-outfits-2026-11-07/check-saved-outfits.mjs <screenshot-folder>
// Drives headless Chrome (playwright-core, channel "chrome") through the loss paths; writes screenshots there.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("playwright-core");

const BASE = process.env.OUTFIT_URL ?? "http://localhost:5191/";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const switcher = page => page.getByRole("button", { name: /^Saved outfits:/ });
const ready = async page => { await switcher(page).waitFor({ timeout: 90_000 }); await page.waitForTimeout(500); };
const nameOf = async page => (await switcher(page).getAttribute("aria-label")).replace("Saved outfits: ", "");
const store = page => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("finals-outfit"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await new Promise(res => { const q = db.transaction("outfits").objectStore("outfits").getAll(); q.onsuccess = () => res(q.result); });
  db.close();
  return { all, journal: Object.keys(localStorage).filter(k => k.startsWith("finals-outfit:journal:")) };
});
const live = s => s.all.filter(r => r.deletedAt === undefined);
const equipped = page => page.locator('section[aria-label="Your outfit"] li').allInnerTexts();

try {
  // ---------------------------------------------------------------- desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(BASE);
  await ready(page);
  check("first visit names the outfit Outfit 1", (await nameOf(page)) === "Outfit 1");
  await page.getByRole("button", { name: /Afro Fade Black$/i }).click();
  const journalNow = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("finals-outfit:journal:")).length);
  check("an edit is journaled synchronously, before the debounced write", journalNow === 1, `journal keys: ${journalNow}`);
  // Kill: crash the renderer before the debounce fires. No pagehide, no flush.
  const cdp = await ctx.newCDPSession(page);
  const settle = (promise, ms) => Promise.race([promise.catch(() => {}), new Promise(resolve => setTimeout(resolve, ms))]);
  await settle(cdp.send("Page.crash"), 2000); // a crashed renderer never answers
  await settle(page.close(), 3000);
  page = await ctx.newPage();
  await page.goto(BASE);
  await ready(page);
  const afterCrash = (await equipped(page)).join(" | ");
  check("after a renderer crash the last edit is back", /AFRO FADE BLACK/i.test(afterCrash), afterCrash.slice(0, 80));
  let s = await store(page);
  check("the journal replayed into IndexedDB and settled", live(s).length === 1 && /afro/i.test(live(s)[0]?.slots.hair ?? "") && s.journal.length === 0,
    `records ${live(s).length}, hair ${live(s)[0]?.slots.hair}, journal ${s.journal.length}`);

  // Randomise keeps the hand-made outfit.
  await page.getByRole("button", { name: "Randomise", exact: true }).click();
  await page.waitForTimeout(400);
  check("Randomise over a hand-made outfit starts Random 1", (await nameOf(page)) === "Random 1");
  const toast = page.getByRole("status").filter({ hasText: "is kept" });
  check("the toast says the old outfit is kept", await toast.isVisible());
  await page.screenshot({ path: `${OUT}/desktop-randomise-toast.png` });
  // Share link of the roll, then Undo the roll.
  await page.getByRole("button", { name: /Share outfit|^Share$/ }).first().click();
  const link = await page.getByLabel("Outfit share link").inputValue();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  check("Undo goes back to Outfit 1", (await nameOf(page)) === "Outfit 1");
  s = await store(page);
  check("the undone roll is a tombstone, Outfit 1 untouched", live(s).length === 1 && s.all.length === 2,
    `live ${live(s).length}, stored ${s.all.length}`);

  // A share link opens as a draft.
  await page.goto(link);
  await ready(page);
  await page.waitForTimeout(500);
  check("a share link opens as an unsaved draft", (await nameOf(page)) === "Shared outfit"
    && await page.getByText("Not saved", { exact: true }).isVisible());
  s = await store(page);
  check("opening the link saved nothing and kept Outfit 1", live(s).length === 1 && /afro/.test(live(s)[0].slots.hair ?? ""));
  check("the link stays in the address bar while it is a draft", page.url().includes("o=2."));
  await page.reload();
  await ready(page);
  check("a reload shows the same draft", (await nameOf(page)) === "Shared outfit");
  await page.getByRole("button", { name: /Afro Fade Red$/i }).click();
  await page.waitForTimeout(800);
  s = await store(page);
  check("the first edit saves the draft as its own outfit", live(s).length === 2 && live(s).some(r => r.name === "Shared outfit"));
  check("…and the link leaves the address bar", !page.url().includes("o="), page.url());
  await page.reload();
  await ready(page);
  check("a reload now restores the saved Shared outfit", (await nameOf(page)) === "Shared outfit"
    && /AFRO FADE RED/i.test((await equipped(page)).join(" ")));

  // Panel: rename, duplicate, delete + undo.
  await switcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Saved outfits" });
  await dialog.waitFor();
  await page.waitForTimeout(900); // let the rise-in animation finish
  await page.screenshot({ path: `${OUT}/desktop-panel.png` });
  await dialog.getByRole("button", { name: "Rename Shared outfit" }).click();
  await dialog.getByLabel("Outfit name").fill("Night shift");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("rename", (await nameOf(page)) === "Night shift");
  await dialog.getByRole("button", { name: "Duplicate Night shift" }).click();
  await page.waitForTimeout(300);
  check("duplicate switches to the copy", (await nameOf(page)) === "Night shift copy");
  if (!(await dialog.isVisible())) await switcher(page).click(); // Duplicate leaves the panel open
  await dialog.getByRole("button", { name: "Delete Night shift copy" }).click();
  await page.waitForTimeout(300);
  check("deleting the current outfit switches away", (await nameOf(page)) !== "Night shift copy");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(500);
  check("Undo restores the deleted outfit", (await nameOf(page)) === "Night shift copy");
  s = await store(page);
  check("three live outfits stored", live(s).length === 3, live(s).map(r => r.name).join(", "));

  // A catalogue change under a saved outfit.
  await page.evaluate(async () => {
    const db = await new Promise(res => { const r = indexedDB.open("finals-outfit"); r.onsuccess = () => res(r.result); });
    await new Promise(res => { const tx = db.transaction("outfits", "readwrite");
      tx.objectStore("outfits").put({ v: 1, id: "stale-test", rev: 1, name: "Old look", createdAt: 1, updatedAt: 1,
        slots: { face: "head-face-01-base", feet: "retired-boots-zzz", wrist: "retired-watch-zzz" },
        labels: { "retired-boots-zzz": "Retired Boots" }, future: { keep: true } });
      tx.oncomplete = res; });
    db.close();
    sessionStorage.setItem("finals-outfit:tab-current", "stale-test");
  });
  await page.reload();
  await ready(page);
  const missingNote = page.getByText(/saved pieces aren’t shown/);
  check("missing pieces are named", await missingNote.isVisible() && /Retired Boots/.test(await missingNote.innerText()));
  await page.screenshot({ path: `${OUT}/desktop-missing.png` });
  await page.getByRole("button", { name: /Afro Fade$/i }).click();
  await page.waitForTimeout(800);
  s = await store(page);
  const stale = s.all.find(r => r.id === "stale-test");
  check("an edit keeps the missing pieces and unknown fields", stale.slots.feet === "retired-boots-zzz" && stale.slots.wrist === "retired-watch-zzz"
    && stale.future?.keep === true && !!stale.slots.hair, JSON.stringify(stale.slots));

  // Two tabs: the idle tab follows the other's change.
  const other = await ctx.newPage();
  await other.goto(BASE);
  await ready(other);
  await page.getByRole("button", { name: /Afro Fade Blonde$/i }).click();
  await page.waitForTimeout(1200);
  check("an idle second tab picks up the change", /AFRO FADE BLONDE/i.test((await equipped(other)).join(" ")),
    (await equipped(other)).join(" | ").slice(0, 60));
  await other.close();
  await ctx.close();

  // ---------------------------------------------------------------- phone
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  await p.goto(BASE);
  await ready(p);
  await p.getByRole("button", { name: /Afro Fade Black$/i }).click();
  await switcher(p).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/phone-bar.png` });
  await p.getByRole("button", { name: "Randomise", exact: true }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/phone-toast.png` });
  await switcher(p).click();
  await p.getByRole("dialog", { name: "Saved outfits" }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/phone-panel.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no horizontal overflow at phone width", overflow <= 0, `overflow ${overflow}px`);
  await phone.close();

  // ---------------------------------------------------------------- storage blocked
  const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blocked.addInitScript(() => {
    const deny = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    for (const name of ["indexedDB", "localStorage", "sessionStorage"]) Object.defineProperty(window, name, { get: deny, configurable: true });
  });
  const b = await blocked.newPage();
  const errors = [];
  b.on("pageerror", e => errors.push(String(e)));
  await b.goto(BASE);
  await ready(b);
  check("blocked storage: the app runs and says saving is off", await b.getByText("Saving off", { exact: true }).isVisible());
  await b.getByRole("button", { name: /Afro Fade Black$/i }).click();
  await b.waitForTimeout(300);
  check("blocked storage: edits still work", /AFRO FADE BLACK/i.test((await equipped(b)).join(" ")));
  await switcher(b).click();
  await b.waitForTimeout(400);
  await b.screenshot({ path: `${OUT}/blocked-panel.png` });
  check("blocked storage: no page errors", errors.length === 0, errors.join("; "));
  await blocked.close();
} catch (error) {
  console.error(error);
  results.push({ name: "script", ok: false, detail: String(error) });
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
