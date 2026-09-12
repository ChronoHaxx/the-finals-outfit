import { z } from "zod";
import { SLOTS } from "./slots";

export const RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Mythic",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const SOURCES = [
  "BattlePass",
  "Store",
  "Event",
  "Career",
  "Contract",
  "Sponsor",
  "Other",
] as const;
export type Source = (typeof SOURCES)[number];

const SeasonSchema = z.union([
  z.number().int().min(1).max(50),
  z.literal("beta"),
  z.literal("launch"),
]);
export type Season = z.infer<typeof SeasonSchema>;

export const ItemIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, {
  message: "id must be 2-48 chars, lowercase a-z, 0-9 and '-' only",
});

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  message: "color must be a #RRGGBB hex string",
});

// Reconstruction of the game's layered-dye look (see [[material-dye-system]]). The game
// splits a garment into parts via a MaterialID channel; the converter clusters that into a
// per-piece region map. The real per-part colors live in each skin's MaterialInstance as
// per-layer `N_BaseColorOverlay` vectors: import-catalog decodes each region's MaterialID to
// its 1..N layer and reads that layer's color (the UI thumbnail is only a last-resort
// fallback). The runtime recolors each part onto the baked base's luminance.
//
// This is also the seam the future dye UI (OutfitSchema.dyes) plugs into — a user dye just
// overrides regionColors[bodyIndex] at runtime without touching the catalog.
export const MaterialSchema = z.object({
  // Per-piece part-index map, base-relative under public/models/ (sibling of the GLB,
  // emitted by scripts/build-regions.mjs). Shared across every skin of a piece.
  regionMapPath: z
    .string()
    .regex(/^[\w./-]+\.png$/, {
      message: "regionMapPath must be a base-relative .png path (no leading slash)",
    })
    .optional(),
  // Per-skin color for each part, indexed by the region map's part index.
  regionColors: z.array(HexColorSchema).min(1).max(16).optional(),
  // Optional per-part PBR (derived from each material layer's BaseRoughness/BaseMetallicity
  // gated by ShadeAsCloth — UE's Metallicity on a cloth layer is a layered-shader input, NOT
  // glTF metalness), same index order as regionColors.
  regionRoughness: z.array(z.number().min(0).max(1)).min(1).max(16).optional(),
  regionMetalness: z.array(z.number().min(0).max(1)).min(1).max(16).optional(),
  // Per-part cloth-ness (the layer's ShadeAsCloth): drives the runtime sheen lobe so fabric
  // gets a soft fresnel instead of a hard specular.
  regionSheen: z.array(z.number().min(0).max(1)).min(1).max(16).optional(),
  // Per-part mean baked-albedo luminance (linear, from build-regions.mjs): the shader divides
  // the baked base's luma by this so the authored region color lands at the right value on
  // average (the neutral base is dark — without the normalizer recolored cloth goes black).
  regionMeanLuma: z.array(z.number().min(0).max(1)).min(1).max(16).optional(),
  // Raw authored BaseColorOverlay colors before any display blend op — kept so color-model
  // re-calibration can re-fit without re-reading the dump.
  regionOverlays: z.array(HexColorSchema).min(1).max(16).optional(),
  // Garment print decals (graphic-tee prints, logos): the skin's MI references shared
  // T_Decal_* textures per layer (N_DecalColor) placed on the garment UV by
  // N_DecalPlacement [offsetU, offsetV, scale, rotation]. region -1 = not gated to a
  // region (the decal's layer had no MaterialID cluster of its own).
  garmentDecals: z
    .array(
      z.object({
        region: z.number().int().min(-1).max(15),
        path: z.string().regex(/^[\w./-]+\.webp$/, {
          message: "decal path must be a base-relative .webp path",
        }),
        place: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        // The decal `_M` texture is a 2-tone luminance MASK; its real colours come from the
        // layer's scheme (light end = colorA, dark end = colorB). Only emitted when the scheme
        // is chromatic (e.g. the AlfaActa chevron's red colorB) — plain black/white decals omit
        // these and render their texture as-is. Runtime: mix(colorB, colorA, luminance).
        colorA: HexColorSchema.optional(),
        colorB: HexColorSchema.optional(),
      }),
    )
    .min(1)
    .max(8)
    .optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  // Layered-composite baked texture set (scripts/bake-composite.mjs): a per-skin finished
  // albedo/normal/orm reconstructed from the game's layered material (color + tiled detail +
  // pattern + AO baked in). When present the runtime swaps these onto the mesh and SKIPS the
  // region-tint approximation — color is correct by construction. Base-relative under
  // public/models/ (modelUrl seam); orm packs R=AO, G=roughness, B=metalness (glTF convention).
  bakedSet: z
    .object({
      albedo: z.string().regex(/^[\w./-]+\.webp$/),
      normal: z.string().regex(/^[\w./-]+\.webp$/),
      orm: z.string().regex(/^[\w./-]+\.webp$/),
    })
    .optional(),
  // Self-illuminated mesh cosmetics (pumpkin glow, blankface LED, gas-mask lenses): the dump's
  // T_<piece>_Emissive map copied to a base-relative .webp. The rig assigns it as emissiveMap
  // (emissive colour = white, intensity below) at runtime — the convert-time Blender emissive
  // bake is "best-effort" and unreliable (stale/silent-fail), so the rig owns it deterministically.
  emissiveMap: z
    .string()
    .regex(/^[\w./-]+\.webp$/, { message: "emissiveMap must be a base-relative .webp path" })
    .optional(),
  emissiveIntensity: z.number().min(0).max(8).optional(),
});
export type Material = z.infer<typeof MaterialSchema>;

