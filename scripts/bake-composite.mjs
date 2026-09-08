// bake-composite.mjs — reconstruct THE FINALS' layered garment material per skin and bake
// the finished look to swappable UV0 texture sets (albedo / normal / orm) in Node + sharp.
//
// WHY: the cooked dump strips the layered master's expression graph, and the converter bakes
// only a neutral base + normal while the runtime paints one flat color per region (mean ΔE
// ~15) — dropping the per-layer tiled detail, two-tone routing, patterns and cloth. This
// composites the real look from the param set + the per-skin Texture2DArray slices, entirely
// in UV0 image-space (no Blender / no bake-from-mesh: authored maps are sampled 1:1 at (u,v),
// tiled detail at frac(uv*tiling)). Output is a finished per-skin texture set that the runtime
// swaps in on equip, retiring the region-tint approximation for these skins.
//
// Reconstruction is an approximation of a stripped graph — calibrate against official icons
// (scripts/visual-diff). See the `finals-layered-material` / `material-dye-system` memories.
//
// Usage:
//   node scripts/bake-composite.mjs --piece=casual/longcoat [--skin=Leather_Black|all] [--res=1024] [--force] [--debug]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import sharp from "sharp";
import { texturePath, arraySlices, baseMaterialOf } from "./lib/layered-mi.mjs";
import { resolveSkinMaterialSlots } from "./lib/material-instances.mjs";
import { buildSourceMaterialBinding } from "./lib/material-textures.mjs";
import {
  COLOR_MODEL,
  applyOp,
  srgbToLinear,
  linearToSrgb,
} from "./lib/color-model.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MODELS = resolve(ROOT, "public", "models");
const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

// --- CLI ---------------------------------------------------------------------
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const PIECE = (argv.piece ?? "").toLowerCase();
const SKIN_FILTER = argv.skin && argv.skin !== "all" ? String(argv.skin).toLowerCase().split(",") : null;
const RES = Number(argv.res ?? 1024);
const NORMAL_RES = Number(argv["normal-res"] ?? RES);
const FORCE = !!argv.force || process.env.BAKE_FORCE === "1";
const DEBUG = !!argv.debug;

