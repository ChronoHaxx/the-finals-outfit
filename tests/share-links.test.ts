import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { getAllItems } from '../src/lib/catalog';
import registry from '../src/data/share-item-ids.json';

const base = 'https://chronohaxx.github.io/the-finals-outfit/';
const original = { face: 'head-face-01-base', hair: 'hairs-afrofade',
  upperBody: 'casual-basictshirt-cotton-black', lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' };
const compact = '2.36o.1l9.81qo.a17f.cct';
const legacy = '1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJoYWlyIjoiaGFpcnMtYWZyb2ZhZGUiLCJ1cHBlckJvZHkiOiJjYXN1YWwtYmFzaWN0c2hpcnQtY290dG9uLWJsYWNrIiwibG93ZXJCb2R5IjoiY2FzdWFsLWxvb3NlamVhbnMtZGVuaW0tZGFya2JsdWUiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMifX0';

test('permanent v2 IDs preserve the first release even after future catalog additions', () => {
  const initial = { version: registry.version, slots: registry.slots.slice(0, 22), items: registry.items.slice(0, 2866) };
  assert.equal(createHash('sha256').update(JSON.stringify(initial)).digest('hex'),
    '06aa696cedd2d5f6db1002207331c25fd6ef837cf301482a0e81b657fb904d2b', 'Do not regenerate or reassign existing share IDs');
  const ids = new Set(registry.items);
  for (const item of getAllItems()) assert.ok(ids.has(item.id), `Register ${item.id} by appending, never sorting`);
});

test('frozen legacy, compact and readable links keep decoding the original outfit', () => {
  assert.deepEqual(readOutfitLink(base + '?outfit=' + legacy)?.slots, original);
  assert.deepEqual(readOutfitLink(base + '#/?o=' + compact)?.slots, original);
  assert.deepEqual(readOutfitLink(base + '?o=' + compact)?.slots, original);
  const readable = '2.head-1--36o.old-hair-name--1l9.old-shirt-name--81qo.old-jeans-name--a17f.old-shoes-name--cct';
  assert.deepEqual(readOutfitLink(base + '?look=' + readable)?.slots, original);
});

test('both sharing styles round-trip every catalog item without relying on array order or current names', () => {
  for (const item of [...getAllItems()].reverse()) {
    for (const style of ['short', 'names'] as const) {
      const build = { [item.slot]: item.id };
      assert.deepEqual(readOutfitLink(buildShareUrl(base, build, style))?.slots, build, item.id);
    }
  }
});

test('compact links are much shorter and changing styles removes obsolete payloads', () => {
  const short = buildShareUrl(base + '?outfit=' + legacy, original);
  assert.ok(short.length < (base + '?outfit=' + legacy).length / 2);
  assert.equal(new URL(short).hash, '#/?o=' + compact);
  const named = buildShareUrl(short, original, 'names');
  assert.ok(named.includes('spectator-standard--'));
  assert.equal(new URL(named).hash, '');
  assert.deepEqual(readOutfitLink(named)?.slots, original);
  const back = buildShareUrl(named, original, 'short');
  assert.equal(new URL(back).searchParams.has('look'), false);
  assert.deepEqual(readOutfitLink(back)?.slots, original);
});

test('invalid versions, out-of-range IDs and duplicate slots cannot silently select a different outfit', () => {
  for (const invalid of ['3.36o', '2.z6o', '2.3zzzz', '2.36o.36o', '2.-1', '2.']) {
    if (invalid === '2.') assert.deepEqual(readOutfitLink(base + '#/?o=' + invalid)?.slots, {});
    else assert.throws(() => readOutfitLink(base + '#/?o=' + invalid));
  }
});
