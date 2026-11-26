// Light unflag-bar check (26 Nov 2026, temporary): the starting outfit and 5 whole-on-site presets on Light, on current
// main (5175, archetypes=on). Records the class notice (pieces "Not on Light yet") and a full-body shot per outfit.
// Same wait, notice and canvas handling as scripts/archetypes/capture-classes.mjs.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:5175";
const url = (slots, archetype, cam) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam}&fov=28&archetypes=on`;
const CAM = "0,0.95,5.2,0,0.95,0";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
await page.goto(`${BASE}/?reconstructed=1&archetypes=on`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
const outfits = await page.evaluate(async () => {
  const P = await import("/src/lib/preset-outfits.ts"), B = await import("/src/store/useBuildStore.ts");
  const start = B.startingOutfit(), data = await P.loadPresetOutfits();
  const whole = data.outfits.filter(o => { const c = P.presetCoverage(P.presetPieces(o)); return c.wearable > 2 && c.worn === c.wearable; });
  const pick = [];
  for (const season of [12, 10, 8, 5, 1]) { const o = whole.find(x => x.season === season && !pick.includes(x)); if (o) pick.push(o); }
  return [{ id: "starting-outfit", name: "Starting outfit", slots: start },
    ...pick.map(o => ({ id: o.id, name: o.name, season: o.season, slots: P.presetSlots(o, start) }))];
});
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const o of outfits) for (const archetype of ["light", "medium"]) {
  errors = [];
  await page.goto(url(o.slots, archetype, CAM), { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
  const notice = await page.evaluate(() => document.querySelector('[data-class-notice]')?.textContent ?? null);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas"); const host = canvas?.parentElement?.parentElement;
    if (!host) throw new Error("Viewer canvas not found");
    for (let el = canvas; el && el !== document.body; el = el.parentElement)
      for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
    Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999", background: "#d3d8df" });
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(2500);
  const file = path.join(OUT, `${o.id}.${archetype}.png`);
  await page.locator("canvas").first().screenshot({ path: file });
  const missing = notice ? (notice.match(/yet: ([^.]*)\./)?.[1] ?? "").split(", ").filter(Boolean) : [];
  const row = { id: o.id, name: o.name, season: o.season ?? null, archetype, slots: o.slots, pieces: Object.keys(o.slots).length,
    notOnClass: missing, notice, errors: [...new Set(errors)], file: path.basename(file) };
  rows.push(row); console.log(o.id, archetype, "pieces", row.pieces, "notOnClass", missing.length, missing.join(" | "), "errors", row.errors.length);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1) + "\n");
await browser.close();
