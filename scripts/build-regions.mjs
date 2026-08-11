// build-regions.mjs — derive the per-piece "part map" used to color cosmetics objectively.
//
// The game splits a garment into parts via the MaterialID channel (blue of the
// OcclusionCurvatureMaterialID texture). Per converted piece this clusters that channel
// into K parts and writes:
//   - public/models/<piece>.regionmap.png : a grayscale part-index map (sampled at runtime)
//   - public/models/<piece>.regions.json  : { count, bodyIndex, blues, meanLuma }
//       bodyIndex = largest part; blues[r] = representative MaterialID value per region, so
//       import-catalog can map a region -> the skin's material layer -> its real color;
//       meanLuma[r] = mean LINEAR luminance of the baked albedo (BaseColor × OCM occlusion,
//       the same signal the runtime shader samples) per region — the normalizer that lets the
//       shader land each region's average on the authored color.
//
// import-catalog then colors the body part with the skin's primary color and every other
// part with its dark accent — both read from the thumbnail (objective, no per-skin tuning).
// Run: npm run build:regions  (runs automatically after npm run convert:meshes)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MODELS = resolve(ROOT, "public", "models");
const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

function firstGlob(dir, pats) {
  let names;
  try { names = readdirSync(dir); } catch { return null; }
  for (const pat of pats) {
    const re = new RegExp("^" + pat.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$", "i");
    const hit = names.find((n) => re.test(n));
    if (hit) return join(dir, hit);
  }
  return null;
}

// Cluster the MaterialID (blue) channel into distinct part values: peaks covering >1.5% of
// texels, merging values within 12.
function clusterValues(blues) {
  const hist = new Array(256).fill(0);
  for (const v of blues) hist[v]++;
  const total = blues.length;
  const merged = [];
  for (let v = 0; v < 256; v++) {
    if (hist[v] / total <= 0.015) continue;
    const near = merged.find((m) => Math.abs(m.v - v) < 12);
    if (near) { if (hist[v] > hist[near.v]) near.v = v; } else merged.push({ v });
  }
  return merged.map((m) => m.v).sort((a, b) => a - b);
}

// sRGB byte -> linear [0,1]
function srgbToLinear(b) {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

async function buildPiece(asset) {
  const dst = resolve(MODELS, asset.dst);
  if (!existsSync(dst)) return null;
  if (existsSync(dst.replace(/\.glb$/, ".regionmap.png")) && process.env.REGIONS_FORCE !== "1") return null;
  const srcDir = dirname(resolve(DUMP, asset.src));
  const ocmPath =
    (asset.textures && asset.textures.occlusion && resolve(DUMP, asset.textures.occlusion)) ||
    firstGlob(srcDir, ["*_OcclusionCurvatureMaterialID.png", "*_ORM.png"]);
  if (!ocmPath || !existsSync(ocmPath)) return null;

  const RES = 512;
  // NEAREST: the blue channel is categorical (layer slots) — interpolating kernels blend
  // neighboring region IDs into bogus intermediate values, mis-assigning thin regions
  // (e.g. quilted vests) to the wrong material layer.
  const { data, info } = await sharp(ocmPath)
    .resize(RES, RES, { kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const blues = [];
  for (let i = 0; i < data.length; i += ch) blues.push(data[i + 2]);
  const parts = clusterValues(blues);
  const K = Math.max(1, parts.length);
  const nearestIdx = (b) => {
    let bi = 0, bd = 1e9;
    for (let k = 0; k < K; k++) { const d = Math.abs(parts[k] - b); if (d < bd) { bd = d; bi = k; } }
    return bi;
  };

  // The baked GLB albedo is BaseColor × OCM occlusion (convert-meshes bakes the AO in).
  // Reproduce that signal here to get each region's mean linear luminance.
  const basePath =
    (asset.textures && asset.textures.basecolor && resolve(DUMP, asset.textures.basecolor)) ||
    firstGlob(srcDir, ["*_BaseColor.png", "*_Albedo.png", "*_Diffuse.png"]);
  let baseData = null;
  let baseCh = 0;
  if (basePath && existsSync(basePath)) {
    const r = await sharp(basePath).resize(RES, RES).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    baseData = r.data;
    baseCh = r.info.channels;
  }

  const idxMap = Buffer.alloc(RES * RES);
  const area = new Array(K).fill(0);
  const lumaSum = new Array(K).fill(0);
  for (let p = 0; p < RES * RES; p++) {
    const idx = nearestIdx(data[p * ch + 2]);
    area[idx]++;
    idxMap[p] = K > 1 ? Math.round((idx / (K - 1)) * 255) : 0;
    if (baseData) {
      const occ = data[p * ch] / 255; // OCM red = occlusion (multiplied into the baked albedo)
      const luma =
        0.299 * srgbToLinear(baseData[p * baseCh]) +
        0.587 * srgbToLinear(baseData[p * baseCh + 1]) +
        0.114 * srgbToLinear(baseData[p * baseCh + 2]);
      lumaSum[idx] += luma * occ;
    } else {
      // No BaseColor shipped: the converter bakes the OCM occlusion itself as the
      // greyscale albedo, so the normalizer is the mean linear occlusion.
      lumaSum[idx] += data[p * ch] / 255;
    }
  }
  await sharp(idxMap, { raw: { width: RES, height: RES, channels: 1 } })
    .png()
    .toFile(dst.replace(/\.glb$/, ".regionmap.png"));
  const bodyIndex = area.indexOf(Math.max(...area));
  // meanLuma always exists now: BaseColor×occ when the piece ships an albedo, plain
  // occlusion when it doesn't (matching what the converter bakes in each case).
  const meanLuma = area.map((a, k) => (a ? Number((lumaSum[k] / a).toFixed(5)) : 0));
  // `parts` are the clustered MaterialID (blue) values in region-index order — emit them so
  // import-catalog can decode each region to its 1..N material layer (layer ≈ blue/255*N).
  writeFileSync(
    dst.replace(/\.glb$/, ".regions.json"),
    JSON.stringify({ count: K, bodyIndex, blues: parts, ...(meanLuma ? { meanLuma } : {}) }) + "\n",
  );
  return { dst: asset.dst, K, bodyIndex };
}

async function main() {
  const gen = join(SCRIPT_DIR, "asset-sources.generated.json");
  const file = existsSync(gen) ? gen : join(SCRIPT_DIR, "asset-sources.json");
  const assets = JSON.parse(readFileSync(file, "utf8")).assets ?? [];
  let ok = 0;
  for (const asset of assets) {
    if (!/^cosmetics\//.test(asset.dst)) continue; // heads/hair have no MaterialID dye
    try {
      const r = await buildPiece(asset);
      if (r) { ok++; console.log(`  ${r.dst}  ${r.K} parts (body #${r.bodyIndex})`); }
    } catch (e) {
      console.warn(`  FAILED ${asset.dst}: ${e?.message ?? e}`);
    }
  }
  console.log(`\nbuilt region maps for ${ok} pieces.`);
}

main();
