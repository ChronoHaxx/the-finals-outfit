import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllItems, getItemById } from '../src/lib/catalog';
import { filterBrowseBuild, getBrowseItem, getBrowseItemsBySlot } from '../src/lib/browse-catalog';
import { isDeveloperCatalogPath } from '../src/lib/catalog-mode';
import { getReconstructionReview } from '../src/lib/reconstruction-status';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import matches from '../src/data/wiki-catalog.json';

test('public display names do not change internal asset identity; unmatched items stay in dev', () => {
  assert.equal(getBrowseItem('casual-basictshirt-cotton-black', false)?.name, 'SPECTATOR STANDARD');
  assert.equal(getBrowseItem('casual-basictshirt-cotton-black', true)?.name, 'Basic Tshirt Cotton Black');
  const unknown = 'attachment-boombox-01-finals-lumbar';
  assert.equal(getBrowseItem(unknown, false), undefined);
  assert.ok(getBrowseItem(unknown, true));
  assert.ok(getItemById(unknown)); // still available to the renderer / developer catalog
  assert.equal(getBrowseItemsBySlot('lowerBack', true).length, 18);
});

test('public catalog is an explicit one-to-one wiki mapping with valid provenance and usable defaults', () => {
  const ids = new Set<number>();
  for (const [id, entry] of Object.entries(matches.items)) {
    assert.ok(getItemById(id), id);
    assert.ok(entry.name.length > 0 && entry.name.length <= 80, id);
    assert.equal(entry.isHidden, false, id);
    assert.equal(entry.isUnreleased, false, id);
    assert.ok(Number.isInteger(entry.pageId) && entry.pageId > 0, id);
    assert.ok(Number.isInteger(entry.revisionId) && entry.revisionId > 0, id);
    assert.ok(!ids.has(entry.pageId), `ambiguous wiki page for ${id}`);
    ids.add(entry.pageId);
  }
  for (const id of ['head-face-01-base', 'casual-basictshirt-cotton-black',
    'casual-loosejeans-denim-darkblue', 'casual-tallsneakers-canvas']) assert.ok(getBrowseItem(id, false));
  assert.ok(getAllItems().length > Object.keys(matches.items).length);
});

test('old share links cannot equip developer-only items publicly or place items into incorrect slots', () => {
  const slots = { lowerBack: 'attachment-boombox-01-finals-lumbar', upperBody: 'casual-basictshirt-cotton-black', feet: 'head-face-01-base' };
  assert.deepEqual(filterBrowseBuild(slots, false), { upperBody: slots.upperBody });
  assert.deepEqual(filterBrowseBuild(slots, true), { lowerBack: slots.lowerBack, upperBody: slots.upperBody });
});

test('only the exact unlisted pathname selects the developer catalog', () => {
  assert.equal(isDeveloperCatalogPath('/the-finals-outfit/'), false);
  assert.equal(isDeveloperCatalogPath('/the-finals-outfit/thesecret-dev-mode-ganyu-only/'), true);
  assert.equal(isDeveloperCatalogPath('/thesecret-dev-mode-ganyu-only'), true);
  assert.equal(isDeveloperCatalogPath('/thesecret-dev-mode-ganyu-only-suffix'), false);
  assert.equal(isDeveloperCatalogPath('/thesecret-dev-mode-ganyu-only/another-page'), false);
});

test('review verdicts win over generic support and missing status data is not falsely red', () => {
  const eno = getItemById('streetwear-tightsinglet-cotton-enorino')!;
  const broken = getItemById('streetwear-tightsinglet-cotton-black')!;
  const ordinary = getItemById('attachment-boombox-01-finals-lumbar')!;
  assert.equal(getReconstructionReview(eno, new Set(), 'unavailable').status, 'accepted');
  assert.equal(getReconstructionReview(broken, new Set([broken.id]), 'ready').status, 'issue');
  assert.equal(getReconstructionReview(ordinary, new Set(), 'unavailable').status, 'unknown');
  assert.equal(getReconstructionReview(ordinary, new Set(), 'ready').status, 'untouched');
  assert.equal(getReconstructionReview(ordinary, new Set([ordinary.id]), 'ready').status, 'polish');
});

test('sharing encodes the edited and empty selections while retaining the public or dev path', () => {
  for (const path of ['/the-finals-outfit/', '/the-finals-outfit/thesecret-dev-mode-ganyu-only/']) {
    const url = new URL(buildShareUrl(`https://example.com${path}?outfit=old&cam=1,2,3`, { face: null, upperBody: 'casual-basictshirt-cotton-black' }));
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get('cam'), '1,2,3');
    assert.deepEqual(readOutfitLink(url.href)?.slots, { upperBody: 'casual-basictshirt-cotton-black' });
    assert.deepEqual(readOutfitLink(buildShareUrl(url.href, {}))?.slots, {});
  }
});
