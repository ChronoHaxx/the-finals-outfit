/**
 * import-catalog.ts — regenerate the cosmetic catalog from the datamined THE FINALS
 * asset dump.
 *
 * The export contains UI thumbnails (`T_UI_*.png`) and meshes (`.uemodel`) plus
 * folder/filename structure, but NO semantic metadata (rarity/season/source/price are
 * server-authoritative / wiki-only — see the plan). So this walker derives what the
 * structure DOES encode — id, slot, set, sponsor, a placeholder name, and the icon —
 * and emits `src/data/items.json` (per-skin granularity) plus converted webp icons
 * under `public/items/<slot>/`.
 *
 * The dump itself is never committed; point at it with FINALS_DUMP (the Characters/
 * folder) or rely on the default path. Run: `npm run import:catalog`.
 */
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import sharp from "sharp";
import { CatalogSchema, type Item, type Material, type MaterialBinding, type Decal } from "../src/lib/item.ts";
import { SLOTS, type Slot } from "../src/lib/slots.ts";
import { composeMaterialBindings, type ImportMaterialSlot } from "./lib/import-material-bindings.ts";
// @ts-expect-error plain-JS source resolver shared with the material baker
import { resolveMaterialBindings } from "./lib/material-instances.mjs";
// @ts-expect-error plain-JS source parser shared with the material baker
import { readMI } from "./lib/layered-mi.mjs";
// @ts-expect-error plain-JS source texture emitter shared with the material baker
import { buildSourceMaterialBinding } from "./lib/material-textures.mjs";
// @ts-expect-error plain-JS source attachment converter
import { buildAttachmentMaterialBinding } from "./lib/attachment-material.mjs";
// @ts-expect-error plain-JS module shared with the calibration scripts (not typechecked)
import { applyColorModel, srgbToLinear, linearToOklab } from "./lib/color-model.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHAR_ROOT =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

const PUBLIC_ITEMS = resolve(ROOT, "public/items");
const PUBLIC_DECALS = resolve(ROOT, "public/models/decals");
const OUT_ITEMS = resolve(ROOT, "src/data/items.json");
const REPORT = resolve(ROOT, "scripts/import-report.txt");
const ICON_SIZE = 256;
const ICON_CONCURRENCY = 8;
// Refresh only the material binding contract on the existing catalog. This also
// avoids reconverting icons, decals and unrelated body/under-layer metadata.
const MATERIALS_ONLY = process.argv.includes("--materials-only");
const MATERIAL_CATALOG_SOURCE = process.argv.find((arg) => arg.startsWith("--catalog-source="))?.slice("--catalog-source=".length);
// REGIONS_DEBUG=1 logs each piece's decoded region blues/layers/colors (audit the dye decode).
const REGIONS_DEBUG = process.env.REGIONS_DEBUG === "1";
// The MaterialID (OCM blue) encodes the layer SLOT in a fixed 8-slot space (blue ≈ slot/8*255,
// i.e. multiples of ~32) regardless of how many layers a given skin's MI actually defines —
// so the region→layer decode always divides by 8, never the instance's layer count.
const MASTER_LAYERS = 8;

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

// Top-level folders that are NOT per-slot cosmetics (skipped, with a logged count).
// Outfits = pre-composed bundles (future "presets" feature); the rest are non-wearable
// or engine/dev content.
const SKIP_CATEGORIES = new Set([
  "Avatar",
  "Body",
  "BodyTypes",
  "Cinematic",
  "Generic",
  "Meta",
  "Outfits",
  "Pets",
  "Props",
  "Reference",
  "Shared",
  "VisualEffects",
  "Voices",
]);

// Special categories whose top folder maps directly to a slot (no piece-keyword needed).
const SPECIAL_SLOT: Record<string, Slot> = {
  Hairs: "hair",
  FacialHairs: "facialHair",
  Heads: "face",
  Watches: "wrist",
  Nails: "nailPolish",
};

// BodyCosmetics sub-category (the segment right under BodyCosmetics/) -> slot.
const BODYCOSMETIC_SLOT: Record<string, Slot> = {
  Eyes: "eyes",
  Makeup: "blush",
  Nails: "nailPolish",
  Tattoos: "tattoo",
  Earrings: "earrings",
  BodyPaint: "bodyPaint",
  // Technical -> skip (engine overlays)
};

// Slots that render as a 2D decal composited onto the body/head (no mesh).
const DECAL_SLOTS = new Set<Slot>(["tattoo", "blush", "bodyPaint", "eyes", "nailPolish"]);

// Piece-name keyword -> slot, evaluated in order (most specific first). Used for set
// folders (ActionHero, Cowboy, …) and Attachments. Input is space-separated first
// (BaseballCap -> "baseball cap") so \b boundaries catch glued PascalCase tokens.
// `hood(?!ie)` keeps hoodies out of headwear; outerwear before upperBody so capes/coats
// win over "top/suit"; upperBack before lowerBack so clavicle weapons sort to the back.
const SLOT_RULES: [RegExp, Slot][] = [
  [/glass|goggle|monocle|shades|sunglass|spectacle/, "eyewear"],
  [/mask|eyepatch|rebreather|respirator|muzzle|faceguard|veil|balaclava|bandana|scarf|gaiter/, "facewear"],
  [/boot|shoe|sneaker|sandal|heel|geta|spur|clog|loafer|pump|cleat|wedge|footwear|flip ?flop/, "feet"],
  [/glove|gauntlet|mitten|knuckle|\bhand|finger/, "hands"],
  [/watch|wrist|bracelet|bangle/, "wrist"],
  [/pant|trouser|short|skirt|kilt|legging|tight|stocking|chap|jean|legwear|bottom|capri|jogger/, "lowerBody"],
  [/cape|cloak|poncho|coat|duster|mantle|robe|shawl|capelet|cardigan/, "outerwear"],
  [/backpack|bandolier|\bbag|harness|satchel|quiver|\bpack|wing|jetpack|parachute|sling|strap|clavicle|rope/, "upperBack"],
  // NOTE: \bhat\b / \bcaps?\b need BOTH boundaries — bare `\bcap` matched "captain
  // jacket" into headwear.
  [/helmet|\bhats?\b|\bcaps?\b|beanie|crown|cowl|\bhorns?\b|antenna|antler|beret|visor|halo|hood(?!ie)|turban|headband|headgear|tiara|fedora|bolero|sombrero|snapback|headphone|headset|\bears?\b|\bhead\b/, "headwear"],
  [/top|jacket|shirt|vest|hoodie|sweater|tank|jersey|tunic|blouse|\bsuit|torso|armou?r|bodysuit|dress|overall|uniform|turtle ?neck|pullover|sweatshirt|crop|corset|upper ?body|\bbody\b/, "upperBody"],
  [/lumbar|\btail|pistol|\bgun|sheath|holster/, "lowerBack"],
];

function spaceCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function keywordSlot(text: string): Slot | null {
  const spaced = spaceCase(text);
  for (const [re, slot] of SLOT_RULES) if (re.test(spaced)) return slot;
  return null;
}

