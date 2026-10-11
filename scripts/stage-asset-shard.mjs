// No deployment API. Stages one dependency-closed package from an immutable local plan.
// node scripts/stage-asset-shard.mjs PLAN 1 [--dry-run] [--hosts HOSTS.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, validateShardPlan, shardHosts, stagedControlBytes, routesForShards } from './lib/asset-shards.mjs';
import { compactReconstructionRoutes } from '../src/lib/asset-routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), planPath = args.shift(), selected = args.shift();
if (!planPath || !/^\d+$/.test(selected ?? '')) throw new Error('Usage: stage-asset-shard.mjs PLAN SHARD_ID [--dry-run] [--hosts HOSTS.json]');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); validateShardPlan(plan);
const shard = plan.shards[Number(selected)];
if (!shard || shard.id !== Number(selected)) throw new Error('Unknown shard');
let dryRun = false, hosts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--hosts' && args[i + 1]) hosts = shardHosts(plan, JSON.parse(fs.readFileSync(args[++i], 'utf8')));
  else throw new Error(`Unknown argument: ${args[i]}`);
}
const source = path.resolve(process.env.ASSET_SOURCE_DIR || path.join(root, 'public'));
const output = path.resolve(process.env.ASSET_SHARD_OUT || path.join(root, '_assets-upload', `${plan.version}-${shard.name}`));
if (!dryRun && fs.existsSync(output)) throw new Error(`Immutable staging directory exists: ${output}`);
const entries = {}, rewritten = {};
// Verify every file before any copying. Initial stale-plan failures leave no
// package; a source change during the second read aborts the new, partial folder.
for (const rel of shard.paths) {
  const bytes = fs.readFileSync(path.join(source, rel)), pin = plan.nodes[rel];
  if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256) throw new Error(`Asset changed since plan: ${rel}`);
  const staged = plan.controls.includes(rel) ? stagedControlBytes(plan, rel, bytes, hosts) : bytes;
  if (staged.length > plan.limits.maxFileBytes) throw new Error(`Rewritten index exceeds file-size limit: ${rel}`);
  if (staged !== bytes) rewritten[rel] = staged;
  entries[rel] = { sha256: digest(staged), bytes: staged.length };
}
const manifest = { formatVersion: 2, version: plan.version, scope: 'reconstruction-shard', shard: shard.name,
  planSha256: digest(JSON.stringify(plan)), count: shard.paths.length, paths: shard.paths,
  reconstructionPaths: shard.paths, files: entries };
const generated = { 'manifest.json': Buffer.from(JSON.stringify(manifest)),
  '_headers': Buffer.from('/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n'),
  '404.html': Buffer.from('<!doctype html><title>Asset not found</title>Asset not found\n') };
for (const [name, bytes] of Object.entries(generated))
  if (bytes.length > plan.limits.maxFileBytes) throw new Error(`Generated ${name} exceeds the file-size limit`);
if (Object.keys(generated).length + shard.paths.length > plan.limits.maxFiles) throw new Error('Package exceeds file-count limit');
if (!dryRun) {
  fs.mkdirSync(output, { recursive: true });
  for (const rel of shard.paths) {
    const bytes = rewritten[rel] ?? fs.readFileSync(path.join(source, rel));
    if (digest(bytes) !== entries[rel].sha256) throw new Error(`Asset changed during staging: ${rel}`);
    const target = path.join(output, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
  }
  for (const [name, bytes] of Object.entries(generated)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
}
console.log(JSON.stringify({ dryRun, output: dryRun ? null : output, shard: shard.name,
  files: shard.paths.length + 3, bytes: Object.values(entries).reduce((sum, row) => sum + row.bytes, 0),
  rewrittenIndices: Object.keys(rewritten), manifestSha256: digest(generated['manifest.json']),
  ...(hosts[0] ? { VITE_RECONSTRUCTION_BASE: hosts[0], VITE_RECONSTRUCTION_ROUTES: JSON.stringify(compactReconstructionRoutes(routesForShards(plan, hosts))) } : {}) }, null, 2));
