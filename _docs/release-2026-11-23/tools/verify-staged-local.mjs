// (12 Nov 2026 release.) Pre-upload check of STAGED shard folders, no network.
//   node verify-staged-local.mjs RELEASE_WORKTREE PLAN STAGED.json [REPORT.json]
// STAGED.json: { "planSha256": "...", "shards": { "<name>": { "dir": "<staged folder>", "baseUrl"?: "<real host>" } } }
// 1. Exhaustive: every staged file's bytes/sha256 equal its manifest row; the folder holds exactly the shard's paths plus
//    manifest.json, _headers and 404.html; the manifest's membership equals the plan.
// 2. The repo's own verifyShardRelease, with a fetcher that serves each shard's folder at a placeholder URL (or at its
//    real baseUrl when given, which shard 0's rewritten control indexes must name for its leaves).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [worktree, planPath, stagedPath, reportPath] = process.argv.slice(2);
if (!worktree || !planPath || !stagedPath) throw new Error('Usage: verify-staged-local.mjs RELEASE_WORKTREE PLAN STAGED.json [REPORT.json]');
if (reportPath && fs.existsSync(reportPath)) throw new Error(`Preserve ${reportPath}`);
const imp = rel => import(pathToFileURL(path.join(worktree, rel)).href);
const { digest, validateShardPlan } = await imp('scripts/lib/asset-shards.mjs');
const { verifyShardRelease } = await imp('scripts/lib/verify-shards.mjs');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); validateShardPlan(plan);
const staged = JSON.parse(fs.readFileSync(stagedPath, 'utf8'));
const planSha = digest(JSON.stringify(plan));
if (staged.planSha256 !== planSha) throw new Error(`STAGED.json planSha256 ${staged.planSha256} != plan ${planSha}`);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const exhaustive = [], config = { planSha256: planSha, shards: {} }, dirOf = {};
for (const [name, entry] of Object.entries(staged.shards)) {
  const shard = plan.shards.find(s => s.name === name); if (!shard) throw new Error(`Unknown shard ${name}`);
  const manifestBytes = fs.readFileSync(path.join(entry.dir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.planSha256 !== planSha || manifest.shard !== name || JSON.stringify(manifest.paths) !== JSON.stringify(shard.paths))
    throw new Error(`Staged manifest membership differs from plan: ${name}`);
  const files = walk(entry.dir).map(f => path.relative(entry.dir, f).split(path.sep).join('/')).sort();
  const expected = [...shard.paths, 'manifest.json', '_headers', '404.html'].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    const have = new Set(files), want = new Set(expected);
    throw new Error(`Folder contents differ: ${name} extra=${files.filter(f => !want.has(f)).slice(0, 5)} missing=${expected.filter(f => !have.has(f)).slice(0, 5)}`);
  }
  let bytes = 0, gzip = 0;
  for (const rel of shard.paths) {
    const b = fs.readFileSync(path.join(entry.dir, rel)), row = manifest.files[rel];
    if (b.length !== row.bytes || digest(b) !== row.sha256) throw new Error(`Staged bytes differ from manifest: ${name} ${rel}`);
    bytes += b.length; if (row.encoding === 'gzip') gzip++;
  }
  const base = entry.baseUrl ?? `https://local-${name}.invalid/`;
  dirOf[base] = entry.dir;
  config.shards[name] = { immutable: true, baseUrl: base, manifestSha256: digest(manifestBytes) };
  exhaustive.push({ shard: name, dir: entry.dir, files: files.length, payloadBytes: bytes, gzipMeshes: gzip,
    manifestSha256: digest(manifestBytes), headers: fs.readFileSync(path.join(entry.dir, '_headers'), 'utf8') });
}
const fetcher = async url => {
  const base = Object.keys(dirOf).find(b => url.startsWith(b));
  if (!base) return new Response('not staged', { status: 404 });
  const file = path.join(dirOf[base], decodeURIComponent(url.slice(base.length)));
  return fs.existsSync(file) ? new Response(fs.readFileSync(file), { status: 200 }) : new Response('missing', { status: 404 });
};
// verifyShardRelease requires every shard; when only leaves are staged, check them alone through a sub-plan view.
const names = Object.keys(staged.shards);
let verify;
if (names.length === plan.shards.length) verify = await verifyShardRelease(plan, config, fetcher);
else verify = { partial: names, note: 'Only these shards are staged; verifyShardRelease runs when all are staged.' };
const report = { planSha256: planSha, checkedAt: new Date().toISOString(), exhaustive, verifyShardRelease: verify };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
