// convert-meshes.mjs — locate Blender and run the headless .uemodel -> .glb converter,
// then meshopt-compress + downscale the output GLBs (best-effort).
// Usage: npm run convert:meshes [a:b]   (optional half-open index range for chunked runs)
// Env overrides: BLENDER (blender.exe path), FINALS_DUMP (dump Characters/ folder),
// BLENDER_ADDONS (Blender user scripts/addons dir holding io_scene_ueformat).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const MODELS_OUT = resolve(REPO_ROOT, "public", "models");

function findBlender() {
  if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const bases = ["C:/Program Files/Blender Foundation", "C:/Program Files (x86)/Blender Foundation"];
  for (const base of bases) {
    for (const ver of ["4.5", "4.4", "4.3", "4.2", "4.1", "4.0"]) {
      const p = `${base}/Blender ${ver}/blender.exe`;
      if (existsSync(p)) return p;
    }
  }
  return "blender"; // hope it's on PATH
}

// meshopt-compress + downscale baked textures on the converted GLBs. Optional: if
// @gltf-transform/* + meshoptimizer aren't installed, log and skip (conversion still ok).
async function compressGlbs(absPaths) {
  let core, extensions, functions, meshopt;
  try {
    core = await import("@gltf-transform/core");
    extensions = await import("@gltf-transform/extensions");
    functions = await import("@gltf-transform/functions");
    meshopt = await import("meshoptimizer");
  } catch {
    console.warn("\n[compress] @gltf-transform / meshoptimizer not installed — skipping GLB compression.");
    console.warn("[compress] install with: npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer");
    return;
  }
  const { MeshoptEncoder, MeshoptDecoder } = meshopt;
  await MeshoptEncoder.ready;
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.warn("[compress] sharp not installed — normal-map Z fix skipped.");
  }
  const io = new core.NodeIO()
    .registerExtensions(extensions.ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

  // Reconstruct each normal map's Z (B = sqrt(1-x²-y²)) — the dump's PNGs pack non-Z data
  // in blue (BC5 two-channel normals), which renders as crusty relief. Head skins
  // additionally get hot pore-noise low-passed + amplitude-damped IN-texture (the runtime
  // normalScale can't fix them: it scales XY against the baked near-zero Z).
  async function fixNormalMaps(doc) {
    if (!sharp) return;
    const headTex = new Set();
    for (const mat of doc.getRoot().listMaterials()) {
      const t = mat.getNormalTexture();
      // head skin + eyeballs: organic surfaces whose hot detail noise reads as crust /
      // streaky specular without the game's SSS and specular AA
      if (t && /_head$|eyebrows$|_eyes$/i.test(mat.getName())) headTex.add(t);
    }
    const seen = new Set();
    for (const mat of doc.getRoot().listMaterials()) {
      const tex = mat.getNormalTexture();
      if (!tex || seen.has(tex)) continue;
      seen.add(tex);
      const img = tex.getImage();
      if (!img) continue;
      const { data, info } = await sharp(Buffer.from(img))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      const count = info.width * info.height;
      const x = new Float32Array(count);
      const y = new Float32Array(count);
      let ampSum = 0;
      for (let i = 0; i < count; i++) {
        x[i] = data[i * ch] / 127.5 - 1;
        y[i] = data[i * ch + 1] / 127.5 - 1;
        ampSum += Math.hypot(x[i], y[i]);
      }
      const amp = ampSum / count;
      if (headTex.has(tex) && amp > 0.11) {
        // two 3x3 box passes on X/Y, then damp to the reference amplitude
        const w = info.width;
        const h = info.height;
        for (let pass = 0; pass < 2; pass++) {
          for (const arr of [x, y]) {
            const src = arr.slice();
            for (let yy = 1; yy < h - 1; yy++)
              for (let xx = 1; xx < w - 1; xx++) {
                const i = yy * w + xx;
                arr[i] =
                  (src[i - w - 1] + src[i - w] + src[i - w + 1] +
                    src[i - 1] + src[i] + src[i + 1] +
                    src[i + w - 1] + src[i + w] + src[i + w + 1]) / 9;
              }
          }
        }
        let s2 = 0;
        for (let i = 0; i < count; i++) s2 += Math.hypot(x[i], y[i]);
        const k = Math.min(1, 0.085 / Math.max(s2 / count, 1e-6));
        for (let i = 0; i < count; i++) {
          x[i] *= k;
          y[i] *= k;
        }
      }
      const out = Buffer.alloc(count * 3);
      for (let i = 0; i < count; i++) {
        const z = Math.sqrt(Math.max(0, 1 - x[i] * x[i] - y[i] * y[i]));
        out[i * 3] = Math.round((x[i] + 1) * 127.5);
        out[i * 3 + 1] = Math.round((y[i] + 1) * 127.5);
        out[i * 3 + 2] = Math.round((z + 1) * 127.5);
      }
      const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
        .png()
        .toBuffer();
      tex.setImage(png).setMimeType("image/png");
    }
  }

  console.log("\nCompressing GLBs (meshopt + texture downscale ≤1024) …");
  for (const abs of absPaths) {
    if (!existsSync(abs)) continue;
    const before = statSync(abs).size;
    try {
      const doc = await io.read(abs);
      // skip GLBs already compressed (only freshly-converted ones need it)
      if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "EXT_meshopt_compression")) continue;
      await fixNormalMaps(doc);
      // meshopt() handles its own cleanup; avoid dedup/prune which can strip the Skin a
      // skinned cosmetic needs for the rig's bone rebinding. textureCompress shrinks the
      // baked maps (≤1024, webp). Both preserve JOINTS_0/WEIGHTS_0.
      // level "medium" + 12-bit normals: "high" quantized normals to 8 bits, which faceted
      // smooth surfaces (visible as shading noise on dense face meshes).
      await doc.transform(
        functions.textureCompress({ targetFormat: "webp", resize: [1024, 1024] }),
        functions.meshopt({
          encoder: MeshoptEncoder,
          level: "medium",
          quantizePosition: 14,
          quantizeNormal: 12,
          quantizeTexcoord: 12,
        }),
      );
      await io.write(abs, doc);
      const after = statSync(abs).size;
      console.log(`  ${abs.slice(MODELS_OUT.length + 1)}  ${(before / 1024) | 0}→${(after / 1024) | 0} KB`);
    } catch (e) {
      console.warn(`  [compress] failed ${abs}: ${e?.message ?? e}`);
    }
  }
}

