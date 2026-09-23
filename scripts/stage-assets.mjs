// Stage exactly the assets the catalog references into _assets-upload/<version>/,
// ready to publish to whatever host VITE_ASSETS_BASE points at.
//
//   node scripts/stage-assets.mjs v2 [--models-only | --reconstruction-only]
//
// Why a version directory rather than uploading in place:
//
// Assets are served with `immutable, max-age=1y`, which is correct for content that
// never changes and a trap for content that does. Overwriting a path leaves everyone
// who already fetched it on the old bytes for a year, with no way to reach them. So a
// release never overwrites — it publishes a new prefix and VITE_ASSETS_BASE switches
// to it in one move, after `ASSETS_BASE=… npm run validate:catalog` confirms every
// referenced path is actually reachable there.
//
// Only referenced files are copied. public/ holds ~15,000 files from the bake
// pipeline; the catalog asks for a fraction of them, and shipping the rest would
// publish more of Embark's material than the app has any use for.

import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { collectAssetRefs } from "./lib/asset-refs.mjs";
import { collectReconstructionAssetRefs, collectAssetCompanions } from "./lib/reconstruction-assets.mjs";
import { preflightPackage, selectStagePaths, stageMode } from "./lib/stage-selection.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Release worktrees can use the existing extraction without copying it into Git.
const publicDir = resolve(process.env.ASSET_SOURCE_DIR || resolve(ROOT, "public"));
const version = process.argv[2] ?? "v1";
const mode = stageMode(process.argv.slice(2));
if (!/^[a-z0-9][a-z0-9-]*$/.test(version)) throw new Error('Use a single version directory name');
const outRoot = resolve(ROOT, "_assets-upload");
const outDir = join(outRoot, version);
if (existsSync(outDir)) throw new Error(`Version already exists: ${version}. Choose a new version; published paths are immutable.`);

const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));

const catalog = collectAssetRefs(items);
const reconstruction = collectReconstructionAssetRefs(publicDir);
const companions = collectAssetCompanions(publicDir, catalog);
// Icons can stay on a previous immutable release when only 3D content changes.
// --models-only pairs with MODELS_BASE / VITE_MODELS_BASE; --reconstruction-only is the
// reconstruction shard alone, paired with RECONSTRUCTION_BASE / VITE_RECONSTRUCTION_BASE.
const referenced = selectStagePaths(mode, { catalog, companions, reconstruction });

const absent = [...referenced].filter(path => !existsSync(join(publicDir, path)));
if (absent.length) throw new Error(`Cannot stage ${absent.length} missing assets: ${absent.slice(0, 10).join(', ')}`);
// Refuse before creating anything: a package that cannot fit one deployment must be split.
preflightPackage(mode, referenced, path => statSync(join(publicDir, path)).size);

let copied = 0;
let bytes = 0;
const missing = [];
for (const rel of referenced) {
  const src = join(publicDir, rel);
  if (!existsSync(src)) {
    missing.push(rel);
    continue;
  }
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  bytes += statSync(src).size;
  copied++;
}

// The manifest is how CI proves the host actually holds what the catalog asks for.
// Fetching all ~4,500 paths individually trips Netlify's rate limiting, which comes
// back as 403s and reads as "assets missing" — so the host publishes one list and
// validation diffs against it, plus a few real spot-checks so a stale manifest cannot
// vouch for itself.
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ version, scope: mode, count: copied, paths: [...referenced].sort(), reconstructionPaths: [...reconstruction].sort() }, null, 0),
);

// Lives at the publish root so it covers every version directory.
// CORS is required: icons are <img> and would load without it, but the GLBs are
// fetched by three.js and fail cross-origin without an explicit allow.
writeFileSync(
  join(outRoot, "_headers"),
  `/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n`,
);

console.log(`staged ${copied} files (${(bytes / 1024 / 1024).toFixed(1)} MB) into _assets-upload/${version}/`);
if (missing.length > 0) {
  console.error(`\n${missing.length} referenced file(s) MISSING from public/:`);
  for (const m of missing.slice(0, 10)) console.error(`  ${m}`);
  if (missing.length > 10) console.error(`  …and ${missing.length - 10} more`);
  console.error("\nStaging is incomplete — deploying this would ship 404s.");
  process.exit(1);
}
console.log(`\nnext: publish _assets-upload/ to the host, then`);
console.log({
  models: `  ASSETS_BASE=<existing-icons-host> MODELS_BASE=<new-models-host> npm run validate:catalog`,
  reconstruction: `  ASSETS_BASE=<icons-host> MODELS_BASE=<models-host> RECONSTRUCTION_BASE=<new-reconstruction-host> npm run validate:catalog`,
  all: `  ASSETS_BASE=<host>/${version}/ npm run validate:catalog`,
}[mode]);
console.log(`and only switch the ASSETS_BASE repo variable once that passes.`);
