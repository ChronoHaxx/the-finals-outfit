// After `npm run build`: the catalog JSON must ship as separate preloaded files, not inside
// a JavaScript chunk (see the catalog-assets plugin in vite.config.ts). A single static
// `import ... from "../data/items.json"` anywhere in src/ would silently put the whole
// catalog back into the entry chunk, so this checks the build output, not the source.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CATALOG_FILES, shippedCatalogJson } from '../src/lib/catalog-files.ts';
import { DEVELOPER_CATALOG_PATH } from '../src/lib/catalog-mode.ts';

const dist = process.argv[2] ?? 'dist';
const kb = bytes => `${(bytes / 1024).toFixed(0)} KB`;
const catalogIds = new Set(JSON.parse(readFileSync(CATALOG_FILES.items.path, 'utf8')).map(item => item.id));

for (const page of ['index.html', `${DEVELOPER_CATALOG_PATH}/index.html`]) {
  const html = readFileSync(join(dist, page), 'utf8');
  const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="fetch" crossorigin="">/g)].map(m => m[1]);
  for (const [key, { path: file }] of Object.entries(CATALOG_FILES)) {
    const stem = basename(file, extname(file));
    const href = preloads.find(url => new RegExp(`/assets/${stem}-[\\w-]+\\.json$`).test(url));
    assert(href, `${page}: no preload for catalog file ${key} (${file})`);
    const emitted = join(dist, 'assets', basename(href));
    assert(existsSync(emitted), `${page}: preloaded ${href} is missing from ${dist}`);
    assert.equal(readFileSync(emitted, 'utf8'), shippedCatalogJson(key, readFileSync(file, 'utf8')),
      `${emitted} is not the shipped projection of ${file}`);
  }
}

// Code legitimately names a few dozen items (defaults, slot migrations). A bundled catalog
// file names thousands, so a tenth of the catalog is far from both.
for (const name of readdirSync(join(dist, 'assets')).filter(name => name.endsWith('.js'))) {
  const code = readFileSync(join(dist, 'assets', name), 'utf8');
  const named = new Set([...code.matchAll(/["'`]([a-z0-9][a-z0-9-]{1,47})["'`]/g)].map(m => m[1]).filter(id => catalogIds.has(id)));
  assert(named.size < catalogIds.size / 10, `${name} names ${named.size} catalog items: catalog JSON is bundled into JavaScript`);
  console.log(`${name}: ${kb(code.length)} raw, ${kb(gzipSync(code).length)} gzip, names ${named.size} catalog items`);
}
console.log(`Catalog split OK: ${Object.keys(CATALOG_FILES).length} files preloaded beside the entry chunk.`);
