// Own-weights captures (28 Nov 2026): the UNAPPLIED own-weights dry run (SK_Sneakers_L, SK_StarterSet_TShirt_L with the
// game's own weights and the Medium's body masks) on the active index. The app runs from the worktree (vite on 5181,
// .env.local VITE_ASSETS_BASE=http://127.0.0.1:5199/); the read-only overlay server on 5199 serves the main checkout's
// public/, except the dry run's assets.json and its Light meshes.
// Each starter item on Light against Medium, in the outfit-screen idle and two emotes that bend the joints the reweight
// moves: Tornado Warning (a kick and its landing: feet and ankles) and Sun's Out, Guns Out (a flex: torso and shoulders).
// Usage: node own-weights-capture.mjs <out dir> [--only sneakers|tshirt]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [OUT, ...rest] = process.argv.slice(2);
const only = rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null;
const BASE = "http://127.0.0.1:5181";
const CAM = {
  full: "0,0.95,5.2,0,0.95,0", back: "0,0.95,-5.2,0,0.95,0",
  feet: "0.9,0.35,1.6,0,0.12,0", feetSide: "1.8,0.3,0.1,0,0.12,0", feetBack: "-0.6,0.35,-1.6,0,0.12,0",
  torso: "0,1.3,2.2,0,1.25,0", torsoBack: "0,1.3,-2.2,0,1.25,0", torsoSide: "2.2,1.3,0.2,0,1.25,0",
};
const POSES = {
  idle: "anim=outfit-idle&animTime=6",
  kick: "anim=tornado-kick&animTime=2.2",
  landing: "anim=tornado-kick&animTime=3.6",
  flex: "anim=flex&animTime=3.0",
};
// [group, slot, items, cameras, poses]
const ROWS = [
  ["sneakers", "feet", ["starterset-sneakers-leather-black", "starterset-sneakers-leather-redpanda", "starterset-sneakers-nylon"],
    ["full", "feet", "feetSide", "feetBack"], ["idle", "kick", "landing"]],
  ["tshirt", "upperBody", ["starterset-tshirt-cotton-black", "starterset-tshirt-cotton-whiteblack", "starterset-tshirt-cotton-anniversary24"],
    ["full", "torso", "torsoBack", "torsoSide"], ["idle", "flex", "kick"]],
];
const url = (slots, archetype, cam, pose) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam}&fov=28&archetypes=on&${pose}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })).newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
await page.goto(`${BASE}/?reconstructed=1&archetypes=on&anim=0`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 300000 });
const start = await page.evaluate(async () => (await import("/src/store/useBuildStore.ts")).startingOutfit());
fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const [group, slot, items, cams, poses] of ROWS) {
  if (only && only !== group) continue;
  // The first item in every pose and camera; the other variants (other materials on the same mesh) in idle, two views.
  for (const [n, item] of items.entries()) for (const pose of (n === 0 ? poses : ["idle"])) for (const archetype of ["light", "medium"])
    for (const cam of (n === 0 ? cams : cams.slice(0, 2))) {
      errors = [];
      const slots = { ...start, [slot]: item };
      await page.goto(url(slots, archetype, CAM[cam], POSES[pose]), { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 300000 });
      await page.waitForTimeout(1500);
      const notice = await page.evaluate(() => document.querySelector("[data-class-notice]")?.textContent ?? null);
      const meshes = await page.evaluate(() => [...performance.getEntriesByType("resource")].map(e => e.name)
        .filter(u => /SK_(Sneakers|StarterSet_TShirt)_[LM]\.glb/.test(u)).map(u => u.split("/").pop()));
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas"); const host = canvas?.parentElement?.parentElement;
        if (!host) throw new Error("Viewer canvas not found");
        for (let el = canvas; el && el !== document.body; el = el.parentElement)
          for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
        Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999", background: "#d3d8df" });
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(2500);
      const file = `${item}.${pose}.${cam}.${archetype}.png`;
      await page.locator("canvas").first().screenshot({ path: path.join(OUT, file) });
      const missing = notice ? (notice.match(/yet: ([^.]*)\./)?.[1] ?? "").split(", ").filter(Boolean) : [];
      const row = { group, item, pose, cam, archetype, meshes: [...new Set(meshes)], notOnClass: missing,
        errors: [...new Set(errors)], file };
      report.push(row);
      console.log(item, pose, cam, archetype, "meshes", row.meshes.join(",") || "-", "notOnClass", missing.join(" | ") || "-",
        "errors", row.errors.length);
    }
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1) + "\n");
await browser.close();
