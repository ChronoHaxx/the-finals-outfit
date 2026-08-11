import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// On GH Pages the site is served from /<repo>/ unless a custom domain is set.
// Override at build time via VITE_BASE (set in the deploy workflow).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE ?? "/",
    plugins: [react(), tailwindcss()],
    // Expose the dev server on the LAN so a phone on the same network can reach it.
    server: { host: true },
  };
});
