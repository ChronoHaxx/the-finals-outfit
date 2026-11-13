// Body-type picker review captures (12 Nov 2026): each review outfit in each body type visitors can pick, opened the way
// a visitor opens it (a short share link carrying `bt` and a frozen pose), from fixed cameras. A capture never judges:
// the pairs are for looking at full size.
//
// Run in Git Bash, from the worktree root, with serve-preview.mjs on 5199 (--animations-base for the clips):
//   node --import tsx _docs/body-type-picker-2026-11-11/capture-picker-review.mjs OUT_DIR [--only outfit] [--port 5199]
//
// Each shot writes <outfit>/<pose>/<bodyType>-<camera>.png and a .json record: the medium_male weight on every source
// mesh, the pose the viewer reports, the mesh files requested, and any console errors.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import "../../tests/helpers/load-catalog";
import { buildShareUrl } from "../../src/lib/share-url";

const [OUT, ...rest] = process.argv.slice(2);
if (!OUT || fs.existsSync(OUT)) throw new Error(`Provide a new output folder (preserve ${OUT})`);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const only = option("--only");
const BASE = `http://127.0.0.1:${option("--port") ?? 5199}`;

const FACE = "head-face-01-base", SNEAKERS = "casual-tallsneakers-canvas";
export const OUTFITS = {
  // The starting look.
  "default": { face: FACE, upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: SNEAKERS },
  // Season 12 top (medium_male moved 2.55 cm) over pre-Season-12 pants: the direction the 6 Nov review never shot.
  "s12-top-over-pre-pants": { face: FACE, upperBody: "sport-footballhoodie-jersey", lowerBody: "military-assaultpants-canvas", feet: SNEAKERS },
  // Pre-Season-12 tops over Season 12 pants (6 Nov c1, c2).
  "pre-hoodie-over-s12-pants": { face: FACE, upperBody: "streetwear-hoodie-zebra", lowerBody: "municipal-pants-nylon", feet: SNEAKERS },
  "pre-crop-top-over-s12-pants": { face: FACE, upperBody: "streetwear-techcroptop-nylon-ivada", lowerBody: "municipal-pants-nylon", feet: SNEAKERS },
  // Both hands (gloves) and a back attachment (the upperback socket offset differs between the body types).
  "gloves-and-backpack": { face: FACE, upperBody: "casual-basictshirt-cotton-black", lowerBody: "military-sniperpants-windbreaker",
    hands: "streetwear-techgloves-nylon-black", upperBack: "assets-ammobackpack", feet: SNEAKERS },
};
const BODY_TYPES = ["masculine", "androgynous"];
const AROUND = {
  front: "0,0.95,4.3,0,0.95,0", back: "0,0.95,-4.3,0,0.95,0", left: "-4.3,0.95,0,0,0.95,0", right: "4.3,0.95,0,0,0.95,0",
  waist: "0,1.0,1.3,0,1.0,0", "waist-back": "0,1.0,-1.3,0,1.0,0",
};
const POSES = {
  idle: { pose: { clip: "outfit-idle", time: 2, paused: true }, cameras: AROUND },
  "bear-hug": { pose: { clip: "bear-hug", time: 3, paused: true },
    cameras: { front: AROUND.front, right: AROUND.right, chest: "0,1.3,1.4,0,1.3,0" } },
  boxer: { pose: { clip: "boxer", time: 2, paused: true }, cameras: { front: AROUND.front, left: AROUND.left } },
};

const shotUrl = (slots, bodyType, pose, cam) => {
  const link = new URL(buildShareUrl("https://example.invalid/", { build: slots, bodyType }, "short", pose));
  return `${BASE}/?reconstructed=1&cam=${cam}&fov=28${link.hash}`;
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const page = await context.newPage();
let errors = [], meshRequests = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
page.on("pageerror", e => errors.push(String(e).split("\n")[0]));
page.on("request", r => { if (/\.glb(\?|$)/.test(r.url())) meshRequests.push(new URL(r.url()).pathname); });

const summary = [];
for (const [outfit, slots] of Object.entries(OUTFITS)) {
  if (only && outfit !== only) continue;
  for (const [poseName, { pose, cameras }] of Object.entries(POSES))
    for (const bodyType of BODY_TYPES) for (const [camera, cam] of Object.entries(cameras)) {
      errors = []; meshRequests = [];
      const file = path.join(OUT, outfit, poseName, `${bodyType}-${camera}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.goto(shotUrl(slots, bodyType, pose, cam), { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
      // The link's pose applies once the outfit has loaded: wait until the viewer reports that frame, frozen.
      await page.waitForFunction(async ({ clip, time }) => {
        const shown = (await import("/src/lib/viewer-handle.ts")).getPoseCapture();
        return !!shown && shown.clip === clip && shown.paused && Math.abs(shown.time - time) < 0.05;
      }, pose, { timeout: 120000, polling: 500 });
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const host = canvas?.parentElement?.parentElement;
        if (!host) throw new Error("Viewer canvas not found");
        for (let el = canvas; el && el !== document.body; el = el.parentElement)
          for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
        Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999",
          background: "#d3d8df" });
        document.body.style.background = "#14191f";
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(3000); // resize, then let the temporal accumulator converge
      await page.locator("canvas").first().screenshot({ path: file });
      const record = await page.evaluate(async () => {
        const meshes = [];
        window.__rigRoot.traverse(o => {
          const d = o.morphTargetDictionary;
          if (o.isMesh && d && !meshes.some(m => m.name === o.name))
            meshes.push({ name: o.name, medium_male: d.medium_male === undefined ? null : o.morphTargetInfluences[d.medium_male] });
        });
        const shown = (await import("/src/lib/viewer-handle.ts")).getPoseCapture();
        const { useBuildStore } = await import("/src/store/useBuildStore.ts");
        return { meshes, pose: shown, storeBodyType: useBuildStore.getState().bodyType };
      });
      const row = { outfit, pose: poseName, bodyType, camera, file: path.relative(OUT, file).replaceAll("\\", "/"),
        ...record, meshRequests: [...new Set(meshRequests)], errors: [...new Set(errors)] };
      fs.writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify(row, null, 1) + "\n");
      summary.push(row);
      const weights = [...new Set(record.meshes.map(m => m.medium_male).filter(w => w !== null))];
      console.log(outfit, poseName, bodyType, camera, "store", record.storeBodyType, "medium_male", weights.join("/"),
        "errors", row.errors.length);
    }
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ at: new Date().toISOString(), shots: summary }, null, 1) + "\n");
await browser.close();
