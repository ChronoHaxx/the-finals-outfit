// streak-sweep.mjs — OBJECTIVE streak measurement. Bakes a skin at several parameter values,
// renders the back (where draped-garment streaking is worst), and scores "streakiness" as the
// ratio of horizontal to vertical luminance gradients inside a coat crop: clean/smooth ≈ 1,
// vertical streaks ≫ 1. Removes subjective eyeballing from the tuning loop.
//
//   node scripts/visual-diff/streak-sweep.mjs --skin=Satin --param=roughFloor --values=0.45,0.6,0.72,0.85
// Requires `npm run dev`. Writes visual-diff/out/streak-sweep.png + prints scores.
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/out");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const SKIN = arg("skin", "Satin");
const PIECE = arg("piece", "casual/longcoat");
const ITEM = arg("item", "casual-longcoat-" + SKIN.toLowerCase().replace(/_/g, "-"));
const PARAM = arg("param", "roughFloor"); // roughFloor | normalStrength | macroNormal
const VALUES = arg("values", "0.45,0.6,0.72,0.85").split(",");
const ENV_KEY = { roughFloor: "BAKE_ROUGH_FLOOR", normalStrength: "BAKE_NORMAL_STRENGTH", macroNormal: "BAKE_MACRO_NORMAL" }[PARAM];

const enc = (s) =>
  "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const outfit = enc({ outerwear: ITEM });

// Streak score over a coat crop: mean|horizontal grad| / mean|vertical grad| on luminance.
async function streakScore(pngBuf, crop) {
  const meta = await sharp(pngBuf).metadata();
  const ex = {
    left: Math.round(crop[0] * meta.width),
    top: Math.round(crop[1] * meta.height),
    width: Math.round(crop[2] * meta.width),
    height: Math.round(crop[3] * meta.height),
  };
  const { data, info } = await sharp(pngBuf).extract(ex).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const L = (x, y) => {
    const i = (y * w + x) * ch;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let hSum = 0, vSum = 0, n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      hSum += Math.abs(L(x + 1, y) - L(x - 1, y));
      vSum += Math.abs(L(x, y + 1) - L(x, y - 1));
      n++;
    }
  return { ratio: hSum / Math.max(vSum, 1e-6), hMean: hSum / n, vMean: vSum / n };
}

const COAT_CROP = [0.32, 0.5, 0.36, 0.4]; // skirt region in the back view
const CAM = "0,1.15,-2.0,0,0.95,0";
const tiles = [];
const results = [];
for (const v of VALUES) {
  const env = { ...process.env, [ENV_KEY]: v, BAKE_FORCE: "1" };
  const r = spawnSync(process.execPath, ["scripts/bake-composite.mjs", `--piece=${PIECE}`, `--skin=${SKIN}`, "--force"], {
    cwd: ROOT, env, encoding: "utf8",
  });
  if (r.status !== 0) { console.error(`bake failed for ${v}:`, r.stderr?.slice(-300)); continue; }
  // FRESH browser per iteration — a reused browser caches the texture after the first load and
  // every subsequent render shows the stale map (identical scores). This is the same cache that
  // makes re-bakes invisible in a long-lived app session.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 560, height: 840 }, deviceScaleFactor: 1.5 });
  page.on("pageerror", () => {});
  await page.goto(`${BASE}/?outfit=${outfit}&cam=${CAM}&fov=34&pose=a`, { waitUntil: "networkidle" });
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  const box = await page.locator("canvas").first().boundingBox();
  const shot = await page.screenshot({ clip: box });
  await browser.close();
  const score = await streakScore(shot, COAT_CROP);
  results.push({ v, ...score });
  console.log(`  ${PARAM}=${v}  streakRatio=${score.ratio.toFixed(2)}  (h=${score.hMean.toFixed(2)} v=${score.vMean.toFixed(2)})`);
  tiles.push(await sharp(shot).resize(360, 520, { fit: "contain", background: "#ccc" }).removeAlpha().png().toBuffer());
}

if (tiles.length) {
  const W = 360, H = 520;
  await sharp({ create: { width: W * tiles.length, height: H, channels: 3, background: "#000" } })
    .composite(tiles.map((b, i) => ({ input: b, left: i * W, top: 0 })))
    .png()
    .toFile(join(OUT, "streak-sweep.png"));
}
results.sort((a, b) => a.ratio - b.ratio);
console.log(`\nBEST (lowest streak): ${PARAM}=${results[0]?.v} ratio=${results[0]?.ratio.toFixed(2)}`);
console.log(`montage cols (in --values order): ${VALUES.join(" | ")}`);
