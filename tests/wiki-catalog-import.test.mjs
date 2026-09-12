import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('wiki refresh preserves a renamed identity and excludes hidden, unreleased and ambiguous newcomers', () => {
  const tempBase = fileURLToPath(new URL('../scripts/generated/', import.meta.url));
  fs.mkdirSync(tempBase, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tempBase, 'finals-wiki-test-'));
  const write = (name, value) => { const target = path.join(temp, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); };
  try {
    const items = ['old-id', 'future-id', 'hidden-id', 'ambiguous-id', 'collision-id', 'new-id'].map(id => ({ id, slot: 'upperBody' }));
    write('src/data/items.json', items);
    write('src/data/wiki-catalog-overrides.json', {});
    write('src/data/wiki-catalog.json', { items: { 'old-id': { name: 'OLD NAME', pageId: 1, revisionId: 1, method: 'exact-localized-name' } } });
    write('localization.json', [{ StringTable: { KeysToEntries: {
      ID_CUSTOMIZATION_OLD_ID_ITEM: 'OLD NAME', ID_CUSTOMIZATION_FUTURE_ID_ITEM: 'FUTURE',
      ID_CUSTOMIZATION_HIDDEN_ID_ITEM: 'HIDDEN', ID_CUSTOMIZATION_AMBIGUOUS_ID_ITEM: 'DOUBLE',
      ID_CUSTOMIZATION_COLLISION_ID_ITEM: 'NEW NAME', ID_CUSTOMIZATION_NEW_ID_ITEM: 'NEW ITEM',
    } } }]);
    const fields = [['NEW NAME', ''], ['FUTURE', '| IsUnreleased=Yes'], ['HIDDEN', '| IsHidden=1'],
      ['DOUBLE', ''], ['DOUBLE', ''], ['NEW ITEM', '| IsUnreleased=No\n| IsHidden=No']];
    write('wiki-pages/0000.json', { query: { pages: fields.map(([name, flags], index) => ({
      pageid: index + 1, revisions: [{ revid: 100 + index, slots: { main: {
        content: `{{Cosmetic\n| Name=${name}\n| Type=UPPER BODY\n${flags}\n}}`,
      } } }],
    })) } });
    write('wiki-snapshot.json', { at: '2026-09-12T00:00:00Z', count: 6, complete: true });
    fs.mkdirSync(path.join(temp, 'scripts'), { recursive: true });
    const script = path.join(temp, 'scripts/import-wiki-catalog.mjs');
    fs.copyFileSync(new URL('../scripts/import-wiki-catalog.mjs', import.meta.url), script);
    execFileSync(process.execPath, [script, path.join(temp, 'wiki-pages'), path.join(temp, 'localization.json')]);
    const result = JSON.parse(fs.readFileSync(path.join(temp, 'src/data/wiki-catalog.json'))).items;
    assert.deepEqual(Object.keys(result), ['old-id', 'new-id']);
    assert.equal(result['old-id'].name, 'NEW NAME');
    assert.equal(result['old-id'].pageId, 1);
    assert.equal(result['old-id'].revisionId, 100);
  } finally {
    // The resolved deletion target is precisely this test's mkdtemp directory.
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(tempBase));
    assert.ok(path.basename(temp).startsWith('finals-wiki-test-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
