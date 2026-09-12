// Prepare the two activated source body paints (BodyTight_01, Goblin_01) for the renderer.
//
// The catalog used to describe a body paint as a THUMBNAIL TINT plus the `_M` texture read as a
// greyscale coverage mask. That is the wrong pair of inputs twice over: the real coverage lives in
// the ALPHA of the paint's `_C` (BodyPaintColor) texture, and `_M` (BodyPaintData) is packed data
// whose channels carry normal and surface data. Running the importer's Sharp resize/removeAlpha/greyscale
// pipeline on `_M` reproduced both shipped masks byte-for-byte and both are effectively black, which
// is why the two paints equipped with zero pixel difference.
//
// This converter reads the source MI parameters and emits the `_C` texture unchanged in size and
// unpremultiplied, so the renderer gets the authored colour AND the authored coverage. It then
// patches ONLY the two items' `decal` metadata in src/data/items.json. The two body/hands
// layers also retain the native packed PNG for roughness (B) and metalness (A). Lossless WebP
// discards RGB where alpha=0, which destroys roughness on these mostly nonmetallic paints.
//
//   node scripts/shader-probe/prepare-body-paints.mjs [--dry-run] [--siblings] [--source=<export root>]
// --siblings discovers exact material/texture references from decoded item definitions, keeping
// only the already traced layout. Unsupported items stay unchanged with an explicit reason.
//
// Facts asserted (not guessed) from the MI JSON, so a sibling with different values fails loudly
// instead of rendering something plausible: BodyPaintUV, BodyPaintTiles, BodyPaintPlacement,
// BodyColorOverride, and the TextureStreamingData UVChannelIndex/SamplingScale that must agree.
//
// The coordinate transform itself is NOT inferred from those parameters — an earlier pass read the
// single SamplingScale as a uniform half scale and placed the coverage wrongly. It comes from the
// compiled M_Skin base pass (see FORMULA below and Astra's inspect-body-paint-shader.py).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const DEFAULT_SOURCE =
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters/BodyCosmetics/BodyPaint";
const OUT_DIR = "public/models/reconstructed-body-paints-v1";
const REPORT_DIR = process.argv.includes("--siblings")
  ? "scripts/generated/shader-probe/body-paint-siblings-v1"
  : "scripts/generated/shader-probe/body-paints-surface-v1";
const CATALOG = "src/data/items.json";
// The coordinate contract this preparer encodes, recorded in every report so a stale catalog entry
// is identifiable. Read out of the compiled M_Skin base pass, nodes 70-92.
const FORMULA = "paintUv = vec2(uv.x / BodyPaintTiles, fract(uv.y)); " +
  "coverage = ceil(clamp(x*(1-x),0,1) * clamp(y*(1-y),0,1)) * BodyPaintColor.a";

