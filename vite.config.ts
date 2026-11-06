import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, normalizePath, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEVELOPER_CATALOG_PATH } from "./src/lib/catalog-mode";
import { CATALOG_FILES, shippedCatalogJson, type CatalogFileKey } from "./src/lib/catalog-files";
import { parseReconstructionRoutes } from "./src/lib/asset-routing.mjs";
import { loadRoadmap } from "./src/lib/roadmap";

const CATALOG_MODULE = "virtual:catalog-assets";
const ROADMAP_MODULE = "virtual:roadmap";

// The Roadmap page renders ROADMAP.md, parsed and checked here: the page has no copy that could
// drift, and a malformed roadmap, or one not re-read since the newest patch note or catalog update,
// fails the build (and shows Vite's error overlay in dev). See src/lib/roadmap.ts.
function roadmap(): Plugin {
  let path = "";
  return {
    name: "roadmap",
    configResolved(config) { path = normalizePath(resolve(config.root, "ROADMAP.md")); },
    resolveId: id => id === ROADMAP_MODULE ? `\0${ROADMAP_MODULE}` : undefined,
    load(id) {
      if (id !== `\0${ROADMAP_MODULE}`) return;
      this.addWatchFile(path);
      return `export const ROADMAP = ${JSON.stringify(loadRoadmap(readFileSync(path, "utf8")))};`;
    },
    handleHotUpdate({ file, server }) {
      if (normalizePath(file) !== path) return;
      const module = server.moduleGraph.getModuleById(`\0${ROADMAP_MODULE}`);
      if (!module) return;
      server.moduleGraph.invalidateModule(module);
      return [module];
    },
  };
}

// Ships the catalog JSON as separate content-hashed files instead of inside the entry
// chunk (src/lib/catalog-load.ts fetches them), and preloads them from index.html so they
// download in parallel with the JavaScript. What ships is defined in catalog-files.ts:
// validated, minified and cut down to the fields the app reads.
function catalogAssets(): Plugin {
  let command = "build", base = "/", root = process.cwd();
  const keys = Object.keys(CATALOG_FILES) as CatalogFileKey[];
  const sourcePaths = new Set(keys.map(key => CATALOG_FILES[key].path));
  const shipped = (key: CatalogFileKey) =>
    shippedCatalogJson(key, readFileSync(resolve(root, CATALOG_FILES[key].path), "utf8"));
  const devUrl = (key: CatalogFileKey) => `${base}__catalog/${key}.json`;
  return {
    name: "catalog-assets",
    configResolved(config) { ({ command, base, root } = config); },
    // Dev serves the same projection as a build, re-read on every request.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = keys.find(key => req.url?.split("?")[0] === devUrl(key));
        if (!key) return next();
        res.setHeader("content-type", "application/json");
        res.end(shipped(key));
      });
    },
    resolveId: id => id === CATALOG_MODULE ? `\0${CATALOG_MODULE}` : undefined,
    load(id) {
      if (id !== `\0${CATALOG_MODULE}`) return;
      const urls = keys.map(key => {
        if (command === "serve") return `${JSON.stringify(key)}: ${JSON.stringify(devUrl(key))}`;
        const { path } = CATALOG_FILES[key];
        this.addWatchFile(resolve(root, path));
        const ref = this.emitFile({ type: "asset", name: basename(path), originalFileName: path, source: shipped(key) });
        return `${JSON.stringify(key)}: import.meta.ROLLUP_FILE_URL_${ref}`;
      });
      return `export const CATALOG_URLS = { ${urls.join(", ")} };`;
    },
    transformIndexHtml: { order: "post", handler(_html, { bundle }) {
      if (!bundle) return;
      const assets = Object.values(bundle).filter(file => file.type === "asset"
        && file.originalFileNames.some(name => sourcePaths.has(name)));
      if (assets.length !== keys.length) throw new Error(`Expected ${keys.length} catalog assets, found ${assets.length}`);
      // `as="fetch"` with `crossorigin` matches fetch()'s default CORS request and
      // same-origin credentials; any mismatch and the browser downloads the file twice.
      return assets.map(file => ({ tag: "link", injectTo: "head" as const,
        attrs: { rel: "preload", href: base + file.fileName, as: "fetch", crossorigin: "" } }));
    } },
  };
}

// The reconstruction host map outgrew Windows' 32,767-character environment
// variable limit (87% release, 547 prefixes), so a release can name a committed
// routes file instead. It becomes the same VITE_RECONSTRUCTION_ROUTES string the
// app already reads; naming both is refused rather than guessing which one wins.
function reconstructionRoutesDefine(env: Record<string, string>) {
  const file = env.VITE_RECONSTRUCTION_ROUTES_FILE?.trim();
  if (!file) return {};
  if (env.VITE_RECONSTRUCTION_ROUTES?.trim())
    throw new Error("Set VITE_RECONSTRUCTION_ROUTES or VITE_RECONSTRUCTION_ROUTES_FILE, not both");
  // Relative to this project, like the validator's RECONSTRUCTION_ROUTES_FILE, not to the shell's directory.
  const routes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), "utf8").trim();
  parseReconstructionRoutes(routes); // refuse a malformed map at build time
  return { "import.meta.env.VITE_RECONSTRUCTION_ROUTES": JSON.stringify(routes) };
}

// On GH Pages the site is served from /<repo>/ unless a custom domain is set.
// Override at build time via VITE_BASE (set in the deploy workflow).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE ?? "/",
    define: reconstructionRoutesDefine(env),
    plugins: [react(), tailwindcss(), catalogAssets(), roadmap(), {
      name: "developer-catalog-entry",
      enforce: "post",
      generateBundle(_options, bundle) {
        const entry = bundle["index.html"];
        if (!entry || entry.type !== "asset" || typeof entry.source !== "string") throw new Error("Missing app HTML entry");
        this.emitFile({ type: "asset", fileName: `${DEVELOPER_CATALOG_PATH}/index.html`,
          source: entry.source.replace("<head>", '<head>\n    <meta name="robots" content="noindex, nofollow" />')
            .replace(/<title>.*?<\/title>/, '<title>Developer cosmetic catalog</title>') });
      },
    }],
    // Expose the dev server on the LAN so a phone on the same network can reach it.
    server: { host: true },
  };
});
