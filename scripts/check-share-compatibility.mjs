import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = 'src/data/share-item-ids.json';
const current = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'));
assert.equal(current.version, 2);
assert.ok(current.slots.length <= 36 && current.items.length <= 36 ** 4, 'v2 code capacity exceeded');
assert.equal(new Set(current.items).size, current.items.length, 'Duplicate stable IDs');
assert.equal(new Set(current.slots).size, current.slots.length, 'Duplicate stable slots');
const known = new Set(current.items);
for (const item of JSON.parse(fs.readFileSync(path.join(root, 'src/data/items.json'), 'utf8'))) {
  assert.ok(known.has(item.id), `Run npm run sync:share-ids for ${item.id}`);
  assert.ok(current.slots.includes(item.slot), `Unregistered slot ${item.slot}`);
}
const base = process.env.SHARE_LINK_BASE ?? process.argv[2];
if (base) {
  const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8' });
  git(['rev-parse', '--verify', `${base}^{commit}`]);
  if (git(['ls-tree', '-r', '--name-only', base, '--', registryPath]).trim()) {
    const previous = JSON.parse(git(['show', `${base}:${registryPath}`]));
    assert.equal(current.version, previous.version, 'Keep the old registry when adding a new codec');
    assert.deepEqual(current.items.slice(0, previous.items.length), previous.items, 'Existing share IDs must never be removed, reordered or reused');
    assert.deepEqual(current.slots.slice(0, previous.slots.length), previous.slots, 'Existing share slots must never change');
    console.log(`Preserved all ${previous.items.length} IDs from ${base}.`);
  } else console.log('Base predates compact links; legacy compatibility is covered by fixed-link tests.');
}
console.log(`Share registry valid: ${current.items.length} permanent item IDs.`);
