// sweep.mjs — render EVERY catalog item that has a 3D model and score it automatically.
//
//   node scripts/visual-diff/sweep.mjs [--slot=<slot>] [--start=N] [--limit=N]
//
// Scores per item (visual-diff/sweep.json + sweep-report.html, ranked worst-first):
//   errors   — page/console/network failures while rendering (missing textures, shader)
//   coverage — non-backdrop fraction in the center crop (0 = mesh missing/invisible)
//   dE       — probe mean color vs the item's official icon, Oklab ×100 (rough, slot probes)
//   noise    — high-frequency luminance energy in the center crop (crust/garbage detector;
//              smooth skin/cloth scores low, broken normals/z-fighting score high)
// Requires `npm run dev`. Renders land in visual-diff/sweep/<id>.png.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/sweep");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const SLOT = arg("slot", "");
const START = Number(arg("start", "0"));
const LIMIT = Number(arg("limit", "100000"));

const CAMS = {
  face: { pos: [0, 1.62, 0.62], target: [0, 1.6, 0], fov: 30 },
  hair: { pos: [0, 1.66, 0.7], target: [0, 1.62, 0], fov: 30 },
  facialHair: { pos: [0, 1.6, 0.55], target: [0, 1.58, 0], fov: 30 },
  headwear: { pos: [0, 1.68, 0.8], target: [0, 1.62, 0], fov: 30 },
  facewear: { pos: [0, 1.6, 0.6], target: [0, 1.58, 0], fov: 30 },
  eyewear: { pos: [0, 1.62, 0.55], target: [0, 1.6, 0], fov: 30 },
  earrings: { pos: [0.3, 1.62, 0.5], target: [0, 1.6, 0], fov: 30 },
  upperBody: { pos: [0, 1.3, 1.45], target: [0, 1.25, 0], fov: 28 },
  outerwear: { pos: [0, 1.3, 1.6], target: [0, 1.2, 0], fov: 30 },
  lowerBody: { pos: [0, 0.62, 1.75], target: [0, 0.58, 0], fov: 30 },
  hands: { pos: [0.45, 1.05, 0.85], target: [0.18, 1.0, 0], fov: 28 },
  feet: { pos: [0.4, 0.35, 1.05], target: [0.05, 0.2, 0], fov: 30 },
  wrist: { pos: [0.78, 1.25, 0.45], target: [0.57, 1.13, 0], fov: 28 }, // watch on hand_l (A-pose)
  upperBack: { pos: [0, 1.35, -1.5], target: [0, 1.25, 0], fov: 30 },
  lowerBack: { pos: [0, 1.0, -1.5], target: [0, 0.95, 0], fov: 30 },
  // 2D decal slots (composited onto body/head — rendered with a head equipped)
  eyes: { pos: [0, 1.72, 0.32], target: [0, 1.705, 0], fov: 28, withFace: true },
  blush: { pos: [0, 1.62, 0.55], target: [0, 1.6, 0], fov: 30, withFace: true },
  tattoo: { pos: [0, 1.25, 1.3], target: [0, 1.2, 0], fov: 32 },
  bodyPaint: { pos: [0, 1.25, 1.3], target: [0, 1.2, 0], fov: 32 },
  nailPolish: { pos: [0.45, 1.05, 0.85], target: [0.18, 1.0, 0], fov: 28 },
};