// A cosmetic can contain different source shaders (for example a layered helmet shell
// and an LED visor). Bind by the exported material name, never by the whole mesh.
export const MaterialBindingSchema = MaterialSchema.extend({
  family: z.enum(["layered", "attachment", "glass", "led", "unknown"]),
  doubleSided: z.boolean().optional(),
  glass: z.object({
    color: HexColorSchema,
    opacity: z.number().min(0).max(1),
    roughness: z.number().min(0).max(1),
    normal: z.string().regex(/^[\w./-]+\.webp$/).optional(),
  }).optional(),
  ledScreen: z.object({
    animation: z.string().regex(/^[\w./-]+\.webp$/),
    colorRamp: z.string().regex(/^[\w./-]+\.webp$/).optional(),
    normal: z.string().regex(/^[\w./-]+\.webp$/).optional(),
    tint: HexColorSchema.optional(),
    brightness: z.number().min(0).max(10000),
    frameCount: z.number().int().min(1).max(4096),
    trackCount: z.number().int().min(1).max(4096),
    pixelWidth: z.number().positive().max(4096).optional(),
    pixelHeight: z.number().positive().max(4096).optional(),
    animationTrack: z.number().int().min(0),
    animationSpeed: z.number().min(0),
    uvScale: z.number().positive(),
    uvOffsetU: z.number().optional(),
    uvOffsetV: z.number(),
    captureTime: z.number().min(0).optional(),
  }).optional(),
});
export type MaterialBinding = z.infer<typeof MaterialBindingSchema>;

// 3D preview data. Optional: most catalog items are icon-only until their mesh
// is converted from the datamined .uemodel source (see scripts/convert-meshes.py).
// gltfPath is base-relative under public/models/ (no leading slash) so it resolves
// under the GH Pages subpath via import.meta.env.BASE_URL.
export const ModelSchema = z.object({
  gltfPath: z.string().regex(/^[\w./-]+\.glb$/, {
    message: "gltfPath must be a base-relative .glb path (no leading slash)",
  }),
  // Slots whose body/other meshes this piece should hide. Consumed by the
  // mesh-hiding/clipping rules (deferred — see CharacterRig TODO).
  hides: z.array(z.enum(SLOTS)).optional(),
  // Heads only: the matching body-skin params from the head's sibling MI_Body_*.json —
  // the game swaps the body color texture per face (Dark/Light/FemaleMedium) and
  // multiplies it so the body tone matches the head.
  bodySkin: z
    .object({
      colorMultiply: z.tuple([z.number(), z.number(), z.number()]),
      roughness: z.number().min(0).max(1).optional(),
      // base-relative path of the body color-map variant (under public/models/body/)
      texPath: z
        .string()
        .regex(/^[\w./-]+\.webp$/)
        .optional(),
    })
    .optional(),
  // Per-skin material/dye data (region-tint approximation). Absent for items whose
  // mesh has no ColorMask (heads, hair) — those render with their baked materials.
  material: MaterialSchema.optional(),
  materialBindings: z.record(z.string().min(1), MaterialBindingSchema).optional(),
  // Outerwear only: a colour-coordinated default undersuit (a catalog item id). Open/vented
  // coats are designed to layer over an undersuit (their back is genuinely open mesh); when no
  // Upper Body is equipped we show this colour-matched top so the opening reads as intentional
  // tonal layering instead of a stark hole. Chosen at import time by nearest coat colour.
  underLayer: ItemIdSchema.optional(),
  // Outerwear only: when no catalog top is a close colour match (e.g. maroon satin, green camo),
  // `underLayer` points at a plain decal-free top and this is the coat's own mean colour — the
  // runtime recolours that top to this hue so the open back always blends, independent of which
  // solid tops the catalog happens to contain.
  underLayerTint: HexColorSchema.optional(),
  // Outerwear only: the REAL under-garment mesh the game layers under this coat (recovered from
  // the customization DataAsset, e.g. the LongCoat's velvet LawyerSuitJacket). When present the
  // rig composites this actual mesh (with its own baked look) instead of recolouring the generic
  // `underLayer` top — far more faithful. Base-relative .glb under public/models/. Many under-
  // meshes don't resolve to a converted glb; those fall back to the `underLayer`/`underLayerTint`.
  underLayerUrl: z
    .string()
    .regex(/^(?!\/)[\w./-]+\.glb$/, { message: "underLayerUrl must be a base-relative .glb path (no leading slash)" })
    .optional(),
});
export type Model = z.infer<typeof ModelSchema>;

