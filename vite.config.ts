import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEVELOPER_CATALOG_PATH } from "./src/lib/catalog-mode";

// On GH Pages the site is served from /<repo>/ unless a custom domain is set.
// Override at build time via VITE_BASE (set in the deploy workflow).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE ?? "/",
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
