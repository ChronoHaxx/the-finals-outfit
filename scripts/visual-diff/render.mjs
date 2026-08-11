// render.mjs — drive the dev server with headless Chrome and screenshot each visual-diff
// case (one item equipped alone, camera pinned via the dev-only ?cam/?fov hooks).
//
//   node scripts/visual-diff/render.mjs [--albedo] [--only=<itemId>]
//
// Requires `npm run dev` to be serving (override with VDIFF_BASE). --albedo additionally
// renders each case with ?debugAlbedo=1 (unlit albedo, NoToneMapping) for color
// calibration. Output: visual-diff/out/<id>.png (+ <id>.albedo.png).
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/out");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";
const ALBEDO = process.argv.includes("--albedo");
// --nobaked forces the legacy region-tint path (?nobaked=1) and writes <id>.flat.png — for
// flat-vs-faithful before/after of the layered-material bake.
const NOBAKED = process.argv.includes("--nobaked");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);

const { defaults, cases } = JSON.parse(readFileSync(join(SCRIPT_DIR, "cases.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));

// Mirror of src/lib/outfit.ts encodeOutfit (format v1) — keep in sync.
const encodeOutfit = (slots) =>
  "1." +
  Buffer.from(JSON.stringify({ slots }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try next */
    }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.warn("  pageerror:", String(e).slice(0, 200)));
mkdirSync(OUT, { recursive: true });

let rendered = 0;
const skipped = [];
for (const c of cases) {
  if (ONLY && c.id !== ONLY) continue;
  const item = byId.get(c.id);
  if (!item?.model?.gltfPath) {
    skipped.push(c.id);
    continue;
  }
  const cam = c.cam ?? defaults.cams[item.slot];
  if (!cam) {
    console.warn(`skip ${c.id}: no camera preset for slot '${item.slot}'`);
    skipped.push(c.id);
    continue;
  }
  const outfit = encodeOutfit({ [item.slot]: item.id });
  for (const variant of ALBEDO ? ["lit", "albedo"] : ["lit"]) {
    const url =
      `${BASE}/?outfit=${outfit}&cam=${[...cam.pos, ...cam.target].join(",")}&fov=${cam.fov}&pose=a` +
      (variant === "albedo" ? "&debugAlbedo=1" : "") +
      (NOBAKED ? "&nobaked=1" : "");
    await page.goto(url, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
    await page.waitForTimeout(700); // a few frames: env compile, contact shadow settle
    const box = await canvas.boundingBox();
    const suffix = (NOBAKED ? ".flat" : "") + (variant === "albedo" ? ".albedo" : "");
    await page.screenshot({ path: join(OUT, `${c.id}${suffix}.png`), clip: box });
  }
  rendered++;
  console.log(`rendered ${c.id}`);
}

await browser.close();
console.log(`\n${rendered} cases rendered -> ${OUT}`);
if (skipped.length) console.log(`skipped (no model/cam): ${skipped.join(", ")}`);
