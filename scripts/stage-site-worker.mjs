#!/usr/bin/env node
// Stages workers/site/public for the site Worker: the app build at the root and every mesh production serves, under m/.
//
//   node scripts/stage-site-worker.mjs --build --sitekey <turnstile site key> \
//     --source https://a029b249.the-finals-outfit-assets.pages.dev/=<folder uploaded to that host> \
//     --source https://29ae13de.the-finals-outfit-assets.pages.dev/=<folder> ...
//
// Each --source pairs a production asset host with the local folder that was uploaded to it (same layout: models/...).
// Every mesh in that folder is staged as m/<host label>/<path>, the address the app maps that host's mesh URLs to
// (gatedMeshPath), so the gate serves exactly the bytes each public host serves today. Every model host production
// uses (deploy.yml's hosts and routes file) needs a --source, and every catalog mesh must resolve to a staged file.
//
// --build runs the app build with deploy.yml's production settings plus VITE_BASE=/, VITE_MESH_BASE=/m/ and the
// Turnstile site key; without it, --app names an existing build. Every catalog mesh must be staged (--allow-missing
// only for local trials). No manifest or file list is written into the upload: the gate must not publish an index.
//
// Meshes are staged into the unlisted folder _<MESH_STORE>/<host label>/<path>, never at m/ (workers/site/src/gate.ts).
// MESH_STORE is a secret read from --secrets (default workers/site/.secrets.production.env; use .dev.vars locally).
// If the file has none, a random one is appended to it. The name is never printed or written into the upload.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAssetRefs } from "./lib/asset-refs.mjs";
import { gatedMeshPath, isMeshPath, modelUrlFor, parseReconstructionRoutes } from "../src/lib/asset-routing.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "# staged by scripts/stage-site-worker.mjs";
const MAX_FILES = 20_000, MAX_BYTES = 25 * 1024 * 1024; // Workers Free static assets (Nov 2026)

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const value = (name, fallback) => values(name).at(-1) ?? fallback;
if (flag("--help") || !values("--source").length) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).join("\n"));
  process.exit(values("--source").length ? 0 : 1);
}

