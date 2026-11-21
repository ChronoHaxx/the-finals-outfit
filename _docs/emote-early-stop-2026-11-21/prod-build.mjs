// Production build for the early-stop checks (21 Nov 2026): the app built with deploy.yml's production settings
// (asset hosts read from its env block), into scripts/generated/emote-early-stop-2026-11-21/prod/dist (gitignored).
// early-stop-probe.mjs serves it at /the-finals-outfit/ when APP_URL is unset.
//   node _docs/emote-early-stop-2026-11-21/prod-build.mjs      (Git Bash or PowerShell, worktree root)
import { build } from "vite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const deploy = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const env = name => {
  const value = deploy.match(new RegExp(`^\\s+${name}: (\\S+)\\s*$`, "m"))?.[1];
  if (!value) throw new Error(`deploy.yml has no ${name}`);
  return value;
};
Object.assign(process.env, {
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: env("ASSETS_BASE"),
  VITE_MODELS_BASE: env("MODELS_BASE"),
  VITE_RECONSTRUCTION_BASE: env("RECONSTRUCTION_BASE"),
  VITE_SHARE_PREVIEW_BASE: env("SHARE_PREVIEW_BASE"),
  VITE_ANIMATIONS_BASE: env("ANIMATIONS_BASE"),
  VITE_CHINALS_ANIMATIONS_BASE: env("CHINALS_ANIMATIONS_BASE"),
  VITE_RECONSTRUCTION_ROUTES_FILE: env("RECONSTRUCTION_ROUTES_FILE"),
});
const scratch = path.join(root, "scripts/generated/emote-early-stop-2026-11-21/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public");
if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // our own scratch build output only
mkdirSync(publicDir, { recursive: true });
copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg")); // what CI's public/ holds
await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
  build: { outDir, emptyOutDir: true } });
console.log(`built ${outDir} (animations ${process.env.VITE_ANIMATIONS_BASE})`);
