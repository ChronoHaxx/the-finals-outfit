// Dev server for this worktree's app against the root checkout's public/ assets (body-type review, 6 Nov 2026).
//
//   node scripts/body-types/serve-preview.mjs --port 5191                     # live index, this worktree's code
//   node scripts/body-types/serve-preview.mjs --port 5192 --preview <dir>     # Season 12 preview index
//
// --preview <dir> answers three paths from <dir>; every other file is the root public/ unchanged:
// - the active index (models/reconstructed-assemblies-v1/assets.json) with <dir>/assets.json;
// - its skin-pairs.json with <dir>/skin-pairs.json;
// - the source body (models/reconstructed-meshes-v2/SK_Body_M.glb) with <dir>/meshes/SK_Body_M.glb.
//
// Safety for the main session, whose dev server on 5174 and index merges share public/:
// - No config bundling to disk and a cache directory outside node_modules. node_modules here is a junction to the
//   release worktree's and must never be written to.
// - JSON under /models/ and /src/data/ is read whole into memory before the response starts. A streamed read held open
//   by a closed page blocks additive-merge's os.replace of the active index on Windows
//   (_docs/claude-autonomous-2026-09-25/serve-5174.mjs, 12 Oct 2026).
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(option("--port"));
if (!Number.isInteger(port) || port === 5174) throw new Error("--port is required and must not be 5174 (the main session's)");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.resolve(root, "../../../public");
if (!existsSync(path.join(publicDir, "models/reconstructed-assemblies-v1/assets.json")))
  throw new Error(`Not the root checkout's public/: ${publicDir}`);
const previewDir = option("--preview") ? path.resolve(option("--preview")) : undefined;
// --index <dir>: the preview index files when they live apart from the rebuilt meshes (default: --preview itself).
const indexDir = option("--index") ? path.resolve(option("--index")) : previewDir;
// --live-body keeps the preserved live body (a garments-only merge candidate, apply-merge-patch.py --garments-only).
const liveBody = args.includes("--live-body");
const previewRoutes = previewDir ? new Map([
  ["/models/reconstructed-assemblies-v1/assets.json", path.join(indexDir, "assets.json")],
  // Faces load their head mesh through skin-pairs.json (rewrite-skin-pairs.py), not assets.json.
  ["/models/reconstructed-assemblies-v1/skin-pairs.json", path.join(indexDir, "skin-pairs.json")],
  ...(liveBody ? [] : [["/models/reconstructed-meshes-v2/SK_Body_M.glb", path.join(previewDir, "meshes/SK_Body_M.glb")]]),
]) : new Map();
for (const file of previewRoutes.values()) if (!existsSync(file)) throw new Error(`Missing preview file ${file}`);

const inMemory = [["/models/", publicDir], ["/src/data/", root]];
const types = { ".json": "application/json", ".glb": "model/gltf-binary" };
const servePlugin = {
  name: "body-type-preview-serving",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const [pathname, query = ""] = (req.url ?? "").split("?");
      if ((req.method !== "GET" && req.method !== "HEAD") || /(^|&)import(=|&|$)/.test(query)) return next();
      let file = previewRoutes.get(pathname);
      if (!file) {
        const base = inMemory.find(([prefix]) => pathname.startsWith(prefix))?.[1];
        if (!base || !pathname.endsWith(".json")) return next();
        try { file = path.join(base, decodeURIComponent(pathname)); } catch { return next(); }
        if (!file.startsWith(base + path.sep)) return next();
      }
      let body;
      try { body = await readFile(file); } catch { return next(); }
      res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Content-Length", body.length);
      res.end(req.method === "HEAD" ? undefined : body);
    });
  },
};

// The project's own vite.config.ts (catalog virtual module, routes define, React, Tailwind) plus this server's
// middleware. configLoader "runner" evaluates the config in memory, where the default "bundle" loader would write a
// temporary file under node_modules/.vite-temp.
const server = await createServer({
  root, publicDir, configFile: path.join(root, "vite.config.ts"), configLoader: "runner",
  cacheDir: path.join(os.tmpdir(), `finals-body-type-vite-${port}`),
  plugins: [servePlugin],
  server: { port, strictPort: true, host: "127.0.0.1",
    // node_modules is a junction, so Vite sees package files (the UI font) at the release worktree's real path.
    fs: { allow: [root, realpathSync(path.join(root, "node_modules"))] },
    // Vite full-reloads the page on any watched change, even a .py edit (6 Nov 2026: it killed a capture run mid-shot).
    watch: { ignored: ["**/_docs/**", "**/scripts/generated/**", "**/scripts/body-types/**", "**/*.py"] } },
});
await server.listen();
server.printUrls();
console.log(previewDir ? `Season 12 preview: ${previewDir}` : "Live index");
