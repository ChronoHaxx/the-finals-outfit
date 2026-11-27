// (23 Nov 2026 release.) Pre-upload check of a staged shard folder that stage-asset-shard-reuse.mjs built, without
// reading all 16 GB on a loaded disk:
// 1. membership: the folder holds exactly the plan's paths plus manifest.json, _headers, 404.html; the manifest's
//    paths equal the plan's and every row's size equals the file's size (metadata only);
// 2. every freshly encoded file and SAMPLE random linked files: staged sha256 = manifest row; a gzip row gunzips to the
//    plan's source sha256; and for the linked sample, a fresh level-9 gzip of the SOURCE equals the staged bytes.
//   node verify-staged-sample.mjs RELEASE_WORKTREE PLAN STAGE_RESULT.json SAMPLE REPORT.json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
const [worktree, planPath, resultPath, sampleArg, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Usage: verify-staged-sample.mjs RELEASE_WORKTREE PLAN STAGE_RESULT.json SAMPLE REPORT.json');
if (fs.existsSync(reportPath)) throw new Error(`Preserve ${reportPath}`);
const { digest, validateShardPlan } = await import(pathToFileURL(path.join(worktree, 'scripts/lib/asset-shards.mjs')).href);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); validateShardPlan(plan);
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const shard = plan.shards.find(s => s.name === result.shard), dir = result.output;
const source = path.resolve(process.env.ASSET_SOURCE_DIR || path.join(worktree, 'public'));
const manifestBytes = fs.readFileSync(path.join(dir, 'manifest.json')), manifest = JSON.parse(manifestBytes);
if (digest(manifestBytes) !== result.manifestSha256) throw new Error('manifest.json differs from the staging result');
if (manifest.planSha256 !== digest(JSON.stringify(plan)) || JSON.stringify(manifest.paths) !== JSON.stringify(shard.paths))
  throw new Error('manifest membership differs from plan');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(dir).map(f => path.relative(dir, f).split(path.sep).join('/')).sort();
const expected = [...shard.paths, 'manifest.json', '_headers', '404.html'].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('folder contents differ from plan');
let sizeMismatch = 0;
for (const rel of shard.paths) if (fs.statSync(path.join(dir, rel)).size !== manifest.files[rel].bytes) sizeMismatch++;
if (sizeMismatch) throw new Error(`${sizeMismatch} staged sizes differ from manifest rows`);
const fresh = new Set(result.fresh ?? []);
const linked = shard.paths.filter(p => !fresh.has(p));
const n = Number(sampleArg), sample = [];
for (let i = 0; i < n && linked.length; i++) sample.push(linked.splice(Math.floor(Math.random() * linked.length), 1)[0]);
const rows = [];
const check = (rel, kind) => {
  const bytes = fs.readFileSync(path.join(dir, rel)), row = manifest.files[rel], out = { path: rel, kind, encoding: row.encoding ?? null };
  if (digest(bytes) !== row.sha256 || bytes.length !== row.bytes) throw new Error(`staged bytes differ from row: ${rel}`);
  if (row.encoding === 'gzip' && digest(zlib.gunzipSync(bytes)) !== plan.nodes[rel].sha256) throw new Error(`gunzip differs from plan: ${rel}`);
  if (row.encoding !== 'gzip' && !plan.controls.includes(rel) && digest(bytes) !== plan.nodes[rel].sha256) throw new Error(`bytes differ from plan: ${rel}`);
  if (kind === 'linked') {
    const src = fs.readFileSync(path.join(source, rel));
    const again = row.encoding === 'gzip' ? zlib.gzipSync(src, { level: 9 }) : src;
    if (digest(again) !== row.sha256) throw new Error(`fresh encode of source differs from linked file: ${rel}`);
    out.freshEncodeMatches = true;
  }
  rows.push({ ...out, ok: true });
};
for (const rel of fresh) check(rel, 'fresh');
for (const rel of sample) check(rel, 'linked');
const report = { shard: shard.name, dir, checkedAt: new Date().toISOString(), files: files.length, sizesChecked: shard.paths.length,
  fresh: fresh.size, linkedSampled: sample.length, gzipRows: Object.values(manifest.files).filter(r => r.encoding === 'gzip').length,
  headers: fs.readFileSync(path.join(dir, '_headers'), 'utf8'), rows };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const { rows: _rows, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
