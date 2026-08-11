// calibrate-blend.mjs — fit the authored-color -> displayed-albedo transform against
// official icons, using the visual-diff cases.
//
//   npm run visual:render -- --albedo     (renders lit + albedo for every case first)
//   node scripts/visual-diff/calibrate-blend.mjs
//
// Method: for each fit case we have three probe means — our LIT render, our ALBEDO render
// (unlit, NoToneMapping: exactly sRGB(albedo)), and the icon. For diffuse-dominated cloth,
// lit ≈ irradiance ⊙ albedo per channel in linear space, so the probe's irradiance
// I = lin(lit)/lin(albedo) is measured once from the current render pair, and any candidate
// op T can be evaluated WITHOUT re-rendering: predicted lit = I ⊙ lin(T(albedo)).
// The loss is Oklab ΔE(predicted, icon) over fit cases, plus an anchor penalty that holds
// T ≈ identity on near-neutral items (so the op can't absorb lighting-rig error).
// The winner is written to scripts/lib/color-model.json (consumed by import-catalog via
// scripts/lib/color-model.mjs); holdout cases report generalization without re-rendering.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { OPS, applyOp, srgbToLinear, linearToOklab } from "../lib/color-model.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const RENDERS = resolve(ROOT, "visual-diff/out");
const PARAMS_OUT = resolve(ROOT, "scripts/lib/color-model.json");

