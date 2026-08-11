// orbit.mjs — capture a cosmetic from N angles around the model and montage them, for
// multi-angle artifact inspection (streaking, seams, clipping, per-angle material errors)
// that a single front shot hides.
//
//   node scripts/visual-diff/orbit.mjs --id=<itemId> [--n=8] [--radius=1.5] [--height=1.15]
//        [--target=0,1.05,0] [--fov=30] [--nobaked] [--albedo] [--out=<name>] [--cols=4]
//
// Requires `npm run dev` serving (override VDIFF_BASE). Output: visual-diff/out/orbit-<name>.png
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/out");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const ID = arg("id");
if (!ID) throw new Error("usage: --id=<itemId> [--n=8] [--radius] [--height] [--target=x,y,z] [--fov] [--nobaked] [--albedo]");
const N = Number(arg("n", "8"));
const R = Number(arg("radius", "1.5"));
const H = Number(arg("height", "1.15"));
const FOV = Number(arg("fov", "30"));
const TARGET = (arg("target", "0,1.05,0")).split(",").map(Number);
const COLS = Number(arg("cols", "4"));
const NOBAKED = flag("nobaked");
const ALBEDO = flag("albedo");
const NAME = arg("out", ID + (NOBAKED ? "-flat" : "") + (ALBEDO ? "-albedo" : ""));

const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const item = (Array.isArray(items) ? items : items.items).find((i) => i.id === ID);
if (!item?.model?.gltfPath) throw new Error(`item '${ID}' has no model`);

const encodeOutfit = (slots) =>
  "1." +
  Buffer.from(JSON.stringify({ slots }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const outfit = encodeOutfit({ [item.slot]: item.id });

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* next */
    }
  }
  throw new Error("no Chrome/Edge for playwright-core");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.warn("  pageerror:", String(e).slice(0, 160)));
mkdirSync(OUT, { recursive: true });

const tiles = [];
for (let i = 0; i < N; i++) {
  const deg = (360 / N) * i;
  const a = (deg * Math.PI) / 180;
  const pos = [TARGET[0] + R * Math.sin(a), H, TARGET[2] + R * Math.cos(a)];
  const url =
    `${BASE}/?outfit=${outfit}&cam=${[...pos, ...TARGET].join(",")}&fov=${FOV}&pose=a` +
    (ALBEDO ? "&debugAlbedo=1" : "") +
    (NOBAKED ? "&nobaked=1" : "");
  await page.goto(url, { waitUntil: "networkidle" });
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  const buf = await page.screenshot({ clip: box });
  tiles.push(await sharp(buf).resize(300, 400, { fit: "contain", background: "#bcc6d2" }).removeAlpha().toBuffer());
  console.log(`  ${ID} @ ${deg.toFixed(0)}°`);
}
await browser.close();

const cols = Math.min(COLS, N);
const rows = Math.ceil(N / cols);
const TW = 300, TH = 400;
await sharp({ create: { width: TW * cols, height: TH * rows, channels: 3, background: "#000" } })
  .composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * TW, top: Math.floor(i / cols) * TH })))
  .png()
  .toFile(join(OUT, `orbit-${NAME}.png`));
console.log(`\norbit -> ${join(OUT, `orbit-${NAME}.png`)}`);
