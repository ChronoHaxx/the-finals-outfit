// extract-customization.mjs — recover the per-item customization data the cooked dump "strips".
//
// The CharacterCustomizationItem DataAssets (DA_<piece>_<skin>.uasset) carry the hide rules,
// under-layer mesh, slot, set/theme, archetype gating and SEASON — but FModel exports their JSON
// EMPTY because those are Embark Angelscript classes whose property schema isn't in the .usmap.
// The VALUES still survive in the raw .uasset's NAME TABLE (every FName is an individually
// length-prefixed string — no schema needed to read them, unlike the property blob). This scans
// that table offline (no UE4SS / no injection / no anti-cheat risk) and classifies the tags.
//
// Output: scripts/customization.generated.json  { <daName>: { itemKey, slot, hideSlots,
//   hideMesh, season, themes, archetypes, shape, underLayer:{mesh,mi}, meshRefs, miRefs } }
//
// Usage: node scripts/extract-customization.mjs [--sample=<substr>] [--limit=N]
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";
const OUT = resolve(SCRIPT_DIR, "customization.generated.json");

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const SAMPLE = argv.sample ? String(argv.sample).toLowerCase() : null;
const LIMIT = argv.limit ? Number(argv.limit) : Infinity;

// These are IoStore/Zen packages (cooked into the .utoc): the name map is a name-BATCH — all
// FName strings stored concatenated, with lengths in a separate header block, so there are no
// per-name null terminators (a raw `strings` pass runs them together). We can't cheaply parse the
// Zen header, but every tag/ref we want starts with a known PREFIX, so: pull the printable runs
// and split each at the boundary where the next known-prefixed token begins.
const TOKEN_START =
  /(?=Customization\.|EBodySlot::|Online\.Season|MI_[A-Z]|SK_[A-Z]|TA_[A-Z]|T_[A-Z]|DA_[A-Z]|\/Game\/)/;
function extractNames(buf) {
  const text = buf.toString("latin1");
  const names = [];
  // maximal runs of printable ASCII (incl. the chars used in tags/paths): . _ : / -
  const runRe = /[A-Za-z0-9._:/-]{4,}/g;
  let m;
  while ((m = runRe.exec(text))) {
    for (const tok of m[0].split(TOKEN_START)) {
      if (tok.length >= 3) names.push(tok);
    }
  }
  return names;
}

// Derive the piece token from a DA name: DA_Casual_LongCoat_Satin -> "Casual_LongCoat" (drop the
// trailing skin token); used to tell the item's OWN mesh from an under-layer mesh.
function pieceOf(daName) {
  const t = daName.replace(/^DA_/, "").split("_");
  return t.length > 2 ? t.slice(0, 2).join("_") : t.join("_");
}

// Curated EBodySlot enum values (longest-first) — used to bound a hide-slot token, since the
// name-batch gives no length so the value runs into the following FName (often a lowercase
// "head"/"lumbar" or another PascalCase name). Best-effort: unknown values keep their raw token.
const KNOWN_SLOTS = [
  "TorsoUpperLeft", "TorsoUpperRight", "BackLowerRight", "BackLowerLeft", "HeadExtensions",
  "BackUpper", "BackLower", "BodyUpper", "BodyLower", "BodyPaint", "FacePaint", "Headwear",
  "Facewear", "Forehead", "Earrings", "Bandolier", "Calves", "Shoes", "Hands", "Hood", "Head",
  "Neck", "Chest", "Arms", "Wrists", "Legs", "Feet", "Thighs", "Waist", "Knife",
].sort((a, b) => b.length - a.length);
const boundSlot = (raw) => KNOWN_SLOTS.find((s) => raw.startsWith(s)) ?? raw;
// Strip trailing FName noise the name-batch concatenated onto a ref (None / Audio / Effect / a
// dangling '.'), so MI_..._VelvetAudio. -> MI_..._Velvet and MI_..._LeatherNone -> MI_..._Leather.
const cleanRef = (r) =>
  r.replace(/(?:None|Audio|Effect|Anim|Cloth|VFX|Default)+\.?$/i, "").replace(/\.$/, "");

