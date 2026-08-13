// layered-mi.mjs — read a skin's MaterialInstance (MI_*.json) into the param bags the
// layered-material baker needs, and resolve the dump paths of the textures/Texture2DArrays
// it binds.
//
// THE FINALS garment skins are `MI_Casual_<Piece>_<Skin>` instances whose parent is
// `MI_Character_Layered_N` → `M_Character_Layered` (the operative master; its expression
// graph is stripped from the dump, so the look is reconstructed from these params — see the
// `finals-layered-material` project memory). Each skin self-describes its TextureArray
// bindings + per-layer scalars/vectors; the master only sets UseLayer2..N. We therefore read
// the skin MI directly (no parent merge needed for the LongCoat family) and fall back to the
// parent only for a missing scalar.
//
// Texture object paths look like `/Game/Discovery/Characters/Casual/.../TA_..._Colors.0`.
// `/Game/` maps to the cooked `Content/` root; the dump's FINALS_DUMP points at
// `Content/Discovery/Characters`, so `/Game/Discovery/<rest>` resolves under
// `dirname-of-Characters` (= `Content/Discovery`). Texture2DArrays export as numbered PNG
// slices `<base>_0.png/_1.png/...` (count = SizeZ in the sibling `<base>.json`).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

// --- MI parsing --------------------------------------------------------------

// Read the first MI_*.json in `dir` that actually carries layered params. Returns
// { name, parentName, nLayers, scalars:{}, vectors:{name:{r,g,b,a}}, textures:{name:objectPath} }.
export function readMI(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => /^MI_.*\.json$/i.test(f));
  } catch {
    return null;
  }
  let obj;
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const o = Array.isArray(raw) ? raw[0] : raw;
      if (o?.Properties?.VectorParameterValues) {
        obj = o;
        break;
      }
      if (o?.Properties && !obj) obj = o;
    } catch {
      /* ignore unreadable */
    }
  }
  if (!obj) return null;
  const props = obj.Properties ?? {};
  const parentName = props?.Parent?.ObjectName ?? "";
  // Parent encodes the active layer count: `MI_Character_Layered_2` or `..._8Layers_Master`.
  const m = /Layered_(\d+)/.exec(parentName) ?? /(\d+)\s*Layers/i.exec(parentName);
  const nLayers = m ? Math.max(1, Math.min(8, Number(m[1]))) : 8;

  const scalars = {};
  for (const e of props.ScalarParameterValues ?? []) {
    const n = e?.ParameterInfo?.Name;
    if (n && typeof e.ParameterValue === "number") scalars[n] = e.ParameterValue;
  }
  const vectors = {};
  for (const e of props.VectorParameterValues ?? []) {
    const n = e?.ParameterInfo?.Name;
    const v = e?.ParameterValue;
    // UE vector params are LINEAR floats (the Hex field is sRGB); keep linear for compositing.
    if (n && v && typeof v.R === "number")
      vectors[n] = { r: v.R, g: v.G, b: v.B, a: typeof v.A === "number" ? v.A : 1 };
  }
  const textures = {};
  for (const e of props.TextureParameterValues ?? []) {
    const n = e?.ParameterInfo?.Name;
    const p = e?.ParameterValue?.ObjectPath;
    if (n && typeof p === "string") textures[n] = p;
  }
  // FModel emits the layered Texture2DArray parameters under two vocabularies.
  // Older exports use the descriptive names; a large part of the character dump uses
  // the compact material-instance names C/N/M. Normalize both at this boundary so the
  // baker cannot silently fall back to zero detail slices.
  const arrayAliases = {
    TextureArray_C: "TextureArray_Colors",
    TextureArray_N: "TextureArray_Normals",
    TextureArray_M: "TextureArray_Masks",
  };
  for (const [source, canonical] of Object.entries(arrayAliases)) {
    if (!textures[canonical] && textures[source]) textures[canonical] = textures[source];
  }
  return { name: obj.Name ?? basename(dir), parentName, nLayers, scalars, vectors, textures };
}

// Base-material key of a skin (the `Skins/<Base>/` folder its TextureArrays live in, e.g.
// "leather", "satin", "polyesterblend"). Recolors of the same base share its arrays — and its
// look tuning — so this is the key for per-base-material seeding. Null if undeterminable.
export function baseMaterialOf(mi) {
  const p =
    mi.textures.TextureArray_Colors ||
    mi.textures.TextureArray_Normals ||
    mi.textures.TextureArray_Masks ||
    "";
  const m = /\/Skins\/([^/]+)\//i.exec(p);
  return m ? m[1].toLowerCase() : null;
}

// --- dump path resolution ----------------------------------------------------

// `Content/Discovery` root, derived from FINALS_DUMP (= `Content/Discovery/Characters`).
function contentDiscovery(dumpRoot) {
  return dumpRoot.replace(/[\\/]+Characters[\\/]?$/i, "");
}

// `/Game/Discovery/<rest>.<idx>` -> absolute on-disk base path (no extension).
export function resolveDumpPath(objectPath, dumpRoot) {
  const rel = objectPath
    .replace(/^\/Game\/Discovery\//i, "")
    .replace(/\.\d+$/, ""); // strip the trailing `.0` object index
  return join(contentDiscovery(dumpRoot), rel);
}

// Resolve a single Texture2D param to its `.png` on disk (or null).
export function texturePath(mi, paramName, dumpRoot) {
  const p = mi.textures[paramName];
  if (!p) return null;
  const f = resolveDumpPath(p, dumpRoot) + ".png";
  return existsSync(f) ? f : null;
}

// Resolve a Texture2DArray param to its ordered slice `.png` paths. Slice count comes from
// the sibling `<base>.json` SizeZ when present, else from the `<base>_N.png` files on disk.
export function arraySlices(mi, paramName, dumpRoot) {
  const p = mi.textures[paramName];
  if (!p) return [];
  const base = resolveDumpPath(p, dumpRoot);
  const dir = dirname(base);
  const stem = basename(base);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+)\\.png$`, "i");
  return names
    .map((n) => {
      const mm = re.exec(n);
      return mm ? { idx: Number(mm[1]), file: join(dir, n) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.file);
}
