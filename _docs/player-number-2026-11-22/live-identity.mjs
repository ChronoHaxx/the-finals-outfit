// Read-only (22 Nov 2026): node _docs/player-number-2026-11-22/live-identity.mjs, from the worktree root.
// Read-only: are the numbered programs the local census read byte-identical to what the live site serves today?
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { modelUrlFor, parseReconstructionRoutes } from "../../src/lib/asset-routing.mjs";
const root = process.cwd();
const deploy = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const host = n => new RegExp(String.raw`^\s+` + n + String.raw`:\s*(https://[^\s'"]+)`, "m").exec(deploy)[1];
const bases = { assetsBase: host("ASSETS_BASE"), modelsBase: host("MODELS_BASE"), reconstructionBase: host("RECONSTRUCTION_BASE"),
  reconstructionRoutes: parseReconstructionRoutes(readFileSync(path.join(root, "src/data/reconstruction-routes.json"), "utf8")) };
const sha = b => createHash("sha256").update(b).digest("hex");
const local = p => readFileSync(path.join(root, "public", p));
async function live(p, direct) {
  const url = direct ?? modelUrlFor(p, bases);
  const r = await fetch(url, { headers: { "User-Agent": "outfit-viewer-check" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return { url, bytes: Buffer.from(await r.arrayBuffer()) };
}
const indexPath = "models/reconstructed-assemblies-v1/assets.json";
const liveIndex = await live(indexPath);
const index = JSON.parse(liveIndex.bytes.toString("utf8"));
console.log(`index ${liveIndex.url} ${sha(liveIndex.bytes) === sha(local(indexPath)) ? "IDENTICAL" : "DIFFERS"} to local`);
const seen = new Set(); let numbered = 0, same = 0; const differ = [];
const queue = [];
const localIndex = JSON.parse(local(indexPath).toString("utf8"));
let pathMismatch = 0;
for (const [key, rel] of Object.entries(index.materials)) {
  if (typeof rel !== "string") continue;
  // The live index names each manifest by its shard URL; the path after the host is the local path.
  const liveUrl = /^https:/.test(rel) ? rel : null;
  const mp = liveUrl ? decodeURIComponent(new URL(liveUrl).pathname.slice(1))
    : path.posix.normalize(path.posix.join("models/reconstructed-assemblies-v1", rel));
  const localRel = localIndex.materials[key];
  if (typeof localRel !== "string" || path.posix.normalize(path.posix.join("models/reconstructed-assemblies-v1", localRel)) !== mp) pathMismatch++;
  if (seen.has(mp)) continue; seen.add(mp);
  let manifest; try { manifest = JSON.parse(local(mp).toString("utf8")); } catch { continue; }
  if (!(manifest.textures ?? []).some(t => /NumbersAtlas/i.test(typeof t === "string" ? t : t.source ?? ""))) continue;
  queue.push({ key, mp, sp: path.posix.join(path.posix.dirname(mp), manifest.shader),
    liveManifest: liveUrl, liveShader: liveUrl ? new URL(manifest.shader, liveUrl).href : null });
}
for (let i = 0; i < queue.length; i += 12) {
  await Promise.all(queue.slice(i, i + 12).map(async ({ key, mp, sp, liveManifest, liveShader }) => {
    numbered++;
    const [m, s] = await Promise.all([live(mp, liveManifest), live(sp, liveShader)]);
    if (sha(m.bytes) === sha(local(mp)) && sha(s.bytes) === sha(local(sp))) same++;
    else differ.push(`${key.split(".").pop()} ${sha(m.bytes) === sha(local(mp)) ? "" : "manifest"} ${sha(s.bytes) === sha(local(sp)) ? "" : "shader " + s.url}`);
  }));
}
console.log(`material keys whose live path differs from the local index: ${pathMismatch}`);
console.log(`numbered programs: ${numbered}; byte-identical live vs local (manifest + GLSL): ${same}`);
for (const d of differ) console.log(`DIFFERS: ${d}`);
