// color-model.mjs — the fitted display transform for authored garment colors.
//
// The game's compiled layered shader does not use a skin's BaseColorOverlay as final
// albedo: rendered garments come out brighter/more saturated than the raw vector
// (verified against official icons; e.g. authored #a07819 renders as ~#eeb606). The
// shader graph isn't extractable from the dump, so scripts/visual-diff/calibrate-blend.mjs
// fits a small parametric op against icon ground truth and writes color-model.json next
// to this file; import-catalog applies it when emitting regionColors. No params file (or
// op "identity") = pass-through.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PARAMS_FILE = join(dirname(fileURLToPath(import.meta.url)), "color-model.json");

export const COLOR_MODEL = existsSync(PARAMS_FILE)
  ? JSON.parse(readFileSync(PARAMS_FILE, "utf8"))
  : { op: "identity", params: {} };

// --- color helpers (sRGB bytes <-> linear <-> Oklab) -------------------------
export const srgbToLinear = (b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
export const linearToSrgb = (c) => {
  c = Math.max(0, Math.min(1, c));
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
};
export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// --- the op family ------------------------------------------------------------
// All ops take/return sRGB bytes [r,g,b]. Implementations are shared by the calibrator
// (fitting) and the importer (baking), so they must stay pure and dependency-free.
export const OPS = {
  identity: (rgb) => rgb,

  // Shared per-channel gain+gamma in sRGB: out = k * c^gamma. gamma<1 lifts mids
  // (keeps black), k trims the top end.
  gainGamma: (rgb, { k, gamma }) =>
    rgb.map((v) => Math.max(0, Math.min(255, 255 * k * Math.pow(v / 255, gamma)))),

  // Affine in Oklab: L' = a + b*L, chroma scaled by s (saturation boost without hue shift).
  oklabAffine: (rgb, { a, b, s }) => {
    const [L, A, B] = linearToOklab(...rgb.map(srgbToLinear));
    const lin = oklabToLinear(a + b * L, s * A, s * B);
    return lin.map(linearToSrgb);
  },

  // Photoshop "overlay" against a fitted scalar pivot p (per channel, sRGB space):
  // the classic contrast-boost shape — brightens where the authored color is bright.
  overlayPivot: (rgb, { p }) =>
    rgb.map((v) => {
      const c = v / 255;
      const o = p <= 0.5 ? 2 * p * c : 1 - 2 * (1 - p) * (1 - c);
      return Math.max(0, Math.min(255, o * 255));
    }),
};

export function applyOp(op, rgb, params) {
  const fn = OPS[op];
  if (!fn) throw new Error(`unknown color-model op '${op}'`);
  return fn(rgb, params);
}

// hex -> hex through the active model (the importer's entry point).
export function applyColorModel(hex) {
  if (COLOR_MODEL.op === "identity") return hex;
  const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16));
  const out = applyOp(COLOR_MODEL.op, rgb, COLOR_MODEL.params);
  return "#" + out.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