// Which MI suffix drives which decal target, and where that part's paint coordinates were read from.
// BodyTight also ships a Head MI (its DA activates it on the head's `shader_head_shader` slot);
// Goblin is body only. `parent` is asserted so a sibling parented to some other material fails
// loudly instead of inheriting a contract nobody traced for it.
const PARTS = {
  BodyHands: {
    target: "body", parent: "Material'M_Skin'", uv: 1, tiles: 2,
    traced: "compiled M_Skin base pass, nodes 70-92 (asm:138-158): paintUv = vec2(uv1.x / BodyPaintTiles, fract(uv1.y))",
  },
  Head: {
    target: "head", parent: "MaterialInstanceConstant'MI_Head_HeadMaster_Base_Head'", uv: 0, tiles: 1,
    traced: "compiled M_Face base pass, nodes 62-77 (asm:143-150): paintUv = vec2(uv0.x, fract(uv0.y))",
  },
};
const STYLES = [
  { id: "bodycosmetics-bodypaint-bodytight-01", style: "BodyTight_01" },
  { id: "bodycosmetics-bodypaint-goblin-01", style: "Goblin_01" },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const siblings = args.includes("--siblings");
const sourceRoot = (args.find((a) => a.startsWith("--source=")) ?? `--source=${DEFAULT_SOURCE}`).slice(9);
const contentRoot = path.resolve(sourceRoot, "../../../..");

function sourceFile(objectPath) {
  if (typeof objectPath !== "string" || !objectPath.startsWith("/Game/") || objectPath.includes(".."))
    throw new Error(`Unsupported source object path: ${objectPath}`);
  return path.join(contentRoot, objectPath.slice(6).split(".")[0]);
}

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// FModel writes parameters as arrays of { ParameterInfo: { Name }, ParameterValue }.
const byName = (list, key = "ParameterValue") =>
  Object.fromEntries((list ?? []).map((p) => [p.ParameterInfo.Name, p[key]]));

function readMaterialInstance(file) {
  const props = JSON.parse(fs.readFileSync(file, "utf8"))[0].Properties;
  const scalars = byName(props.ScalarParameterValues);
  const vectors = byName(props.VectorParameterValues);
  const textures = Object.fromEntries(
    (props.TextureParameterValues ?? []).map((p) => [p.ParameterInfo.Name, p.ParameterValue.ObjectName.replace(/^Texture2D'|'$/g, "")]),
  );
  const texturePaths = Object.fromEntries((props.TextureParameterValues ?? []).map(p =>
    [p.ParameterInfo.Name, p.ParameterValue.ObjectPath]));
  return { parent: props.Parent?.ObjectName, scalars, vectors, textures, texturePaths,
    switches: props.StaticParametersRuntime, streaming: props.TextureStreamingData ?? [] };
}

// Check the MI against the parameter combinations traced through the compiled skin/face shader.
// Different combinations need their own source trace before this preparer can activate them.
function paintTransform(mi, part, spec) {
  if ((mi.scalars.BodyColorMultiplyNonMasked ?? 0) !== 0)
    throw new Error(`${part}: BodyColorMultiplyNonMasked needs its own source colour blend`);
  if (mi.switches && Object.values(mi.switches).some(values => Array.isArray(values) && values.some(v => v.bOverride)))
    throw new Error(`${part}: a static material permutation needs its own source trace`);
  const dataTexture = mi.textures.BodyPaintData;
  if (!dataTexture || !mi.textures.BodyPaintColor) throw new Error(`${part}: MI does not bind BodyPaintColor/BodyPaintData`);
  const stream = mi.streaming.find((s) => dataTexture.endsWith(s.TextureName));
  if (!stream) throw new Error(`${part}: no TextureStreamingData for ${dataTexture}`);

  // BodyPaintUV selects the mesh UV channel; the streaming metadata records the same choice and is
  // used as an independent cross-check. Absent (Head MI) means the parent default, channel 0.
  const uv = mi.scalars.BodyPaintUV ?? 0;
  if (uv !== 0 && uv !== 1) throw new Error(`${part}: unsupported BodyPaintUV ${uv}`);
  if (stream.UVChannelIndex !== uv) throw new Error(`${part}: BodyPaintUV ${uv} disagrees with streaming channel ${stream.UVChannelIndex}`);

  // BodyPaintTiles divides the HORIZONTAL axis only. The compiled M_Skin base pass folds V with
  // fract() instead (`frc`, asm:146) — see the uvLayout note below. TextureStreamingData carries a
  // single SamplingScale, which agrees with the horizontal divisor but says nothing about the
  // vertical axis; reading it as a uniform scale is what produced the wrong half-height atlas.
  const tiles = mi.scalars.BodyPaintTiles ?? 1;
  if (!(tiles > 0)) throw new Error(`${part}: unsupported BodyPaintTiles ${tiles}`);
  if (Math.abs(stream.SamplingScale - 1 / tiles) > 1e-4)
    throw new Error(`${part}: BodyPaintTiles ${tiles} disagrees with the horizontal SamplingScale ${stream.SamplingScale}`);
  if (uv !== spec.uv || tiles !== spec.tiles)
    throw new Error(`${part}: UV ${uv}, tiles ${tiles} differ from the traced UV ${spec.uv}, tiles ${spec.tiles}`);

  // Only the identity placement vector used by these paints has been traced. Reject a different
  // vector rather than extrapolating the meaning of its components from this one combination.
  const p = mi.vectors.BodyPaintPlacement;
  const placement = p ? [p.R, p.G, p.B, p.A] : [0, 0, 1, 0];
  if (placement[0] !== 0 || placement[1] !== 0 || placement[2] !== 1 || placement[3] !== 0)
    throw new Error(`${part}: non-identity BodyPaintPlacement ${placement.join(",")} is not reconstructed`);

  // BodyColorOverride is a dynamic-branch weight in the parent M_Skin. Both activated paints use 1
  // (take the branch). What an intermediate weight blends is not recovered, so refuse it rather
  // than treat it as an opacity.
  const colorOverride = mi.scalars.BodyColorOverride ?? 0;
  if (colorOverride !== 0 && colorOverride !== 1) throw new Error(`${part}: partial BodyColorOverride ${colorOverride} is not reconstructed`);
  const surfaceOverride = mi.scalars.BodySurfaceOverride ?? 0;
  if (spec.target === "body" && surfaceOverride !== 1)
    throw new Error(`${part}: BodySurfaceOverride ${surfaceOverride} differs from the traced body/hands value 1`);
  // Both parts have been traced to a compiled base pass — M_Skin for the body/hands, M_Face for the
  // head — and both emit the same shape: the horizontal axis scaled by 1/BodyPaintTiles (the head
  // inherits tiles=1, so `uv0.x` is used directly), the vertical axis folded with fract(), and the
  // same unit-square gate on coverage. Anything parented elsewhere is refused rather than assumed
  // to share it.
  if (mi.parent !== spec.parent) throw new Error(`${part}: parent ${mi.parent} is not the traced ${spec.parent}`);
  return {
    uv,
    tiles,
    placement,
    uvScale: [1 / tiles, 1],
    uvLayout: "sourceBodyPaint",
    source: `${spec.traced}; coverage = ceil(clamp(x*(1-x),0,1) * clamp(y*(1-y),0,1)) * BodyPaintColor.a`,
    colorOverride,
    ...(spec.target === "body" ? { surfaceOverride } : {}),
    // The body/hands B/A surface blend is active. RG normals and the head's separate surface
    // composition are still deferred; the same channel labels do not establish the same blend.
    deferred: { BodyNormalOverride: mi.scalars.BodyNormalOverride ?? 0,
      ...(spec.target === "head" ? { BodySurfaceOverride: surfaceOverride } : {}),
      dataTexture, packedChannels: "RG normal, B roughness, A metalness" },
  };
}

// The paint coordinate transform is no longer fitted here. It is read out of the compiled M_Skin
// base pass by Astra's scripts/shader-probe/inspect-body-paint-shader.py; paintTransform() above
// encodes that contract. The earlier candidate search (island IoU and mean per-edge artwork
// discontinuity) is kept only as history in prepare-report.half-v-superseded.json and the
// *-fit-*.png overlays: it ranked whole mappings in aggregate and picked a uniform half scale,
// which put the coverage in the wrong place on the body.

async function main() {
  const report = { at: new Date().toISOString(), source: sourceRoot, formula: FORMULA, dryRun, siblings,
    scope: "Medium base face; source colour/coverage and body B/A surface. Normals, head surface and conditional effects remain pending.",
    styles: [], items: [] };
  if (!dryRun) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));

  const candidates = siblings ? catalog.filter(i => i.slot === "bodyPaint").map(i => ({ id: i.id, style: i.id })) : STYLES;
  for (const { id, style } of candidates) {
    const dir = path.join(sourceRoot, style);
    const entry = { id, style, layers: [], deferred: [] };
    let sourceMaterials = null;
    let definition = null;
    const itemReports = [];
    try {
      if (siblings) {
        const file = `public/models/reconstructed-assembly-v2/items/${id}.json`;
        definition = JSON.parse(fs.readFileSync(file, "utf8"));
        if (definition.formatVersion !== 1 || definition.id !== id) throw new Error("Invalid source item definition");
        sourceMaterials = {};
        for (const rule of definition.properties.ActivatesMaterialParameters ?? []) {
          // The base Medium face has only this generic Head tag. Anime and other replacement
          // branches stay recorded as deferred rather than selecting an arbitrary MI by filename.
          if (rule.Behavior !== "ECustomizationMaterialBehavior::OverrideParameters"
            || rule.MatchingTags?.length !== 1 || rule.MatchingTags[0] !== "Customization.Slot.Head") {
            entry.deferred.push({ reason: "conditional material rule", rule });
            continue;
          }
          for (const slot of rule.SlotNames ?? []) {
            const part = slot === "BaseBody" ? "BodyHands" : slot === "shader_head_shader" ? "Head" : null;
            if (!part) { entry.deferred.push({ reason: "additional material slot", slot }); continue; }
            if (sourceMaterials[part]) throw new Error(`Multiple active material rules for ${part}`);
            sourceMaterials[part] = sourceFile(rule.MaterialInstance.AssetPathName) + ".json";
          }
        }
        if (!sourceMaterials.BodyHands) throw new Error("No supported base-body paint material rule");
      }
      for (const [part, spec] of Object.entries(PARTS)) {
        const { target } = spec;
        const miFile = sourceMaterials ? sourceMaterials[part] : path.join(dir, `MI_BodyCosmetics_BodyPaint_${style}_${part}.json`);
        if (!miFile || (!sourceMaterials && !fs.existsSync(miFile))) continue;
        const mi = readMaterialInstance(miFile);
        const transform = paintTransform(mi, `${style}/${part}`, spec);
        const colorFile = sourceFile(mi.texturePaths.BodyPaintColor) + ".png";
        if (!fs.existsSync(colorFile)) throw new Error(`${style}/${part}: missing source colour texture`);

        const meta = await sharp(colorFile).metadata();
        if (meta.channels !== 4) throw new Error(`${style}/${part}: BodyPaintColor has no alpha coverage`);
        const relative = `models/reconstructed-body-paints-v1/${id}-${part.toLowerCase()}_c.webp`;
        if (!dryRun)
          // Native size, lossless, alpha untouched: coverage is data, not a picture to compress.
          await sharp(colorFile).webp({ lossless: true, alphaQuality: 100, effort: 6 }).toFile(path.join("public", relative));

        let surface = null;
        if (target === "body") {
          const dataFile = sourceFile(mi.texturePaths.BodyPaintData) + ".png";
          if (!fs.existsSync(dataFile)) throw new Error(`${style}/${part}: missing packed source texture`);
          const dataMeta = await sharp(dataFile).metadata();
          // These source samples use normalized coordinates. Several MIs bind a low-resolution
          // colour (including a constant 4x2 atlas) and a detailed data atlas at the same aspect.
          // Matching pixel dimensions is not part of the shader contract; keep both native sizes.
          if (dataMeta.channels !== 4 || dataMeta.width * meta.height !== meta.width * dataMeta.height)
            throw new Error(`${style}/${part}: packed RGBA texture has an unsupported atlas aspect`);
          const surfacePath = `models/reconstructed-body-paints-v1/${id}-${part.toLowerCase()}_m.png`;
          // Copy bytes, without resizing, colour conversion or alpha processing. Astra's real WebGL
          // probe confirms PNG preserves B even when A=0; Sharp's lossless WebP path does not.
          if (!dryRun) fs.copyFileSync(dataFile, path.join("public", surfacePath));
          surface = { surfacePath, surfaceOverride: transform.surfaceOverride,
            sourceData: dataFile, sourceDataSha256: sha256(dataFile),
            dataSize: [dataMeta.width, dataMeta.height],
            packedChannels: "B roughness, A metalness; RG normals deferred",
            formula: "roughness/metalness = clamp(mix(base, packed.b/packed.a, colourCoverage), 0, 1)" };
        }

        // uvScale is always written, including the identity: its presence is what tells the renderer
        // this layer's `uv` channel is a recovered source fact rather than an unhonoured leftover.
        entry.layers.push({ target, colorPath: relative, uv: transform.uv, uvScale: transform.uvScale,
          ...(transform.uvLayout ? { uvLayout: transform.uvLayout } : {}), colorOverride: transform.colorOverride,
          ...(surface ? { surfacePath: surface.surfacePath, surfaceOverride: surface.surfaceOverride } : {}) });
        entry.deferred.push({ part, ...transform.deferred });
        itemReports.push({
          id, style, part, target, parent: mi.parent,
          sourceMi: miFile, sourceMiSha256: sha256(miFile),
          sourceColor: colorFile, sourceColorSha256: sha256(colorFile),
          colorSize: [meta.width, meta.height],
          output: dryRun ? null : { path: relative, bytes: fs.statSync(path.join("public", relative)).size },
          transform,
          surface,
        });
      }
      if (!entry.layers.length) throw new Error(`${style}: no material instances found under ${dir}`);

      const item = catalog.find((i) => i.id === id);
      if (!item) throw new Error(`${id} is not in the catalog`);
      // ONLY the decal block changes; every other catalog field (including the dirty slot repairs)
      // is left exactly as-is.
      item.decal = { layers: entry.layers };
      report.styles.push(...itemReports);
      report.items.push({ id, status: "prepared", definitionSha256: definition?.sourceSha256,
        layers: entry.layers, deferred: entry.deferred });
    } catch (error) {
      if (!siblings) throw error;
      report.items.push({ id, status: "unchanged", reason: String(error.message ?? error) });
    }
  }

  if (!dryRun) fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
  fs.writeFileSync(path.join(REPORT_DIR, "prepare-report.json"), JSON.stringify(report, null, 2) + "\n");
  for (const s of report.styles)
    console.log(`${s.id} ${s.part}: uv${s.transform.uv} x${s.transform.uvScale[0]} ` +
      `${s.transform.uvLayout ?? "(plain scale)"} colorOverride=${s.transform.colorOverride} -> ${s.output?.path ?? "(dry run)"}`);
  if (siblings) {
    console.log(`Prepared ${report.items.filter(i => i.status === "prepared").length}/${candidates.length} paint definitions.`);
    for (const i of report.items.filter(i => i.status === "unchanged")) console.log(`UNCHANGED ${i.id}: ${i.reason}`);
  }
}

await main();
