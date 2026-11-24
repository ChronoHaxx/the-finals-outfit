// (23 Nov 2026 release.) Compare a new reconstruction shard plan with the live one: which files are new, changed or
// gone, and how each new shard's membership relates to the live shards. Read-only.
//   node diff-plans.mjs OLD_PLAN NEW_PLAN [OUT.json]
import fs from 'node:fs';
const [oldPath, newPath, outPath] = process.argv.slice(2);
if (!oldPath || !newPath) throw new Error('Usage: diff-plans.mjs OLD_PLAN NEW_PLAN [OUT.json]');
if (outPath && fs.existsSync(outPath)) throw new Error(`Preserve ${outPath}`);
const a = JSON.parse(fs.readFileSync(oldPath, 'utf8')), b = JSON.parse(fs.readFileSync(newPath, 'utf8'));
const added = [], changed = [], same = [], removed = [];
for (const [p, n] of Object.entries(b.nodes)) {
  const o = a.nodes[p];
  if (!o) added.push(p); else if (o.sha256 !== n.sha256 || o.bytes !== n.bytes) changed.push(p); else same.push(p);
}
for (const p of Object.keys(a.nodes)) if (!b.nodes[p]) removed.push(p);
const oldShas = new Set(Object.values(a.nodes).map(n => n.sha256));
const novelContent = [...added, ...changed].filter(p => !oldShas.has(b.nodes[p].sha256));
const bytes = list => list.reduce((s, p) => s + b.nodes[p].bytes, 0);
const byPrefix = list => list.reduce((m, p) => { const k = p.split('/').slice(0, 2).join('/'); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const shards = b.shards.map(s => {
  const set = new Set(s.paths);
  const overlap = a.shards.map(o => ({ live: o.name, shared: o.paths.filter(p => set.has(p)).length, liveFiles: o.paths.length }));
  const identical = a.shards.find(o => o.paths.length === s.paths.length && o.paths.every(p => set.has(p)
    && a.nodes[p].sha256 === b.nodes[p].sha256));
  return { name: s.name, files: s.paths.length, bytes: s.bytes, identicalTo: identical?.name ?? null, overlap,
    newOrChanged: s.paths.filter(p => !a.nodes[p] || a.nodes[p].sha256 !== b.nodes[p].sha256).length };
});
const movedPrefixes = Object.entries(b.prefixShards).filter(([p, id]) => p in a.prefixShards && a.prefixShards[p] !== id)
  .map(([p, id]) => ({ prefix: p, from: a.prefixShards[p], to: id }));
const out = {
  old: { path: oldPath, version: a.version, uniqueFiles: a.uniqueFiles },
  new: { path: newPath, version: b.version, uniqueFiles: b.uniqueFiles },
  counts: { added: added.length, changed: changed.length, same: same.length, removed: removed.length,
    novelContent: novelContent.length },
  bytes: { added: bytes(added), changed: bytes(changed), novelContent: bytes(novelContent) },
  addedByPrefix: byPrefix(added), changedByPrefix: byPrefix(changed),
  removedByPrefix: removed.reduce((m, p) => { const k = p.split('/').slice(0, 2).join('/'); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
  shards, movedPrefixes: movedPrefixes.length, movedPrefixSample: movedPrefixes.slice(0, 20),
  added, changed, removed,
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
const { added: _a, changed: _c, removed: _r, ...summary } = out;
console.log(JSON.stringify(summary, null, 2));
