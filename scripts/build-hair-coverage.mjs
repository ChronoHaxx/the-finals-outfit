// build-hair-coverage.mjs — hairs use a hair-card atlas: the colour is a flat tint (sampled by
// import-catalog) but the STRAND SHAPE lives in a coverage mask the converter never wired in, so
// cards render as opaque grey shards. This emits, per hair glb, a sibling `<style>.coverage.webp`
// (greyscale strand alpha) that CharacterRig applies as an alphaMap + alphaTest, turning the cards
// into proper strands. Local only (no Blender, no re-convert).
//   node scripts/build-hair-coverage.mjs
//
// Coverage lives in one of (checked in order):
//   1. own  Textures/*CardsAtlas_Coverage.png        (white-strands-on-black, greyscale)
//   2. own  Textures/*_NXA.png  alpha channel        (Normal-X + Alpha: A = strand coverage)
//   3. MI TextureParameterValues ref to a *Coverage*  (shared atlas in another style dir)
//   4. MI TextureParameterValues ref to a *NXA*       (alpha channel of the shared NXA)
//   5. parent-MI chain repeat of 3/4                  (empty MIs inherit textures from a parent)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MODELS = resolve(ROOT, "public", "models");
const DUMP =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";

const srcFile = existsSync(resolve(SCRIPT_DIR, "asset-sources.generated.json"))
  ? resolve(SCRIPT_DIR, "asset-sources.generated.json")
  : resolve(SCRIPT_DIR, "asset-sources.json");
const assets = JSON.parse(readFileSync(srcFile, "utf8")).assets ?? [];

const get = (j) => (Array.isArray(j) ? j.find((x) => x.Properties) ?? j[0] : j);

// /Game/Discovery/Characters/Hairs/X/Textures/T_foo.123  ->  <DUMP>/Hairs/X/Textures/T_foo.png
const objectPathToPng = (objPath) => {
  if (!objPath) return null;
  let p = objPath.replace(/\.\d+$/, ""); // strip trailing .0 export index
  const m = p.match(/\/Game\/Discovery\/Characters\/(.+)$/);
  if (!m) return null;
  const png = resolve(DUMP, m[1] + ".png");
  return existsSync(png) ? png : null;
};

const texInDir = (dir, re) => {
  const td = join(dir, "Textures");
  if (!existsSync(td)) return null;
  const hit = readdirSync(td).find((f) => re.test(f));
  return hit ? join(td, hit) : null;
};

const miFile = (styleDir) => {
  if (!existsSync(styleDir)) return null;
  const f = readdirSync(styleDir).find((x) => /^MI_.*\.json$/i.test(x));
  return f ? join(styleDir, f) : null;
};

// Dirs referenced by any MI_*.json path inside a style dir's meshes (SK/SM material slots live in
// LOD data, not a tidy StaticMaterials array, so just grep the mesh jsons for MI ObjectPaths).
const dirsFromMeshMaterials = (styleDir) => {
  if (!existsSync(styleDir)) return [];
  const out = new Set();
  for (const f of readdirSync(styleDir)) {
    if (!/^(SK|SM)_.*\.json$/i.test(f)) continue;
    const txt = readFileSync(join(styleDir, f), "utf8");
    for (const m of txt.matchAll(/\/Game\/Discovery\/Characters\/(.+?)\/MI_[^/"]+/g)) {
      out.add(resolve(DUMP, m[1]));
    }
  }
  return [...out];
};

// Resolve a {png, fromAlpha} coverage source for a style dir: own atlas → own NXA alpha →
// MI texture refs → MI parent chain → meshes' material-slot MI dirs. visited guards cycles.
const resolveCoverage = (styleDir, depth = 0, visited = new Set()) => {
  if (depth > 8 || !existsSync(styleDir) || visited.has(styleDir)) return null;
  visited.add(styleDir);
  // 1/2 — own Textures dir
  const ownCov = texInDir(styleDir, /Coverage.*\.png$/i);
  if (ownCov) return { png: ownCov, fromAlpha: false };
  const ownNxa = texInDir(styleDir, /_NXA\.png$/i);
  if (ownNxa) return { png: ownNxa, fromAlpha: true };
  // 3/4/5 — this style's MI texture refs, then its parent chain
  const mi = miFile(styleDir);
  if (mi) {
    const o = get(JSON.parse(readFileSync(mi, "utf8")));
    const refs = (o.Properties?.TextureParameterValues ?? []).map(
      (t) => t.ParameterValue?.ObjectPath || t.ParameterValue?.ObjectName || "",
    );
    const covRef = refs.find((r) => /Coverage/i.test(r));
    const covPng = covRef && objectPathToPng(covRef);
    if (covPng) return { png: covPng, fromAlpha: false };
    const nxaRef = refs.find((r) => /NXA/i.test(r));
    const nxaPng = nxaRef && objectPathToPng(nxaRef);
    if (nxaPng) return { png: nxaPng, fromAlpha: true };
    const parent = o.Properties?.Parent?.ObjectPath;
    const pm = parent && parent.match(/\/Game\/Discovery\/Characters\/(.+)\/MI_[^/]+$/);
    if (pm) {
      const r = resolveCoverage(resolve(DUMP, pm[1]), depth + 1, visited);
      if (r) return r;
    }
  }
  // 6 — meshes reference their MI from another style dir (e.g. Mohawk → Undercut)
  for (const d of dirsFromMeshMaterials(styleDir)) {
    const r = resolveCoverage(d, depth + 1, visited);
    if (r) return r;
  }
  return null;
};

let made = 0,
  missing = 0;
const misses = [];
for (const a of assets) {
  if (!/^(hair|facialhair)\//.test(a.dst)) continue; // hair + facial-hair card glbs
  const styleDir = resolve(DUMP, dirname(a.src)); // .../Hairs/<Style>
  const cov = resolveCoverage(styleDir);
  const out = resolve(MODELS, a.dst.replace(/\.glb$/, ".coverage.webp"));
  if (!cov) {
    missing++;
    misses.push(basename(a.dst));
    continue;
  }
  // Greyscale strand mask (white = hair). three reads alphaMap.G — keep RGB grey.
  if (cov.fromAlpha) {
    // NXA: the coverage is the ALPHA channel. Extract it as a greyscale mask.
    await sharp(cov.png)
      .ensureAlpha()
      .extractChannel(3)
      .toColourspace("b-w")
      .webp({ quality: 90 })
      .toFile(out);
  } else {
    await sharp(cov.png).removeAlpha().webp({ quality: 90 }).toFile(out);
  }
  made++;
}
console.log(`hair coverage: ${made} written, ${missing} without a coverage texture.`);
if (misses.length) console.log("  missing: " + misses.join(", "));
