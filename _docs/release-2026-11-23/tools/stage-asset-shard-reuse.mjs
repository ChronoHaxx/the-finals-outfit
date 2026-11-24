// (23 Nov 2026 release.) scripts/stage-asset-shard.mjs with one addition, --reuse DIR (repeatable): a file whose row
// in a previously staged shard folder's manifest pins the SAME source (sha256 + bytes, or sourceSha256 + sourceBytes
// for a gzip mesh) and the same encoding is hard-linked from that folder instead of being re-read and re-encoded. Gzip
// is deterministic (level 9), so the staged bytes are identical to a fresh encode; the manifest row is reused verbatim.
// Control indexes are never reused (they are rewritten with this release's leaf hosts). Everything else, including the
// manifest layout, _headers and 404.html, is byte-for-byte what stage-asset-shard.mjs writes.
// Why: on 23 Nov the shared E: drive delivered ~7 MB/s under other sessions' load, and a plain restage reads the 16 GB
// source twice and writes it once. Only the new/changed files need encoding.
//   node stage-asset-shard-reuse.mjs RELEASE_WORKTREE PLAN SHARD_ID --gzip-meshes [--hosts HOSTS.json] --reuse DIR...
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2), worktree = args.shift(), planPath = args.shift(), selected = args.shift();
if (!worktree || !planPath || !/^\d+$/.test(selected ?? '')) throw new Error('Usage: stage-asset-shard-reuse.mjs RELEASE_WORKTREE PLAN SHARD_ID [--gzip-meshes] [--hosts HOSTS.json] [--reuse DIR]...');
const imp = rel => import(pathToFileURL(path.join(worktree, rel)).href);
const { digest, validateShardPlan, shardHosts, stagedControlBytes, routesForShards } = await imp('scripts/lib/asset-shards.mjs');
const { compactReconstructionRoutes } = await imp('src/lib/asset-routing.mjs');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); validateShardPlan(plan);
const shard = plan.shards[Number(selected)];
if (!shard || shard.id !== Number(selected)) throw new Error('Unknown shard');
let hosts = {}, gzipMeshes = false; const reuseDirs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--gzip-meshes') gzipMeshes = true;
  else if (args[i] === '--hosts' && args[i + 1]) hosts = shardHosts(plan, JSON.parse(fs.readFileSync(args[++i], 'utf8')));
  else if (args[i] === '--reuse' && args[i + 1]) reuseDirs.push(path.resolve(args[++i]));
  else throw new Error(`Unknown argument: ${args[i]}`);
}
const source = path.resolve(process.env.ASSET_SOURCE_DIR || path.join(worktree, 'public'));
const output = path.resolve(process.env.ASSET_SHARD_OUT || path.join(worktree, '_assets-upload', `${plan.version}-${shard.name}`));
if (fs.existsSync(output)) throw new Error(`Immutable staging directory exists: ${output}`);
const gzipped = rel => gzipMeshes && rel.endsWith('.glb') && !plan.controls.includes(rel);
const encode = (rel, bytes) => gzipped(rel) ? zlib.gzipSync(bytes, { level: 9 }) : bytes;

// Previous staged rows by path: the first folder that pins this release's source for the path wins.
const previous = reuseDirs.map(dir => ({ dir, files: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).files }));
const reusable = rel => {
  if (plan.controls.includes(rel)) return null;
  const pin = plan.nodes[rel];
  for (const { dir, files } of previous) {
    const row = files[rel]; if (!row) continue;
    const src = row.encoding === 'gzip' ? { sha256: row.sourceSha256, bytes: row.sourceBytes } : row;
    if ((row.encoding === 'gzip') !== gzipped(rel) || src.sha256 !== pin.sha256 || src.bytes !== pin.bytes) continue;
    const file = path.join(dir, rel);
    if (!fs.existsSync(file) || fs.statSync(file).size !== row.bytes) continue;
    return { file, row };
  }
  return null;
};

const entries = {}, rewritten = {}, reused = {}, fresh = [];
for (const rel of shard.paths) {
  const hit = reusable(rel);
  if (hit) { reused[rel] = hit.file; entries[rel] = hit.row; continue; }
  const bytes = fs.readFileSync(path.join(source, rel)), pin = plan.nodes[rel];
  if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256) throw new Error(`Asset changed since plan: ${rel}`);
  const staged = plan.controls.includes(rel) ? stagedControlBytes(plan, rel, bytes, hosts) : encode(rel, bytes);
  if (staged.length > plan.limits.maxFileBytes) throw new Error(`Rewritten index exceeds file-size limit: ${rel}`);
  rewritten[rel] = staged; fresh.push(rel);
  entries[rel] = gzipped(rel)
    ? { sha256: digest(staged), bytes: staged.length, encoding: 'gzip', sourceSha256: pin.sha256, sourceBytes: pin.bytes }
    : { sha256: digest(staged), bytes: staged.length };
}
const manifest = { formatVersion: 2, version: plan.version, scope: 'reconstruction-shard', shard: shard.name,
  planSha256: digest(JSON.stringify(plan)), count: shard.paths.length, paths: shard.paths,
  reconstructionPaths: shard.paths, ...(gzipMeshes ? { meshEncoding: 'gzip' } : {}), files: entries };
const generated = { 'manifest.json': Buffer.from(JSON.stringify(manifest)),
  '_headers': Buffer.from('/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n'),
  '404.html': Buffer.from('<!doctype html><title>Asset not found</title>Asset not found\n') };
for (const [name, bytes] of Object.entries(generated))
  if (bytes.length > plan.limits.maxFileBytes) throw new Error(`Generated ${name} exceeds the file-size limit`);
if (Object.keys(generated).length + shard.paths.length > plan.limits.maxFiles) throw new Error('Package exceeds file-count limit');
fs.mkdirSync(output, { recursive: true });
let linked = 0;
for (const rel of shard.paths) {
  const target = path.join(output, rel); fs.mkdirSync(path.dirname(target), { recursive: true });
  if (reused[rel]) { fs.linkSync(reused[rel], target); linked++; }
  else fs.writeFileSync(target, rewritten[rel], { flag: 'wx' });
}
for (const [name, bytes] of Object.entries(generated)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
const controlRewritten = Object.keys(rewritten).filter(rel => plan.controls.includes(rel));
console.log(JSON.stringify({ dryRun: false, output, shard: shard.name,
  files: shard.paths.length + 3, bytes: Object.values(entries).reduce((sum, row) => sum + row.bytes, 0),
  rewrittenIndices: controlRewritten, manifestSha256: digest(generated['manifest.json']),
  linkedFromPrevious: linked, encodedFresh: fresh.length, fresh,
  ...(hosts[0] ? { VITE_RECONSTRUCTION_BASE: hosts[0], VITE_RECONSTRUCTION_ROUTES: JSON.stringify(compactReconstructionRoutes(routesForShards(plan, hosts))) } : {}) }, null, 2));