// ---------------------------------------------------------------------------
// Sponsor inference (from skin-suffix tokens). Long distinctive names match as a
// substring; short codes (cns/ivs) must be a whole `_`-delimited token.
// ---------------------------------------------------------------------------
const SPONSOR_SUBSTR: [RegExp, string][] = [
  [/alfa-?acta/i, "alfa-acta"],
  [/va[iy]+a/i, "vaiiya"], // VAIIYA, also the "Vayiia" misspelling on watches
  [/ospuze/i, "ospuze"],
  [/dissun/i, "dissun"],
  [/holtow/i, "holtow"],
  [/engimo/i, "engimo"],
  [/iseult/i, "iseult"],
];
function inferSponsor(tokens: string[]): string | undefined {
  const joined = tokens.join("_");
  for (const [re, id] of SPONSOR_SUBSTR) if (re.test(joined)) return id;
  for (const t of tokens) {
    const lc = t.toLowerCase();
    if (lc === "cns") return "cns";
    if (lc === "ivs") return "ivs";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// id / name helpers
// ---------------------------------------------------------------------------
// Windows MAX_PATH workaround: deeply-nested dump paths exceed 260 chars, which
// libvips can't open. Prefix the absolute path with \\?\ and read bytes via Node fs.
function longPath(p: string): string {
  if (process.platform === "win32") {
    const r = resolve(p).replace(/\//g, "\\");
    return r.startsWith("\\\\?\\") ? r : `\\\\?\\${r}`;
  }
  return p;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// FNV-1a 16-bit-ish short hash for id truncation/collision suffixes.
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).slice(0, 4).padStart(4, "0");
}

const usedIds = new Set<string>();
function makeId(raw: string): string {
  let id = slugify(raw);
  if (id.length > 48) id = `${id.slice(0, 43).replace(/-+$/, "")}-${shortHash(raw)}`;
  if (id.length < 2) id = `item-${shortHash(raw)}`;
  if (usedIds.has(id)) {
    const base = id.length > 43 ? id.slice(0, 43).replace(/-+$/, "") : id;
    id = `${base}-${shortHash(raw + ":" + usedIds.size)}`;
  }
  usedIds.add(id);
  return id;
}

function titleCase(token: string): string {
  // split camelCase / PascalCase and digit groups, then title-case words
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Material reconstruction (M5) — the dump's BaseColor is neutral; per-skin color
// comes from a compiled layered-dye material absent from the dump. We approximate it:
// the converter bakes a per-piece ColorMask (region-ID map) as a sibling .png, and
// here we pair each region color with a tint pulled from the skin's MaterialInstance
// (or sampled from its color-array texture), so per-skin catalog variants differ.
// ---------------------------------------------------------------------------
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// UE vector param -> #rrggbb. The dump provides a display-ready `Hex` (sRGB-encoded);
// prefer it, else sRGB-encode the linear R/G/B floats.
function ueColorToHex(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { Hex?: string; R?: number; G?: number; B?: number };
  if (typeof o.Hex === "string" && /^[0-9a-fA-F]{6}$/.test(o.Hex)) return `#${o.Hex.toLowerCase()}`;
  if (typeof o.R === "number" && typeof o.G === "number" && typeof o.B === "number") {
    const enc = (c: number) => {
      c = clamp01(c);
      return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };
    return toHex(enc(o.R) * 255, enc(o.G) * 255, enc(o.B) * 255);
  }
  return null;
}

interface LayerOverlay {
  rgb: string | null;
  active: boolean; // A>0 — an inactive overlay leaves the part to the ColorA/B/C swatch
  roughness?: number;
  metalness?: number;
  // ShadeAsCloth (0..1): how cloth-like the game's layered shader treats this layer. On a
  // cloth layer, Metallicity is a layered-shader blend input — NOT glTF metalness.
  cloth?: number;
  specular?: number; // BaseSpecular (0.5 = UE default, equals glTF's F0 0.04)
}
// Garment print decal: N_DecalColor texture (shared T_Decal_* pool) + N_DecalPlacement
// [offsetU, offsetV, scale, rotation] placing it on the garment UV. Tracked separately
// from overlays — a print layer may have no BaseColorOverlay vector at all.
interface LayerDecal {
  tex: string;
  place: [number, number, number, number];
  // Scheme colours for recolouring the 2-tone decal mask (only set when chromatic — see below).
  colorA?: string;
  colorB?: string;
}
interface LayeredMI {
  nLayers: number;
  overlays: (LayerOverlay | undefined)[]; // 1-indexed: overlays[1..nLayers]
  decals: (LayerDecal | undefined)[]; // 1-indexed, independent of overlays
  // A bare (non-layer) `Decal` texture param = a single finished full-UV print baked across the
  // garment UV (e.g. gothic LooseJacket's all-over graphics), distinct from the per-layer placed
  // `N_DecalColor` prints. Applied ungated at scale 1 (the full-UV identity path).
  fullUvDecal?: string;
  colorA?: string;
  colorB?: string;
  colorC?: string;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function numOr(v: unknown): number | undefined {
  return typeof v === "number" ? clamp01(v) : undefined;
}

// Parse a skin's MI_*.json into the layered-dye data. The real per-part garment color lives
// in the per-layer `N_BaseColorOverlay` vectors (A>0 = active); the MaterialID region map
// selects which 1..N layer paints each part (see buildMaterial). Global `ColorA/B/C` are
// secondary swatches used as a fallback for inactive layers. `nLayers` comes from the parent
// `MI_Character_<N>Layers`. Also handles FModel's simplified `Parameters.Colors/Scalars` shape.
function parseLayeredMI(dir: string): LayeredMI | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^MI_.*\.json$/i.test(f));
  } catch {
    return null;
  }
  if (!files.length) return null;
  // Prefer an MI that actually carries layered params (a folder may hold stub MIs too).
  let obj: Record<string, any> | undefined;
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(longPath(join(dir, f)), "utf8"));
      const o = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any>;
      if (o?.Properties || o?.Parameters) {
        obj = o;
        if (Array.isArray(o?.Properties?.VectorParameterValues)) break; // best shape
      }
    } catch {
      /* ignore */
    }
  }
  if (!obj) return null;

  const props = obj.Properties ?? {};
  const parentName: string = props?.Parent?.ObjectName ?? obj?.Parent?.ObjectName ?? "";
  const mL = /(\d+)\s*Layers/i.exec(parentName);
  const nLayers = mL ? clampInt(Number(mL[1]), 1, 8) : 8;

  const vec: Record<string, unknown> = {};
  if (Array.isArray(props.VectorParameterValues))
    for (const e of props.VectorParameterValues) {
      const n = e?.ParameterInfo?.Name;
      if (n) vec[n] = e?.ParameterValue;
    }
  const scal: Record<string, number> = {};
  if (Array.isArray(props.ScalarParameterValues))
    for (const e of props.ScalarParameterValues) {
      const n = e?.ParameterInfo?.Name;
      if (n && typeof e?.ParameterValue === "number") scal[n] = e.ParameterValue;
    }
  const fmColors = (obj.Parameters?.Colors ?? {}) as Record<string, unknown>;
  const fmScalars = (obj.Parameters?.Scalars ?? {}) as Record<string, number>;

  // Texture params: `${L}_DecalColor = Texture2D'T_Decal_AlienMeme_01_CA'` — the garment
  // print pool. Null slots reference T_Decal_Null_*.
  const texParams: Record<string, string> = {};
  if (Array.isArray(props.TextureParameterValues))
    for (const e of props.TextureParameterValues) {
      const n = e?.ParameterInfo?.Name;
      const obj2 = e?.ParameterValue?.ObjectName;
      if (n && typeof obj2 === "string") {
        const m = /'([^']+)'/.exec(obj2);
        if (m) texParams[n] = m[1];
      }
    }
  // Static switches gate whether a layer's decal actually renders. A layer can reference a
  // decal texture (e.g. `${L}_DecalColor = T_Decal_NumbersAtlas_*`) while `${L}_UseDecal=false`
  // — the game hides it, but reading DecalColor alone wrongly stamps it on (the "wrong-decal-
  // matched" class, e.g. gothicdresstop getting numbers). Respect the switch.
  const switches: Record<string, boolean> = {};
  const swArr =
    props.StaticParametersRuntime?.StaticSwitchParameters ?? props.StaticParameters?.StaticSwitchParameters;
  if (Array.isArray(swArr))
    for (const e of swArr) {
      const n = e?.ParameterInfo?.Name;
      if (n && typeof e?.Value === "boolean") switches[n] = e.Value;
    }

  const rawVec4 = (v: unknown): [number, number, number, number] | undefined => {
    const o = v as { R?: number; G?: number; B?: number; A?: number } | undefined;
    return o && typeof o.R === "number" && typeof o.G === "number" && typeof o.B === "number"
      ? [o.R, o.G, o.B, typeof o.A === "number" ? o.A : 0]
      : undefined;
  };

  const overlays: (LayerOverlay | undefined)[] = [];
  const decals: (LayerDecal | undefined)[] = [];
  for (let L = 1; L <= MASTER_LAYERS; L++) {
    const decalName = texParams[`${L}_DecalColor`];
    const place = rawVec4(vec[`${L}_DecalPlacement`]);
    if (decalName && !/_Null_/i.test(decalName) && place && switches[`${L}_UseDecal`] !== false) {
      // The decal `_M` texture is a luminance MASK; the real colours are this layer's scheme
      // (ColorA = light end, ColorB = dark/accent end). Only carry them when at least one is
      // CHROMATIC — that signals a genuine accent (e.g. AlfaActa's red ColorB on a black mask).
      // Plain black/white schemes (and full-colour photo decals) are left to render as-is.
      const caRaw = vec[`${L}_ColorA`] ?? fmColors[`${L}_ColorA`];
      const cbRaw = vec[`${L}_ColorB`] ?? fmColors[`${L}_ColorB`];
      const caHex = caRaw ? ueColorToHex(caRaw) : undefined;
      const cbHex = cbRaw ? ueColorToHex(cbRaw) : undefined;
      const chroma = (hex?: string): number => {
        if (!hex) return 0;
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
        if (!m) return 0;
        const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
        return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      };
      // Only a luminance MASK (`T_Decal_*_M`) is a 2-tone scheme to recolour; a finished
      // full-colour print (`_C`/`_CA`) must render as authored. The chroma test ALONE wrongly
      // remapped colour prints whose layer scheme happened to be chromatic — e.g. the FNEsport
      // tee (`T_Decal_FNEsport_01_C`) got mix(colorB,colorA,luma)'d into a flat green shirt.
      const isMask = /_M$/i.test(decalName);
      const recolour = isMask && (chroma(caHex) > 0.08 || chroma(cbHex) > 0.08);
      decals[L] = recolour ? { tex: decalName, place, colorA: caHex, colorB: cbHex } : { tex: decalName, place };
    }

    const v = vec[`${L}_BaseColorOverlay`] ?? fmColors[`${L}_BaseColorOverlay`];
    if (v === undefined || v === null) {
      overlays[L] = undefined;
      continue;
    }
    const a = (v as { A?: number }).A;
    overlays[L] = {
      rgb: ueColorToHex(v),
      active: typeof a === "number" ? a > 0 : true,
      roughness: numOr(scal[`${L}_BaseRoughness`] ?? fmScalars[`${L}_BaseRoughness`]),
      metalness: numOr(scal[`${L}_BaseMetallicity`] ?? fmScalars[`${L}_BaseMetallicity`]),
      cloth: numOr(scal[`${L}_ShadeAsCloth`] ?? fmScalars[`${L}_ShadeAsCloth`]),
      specular: numOr(scal[`${L}_BaseSpecular`] ?? fmScalars[`${L}_BaseSpecular`]),
    };
  }

  // Bare full-UV print: the `Decal`/`DecalColor` texture param with no layer prefix (≠ N_DecalColor).
  const bareDecal = texParams["Decal"] ?? texParams["DecalColor"];
  return {
    nLayers,
    overlays,
    decals,
    fullUvDecal: bareDecal && !/_Null_/i.test(bareDecal) ? bareDecal : undefined,
    colorA: ueColorToHex(vec["ColorA"] ?? fmColors["ColorA"]) ?? undefined,
    colorB: ueColorToHex(vec["ColorB"] ?? fmColors["ColorB"]) ?? undefined,
    colorC: ueColorToHex(vec["ColorC"] ?? fmColors["ColorC"]) ?? undefined,
  };
}

