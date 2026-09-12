// Prepare the remaining eight source body paints, whose placement offsets, UV0 selection, colour
// multiply and tattoo branch the earlier converter (prepare-body-paints.mjs) refuses. Scoped to
// exactly these catalog IDs: the 22 earlier entries, their assets and their reports are untouched.
//
//   py scripts/shader-probe/evaluate-remaining-paints.py   # compiled-shader uniforms, run first
//   node scripts/shader-probe/prepare-paint-contracts.mjs [--dry-run] [--source=<Content root>]
//
// Every number a layer carries is the value of a uniform the compiled base pass reads, cross-checked
// against the MI's own parameters (paint-contract-core.mjs). Colour and packed data are byte copies
// of the source PNGs: under the nonmasked multiply the RGB beneath zero alpha is colour data, and
// lossless WebP as sharp encodes it clears those texels.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { baseFaceRules, paintContract, readMaterialInstance } from "./paint-contract-core.mjs";

const IDS = [
  "bodycosmetics-bodypaint-90sskateboarder-01",
  "bodycosmetics-bodypaint-armsblack-01",
  "bodycosmetics-bodypaint-bruises-02",
  "bodycosmetics-bodypaint-oilyhands-01",
  "bodycosmetics-bodypaint-runnyfingersblack-01",
  "bodycosmetics-bodypaint-runnyfingersgold-01",
  "bodycosmetics-bodypaint-sweat-01",
  "bodycosmetics-bodypaint-techwearsymbols-01",
];
const DEFAULT_CONTENT =
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content";
const OUT = "models/reconstructed-paint-contracts-v1";
const REPORT_DIR = "scripts/generated/shader-probe/paint-contracts-opus-v1";
const EVALUATION = `${REPORT_DIR}/shader/constants.json`;
const CATALOG = "src/data/items.json";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const contentRoot = (args.find((a) => a.startsWith("--source=")) ?? `--source=${DEFAULT_CONTENT}`).slice(9);

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function sourceFile(objectPath, suffix) {
  if (typeof objectPath !== "string" || !objectPath.startsWith("/Game/") || objectPath.includes(".."))
    throw new Error(`Unsupported source object path: ${objectPath}`);
  return path.join(contentRoot, objectPath.slice(6).split(".")[0] + suffix);
}

// FModel omits SRGB when it holds the engine default, true.
function textureFacts(objectPath) {
  const record = read(sourceFile(objectPath, ".json"))[0];
  return { srgb: record.Properties?.SRGB !== false, pixelFormat: record.PixelFormat, cookedSize: [record.SizeX, record.SizeY] };
}

// Coverage, and how much of the zero-alpha area carries non-white RGB for a nonmasked multiply to read.
async function colourStats(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`${path.basename(file)} has no alpha coverage`);
  let covered = 0, clear = 0, tinted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) covered++;
    else {
      clear++;
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) tinted++;
    }
  }
  const pixels = info.width * info.height;
  return { size: [info.width, info.height], coveredFraction: covered / pixels, zeroAlphaFraction: clear / pixels,
    zeroAlphaNonWhiteFraction: clear ? tinted / clear : 0 };
}

