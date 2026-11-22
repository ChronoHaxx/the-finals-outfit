// Phase 2 checklist, run by the agent on a production build (22 Nov 2026, under the owner's standing waiver of manual
// checks). Drives the squad page as a visitor would (automation flag masked, so the idle plays and stored lighting is
// used), through the page's own buttons only, and records what each checklist step shows:
//   1. the flag: #/squad is closed until ?preview=on, which then sticks; a visit makes no squad ("No squad yet");
//   2. the builder's outfit (Fnatic jersey, number 45) joins; then the same outfit after pressing Own (its own 32);
//   3. a saved outfit (a new starting outfit) joins from the saved-outfit list; one loads at a time; the cap;
//   4. saved outfits are byte-for-byte unchanged by everything done on the squad page;
//   5. a reload keeps the squad; Remove + Undo; Delete squad (none left) + Undo (no stray squad); New squad;
//   6. the Lobby look (chosen in the builder) on the squad page;
//   7. a phone (coarse pointer) shows two of the three and keeps the third.
// Usage (Git Bash or PowerShell, worktree root; production server:
//   VITE_SCENES_BASE=<deploy.yml SCENES_BASE> node _docs/igpu-perf-2026-11-21/serve-like-deploy.mjs):
//   node _docs/multi-character-2026-11-11/squad-prod-check.mjs <outdir>
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2] ?? "squad-prod-check-out";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5195";
const JERSEY = "2.36o.81qz.a1bl.cct"; // Fnatic Jersey + Hedge Hunter Cargos (PR #60's checklist outfit)
const results = {};
const log = (what, value) => { results[what] = value; console.log(`${what}: ${JSON.stringify(value)}`); };
const pause = (page, ms) => page.waitForTimeout(ms);

const visitor = async (browser, options) => {
  const context = await browser.newContext(options);
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(String(e)));
  return { context, page };
};
const enter = async page => {
  const intro = page.getByRole("button", { name: /^(Enter builder|View shared outfit)$/ });
  await pause(page, 1500);
  if (await intro.count()) await intro.first().click();
};
const rigIdle = page => page.waitForFunction("window.__rigIdle === true", null, { timeout: 300000 });
const squadIdle = (page, n) => page.waitForFunction(count => window.__squadIdle === true && window.__squad?.members().length === count,
  n, { timeout: 300000 });
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await pause(page, 600); };
const names = page => page.locator('[aria-label="Contestants"] p.truncate').allTextContents();
const counter = page => page.locator('[aria-label="Contestants"] p.hud').first().textContent();
const squadName = page => page.locator('select[aria-label="Squad"] option:checked').textContent();
const shot = (page, name) => page.locator("[data-viewer] canvas").first().screenshot({ path: path.join(OUT, name) });
// Every saved outfit record as stored (IndexedDB finals-outfit/outfits), for a byte-for-byte comparison.
const savedOutfits = page => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("finals-outfit");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, all = db.transaction("outfits", "readonly").objectStore("outfits").getAll();
    all.onsuccess = () => { db.close(); resolve(all.result.sort((a, b) => (a.id < b.id ? -1 : 1))); };
    all.onerror = () => reject(all.error);
  };
}));
// Adds through a button and watches the panel: how many contestants say "Loading…" at once, and the overlay's text.
async function addAndWatch(page, click, count) {
  await click();
  let most = 0, overlay = null;
  for (let i = 0; i < 1200; i++) {
    const states = await page.locator('[aria-label="Contestants"] .hud.text-fg-dim').allTextContents();
    most = Math.max(most, states.filter(s => s === "Loading…").length);
    const shown = page.getByText(/Loading contestant \d+ of \d+/).first();
    if (!overlay && await shown.isVisible().catch(() => false)) overlay = await shown.textContent().catch(() => null);
    if (await page.evaluate(n => window.__squadIdle === true && window.__squad?.members().length === n, count)) break;
    await pause(page, 250);
  }
  await squadIdle(page, count);
  return { mostLoadingAtOnce: most, overlay };
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true });
const { context, page } = await visitor(browser, { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });

// 1. The flag.
await page.goto(`${BASE}/#/squad`, { waitUntil: "load", timeout: 300000 });
await page.getByText("Not open yet.").waitFor({ timeout: 60000 }).catch(() => undefined);
log("1 without the flag: closed page", await page.getByText("Not open yet.").isVisible());
await page.goto(`${BASE}/#/squad?preview=on`, { waitUntil: "load" });
await page.getByText("Contestants · 0 / 3").waitFor({ timeout: 60000 });
log("1 ?preview=on: squad and counter", [await squadName(page), await counter(page)]);
await page.goto(`${BASE}/#/squad`, { waitUntil: "load" });
await page.getByText("Contestants · 0 / 3").waitFor({ timeout: 60000 });
log("1 flag kept after reopening #/squad", true);

// 2. The builder's outfit, with 45; then the same outfit with its own number.
await page.goto(`${BASE}/#/?o=${JERSEY}`, { waitUntil: "load" });
await enter(page);
await rigIdle(page);
await page.getByLabel("Player number, 10 to 99").fill("45");
await page.getByLabel("Player number, 10 to 99").press("Enter");
await pause(page, 1200);
await go(page, "#/squad");
log("2 add the builder's outfit (45)", await addAndWatch(page, () => page.getByRole("button", { name: "Add the builder’s outfit" }).click(), 1));
await go(page, "#/");
await rigIdle(page);
await page.getByRole("button", { name: "Own", exact: true }).click();
await pause(page, 1200);
await go(page, "#/squad");
log("2 add it again after Own", await addAndWatch(page, () => page.getByRole("button", { name: "Add the builder’s outfit" }).click(), 2));
log("2 names", await names(page));

