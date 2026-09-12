import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySlot } from '../scripts/lib/catalog-slots.ts';
import { LEGACY_SLOT_MIGRATIONS, migrateSlots, migrateOutfit } from '../src/lib/outfit-slots.ts';
import { encodeOutfit, decodeOutfit } from '../src/lib/outfit.ts';
import { getItemById } from '../src/lib/catalog.ts';
import { useBuildStore } from '../src/store/useBuildStore.ts';

const singlet = 'streetwear-tightsinglet-cotton-enorino';
const shirt = 'casual-basictshirt-cotton-black';
const pants = 'casual-loosejeans-denim-darkblue';
const shoes = 'casual-tallsneakers-canvas';

test('garment nouns beat ambiguous lower-body modifiers; real trousers and coats retain precedence', () => {
  const groups = {
    upperBody: ['TightSinglet', 'TightSingletSportEvent', 'ShortDress', 'JeansJacket', 'JacketShort', 'ShortSleeveShirt', 'CaptainJacket'],
    lowerBody: ['Shorts', 'CargoShorts', 'Jeans', 'LooseJeans', 'Tights', 'Leggings', 'SuitPants', 'TutuSkirtWithTights', 'Trousers'],
    outerwear: ['LongCoat', 'ShortCoat', 'CoatTop', 'Cloak', 'Cape', 'Cardigan'],
    feet: ['TallSneakers', 'ShortBoots'],
    headwear: ['BaseballCap', 'Helmet'],
  };
  for (const [slot, names] of Object.entries(groups)) for (const name of names) assert.equal(classifySlot(name), slot, name);
  assert.equal(classifySlot('Unclassified', 'TightSinglet'), 'upperBody');
  assert.equal(classifySlot('SuitPants', 'TightSinglet'), 'lowerBody');
  assert.equal(classifySlot('Unknown'), null);
});

test('every recorded correction exists in its destination and migrates a historical v1 link', () => {
  assert.equal(LEGACY_SLOT_MIGRATIONS.size, 31);
  for (const [id, { from, to }] of LEGACY_SLOT_MIGRATIONS) {
    assert.equal(getItemById(id)?.slot, to, id);
    const old = { slots: { [from]: id, feet: shoes }, presetName: 'Old outfit', dyes: { [from]: '#aabbcc', feet: '#001122' } };
    const decoded = decodeOutfit(encodeOutfit(old));
    assert.deepEqual(decoded, old, 'the codec preserves the original data');
    const migrated = migrateOutfit(decoded);
    assert.deepEqual(migrated, { slots: { [to]: id, feet: shoes }, presetName: old.presetName,
      dyes: { [to]: '#aabbcc', feet: '#001122' } }, id);
    assert.deepEqual(decodeOutfit(encodeOutfit(migrated)), migrated, 'new links round-trip');
    assert.deepEqual(migrateOutfit(migrated), migrated, 'migration is idempotent');
  }
});

test('the misplaced garment wins a two-top collision independently of JSON key order', () => {
  for (const slots of [{ upperBody: shirt, lowerBody: singlet, feet: shoes },
    { feet: shoes, lowerBody: singlet, upperBody: shirt }]) {
    const original = structuredClone(slots);
    const migrated = migrateSlots(slots, { upperBody: '#ff0000', lowerBody: '#00ff00', feet: '#0000ff' });
    assert.deepEqual(migrated.slots, { upperBody: singlet, feet: shoes });
    assert.deepEqual(migrated.dyes, { upperBody: '#00ff00', feet: '#0000ff' });
    assert.equal(migrated.moves[0].displaced, shirt);
    assert.deepEqual(slots, original, 'input must not be mutated');
  }
  assert.deepEqual(migrateSlots({ upperBody: shirt, lowerBody: singlet }, { upperBody: '#ff0000' }).dyes, {},
    'the displaced shirt dye must not colour an undyed singlet');
});

test('normal outfits and arbitrary invalid placements are not rewritten into different outfits', () => {
  const slots = { upperBody: singlet, lowerBody: pants, feet: shoes };
  assert.deepEqual(migrateSlots(slots).slots, slots);
  assert.deepEqual(migrateSlots({ headwear: singlet, lowerBody: 'missing-item' }).slots,
    { headwear: singlet, lowerBody: 'missing-item' });
  assert.deepEqual(migrateOutfit({ slots: {}, presetName: 'Empty' }), { slots: {}, presetName: 'Empty' });
  assert.throws(() => decodeOutfit('not-a-code'));
});

test('direct loading, selection, replacement, toggle, empty build and reset agree with corrected slots', () => {
  const store = () => useBuildStore.getState();
  try {
    store().load({ lowerBody: singlet, upperBody: shirt, feet: shoes });
    assert.equal(store().build.upperBody, singlet);
    assert.equal(store().build.lowerBody, null);
    assert.equal(store().build.feet, shoes);
    store().equip(getItemById(pants)!);
    assert.equal(store().build.lowerBody, pants);
    store().equip(getItemById(shirt)!);
    assert.equal(store().build.upperBody, shirt);
    store().toggle(getItemById(singlet)!);
    assert.equal(store().build.upperBody, singlet);
    assert.equal(store().build.lowerBody, pants);
    store().toggle(getItemById(singlet)!);
    assert.equal(store().build.upperBody, null);
    store().load({});
    assert(Object.values(store().build).every(x => x === null));
    store().reset();
    assert.equal(store().build.upperBody, shirt);
    assert.equal(store().build.lowerBody, pants);
  } finally { store().reset(); }
});
