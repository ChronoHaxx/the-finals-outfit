// T-shirt_L reshaped-route captures (26 Nov 2026). Shows a builder dry run (--reshaped SK_Casual_BasicTshirt_L with its
// own body mask) through the read-only overlay: the app runs from a worktree (vite on 5181, .env.local
// VITE_ASSETS_BASE=http://127.0.0.1:5199/), the overlay serves the main checkout's public/ except the dry run's
// assets.json, meshes and mask. Masculine (Androgynous is Medium-only in the game: DA_BodyType SupportedArchetypes).
// Checks the coordinator named: skin at the hem, neck and armholes, and holes where the mask hides body the shirt does
// not cover, in idle and the A pose (the mask is the intersection of both). Cameras follow the class's height (x0.85).
// Usage: node capture.mjs <out dir> [variants]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:5181";
const SCALE = { light: 0.85, medium: 1 };
// [eye x, y, z, target x, y, z] on Medium; y values scale with the class.
const CAM = {
  front: [0, 0.95, 5.2, 0, 0.95, 0], back: [0, 0.95, -5.2, 0, 0.95, 0],
  side: [5.2, 0.95, 0, 0, 0.95, 0], sideleft: [-5.2, 0.95, 0, 0, 0.95, 0],
  waist: [0.3, 1.0, 1.9, 0, 0.98, 0], waistback: [-0.3, 1.0, -1.9, 0, 0.98, 0],
  neck: [0.15, 1.5, 1.1, 0, 1.45, 0], armpit: [1.1, 1.3, 0.7, 0, 1.25, 0],
};
const cam = (view, archetype) => CAM[view].map((v, i) => (i === 1 || i === 4 ? v * SCALE[archetype] : v).toFixed(3)).join(",");
const url = (slots, archetype, view, pose) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam(view, archetype)}&fov=28&archetypes=on${pose === "a" ? "&pose=a" : ""}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
await page.goto(`${BASE}/?reconstructed=1&archetypes=on`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
const start = await page.evaluate(async () => (await import("/src/store/useBuildStore.ts")).startingOutfit());
const shots = [];
if (process.argv[3] === "variants") {
  for (const variant of ["black", "white", "esportalliance", "ospuze", "sponsoriseult", "trentilaracing", "alfaacta", "cometa"])
    for (const archetype of ["light", "medium"]) for (const view of ["front", "back"])
      shots.push([`tee-${variant}`, { ...start, upperBody: `casual-basictshirt-cotton-${variant}` }, archetype, view, "idle"]);
} else {
  for (const pose of ["idle", "a"]) for (const archetype of ["light", "medium"])
    for (const view of ["front", "side", "sideleft", "back", "waist", "waistback", "neck", "armpit"])
      shots.push(["start", start, archetype, view, pose]);
}
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [id, slots, archetype, view, pose] of shots) {
  errors = [];
  await page.goto(url(slots, archetype, view, pose), { waitUntil: "domcontentloaded", timeout: 180000 });
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
  const file = path.join(OUT, `${id}.${archetype}.${pose}.${view}.png`);
  await page.locator("canvas").first().screenshot({ path: file });
  const missing = notice ? (notice.match(/yet: ([^.]*)\./)?.[1] ?? "").split(", ").filter(Boolean) : [];
  rows.push({ id, archetype, view, pose, notOnClass: missing, errors: [...new Set(errors)], file: path.basename(file) });
  console.log(id, archetype, pose, view, "notOnClass", missing.join(" | ") || "-", "errors", errors.length);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1) + "\n");
await browser.close();