// Best-effort: when a skin has no MI, pull tints from its TA_*_Colors_0 palette texture
// (keep only saturated colors; ignore the neutral/grey base).
async function sampleTaColors(dir: string, k = 6): Promise<string[]> {
  let file: string | undefined;
  try {
    file = readdirSync(dir).find((f) => /^TA_.*_Colors_0\.png$/i.test(f));
  } catch {
    /* ignore */
  }
  if (!file) return [];
  try {
    const { data, info } = await sharp(longPath(join(dir, file)))
      .resize(16, 16, { kernel: "nearest" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const hist = new Map<string, number>();
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 24) continue; // skip greys
      hist.set(`${r >> 4},${g >> 4},${b >> 4}`, (hist.get(`${r >> 4},${g >> 4},${b >> 4}`) ?? 0) + 1);
    }
    return [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([key]) => {
        const [r, g, b] = key.split(",").map((n) => Number(n) * 16 + 8);
        return toHex(r, g, b);
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-head body-skin pairing — each head ships a sibling MI_Body_*.json whose
// ColorMultiply (linear RGB multipliers) + Roughness retune the shared body material so
// the body's tone matches the head. Verified: face-01 carries ColorMultiply ~(1.4,1.36,1.06).
// ---------------------------------------------------------------------------
// The body color-map variants heads can reference. Converted lazily to
// public/models/body/skin-<variant>.webp (same UV atlas as the baked body texture).
const BODY_SKIN_TEXTURES: Record<string, string> = {
  t_basebody_body_dark_color: "Body/Textures/T_BaseBody_Body_Dark_Color.png",
  t_basebody_body_light_color: "Body/Textures/T_BaseBody_Body_Light_Color.png",
  t_basebody_female_medium_color: "T_BaseBody_Female_Medium_Color.png",
};
const bodySkinTexCache = new Map<string, Promise<string>>();
function convertBodySkinTex(objectName: string): Promise<string> {
  const name = (/'([^']+)'/.exec(objectName)?.[1] ?? "").toLowerCase();
  const src = BODY_SKIN_TEXTURES[name];
  if (!src) return Promise.resolve("");
  let p = bodySkinTexCache.get(name);
  if (!p) {
    p = (async () => {
      const abs = resolve(CHAR_ROOT, src.startsWith("Body/") || src.startsWith("T_") ? src : src);
      const srcAbs = existsSync(abs) ? abs : resolve(CHAR_ROOT, "Body", src);
      if (!existsSync(srcAbs)) return "";
      const rel = `models/body/skin-${slugify(name.replace(/^t_basebody_|_color$/g, ""))}.webp`;
      const dest = resolve(ROOT, "public", rel);
      mkdirSync(dirname(dest), { recursive: true });
      await sharp(longPath(srcAbs)).webp({ quality: 86 }).toFile(dest);
      return rel;
    })().catch(() => "");
    bodySkinTexCache.set(name, p);
  }
  return p;
}

async function parseBodySkinMI(
  dir: string,
): Promise<{ colorMultiply: [number, number, number]; roughness?: number; texPath?: string } | null> {
  let file: string | undefined;
  try {
    file = readdirSync(dir).find((f) => /^MI_Body_.*\.json$/i.test(f) && !/Frontend/i.test(f));
  } catch {
    return null;
  }
  if (!file) return null;
  try {
    const raw = JSON.parse(readFileSync(longPath(join(dir, file)), "utf8"));
    const o = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any>;
    const props = o?.Properties ?? {};
    let cm: [number, number, number] | null = null;
    for (const e of props.VectorParameterValues ?? []) {
      if (e?.ParameterInfo?.Name === "ColorMultiply") {
        const v = e.ParameterValue;
        if (typeof v?.R === "number") cm = [v.R, v.G, v.B];
      }
    }
    if (!cm) return null;
    let roughness: number | undefined;
    for (const e of props.ScalarParameterValues ?? []) {
      if (e?.ParameterInfo?.Name === "Roughness" && typeof e?.ParameterValue === "number")
        roughness = clamp01(e.ParameterValue);
    }
    let texPath: string | undefined;
    for (const e of props.TextureParameterValues ?? []) {
      if (e?.ParameterInfo?.Name === "BodyColorMap" && typeof e?.ParameterValue?.ObjectName === "string") {
        const rel = await convertBodySkinTex(e.ParameterValue.ObjectName);
        if (rel) texPath = rel;
      }
    }
    return {
      colorMultiply: cm,
      ...(roughness !== undefined ? { roughness } : {}),
      ...(texPath ? { texPath } : {}),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Garment print decals (graphic-tee prints, logos) — a shared texture pool under
// MaterialLibrary/Character/LayeredMaterials/Textures/Decals, referenced per layer by the
// MI's `${L}_DecalColor` and placed on the garment UV by `${L}_DecalPlacement`.
// ---------------------------------------------------------------------------
// Decal pool spans Textures/Decals AND Textures/ComplexDecals (e.g. merch back prints) —
// index the whole Textures tree by T_Decal_* name.
const DECALS_SRC = resolve(CHAR_ROOT, "../MaterialLibrary/Character/LayeredMaterials/Textures");
let decalFileIndex: Map<string, string> | null = null;
function findGarmentDecalFile(name: string, pieceDir?: string): string | null {
  // Piece-LOCAL decals (e.g. T_LongCoatKCP_Decal, a full-UV merch overlay) live in the piece
  // folder, not the shared pool, and don't match the T_Decal_* naming — check there first.
  if (pieceDir) {
    const local = join(pieceDir, `${name}.png`);
    if (existsSync(longPath(local))) return local;
  }
  if (!decalFileIndex) {
    decalFileIndex = new Map();
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (/^T_Decal_.*\.png$/i.test(e.name))
          decalFileIndex!.set(basename(e.name, ".png").toLowerCase(), join(dir, e.name));
      }
    };
    walk(DECALS_SRC);
  }
  return decalFileIndex.get(name.toLowerCase()) ?? null;
}

// name -> public-relative webp path ("" = unresolvable). Promise-cached: material jobs run
// concurrently and must not race on writing the same shared decal file.
const garmentDecalCache = new Map<string, Promise<string>>();
function convertGarmentDecal(name: string, pieceDir?: string): Promise<string> {
  const cacheKey = pieceDir ? `${pieceDir}|${name}` : name;
  let p = garmentDecalCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      const src = findGarmentDecalFile(name, pieceDir);
      if (!src) return "";
      const rel = `models/decals/_garment/${slugify(name)}.webp`;
      const abs = resolve(ROOT, "public", rel);
      mkdirSync(dirname(abs), { recursive: true });
      await sharp(longPath(src))
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85, alphaQuality: 90 })
        .toFile(abs);
      return rel;
    })().catch(() => "");
    garmentDecalCache.set(cacheKey, p);
  }
  return p;
}

// The skin's final colorway is NOT recoverable from the dump (it's produced by a compiled
// layered-dye shader; every accessible texture/param is white/grey/neutral — see
// [[material-dye-system]]). The skin's UI thumbnail IS a real in-game render, so it's the
// only reliable color source. Sample the garment colors from the (center of the) icon,
// preferring saturated colors, with a desaturated fallback for white/grey/black garments.
// The preview mannequin is a distinctive light, low-saturation blue-grey; exclude it so
// it doesn't get mistaken for the garment color (white garments are neutral, so they pass).
function isMannequin(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx > 180 && mx - mn < 55 && b >= r + 4 && g >= r + 2;
}

async function sampleIconPalette(absPng: string): Promise<string[]> {
  try {
    const size = 64;
    const { data, info } = await sharp(longPath(absPng))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const q = (v: number) => v >> 4; // 4-bit buckets
    const all = new Map<string, number>();
    for (let i = 0; i < data.length; i += ch) {
      if (ch > 3 && data[i + 3] < 128) continue; // transparent bg
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) < 14) continue; // near-black bg fringe
      if (isMannequin(r, g, b)) continue;
      const key = `${q(r)},${q(g)},${q(b)}`;
      all.set(key, (all.get(key) ?? 0) + 1);
    }
    const toRgb = (k: string) => k.split(",").map((n) => Number(n) * 16 + 8);
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const ranked = [...all.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return [];
    const total = [...all.values()].reduce((a, b) => a + b, 0);
    // primary = dominant garment color. A real accent (trim/panel filling a ColorMask G/B
    // region) is a meaningful FRACTION and is dark or saturated — not a neutral mid-grey
    // (which is usually a highlight/shadow). This stops monochrome garments (e.g. all-yellow
    // pants) from getting an invented grey panel.
    const out: number[][] = [toRgb(ranked[0][0])];
    for (const [k, count] of ranked) {
      const c = toRgb(k);
      if (!out.every((o) => d(o, c) > 70)) continue;
      const mx = Math.max(...c);
      const mn = Math.min(...c);
      const sat = mx ? (mx - mn) / mx : 0;
      if (count / total > 0.05 && (mx < 95 || sat > 0.28)) {
        out.push(c);
        if (out.length >= 3) break;
      }
    }
    return out.map((c) => toHex(c[0], c[1], c[2]));
  } catch {
    return [];
  }
}

// Hair has no MaterialID parts — sample the dominant color from the CROWN of the icon (top
// ~45%, above the face) so we get the hair color, not the mannequin's face/skin.
// Canonical facial-hair colours, keyed by the item id's trailing colour word. Values = the mean
// icon-sampled tint of hair items sharing that colour name (hair sampling is reliable: the crown
// band is all hair), so beards match their hair counterparts. The two *streaks mixes are hand-set
// between their base colour and grey (each had a single, unreliable hair donor).
const FACIAL_HAIR_COLORS: Record<string, string> = {
  black: "#25201b",
  blackgreystreaks: "#2e2b29",
  blonde: "#866d49",
  chocolatebrown: "#47372f",
  coolbrown: "#37291e",
  coolbrownlightstreaks: "#6b5a4c",
  darkblonde: "#4e3c28",
  flamingred: "#c94f00",
  gray: "#999898",
  red: "#734020",
  saltpepper: "#575759",
  white: "#b5a89b",
};
function facialHairColor(iconAbs: string): string | null {
  // dump icon name, e.g. T_UI_FacialHairs_BeardAnchorHalf_ChocolateBrown.png -> "chocolatebrown"
  const m = basename(iconAbs).match(/[-_]([a-z]+)\.(webp|png)$/i);
  return (m && FACIAL_HAIR_COLORS[m[1].toLowerCase()]) || null;
}

// Sample band: hair reads the icon CROWN (top 45%); facial hair reads the mouth/chin box
// (icons frame the beard on a mannequin bust — the crown band would sample bare scalp).
async function sampleHairColor(
  absPng: string,
  y0 = 0,
  y1 = 0.45,
  x0 = 0,
  x1 = 1,
): Promise<string | null> {
  try {
    const size = 64;
    const { data, info } = await sharp(longPath(absPng))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const q = (v: number) => v >> 4;
    const hist = new Map<string, number>();
    const px: [number, number, number][] = [];
    for (let y = Math.floor(size * y0); y < size * y1; y++) {
      for (let x = Math.floor(size * x0); x < size * x1; x++) {
        const i = (y * size + x) * ch;
        if (ch > 3 && data[i + 3] < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.max(r, g, b) < 14) continue;
        if (isMannequin(r, g, b)) continue;
        px.push([r, g, b]);
        hist.set(`${q(r)},${q(g)},${q(b)}`, (hist.get(`${q(r)},${q(g)},${q(b)}`) ?? 0) + 1);
      }
    }
    const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return null;
    // Refine the winning bucket: a coarse 16-level bucket centre flattens hue (dark brown
    // #2a201a -> olive #282818, losing R>G>B). Average the ACTUAL pixels within ±1 bucket of
    // the mode instead — keeps the same dominant cluster (no hue jump, blacks stay black) but
    // restores the true sub-bucket colour. Verified: fixes brown olive-cast, no regression on
    // black/blonde/red/blue/pink/white across a 10-hair sample.
    const [mr, mg, mb] = ranked[0][0].split(",").map(Number);
    const near = px.filter(
      ([r, g, b]) => Math.abs((r >> 4) - mr) <= 1 && Math.abs((g >> 4) - mg) <= 1 && Math.abs((b >> 4) - mb) <= 1,
    );
    const src = near.length ? near : px;
    const sum = src.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    let [cr, cg, cb] = [sum[0] / src.length, sum[1] / src.length, sum[2] / src.length];
    // Warm-natural saturation boost: brown/blonde/red hair samples low-saturation (the icon's
    // strands sit in shadow), so our FLAT diffuse — lacking the game's anisotropic strand
    // speculars — washes to muddy grey under the studio key light. Push the colour away from the
    // grey axis while PRESERVING luma (value is already correct; the render's lighting supplies
    // brightness — a value lift over-brightens). This is self-gating: blacks/greys have ~no chroma
    // so they barely move (verified: all `-black` variants stay dark), and it never lightens.
    // Restricted to warm pigments so vivid cool dyes (blue/purple) aren't over-saturated.
    if (cr - cb > 4) {
      const l = 0.299 * cr + 0.587 * cg + 0.114 * cb;
      const SAT = 1.55;
      cr = l + (cr - l) * SAT;
      cg = l + (cg - l) * SAT;
      cb = l + (cb - l) * SAT;
    }
    return toHex(cr, cg, cb);
  } catch {
    return null;
  }
}

// Translate one layer's UE shading params into glTF-ish PBR the runtime can use directly.
// The game's layered shader is cloth-aware: a layer with high ShadeAsCloth shades with a
// fuzz/sheen lobe, and its Metallicity is a layer-blend input — mapping those literally onto
// glTF metalness/roughness renders fabric as liquid metal (verified vs the official icons).
//   - metalness: killed on cloth layers, kept on real metal (gunmetal trim ShadeAsCloth≈0.1).
//   - roughness: pulled toward matte by cloth-ness, floored (metal 0.2; cloth-scaled floor
//     otherwise so leather (cloth=0, rough 0.2) stays glossy but fabric never reads wet).
//   - sheen: the cloth-ness itself, consumed by the runtime sheen lobe.
function deriveRegionPbr(ov: LayerOverlay | undefined): {
  rough: number;
  metal: number;
  sheen: number;
} {
  const cloth = ov?.cloth ?? 0;
  const baseRough = ov?.roughness ?? 0.6;
  const metal = cloth >= 0.5 ? 0 : ov?.metalness ?? 0;
  const matte = Math.max(baseRough, 0.7);
  let rough = baseRough + (matte - baseRough) * cloth;
  rough = Math.max(rough, metal > 0.05 ? 0.2 : 0.2 + 0.3 * cloth);
  return { rough: Math.min(rough, 1), metal, sheen: cloth };
}

