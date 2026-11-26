// Proof 3' run captures (26 Nov 2026). Shows the UNAPPLIED patch 9f5dd6d2 on the active index e7cd0b2f.
// The app runs from a worktree (vite on 5181, .env.local VITE_ASSETS_BASE=http://127.0.0.1:5199/). A read-only overlay
// server on 5199 serves the main checkout's public/, except the patched assets.json and the patch's 100 Light meshes.
// Rows (coordinator, 26 Nov): the T-shirt as the refused row; the two UV1 rows (AnubisMaskRegular, HoodWrap) with their
// hide edges; 10 sampled passes: re-triangulated (SpaceBeltUltimate, ElegantKnightHood, RancheroJacket, ConsoleBackpack),
// position tie-break (SkeletonWarriorTorso, ChristmasLights, AcePilotTop), unweighted extra joints (KnightNeckCloth) and
// reorder-only (VikingTunic, AviatorJacket). Each on Light and on Medium. Same wait, notice and canvas handling as
// light-starter-reprove-2026-11-26/capture.mjs.
// Usage: node capture.mjs <out dir> [standins]
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
const STANDINS = [
  ["robotwarriorlegs", "SK_Robots_RobotWarriorLegs_L", "lowerBody", "robots-robotwarriorlegs-metal", ["front", "back"]],
  ["witchdresstop", "SK_Halloween_WitchDressTop_L", "upperBody", "halloween-witchdresstop-satin", ["front", "back"]],
  ["militarydress", "SK_FancyDress_MilitaryDress_L", "upperBody", "fancydress-militarydress-wool-pinkblack", ["front", "side"]],
  ["rancheroholster", "SK_Mexico_RancheroHolster_L", "lowerBody", "cowboy-basicchaps-leather-brown", ["front", "side"]],
  ["croppedpufferjacket", "SK_Winter_CroppedPufferJacket_L", "upperBody", "winter-croppedpufferjacket-satin", ["front", "back"]],
  ["halffingergloves", "SK_Streetwear_HalfFingerGloves_L", "hands", "streetwear-halffingergloves-leather", ["front", "side"]],
];
const MAIN = [
  // [id, mesh, slot, item, views]
  ["tshirt-refused", "SK_Casual_BasicTshirt_L (refused)", null, null, ["front", "back"]],
  ["spacebeltultimate", "SK_Space_SpaceBeltUltimate_L", "upperBody", "space-spacesuittopultimate-nylon", ["front", "waist"]],
  ["elegantknighthood", "SK_Medieval_ElegantKnightHood_L", "upperBody", "medieval-elegantknighttop-steel", ["front", "headSide"]],
  ["rancherojacket", "SK_Mexico_RancheroJacket_L", "upperBody", "mexico-rancherojacket-leather", ["front", "back"]],
  ["consolebackpack", "SK_Streetwear_ConsoleBackpack_L", "upperBack", "streetwear-consolebackpack-canvas-orf", ["back", "side"]],
  ["skeletonwarriortorso", "SK_Medieval_SkeletonWarriorTorso_L", "upperBody", "medieval-skeletonwarriortorso-leather", ["front", "back"]],
  ["christmaslights", "SK_Casual_ChristmasLights_L", "upperBody", "casual-sweater-wool-festive", ["front", "side"]],
  ["acepilottop", "SK_Military_AcePilotTop_L", "upperBody", "military-acepilottop-nylon-valkyr", ["front", "back"]],
  ["knightneckcloth", "SK_Medieval_KnightNeckCloth_L", "upperBody", "medieval-knighttop-steel-ultimate", ["front", "head"]],
  ["vikingtunic", "SK_Historic_VikingTunic_L", "upperBody", "historic-vikingtunic-linen-black", ["front", "side"]],
  ["aviatorjacket", "SK_Streetwear_AviatorJacket_L", "upperBody", "streetwear-aviatorjacket-nylon-brown", ["front", "back"]],
  ["anubismask", "SK_Historic_AnubisMaskRegular_L", "facewear", "historic-anubismaskregular-gold", ["head", "headSide"]],
  ["hoodwrap", "SK_Winter_HoodWrap_L", "headwear", "winter-hoodwrap-nylon", ["head", "headSide"]],
];
const rows = process.argv[3] === "standins" ? STANDINS : MAIN;
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