const blender = findBlender();
const addonsDir =
  process.env.BLENDER_ADDONS ??
  join(process.env.APPDATA ?? "", "Blender Foundation/Blender/4.5/scripts/addons");
const dumpRoot =
  process.env.FINALS_DUMP ??
  "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/Exports/Discovery/Content/Discovery/Characters";
const pyScript = resolve(SCRIPT_DIR, "convert-meshes.py");
const range = process.argv[2] && /^\d*:\d*$/.test(process.argv[2]) ? process.argv[2] : "";

if (!existsSync(join(addonsDir, "io_scene_ueformat"))) {
  console.error(`UEFormat addon not found in ${addonsDir}.`);
  console.error("Install it (copy io_scene_ueformat there) or set BLENDER_ADDONS.");
  process.exit(1);
}

// Same sources file the python script will use, so we know which GLBs to compress.
const generated = join(SCRIPT_DIR, "asset-sources.generated.json");
const sourcesFile = existsSync(generated) ? generated : join(SCRIPT_DIR, "asset-sources.json");
let assets = [];
try {
  assets = JSON.parse(readFileSync(sourcesFile, "utf8")).assets ?? [];
} catch {
  /* ignore — python re-reports */
}
if (range && range.includes(":")) {
  const [a, b] = range.split(":");
  assets = assets.slice(Number(a || 0), Number(b || assets.length));
}
// CONVERT_ONLY=substr[,substr] — re-convert only the matching pieces (matched on dst). Handy for
// rebuilding a few pieces (e.g. the multi-part companions) without a full-catalog re-convert. The
// python side reads the same env so it converts the same subset; here it scopes the compress list.
const onlyFilter = process.env.CONVERT_ONLY
  ? process.env.CONVERT_ONLY.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;
if (onlyFilter) assets = assets.filter((a) => onlyFilter.some((f) => a.dst.toLowerCase().includes(f)));

console.log(`Blender:  ${blender}`);
console.log(`Addons:   ${addonsDir}`);
console.log(`Dump:     ${dumpRoot}`);
console.log(`Sources:  ${sourcesFile.slice(SCRIPT_DIR.length + 1)}${range ? `  range=${range}` : ""}`);

// composite the eyeball texture heads need (idempotent; skips if eye textures are absent).
spawnSync(process.execPath, [resolve(SCRIPT_DIR, "build-eye-textures.mjs")], { stdio: "inherit" });

const pyArgs = ["--background", "--factory-startup", "--python", pyScript, "--", addonsDir, dumpRoot];
if (range) pyArgs.push(range);
const res = spawnSync(blender, pyArgs, { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);

await compressGlbs(assets.map((a) => resolve(MODELS_OUT, a.dst)));

// derive the per-piece MaterialID region maps used to color cosmetics objectively.
console.log("\nBuilding region maps …");
spawnSync(process.execPath, [resolve(SCRIPT_DIR, "build-regions.mjs")], { stdio: "inherit" });

// emit per-hair strand-coverage masks (alphaMap) the converter can't carry out of UEFormat.
console.log("\nBuilding hair coverage masks …");
spawnSync(process.execPath, [resolve(SCRIPT_DIR, "build-hair-coverage.mjs")], { stdio: "inherit" });
