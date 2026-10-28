import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEVELOPER_CATALOG_PATH } from "./src/lib/catalog-mode";
import { parseReconstructionRoutes } from "./src/lib/asset-routing.mjs";

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
    plugins: [react(), tailwindcss(), {
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