const normalize = (base) => base.trim().replace(/\/*$/, "/");
const workflow = readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8");
const envFromWorkflow = (name) => workflow.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "m"))?.[1] ?? "";
const production = {
  ASSETS_BASE: envFromWorkflow("ASSETS_BASE"), MODELS_BASE: envFromWorkflow("MODELS_BASE"),
  RECONSTRUCTION_BASE: envFromWorkflow("RECONSTRUCTION_BASE"), RECONSTRUCTION_ROUTES_FILE: envFromWorkflow("RECONSTRUCTION_ROUTES_FILE"),
  SHARE_PREVIEW_BASE: envFromWorkflow("SHARE_PREVIEW_BASE"),
};
if (!production.ASSETS_BASE) throw new Error("deploy.yml has no ASSETS_BASE");
// Every VITE_* setting deploy.yml's Build step passes as `${{ env.NAME }}`, resolved from the job's env block. The gated
// build must get all of them, or it silently loses a feature. A fixed list here once dropped VITE_ANIMATIONS_BASE: no
// idle pose, no emotes. The first step wins: the preview step maps the same names.
const viteFromWorkflow = {};
for (const [, key, name] of workflow.matchAll(/^\s*(VITE_\w+):\s*\$\{\{\s*env\.(\w+)\s*\}\}\s*$/gm))
  if (!(key in viteFromWorkflow)) viteFromWorkflow[key] = envFromWorkflow(name);
// A VITE_* line in another form would be dropped; stop instead (VITE_BASE is replaced below).
const unmapped = [...new Set([...workflow.matchAll(/^\s*(VITE_\w+):/gm)].map(m => m[1]))]
  .filter(key => key !== "VITE_BASE" && !(key in viteFromWorkflow));
if (unmapped.length) throw new Error(`deploy.yml sets ${unmapped.join(", ")} in a form this script cannot copy; update it`);
const bases = {
  assetsBase: production.ASSETS_BASE, modelsBase: production.MODELS_BASE, reconstructionBase: production.RECONSTRUCTION_BASE,
  reconstructionRoutes: production.RECONSTRUCTION_ROUTES_FILE
    ? parseReconstructionRoutes(readFileSync(join(ROOT, production.RECONSTRUCTION_ROUTES_FILE), "utf8")) : {},
};

// 1. The app build.
let appDir = resolve(value("--app", join(ROOT, "dist")));
if (flag("--build")) {
  // Default: the production widget's public site key, kept beside the Worker in wrangler.jsonc (full-line comments only).
  const configured = () => {
    const text = readFileSync(join(ROOT, "workers/site/wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(text).vars?.TURNSTILE_SITEKEY ?? "";
  };
  const sitekey = value("--sitekey", process.env.VITE_TURNSTILE_SITEKEY || configured());
  if (!sitekey) throw new Error("--build needs --sitekey (or VITE_TURNSTILE_SITEKEY)");
  const env = { ...process.env, ...viteFromWorkflow, VITE_BASE: "/", VITE_MESH_BASE: "/m/", VITE_TURNSTILE_SITEKEY: sitekey,
    VITE_SHARE_PREVIEW_BASE: value("--share-preview-base", viteFromWorkflow.VITE_SHARE_PREVIEW_BASE ?? "") };
  const built = spawnSync("npm", ["run", "build"], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
  if (built.status !== 0) throw new Error("app build failed");
  appDir = join(ROOT, "dist");
}
if (!existsSync(join(appDir, "index.html"))) throw new Error(`no app build at ${appDir}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out); else if (entry.isFile()) out.push(path);
  }
  return out;
}
const posix = (path) => path.split(sep).join("/");
const appFiles = walk(appDir).map(f => posix(relative(appDir, f)));
const leaks = appFiles.filter(f => /\.map$/.test(f) || /(^|\/)manifest\.json$/.test(f) || f.startsWith("m/") || f.startsWith("_"));
if (leaks.length) throw new Error(`the app build must not contain source maps, manifests, an m/ folder or a top-level _ entry: ${leaks.slice(0, 5).join(", ")}`);
const bundle = appFiles.filter(f => f.endsWith(".js")).map(f => readFileSync(join(appDir, f), "utf8")).join("\n");
// Vite inlines import.meta.env.VITE_MESH_BASE as a string literal next to the gate client's Turnstile action.
if (!/"\/m\/"/.test(bundle) || !bundle.includes('"mesh-session"'))
  console.warn("WARNING: this build does not route meshes to /m/ (VITE_MESH_BASE); it will keep loading them from public hosts.");
// Every production host deploy.yml builds in must be in this bundle too (a build that dropped one loses that feature).
const absent = Object.entries(viteFromWorkflow)
  .filter(([key, url]) => /^https:\/\//.test(url) && !(key === "VITE_SHARE_PREVIEW_BASE" && flag("--share-preview-base"))
    && !bundle.includes(new URL(url).host))
  .map(([key, url]) => `${key}=${url}`);
if (absent.length) {
  const message = `the app build is missing production settings: ${absent.join(", ")}`;
  if (flag("--build")) throw new Error(message);
  console.warn(`WARNING: ${message}`);
}

// 2. Every mesh of every production model host, under its host label.
const sources = new Map(values("--source").map(spec => {
  const at = spec.lastIndexOf("=");
  if (at < 0) throw new Error(`--source needs <host>=<folder>: ${spec}`);
  const folder = resolve(spec.slice(at + 1));
  if (!existsSync(folder)) throw new Error(`no folder ${folder}`);
  return [normalize(spec.slice(0, at)), folder];
}));
const modelHosts = new Set([bases.modelsBase, bases.reconstructionBase, ...Object.values(bases.reconstructionRoutes)]
  .filter(Boolean).map(normalize));
const unsourced = [...modelHosts].filter(h => !sources.has(h));
const meshes = new Map(); // "<label>/<path>" -> absolute file
for (const [host, folder] of sources) {
  const label = gatedMeshPath(`${host}x.glb`)?.split("/")[0];
  if (!label) throw new Error(`--source host must be an https URL: ${host}`);
  for (const file of walk(folder)) {
    const path = posix(relative(folder, file));
    if (isMeshPath(path)) meshes.set(`${label}/${path}`, file);
  }
}
const catalog = JSON.parse(readFileSync(join(ROOT, "src/data/items.json"), "utf8"));
const missing = [...collectAssetRefs(catalog)].filter(isMeshPath)
  .filter(p => !meshes.has(gatedMeshPath(modelUrlFor(p, bases)) ?? ""));
if (missing.length || unsourced.length) {
  if (unsourced.length) console.error(`no --source for production model host(s): ${unsourced.join(", ")}`);
  if (missing.length) console.error(`${missing.length} catalog meshes are not staged (e.g. ${missing.slice(0, 5).join(", ")})`);
  if (!flag("--allow-missing")) process.exit(1);
}

// The unlisted store folder's name, from the secrets file the deploy uploads (created there if absent).
const secretsFile = resolve(value("--secrets", join(ROOT, "workers/site/.secrets.production.env")));
if (!existsSync(secretsFile)) throw new Error(`no secrets file at ${secretsFile} (--secrets)`);
let store = readFileSync(secretsFile, "utf8").match(/^MESH_STORE=([0-9a-f]{32,64})\s*$/m)?.[1];
if (!store) {
  store = randomBytes(16).toString("hex");
  appendFileSync(secretsFile,
    `\n# Unlisted asset folder holding the meshes (stage-site-worker.mjs); keep it secret.\nMESH_STORE=${store}\n`);
  console.log(`added a new MESH_STORE to ${secretsFile}`);
}

// 3. Write the upload folder. Only a folder this script made is ever deleted.
const out = resolve(value("--out", join(ROOT, "workers/site/public")));
if (existsSync(out)) {
  const marker = join(out, ".assetsignore");
  if (readdirSync(out).length && !(existsSync(marker) && readFileSync(marker, "utf8").startsWith(MARKER)))
    throw new Error(`${out} exists and was not staged by this script; move it away first`);
  // Empty it rather than remove it: Windows refuses to delete a folder `wrangler dev` is watching (EBUSY).
  // The marker goes last, so an interrupted run still leaves the folder recognisably ours.
  for (const entry of readdirSync(out)) if (entry !== ".assetsignore") rmSync(join(out, entry), { recursive: true, force: true });
  rmSync(marker, { force: true });
}
let total = 0, largest = 0;
const place = (from, to) => {
  const size = statSync(from).size;
  if (size > MAX_BYTES) throw new Error(`${to} is ${size} bytes; Workers static assets allow ${MAX_BYTES}`);
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(from, join(out, to));
  total += size; largest = Math.max(largest, size);
};
for (const file of appFiles) place(join(appDir, file), file);
for (const [path, file] of meshes) place(file, `_${store}/${path}`);
const count = appFiles.length + meshes.size;
if (count > MAX_FILES) throw new Error(`${count} files; Workers Free allows ${MAX_FILES} per version`);
// wrangler reads .assetsignore and never uploads it; it doubles as this script's ownership marker.
writeFileSync(join(out, ".assetsignore"), `${MARKER}\n`);

const report = { stagedAt: new Date().toISOString(), out, appFiles: appFiles.length, meshes: meshes.size, files: count,
  megabytes: Math.round(total / 1e5) / 10, largestMegabytes: Math.round(largest / 1e5) / 10,
  missingCatalogMeshes: missing.length, unsourcedHosts: unsourced, sources: Object.fromEntries(sources) };
writeFileSync(join(dirname(out), "stage-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(report);