// 2D body cosmetics (tattoos, makeup/blush, body paint, eye/iris color, nail polish) — real
// UV-mapped textures/params that composite onto the PERSISTENT body & head mesh rather than
// being their own mesh. Each layer routes to a target material (body/head/eyes/nails) and is
// either a color texture (colorPath, alpha = coverage), a mask+tint, or a flat tint. Paths are
// base-relative under public/models/ (modelUrl seam). See src/rig/BodyDecals.ts.
const DECAL_TARGETS = ["body", "head", "eyes", "nails"] as const;
const DecalLayerSchema = z.object({
  target: z.enum(DECAL_TARGETS),
  // A source paint whose colour multiply reads RGB beneath zero alpha keeps its native PNG: lossless
  // WebP as encoded here clears those texels.
  colorPath: z
    .string()
    .regex(/^[\w./-]+\.(webp|png)$/, { message: "colorPath must be a base-relative .webp or .png path" })
    .optional(),
  maskPath: z
    .string()
    .regex(/^[\w./-]+\.webp$/, { message: "maskPath must be a base-relative .webp path" })
    .optional(),
  // Packed body-paint data retains PNG: RGB beneath zero metallic alpha must survive decoding.
  surfacePath: z.string().regex(/^[\w./-]+\.png$/, {
    message: "surfacePath must be a base-relative .png path",
  }).optional(),
  surfaceOverride: z.union([z.literal(0), z.literal(1)]).optional(),
  uv: z.union([z.literal(0), z.literal(1)]).optional(), // body UV channel (default 0)
  // Per-axis scale on the selected UV set: for a body paint, BodyPaintTiles as 1/tiles on X and 1
  // on Y. Only a layer carrying this samples the `uv` channel — see RigDecalLayer.uvScale in
  // src/rig/BodyDecals.ts for why.
  uvScale: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  // The paint coordinate contract recovered from the compiled M_Skin: V is folded with fract() and
  // sampling is gated to the unit square. Named, not inferred — see RigDecalLayer.uvLayout.
  uvLayout: z.literal("sourceBodyPaint").optional(),
  // Source BodyPaintPlacement.x (TattooPlacement.x for a tattoo layer), added to U after the X scale
  // and never wrapped. Only a sourceBodyPaint layer honours it — see RigDecalLayer.uvOffsetX.
  uvOffsetX: z.number().finite().optional(),
  // Source BodyColorOverride: the weight on the paint's base-colour branch.
  colorOverride: z.number().min(0).max(1).optional(),
  // Source BodyColorMultiplyNonMasked as the multiply before that blend: "masked" for 0,
  // "nonMasked" for 1. Absent keeps the earlier mix-only composite — see RigDecalLayer.colorMultiply.
  colorMultiply: z.enum(["masked", "nonMasked"]).optional(),
  tint: HexColorSchema.optional(),
  // glow: the tint is also applied as emissive (e.g. "Eyes Emissive *" items)
  emissive: z.boolean().optional(),
});
export const DecalSchema = z.object({
  layers: z.array(DecalLayerSchema).min(1).max(6),
});
export type Decal = z.infer<typeof DecalSchema>;

// season/rarity/source are OPTIONAL: the datamined asset dump does not carry this
// metadata (it is server-authoritative / wiki-only), so importer-generated items
// omit them until a future wiki backfill. Hand-authored items may still set them.
export const ItemSchema = z.object({
  id: ItemIdSchema,
  slot: z.enum(SLOTS),
  name: z.string().min(1).max(80),
  set: z.string().min(1).optional(), // collection/theme (top-level dump folder)
  season: SeasonSchema.optional(),
  rarity: z.enum(RARITIES).optional(),
  source: z.enum(SOURCES).optional(),
  sponsor: z.string().min(1).optional(),
  imageUrl: z.string().min(1),
  model: ModelSchema.optional(),
  // A 2D body cosmetic composited onto the body/head instead of its own mesh. Mutually
  // exclusive with `model` in practice (tattoos/makeup/paint/eyes/nails).
  decal: DecalSchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const CatalogSchema = z.array(ItemSchema);
export type Catalog = z.infer<typeof CatalogSchema>;

export const SponsorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Sponsor = z.infer<typeof SponsorSchema>;

export const SponsorsSchema = z.array(SponsorSchema);
