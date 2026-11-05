import test from 'node:test';
import assert from 'node:assert/strict';
import { getItemById } from '../src/lib/catalog';
import { equipmentConflicts, resolveEquipmentSlots } from '../src/lib/equipment';
import { migrateOutfit } from '../src/lib/outfit-slots';
import { encodeOutfit } from '../src/lib/outfit';
import { readOutfitLink, buildShareUrl } from '../src/lib/share-url';
import { useBuildStore } from '../src/store/useBuildStore';
import { type Slot } from '../src/lib/slots';
import evidence from '../src/data/source-equipment-slots.json';

const overalls = 'casual-onestrapoveralls-denim', shirt = 'casual-basictshirt-cotton-black';
const pants = 'casual-loosejeans-denim-darkblue', coat = 'casual-longcoat-leather-black';
const companions = { face: 'head-face-09-base', hair: 'hairs-afrofade', eyes: 'bodycosmetics-eyes-emissiveblue-01',
  feet: 'casual-tallsneakers-canvas', nailPolish: 'bodycosmetics-nails-crosses-01' };
const store = () => useBuildStore.getState();

test('source table covers all 29 dual body garments; metadata and catalog IDs agree', () => {
  // 27 since the Season 11 import (18 Oct 2026): a short dress, the NR suit and two retro robot torsos.
  // 29 since the Season 12 import (28 Oct 2026): the two tactical dresses.
  assert.equal(evidence.fullBody.length, 29);
  assert.match(evidence.inputSha256, /^[a-f0-9]{64}$/);
  const slots = evidence.slotsByItem as Record<string, string[]>;
  for (const id of evidence.fullBody) {
    const item = getItemById(id)!;
    assert.ok(item, id);
    assert.ok(slots[id].includes('EBodySlot::BodyUpper'), id);
    assert.ok(slots[id].includes('EBodySlot::BodyLower'), id);
    assert.ok(equipmentConflicts(item.slot, id, item.slot === 'lowerBody' ? 'upperBody' : 'lowerBody',
      item.slot === 'lowerBody' ? shirt : pants), id);
  }
  for (const id of Object.keys(slots)) assert.ok(getItemById(id), id);
});

test('equipping overalls removes conflicting clothes; latest trousers win; toggle/remove do not resurrect them', () => {
  try {
    store().load({ ...companions, upperBody: shirt, lowerBody: pants, outerwear: coat });
    store().equip(getItemById(overalls)!);
    assert.equal(store().build.upperBody, overalls);
    assert.equal(store().build.lowerBody, null);
    assert.equal(store().build.outerwear, null);
    for (const [slot, id] of Object.entries(companions)) assert.equal(store().build[slot as Slot], id);
    const saved = { ...store().build };
    store().equip(getItemById(pants)!);
    assert.equal(store().build.upperBody, null);
    assert.equal(store().build.lowerBody, pants);
    store().toggle(getItemById(overalls)!);
    assert.equal(store().build.lowerBody, null);
    store().toggle(getItemById(overalls)!);
    assert.equal(store().build.upperBody, null);
    assert.equal(store().build.lowerBody, null);
    store().load(Object.fromEntries(Object.entries(saved).filter(([, id]) => id)) as Partial<Record<Slot, string>>);
    assert.deepEqual(store().build, saved);
    store().unequip('upperBody');
    assert.equal(store().build.upperBody, null);
    assert.equal(store().build.lowerBody, null);
  } finally { store().reset(); }
});

test('legacy overalls links migrate, evict pants and displaced dyes deterministically, then share in both formats', () => {
  const old = { slots: { ...companions, upperBody: shirt, lowerBody: pants, upperBack: overalls },
    dyes: { upperBody: '#123456', upperBack: '#abcdef', lowerBody: '#654321', feet: '#112233' }, presetName: 'Legacy' };
  const base = 'https://example.test/the-finals-outfit/';
  for (const link of [base + '?outfit=' + encodeOutfit(old), buildShareUrl(base, old.slots), buildShareUrl(base, old.slots, 'names')]) {
    const decoded = readOutfitLink(link)!;
    const normalized = migrateOutfit(decoded);
    assert.deepEqual(normalized.slots, { ...companions, upperBody: overalls });
    assert.deepEqual(migrateOutfit(normalized), normalized);
    for (const style of ['short', 'names'] as const)
      assert.deepEqual(migrateOutfit(readOutfitLink(buildShareUrl(base, normalized.slots, style))!).slots, normalized.slots);
  }
  assert.deepEqual(migrateOutfit(old).dyes, { upperBody: '#abcdef', feet: '#112233' });
  const reversed = { slots: Object.fromEntries(Object.entries(old.slots).reverse()) };
  assert.deepEqual(migrateOutfit(reversed).slots, migrateOutfit(old).slots);
});

test('ordinary layered clothes and unrelated cosmetics remain; invalid links cannot evict valid items', () => {
  const ordinary = { ...companions, upperBody: shirt, lowerBody: pants, outerwear: coat };
  assert.deepEqual(resolveEquipmentSlots(ordinary).slots, ordinary);
  const invalid = { ...ordinary, upperBack: overalls };
  assert.deepEqual(resolveEquipmentSlots(invalid).slots, invalid, 'migration is explicit and separate');
  assert.deepEqual(resolveEquipmentSlots({ lowerBody: 'missing', upperBody: overalls }).slots,
    { lowerBody: 'missing', upperBody: overalls });
});

test('full-body extras use exact game slot occupancy, not category or names', () => {
  const suit = 'space-astronautsuit-nylon';
  const slots = evidence.slotsByItem as Record<string, string[]>;
  const hip = Object.keys(slots).find(id => getItemById(id)?.slot === 'lowerBack'
    && slots[id].includes('EBodySlot::BackLowerRight'))!;
  assert.ok(equipmentConflicts('upperBody', suit, 'lowerBack', hip));
  assert.equal(equipmentConflicts('upperBody', overalls, 'lowerBack', hip), false);
  assert.deepEqual(resolveEquipmentSlots({ upperBody: suit, lowerBack: hip }).slots, { upperBody: suit });
  assert.deepEqual(resolveEquipmentSlots({ upperBody: suit, lowerBack: hip }, 'lowerBack').slots, { lowerBack: hip });
});

