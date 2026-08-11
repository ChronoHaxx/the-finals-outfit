// coatback.mjs — render coats as the REAL app builds them (outerwear equipped, Upper Body
// empty → effectiveBuild substitutes the undersuit). Captures front + back so the open-back
// opening / undersuit blend can be judged by eye. Ad-hoc verification harness.
//   node scripts/visual-diff/coatback.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/out");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";

const encodeOutfit = (slots) =>
  "1." +
  Buffer.from(JSON.stringify({ slots }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const COATS = [
  "casual-longcoat-leather-black",
  "casual-longcoat-leather-camo",
  "casual-longcoat-satin",
];
// front + back at the torso; back flips camera Z so the opening faces us.
const VIEWS = {
  front: { pos: [0, 1.15, 1.7], target: [0, 1.0, 0], fov: 30 },
  back: { pos: [0, 1.15, -1.7], target: [0, 1.0, 0], fov: 30 },
};

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* next */
    }
  }
  throw new Error("no Chrome/Edge found");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.warn("  pageerror:", String(e).slice(0, 160)));
mkdirSync(OUT, { recursive: true });

for (const coat of COATS) {
  const outfit = encodeOutfit({ outerwear: coat }); // upperBody intentionally empty
  for (const [view, cam] of Object.entries(VIEWS)) {
    const url = `${BASE}/?outfit=${outfit}&cam=${[...cam.pos, ...cam.target].join(",")}&fov=${cam.fov}&pose=a`;
    await page.goto(url, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const box = await canvas.boundingBox();
    const path = join(OUT, `coat-${coat.replace(/^casual-longcoat-/, "")}-${view}.png`);
    await page.screenshot({ path, clip: box });
    console.log("rendered", path);
  }
}
await browser.close();
console.log("done");
