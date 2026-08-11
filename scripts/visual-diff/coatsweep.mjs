// coatsweep.mjs — render the BACK of every outerwear item as the real app builds it (coat
// equipped, Upper Body empty → undersuit auto-substituted/tinted). For eyeballing the open-back
// undersuit blend across the whole outerwear set.  node scripts/visual-diff/coatsweep.mjs
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/out");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const ow = items.filter((i) => i.slot === "outerwear" && i.model?.gltfPath);

const enc = (slots) =>
  "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// pulled-back back view so longcoats AND shorter ponchos/robes both frame.
const cam = { pos: [0, 1.1, -2.0], target: [0, 0.95, 0], fov: 34 };

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
const page = await browser.newPage({ viewport: { width: 560, height: 940 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.warn("  pageerror:", String(e).slice(0, 160)));
mkdirSync(OUT, { recursive: true });

for (const it of ow) {
  const url = `${BASE}/?outfit=${enc({ outerwear: it.id })}&cam=${[...cam.pos, ...cam.target].join(",")}&fov=${cam.fov}&pose=a`;
  await page.goto(url, { waitUntil: "networkidle" });
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const box = await canvas.boundingBox();
  await page.screenshot({ path: join(OUT, `sweep-${it.id}.png`), clip: box });
  console.log("rendered", it.id);
}
await browser.close();
console.log("done");