function classify(daName, names) {
  const out = {
    slot: null, hideSlots: [], hideMesh: [], season: null,
    themes: [], archetypes: [], shape: [], meshRefs: [], miRefs: [],
  };
  const seen = new Set();
  for (const raw of names) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    let m;
    if ((m = /^Customization\.Slot\.(.+)/.exec(raw))) out.slot ??= boundSlot(m[1]);
    else if ((m = /^EBodySlot::(.+)/.exec(raw))) out.hideSlots.push(boundSlot(m[1]));
    else if ((m = /^Online\.Season\.(\d+)/.exec(raw))) out.season ??= Number(m[1]);
    else if ((m = /^Customization\.Theme\.(.+)/.exec(raw))) out.themes.push(m[1]);
    else if ((m = /^Customization\.Archetype\.(.+)/.exec(raw))) out.archetypes.push(m[1]);
    else if ((m = /^Customization\.HideMesh\.(.+)/.exec(raw))) out.hideMesh.push(m[1]);
    else if ((m = /^Customization\.Shape\.(.+)/.exec(raw))) out.shape.push(m[1]);
    else if (/^SK_/.test(raw) && !/_ClothSim$/.test(raw)) out.meshRefs.push(raw);
    else if (/^MI_/.test(raw)) out.miRefs.push(cleanRef(raw));
  }
  // Under-layer: a referenced skeletal mesh whose piece differs from this item's own piece.
  const piece = pieceOf(daName).toLowerCase();
  const ownPieceTokens = piece.split("_");
  const isForeign = (sk) => {
    const body = sk.replace(/^SK_/, "").replace(/_[HLM]$/, "").toLowerCase();
    // foreign if it shares NONE of the own piece's tokens (e.g. LongCoat vs LawyerSuitJacket)
    return !ownPieceTokens.some((t) => t.length > 2 && body.includes(t));
  };
  // Under-layer candidates = foreign cosmetic meshes (not the item's own, not an engine
  // SK_MeshMerge_* socket helper). The FINAL pick is made in a global post-pass that knows each
  // mesh's own slot — a coat references several companions (bracers + shoulderpads + the actual
  // undershirt) and only the slot signal reliably finds the torso lining. Stash candidates here.
  out._foreign = [...new Set(out.meshRefs)].filter((sk) => isForeign(sk) && !/^SK_MeshMerge/i.test(sk));
  out._ownPiece = piece;
  for (const k of ["hideSlots", "hideMesh", "themes", "archetypes", "shape", "meshRefs", "miRefs"]) {
    out[k] = [...new Set(out[k])];
  }
  return out;
}

// Walk the dump for CharacterCustomizationItem DAs (DA_<piece>_<skin>, NOT MetaData/Persistence).
function* walkDAs(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkDAs(p);
    else if (
      /^DA_.*\.uasset$/i.test(e.name) &&
      !/MetaData|Persistence/i.test(e.name)
    ) yield p;
  }
}

let count = 0, withUnder = 0, withSeason = 0;
const result = {};
for (const uassetPath of walkDAs(DUMP)) {
  const daName = uassetPath.replace(/\.uasset$/i, "").split(/[\\/]/).pop();
  if (SAMPLE && !daName.toLowerCase().includes(SAMPLE)) continue;
  if (count >= LIMIT) break;
  let buf;
  try { buf = readFileSync(uassetPath); } catch { continue; }
  const names = extractNames(buf);
  const c = classify(daName, names);
  result[daName] = c;
  count++;
  if (c.season != null) withSeason++;
}

// --- global under-layer selection (needs every mesh's own slot, so done after all DAs parse) ---
const TORSO = /Top|Torso|Shirt|Hoodie|TankTop|Sweater|Jacket|Vest|Tee|Tights|Suit|Robe|Dress|Cardigan|Blouse|Jumper|Pullover|Bodysuit|Leotard|Turtleneck|Singlet|Tunic|Camisole|Bodice|Corset|Jersey/i;
const ACCESSORY = /Bracer|Shoulderpad|Pauldron|Cape|Bandolier|Necklace|Neck|Headphone|Glove|Boot|Mask|Beard|Crown|Helmet|Hat|Ring|Earring|Watch|\bBag\b|Belt|Strap|Charm|Scarf|Wing|Tail|Horn|Antenna|ArmBand|ArmSleeve|ElbowPad|HipBag|HeadCloth|Sock/i;
const nrm = (sk) => sk.replace(/^SK_/, "").replace(/_[HLM]$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// mesh-piece -> game slot, from each DA's OWN mesh (the meshRef matching its piece token).
const meshSlot = new Map();
for (const r of Object.values(result)) {
  if (!r.slot || !r._ownPiece) continue;
  const ownNorm = r._ownPiece.replace(/[^a-z0-9]/g, "");
  if (r.meshRefs.some((m) => nrm(m) === ownNorm)) meshSlot.set(ownNorm, r.slot);
}
for (const r of Object.values(result)) {
  const foreign = r._foreign || [];
  delete r._foreign;
  delete r._ownPiece;
  // Under-layers only make sense for TORSO garments (a boot/helmet has no undershirt).
  if (r.slot !== "BodyUpper") continue;
  const pick =
    foreign.find((s) => meshSlot.get(nrm(s)) === "BodyUpper") ?? // strongest: a real BodyUpper garment
    foreign.find((s) => TORSO.test(s) && !ACCESSORY.test(s)); // else a clear torso-name garment
  if (!pick) continue;
  const pieceTok = pick.replace(/^SK_/, "").replace(/_[HLM]$/, "").toLowerCase();
  r.underLayer = {
    mesh: pick,
    mi: (r.miRefs || []).find((mi) => pieceTok.split("_").some((t) => t.length > 3 && mi.toLowerCase().includes(t))) ?? null,
  };
  withUnder++;
}

if (SAMPLE) {
  for (const [da, c] of Object.entries(result))
    if (da.toLowerCase().includes(SAMPLE)) console.log(`\n=== ${da} ===\n${JSON.stringify(c, null, 2)}`);
} else {
  writeFileSync(OUT, JSON.stringify(result, null, 0) + "\n");
  console.log(`parsed ${count} customization DAs -> ${OUT.replace(ROOT, ".")}`);
  console.log(`  with under-layer: ${withUnder}   with season: ${withSeason}`);
}
