// compare.mjs — score rendered cases against their official icons.
//
//   node scripts/visual-diff/compare.mjs
//
// For each case, sample the probe rects (cases.json) on our render and on the icon,
// excluding backdrop/mannequin-looking pixels, and report the Oklab ΔE (×100; ≲5 is a
// good match) between the mean colors. Output:
//   visual-diff/scores.json  — machine-readable results (regression baseline)
//   visual-diff/report.html  — ours | icon side-by-side with probe overlays + ΔE table
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff");
const RENDERS = join(OUT, "out");

const { defaults, cases } = JSON.parse(readFileSync(join(SCRIPT_DIR, "cases.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));

// --- color math -------------------------------------------------------------
const srgbToLinear = (b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
// linear sRGB -> Oklab (Björn Ottosson's reference constants)
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
const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Light low-saturation blue-leaning pixels are the icon backdrop / preview mannequin —
// and our studio backdrop was matched to it, so one filter serves both images.
const isBackdrop = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx > 175 && mx - mn < 28 && b >= r;
};

async function probeMean(absPath, rect, filter = true) {
  const img = sharp(absPath);
  const meta = await img.metadata();
  const left = Math.round(rect[0] * meta.width);
  const top = Math.round(rect[1] * meta.height);
  const width = Math.max(2, Math.round(rect[2] * meta.width));
  const height = Math.max(2, Math.round(rect[3] * meta.height));
  const { data, info } = await img
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (info.channels > 3 && data[i + 3] < 128) continue; // transparent icon padding
    total++;
    if (filter && isBackdrop(data[i], data[i + 1], data[i + 2])) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return null;
  return {
    rgb: [r / n, g / n, b / n],
    coverage: total ? n / total : 0,
  };
}

// Draw probe rects onto an image for the report (so misaligned probes are obvious).
async function overlay(absPath, rects, dest) {
  const meta = await sharp(absPath).metadata();
  const svgRects = rects
    .map((r) => {
      const [x, y, w, h] = r;
      return `<rect x="${x * meta.width}" y="${y * meta.height}" width="${w * meta.width}" height="${h * meta.height}" fill="none" stroke="#ff2255" stroke-width="2"/>`;
    })
    .join("");
  const svg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${svgRects}</svg>`);
  await sharp(absPath).composite([{ input: svg }]).png().toFile(dest);
}

const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// --- main -------------------------------------------------------------------
const results = [];
for (const c of cases) {
  const item = byId.get(c.id);
  const renderPath = join(RENDERS, `${c.id}.png`);
  if (!item || !existsSync(renderPath)) continue;
  const iconPath = resolve(ROOT, "public", item.imageUrl);
  if (!existsSync(iconPath)) continue;
  const probes = c.probes ?? defaults.probes[item.slot] ?? [];
  const probeResults = [];
  for (const p of probes) {
    // filter:false — white garments are indistinguishable from the backdrop by color, so
    // those probes must sit fully inside the garment and skip the exclusion filter.
    const ours = await probeMean(renderPath, p.ours, p.filter !== false);
    const icon = await probeMean(iconPath, p.icon, p.filter !== false);
    if (!ours || !icon) {
      probeResults.push({ name: p.name, error: "probe empty after exclusion" });
      continue;
    }
    const a = linearToOklab(...ours.rgb.map(srgbToLinear));
    const b = linearToOklab(...icon.rgb.map(srgbToLinear));
    probeResults.push({
      name: p.name,
      ours: toHex(ours.rgb),
      icon: toHex(icon.rgb),
      dE: Number(dE(a, b).toFixed(2)),
      coverage: { ours: Number(ours.coverage.toFixed(2)), icon: Number(icon.coverage.toFixed(2)) },
      unreliable: ours.coverage < 0.3 || icon.coverage < 0.3 || undefined,
    });
  }
  await overlay(renderPath, probes.map((p) => p.ours), join(RENDERS, `${c.id}.probe.png`));
  await overlay(iconPath, probes.map((p) => p.icon), join(RENDERS, `${c.id}.icon.probe.png`));
  results.push({
    id: c.id,
    slot: item.slot,
    anchor: c.anchor ?? false,
    holdout: c.holdout ?? false,
    probes: probeResults,
  });
}

const scored = results.flatMap((r) => r.probes.filter((p) => p.dE !== undefined && !p.unreliable));
const mean = scored.length ? scored.reduce((a, p) => a + p.dE, 0) / scored.length : NaN;
const summary = {
  generatedAt: new Date().toISOString(),
  cases: results.length,
  probesScored: scored.length,
  meanDE: Number(mean.toFixed(2)),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "scores.json"), JSON.stringify({ summary, results }, null, 2) + "\n");

// --- report -----------------------------------------------------------------
const rows = results
  .map((r) => {
    const probeRows = r.probes
      .map((p) =>
        p.error
          ? `<tr><td>${p.name}</td><td colspan="4">${p.error}</td></tr>`
          : `<tr${p.unreliable ? ' class="bad"' : ""}><td>${p.name}</td>
             <td><span class="sw" style="background:${p.ours}"></span>${p.ours}</td>
             <td><span class="sw" style="background:${p.icon}"></span>${p.icon}</td>
             <td>${p.dE}</td><td>${p.coverage.ours}/${p.coverage.icon}${p.unreliable ? " ⚠" : ""}</td></tr>`,
      )
      .join("");
    return `<section>
      <h3>${r.id} <small>${r.slot}${r.anchor ? " · anchor" : ""}${r.holdout ? " · holdout" : ""}</small></h3>
      <div class="pair">
        <img src="out/${r.id}.probe.png" alt="ours"/>
        <img src="out/${r.id}.icon.probe.png" alt="icon"/>
      </div>
      <table><tr><th>probe</th><th>ours</th><th>icon</th><th>ΔE(ok)</th><th>cov</th></tr>${probeRows}</table>
    </section>`;
  })
  .join("\n");
writeFileSync(
  join(OUT, "report.html"),
  `<!doctype html><meta charset="utf-8"><title>visual-diff</title>
<style>
 body{font:14px system-ui;background:#16181d;color:#dde}
 section{margin:24px;padding:16px;background:#1d2026;border-radius:12px;max-width:880px}
 .pair{display:flex;gap:12px}
 .pair img{height:300px;border-radius:8px;background:#dfe3ea;object-fit:contain}
 table{border-collapse:collapse;margin-top:8px}
 td,th{padding:3px 10px;border-bottom:1px solid #333;text-align:left}
 .sw{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:-2px}
 .bad td{opacity:.5}
 h3 small{color:#889;font-weight:400}
</style>
<h1>visual-diff — mean ΔE ${summary.meanDE} over ${summary.probesScored} probes (${summary.cases} cases)</h1>
${rows}`,
);
console.log(`mean ΔE(ok×100): ${summary.meanDE} over ${summary.probesScored} probes`);
console.log(`report -> ${join(OUT, "report.html")}`);