// World-space sanity envelopes per slot: equipped cosmetic meshes must fit a plausible
// size and sit at a plausible height — catches mis-attached/mis-scaled statics (a 2m
// helmet, a mask containing the camera) without eyeballing every render.
const ENVELOPES = {
  face: { maxSize: 1.2, y: [1.0, 2.05] },
  hair: { maxSize: 1.0, y: [1.2, 2.1] },
  facialHair: { maxSize: 0.6, y: [1.3, 1.9] },
  headwear: { maxSize: 1.2, y: [1.25, 2.2] },
  facewear: { maxSize: 0.9, y: [1.25, 2.0] },
  eyewear: { maxSize: 0.6, y: [1.4, 1.9] },
  earrings: { maxSize: 0.5, y: [1.3, 1.9] },
  upperBody: { maxSize: 2.2, y: [0.5, 1.9] },
  outerwear: { maxSize: 2.4, y: [0.3, 1.9] },
  lowerBody: { maxSize: 1.6, y: [0.0, 1.55] }, // dresses/skirts reach the upper torso
  hands: { maxSize: 1.8, y: [0.6, 1.5] },
  feet: { maxSize: 1.0, y: [-0.05, 0.8] },
  wrist: { maxSize: 0.6, y: [0.7, 1.4] },
  upperBack: { maxSize: 2.0, y: [0.6, 2.0] },
  lowerBack: { maxSize: 1.2, y: [0.4, 1.4] },
};
// Rough per-slot probes (normalized rects) — ours on the render, icon on the 256 icon.
const PROBES = {
  upperBody: { ours: [0.42, 0.27, 0.16, 0.13], icon: [0.42, 0.48, 0.16, 0.16] },
  outerwear: { ours: [0.42, 0.3, 0.16, 0.13], icon: [0.42, 0.48, 0.16, 0.16] },
  lowerBody: { ours: [0.56, 0.38, 0.12, 0.16], icon: [0.42, 0.3, 0.16, 0.2] },
  feet: { ours: [0.59, 0.33, 0.13, 0.2], icon: [0.4, 0.42, 0.2, 0.22] },
  hands: { ours: [0.42, 0.45, 0.16, 0.16], icon: [0.4, 0.4, 0.2, 0.2] },
  face: { ours: [0.42, 0.42, 0.16, 0.16], icon: [0.42, 0.45, 0.16, 0.18] },
};

const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
let targets = items.filter((i) => (i.model?.gltfPath || i.decal) && CAMS[i.slot]);
if (SLOT) targets = targets.filter((i) => i.slot === SLOT);
targets = targets.slice(START, START + LIMIT);
console.log(`sweep: ${targets.length} items (start=${START})`);
mkdirSync(OUT, { recursive: true });

// --- color/metric helpers ----------------------------------------------------
const srgbToLinear = (b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const isBackdrop = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx > 175 && mx - mn < 28 && b >= r;
};

// Per-render backdrop: median of the four corner patches. A fixed heuristic misclassifies
// WHITE garments as backdrop; the actual backdrop color is always visible in the corners.
async function sampleBackdrop(absPath) {
  const img = sharp(absPath);
  const meta = await img.metadata();
  const s = 8;
  const cols = [];
  for (const [x, y] of [
    [0, 0],
    [meta.width - s, 0],
    [0, meta.height - s],
    [meta.width - s, meta.height - s],
  ]) {
    const { data, info } = await img
      .clone()
      .extract({ left: x, top: y, width: s, height: s })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    cols.push([r / n, g / n, b / n]);
  }
  cols.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return cols[1]; // lower-median corner (avoids a corner the character overlaps)
}
const nearColor = (px, c, tol = 26) =>
  Math.abs(px[0] - c[0]) < tol && Math.abs(px[1] - c[1]) < tol && Math.abs(px[2] - c[2]) < tol;

