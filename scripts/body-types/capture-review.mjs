// Body-type review captures (6 Nov 2026): every review outfit in every Medium body type, on the live-index server and
// the Season 12 preview server, from fixed cameras. A capture never judges; the sheets are for looking at full size.
//
//   node scripts/body-types/capture-review.mjs OUT_DIR [--only outfitId] [--servers live,s12]
//
// Needs serve-preview.mjs running on 5191 (live) and 5192 (--preview s12-bodytype-preview-v1). Each shot writes
// <server>/<outfit>/<bodyType>-<camera>.png and a .json record: the rig's source meshes with the morphs applied to each,
// the mesh files the page requested, and any console errors.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [OUT, ...rest] = process.argv.slice(2);
if (!OUT || fs.existsSync(OUT)) throw new Error(`Provide a new output folder (preserve ${OUT})`);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const only = option("--only");

const ALL_SERVERS = { live: "http://127.0.0.1:5191", s12: "http://127.0.0.1:5192" };
const SERVERS = Object.fromEntries(Object.entries(ALL_SERVERS)
  .filter(([name]) => (option("--servers") ?? "live,s12").split(",").includes(name)));
const BASE = { face: "head-face-01-base", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
export const OUTFITS = {
  "default-tee": { ...BASE, upperBody: "casual-basictshirt-cotton-black" },
  "zip-hoodie": { ...BASE, upperBody: "casual-hoodiezipup-cotton-black" },
  "bomber": { ...BASE, upperBody: "streetwear-oversizedbomberjacket-nylon-vanguard" },
  "padded-shirt": { ...BASE, upperBody: "sport-paddedshirt-nylon-vaiiya" },
  "rolled-sleeves": { ...BASE, upperBody: "casual-shirtrolledupsleeves-cotton" },
  "short-dress": { ...BASE, upperBody: "casual-shortdress-cotton" },
  "tech-crop-top": { ...BASE, upperBody: "streetwear-techcroptop-nylon-ivada" },
};
const BODY_TYPES = ["masculine", "feminine", "androgynous"];
const CAMERAS = { front: "0,1.25,1.9,0,1.25,0", side: "1.9,1.25,0,0,1.25,0", full: "0,0.95,4.3,0,0.95,0" };

const outfitUrl = (base, slots, bodyType, cam) => `${base}/?outfit=1.${Buffer.from(JSON.stringify({ slots }))
  .toString("base64url")}&reconstructed=1&bodyType=${bodyType}&cam=${cam}&fov=28`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const page = await context.newPage();
let errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
// Mesh requests per shot, from the browser's request log. (performance.getEntriesByType keeps 250 entries by
// default, and the material files fill it before the meshes load.) The app caches meshes it has already fetched, so
// a later shot on the same origin lists only new files; the summary unions them per server and outfit.
let meshRequests = [];
page.on("request", r => { if (/\.glb(\?|$)/.test(r.url())) meshRequests.push(new URL(r.url()).pathname); });

const summary = [];
for (const [server, base] of Object.entries(SERVERS))
  for (const [outfit, slots] of Object.entries(OUTFITS)) {
    if (only && outfit !== only) continue;
    for (const bodyType of BODY_TYPES) for (const [camera, cam] of Object.entries(CAMERAS)) {
      errors = []; meshRequests = [];
      const file = path.join(OUT, server, outfit, `${bodyType}-${camera}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.goto(outfitUrl(base, slots, bodyType, cam), { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
      // The viewer's own container goes full window, so the capture is the render surface only and large.
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const host = canvas?.parentElement?.parentElement;
        if (!host) throw new Error("Viewer canvas not found");
        // Hide everything that is not on the canvas's own ancestor chain (panels, overlays, menus).
        for (let el = canvas; el && el !== document.body; el = el.parentElement)
          for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
        // The canvas is transparent; one uniform light backdrop replaces the panel's own (left at its old size).
        Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999",
          background: "#d3d8df" });
        document.body.style.background = "#14191f";
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(2500); // resize, then let the temporal accumulator converge
      await page.locator("canvas").first().screenshot({ path: file });
      const record = await page.evaluate(() => {
        const meshes = [];
        window.__rigRoot.traverse(o => {
          if (o.isMesh && (o.userData.sourceMesh || o.userData.sourceBody) && !meshes.some(m => m.name === o.name))
            meshes.push({ name: o.name, morphs: o.userData.sourceFittingMorphs ?? [] });
        });
        return { meshes };
      });
      const row = { server, outfit, bodyType, camera, file: path.relative(OUT, file).replaceAll("\\", "/"),
        ...record, meshRequests: [...new Set(meshRequests)], errors: [...new Set(errors)] };
      fs.writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify(row, null, 1) + "\n");
      summary.push(row);
      console.log(server, outfit, bodyType, camera, "meshes", record.meshes.length, "errors", row.errors.length);
    }
  }
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ at: new Date().toISOString(), shots: summary }, null, 1) + "\n");
await browser.close();
