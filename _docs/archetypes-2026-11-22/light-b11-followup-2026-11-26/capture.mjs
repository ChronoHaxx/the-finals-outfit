// b11 follow-up captures (26 Nov 2026). Shows the UNAPPLIED +2 patch 49134266 on the active index 20092d96: the app runs
// from a worktree (vite on 5181, .env.local VITE_ASSETS_BASE=http://127.0.0.1:5199/); the read-only overlay server on
// 5199 serves the main checkout's public/, except the patched assets.json and the patch's 2 Light meshes.
// Rows: SK_Sport_ClimbingBandolier_L (4 items newly build on Light; 3' pass with 2 flipped triangles) in two variants.
// SK_Casual_HippieNecklaceChainLong_L is inert (its crop top still lacks FrontTieCropTopSleeves_L), so it is not shown.
// Usage: node capture.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:5181";
const url = (slots, archetype, cam) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam}&fov=28&archetypes=on`;
const CAM = {
  front: "0,0.95,5.2,0,0.95,0", side: "5.2,0.95,0,0,0.95,0", back: "0,0.95,-5.2,0,0.95,0",
  waist: "0.4,1.05,2.3,0,1.0,0", head: "0.5,1.55,1.7,0,1.5,0", headSide: "1.7,1.55,0.3,0,1.5,0",
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
await page.goto(`${BASE}/?reconstructed=1&archetypes=on`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
const start = await page.evaluate(async () => (await import("/src/store/useBuildStore.ts")).startingOutfit());
// Pass 2 (`standins`): the first pass showed 5 sampled rows left off on Light, because each item still lacks another
// class mesh (items_on_light.py: 23 of the 100 meshes are in no item that builds on Light yet). These rows are in items
// that do build: re-triangulated and position-tie-break rows in place of the inert ones.
const ROWS = [
  // [id, mesh, slot, item, views]
  ["climbingbandolier", "SK_Sport_ClimbingBandolier_L", "upperBack", "sport-climbingbandolier-canvas", ["front", "back", "side"]],
  ["climbingbandolier-alfaacta", "SK_Sport_ClimbingBandolier_L", "upperBack", "sport-climbingbandolier-canvas-alfaacta", ["front", "back"]],
];
const rows = ROWS;
fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const [id, mesh, slot, item, views] of rows) for (const archetype of ["light", "medium"]) for (const view of views) {
  errors = [];
  const slots = slot ? { ...start, [slot]: item } : start;
  await page.goto(url(slots, archetype, CAM[view]), { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
  const notice = await page.evaluate(() => document.querySelector("[data-class-notice]")?.textContent ?? null);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas"); const host = canvas?.parentElement?.parentElement;
    if (!host) throw new Error("Viewer canvas not found");
    for (let el = canvas; el && el !== document.body; el = el.parentElement)
      for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
    Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999", background: "#d3d8df" });
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(2500);
  const file = path.join(OUT, `${id}.${archetype}.${view}.png`);
  await page.locator("canvas").first().screenshot({ path: file });
  const missing = notice ? (notice.match(/yet: ([^.]*)\./)?.[1] ?? "").split(", ").filter(Boolean) : [];
  const row = { id, mesh, archetype, view, item, notOnClass: missing, notice, errors: [...new Set(errors)], file: path.basename(file) };
  report.push(row);
  console.log(id, archetype, view, "notOnClass", missing.join(" | ") || "-", "errors", row.errors.length);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1) + "\n");
await browser.close();
