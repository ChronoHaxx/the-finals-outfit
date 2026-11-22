// Build this checkout the way the deploy workflow does (its asset hosts, from .github/workflows/deploy.yml) with base
// "/", then serve it with `vite preview` at http://127.0.0.1:<port>/ (21 Nov 2026, for the integrated-GPU checks).
// Node sets the environment itself, so no shell rewrites VITE_BASE (Git Bash turns "/" into its install path).
// Usage, from the checkout root (any shell):  node _docs/igpu-perf-2026-11-21/serve-like-deploy.mjs [outDir] [port]
// Stop with Ctrl+C. The output folder is disposable (default: dist/like-deploy, ignored by git).
import { readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";

const [outDir = "dist/like-deploy", port = "5195"] = process.argv.slice(2);
const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const value = name => {
  const hit = workflow.match(new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, "m"));
  if (!hit) throw new Error(`${name} not found in deploy.yml`);
  return hit[1].replace(/^['"]|['"]$/g, "");
};
const env = { ...process.env, VITE_BASE: "/",
  VITE_ASSETS_BASE: value("ASSETS_BASE"), VITE_MODELS_BASE: value("MODELS_BASE"),
  VITE_RECONSTRUCTION_BASE: value("RECONSTRUCTION_BASE"), VITE_SHARE_PREVIEW_BASE: value("SHARE_PREVIEW_BASE"),
  VITE_ANIMATIONS_BASE: value("ANIMATIONS_BASE"), VITE_CHINALS_ANIMATIONS_BASE: value("CHINALS_ANIMATIONS_BASE"),
  VITE_RECONSTRUCTION_ROUTES_FILE: value("RECONSTRUCTION_ROUTES_FILE") };
const vite = path.join("node_modules", "vite", "bin", "vite.js");
const build = spawnSync(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir"], { env, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
console.log(`\nServing ${outDir} at http://127.0.0.1:${port}/ (Ctrl+C stops)`);
spawn(process.execPath, [vite, "preview", "--outDir", outDir, "--port", port, "--strictPort", "--host", "127.0.0.1"], { env, stdio: "inherit" });
