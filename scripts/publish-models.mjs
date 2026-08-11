// publish-models.mjs — host the converted 3D assets off-repo so the main repo stays
// small as mesh coverage grows. Copies public/models/** into a throwaway git repo and
// force-pushes it to an orphan-style `assets` branch of `origin`; jsDelivr then serves it
// (path-preserving + CDN). Set the printed URL as VITE_MODELS_BASE for production builds.
//
// Usage: node scripts/publish-models.mjs [branch]   (default branch: assets)
// Requires: a git `origin` remote you can push to, and public/models populated by
// `npm run convert:meshes`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, cpSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(REPO, "public", "models");
const BRANCH = process.argv[2] || "assets";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

if (!existsSync(MODELS) || readdirSync(MODELS).length === 0) {
  console.error(`No assets in ${MODELS} — run \`npm run convert:meshes\` first.`);
  process.exit(1);
}

let originUrl;
try {
  originUrl = git(["remote", "get-url", "origin"], REPO);
} catch {
  console.error("No `origin` remote found. Add one (git remote add origin <url>) and retry.");
  process.exit(1);
}

// Parse owner/repo from the origin URL for the jsDelivr base.
const m = originUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
const slug = m ? `${m[1]}/${m[2]}` : null;

const tmp = mkdtempSync(join(tmpdir(), "finals-models-"));
try {
  cpSync(MODELS, join(tmp, "models"), { recursive: true });
  git(["init", "-q"], tmp);
  git(["checkout", "-q", "-b", BRANCH], tmp);
  git(["add", "-A"], tmp);
  git(["-c", "user.name=models-bot", "-c", "user.email=models@local", "commit", "-q", "-m", `publish models ${new Date().toISOString()}`], tmp);
  git(["remote", "add", "origin", originUrl], tmp);
  console.log(`Force-pushing public/models -> origin/${BRANCH} …`);
  git(["push", "-q", "-f", "origin", BRANCH], tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("\nDone. Set VITE_MODELS_BASE to one of:");
if (slug) {
  console.log(`  jsDelivr (CDN, recommended):  https://cdn.jsdelivr.net/gh/${slug}@${BRANCH}/`);
  console.log(`  raw GitHub (no CDN):          https://raw.githubusercontent.com/${slug}/${BRANCH}/`);
  console.log(`\ne.g.  VITE_MODELS_BASE=https://cdn.jsdelivr.net/gh/${slug}@${BRANCH}/ npm run build`);
  console.log("(jsDelivr caches a mutable branch ~12h; push a tag and use @<tag> for immutable, instantly-purged URLs.)");
} else {
  console.log(`  (couldn't parse a GitHub slug from origin: ${originUrl})`);
}