async function main() {
  const evaluation = read(EVALUATION);
  const catalogText = fs.readFileSync(CATALOG, "utf8");
  const catalog = JSON.parse(catalogText);
  // Rewriting a file in some other form would touch every item, not just the eight decal blocks.
  if (JSON.stringify(catalog, null, 2) + "\n" !== catalogText) throw new Error(`${CATALOG} is not in its canonical form`);
  const before = new Map(catalog.map((item) => [item.id, JSON.stringify(item)]));
  const report = {
    at: new Date().toISOString(), contentRoot, dryRun, evaluation: EVALUATION, evaluationSha256: sha256(EVALUATION),
    scope: "Medium body with Face 01 Base: source coordinates, bounds gate, colour multiply/override and body B/A surface. " +
      "Normals, head surface finish and animated effects remain pending.",
    items: [],
  };

  for (const id of IDS) {
    try {
      const definition = read(`public/models/reconstructed-assembly-v2/items/${id}.json`);
      if (definition.formatVersion !== 1 || definition.id !== id) throw new Error("invalid source item definition");
      const layers = [], evidence = [], copies = [];
      for (const rule of baseFaceRules(definition)) {
        const miFile = sourceFile(rule.materialPath, ".json");
        const evaluated = evaluation.find((e) => e.id === id && e.slot === rule.slot);
        if (!evaluated || evaluated.shaderParent !== rule.spec.shader)
          throw new Error(`${rule.slot}: not evaluated through ${rule.spec.shader}`);
        if (evaluated.sourceMiSha256 !== sha256(miFile)) throw new Error(`${rule.slot}: the evaluation read a different MI`);
        const contract = paintContract(readMaterialInstance(read(miFile)), rule.spec, evaluated);

        const colorFile = sourceFile(contract.colorTexture, ".png");
        const colorFacts = textureFacts(contract.colorTexture);
        if (!colorFacts.srgb) throw new Error(`${rule.slot}: the colour texture is not sRGB`);
        const colour = await colourStats(colorFile);
        const colorPath = `${OUT}/${id}-${rule.spec.part}_c.png`;
        copies.push([colorFile, colorPath]);

        let surface = null;
        if (contract.dataTexture) {
          const dataFile = sourceFile(contract.dataTexture, ".png");
          const dataFacts = textureFacts(contract.dataTexture);
          if (dataFacts.srgb) throw new Error(`${rule.slot}: the packed data texture is sRGB`);
          const meta = await sharp(dataFile).metadata();
          // Normalized sampling: native sizes may differ, the atlas aspect may not.
          if (meta.channels !== 4 || meta.width * colour.size[1] !== colour.size[0] * meta.height)
            throw new Error(`${rule.slot}: the packed RGBA texture has an unsupported atlas aspect`);
          surface = { path: `${OUT}/${id}-${rule.spec.part}_m.png`, source: dataFile, sha256: sha256(dataFile),
            size: [meta.width, meta.height], ...dataFacts,
            packedChannels: "B roughness, A metalness; RG normals deferred",
            formula: "roughness/metalness = clamp(mix(base, packed.b/packed.a, G*C.a), 0, 1)" };
          copies.push([dataFile, surface.path]);
        }

        const { layer } = contract;
        layers.push({ target: layer.target, colorPath, uv: layer.uv, uvScale: layer.uvScale,
          ...(layer.uvOffsetX !== undefined ? { uvOffsetX: layer.uvOffsetX } : {}),
          uvLayout: layer.uvLayout, colorOverride: layer.colorOverride, colorMultiply: layer.colorMultiply,
          ...(surface ? { surfacePath: surface.path, surfaceOverride: 1 } : {}) });
        evidence.push({ slot: rule.slot, matchingTags: rule.matchingTags, branch: contract.branch, shader: contract.shader,
          sourceMi: miFile, sourceMiSha256: evaluated.sourceMiSha256, assemblySha256: evaluated.assemblySha256,
          glsl: `${REPORT_DIR}/shader/${evaluated.glsl}`, registers: evaluated.registers, trace: contract.trace,
          stream: contract.stream,
          colour: { parameter: contract.colorParameter, source: colorFile, sha256: sha256(colorFile), path: colorPath,
            ...colorFacts, ...colour },
          surface, deferred: contract.deferred });
      }

      const item = catalog.find((i) => i.id === id);
      if (!item || item.slot !== "bodyPaint") throw new Error("not a bodyPaint catalog item");
      // Copy only once the whole item has passed, then prove every output is the source's bytes.
      if (!dryRun) {
        fs.mkdirSync(path.join("public", OUT), { recursive: true });
        for (const [source, output] of copies) {
          fs.copyFileSync(source, path.join("public", output));
          if (sha256(path.join("public", output)) !== sha256(source)) throw new Error(`${output} is not a byte copy`);
        }
      }
      const previousDecal = item.decal ?? null;
      item.decal = { layers };
      report.items.push({ id, status: "prepared", definitionSha256: definition.sourceSha256, layers, previousDecal, evidence });
    } catch (error) {
      report.items.push({ id, status: "unchanged", reason: String(error.message ?? error) });
    }
  }

  // Only the prepared decal blocks may differ; every other item and field must be exactly as it was.
  const prepared = new Set(report.items.filter((i) => i.status === "prepared").map((i) => i.id));
  for (const item of catalog) {
    const now = { ...item, decal: prepared.has(item.id) ? null : item.decal };
    const was = { ...JSON.parse(before.get(item.id)), decal: prepared.has(item.id) ? null : JSON.parse(before.get(item.id)).decal };
    if (JSON.stringify(now) !== JSON.stringify(was)) throw new Error(`${item.id} changed outside a prepared decal block`);
  }
  if (catalog.length !== before.size) throw new Error("the catalog item count changed");

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  if (!dryRun) fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
  fs.writeFileSync(`${REPORT_DIR}/${dryRun ? "prepare-report.dry-run.json" : "prepare-report.json"}`,
    JSON.stringify(report, null, 2) + "\n");
  for (const item of report.items) {
    if (item.status !== "prepared") { console.log(`UNCHANGED ${item.id}: ${item.reason}`); continue; }
    for (const l of item.layers)
      console.log(`${item.id} ${l.target}: uv${l.uv} x${l.uvScale[0]}${l.uvOffsetX ? ` ${l.uvOffsetX > 0 ? "+" : ""}${l.uvOffsetX}` : ""} ` +
        `override=${l.colorOverride} multiply=${l.colorMultiply}${l.surfacePath ? " +B/A" : ""}`);
  }
  console.log(`Prepared ${prepared.size}/${IDS.length}${dryRun ? " (dry run: no assets or catalog written)" : ""}.`);
}

await main();