// Decode each region's MaterialID value -> 1..N material layer -> that layer's real color.
// The MaterialID is the blue channel of the OCM map, evenly spaced across the N layers, so
// `layer = round(blue/255 * N)`. An inactive/absent layer falls back to the global ColorA
// swatch (null if none — caller backfills from the icon so a part is never left grey).
function regionsFromMI(mi: LayeredMI, blues: number[], count: number) {
  const colors: (string | null)[] = []; // display colors (through the fitted color model)
  const raw: (string | null)[] = []; // authored colors, pre-model (kept for re-fits)
  const pbr: ReturnType<typeof deriveRegionPbr>[] = [];
  const layers: number[] = [];
  for (let r = 0; r < count; r++) {
    const layer = clampInt((blues[r] / 255) * MASTER_LAYERS, 1, MASTER_LAYERS);
    layers.push(layer);
    const ov = mi.overlays[layer];
    const dye = ov?.active && ov.rgb ? ov.rgb : null;
    const authored = dye ?? mi.colorA ?? null;
    raw.push(authored);
    const p = deriveRegionPbr(ov);
    // The fitted display transform applies to ACTIVE DYE overlays only, and only on
    // non-metal regions: metals are reflection-dominated (icons confirm gunmetal #46474c ≈
    // icon #434345 unchanged), and swatch-path colors (inactive overlay -> global ColorA,
    // e.g. graphic tees) also match their icons without the lift.
    const display = dye && p.metal < 0.5 ? (applyColorModel(dye) as string) : authored;
    colors.push(display);
    pbr.push(p);
  }
  return { colors, raw, pbr, layers };
}

// Per-piece baked-set manifests (`<slug>.baked.json`, written by scripts/bake-composite.mjs)
// map skin folder name -> {albedo,normal,orm}. Cached per path (many skins share a piece).
const bakedManifestCache = new Map<string, Record<string, Material["bakedSet"]> | null>();
function lookupBakedSet(gltfPath: string, skinDir: string): Material["bakedSet"] | undefined {
  const abs = resolve(ROOT, "public", gltfPath.replace(/\.glb$/, ".baked.json"));
  let manifest = bakedManifestCache.get(abs);
  if (manifest === undefined) {
    manifest = existsSync(abs) ? (JSON.parse(readFileSync(abs, "utf8")) as typeof manifest) : null;
    bakedManifestCache.set(abs, manifest);
  }
  return manifest ? manifest[basename(skinDir).toLowerCase()] : undefined;
}

type MaterialJob = { itemId: string; model: NonNullable<Item["model"]>; skinDir: string; iconAbs: string };
const glbMaterialNamesCache = new Map<string, string[]>();
const materialBindingsCache = new Map<string, Record<string, Record<string, MaterialBinding>> | null>();

function glbMaterialNames(gltfPath: string): string[] {
  const cached = glbMaterialNamesCache.get(gltfPath);
  if (cached) return cached;
  const data = readFileSync(resolve(ROOT, "public", gltfPath));
  if (data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(16) !== 0x4e4f534a)
    throw new Error(`Cannot read GLB materials: ${gltfPath}`);
  const gltf = JSON.parse(data.toString("utf8", 20, 20 + data.readUInt32LE(12))) as {
    materials?: { name?: string }[];
    meshes?: { primitives?: { material?: number }[] }[];
  };
  const used = new Set((gltf.meshes ?? []).flatMap((mesh) => (mesh.primitives ?? []).map((primitive) => primitive.material)));
  const names = (gltf.materials ?? []).flatMap((material, index) => used.has(index) && material.name ? [material.name] : []);
  glbMaterialNamesCache.set(gltfPath, names);
  return names;
}

function lookupMaterialBindings(gltfPath: string, skinDir: string): Record<string, MaterialBinding> | undefined {
  const abs = resolve(ROOT, "public", gltfPath.replace(/\.glb$/, ".materials.json"));
  let manifest = materialBindingsCache.get(abs);
  if (manifest === undefined) {
    manifest = existsSync(abs) ? JSON.parse(readFileSync(abs, "utf8")) : null;
    materialBindingsCache.set(abs, manifest ?? null);
  }
  return manifest?.[basename(skinDir).toLowerCase()];
}

// Resolve every exported material independently. The old material block remains
// useful for color diagnostics and undersuit selection, but the runtime uses this
// exact-name map exclusively whenever it exists.
async function assignMaterialBindings(jobs: MaterialJob[], items: Item[]): Promise<void> {
  const unresolved: { itemId: string; materialName: string; reason: string }[] = [];
  const resolutionCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  let bound = 0;
  for (const job of jobs) {
    const materialNames = glbMaterialNames(job.model.gltfPath);
    const resolved = resolveMaterialBindings({ gltfPath: job.model.gltfPath, skinDir: job.skinDir, dumpRoot: CHAR_ROOT });
    const sourceBindings: Record<string, MaterialBinding> = {};
    for (const slot of resolved) {
      if (!materialNames.includes(slot.materialName) || /unresolved|ambiguous/.test(slot.resolution ?? "")) continue;
      sourceBindings[slot.materialName] = await buildSourceMaterialBinding(slot.mi, {
        dumpRoot: CHAR_ROOT,
        modelsRoot: resolve(ROOT, "public/models"),
      });
      const attachment = await buildAttachmentMaterialBinding(slot.mi, { dumpRoot: CHAR_ROOT, modelsRoot: resolve(ROOT, "public/models") });
      if (attachment) sourceBindings[slot.materialName] = { ...sourceBindings[slot.materialName], ...attachment };
    }
    const slots: ImportMaterialSlot[] = resolved.map((slot: {
      materialName: string;
      mi?: { name?: string; family?: MaterialBinding["family"]; doubleSided?: boolean; complete?: boolean };
      resolution?: string;
    }) => ({
      materialName: slot.materialName,
      sourceName: slot.mi?.name,
      family: slot.mi?.family ?? "unknown",
      doubleSided: slot.mi?.doubleSided,
      complete: slot.mi?.complete,
      resolution: slot.resolution,
    }));
    for (const slot of slots) {
      const resolution = slot.resolution ?? "unknown";
      resolutionCounts[resolution] = (resolutionCounts[resolution] ?? 0) + 1;
    }
    const { bindings, issues } = composeMaterialBindings({
      materialNames,
      slots,
      sourceBindings,
      sidecar: lookupMaterialBindings(job.model.gltfPath, job.skinDir),
      legacy: job.model.material,
      primarySourceName: readMI(job.skinDir)?.name,
    });
    if (materialNames.length) {
      job.model.materialBindings = bindings;
      bound++;
      for (const binding of Object.values(bindings)) familyCounts[binding.family] = (familyCounts[binding.family] ?? 0) + 1;
    } else {
      unresolved.push({ itemId: job.itemId, materialName: "", reason: "GLB has no named material primitives" });
    }
    unresolved.push(...issues.map((issue) => ({ itemId: job.itemId, ...issue })));
    if ((bound + 1) % 500 === 0) console.log(`  …resolved ${bound + 1}/${jobs.length} material jobs`);
  }
  const jobsById = new Set(jobs.map((job) => job.itemId));
  for (const item of items) {
    if (item.model && !jobsById.has(item.id))
      unresolved.push({ itemId: item.id, materialName: "", reason: "catalog model has no matching dump icon/source job" });
  }
  const report = resolve(process.env.MATERIAL_BINDING_REPORT ?? resolve(ROOT, "scripts/material-bindings.generated.json"));
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify({
    items: jobs.length,
    bound,
    familyCounts,
    resolutionCounts,
    unresolved: unresolved.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.materialName.localeCompare(b.materialName) || a.reason.localeCompare(b.reason)),
  }, null, 2) + "\n");
  console.log(`  material bindings: ${bound}/${jobs.length} items, ${unresolved.length} unresolved diagnostics -> ${report}`);
}

// Self-illuminated mesh cosmetics: the dump ships a `T_<piece>_Emissive` map next to the mesh
// (pumpkin face, blankface LED, gas-mask lenses). The convert-time Blender emissive bake is
// "best-effort" and unreliable (stale / silent-fail), so copy the map to public and let the rig
// assign it as an emissiveMap at runtime. Searches the skin dir up to the piece root (≤3 levels,
// bounded by CHAR_ROOT). Cached per gltfPath (skins of a piece share it). Returns the public-rel
// .webp, or undefined.
const emissiveTexCache = new Map<string, Promise<string | undefined>>();
// A real emissive MAP is a single `T_<piece>_Emissive[_<variant>].png` where "Emissive" is the
// trailing map-TYPE token (T_PumpkinHead_Emissive, T_BlankFace_Emissive, T_CNS_FaceEmissive_A).
// It must end in "Emissive" + at most a tiny variant suffix (≤2 chars: _A, _01). Two false-grab
// classes to reject, both from variants/skins literally NAMED with "Emissive":
//   - `TA_..._EmissiveNylon_Colors_0.png` — a detail ARRAY (rejected by ^T_, not TA_)
//   - `T_GlovesAlfaActaEmissive_OcclusionCurvatureMaterialID.png` — an OCM map of the
//     "AlfaActaEmissive" variant; "Emissive" is mid-name, real type suffix is long (rejected by
//     the ≤2-char suffix bound — real map-type suffixes like _OcclusionCurvatureMaterialID/_Normal
//     are all longer). `T_UI_` icons excluded too.
const EMISSIVE_MAP_RE = /^T_(?!UI_).*Emissive(_[A-Za-z0-9]{1,2})?\.png$/i;
function findEmissivePng(skinDir: string): string | null {
  let dir = skinDir;
  for (let up = 0; up < 3 && dir.length >= CHAR_ROOT.length; up++) {
    try {
      const hit = readdirSync(dir).find((f) => EMISSIVE_MAP_RE.test(f));
      if (hit) return resolve(dir, hit);
    } catch {
      /* missing dir — keep walking up */
    }
    dir = dirname(dir);
  }
  return null;
}
function convertEmissiveTex(gltfPath: string, skinDir: string): Promise<string | undefined> {
  const rel = gltfPath.replace(/\.glb$/, ".emissive.webp");
  let p = emissiveTexCache.get(rel);
  if (!p) {
    p = (async () => {
      const src = findEmissivePng(skinDir);
      if (!src) return undefined;
      const dest = resolve(ROOT, "public", rel);
      mkdirSync(dirname(dest), { recursive: true });
      await sharp(longPath(src)).resize(1024, 1024, { fit: "inside" }).webp({ quality: 88 }).toFile(dest);
      return rel;
    })().catch(() => undefined);
    emissiveTexCache.set(rel, p);
  }
  return p;
}

