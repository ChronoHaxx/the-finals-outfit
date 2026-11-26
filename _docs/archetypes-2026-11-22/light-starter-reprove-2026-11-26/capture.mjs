// Light starter re-prove captures (26 Nov 2026). Shows the UNAPPLIED patch e7cd0b2f on the active index 9e2fe5d3.
// The app runs from a worktree (vite on 5181, .env.local VITE_ASSETS_BASE=http://127.0.0.1:5199/). A read-only overlay
// server on 5199 serves the main checkout's public/, except the patched assets.json and the patch's 3 Light meshes.
// Shots: the starting outfit on Light front/side/back plus a feet close-up; the Medium reference; the Alliance
// TallSneakers (their print reads floor(uv0.x), so raw tiles must route it) and a HandCloth item, Light and Medium.
// Same wait, notice and canvas handling as light-unflag-bar-2026-11-26/capture-script.mjs.
// Usage: node capture.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:5181";
const url = (slots, archetype, cam) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam}&fov=28&archetypes=on`;
const CAM = {
  front: "0,0.95,5.2,0,0.95,0", side: "5.2,0.95,0,0,0.95,0", back: "0,0.95,-5.2,0,0.95,0",
  feet: "0.6,0.35,1.9,0,0.12,0", feetSide: "1.9,0.3,0.3,0,0.12,0", hands: "0.9,1.0,2.0,0,0.95,0",
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
await page.goto(`${BASE}/?reconstructed=1&archetypes=on`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
const start = await page.evaluate(async () => (await import("/src/store/useBuildStore.ts")).startingOutfit());
const shots = [
  ["starting-outfit", start, "light", ["front", "side", "back", "feet"]],
  ["starting-outfit", start, "medium", ["front", "feet"]],
  ["alliance-sneakers", { ...start, feet: "casual-tallsneakers-alliance" }, "light", ["feet", "feetSide"]],
  ["alliance-sneakers", { ...start, feet: "casual-tallsneakers-alliance" }, "medium", ["feet", "feetSide"]],
  ["handcloth", { ...start, hands: "cowboy-handcloth-cotton" }, "light", ["hands"]],
  ["handcloth", { ...start, hands: "cowboy-handcloth-cotton" }, "medium", ["hands"]],
];
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [id, slots, archetype, views] of shots) for (const view of views) {
  errors = [];
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
  const row = { id, archetype, view, slots, notOnClass: missing, notice, errors: [...new Set(errors)], file: path.basename(file) };
  rows.push(row);
  console.log(id, archetype, view, "notOnClass", missing.join(" | ") || "-", "errors", row.errors.length);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1) + "\n");
await browser.close();
