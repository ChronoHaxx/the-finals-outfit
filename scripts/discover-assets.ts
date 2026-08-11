/**
 * discover-assets.ts — scan the datamined dump and emit the generated conversion manifests
 * so the convert pipeline + catalog scale without a hand-maintained list (M6).
 *
 * Discovers three asset classes (gated by scripts/convert-allowlist.json):
 *   - cosmetic SETS  : `SK_*_M.uemodel` under <Set>/Assets/<Piece>/  -> cosmetics/<set>-<piece>.glb
 *   - HAIRS          : `SM_<Style>.uemodel` under Hairs/<Style>/      -> hair/<style>.glb
 *   - HEADS          : `Head_NN_Base.uemodel` under Heads/Face_NN/Base/ -> heads/<face>.glb
 *                      (with the standard per-material config: eyes/lashes/teeth/skin)
 *
 * Writes:
 *   - scripts/asset-sources.generated.json   (consumed by convert-meshes.py / .mjs)
 *   - scripts/model-by-piece.generated.json  (consumed by import-catalog.ts)
 *
 * Keys match import-catalog's `${cat}/${piece}` (lower). PBR maps for sets are auto-discovered
 * by the converter from each mesh's sibling folder. Run: `npm run discover:assets`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHAR_ROOT =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

const ALLOWLIST_FILE = resolve(ROOT, "scripts/convert-allowlist.json");
const OUT_SOURCES = resolve(ROOT, "scripts/asset-sources.generated.json");
const OUT_MAP = resolve(ROOT, "scripts/model-by-piece.generated.json");

// Shared head textures (dump-relative). The eyeball is composited by build-eye-textures.mjs;
// eye/eyelash live under the sibling Pioneer content root (../.. from Characters/).
const EYELASH = "../../Pioneer/Characters/Heads/Shared/Eyelash/T_Universal_Eyelashes_D.png";
const EYEBALL = "../../Pioneer/Characters/Heads/Shared/Eyes/Textures/T_EyeBall_Composited.png";
const EYE_NORMAL = "../../Pioneer/Characters/Heads/Shared/Eyes/Textures/T_EYE_NORMALS.png";
const TEETH_D = "Heads/Shared/Mouth/teeth_color_map.png";
const TEETH_N = "Heads/Shared/Mouth/teeth_normal_map.png";

// Top-level folders that are NOT cosmetic sets (skipped when sets:"all").
const NON_SETS = new Set(
  [
    "Avatar", "Body", "BodyCosmetics", "BodyTypes", "Cinematic", "FacialHairs", "Generic",
    "Hairs", "Heads", "Meta", "Nails", "Outfits", "Pets", "Props", "Reference", "Shared",
    "VisualEffects", "Voices", "Watches",
  ].map((s) => s.toLowerCase()),
);

function spaceCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
function rel(abs: string): string {
  return relative(CHAR_ROOT, abs).replace(/\\/g, "/");
}
function firstFile(dir: string, re: RegExp): string | null {
  try {
    const hit = readdirSync(dir).find((n) => re.test(n));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

interface Asset {
  src: string;
  dst: string;
  [k: string]: unknown;
}

// Variant suffixes that are NOT the canonical in-game mesh. Anchored to the END of the
// filename so piece NAMES that merely contain these words (Undercut, HoodWrap, HandWraps,
// RingWrapBracelet, GasMaskWrap, BaseUndershirt) are KEPT — only true variant suffixes skip:
//   _UnderHat/_UnderHood/_Under  tucked-under-headwear hair variants
//   _Wrap                        wrap sub-pieces
//   _LOD\d                       level-of-detail meshes
//   _KeyArtMask                  promotional key-art render variant (not the in-game mesh)
// (?<!^S[MK]) — a "variant" token right after the SM_/SK_ prefix IS a piece's base mesh, not a
// variant: the standalone Attachments/KeyArtMask piece ships SM_KeyArtMask.uemodel, which the
// promo-variant rule (meant for SM_<Hair>_KeyArtMask) wrongly skipped.
const SKIP_VARIANT = /(?<!^S[MK])_(?:underhat|underhood|under|wrap|lod\d*|keyartmask)\.uemodel$/i;

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Canonicality score for picking ONE mesh per piece (lower = more canonical):
// [rank SK_*_M=0 else 1, clothSim penalty, folder-name mismatch, filename length].
//  - folder mismatch prefers the mesh whose name contains the piece-folder name (the base
//    garment: BigFootCostumeHead over BigfootHair, HelmetNeck over NeckCloth) — the canonical
//    piece, not a companion sub-mesh.
//  - length is the final tiebreak: the plain base over a longer suffixed sibling that sorts
//    first alphabetically (..._OneShoulderPad_M, ..._ShellMaterial_M).
function meshScore(name: string, folder: string): [number, number, number, number] {
  const rank = /^SK_.*_M\.uemodel$/i.test(name) ? 0 : 1;
  const cloth = /_clothsim\.uemodel$/i.test(name) ? 1 : 0;
  const folderMiss = alnum(name.replace(/\.uemodel$/i, "")).includes(alnum(folder)) ? 0 : 1;
  return [rank, cloth, folderMiss, name.length];
}
function scoreLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
// best score per pieceKey so a more-canonical mesh upgrades the pick.
const meshScoreByKey = new Map<string, number[]>();

// --- cosmetic sets + attachments -------------------------------------------
// Matches the medium skinned body mesh (sets) AND static props (Attachments: masks, glasses,
// wings) — preferring SK_*_M, falling back to SM_.
function findSetMeshes(absDir: string, setName: string, seen: Map<string, Asset>): void {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(absDir, e.name);
    if (e.isDirectory()) {
      if (/^skins$/i.test(e.name)) continue;
      findSetMeshes(p, setName, seen);
    } else if (/^(SK_.*_M|SM_.*|SK_.*)\.uemodel$/i.test(e.name) && !SKIP_VARIANT.test(e.name)) {
      const pieceFolder = basename(absDir);
      if (/^assets$/i.test(pieceFolder)) continue;
      const pieceKey = `${setName}/${pieceFolder}`.toLowerCase();
      const sc = meshScore(e.name, pieceFolder);
      const prev = meshScoreByKey.get(pieceKey);
      if (prev && !scoreLess(sc, prev)) continue;
      // Multi-part pieces: additive companions in this folder (shoulder pad, neck cloth, buckle…)
      // merge into the same glb at convert time. Computed for the chosen base only (after the
      // score gate), so re-runs on an upgrade re-resolve against the new base.
      const extras = findExtraParts(absDir, p);
      const asset: Asset = {
        src: rel(p),
        dst: `cosmetics/${slugify(setName)}-${slugify(spaceCase(pieceFolder))}.glb`,
      };
      if (extras.length) asset.extraParts = extras;
      seen.set(pieceKey, asset);
      meshScoreByKey.set(pieceKey, sc);
    }
  }
}

// --- heads (skinned, multi-material) ---------------------------------------
function headMaterials(faceDir: string): Asset["materials"] {
  // Texture layouts vary: Face_NN under Base/Textures (T_*_Base_D or T_*_D); special
  // heads (HollowFace) keep T_Head_*_Color/_Normal in the folder root; emissive-only
  // shells (BlankFace/CNS) have no skin diffuse at all.
  const dirs = [join(faceDir, "Base", "Textures"), join(faceDir, "Textures"), faceDir];
  let skinD: string | null = null;
  let skinN: string | null = null;
  for (const d of dirs) {
    skinD ??=
      firstFile(d, /_Base_D\.png$/i) ??
      firstFile(d, /^(?!T_UI_)(?!.*(BaseBody|Hands)).*_D\.png$/i) ??
      firstFile(d, /^T_Head_.*Color\.png$/i);
    skinN ??=
      firstFile(d, /_Base_N\.png$/i) ??
      firstFile(d, /^(?!T_UI_)(?!.*(BaseBody|Hands)).*_N\.png$/i) ??
      firstFile(d, /^T_Head_.*Normal\.png$/i);
  }
  const skin = skinD
    ? { baseColor: rel(skinD), ...(skinN ? { normal: rel(skinN) } : {}) }
    : undefined;
  // Emissive-only shells (BlankFace/CNS): no diffuse — bake the emissive face pattern.
  let emis: string | null = null;
  for (const d of dirs) emis ??= firstFile(d, /Emissive.*\.png$/i);
  return [
    { match: "eyeshell", hide: true },
    { match: "eyeedge", hide: true },
    { match: "eyelash", alpha: "mask", textures: { baseColor: EYELASH } },
    { match: "eyes", textures: { baseColor: EYEBALL, normal: EYE_NORMAL } },
    { match: "teeth", textures: { baseColor: TEETH_D, normal: TEETH_N } },
    ...(skin
      ? [
          // NO alpha for skin: the D texture's alpha is a data/rim mask, not coverage —
          // baking it as CLIP/BLEND breaks the face; the runtime alpha-tests the rim.
          // normalizeNormal: some heads ship pore detail ~2x hotter than the rest —
          // the converter normalizes amplitude so they don't render as crust.
          { match: "head", textures: skin, normalizeNormal: true },
          { match: "body", textures: skin, normalizeNormal: true },
        ]
      : []),
    // catch-all (matched last): emissive-only shells get their glow pattern baked
    ...(!skin && emis ? [{ match: "", textures: { emissive: rel(emis) } }] : []),
  ];
}

// First usable mesh in a piece folder: prefer the medium skinned body, then any skinned,
// then static; skip LOD/UnderHat/Wrap variants.
function findFirstMesh(dir: string): string | null {
  const found: string[] = [];
  const collect = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (/^skins$/i.test(e.name)) continue;
        collect(p);
      } else if (/^(SK|SM)_.*\.uemodel$/i.test(e.name) && !SKIP_VARIANT.test(e.name)) {
        found.push(p);
      }
    }
  };
  collect(dir);
  if (!found.length) return null;
  const folder = basename(dir);
  const rank = (f: string) =>
    /_M\.uemodel$/i.test(basename(f)) ? 0 : /^SK_/i.test(basename(f)) ? 1 : 2;
  const fmiss = (f: string) =>
    alnum(basename(f).replace(/\.uemodel$/i, "")).includes(alnum(folder)) ? 0 : 1;
  // rank, then prefer the mesh matching the piece-folder name, then the shortest (base) name.
  found.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      fmiss(a) - fmiss(b) ||
      basename(a).length - basename(b).length ||
      a.localeCompare(b),
  );
  return found[0];
}

// Accessory categories: one mesh per immediate piece folder under `walkRoot`, keyed
// `${keyPrefix}/${pieceName}` to match import-catalog's classify().
function findByPiece(walkRoot: string, dstDir: string, keyPrefix: string, seen: Map<string, Asset>): void {
  let pieces;
  try {
    pieces = readdirSync(walkRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const piece of pieces) {
    if (!piece.isDirectory()) continue;
    const pieceDir = join(walkRoot, piece.name);
    const mesh = findFirstMesh(pieceDir);
    if (!mesh) continue;
    const key = `${keyPrefix}/${piece.name}`.toLowerCase();
    if (seen.has(key)) continue;
    // Multi-part pieces: a separate FrontBangs/Fringe mesh that belongs to the SAME item
    // (e.g. HighPonytail_02 = ponytail + FrontBangs). findFirstMesh picks one mesh and drops
    // the rest, so the converter would miss the bangs — carry them as extraParts (merged into
    // one glb at convert time). UnderHat variants are excluded by SKIP_VARIANT.
    const extras = findExtraParts(pieceDir, mesh);
    const asset: Asset = { src: rel(mesh), dst: `${dstDir}/${slugify(piece.name)}.glb` };
    if (extras.length) asset.extraParts = extras;
    seen.set(key, asset);
  }
}

// Additive companion sub-parts that ship as SEPARATE .uemodels in the SAME piece folder and must
// merge into the piece's glb (a shoulder pad, neck cloth, buckle, LED strip, tassels, orb…). This
// is a CURATED token list, not a blanket "merge all siblings" — a piece folder also holds skin /
// variant meshes (glitch, shellmaterial, empress, push, sponsor) that must NOT be merged. Tokens
// verified against the dump: AcePilotTop+OneShoulderPad, HelmetNeck+NeckCloth, EasternEmperor+
// Tassels(ClothSim), BaseballCap+LEDStrip, RoboticOrbHead+Spikes, TopHat/BowlerHat+Buckle,
// CrystalBall+Orb/Rope, WizardStaff+Orb, SkiBlade+Binding, HornsAndHeadset, AquariumHelmet+Bubbles.
// (frontbangs/fringe keep the original hair behaviour.) Standalone items that merely NAME a part
// (Sport/ShoulderPads, DemonHorns) sit in their OWN folder, so the base-stem exclusion below leaves
// them with no companions.
// Distinctive part tokens — safe even when camelCase-joined to the base (AcePilotTopOneShoulderPad,
// EasternEmperorTassels). Require a RIGHT boundary (`_`/`.`) so a substring inside a longer word is
// not matched: `bubble` must NOT fire on BubbleBraids, `frontbangs` must NOT fire on
// FrontBangsUnderHat (the wear-a-hat variant).
const COMPANION_DISTINCTIVE =
  /(oneshoulderpad|neckcloth|tassels?|ledstrip|buckle|spikes?|bubbles?|binding|headset|frontbangs|fringe)(?=[._])/i;
// Short ambiguous tokens that also occur INSIDE brand/part names (RoboticOrb, Longhorns) — require
// a LEFT `_` too, so they fire only on a real `_Orb`/`_Rope`/`_Horns` sub-part, never on RoboticOrb.
const COMPANION_AMBIGUOUS = /_(orb|rope|horns)(?=[._])/i;
const isCompanionMesh = (fileName: string): boolean =>
  COMPANION_DISTINCTIVE.test(fileName) || COMPANION_AMBIGUOUS.test(fileName);
// LOD-collapsed stem (strip _ClothSim then _H/_M/_L then .uemodel) for grouping a companion's LODs.
const collapseLod = (fileName: string): string =>
  fileName
    .replace(/\.uemodel$/i, "")
    .replace(/_clothsim$/i, "")
    .replace(/_(?:H|M|L)$/i, "")
    .toLowerCase();
const lodRank = (fileName: string): number =>
  /_M(?:_clothsim)?\.uemodel$/i.test(fileName)
    ? 0
    : /_H(?:_clothsim)?\.uemodel$/i.test(fileName)
      ? 1
      : /_L(?:_clothsim)?\.uemodel$/i.test(fileName)
        ? 2
        : 3;

// Companion meshes of `baseMesh` in its folder: token-matched siblings, ONE per companion (its _M
// LOD preferred; ClothSim allowed for cloth parts like tassels). Returns dump-relative paths.
function findExtraParts(dir: string, baseMesh: string): string[] {
  const all: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (/^skins$/i.test(e.name)) continue;
        walk(p);
      } else if (/\.uemodel$/i.test(e.name) && !SKIP_VARIANT.test(e.name)) {
        all.push(p);
      }
    }
  };
  walk(dir);

  const baseStem = collapseLod(basename(baseMesh));
  const byStem = new Map<string, string[]>();
  for (const p of all) {
    if (p === baseMesh) continue;
    const name = basename(p);
    if (!isCompanionMesh(name)) continue;
    const stem = collapseLod(name);
    if (stem === baseStem) continue; // a LOD of the base, not a separate part
    const g = byStem.get(stem) ?? [];
    g.push(p);
    byStem.set(stem, g);
  }
  const out: string[] = [];
  for (const group of byStem.values()) {
    group.sort((a, b) => lodRank(basename(a)) - lodRank(basename(b)) || basename(a).length - basename(b).length);
    out.push(rel(group[0]));
  }
  return out;
}

function findAccessories(seen: Map<string, Asset>): void {
  findByPiece(join(CHAR_ROOT, "FacialHairs"), "facialhair", "facialhairs", seen);
  findByPiece(join(CHAR_ROOT, "Watches"), "watch", "watches", seen);
  findByPiece(join(CHAR_ROOT, "Nails"), "nails", "nails", seen);
  findByPiece(join(CHAR_ROOT, "BodyCosmetics", "Earrings"), "earring", "bodycosmetics", seen);
}

function findHeads(seen: Map<string, Asset>): void {
  const headsRoot = join(CHAR_ROOT, "Heads");
  let faces;
  try {
    faces = readdirSync(headsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const f of faces) {
    if (!f.isDirectory() || /^(Shared|HeadMaster)$/i.test(f.name)) continue;
    const dir = join(headsRoot, f.name);
    const baseDir = join(dir, "Base");
    // Standard + newer SK_-prefixed exports under Base/; special heads (BlankFace,
    // HollowFace) keep the mesh in the folder root. Skip Wraps/Glitch variants.
    const mesh =
      firstFile(baseDir, /^(SK_)?Head_.*_Base\.uemodel$/i) ??
      firstFile(baseDir, /^(?!.*(wraps|glitch)).*\.uemodel$/i) ??
      firstFile(dir, /^(?!.*(wraps|glitch)).*\.uemodel$/i);
    if (!mesh) continue;
    seen.set(`heads/${f.name}`.toLowerCase(), {
      src: rel(mesh),
      dst: `heads/${slugify(f.name)}.glb`,
      materials: headMaterials(dir),
    });
  }
}

function main(): void {
  if (!existsSync(CHAR_ROOT)) {
    console.error(`Characters folder not found: ${CHAR_ROOT}\nSet FINALS_DUMP to the dump's Characters/ folder.`);
    process.exit(1);
  }
  if (!existsSync(ALLOWLIST_FILE)) {
    console.error(`Allowlist not found: ${ALLOWLIST_FILE}`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  const sets: string[] | "all" = cfg.sets ?? [];
  const allowAll = sets === "all";
  const allowLc = new Set((Array.isArray(sets) ? sets : []).map((s) => s.toLowerCase()));

  const seen = new Map<string, Asset>();
  // body is always needed (base mesh) — fixed entry with its skin textures.
  seen.set("_body", {
    src: "Body/SK_Body_M.uemodel",
    dst: "body/SK_Body_M.glb",
    baseColorDir: "Body",
    baseColor: ["T_BaseBody_Male_Medium_Color.png", "T_BaseBody_Male_Dark_Color.png"],
  });

  for (const cat of readdirSync(CHAR_ROOT, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const lc = cat.name.toLowerCase();
    if (allowAll ? NON_SETS.has(lc) : !allowLc.has(lc)) continue;
    findSetMeshes(join(CHAR_ROOT, cat.name), cat.name, seen);
  }
  if (cfg.hairs) findByPiece(join(CHAR_ROOT, "Hairs"), "hair", "hairs", seen);
  if (cfg.heads) findHeads(seen);
  if (cfg.accessories) findAccessories(seen);

  const keys = [...seen.keys()].sort();
  const assets = keys.map((k) => seen.get(k)!).sort((a, b) => a.dst.localeCompare(b.dst));
  const map: Record<string, string> = {};
  for (const k of keys) if (!k.startsWith("_")) map[k] = `models/${seen.get(k)!.dst}`;

  writeFileSync(
    OUT_SOURCES,
    JSON.stringify(
      { comment: "GENERATED by scripts/discover-assets.ts — do not edit by hand.", assets },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(OUT_MAP, JSON.stringify(map, null, 2) + "\n");

  const n = (re: RegExp) => assets.filter((a) => re.test(a.dst)).length;
  console.log(
    `Discovered ${assets.length} assets: ${n(/^cosmetics\//)} cosmetics, ${n(/^hair\//)} hairs, ` +
      `${n(/^heads\//)} heads, ${n(/^(facialhair|watch|nails|earring)\//)} accessories (+body).`,
  );
  console.log(`  -> ${relative(ROOT, OUT_SOURCES)}\n  -> ${relative(ROOT, OUT_MAP)}`);
}

main();