// Attachments use a different master material from garments. Their MI has no OCM/region map:
// CR is authored colour in RGB with roughness in A, while NOM is XY normal in RG with metalness
// in A (the MI often calls this slot NOH). Convert that family into the same finished texture
// contract as the layered baker so CharacterRig does not fall back to a single icon tint.
const attachmentPbrCache = new Map<string, Promise<Material["bakedSet"] | undefined>>();
function findAttachmentMap(skinDir: string, suffix: RegExp): string | undefined {
  try {
    const file = readdirSync(skinDir).find((f) => suffix.test(f));
    return file ? join(skinDir, file) : undefined;
  } catch {
    return undefined;
  }
}
function convertAttachmentPbr(gltfPath: string, skinDir: string): Promise<Material["bakedSet"] | undefined> {
  const cr = findAttachmentMap(skinDir, /^T_.*_CR\.png$/i);
  const nom = findAttachmentMap(skinDir, /^T_.*_(?:NOM|NOH)\.png$/i);
  if (!cr || !nom) return Promise.resolve(undefined);
  const skinKey = slugify(basename(skinDir));
  const relBase = gltfPath.replace(/\.glb$/, `.${skinKey}.attachment`);
  const key = `${relBase}|${cr}|${nom}`;
  let p = attachmentPbrCache.get(key);
  if (!p) {
    p = (async () => {
      const base = await sharp(longPath(cr)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const normal = await sharp(longPath(nom))
        .resize(base.info.width, base.info.height, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = base.info.width * base.info.height;
      const albedoRel = `${relBase}.albedo.webp`;
      const normalRel = `${relBase}.normal.webp`;
      const ormRel = `${relBase}.orm.webp`;
      const albedoAbs = resolve(ROOT, "public", albedoRel);
      const normalAbs = resolve(ROOT, "public", normalRel);
      const ormAbs = resolve(ROOT, "public", ormRel);
      mkdirSync(dirname(albedoAbs), { recursive: true });

      // Preserve the CR's encoded RGB as colour; its alpha is data, not coverage.
      await sharp(longPath(cr)).removeAlpha().webp({ quality: 90 }).toFile(albedoAbs);

      const nOut = Buffer.alloc(px * 3);
      const ormOut = Buffer.alloc(px * 3);
      for (let i = 0; i < px; i++) {
        const bi = i * base.info.channels;
        const ni = i * normal.info.channels;
        const x = (normal.data[ni] / 255) * 2 - 1;
        // UE attachment normals are DirectX; the glTF/three tangent basis is OpenGL.
        const y = -((normal.data[ni + 1] / 255) * 2 - 1);
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        const oi = i * 3;
        nOut[oi] = Math.round((x + 1) * 127.5);
        nOut[oi + 1] = Math.round((y + 1) * 127.5);
        nOut[oi + 2] = Math.round((z + 1) * 127.5);
        ormOut[oi] = 255; // attachment family has no AO map; keep neutral occlusion.
        ormOut[oi + 1] = base.data[bi + 3] ?? 255; // CR alpha = roughness.
        ormOut[oi + 2] = normal.data[ni + 3] ?? 255; // NOM alpha = metalness.
      }
      await sharp(nOut, { raw: { width: base.info.width, height: base.info.height, channels: 3 } })
        .webp({ lossless: true })
        .toFile(normalAbs);
      await sharp(ormOut, { raw: { width: base.info.width, height: base.info.height, channels: 3 } })
        .webp({ lossless: true })
        .toFile(ormAbs);
      return { albedo: albedoRel, normal: normalRel, orm: ormRel };
    })().catch(() => undefined);
    attachmentPbrCache.set(key, p);
  }
  return p;
}

type MaterialPath = "layered bake" | "attachment CR/NOM" | "region-tint" | "plain";

// Build the per-skin material block: the piece-shared region map (if build-regions emitted it)
// + a color per part. Each part's color is the real BaseColorOverlay of the material layer its
// MaterialID selects (the skin's thumbnail is only a fallback for parts with no active layer).
async function buildMaterial(
  gltfPath: string,
  skinDir: string,
  iconAbs: string,
  pathOut?: { path: MaterialPath },
): Promise<Material | undefined> {
  const regionMapPath = gltfPath.replace(/\.glb$/, ".regionmap.png");
  const rmAbs = resolve(ROOT, "public", regionMapPath);
  const regionsAbs = resolve(ROOT, "public", gltfPath.replace(/\.glb$/, ".regions.json"));
  const mi = parseLayeredMI(skinDir);

  const material: Material = {};

  // Self-illuminated pieces (glow) — copy the dump's emissive map; the rig lights it at runtime.
  const emissiveMap = await convertEmissiveTex(gltfPath, skinDir);
  if (emissiveMap) {
    material.emissiveMap = emissiveMap;
    material.emissiveIntensity = 2;
  }

  // Layered-composite baked set (scripts/bake-composite.mjs): if this skin has a baked
  // per-skin albedo/normal/orm, the runtime swaps it in and skips the region-tint path. We
  // still emit the region colors below as a debug/fallback record.
  const layeredSet = lookupBakedSet(gltfPath, skinDir);
  const attachmentSet = layeredSet ? undefined : await convertAttachmentPbr(gltfPath, skinDir);
  const bakedSet = layeredSet ?? attachmentSet;
  if (bakedSet) material.bakedSet = bakedSet;
  if (pathOut && layeredSet) pathOut.path = "layered bake";
  else if (pathOut && attachmentSet) pathOut.path = "attachment CR/NOM";
  if (existsSync(rmAbs) && existsSync(regionsAbs)) {
    const { count, bodyIndex, blues, meanLuma } = JSON.parse(readFileSync(regionsAbs, "utf8")) as {
      count: number;
      bodyIndex: number;
      blues?: number[];
      meanLuma?: number[];
    };
    const decoded =
      mi && Array.isArray(blues) && blues.length === count ? regionsFromMI(mi, blues, count) : null;

    if (decoded && decoded.colors.some((c) => c)) {
      // Objective path: real per-layer colors. Backfill any null part (inactive layer + no
      // ColorA) from the icon so it isn't left grey.
      const icon = decoded.colors.includes(null) ? await sampleIconPalette(iconAbs) : [];
      const fb = (k: number) =>
        (k === bodyIndex ? icon[0] : icon[1] ?? icon[0]) ?? mi!.colorA ?? "#808080";
      material.regionMapPath = regionMapPath;
      material.regionColors = decoded.colors.map((c, k) => c ?? fb(k));
      if (pathOut && !bakedSet) pathOut.path = "region-tint";
      // Raw authored colors, pre any display blend op — the calibration re-fit input.
      material.regionOverlays = decoded.raw.map((c, k) => c ?? fb(k));
      // Per-part PBR derived from each layer's params (cloth-gated — see deriveRegionPbr).
      material.regionMetalness = decoded.pbr.map((p) => p.metal);
      material.regionRoughness = decoded.pbr.map((p) => p.rough);
      if (decoded.pbr.some((p) => p.sheen > 0))
        material.regionSheen = decoded.pbr.map((p) => p.sheen);
      // Per-region mean baked-albedo luminance (the runtime shader's value normalizer).
      if (Array.isArray(meanLuma) && meanLuma.length === count)
        material.regionMeanLuma = meanLuma.map((l) => clamp01(l));
      // Garment print decals: one entry per region whose layer carries one; a decal on a
      // layer with no MaterialID cluster of its own ships ungated (region -1).
      const gd: NonNullable<Material["garmentDecals"]> = [];
      const decalLayersSeen = new Set<number>();
      const pieceDir = resolve(skinDir, "..", ".."); // <piece>/Skins/<skin> -> <piece>, for piece-local decals
      for (let r = 0; r < decoded.layers.length && gd.length < 8; r++) {
        const d = mi!.decals[decoded.layers[r]];
        if (!d) continue;
        decalLayersSeen.add(decoded.layers[r]);
        const rel = await convertGarmentDecal(d.tex, pieceDir);
        if (rel) gd.push({ region: r, path: rel, place: d.place, ...(d.colorA ? { colorA: d.colorA, colorB: d.colorB } : {}) });
      }
      for (let L = 1; L <= MASTER_LAYERS && gd.length < 8; L++) {
        const d = mi!.decals[L];
        if (!d || decalLayersSeen.has(L)) continue;
        const rel = await convertGarmentDecal(d.tex, pieceDir);
        if (rel) gd.push({ region: -1, path: rel, place: d.place, ...(d.colorA ? { colorA: d.colorA, colorB: d.colorB } : {}) });
      }
      // Bare full-UV print (non-layer `Decal` param): a finished colour print baked across the
      // whole garment UV (gothic LooseJacket graphics, etc.). Ungated, scale-1 identity placement.
      if (mi!.fullUvDecal && gd.length < 8) {
        const rel = await convertGarmentDecal(mi!.fullUvDecal, pieceDir);
        if (rel && !gd.some((g) => g.path === rel)) gd.push({ region: -1, path: rel, place: [0, 0, 1, 0] });
      }
      if (gd.length) material.garmentDecals = gd;
      if (REGIONS_DEBUG)
        console.log(
          `  [regions] ${basename(gltfPath)} blues=[${blues}] layers=[${decoded.layers}] -> ${material.regionColors.join(",")}`,
        );
    } else {
      // Fallback (no MI colors): the old icon-derived 2-tier approximation.
      let colors = await sampleIconPalette(iconAbs);
      if (!colors.length && mi?.colorA) colors = [mi.colorA];
      if (!colors.length) colors = await sampleTaColors(skinDir);
      if (colors.length) {
        const primary = colors[0];
        const accent = colors[1] ?? colors[0];
        material.regionMapPath = regionMapPath;
        material.regionColors = Array.from({ length: count }, (_, k) =>
          k === bodyIndex ? primary : accent,
        );
      }
    }
  } else if (!/^models\/heads\//.test(gltfPath)) {
    // No MaterialID parts (hair, or a cosmetic whose PBR textures weren't in the standard
    // sibling folder): a single tint colors the whole mesh so it isn't a grey blob. Hair
    // samples the icon crown; everything else the dominant icon color. Heads are excluded
    // (they're already textured).
    const single = /^models\/hair\//.test(gltfPath)
      ? await sampleHairColor(iconAbs)
      : /^models\/facialhair\//.test(gltfPath)
        ? // Beards: the id's colour suffix is authoritative (black/blonde/red…) — icon sampling
          // fails here because the beard is a small patch and the shadowed mannequin's mid-grey
          // dominates any chin box (every beard sampled ~#7a7b7d: black == blonde == brown).
          // Hexes are the averaged icon-sampled tints of HAIR items with the SAME colour name,
          // so beard and hair colours stay consistent. Unknown names fall back to the chin box.
          (facialHairColor(iconAbs) ?? (await sampleHairColor(iconAbs, 0.42, 0.88, 0.25, 0.75)))
        : (await sampleIconPalette(iconAbs))[0];
    if (single) material.regionColors = [single];
  }

  // Representative whole-mesh roughness/metalness from the base layer, through the same
  // cloth-gated derivation (used for meshes/materials outside the region-map path).
  if (mi) {
    const base = mi.overlays[1] ?? mi.overlays.find((o) => o);
    if (base) {
      const p = deriveRegionPbr(base);
      material.roughness = p.rough;
      material.metalness = p.metal;
    }
  }
  if (pathOut && !pathOut.path) pathOut.path = "plain";
  return Object.keys(material).length ? material : undefined;
}

// ---------------------------------------------------------------------------
// Body decals (M8 part 2) — tattoos/makeup/body-paint/eyes/nails are 2D textures/params that
// composite onto the persistent body & head mesh. Their textures live beside the icon.
// ---------------------------------------------------------------------------
// Convert a decal texture to webp under public/. Color keeps RGBA (alpha = ink/coverage);
// masks collapse to greyscale (runtime reads the red channel).
async function convertDecalTex(srcAbs: string, destRel: string, mask: boolean): Promise<void> {
  const destAbs = resolve(ROOT, "public", destRel);
  mkdirSync(dirname(destAbs), { recursive: true });
  const img = sharp(longPath(srcAbs)).resize(1024, 1024, { fit: "inside", withoutEnlargement: true });
  if (mask) await img.removeAlpha().toColourspace("b-w").webp({ quality: 80 }).toFile(destAbs);
  else await img.webp({ quality: 82, alphaQuality: 90 }).toFile(destAbs);
}

// Shared body-hide masks (generated by scripts/build-body-masks.mjs + the live-scene
// builder; committed under scripts/generated/). Copied into the wiped decals dir so the
// runtime can discard body fragments under an equipped head's own neck/chest shell.
async function buildBodyHideMasks(): Promise<void> {
  const src = resolve(ROOT, "scripts/generated/bodyhide-face.png");
  if (existsSync(src)) await convertDecalTex(src, "models/decals/_shared/bodyhide-face.webp", true);
  // Iris-disc mask (build-eye-textures.mjs) — gates eye-color decals to the iris.
  const iris = resolve(ROOT, "scripts/generated/irismask.png");
  if (existsSync(iris)) await convertDecalTex(iris, "models/decals/_shared/irismask.webp", true);
}

// Shared nail mask (one for all nail polishes) — the body's hand-nail UV region.
async function buildNailMask(): Promise<boolean> {
  const bodyDir = resolve(CHAR_ROOT, "Body");
  let mask: string | undefined;
  try {
    mask = readdirSync(bodyDir).find((f) => /NailMask.*\.png$/i.test(f));
  } catch {
    /* ignore */
  }
  if (!mask) return false;
  await convertDecalTex(join(bodyDir, mask), "models/decals/_shared/nailmask.webp", true);
  return true;
}

// Per-item eyeball metadata from build-eye-decals.mjs (emissive flag + glow tint).
const EYE_DECAL_META: Record<string, { emissive?: boolean; tint?: string }> = existsSync(
  resolve(ROOT, "scripts/eye-decals.generated.json"),
)
  ? (JSON.parse(readFileSync(resolve(ROOT, "scripts/eye-decals.generated.json"), "utf8")) as Record<
      string,
      { emissive?: boolean; tint?: string }
    >)
  : {};

// Build a 2D decal for a BodyCosmetics item. tattoo/makeup are color textures (alpha=coverage)
// on the body/head UV; bodyPaint is a flat icon tint + mask on UV1; eyes/nails are flat icon
// tints (the runtime applies eyes to the head iris, nails through the shared nail mask).
async function buildDecal(
  slot: Slot,
  skinDir: string,
  id: string,
  iconAbs: string,
  hasNailMask: boolean,
): Promise<Decal | undefined> {
  if (slot === "eyes" || slot === "nailPolish") {
    if (slot === "nailPolish" && !hasNailMask) return undefined;
    if (slot === "eyes") {
      // Preferred: the per-item composited EYEBALL texture (build-eye-decals.mjs — real iris
      // texture + hue tint + sclera tint from the style's MI). The flat icon tint lost every
      // motif (dragon scales, camera aperture, slit pupils) and mis-sampled base colours
      // (brown iris -> grey). The colour layer replaces the whole eyeball (alpha=1), so dark
      // scleras carry too; MI IrisBrightness>2 flags emissive (runtime glows the layer).
      // Source lives in scripts/generated/eyes (this run wipes public/models/decals) and is
      // copied into place here.
      const eyeSrc = resolve(ROOT, "scripts/generated/eyes", `${id}.webp`);
      const eyeTex = `models/decals/eyes/${id}.webp`;
      if (existsSync(eyeSrc)) {
        mkdirSync(resolve(ROOT, "public/models/decals/eyes"), { recursive: true });
        copyFileSync(eyeSrc, resolve(ROOT, "public", eyeTex));
        const layer: Decal["layers"][number] = { target: "eyes", colorPath: eyeTex };
        const em = EYE_DECAL_META[id];
        if (em?.emissive) {
          layer.emissive = true;
          if (em.tint) layer.tint = em.tint;
        }
        return { layers: [layer] };
      }
    }
    const tint = (await sampleIconPalette(iconAbs))[0];
    if (!tint) return undefined;
    if (slot === "eyes") {
      const layer: Decal["layers"][number] = { target: "eyes", tint };
      // gate the recolor to the iris disc (same UV layout as the composited eyeball)
      if (existsSync(resolve(ROOT, "public/models/decals/_shared/irismask.webp")))
        layer.maskPath = "models/decals/_shared/irismask.webp";
      // "Emissive" eye items glow in-game — the runtime adds the tint as emissive too.
      if (/emissive/i.test(id)) layer.emissive = true;
      return { layers: [layer] };
    }
    return { layers: [{ target: "nails", tint }] };
  }

  let files: string[];
  try {
    files = readdirSync(skinDir);
  } catch {
    return undefined;
  }
  const colorFiles = files.filter((f) => /_C\.png$/i.test(f) && !/^T_UI_/i.test(f));
  const maskFor = (cf: string) =>
    files.find((f) => f.toLowerCase() === cf.replace(/_C\.png$/i, "_M.png").toLowerCase());

  // bodyPaint may ship only a mask + tiny swatch — emit an icon tint + mask on UV1.
  if (slot === "bodyPaint") {
    const cf = colorFiles[0];
    const mf = cf ? maskFor(cf) : files.find((f) => /_M\.png$/i.test(f) && !/^T_UI_/i.test(f));
    const tint = (await sampleIconPalette(iconAbs))[0];
    if (!tint) return undefined;
    const layer: Decal["layers"][number] = { target: "body", tint, uv: 1 };
    if (mf) {
      const mp = `models/decals/${slot}/${id}_m.webp`;
      await convertDecalTex(join(skinDir, mf), mp, true);
      layer.maskPath = mp;
    }
    return { layers: [layer] };
  }

  // tattoo / makeup: composite each color texture (its alpha is the coverage).
  const layers: Decal["layers"] = [];
  for (const cf of colorFiles) {
    if (layers.length >= 6) break;
    const target: Decal["layers"][number]["target"] = /head/i.test(cf) ? "head" : "body";
    const base = `models/decals/${slot}/${id}${layers.length ? `-${layers.length}` : ""}`;
    const colorPath = `${base}.webp`;
    await convertDecalTex(join(skinDir, cf), colorPath, false);
    const layer: Decal["layers"][number] = { target, colorPath, uv: 0 };
    const mf = maskFor(cf);
    if (mf) {
      const mp = `${base}_m.webp`;
      await convertDecalTex(join(skinDir, mf), mp, true);
      layer.maskPath = mp;
    }
    layers.push(layer);
  }
  return layers.length ? { layers } : undefined;
}

// ---------------------------------------------------------------------------
// Per-piece mesh overrides — attach a converted .glb to every skin of a piece.
// Keyed by `${set}/${piece}` (lowercase). The path is only attached if the .glb
// actually exists under public/ (so the catalog stays icon-only until M3 converts it).
// ---------------------------------------------------------------------------
// Hand-authored fallback (the M3 vertical slice). scripts/discover-assets.ts (M6)
// regenerates the full map; when present it merges on top (generated wins).
const HARDCODED_MODEL_BY_PIECE: Record<string, string> = {
  "actionhero/sentineltop": "models/cosmetics/actionhero-sentinel-top.glb",
  "actionhero/sentinelboots": "models/cosmetics/actionhero-sentinel-boots.glb",
  "actionhero/sentinelgloves": "models/cosmetics/actionhero-sentinel-gloves.glb",
  "actionhero/sentinelpants": "models/cosmetics/actionhero-sentinel-pants.glb",
  // M7: head into the `face` slot, hair into the `hair` slot (special categories).
  "heads/face_01": "models/heads/face-01.glb",
  "hairs/bobstraight": "models/hair/bobstraight.glb",
  // Variant pieces whose OWN folder has no mesh — the icon-derived piece key differs from the
  // mesh-bearing folder. Exact-mesh aliases (same asset, different skin/naming):
  "watches/adventurergolden_01": "models/watch/adventurer-01.glb",
  "watches/sundial_01_trentila": "models/watch/sundial-01.glb",
  "streetwear/tracksuittorso": "models/cosmetics/streetwear-track-suit-torso-glitch.glb", // base torso ships textures only; Glitch mesh is the same garment
  "mexico/mariachipantsnobuttons": "models/cosmetics/mexico-mariachi-pants.glb", // base pants ARE the buttonless cut (Buttons is the variant)
  // Close-partial aliases (base mesh missing a minor companion the variant adds — better than
  // rendering nothing; the census ledger tracks the residual as missing-part):
  "ballerina/masquerademaskwithflower": "models/cosmetics/ballerina-masquerade-mask.glb",
  "ballerina/tutuskirtwithtights": "models/cosmetics/ballerina-tutu-skirt.glb",
  "military/tacticalheadphoneswithcap": "models/cosmetics/military-tactical-headphones.glb",
};
const GENERATED_MAP_FILE = resolve(ROOT, "scripts/model-by-piece.generated.json");
const MODEL_BY_PIECE: Record<string, string> = {
  ...HARDCODED_MODEL_BY_PIECE,
  ...(existsSync(GENERATED_MAP_FILE)
    ? (JSON.parse(readFileSync(GENERATED_MAP_FILE, "utf8")) as Record<string, string>)
    : {}),
};

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------
interface IconHit {
  absPath: string;
  segs: string[]; // path segments relative to CHAR_ROOT (incl. filename)
}

function walk(): IconHit[] {
  const hits: IconHit[] = [];
  const recurse = (abs: string, segs: string[]) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childAbs = join(abs, e.name);
      if (e.isDirectory()) {
        recurse(childAbs, [...segs, e.name]);
      } else if (/^T_UI_.*\.png$/i.test(e.name)) {
        hits.push({ absPath: childAbs, segs: [...segs, e.name] });
      }
    }
  };
  for (const cat of readdirSync(CHAR_ROOT, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    if (SKIP_CATEGORIES.has(cat.name)) continue;
    recurse(join(CHAR_ROOT, cat.name), [cat.name]);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Classification of one icon hit -> draft item (or a skip reason)
// ---------------------------------------------------------------------------
interface Draft {
  item: Item;
  pieceKey: string | null;
}
type Classified = { ok: true; draft: Draft } | { ok: false; reason: string };

function classify(hit: IconHit): Classified {
  const cat = hit.segs[0];
  const fileToken = basename(hit.segs.at(-1)!, ".png").replace(/^T_UI_/i, "");
  const tokens = fileToken.split("_");

  // skin = segment after a `Skins` (or `Base`) folder, else "" (base item)
  const skinsIdx = hit.segs.findIndex((s) => /^skins$/i.test(s));
  const skin =
    skinsIdx >= 0 && hit.segs[skinsIdx + 1] && !hit.segs[skinsIdx + 1].endsWith(".png")
      ? hit.segs[skinsIdx + 1]
      : "";

  // determine slot, piece, set
  let slot: Slot | null = null;
  let piece: string | null = null;
  let setName: string | undefined;

  if (cat === "BodyCosmetics") {
    const sub = hit.segs[1];
    slot = BODYCOSMETIC_SLOT[sub] ?? null;
    piece = hit.segs[2] ?? sub;
  } else if (SPECIAL_SLOT[cat]) {
    slot = SPECIAL_SLOT[cat];
    piece = hit.segs[1] ?? cat;
  } else {
    // set folder (ActionHero…) or Attachments: piece = segment after Assets, else segs[1]
    const assetsIdx = hit.segs.findIndex((s) => /^assets$/i.test(s));
    piece = (assetsIdx >= 0 ? hit.segs[assetsIdx + 1] : hit.segs[1]) ?? cat;
    slot = keywordSlot(piece) ?? keywordSlot(fileToken);
    if (cat !== "Attachments") setName = cat;
  }

  if (!slot) return { ok: false, reason: `${cat}/${piece ?? "?"}` };
  if (!SLOTS.includes(slot)) return { ok: false, reason: `bad-slot:${slot}` };

  const id = makeId(fileToken);
  // name: drop a leading token that just repeats the set/category
  const nameTokens = [...tokens];
  if (
    nameTokens.length > 1 &&
    (nameTokens[0].toLowerCase() === cat.toLowerCase() ||
      nameTokens[0].toLowerCase() === "attachment" ||
      nameTokens[0].toLowerCase() === "attachments" ||
      nameTokens[0].toLowerCase() === "head")
  ) {
    nameTokens.shift();
  }
  const name = titleCase(nameTokens.join(" ")).slice(0, 80) || titleCase(fileToken).slice(0, 80);

  const sponsor = inferSponsor(tokens);
  const tags: string[] = [];
  if (skin) tags.push(slugify(skin));

  // Key pieces by `${cat}/${piece}` (covers set folders AND special categories like
  // Heads/Hairs, whose meshes are wired in MODEL_BY_PIECE). setName stays set-folder-only.
  const pieceKey = piece ? `${cat}/${piece}`.toLowerCase() : null;

  const item: Item = {
    id,
    slot,
    name,
    imageUrl: `items/${slot}/${id}.webp`,
    ...(setName ? { set: setName } : {}),
    ...(sponsor ? { sponsor } : {}),
    ...(tags.length ? { tags } : {}),
  };

  return { ok: true, draft: { item, pieceKey } };
}

// ---------------------------------------------------------------------------
// Icon conversion with a small concurrency pool
// ---------------------------------------------------------------------------
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// Pick a colour-coordinated default undersuit for each outerwear item. Candidates are
// back-covering Upper Body tops (not crop/tube/tank, which expose the back) that have a 3D
// model + a primary colour; each coat gets the candidate nearest its primary colour in Oklab,
// so the coat's open back reads as tonal layering. No-op for coats/candidates without a colour.
async function assignCoatUnderLayers(items: Item[]): Promise<void> {
  // TRUE displayed colour comes from the baked albedo mean (regionColors[0] is the raw overlay,
  // which is white for ColorMask-scheme skins like satin — would mismatch badly). Fall back to
  // regionColors only when a skin isn't baked.
  const hexToOklab = (hex: string): [number, number, number] | null => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return linearToOklab(srgbToLinear((n >> 16) & 255), srgbToLinear((n >> 8) & 255), srgbToLinear(n & 255));
  };
  // {lab, varr, hex} — varr = mean per-channel byte variance of the baked albedo (high = busy
  // graphic/stripes/flag, low = solid colour); hex = the mean sRGB colour (used as a coat's
  // runtime undersuit tint). We only want SOLID tops as undersuits.
  type LabVar = { lab: [number, number, number]; varr: number; hex: string } | null;
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const labCache = new Map<string, LabVar>();
  const labOf = async (it: Item): Promise<LabVar> => {
    if (labCache.has(it.id)) return labCache.get(it.id)!;
    let out: LabVar = null;
    const albedo = it.model?.material?.bakedSet?.albedo;
    if (albedo) {
      try {
        const { data, info } = await sharp(resolve(ROOT, "public", albedo))
          .resize(48, 48) // big enough that prints/stripes register as variance (8px blurs them out)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const ch = info.channels;
        const n = data.length / ch;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += ch) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        r /= n; g /= n; b /= n;
        let v = 0;
        for (let i = 0; i < data.length; i += ch)
          v += (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
        out = {
          lab: linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)),
          varr: Math.sqrt(v / (n * 3)),
          hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
        };
      } catch {
        /* fall through to regionColors */
      }
    }
    if (!out) {
      const hex = it.model?.material?.regionColors?.[0] ?? it.model?.material?.regionOverlays?.[0];
      const lab = hex ? hexToOklab(hex) : null;
      out = lab ? { lab, varr: 0, hex } : null;
    }
    labCache.set(it.id, out);
    return out;
  };
  // EVERY open coat gets the SAME plain, decal-free, light-grey long-sleeve as its undersuit,
  // runtime-recoloured to the colour the GAME'S OFFICIAL ICON shows under the open coat. The icon
  // is the project's match target, and for open coats it reveals the real under-shirt — which is
  // its OWN colour, not the coat's (satin → charcoal tee, brown coat → olive shirt). Sampling the
  // coat's mean instead got the hue wrong. We sample the icon's centre-chest (median, robust to a
  // stray chest number/logo). Closed coats hide no undersuit, so the sample falls on the coat and
  // degrades to ≈coat-colour — harmless since nothing shows there. Picking a real matched top was
  // worse still (hue error + baked logos bleeding through). The undersuit must carry a baked albedo
  // (the runtime recolours that); without it, skip (keeps neutral tee).
  const TINT_UNDERSUIT = "casual-longsleevedshirt-nylon";
  const hasTintUndersuit = items.some(
    (i) => i.id === TINT_UNDERSUIT && i.model?.material?.bakedSet,
  );
  if (!hasTintUndersuit) {
    console.log(`  undersuit: tint base '${TINT_UNDERSUIT}' missing/unbaked — left neutral.`);
    return;
  }
  // Median colour of the icon's centre-chest box (the open-coat reveal), as a #RRGGBB hex.
  const iconUndersuitHex = async (it: Item): Promise<string | null> => {
    const p = resolve(ROOT, "public", it.imageUrl);
    if (!existsSync(p)) return null;
    try {
      const W = 120, H = 120;
      const { data, info } = await sharp(p).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      const [x0, x1, y0, y1] = [0.42, 0.58, 0.33, 0.55].map((f, i) => Math.round(f * (i < 2 ? W : H)));
      const chan: number[][] = [[], [], []];
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * ch;
          chan[0].push(data[i]); chan[1].push(data[i + 1]); chan[2].push(data[i + 2]);
        }
      if (!chan[0].length) return null;
      const med = (a: number[]) => a.sort((u, v) => u - v)[a.length >> 1];
      return `#${toHex(med(chan[0]))}${toHex(med(chan[1]))}${toHex(med(chan[2]))}`;
    } catch {
      return null;
    }
  };
  let tinted = 0;
  for (const it of items) {
    if (it.slot !== "outerwear" || !it.model) continue;
    const lv = await labOf(it);
    const tint = (await iconUndersuitHex(it)) ?? lv?.hex;
    if (!tint) continue;
    it.model.underLayer = TINT_UNDERSUIT;
    it.model.underLayerTint = tint;
    tinted++;
  }
  console.log(`  undersuit: ${tinted} outerwear → plain top tinted to the icon's under-shirt colour.`);
}