// --- small vec/color helpers (linear rgb as [r,g,b]) -------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// Edge/crease colour overlays are curvature-gated (OCM.G). They're a stripped-graph
// reconstruction: gate only STRONG convex/concave so worn edges/creases stay thin instead of
// tinting the whole surface. Disable via BAKE_NO_EDGE=1 for A/B calibration.
const EDGE_ENABLED = process.env.BAKE_NO_EDGE !== "1";
// How strongly an active layer pattern (e.g. camo) defines the surface colour. The MI's
// PatternMask.A (~0.17 for LongCoat camo) is far too weak to match the icon — the camo is the
// coat's surface, not a faint overlay — so the pattern is applied near-fully by default.
const PATTERN_STRENGTH = Number(process.env.BAKE_PATTERN_STRENGTH ?? 0.92);
// How much of the OCM.R occlusion to bake into the albedo. The dump's AO has strong, contrasty
// vertical drape-fold lines; multiplying it in full was the dominant source of the back-skirt
// streaking. The game applies AO softly, so bake only a fraction (the lighting + geometry do
// the rest). 0 = no baked AO, 1 = full. BAKE_AO_STRENGTH overrides.
const AO_STRENGTH = Number(process.env.BAKE_AO_STRENGTH ?? 0.25);
// UE BaseMetallicity is a layered-shader input, NOT glTF metalness. Partial values (e.g. satin
// L1 = 0.5) are "shiny fabric", not metal — mapping them to glTF metalness makes the fabric a
// half-mirror that reflects the studio panels as fold streaks. Treat only near-full metalness
// (real metal trim) as glTF-metallic; everything below becomes a dielectric (sheen via roughness).
// Real metal trim is authored at EXACTLY 1.0 (dump histogram: 1611 values at 1.0, with a clean
// gap below — 0.1..0.9 are "shiny fabric" shader inputs, NOT glTF metal: satin 0.5, mariachi 0.9).
// Gate at 0.95 so only true 1.0 metal becomes glTF-metallic; 0.8/0.9 fabrics stay dielectric
// (matte), fixing the chrome mis-gate (mariachi etc.) without touching real metal trim.
const METAL_THRESHOLD = Number(process.env.BAKE_METAL_THRESHOLD ?? 0.95);
// Tiled detail-normal strength multiplier. The raw per-layer strengths (esp. MediumNormal
// ~1.1) over-steepen the combined normal; damp by default. Env sets the global default.
const NORMAL_STRENGTH_DEFAULT = Number(process.env.BAKE_NORMAL_STRENGTH ?? 0.3);
// Floor on baked roughness. The bright softbox studio turns glossy normal-mapped folds into
// harsh specular streaks; mattening removes them (the coat folds then read as soft diffuse
// shading, matching the matte in-game icons). Env sets the global default.
const ROUGH_FLOOR_DEFAULT = Number(process.env.BAKE_ROUGH_FLOOR ?? 0.5);
// Per-skin tuning overrides (reproducible — re-baking restores the dialed-in look). Matte,
// folded materials (leather) need a higher floor than intentionally-glossy ones (satin sheen).
// Keyed by skin folder name, lowercased.
// macroNormalStrength damps the authored macro normal (T_<piece>_Normal) — its coat
// seam/panel ridges are the dominant streak source under the softbox, and the cloth-sim mesh
// already carries the fold geometry, so the normal map is largely redundant harsh detail.
const MACRO_NORMAL_DEFAULT = Number(process.env.BAKE_MACRO_NORMAL ?? 0.4);
// Look tuning keyed by BASE MATERIAL (not per-skin): every recolor of a base shares its arrays
// and its surface character, so one entry seeds all of them. Matte fabrics (leather) need a
// high roughness floor so the cloth-sim drape reads as soft diffuse shading instead of harsh
// softbox specular streaks; intentionally-glossy fabrics (satin) keep a lower floor so their
// fold highlights read as sheen. Unknown bases fall back to a mild matte default.
// The dump's macro normal (T_<piece>_Normal) is a STRONG wrinkle/seam map; at full strength it
// reads as harsh vertical streak banding under the directional studio (isolated by swapping in a
// flat normal — the coat then renders clean). Leather/satin are smooth materials, so keep both
// the macro and the tiled detail normal very light; the mesh geometry already provides the drape.
const BASE_TUNING = {
  leather: { roughFloor: 0.78, normalStrength: 0, macroNormalStrength: 0 },
  satin: { roughFloor: 0.62, normalStrength: 0, macroNormalStrength: 0 },
  polyesterblend: { roughFloor: 0.7, normalStrength: 0, macroNormalStrength: 0 },
};
// Default: flat normal too (safest — the streaking is the macro-normal amplitude under grazing
// light; re-introduce a low normal per-piece only after verifying it stays streak-free).
const DEFAULT_TUNING = { roughFloor: 0.65, normalStrength: 0, macroNormalStrength: 0 };

// The fitted oklabAffine display model lifts/saturates authored colors to match icons — but
// it was fit for the FLAT region-tint pipeline (where the lifted color IS the lit diffuse). In
// the baked path we physically light a real albedo + normal + roughness, so the lighting does
// the lifting; applying the model too would double-brighten (very dark colors wash out). Raw
// authored albedo is the "correct by construction" default; BAKE_COLOR_MODEL=1 re-enables it.
const USE_COLOR_MODEL = process.env.BAKE_COLOR_MODEL === "1" && COLOR_MODEL.op !== "identity";
function applyColorModelLinear(rgb) {
  if (!USE_COLOR_MODEL) return rgb;
  const bytes = rgb.map(linearToSrgb);
  const out = applyOp(COLOR_MODEL.op, bytes, COLOR_MODEL.params);
  return out.map(srgbToLinear);
}

