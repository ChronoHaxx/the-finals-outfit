// Light / Medium / Heavy review captures (22 Nov 2026): each review outfit on each class, from fixed cameras, on one
// server (serve-preview.mjs with an archetype index, scripts/archetypes/build-archetype-index.py). A capture never
// judges; look at the PNGs at full size.
//
//   node scripts/archetypes/capture-classes.mjs OUT_DIR [--port 5197] [--only outfit] [--cameras full,side]
//        [--classes light,medium,heavy] [--query "anim=outfit-idle&animTime=6"]
//
// Each shot writes <outfit>/<class>-<camera>.png and a .json record: the class the rig built, the source meshes with
// the morphs applied to each, the notice naming items left off, the mesh files requested and any console errors.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [OUT, ...rest] = process.argv.slice(2);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
if (!OUT || fs.existsSync(OUT)) throw new Error(`Provide a new output folder (preserve ${OUT})`);
const BASE = `http://127.0.0.1:${option("--port") ?? 5197}`;
const OUTFITS = {
  hoodie: { face: "head-face-01-base", hair: "hairs-afrofade-black", upperBody: "streetwear-hoodie-cotton-pink",
    lowerBody: "military-marinepants-canvas-black", feet: "military-acepilotboots-leather-blue",
    hands: "military-assaultgloves-leather-black" },
  dress: { face: "head-face-03-base", upperBody: "casual-shortdress-cotton", lowerBody: "ballerina-ballerinatights-leopard",
    feet: "casual-lowwedgeheels-latex", wrist: "casual-bangles-metal-gold", eyewear: "attachment-roundsunglasses-plastic" },
  cap: { face: "head-face-05-base", headwear: "streetwear-baseballcap-cotton-alienpatch", upperBody: "robots-discojacket-cotton",
    lowerBody: "robots-discopants-cotton", feet: "streetwear-shoes-rubber-graywhite", hands: "scifi-hackergloves-leather" },
  space: { face: "head-face-07-base", headwear: "streetwear-beanie-cotton-blackwhite", upperBody: "space-spacetopvest-plastic",
    lowerBody: "space-spacesuitpants-nylon", feet: "space-pioneershoes-nylon-arenasecurity", hands: "space-spacecombatgloves-metal" },
  bare: { face: "head-face-01-base", lowerBody: "casual-basicshorts-cotton-pink" },
};
const ALL_CAMERAS = { full: "0,1.0,4.8,0,1.0,0", side: "4.8,1.0,0,0,1.0,0", back: "0,1.0,-4.8,0,1.0,0",
  torso: "0,1.3,2.2,0,1.3,0", head: "0,1.65,1.1,0,1.65,0", headside: "1.1,1.65,0,0,1.65,0" };
const CAMERAS = Object.fromEntries(Object.entries(ALL_CAMERAS)
  .filter(([name]) => (option("--cameras") ?? "full,side,back,torso,head").split(",").includes(name)));
const CLASSES = (option("--classes") ?? "light,medium,heavy").split(",");
const QUERY = option("--query") ? `&${option("--query")}` : "";
const only = option("--only");

// The close cameras (torso, head) follow the class's own height: every joint is the class scale of Medium's, so a
// camera at height y on Medium looks at the same place at y x scale. The full-body cameras stay put to compare sizes.
const SCALE = { light: 0.85, medium: 1, heavy: 1.15 };
const CLOSE = new Set(["torso", "head", "headside"]);
const camFor = (camera, cam, archetype) => CLOSE.has(camera)
  ? cam.split(",").map((v, i) => i === 1 || i === 4 ? (Number(v) * SCALE[archetype]).toFixed(3) : v).join(",") : cam;
const url = (slots, archetype, cam) => `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype }))
  .toString("base64url")}&reconstructed=1&cam=${cam}&fov=28${QUERY}`;

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
  for (const archetype of CLASSES) for (const [camera, cam] of Object.entries(CAMERAS)) {
    const file = path.join(OUT, outfit, `${archetype}-${camera}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    errors = []; meshRequests = [];
    await page.goto(url(slots, archetype, camFor(camera, cam, archetype)), { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 240000 });
    const notice = await page.evaluate(() => document.querySelector('[data-class-notice]')?.textContent ?? null);
    const hud = await page.evaluate(() => [...document.querySelectorAll("span.hud")].map(s => s.textContent)
      .find(t => / · \d+ piece/.test(t ?? "")) ?? null);
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
    await page.waitForTimeout(2500);
    await page.locator("canvas").first().screenshot({ path: file });
    const record = await page.evaluate(() => {
      const meshes = [];
      window.__rigRoot.traverse(o => {
        if (o.isMesh && (o.userData.sourceMesh || o.userData.sourceBody) && !meshes.some(m => m.name === o.name))
          meshes.push({ name: o.name, source: o.userData.sourceMesh ?? (o.userData.sourceBody ? o.userData.sourceBodyUrl : null),
            morphs: o.userData.sourceFittingMorphs ?? [] });
      });
      return { meshes };
    });
    const row = { outfit, archetype, camera, file: path.relative(OUT, file).replaceAll("\\", "/"), hud, notice, ...record,
      meshRequests: [...new Set(meshRequests)], errors: [...new Set(errors)] };
    fs.writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify(row, null, 1) + "\n");
    console.log(outfit, archetype, camera, hud, "meshes", record.meshes.length, "errors", row.errors.length, notice ? `NOTICE ${notice}` : "");
    summary.push(row);
  }
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, shots: summary }, null, 1) + "\n");
await browser.close();