// Season metadata: the cooked dump exports the per-item DataAssets EMPTY (CharacterCustomizationItem
// is an Embark Angelscript class whose schema isn't in the usmap), but the `Online.Season.N` gameplay
// tag survives in the raw .uasset name-batch — recovered offline by scripts/extract-customization.mjs
// into customization.generated.json (no UE4SS/anti-cheat risk). Match each item to its DA by
// normalized id and stamp item.season (the long-empty ItemSchema field). Season 0 = pre-S1 content.
function assignSeasons(items: Item[]): void {
  const file = resolve(ROOT, "scripts/customization.generated.json");
  if (!existsSync(file)) {
    console.log("  season: customization.generated.json missing (run extract-customization.mjs) — skip");
    return;
  }
  const cust = JSON.parse(readFileSync(file, "utf8")) as Record<string, { season?: number }>;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seasonByKey = new Map<string, number>();
  for (const [da, v] of Object.entries(cust))
    if (typeof v.season === "number") seasonByKey.set(norm(da.replace(/^DA_/, "")), v.season);
  let n = 0;
  for (const it of items) {
    const s = seasonByKey.get(norm(it.id));
    if (s == null) continue;
    it.season = s >= 1 ? s : "launch";
    n++;
  }
  console.log(`  season: stamped ${n}/${items.length} items from customization DAs.`);
}