// 3. A saved outfit from the list: a new starting outfit made in the builder.
await go(page, "#/");
await rigIdle(page);
const before = await savedOutfits(page);
await page.getByRole("button", { name: /^Saved outfits:/ }).click();
await page.getByRole("button", { name: "New outfit" }).click();
await rigIdle(page);
await pause(page, 1200);
const withNew = await savedOutfits(page);
const fresh = withNew.find(record => !before.some(old => old.id === record.id));
log("3 saved outfits before / after New outfit", [before.map(r => r.name), withNew.map(r => r.name)]);
await go(page, "#/squad");
await page.locator('select[aria-label="Saved outfit"]').selectOption(fresh.id);
log("3 add the saved outfit", await addAndWatch(page, () => page.getByRole("button", { name: "Add", exact: true }).click(), 3));
log("3 names, counter", [await names(page), await counter(page)]);
log("3 at the cap: buttons disabled, message", [
  await page.getByRole("button", { name: "Add the builder’s outfit" }).isDisabled(),
  await page.locator('select[aria-label="Saved outfit"]').isDisabled(),
  await page.getByText("A squad holds up to 3 contestants").isVisible()]);
await pause(page, 2500);
await shot(page, "1-squad-studio.png");
const frameA = await page.locator("[data-viewer] canvas").first().screenshot();
await pause(page, 700);
const frameB = await page.locator("[data-viewer] canvas").first().screenshot();
log("3 idle playing (two frames 0.7 s apart differ)", !frameA.equals(frameB));

// 4. Saved outfits untouched by the squad page.
const afterSquad = await savedOutfits(page);
log("4 saved outfits unchanged by the squad page", JSON.stringify(afterSquad) === JSON.stringify(withNew));

// 5. Reload, Remove + Undo, Delete squad + Undo, New squad.
await page.reload({ waitUntil: "load" });
await squadIdle(page, 3);
log("5 after reload", [await squadName(page), await names(page)]);
const last = (await names(page))[2];
await page.getByRole("button", { name: `Remove ${last}` }).click();
log("5 after Remove", await names(page));
await page.getByRole("button", { name: "Undo" }).click();
await squadIdle(page, 3);
log("5 after Undo", await names(page));
const squadOne = await squadName(page);
await page.getByRole("button", { name: "Delete squad" }).click();
await pause(page, 500);
log("5 after Delete squad: shown squad, counter, squads", [await squadName(page), await counter(page),
  await page.locator('select[aria-label="Squad"] option').allTextContents()]);
await page.getByRole("button", { name: "Undo" }).click();
await squadIdle(page, 3);
log("5 after Undo: squad, names, squads", [await squadName(page), await names(page),
  await page.locator('select[aria-label="Squad"] option').allTextContents()]);
await page.getByRole("button", { name: "New", exact: true }).click();
await pause(page, 500);
log("5 New squad: name, counter", [await squadName(page), await counter(page)]);
await page.locator('select[aria-label="Squad"]').selectOption({ label: squadOne });
await squadIdle(page, 3);
log("5 back to the first squad", [await squadName(page), (await names(page)).length]);

// 6. The Lobby look, chosen in the builder.
await go(page, "#/");
await rigIdle(page);
log("6 builder outfit and saved outfits after the squad visit", [
  await page.getByRole("button", { name: /^Saved outfits:/ }).getAttribute("aria-label"),
  JSON.stringify(await savedOutfits(page)) === JSON.stringify(withNew)]);
await page.getByTitle("Lighting and backdrop").click();
await page.getByRole("button", { name: "Lobby", exact: true }).click();
await page.getByTitle("Lighting and backdrop").click();
await go(page, "#/squad");
await squadIdle(page, 3);
await pause(page, 3000);
await shot(page, "2-squad-lobby.png");
log("6 desktop page errors", page.errors);
await context.close();

// 7. A phone: two shown, the third kept.
const phone = await visitor(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.page.goto(`${BASE}/#/`, { waitUntil: "load", timeout: 300000 });
await enter(phone.page);
await rigIdle(phone.page);
log("7 coarse pointer", await phone.page.evaluate(() => matchMedia("(pointer: coarse)").matches));
await phone.page.goto(`${BASE}/#/squad?preview=on`, { waitUntil: "load" });
await phone.page.getByText("Contestants · 0 / 3").waitFor({ timeout: 60000 });
const addButton = phone.page.getByRole("button", { name: "Add the builder’s outfit" });
await addAndWatch(phone.page, () => addButton.click(), 1);
await addAndWatch(phone.page, () => addButton.click(), 2);
await addButton.click();
await pause(phone.page, 1500);
await squadIdle(phone.page, 2);
log("7 phone: counter, rows shown, note, cap message", [await counter(phone.page), (await names(phone.page)).length,
  await phone.page.getByText("1 more kept in this squad for a larger screen.").isVisible(),
  await phone.page.getByText("this screen shows 2").isVisible()]);
log("7 phone: JS heap (MB) with two shown", await phone.page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
await pause(phone.page, 2500);
await phone.page.screenshot({ path: path.join(OUT, "3-phone.png") });
log("7 phone page errors", phone.page.errors);
await phone.context.close();
await browser.close();
writeFileSync(path.join(OUT, "squad-prod-check.json"), JSON.stringify(results, null, 2));