async function probeMean(absPath, rect) {
  try {
    const img = sharp(absPath);
    const meta = await img.metadata();
    const { data, info } = await img
      .extract({
        left: Math.round(rect[0] * meta.width),
        top: Math.round(rect[1] * meta.height),
        width: Math.max(2, Math.round(rect[2] * meta.width)),
        height: Math.max(2, Math.round(rect[3] * meta.height)),
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0,
      g = 0,
      b = 0,
      n = 0,
      total = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (info.channels > 3 && data[i + 3] < 128) continue;
      total++;
      if (isBackdrop(data[i], data[i + 1], data[i + 2])) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    return n && n / Math.max(total, 1) >= 0.3 ? [r / n, g / n, b / n] : null;
  } catch {
    return null;
  }
}

// center-crop metrics on our render: coverage + high-frequency noise (crust detector)
async function centerMetrics(absPath) {
  const backdrop = await sampleBackdrop(absPath);
  const img = sharp(absPath);
  const meta = await img.metadata();
  const crop = {
    left: Math.round(meta.width * 0.3),
    top: Math.round(meta.height * 0.3),
    width: Math.round(meta.width * 0.4),
    height: Math.round(meta.height * 0.4),
  };
  const { data, info } = await img.extract(crop).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    total++;
    if (!nearColor([data[i], data[i + 1], data[i + 2]], backdrop)) n++;
  }
  const coverage = total ? n / total : 0;
  // high-pass energy: mean |laplacian| of downscaled luminance
  const small = await sharp(absPath)
    .extract(crop)
    .resize(128, 128)
    .greyscale()
    .raw()
    .toBuffer();
  let acc = 0;
  let cnt = 0;
  for (let y = 1; y < 127; y++)
    for (let x = 1; x < 127; x++) {
      const i = y * 128 + x;
      const lap = 4 * small[i] - small[i - 1] - small[i + 1] - small[i - 128] - small[i + 128];
      acc += Math.abs(lap);
      cnt++;
    }
  return { coverage: Number(coverage.toFixed(3)), noise: Number((acc / cnt).toFixed(2)) };
}

// --- render loop ---------------------------------------------------------------
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
      /* next */
    }
  }
  throw new Error("no browser");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 760 }, deviceScaleFactor: 1 });
let pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text().slice(0, 160));
});
page.on("requestfailed", (r) => {
  if (!/favicon/.test(r.url())) pageErrors.push(`reqfail ${r.url().split("/").pop()}`);
});
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon/.test(r.url()))
    pageErrors.push(`http${r.status()} ${r.url().split("/").pop()}`);
});

const results = [];
let done = 0;
for (const item of targets) {
  const cam = CAMS[item.slot];
  // decal slots composite onto the head — equip a base face alongside
  const slots = cam.withFace
    ? { face: "head-face-03-base", [item.slot]: item.id }
    : { [item.slot]: item.id };
  const url = `${BASE}/?outfit=${encodeOutfit(slots)}&cam=${[...cam.pos, ...cam.target].join(",")}&fov=${cam.fov}&pose=a`;
  pageErrors = [];
  const rec = { id: item.id, slot: item.slot, name: item.name };
  try {
    // Retry with a long backoff on suspension errors — survives the machine sleeping
    // mid-sweep (network IO suspends, then recovers on wake).
    let nav = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        nav = true;
        break;
      } catch (e) {
        if (!/ERR_NETWORK_IO_SUSPENDED|ERR_INTERNET_DISCONNECTED/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 30000));
      }
    }
    if (!nav) throw new Error("navigation suspended too long");
    pageErrors = []; // drop noise from failed attempts
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 25000 });
    await page.waitForTimeout(450);
    const box = await page.locator("canvas").first().boundingBox();
    const shotPath = join(OUT, `${item.id}.png`);
    await page.screenshot({ path: shotPath, clip: box });
    const cm = await centerMetrics(shotPath);
    rec.coverage = cm.coverage;
    rec.noise = cm.noise;
    // world-space size/position sanity of the equipped cosmetic meshes
    const env = ENVELOPES[item.slot];
    if (env && item.model?.gltfPath) {
      const bb = await page.evaluate(() => {
        const THREE = window.__THREE;
        const box3 = new THREE.Box3();
        let any = false;
        window.__rigRoot.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (m.name === "M_Skin" || /_Head$|Eye|Teeth|lash|brow/i.test(m.name)) return;
          if (o.isSkinnedMesh) {
            // raw geometry of skinned meshes is normalized/unposed — use skinned bounds
            o.computeBoundingBox();
            box3.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
          } else {
            box3.expandByObject(o);
          }
          any = true;
        });
        return any
          ? { min: box3.min.toArray(), max: box3.max.toArray() }
          : null;
      });
      if (bb) {
        const size = bb.max.map((v, k) => v - bb.min[k]);
        const cy = (bb.max[1] + bb.min[1]) / 2;
        const maxDim = Math.max(...size);
        if (maxDim > env.maxSize || cy < env.y[0] || cy > env.y[1]) {
          rec.geom = `size ${maxDim.toFixed(2)}m cy ${cy.toFixed(2)} (limit ${env.maxSize}m y${env.y[0]}..${env.y[1]})`;
        }
      }
    }
    const probe = PROBES[item.slot];
    if (probe) {
      const ours = await probeMean(shotPath, probe.ours);
      const icon = await probeMean(resolve(ROOT, "public", item.imageUrl), probe.icon);
      if (ours && icon) {
        const a = linearToOklab(...ours.map(srgbToLinear));
        const b = linearToOklab(...icon.map(srgbToLinear));
        rec.dE = Number((100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toFixed(1));
      }
    }
  } catch (e) {
    rec.fatal = String(e).split("\n")[0].slice(0, 160);
  }
  rec.errors = [...new Set(pageErrors)].slice(0, 4);
  // composite badness for ranking
  rec.bad =
    (rec.fatal ? 100 : 0) +
    (rec.geom ? 40 : 0) +
    rec.errors.length * 25 +
    (rec.coverage !== undefined && rec.coverage < 0.05 ? 50 : 0) +
    (rec.dE !== undefined ? Math.min(rec.dE, 50) / 2 : 0) +
    (rec.noise !== undefined ? Math.min(rec.noise, 40) / 2 : 0);
  rec.bad = Number(rec.bad.toFixed(1));
  results.push(rec);
  done++;
  if (done % 25 === 0) console.log(`  …${done}/${targets.length}`);
}
await browser.close();

