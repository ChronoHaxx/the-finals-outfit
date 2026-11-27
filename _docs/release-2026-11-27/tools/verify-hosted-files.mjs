// (23 Nov 2026 release.) Download EVERY listed file from the host the runtime will use and check it:
// HTTP 200, Access-Control-Allow-Origin *, an immutable Cache-Control, and the bytes. A gzip-published mesh (manifest
// row encoding gzip, served without Content-Encoding) is gunzipped and compared with the plan's source sha256;
// anything else is compared directly (control indexes against their staged manifest row).
//   node verify-hosted-files.mjs RELEASE_WORKTREE PLAN HOSTS LIST.txt REPORT.json
// LIST.txt: one public-relative path per line (e.g. the diff-plans added + changed paths).
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const [worktree, planPath, hostsPath, listPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Usage: verify-hosted-files.mjs RELEASE_WORKTREE PLAN HOSTS LIST.txt REPORT.json');
if (fs.existsSync(reportPath)) throw new Error(`Preserve ${reportPath}`);
const imp = rel => import(pathToFileURL(path.join(worktree, rel)).href);
const { digest, validateShardPlan, shardHosts } = await imp('scripts/lib/asset-shards.mjs');
const { joinBase, parseReconstructionRoutes, compactReconstructionRoutes } = await imp('src/lib/asset-routing.mjs');
const { routesForShards } = await imp('scripts/lib/asset-shards.mjs');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); validateShardPlan(plan);
const config = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
const hosts = shardHosts(plan, config, { requireAll: true });
// The runtime's own route table: longest matching prefix wins, otherwise shard 0.
const routes = parseReconstructionRoutes(compactReconstructionRoutes(routesForShards(plan, hosts)));
const prefixes = Object.keys(routes).sort((a, b) => b.length - a.length);
// Paths outside models/reconstructed-*/ (s12-bodytype-refresh-v1, s12-refresh-tier2-v1) have no route: the control
// index names them by absolute URL on their owner's host (stagedControlBytes), or relative to shard 0.
const { isReconstructionPath } = await imp('src/lib/asset-routing.mjs');
const routedHost = rel => {
  if (!isReconstructionPath(rel)) return hosts[plan.owners[rel]];
  const p = prefixes.find(x => rel === x || (x.endsWith('/') && rel.startsWith(x)));
  return p ? routes[p] : hosts[0];
};
const manifests = {};
for (const shard of plan.shards) {
  const r = await fetch(joinBase(hosts[shard.id], 'manifest.json'));
  const bytes = Buffer.from(await r.arrayBuffer());
  if (digest(bytes) !== config.shards[shard.name].manifestSha256) throw new Error(`Hosted manifest differs: ${shard.name}`);
  manifests[hosts[shard.id]] = JSON.parse(bytes);
}
const list = fs.readFileSync(listPath, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const rows = [];
let failed = 0, done = 0;
const check = async rel => {
  const host = routedHost(rel), url = joinBase(host, rel), row = { path: rel, host };
  try {
    if (!plan.nodes[rel]) throw new Error('not in plan');
    const entry = manifests[host].files[rel];
    if (!entry) throw new Error('routed host manifest lacks the file');
    let r, err;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await fetch(url); break; } catch (e) { err = e; await new Promise(res => setTimeout(res, 2000)); }
    }
    if (!r) throw err;
    const bytes = Buffer.from(await r.arrayBuffer());
    Object.assign(row, { status: r.status, cors: r.headers.get('access-control-allow-origin'),
      cacheControl: r.headers.get('cache-control'), contentEncoding: r.headers.get('content-encoding'),
      bytes: bytes.length, encoding: entry.encoding ?? null });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (row.cors !== '*') throw new Error(`CORS ${row.cors}`);
    if (!/immutable/.test(row.cacheControl ?? '')) throw new Error(`Cache-Control ${row.cacheControl}`);
    if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('hosted bytes differ from manifest row');
    if (entry.encoding === 'gzip') {
      if (row.contentEncoding) throw new Error(`gzip mesh served with Content-Encoding ${row.contentEncoding}`);
      const source = gunzipSync(bytes);
      if (digest(source) !== plan.nodes[rel].sha256) throw new Error('gunzipped bytes differ from plan source');
      row.sourceSha256 = plan.nodes[rel].sha256;
    } else if (!plan.controls.includes(rel) && digest(bytes) !== plan.nodes[rel].sha256) throw new Error('bytes differ from plan source');
    row.ok = true;
  } catch (e) { row.ok = false; row.error = String(e?.message ?? e); failed++; }
  rows.push(row);
  if (++done % 25 === 0) console.log(`${done}/${list.length} checked, ${failed} failed`);
};
const queue = [...list];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await check(queue.shift()); }));
rows.sort((a, b) => a.path.localeCompare(b.path));
const report = { checkedAt: new Date().toISOString(), planSha256: config.planSha256, files: list.length, failed,
  gzipMeshes: rows.filter(r => r.encoding === 'gzip').length, hostsUsed: [...new Set(rows.map(r => r.host))].sort(), rows };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ files: list.length, failed, gzipMeshes: report.gzipMeshes, hostsUsed: report.hostsUsed,
  failures: rows.filter(r => !r.ok).slice(0, 10) }, null, 2));
process.exit(failed ? 1 : 0);
