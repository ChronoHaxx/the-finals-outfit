// build-eye-decals.mjs — per-ITEM composited eyeball textures for the `eyes` cosmetic slot.
//
// The census exposed that eye items rendered as flat icon-sampled tints: dragon/camera/crystal
// irises lost their motifs, emissive eyes lost their glow, dark scleras stayed white. The real
// recipe is in each style's MI (parent MI_HeadMaster_Eyes): an IrisColor TEXTURE (shared
// T_EyeIrisBaseColor_* set) + IrisHueTint + ScleraTint + IrisBrightness (glow) + Iris UV Radius.
//
// This composites, per style, a full eyeball texture in the EXACT layout of
// build-eye-textures.mjs (512px, iris disc D=230 centred — the head eye-mesh UV maps that
// layout), so the runtime can swap the whole eyeball via the existing `eyes` decal target.
// Outputs (import:catalog WIPES public/models/decals on every run, so like irismask these live
// under scripts/generated/ and import copies them into public/models/decals/eyes/):
//   scripts/generated/eyes/<item-id>.webp              (sRGB eyeball colour)
//   scripts/eye-decals.generated.json                  ({ id: {emissive?: true, tint: "#hex"} })
// Run: node scripts/build-eye-decals.mjs   (idempotent; import:catalog consumes the outputs)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";
const CONTENT = resolve(DUMP, "../../");
const SCLERA = join(CONTENT, "Pioneer/Characters/Heads/Shared/Eyes/Textures/T_EyeScleraBaseColor_Example_2.png");
const EYES_ROOT = join(DUMP, "BodyCosmetics/Eyes");
const OUT_DIR = resolve(SCRIPT_DIR, "generated/eyes");
const META_OUT = resolve(SCRIPT_DIR, "eye-decals.generated.json");

const S = 512;
const BASE_D = 230; // iris diameter at the reference Iris UV Radius
const REF_UV_RADIUS = 0.233095; // dragon/gray baseline observed across MIs

const get = (j) => (Array.isArray(j) ? (j.find((x) => x.Properties) ?? j[0]) : j);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hexToRgb = (h) => (h ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);

const objPathToPng = (p) => {
  if (!p) return null;
  const m = String(p).replace(/\.\d+$/, "").match(/\/Game\/Discovery\/Characters\/(.+)$/);
  if (!m) return null;
  const png = resolve(DUMP, m[1] + ".png");
  return existsSync(png) ? png : null;
};