// Real open-coat under-layer: the customization DA names the actual under-garment mesh the game
// layers under each coat (e.g. LongCoat -> SK_FancyDress_LawyerSuitJacket). When that mesh resolves
// to a converted glb that EXISTS on disk, point the outerwear at it (item.model.underLayerUrl) so
// the rig composites the REAL mesh instead of recolouring the generic top. Unresolved meshes
// (accessories / under-only meshes never converted) keep the generic underLayer/underLayerTint.
function assignRealUnderLayers(items: Item[]): void {
  const file = resolve(ROOT, "scripts/customization.generated.json");
  if (!existsSync(file)) {
    console.log("  under-layer(real): customization.generated.json missing — skip");
    return;
  }
  const cust = JSON.parse(readFileSync(file, "utf8")) as Record<string, { underLayer?: { mesh?: string } }>;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const underByKey = new Map<string, string>();
  for (const [da, v] of Object.entries(cust))
    if (v.underLayer?.mesh) underByKey.set(norm(da.replace(/^DA_/, "")), v.underLayer.mesh);

  const cosmeticsDir = resolve(ROOT, "public/models/cosmetics");
  const onDisk = new Set(
    existsSync(cosmeticsDir) ? readdirSync(cosmeticsDir).filter((f) => f.endsWith(".glb")) : [],
  );
  // mesh name (SK_<Set>_<Piece>_<LOD>) -> a converted glb that EXISTS on disk, or null.
  const resolveGlb = (mesh: string): string | null => {
    const piece = mesh.replace(/^SK_/, "").replace(/_[HLM]$/, "");
    const parts = piece.split("_");
    const byKey = MODEL_BY_PIECE[(parts[0] + "/" + parts.slice(1).join("")).toLowerCase()];
    if (byKey && onDisk.has(byKey.split("/").pop()!)) return byKey;
    // fuzzy: a glb whose name contains every piece token (handles naming drift between mesh + glb).
    // sort() first so a multi-match resolves deterministically (filesystem order isn't stable).
    const hit = [...onDisk].sort().find((f) => {
      const fn = norm(f.replace(/\.glb$/, ""));
      return parts.every((p) => p.length > 2 && fn.includes(p.toLowerCase()));
    });
    return hit ? `models/cosmetics/${hit}` : null;
  };

  let n = 0;
  for (const it of items) {
    // Torso garments only — coats (outerwear) and open vests/jackets/hoodies (upperBody) layer
    // over a lining; the parser already gated under-layers to BodyUpper-slot wearers.
    if ((it.slot !== "outerwear" && it.slot !== "upperBody") || !it.model) continue;
    const mesh = underByKey.get(norm(it.id));
    if (!mesh) continue;
    const glb = resolveGlb(mesh);
    if (!glb) continue;
    it.model.underLayerUrl = glb;
    n++;
  }
  console.log(`  under-layer(real): ${n} torso garments -> real under-mesh.`);
}