// --- raw image load + bilinear sampler ---------------------------------------
async function loadRaw(path) {
  if (!path || !existsSync(path)) return null;
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
// Bilinear sample → [r,g,b,a] in 0..255 floats. wrap: "repeat" (tiled) | "clamp" (1:1).
function sample(raw, u, v, wrap) {
  const { data, w, h, ch } = raw;
  const x = u * w - 0.5;
  const y = v * h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const wi = (i, n) => (wrap === "repeat" ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i);
  const x0w = wi(x0, w);
  const x1w = wi(x0 + 1, w);
  const y0w = wi(y0, h);
  const y1w = wi(y0 + 1, h);
  const at = (xx, yy, k) => data[(yy * w + xx) * ch + (k < ch ? k : ch - 1)];
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = at(x0w, y0w, k);
    const b = at(x1w, y0w, k);
    const c = at(x0w, y1w, k);
    const d = at(x1w, y1w, k);
    out[k] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  return out;
}

// Tangent-space normal: decode XY, reconstruct Z (= the proven fixNormalMaps approach; the
// dump packs cavity/AO into B, so never trust it). Unreal stores tangent normals in the
// DirectX convention, while the glTF/three.js tangent basis is OpenGL; flip G at this
// boundary. BAKE_NORMAL_GREEN_FLIP=0 retains the pre-fix decode for an attributed A/B render.
const NORMAL_GREEN_FLIP = process.env.BAKE_NORMAL_GREEN_FLIP !== "0";
function decodeNormal(rgba) {
  const x = (rgba[0] / 255) * 2 - 1;
  const y0 = (rgba[1] / 255) * 2 - 1;
  const y = NORMAL_GREEN_FLIP ? -y0 : y0;
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return [x, y, z];
}
// UDN blend: add detail XY onto base XY (scaled), keep base Z; normalize once at the end.
function udn(base, det, strength) {
  return [base[0] + det[0] * strength, base[1] + det[1] * strength, base[2]];
}

// --- per-layer params --------------------------------------------------------
function layerParams(mi, L, globalTiling) {
  const s = (k, d = 0) => mi.scalars[`${L}_${k}`] ?? d;
  const vec = (k) => mi.vectors[`${L}_${k}`];
  const rgb = (k, d) => {
    const x = vec(k);
    return x ? [x.r, x.g, x.b] : d;
  };
  const alpha = (k) => vec(k)?.a ?? 0;
  const patActive =
    alpha("PatternColorA") > 0 || alpha("PatternColorB") > 0 || alpha("PatternColorC") > 0;
  return {
    baseOverlay: rgb("BaseColorOverlay", [0.5, 0.5, 0.5]),
    baseColorMaskStrength: s("BaseColorMaskStrength", 0),
    baseTextureStrength: s("BaseTextureStrength", 1),
    colorTextureID: Math.round(s("ColorTextureID", 0)),
    colorTextureTiling: s("ColorTextureTiling", 1) * globalTiling,
    detailTiling: s("DetailTiling", 1) * globalTiling,
    baseNormalID: Math.round(s("BaseNormalID", 0)),
    mediumNormalID: Math.round(s("MediumNormalID", 0)),
    mediumNormalTiling: s("MediumNormalTiling", 1) * globalTiling,
    mediumNormalStrength: s("MediumNormalStrength", 0),
    baseRoughnessID: Math.round(s("BaseRoughnessID", 0)),
    baseRoughnessTiling: s("BaseRoughnessTiling", 1) * globalTiling,
    baseRoughness: s("BaseRoughness", 0.5),
    baseMetallicity: s("BaseMetallicity", 0),
    edgeRgb: rgb("EdgeColorOverlay", [1, 1, 1]),
    edgeA: alpha("EdgeColorOverlay"),
    edgeAmount: s("EdgeAmount", 0),
    creaseRgb: rgb("CreaseColorOverlay", [0, 0, 0]),
    creaseA: alpha("CreaseColorOverlay"),
    creaseAmount: s("CreaseAmount", 0),
    patternTiling: s("PatternTiling", 1) * globalTiling,
    patternMaskA: vec("PatternMask")?.a ?? 0,
    pattern: patActive
      ? {
          a: rgb("PatternColorA", [0, 0, 0]),
          b: rgb("PatternColorB", [0, 0, 0]),
          c: rgb("PatternColorC", [0, 0, 0]),
        }
      : null,
  };
}

// A scheme swatch (ColorA/B/C, LINEAR rgb) is a default PLACEHOLDER when it's near-white or a
// pure saturated primary (red/green/blue) — the per-instance default palette. Blending a real
// overlay toward such a swatch washes it out (the SentinelTop pauldrons baked white because
// their dark overlay was blended toward a red/white placeholder scheme).
//
// NEAR-BLACK IS NOT A PLACEHOLDER, and testing for it cost 96 of 1,968 baked albedos.
// Black is the most common authored garment colour in this game — carbon fibre, leather,
// tactical — and it is not a plausible engine default in a palette whose other defaults are
// pure red, green and blue. Treating it as unset discarded the real colour: the racing
// helmet's ColorA is rgb(0.010, 0.010, 0.010), its actual carbon weave, and rejecting it left
// two layers authored white-with-maskStrength-1 untinted, so the helmet baked WHITE. The
// region-tint path reads the same ColorA and correctly emits #1a1a1a, which is the proof the
// source data was fine. See _docs/2026-08-14-white-patches.md.
//
// The SentinelTop case stays covered by the `ovMin > 0.85` gate at the call site: only a
// near-white "tint me" overlay is ever blended, so a dark overlay can no longer be washed out
// regardless of what the scheme contains.
function isPlaceholderSwatch(c) {
  if (!c) return true;
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  if (mn > 0.85) return true; // near-white
  const mid = c[0] + c[1] + c[2] - mx - mn;
  return mx > 0.85 && mid < 0.15 && mn < 0.15; // pure primary (FF0000 etc.)
}

// Color-scheme selector: the ColorMask routes ColorA/B/C by its R/G/B channels. UE's 3-colour
// mask is a SEQUENTIAL OVERLAY (start from ColorA, lerp toward ColorB by the G channel, then
// toward ColorC by the B channel — later channels win), NOT a normalized average. The average
// muddied two-tone pieces badly: a YELLOW (R+G) mask region — a dark ColorB heel/cuff/shoulder
// pad — averaged to (body+dark)/2 and read half-bright instead of dark; a MAGENTA (R+B) white
// region read as a half-tint. The overlay model makes a saturated G region land on pure ColorB.
function schemeColor(maskRgba, mi) {
  const cA = mi.vectors.ColorA;
  const cB = mi.vectors.ColorB;
  const cC = mi.vectors.ColorC;
  const wg = maskRgba[1] / 255;
  const wb = maskRgba[2] / 255;
  // Substitute per-swatch rather than discarding the whole scheme. A skin often carries one
  // real colour and leaves the other two as the engine's default primaries — the racing helmet
  // is ColorA black with ColorB pure green and ColorC pure blue. Falling back to the first real
  // swatch keeps ColorA usable while stopping a placeholder green/blue being painted into any
  // region the mask routes to B or C.
  const raw = (v) => (v ? [v.r, v.g, v.b] : null);
  const [rA, rB, rC] = [raw(cA), raw(cB), raw(cC)];
  const fallback = [rA, rB, rC].find((v) => v && !isPlaceholderSwatch(v)) ?? [0, 0, 0];
  const pick = (v) => (v && !isPlaceholderSwatch(v) ? v : fallback);
  const a = pick(rA);
  const b = pick(rB);
  const c = pick(rC);
  let out = a.slice(); // ColorA is the base (mask red / no other channel)
  out = mix3(out, b, wg); // ColorB where the mask's green channel is on
  out = mix3(out, c, wb); // ColorC where the mask's blue channel is on
  return out;
}

// Grayscale pattern value -> one of the three camo swatches by tonal band. Biased toward the
// first swatch (the dark base of the camo) so the coat reads near-black with sparser accent
// blotches, matching the icon (a black coat with subtle grey-green digital camo).
function patternColor(pv, pat) {
  if (pv < 0.55) return pat.a;
  if (pv < 0.82) return pat.b;
  return pat.c;
}

// --- piece resolution --------------------------------------------------------
function resolvePiece(piece) {
  const mbp = join(SCRIPT_DIR, "model-by-piece.generated.json");
  const map = existsSync(mbp) ? JSON.parse(readFileSync(mbp, "utf8")) : {};
  const glbRel = map[piece]; // e.g. "models/cosmetics/casual-long-coat.glb"
  if (!glbRel) throw new Error(`piece '${piece}' not in model-by-piece.generated.json`);
  const slug = basename(glbRel).replace(/\.glb$/, "");
  const dst = glbRel.replace(/^models\//, ""); // "cosmetics/casual-long-coat.glb"
  const srcFile = existsSync(join(SCRIPT_DIR, "asset-sources.generated.json"))
    ? join(SCRIPT_DIR, "asset-sources.generated.json")
    : join(SCRIPT_DIR, "asset-sources.json");
  const assets = JSON.parse(readFileSync(srcFile, "utf8")).assets ?? [];
  const asset = assets.find((a) => a.dst === dst);
  if (!asset) throw new Error(`no asset-sources entry with dst '${dst}'`);
  const pieceDir = dirname(asset.src); // dump-relative, e.g. "Casual/Assets/LongCoat"
  return { slug, pieceDir, glbRel, meshJson: resolve(DUMP, asset.src.replace(/\.uemodel$/i, ".json")) };
}

// --- bake one skin -----------------------------------------------------------
async function bakeSkin(slug, pieceDir, skinName, selectedMI, materialSuffix = "") {
  const skinDir = resolve(DUMP, pieceDir, "Skins", skinName);
  const mi = selectedMI;
  if (!mi) {
    console.warn(`  ${skinName}: no MI — skip`);
    return null;
  }
  const globalTiling = mi.scalars.Tiling ?? 1;
  const skinKey = skinName.toLowerCase();
  const base = baseMaterialOf(mi);
  // Is the ColorA/B/C scheme the default placeholder palette? If so, the per-layer overlays carry
  // the real colours and we must NOT blend toward the scheme (it would wash them — see below).
  const cvec = (k) => {
    const v = mi.vectors[k];
    return v ? [v.r, v.g, v.b] : null;
  };
  const schemeIsPlaceholder =
    isPlaceholderSwatch(cvec("ColorA")) &&
    isPlaceholderSwatch(cvec("ColorB")) &&
    isPlaceholderSwatch(cvec("ColorC"));
  const tune = (base && BASE_TUNING[base]) || DEFAULT_TUNING;
  const envNum = (k, fallback) => (process.env[k] != null ? Number(process.env[k]) : fallback);
  const roughFloor = envNum("BAKE_ROUGH_FLOOR", tune.roughFloor);
  const normalStrength = envNum("BAKE_NORMAL_STRENGTH", tune.normalStrength);
  const macroNormalStrength = envNum("BAKE_MACRO_NORMAL", tune.macroNormalStrength ?? 0);

  // Shared UV0 maps + per-skin Texture2DArray slices (resolved from the MI's bindings).
  const [ocm, baseNormal, colorMask] = await Promise.all([
    loadRaw(texturePath(mi, "OcclusionCurvatureMaterialID", DUMP)),
    loadRaw(texturePath(mi, "Normal", DUMP)),
    loadRaw(texturePath(mi, "ColorMask", DUMP)),
  ]);
  if (!ocm) {
    console.warn(`  ${skinName}: no OCM map — skip`);
    return null;
  }
  const loadSlices = async (param) =>
    Promise.all(arraySlices(mi, param, DUMP).map(loadRaw));
  const [colors, normals, masks, patterns] = await Promise.all([
    loadSlices("TextureArray_Colors"),
    loadSlices("TextureArray_Normals"),
    loadSlices("TextureArray_Masks"),
    loadSlices("TextureArray_Patterns"),
  ]);

  const params = {}; // layer -> params (lazily built)
  const P = (L) => (params[L] ??= layerParams(mi, L, globalTiling));
  const slice = (arr, id) => (arr.length ? arr[clamp(id, 0, arr.length - 1)] : null);

  if (DEBUG) {
    let gMin = 255,
      gMax = 0,
      gSum = 0;
    for (let i = 0; i < ocm.data.length; i += ocm.ch) {
      const g = ocm.data[i + 1];
      if (g < gMin) gMin = g;
      if (g > gMax) gMax = g;
      gSum += g;
    }
    console.log(
      `  ${skinName}: OCM.G(curv) mean=${(gSum / (ocm.data.length / ocm.ch)).toFixed(1)} [${gMin}..${gMax}]  ` +
        `colors=${colors.length} normals=${normals.length} masks=${masks.length} patterns=${patterns.length}`,
    );
  }

  const albedo = Buffer.alloc(RES * RES * 3);
  const orm = Buffer.alloc(RES * RES * 3);
  const normalBuf = Buffer.alloc(NORMAL_RES * NORMAL_RES * 3);

  // Albedo + ORM at RES.
  for (let y = 0; y < RES; y++) {
    const v = (y + 0.5) / RES;
    for (let x = 0; x < RES; x++) {
      const u = (x + 0.5) / RES;
      const o = (y * RES + x) * 3;

      const oc = sample(ocm, u, v, "clamp");
      const ao = oc[0] / 255;
      const curv = oc[1] / 255;
      const layer = clamp(Math.round((oc[2] / 255) * 8), 1, 8);
      const p = P(layer);

      // --- base color: the per-layer overlay is the real colour for most parts (a dark pauldron,
      // a grey body). The ColorMask scheme is the colour source ONLY for "tint-me" layers whose
      // overlay is near-white (e.g. Satin L1 white -> ColorA maroon). Blend toward the scheme only
      // for such near-white overlays, and NEVER toward the default placeholder palette (which
      // washed dark overlays light). Mirrors regionsFromMI, which uses the overlay directly. ---
      let col = p.baseOverlay;
      const ovMin = Math.min(col[0], col[1], col[2]);
      if (ovMin > 0.85 && p.baseColorMaskStrength > 0 && !schemeIsPlaceholder) {
        const mask = colorMask ? sample(colorMask, u, v, "clamp") : [255, 0, 0, 255];
        col = mix3(col, schemeColor(mask, mi), p.baseColorMaskStrength);
      }

      // --- layer pattern (camo): the tonal bands of the grayscale pattern pick the camo
      //     swatch; applied near-fully (the camo IS the surface), grain/AO ride on top ---
      if (p.pattern && patterns.length) {
        const pv = sample(patterns[0], u * p.patternTiling, v * p.patternTiling, "repeat")[0] / 255;
        col = mix3(col, patternColor(pv, p.pattern), PATTERN_STRENGTH);
      }

      // --- tiled grain/value detail (color texture) ---
      if (p.baseTextureStrength > 0) {
        const cs = slice(colors, p.colorTextureID);
        if (cs) {
          const g = sample(cs, u * p.colorTextureTiling, v * p.colorTextureTiling, "repeat");
          col = [
            col[0] * lerp(1, g[0] / 255, p.baseTextureStrength),
            col[1] * lerp(1, g[1] / 255, p.baseTextureStrength),
            col[2] * lerp(1, g[2] / 255, p.baseTextureStrength),
          ];
        }
      }

      // --- curvature-driven edge (convex) lighten + crease (concave) darken ---
      if (EDGE_ENABLED && p.edgeA > 0 && p.edgeAmount > 0) {
        const w = smoothstep(0.6, 0.88, curv) * p.edgeAmount * p.edgeA;
        col = mix3(col, p.edgeRgb, w);
      }
      if (EDGE_ENABLED && p.creaseA > 0 && p.creaseAmount > 0) {
        const w = smoothstep(0.4, 0.12, curv) * p.creaseAmount * p.creaseA;
        col = mix3(col, p.creaseRgb, w);
      }

      // glTF metalness: only near-full UE metalness is real metal; partial = dielectric fabric.
      const glMetal = p.baseMetallicity >= METAL_THRESHOLD ? p.baseMetallicity : 0;

      // --- display model (non-metal only — metals match icons raw) + softened AO ---
      if (glMetal < 0.5) col = applyColorModelLinear(col);
      const aoEff = 1 - AO_STRENGTH * (1 - ao); // lift the dark fold-occlusion lines toward 1
      albedo[o] = linearToSrgb(col[0] * aoEff);
      albedo[o + 1] = linearToSrgb(col[1] * aoEff);
      albedo[o + 2] = linearToSrgb(col[2] * aoEff);

      // --- ORM: R=AO (carried), G=roughness (spatial+bias), B=metalness (gated) ---
      let rough = 0.5;
      const rs = slice(masks, p.baseRoughnessID);
      if (rs) rough = sample(rs, u * p.baseRoughnessTiling, v * p.baseRoughnessTiling, "repeat")[0] / 255;
      rough += p.baseRoughness;
      // Floor NON-metal layers (now incl. fabrics that had partial UE metalness) so glossy folds
      // don't streak under the softbox; real metal trim keeps its specular.
      if (glMetal < 0.5) rough = Math.max(rough, roughFloor);
      rough = clamp(rough, 0.04, 1);
      orm[o] = oc[0];
      orm[o + 1] = Math.round(rough * 255);
      orm[o + 2] = Math.round(glMetal * 255);
    }
  }

  // Normal at NORMAL_RES (macro fold normal + tiled base/medium detail via UDN).
  for (let y = 0; y < NORMAL_RES; y++) {
    const v = (y + 0.5) / NORMAL_RES;
    for (let x = 0; x < NORMAL_RES; x++) {
      const u = (x + 0.5) / NORMAL_RES;
      const o = (y * NORMAL_RES + x) * 3;
      const layer = clamp(Math.round((sample(ocm, u, v, "clamp")[2] / 255) * 8), 1, 8);
      const p = P(layer);
      let n = baseNormal ? decodeNormal(sample(baseNormal, u, v, "clamp")) : [0, 0, 1];
      n = [n[0] * macroNormalStrength, n[1] * macroNormalStrength, n[2]]; // damp macro seam ridges
      const bs = slice(normals, p.baseNormalID);
      if (bs)
        n = udn(n, decodeNormal(sample(bs, u * p.detailTiling, v * p.detailTiling, "repeat")), normalStrength);
      const ms = slice(normals, p.mediumNormalID);
      if (ms && p.mediumNormalStrength > 0)
        n = udn(
          n,
          decodeNormal(sample(ms, u * p.mediumNormalTiling, v * p.mediumNormalTiling, "repeat")),
          p.mediumNormalStrength * normalStrength,
        );
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      normalBuf[o] = Math.round((n[0] / len) * 0.5 * 255 + 127.5);
      normalBuf[o + 1] = Math.round((n[1] / len) * 0.5 * 255 + 127.5);
      normalBuf[o + 2] = Math.round((n[2] / len) * 0.5 * 255 + 127.5);
    }
  }

  const outBase = `${slug}.${skinKey}${materialSuffix}`;
  const dstDir = resolve(MODELS, "cosmetics");
  mkdirSync(dstDir, { recursive: true });
  await Promise.all([
    sharp(albedo, { raw: { width: RES, height: RES, channels: 3 } })
      .webp({ quality: 90 })
      .toFile(join(dstDir, `${outBase}.albedo.webp`)),
    sharp(normalBuf, { raw: { width: NORMAL_RES, height: NORMAL_RES, channels: 3 } })
      .webp({ quality: 95 })
      .toFile(join(dstDir, `${outBase}.normal.webp`)),
    sharp(orm, { raw: { width: RES, height: RES, channels: 3 } })
      .webp({ quality: 92 })
      .toFile(join(dstDir, `${outBase}.orm.webp`)),
  ]);
  console.log(`  ${skinName} -> ${outBase}.{albedo,normal,orm}.webp`);
  return {
    skinKey,
    set: {
      albedo: `models/cosmetics/${outBase}.albedo.webp`,
      normal: `models/cosmetics/${outBase}.normal.webp`,
      orm: `models/cosmetics/${outBase}.orm.webp`,
    },
  };
}

async function bakePiece(pieceKey, skinFilter) {
  const { slug, pieceDir, meshJson } = resolvePiece(pieceKey);
  const skinsRoot = resolve(DUMP, pieceDir, "Skins");
  let skins = readdirSync(skinsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(skinsRoot, name)) && readdirSync(join(skinsRoot, name)).some((f) => /^MI_.*\.json$/i.test(f)));
  if (skinFilter) skins = skins.filter((s) => skinFilter.includes(s.toLowerCase()));
  if (!skins.length) throw new Error(`no matching skins under ${skinsRoot}`);

  console.log(`baking ${slug} (${pieceDir}) @ ${RES}px albedo/orm, ${NORMAL_RES}px normal — skins: ${skins.join(", ")}`);
  const bakedFile = resolve(MODELS, "cosmetics", `${slug}.baked.json`);
  const bindingsFile = resolve(MODELS, "cosmetics", `${slug}.materials.json`);
  // Always merge into the existing manifest so baking a subset of skins (even with --force)
  // never drops the entries of skins not baked this run.
  const baked = existsSync(bakedFile) ? JSON.parse(readFileSync(bakedFile, "utf8")) : {};
  const materialBindings = existsSync(bindingsFile) ? JSON.parse(readFileSync(bindingsFile, "utf8")) : {};
  for (const skin of skins) {
    const skinDir = resolve(DUMP, pieceDir, "Skins", skin);
    const slots = resolveSkinMaterialSlots(meshJson, skinDir, DUMP);
    if (!slots.length) {
      console.warn(`  ${skin}: no source material slots — leaving existing bake unchanged`);
      continue;
    }
    const bindings = {};
    // Once this skin has a resolved slot inventory, only a successful single-slot
    // bake below can repopulate its legacy entry. Failed/changed families must not
    // resurrect an old global texture set during catalog import.
    delete baked[skin.toLowerCase()];
    for (const slot of slots) {
      if (slot.resolution === "unresolved-skin") {
        console.warn(`  ${skin}/${slot.materialName}: ambiguous skin assignment — retaining embedded material`);
        bindings[slot.materialName] = { family: "unknown", ...(typeof slot.mi?.doubleSided === "boolean" ? { doubleSided: slot.mi.doubleSided } : {}) };
        continue;
      }
      const binding = await buildSourceMaterialBinding(slot.mi, { dumpRoot: DUMP, modelsRoot: MODELS });
      if (slot.mi?.family === "layered") {
        // Each primitive's MI is a separate bake input, including its own parent
        // parameters and texture arrays. A single-layered + LED/glass piece still
        // needs an explicit name binding: the old global set painted its visor.
        const suffix = slots.length > 1 ? `.${slot.materialName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}` : "";
        const r = await bakeSkin(slug, pieceDir, skin, slot.mi, suffix);
        if (r) {
          binding.bakedSet = r.set;
          if (slots.length === 1) baked[r.skinKey] = r.set;
        } else if (slots.length === 1) {
          delete baked[skin.toLowerCase()];
        }
      }
      bindings[slot.materialName] = binding;
    }
    // A global set is invalid for multi-part pieces, even when only one part is
    // layered. Keep the old manifest contract for unequivocal single-material items.
    if (slots.length > 1 || slots[0].resolution === "unresolved-skin") delete baked[skin.toLowerCase()];
    materialBindings[skin.toLowerCase()] = bindings;
  }
  mkdirSync(dirname(bindingsFile), { recursive: true });
  writeFileSync(bindingsFile, JSON.stringify(materialBindings, null, 2) + "\n");
  writeFileSync(bakedFile, JSON.stringify(baked, null, 2) + "\n");
  console.log(`wrote ${bindingsFile} (${Object.keys(materialBindings).length} skins)`);
  console.log(`wrote ${bakedFile} (${Object.keys(baked).length} skins)`);
}

async function main() {
  // --all: re-bake every piece that already has a baked set (propagate a recipe change across the
  // catalog). Pieces with no Skins/ or no layered MI are skipped with a warning.
  if (argv.all) {
    const mbp = JSON.parse(readFileSync(join(SCRIPT_DIR, "model-by-piece.generated.json"), "utf8"));
    const pieces = Object.keys(mbp).filter((k) =>
      existsSync(resolve(MODELS, mbp[k].replace(/^models\//, "").replace(/\.glb$/, ".baked.json"))),
    );
    // --from=N resumes an interrupted --all run at 1-based piece index N (the list is
    // deterministic: model-by-piece key order), so a killed long run doesn't restart from zero.
    const from = argv.from ? Number(argv.from) : 1;
    console.log(`re-baking ${pieces.length} pieces with existing baked sets …${from > 1 ? ` (resuming at ${from})` : ""}`);
    let ok = 0;
    let i = 0;
    for (const piece of pieces) {
      i++;
      if (i < from) continue;
      try {
        console.log(`[${i}/${pieces.length}] ${piece}`);
        await bakePiece(piece, SKIN_FILTER);
        ok++;
      } catch (e) {
        console.warn(`  ${piece}: ${e.message}`);
      }
    }
    console.log(`\nre-baked ${ok}/${pieces.length} pieces.`);
    return;
  }
  if (!PIECE) throw new Error("usage: --piece=<set>/<piece> | --all  [--skin=Name|all] [--res=N] [--force] [--debug]");
  await bakePiece(PIECE, SKIN_FILTER);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