const { defaults, cases } = JSON.parse(readFileSync(join(SCRIPT_DIR, "cases.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));

// --- probe sampling (same exclusion logic as compare.mjs) ---------------------
const isBackdrop = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx > 175 && mx - mn < 28 && b >= r;
};
async function probeMean(absPath, rect, filter = true) {
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
    if (filter && isBackdrop(data[i], data[i + 1], data[i + 2])) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n && n / Math.max(total, 1) >= 0.3 ? [r / n, g / n, b / n] : null;
}

const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const okOf = (rgb) => linearToOklab(...rgb.map(srgbToLinear));

// --- collect samples -----------------------------------------------------------
const samples = [];
for (const c of cases) {
  const item = byId.get(c.id);
  if (!item) continue;
  const probes = c.probes ?? defaults.probes[item.slot] ?? [];
  const litPath = join(RENDERS, `${c.id}.png`);
  const albPath = join(RENDERS, `${c.id}.albedo.png`);
  const iconPath = resolve(ROOT, "public", item.imageUrl);
  if (!existsSync(litPath) || !existsSync(albPath) || !existsSync(iconPath)) continue;
  for (const p of probes) {
    const filter = p.filter !== false;
    const lit = await probeMean(litPath, p.ours, filter);
    const alb = await probeMean(albPath, p.ours, filter);
    const icon = await probeMean(iconPath, p.icon, filter);
    if (!lit || !alb || !icon) continue;
    // Per-channel linear irradiance measured from the current render pair.
    const I = lit.map((v, k) => {
      const a = srgbToLinear(alb[k]);
      return a > 1e-4 ? Math.min(srgbToLinear(v) / a, 4) : 1;
    });
    samples.push({ id: c.id, anchor: !!c.anchor, holdout: !!c.holdout, lit, alb, icon, I });
  }
}
// Role assignment. Neutral "anchor" items are the most trustworthy FIT evidence (their
// flat-color decode has no pattern/texture path), so they join the fit set. The identity
// constraint only holds for near-WHITE items: the icons show dark neutrals strongly
// lifted in-game (authored #383b3d boots -> icon #757677) while whites stay put — i.e.
// the game applies a lift curve, and only the top of the curve is a fixed point.
const okLumaOf = (rgb) => linearToOklab(...rgb.map(srgbToLinear))[0];
const fitSet = samples.filter((s) => !s.holdout);
const anchorSet = samples.filter((s) => s.anchor && okLumaOf(s.alb) >= 0.85);
const holdoutSet = samples.filter((s) => s.holdout);
console.log(`samples: fit=${fitSet.length} white-anchors=${anchorSet.length} holdout=${holdoutSet.length}`);
if (fitSet.length < 8) {
  console.error("too few fit samples — check renders (did you run visual:render -- --albedo?)");
  process.exit(1);
}

// --- loss ------------------------------------------------------------------------
const ANCHOR_WEIGHT = 0.75;
// Per-sample cap: a few cases use texture/pattern color paths the importer can't decode
// yet — they carry huge residuals no global op can fix and would otherwise drag the fit.
const SAMPLE_CAP = 25;
function predict(sample, op, params) {
  const t = applyOp(op, sample.alb, params); // displayed albedo under candidate op
  const lin = t.map((v, k) => Math.min(srgbToLinear(v) * sample.I[k], 1));
  return linearToOklab(...lin);
}
function loss(op, params) {
  let sum = 0;
  for (const s of fitSet) sum += Math.min(dE(predict(s, op, params), okOf(s.icon)), SAMPLE_CAP);
  let anchorPen = 0;
  for (const s of anchorSet) anchorPen += dE(okOf(applyOp(op, s.alb, params)), okOf(s.alb));
  return sum / fitSet.length + (ANCHOR_WEIGHT * anchorPen) / Math.max(anchorSet.length, 1);
}
function evalSet(set, op, params) {
  if (!set.length) return NaN;
  let sum = 0;
  for (const s of set) sum += dE(predict(s, op, params), okOf(s.icon));
  return sum / set.length;
}

// --- grid + refine fitting ---------------------------------------------------------
function fit(op, grid) {
  const names = Object.keys(grid);
  let best = null;
  const walk = (idx, acc) => {
    if (idx === names.length) {
      const l = loss(op, acc);
      if (!best || l < best.loss) best = { loss: l, params: { ...acc } };
      return;
    }
    for (const v of grid[names[idx]]) walk(idx + 1, { ...acc, [names[idx]]: v });
  };
  walk(0, {});
  // local refine: shrink steps around the best point
  for (let round = 0; round < 3; round++) {
    for (const name of names) {
      const span = (grid[name].at(-1) - grid[name][0]) / grid[name].length / (round + 1);
      for (const delta of [-span, span]) {
        const cand = { ...best.params, [name]: best.params[name] + delta };
        const l = loss(op, cand);
        if (l < best.loss) best = { loss: l, params: cand };
      }
    }
  }
  return best;
}

const range = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const candidates = {
  identity: { params: {}, loss: loss("identity", {}) },
  gainGamma: fit("gainGamma", { k: range(0.8, 1.6, 9), gamma: range(0.45, 1.1, 14) }),
  oklabAffine: fit("oklabAffine", { a: range(-0.05, 0.3, 8), b: range(0.7, 1.4, 8), s: range(0.8, 2.2, 8) }),
  overlayPivot: fit("overlayPivot", { p: range(0.5, 0.85, 15) }),
};

console.log("\nop           fit-loss  fitΔE  holdoutΔE  anchorΔE(id-dev)  params");
let winner = null;
for (const [op, r] of Object.entries(candidates)) {
  const fitDE = evalSet(fitSet, op, r.params);
  const holdDE = evalSet(holdoutSet, op, r.params);
  const anchorDev = anchorSet.length
    ? anchorSet.reduce((a, s) => a + dE(okOf(applyOp(op, s.alb, r.params)), okOf(s.alb)), 0) /
      anchorSet.length
    : 0;
  console.log(
    `${op.padEnd(13)}${r.loss.toFixed(2).padStart(8)}${fitDE.toFixed(2).padStart(8)}${holdDE
      .toFixed(2)
      .padStart(10)}${anchorDev.toFixed(2).padStart(12)}      ${JSON.stringify(r.params)}`,
  );
  if (!winner || r.loss < winner.loss) winner = { op, ...r, fitDE, holdDE };
}

console.log(`\nwinner: ${winner.op} ${JSON.stringify(winner.params)}`);
if (winner.op === "identity") {
  console.log("identity wins — leaving color-model.json untouched");
} else {
  writeFileSync(PARAMS_OUT, JSON.stringify({ op: winner.op, params: winner.params }, null, 2) + "\n");
  console.log(`wrote ${PARAMS_OUT}`);
  console.log("next: npm run import:catalog && npm run visual:diff   (true end-to-end check)");
}
