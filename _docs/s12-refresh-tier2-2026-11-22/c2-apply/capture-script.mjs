// S12 C2 apply app check (27 Nov 2026, temporary): AssaultPants canvas (body mask), Flag Shirt USA (S12 Shirt + WornCape),
// Dress Shoes Leather (Socks_Quarter) and TightTechPants ISEULT (item mask) with the starting outfit on Medium (Masculine)
// through the active index on current main (5175). Front and close shots. Records errors and which C2
// assets (s12-refresh-tier2-v1/, reconstructed-s12-c2-v1/, s12-bodytype-refresh-v1/) were requested.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:5175";
const start = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const FULL = "0,0.95,4.6,0,0.95,0", TORSO = "0,1.25,1.9,0,1.2,0", LEGS = "0.5,0.6,2.0,0,0.55,0", KNEE = "0.3,0.5,1.2,0,0.48,0";
const WAIST = "0,1.0,1.5,0,0.95,0", WAISTBACK = "0,1.0,-1.5,0,0.95,0", FEET = "0.5,0.25,1.1,0,0.1,0", SIDE = "1.9,1.25,0,0,1.2,0";
const ROWS = [
  ["assaultpants-canvas", { lowerBody: "military-assaultpants-canvas" }, { full: FULL, waist: WAIST, waistback: WAISTBACK }],
  ["shirt-flag-usa", { upperBody: "starterset-shirt-flag-usa" }, { full: FULL, back: "0,1.25,-1.9,0,1.2,0", side: SIDE }],
  ["dressshoes-leather", { lowerBody: "starterset-shorts-cotton-black", feet: "fancydress-dressshoes-leather" }, { full: FULL, feet: FEET }],
  ["tighttechpants-iseult", { lowerBody: "streetwear-tighttechpants-polyester-iseult" }, { full: FULL, waist: WAIST }],
];
const url = (slots, cam) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, bodyType: "masculine" })).toString("base64url")}&reconstructed=1&cam=${cam}&fov=28`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [], requests = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
page.on("request", r => { const u = r.url(); if (/s12-refresh-tier2-v1|reconstructed-s12-c2-v1|s12-bodytype-refresh-v1/.test(u)) requests.push(new URL(u).pathname); });
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [id, extra, cams] of ROWS) for (const [view, cam] of Object.entries(cams)) {
  errors = []; requests = [];
  await page.goto(url({ ...start, ...extra }, cam), { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas"); const host = canvas?.parentElement?.parentElement;
    if (!host) throw new Error("Viewer canvas not found");
    for (let el = canvas; el && el !== document.body; el = el.parentElement)
      for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
    Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999", background: "#d3d8df" });
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(2500);
  const file = path.join(OUT, `${id}.${view}.png`);
  await page.locator("canvas").first().screenshot({ path: file });
  const c1 = [...new Set(requests)].sort();
  const row = { id, view, errors: [...new Set(errors)], c2Requests: c1, file: path.basename(file) };
  rows.push(row); console.log(id, view, "errors", row.errors.length, "c2", c1.length, c1.filter(p => p.endsWith(".glb") || p.endsWith(".png")).map(p => path.basename(p)).join(","));
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1) + "\n");
await browser.close();