// Named-metal recolour: gold/silver/brass accessories (glasses frames, masks, veils) often bake to
// a neutral GREY because the metal's warm tint lives in a layer we don't reconstruct and icon
// sampling lands on the lens/background. When EVERY region of a clearly metal-named item is
// desaturated, replace them with the canonical metal tint (albedo only — a gold frame keeps its
// metalness and reads as gold metal; a gold veil stays low-metal and reads as gold-tinted fabric).
// Mixed items (a gold mask with grey straps) are left alone to avoid gilding the non-metal parts.
const METAL_TINT: Record<string, string> = {
  gold: "#c9a23c", brass: "#b8902f", bronze: "#9c6b3a", copper: "#b06a3a",
  silver: "#c4c6cc", chrome: "#c8cace", platinum: "#cfd2d6",
};
function recolorSolidMetals(items: Item[]): void {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const chroma = (hex: string) => { const [r, g, b] = rgb(hex); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
  const luma = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  let n = 0;
  for (const it of items) {
    const w = /gold|brass|bronze|copper|silver|chrome|platinum/i.exec(it.id)?.[0].toLowerCase();
    if (!w) continue;
    const cols = it.model?.material?.regionColors;
    // Only uniformly-grey items in the METAL luma band: excludes near-white fabric (a white veil
    // with gold trim reads desaturated-but-bright, not grey metal) and near-black.
    if (!cols?.length || !cols.every((c) => chroma(c) < 0.12 && luma(c) >= 0.3 && luma(c) <= 0.82)) continue;
    it.model!.material!.regionColors = cols.map(() => METAL_TINT[w]);
    if (it.model!.material!.regionOverlays)
      it.model!.material!.regionOverlays = it.model!.material!.regionOverlays!.map(() => METAL_TINT[w]);
    n++;
  }
  console.log(`  metal recolour: ${n} solid-metal items -> canonical tint.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(CHAR_ROOT)) {
    console.error(`Characters folder not found: ${CHAR_ROOT}`);
    console.error("Set FINALS_DUMP to the dump's Characters/ folder.");
    process.exit(1);
  }

  console.log(`Walking ${CHAR_ROOT} …`);
  const hits = walk();
  console.log(`Found ${hits.length} T_UI_*.png icons.`);

  const items: Item[] = MATERIALS_ONLY ? JSON.parse(readFileSync(MATERIAL_CATALOG_SOURCE ? resolve(MATERIAL_CATALOG_SOURCE) : OUT_ITEMS, "utf8")) : [];
  if (MATERIALS_ONLY) CatalogSchema.parse(items); // validate without changing existing field order
  const existingItems = new Map(items.map((item) => [item.id, item]));
  const iconJobs: { src: string; destAbs: string }[] = [];
  const materialJobs: MaterialJob[] = [];
  const decalJobs: { item: Item; slot: Slot; skinDir: string; iconAbs: string }[] = [];
  const perSlot: Record<string, number> = Object.fromEntries(SLOTS.map((s) => [s, 0]));
  const skipped: Record<string, number> = {};

  for (const hit of hits) {
    const c = classify(hit);
    if (!c.ok) {
      skipped[c.reason] = (skipped[c.reason] ?? 0) + 1;
      continue;
    }
    const { pieceKey } = c.draft;
    const item = MATERIALS_ONLY ? existingItems.get(c.draft.item.id) : c.draft.item;
    if (!item) continue;

    // attach a mesh only if its converted .glb already exists on disk
    const gltfPath = MATERIALS_ONLY ? item.model?.gltfPath : pieceKey ? MODEL_BY_PIECE[pieceKey] : undefined;
    if (gltfPath) {
      if (existsSync(resolve(ROOT, "public", gltfPath))) {
        if (!MATERIALS_ONLY) item.model = { gltfPath };
        // The skin's MaterialInstance + texture arrays live in the icon's folder; the icon
        // itself is the ground-truth colorway source.
        materialJobs.push({ itemId: item.id, model: item.model!, skinDir: dirname(hit.absPath), iconAbs: hit.absPath });
        // Heads pair the shared body material to the face's tone (sibling MI_Body_*.json).
        if (!MATERIALS_ONLY && item.slot === "face") {
          const bodySkin = await parseBodySkinMI(dirname(hit.absPath));
          if (bodySkin) item.model.bodySkin = bodySkin;
        }
      }
    }

    if (MATERIALS_ONLY) continue;

    // 2D body cosmetics with no mesh -> a decal composited onto the body/head.
    if (!item.model && DECAL_SLOTS.has(item.slot)) {
      decalJobs.push({ item, slot: item.slot, skinDir: dirname(hit.absPath), iconAbs: hit.absPath });
    }

    items.push(item);
    perSlot[item.slot]++;
    iconJobs.push({
      src: hit.absPath,
      destAbs: resolve(PUBLIC_ITEMS, item.slot, `${item.id}.webp`),
    });
  }

  if (MATERIALS_ONLY) {
    console.log(`Resolving materials for ${materialJobs.length} existing catalog models …`);
    await assignMaterialBindings(materialJobs, items);
    CatalogSchema.parse(items);
    writeFileSync(OUT_ITEMS, JSON.stringify(items, null, 2) + "\n");
    console.log(`Wrote material bindings -> ${OUT_ITEMS}`);
    return;
  }

  // Wipe the generated decals dir up-front: BOTH the material jobs (garment print decals
  // under _garment/) and the decal jobs below write into it. (Guarded so we only ever
  // clear .../public/models/decals.)
  if (
    (materialJobs.length || decalJobs.length) &&
    existsSync(PUBLIC_DECALS) &&
    basename(PUBLIC_DECALS) === "decals" &&
    basename(dirname(PUBLIC_DECALS)) === "models"
  ) {
    rmSync(PUBLIC_DECALS, { recursive: true, force: true });
  }

  // Attach per-skin material/dye data to items that got a mesh (reads the converted
  // ColorMask under public/models + the skin's MaterialInstance from the dump).
  if (materialJobs.length) {
    console.log(`Building materials for ${materialJobs.length} pieces …`);
    const materialPaths = new Map<string, MaterialPath>();
    await pool(materialJobs, ICON_CONCURRENCY, async (job) => {
      const pathOut = { path: "plain" as MaterialPath };
      const mat = await buildMaterial(job.model.gltfPath, job.skinDir, job.iconAbs, pathOut);
      if (mat) job.model.material = mat;
      materialPaths.set(job.itemId, pathOut.path);
    });
    const withMat = materialJobs.filter((j) => j.model.material).length;
    console.log(`  attached material to ${withMat}/${materialJobs.length}.`);
    const pathCounts = Object.fromEntries(
      (["layered bake", "attachment CR/NOM", "region-tint", "plain"] as MaterialPath[]).map((path) => [
        path,
        [...materialPaths.values()].filter((p) => p === path).length,
      ]),
    );
    console.log(`  material paths: ${JSON.stringify(pathCounts)}`);
    const reportPath = process.env.MATERIAL_PATH_REPORT;
    if (reportPath) {
      mkdirSync(dirname(resolve(reportPath)), { recursive: true });
      writeFileSync(
        resolve(reportPath),
        JSON.stringify(
          {
            counts: pathCounts,
            items: Object.fromEntries([...materialPaths.entries()].sort(([a], [b]) => a.localeCompare(b))),
          },
          null,
          2,
        ) + "\n",
      );
    }
    console.log(`  garment print decals converted: ${garmentDecalCache.size}`);
  }

  await buildBodyHideMasks();

  // Build 2D decals (tattoos/makeup/body-paint/eyes/nails) onto the body/head.
  if (decalJobs.length) {
    const hasNailMask = await buildNailMask();
    console.log(`Building decals for ${decalJobs.length} items …`);
    await pool(decalJobs, ICON_CONCURRENCY, async (job) => {
      const decal = await buildDecal(job.slot, job.skinDir, job.item.id, job.iconAbs, hasNailMask);
      if (decal) job.item.decal = decal;
    });
    const withDecal = decalJobs.filter((j) => j.item.decal).length;
    console.log(`  attached decal to ${withDecal}/${decalJobs.length}.`);
  }

  // wipe + recreate public/items (guarded so we only ever clear .../public/items)
  if (
    existsSync(PUBLIC_ITEMS) &&
    basename(PUBLIC_ITEMS) === "items" &&
    basename(dirname(PUBLIC_ITEMS)) === "public"
  ) {
    rmSync(PUBLIC_ITEMS, { recursive: true, force: true });
  }
  for (const slot of SLOTS) mkdirSync(resolve(PUBLIC_ITEMS, slot), { recursive: true });

  console.log(`Converting ${iconJobs.length} icons -> webp (${ICON_SIZE}px) …`);
  let done = 0;
  await pool(iconJobs, ICON_CONCURRENCY, async (job) => {
    const buf = readFileSync(longPath(job.src));
    await sharp(buf)
      .resize(ICON_SIZE, ICON_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 82 })
      .toFile(job.destAbs);
    if (++done % 500 === 0) console.log(`  …${done}/${iconJobs.length}`);
  });

  // Per-coat colour-coordinated default undersuit: open/vented coats reveal an undersuit
  // through the back (genuine open mesh). Match each outerwear's primary colour to the nearest
  // back-covering Upper Body top so the opening reads as tonal layering, not a stark hole.
  await assignCoatUnderLayers(items);
  assignSeasons(items);
  assignRealUnderLayers(items);
  recolorSolidMetals(items);
  await assignMaterialBindings(materialJobs, items);

  // validate before writing — fail loudly if a draft violates the schema
  const parsed = CatalogSchema.safeParse(items);
  if (!parsed.success) {
    console.error("Generated catalog failed schema validation:");
    for (const issue of parsed.error.issues.slice(0, 20)) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  items.sort((a, b) => a.slot.localeCompare(b.slot) || a.id.localeCompare(b.id));
  writeFileSync(OUT_ITEMS, JSON.stringify(items, null, 2) + "\n");

  // report
  const withModel = items.filter((i) => i.model).length;
  const withDecal = items.filter((i) => i.decal).length;
  const lines: string[] = [];
  lines.push(`catalog: ${items.length} items (${withModel} with 3D model, ${withDecal} with decal)`);
  lines.push("");
  lines.push("items per slot:");
  for (const slot of SLOTS) lines.push(`  ${slot.padEnd(12)} ${perSlot[slot]}`);
  lines.push("");
  lines.push("skipped (reason -> count), top 40:");
  for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    lines.push(`  ${String(n).padStart(5)}  ${reason}`);
  }
  const totalSkipped = Object.values(skipped).reduce((a, b) => a + b, 0);
  lines.push("");
  lines.push(`total skipped icons: ${totalSkipped}`);
  writeFileSync(REPORT, lines.join("\n") + "\n");

  console.log(`\nWrote ${items.length} items -> ${OUT_ITEMS}`);
  console.log(`Report -> ${REPORT}`);
  console.log(`Skipped ${totalSkipped} icons (unmatched slot / skip categories).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