async function main() {
  if (!existsSync(SCLERA)) throw new Error("sclera texture missing: " + SCLERA);
  mkdirSync(OUT_DIR, { recursive: true });
  const scleraBase = await sharp(SCLERA).resize(S, S).removeAlpha().raw().toBuffer();

  const meta = {};
  let made = 0;
  const misses = [];
  for (const d of readdirSync(EYES_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(EYES_ROOT, d.name);
    const miFile = readdirSync(dir).find((f) => /^MI_.*\.json$/i.test(f));
    if (!miFile) {
      misses.push(d.name + " (no MI)");
      continue;
    }
    const mi = get(JSON.parse(readFileSync(join(dir, miFile), "utf8"))).Properties ?? {};
    const tex = Object.fromEntries(
      (mi.TextureParameterValues ?? []).map((t) => [t.ParameterInfo?.Name, t.ParameterValue?.ObjectPath]),
    );
    const vec = Object.fromEntries(
      (mi.VectorParameterValues ?? []).map((v) => [v.ParameterInfo?.Name, v.ParameterValue?.Hex]),
    );
    const sca = Object.fromEntries(
      (mi.ScalarParameterValues ?? []).map((s) => [s.ParameterInfo?.Name, s.ParameterValue]),
    );

    const id = "bodycosmetics-eyes-" + slug(d.name);
    const irisPng = objPathToPng(tex.IrisColor);
    const irisTint = hexToRgb(vec.IrisHueTint);
    const scleraTint = hexToRgb(vec.ScleraTint);
    const brightness = sca.IrisBrightness ?? 1;
    const uvRadius = sca["Iris UV Radius"] ?? REF_UV_RADIUS;
    // Styles parented to a CUSTOM eye master (M_CharacterEyes_Absorbe_01, M_Character_CrystalBall,
    // M_CharacterEyes_Gears_01, NeonTubes, Vaiiya, heart ShapeTexture...) generate their motif IN
    // the (stripped) shader — no iris texture exists. Their ICON is a rendered close-up of the
    // very eyeball, so the icon's centre crop becomes the iris disc instead.
    const parentName = String(mi.Parent?.ObjectPath ?? "").split("/").pop() ?? "";
    const iconPng = join(dir, readdirSync(dir).find((f) => /^T_UI_.*\.png$/i.test(f)) ?? "__none__");
    // Icon-crop cases: (a) custom eye masters whose motif is generated in the stripped shader;
    // (b) the plain Gray base + a strongly chromatic tint — the Gray disc's dominant dark pupil
    // crushes the tint (Viking crimson rendered near-black; icon shows vivid pink).
    const grayBase = !irisPng || /Gray_01_CA/i.test(irisPng);
    const tintChroma = irisTint ? (Math.max(...irisTint) - Math.min(...irisTint)) / 255 : 0;
    const procedural =
      (!/MI_HeadMaster_Eyes/i.test(parentName) && !irisPng) || (grayBase && tintChroma > 0.3);

    // sclera: tint when authored (dark/red scleras are part of the look); else the standard lift.
    const out = Buffer.from(scleraBase);
    if (scleraTint) {
      for (let i = 0; i < out.length; i += 3) {
        out[i] = Math.min(255, (out[i] * scleraTint[0]) / 160);
        out[i + 1] = Math.min(255, (out[i + 1] * scleraTint[1]) / 160);
        out[i + 2] = Math.min(255, (out[i + 2] * scleraTint[2]) / 160);
      }
    } else {
      for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(out[i] * 1.35));
    }

    // iris: texture x hue-tint x brightness (LDR-clamped; real glow flagged as emissive).
    const D = Math.max(80, Math.round((BASE_D * uvRadius) / REF_UV_RADIUS));
    const R = D / 2;
    let iris;
    let irisHasAlpha = true;
    if (procedural && existsSync(iconPng)) {
      // centre-crop the icon (the eye fills most of the 256px icon frame) into the iris disc
      const im = sharp(iconPng);
      const m = await im.metadata();
      const crop = Math.round(Math.min(m.width, m.height) * 0.62);
      iris = await im
        .extract({
          left: Math.round((m.width - crop) / 2),
          top: Math.round((m.height - crop) / 2),
          width: crop,
          height: crop,
        })
        .resize(D, D)
        .ensureAlpha()
        .raw()
        .toBuffer();
      irisHasAlpha = false; // full-disc photo crop; the circular edge mask is the only cutout
    } else {
      const irisSrc = irisPng ?? join(DUMP, "Heads/Shared/Eyes/Textures/T_EyeIrisBaseColor_Gray_01_CA.png");
      iris = await sharp(irisSrc).resize(D, D).ensureAlpha().raw().toBuffer();
    }
    // NOTE: no mean-normalization of the base texture — the dark Gray base halving the tint is
    // exactly why natural colours (brown/blue) judge correct; saturated-tint failures (viking
    // crimson -> near-black) are handled by the icon-crop rule above instead.
    const norm = 1;
    const bright = Math.min(brightness, 1.8);
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < D; x++) {
        const sx = Math.round(S / 2 - R) + x;
        const sy = Math.round(S / 2 - R) + y;
        if (sx < 0 || sy < 0 || sx >= S || sy >= S) continue;
        const dist = Math.hypot(x - R, y - R);
        if (dist > R) continue;
        const edge = Math.min(1, Math.max(0, (R - dist) / 8));
        const ii = (y * D + x) * 4;
        const ta = (irisHasAlpha ? iris[ii + 3] / 255 : 1) * edge;
        if (ta <= 0) continue;
        const si = (sy * S + sx) * 3;
        for (let c = 0; c < 3; c++) {
          let v = iris[ii + c] * norm;
          if (!procedural && irisTint) v = (v * irisTint[c]) / 128; // tint around normalized mid-grey
          v = Math.min(255, v * bright);
          out[si + c] = Math.round(out[si + c] * (1 - ta) + v * ta);
        }
      }
    }

    await sharp(out, { raw: { width: S, height: S, channels: 3 } })
      .webp({ quality: 90 })
      .toFile(join(OUT_DIR, `${id}.webp`));
    meta[id] = {};
    if (brightness > 2) {
      meta[id].emissive = true;
      if (vec.IrisHueTint) meta[id].tint = "#" + vec.IrisHueTint.toLowerCase();
    }
    made++;
  }
  writeFileSync(META_OUT, JSON.stringify(meta, null, 1));
  console.log(`eye decals: ${made} written -> ${OUT_DIR}`);
  if (misses.length) console.log("  no MI (kept icon-tint fallback):", misses.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