results.sort((a, b) => b.bad - a.bad);
const summary = {
  generatedAt: new Date().toISOString(),
  items: results.length,
  fatal: results.filter((r) => r.fatal).length,
  withErrors: results.filter((r) => r.errors.length).length,
  lowCoverage: results.filter((r) => r.coverage !== undefined && r.coverage < 0.05).length,
  meanDE: Number(
    (
      results.filter((r) => r.dE !== undefined).reduce((a, r) => a + r.dE, 0) /
      Math.max(1, results.filter((r) => r.dE !== undefined).length)
    ).toFixed(1),
  ),
};
writeFileSync(resolve(ROOT, "visual-diff/sweep.json"), JSON.stringify({ summary, results }, null, 1));

const rows = results
  .slice(0, 400)
  .map(
    (r) => `<tr class="${r.bad > 40 ? "fail" : r.bad > 18 ? "warn" : ""}">
  <td><img loading="lazy" src="sweep/${r.id}.png"></td>
  <td><img loading="lazy" src="../public/${(items.find((i) => i.id === r.id) ?? {}).imageUrl ?? ""}"></td>
  <td>${r.id}<br><small>${r.slot} · ${r.name}</small></td>
  <td>${r.bad}</td><td>${r.dE ?? ""}</td><td>${r.noise ?? ""}</td><td>${r.coverage ?? ""}</td>
  <td><small>${r.fatal ?? ""}${r.geom ?? ""}${r.errors.join("<br>")}</small></td></tr>`,
  )
  .join("\n");
writeFileSync(
  resolve(ROOT, "visual-diff/sweep-report.html"),
  `<!doctype html><meta charset="utf-8"><title>sweep</title>
<style>body{font:13px system-ui;background:#16181d;color:#dde}
table{border-collapse:collapse}td{padding:4px 8px;border-bottom:1px solid #333;vertical-align:top}
img{height:110px;border-radius:6px;background:#dfe3ea}
.fail td{background:#3a1518}.warn td{background:#33270f}</style>
<h1>sweep — ${summary.items} items · ${summary.fatal} fatal · ${summary.withErrors} with errors · ${summary.lowCoverage} low-coverage · mean ΔE ${summary.meanDE}</h1>
<table><tr><th>render</th><th>icon</th><th>item</th><th>bad</th><th>ΔE</th><th>noise</th><th>cov</th><th>errors</th></tr>
${rows}</table>`,
);
console.log(JSON.stringify(summary));
console.log(`report -> visual-diff/sweep-report.html (worst 400 shown)`);
