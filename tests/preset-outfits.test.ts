// The game's own outfits (src/data/preset-outfits.json, src/lib/preset-outfits.ts), against the shipped catalogue:
// every piece is a real item with a share code, every outfit goes on whole, and the head and skin you chose stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import './helpers/load-catalog';
import { getItemById } from '../src/lib/catalog';
import { getBrowseItem } from '../src/lib/browse-catalog';
import { buildShareUrl } from '../src/lib/share-url';
import { resolveSavedSlots } from '../src/lib/saved-outfit-pieces';
import { startingOutfit } from '../src/store/useBuildStore';
import type { Item } from '../src/lib/item';
import {
  KEPT_SLOTS, presetCoverage, presetPieces, presetSlots, type PresetData, type PresetOutfit,
} from '../src/lib/preset-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
// Read from disk: the app fetches this file (loadPresetOutfits), which needs Vite.
const data = JSON.parse(readFileSync(new URL('../src/data/preset-outfits.json', import.meta.url), 'utf8')) as PresetData;
const outfits = data.outfits;
const byId = (id: string) => outfits.find(o => o.id === id)!;
const BARRY = 'alfaactabot', BARREL = 'medievalbot'; // DA_Outfit_AlfaActaBot, DA_Outfit_MedievalBot

test('the outfit list is well formed', () => {
  assert.equal(data.version, 1);
  assert.ok(outfits.length >= 350, `${outfits.length} outfits`);
  assert.equal(new Set(outfits.map(o => o.id)).size, outfits.length, 'ids are unique');
  for (const outfit of outfits) {
    assert.ok(outfit.name.trim(), outfit.id);
    assert.ok(Number.isInteger(outfit.season) && outfit.season >= 1, `${outfit.id} season`);
    assert.equal(outfit.icon, `items/outfits/${outfit.id}.webp`);
    assert.ok(outfit.pieces.length > 0, `${outfit.id} has pieces`);
    for (const piece of outfit.pieces) {
      if (piece.id) assert.ok(getItemById(piece.id), `${outfit.id}: ${piece.id} is a catalogue item`);
      else assert.ok(['effect', 'voice', 'pet', 'absent'].includes(piece.kind!), `${outfit.id}: a piece without an id says why`);
    }
    for (const slot of outfit.hide ?? []) assert.ok(slot === 'hair' || slot === 'facialHair', `${outfit.id} hides ${slot}`);
  }
});

test('outfit icons are present in the local extraction when it is there', { skip: !existsSync('public/items/outfits') }, () => {
  const absent = outfits.filter(o => !existsSync(`public/${o.icon}`)).map(o => o.id);
  assert.deepEqual(absent, []);
});

test('the practice-range mannequin and its wooden twin are complete', () => {
  for (const id of [BARRY, BARREL]) {
    const states = presetPieces(byId(id));
    assert.deepEqual(states.filter(s => s.status !== 'worn').map(s => s.piece), [], `${id}: every piece is on the site`);
  }
  assert.match(byId(BARRY).name, /^Bull.s Eye Barry$/);
  const barry = presetSlots(byId(BARRY), startingOutfit());
  assert.equal(barry.face, 'meta-bothead');
  assert.equal(barry.feet, 'meta-botshoes');
  assert.equal(barry.hair, undefined, 'the mask hides the hair');
});

test('every outfit goes on whole: nothing worn is dropped, and the result is shareable', () => {
  const start = startingOutfit();
  for (const outfit of outfits) {
    const slots = presetSlots(outfit, start);
    const resolved = resolveSavedSlots(slots);
    assert.deepEqual(resolved.missing, [], `${outfit.id}: the saved-outfit resolver keeps every piece`);
    assert.deepEqual(resolved.build, slots, `${outfit.id}: what is worn is exactly the outfit`);
    assert.doesNotThrow(() => buildShareUrl(SITE, { build: resolved.build, bodyType: 'masculine' }), `${outfit.id}: every piece has a share code`);
  }
});

test('the head and skin you chose stay; everything else is the outfit', () => {
  const outfit = byId(BARREL);
  const current = { ...startingOutfit(), hair: 'keep-hair', blush: 'keep-blush', headwear: 'old-hat', wrist: 'old-watch' };
  const slots = presetSlots(outfit, current);
  assert.equal(slots.blush, 'keep-blush', 'skin slots are kept');
  assert.equal(slots.hair, undefined, 'unless the outfit hides them');
  assert.equal(slots.wrist, undefined, 'a slot the outfit does not use is emptied');
  assert.equal(slots.headwear, 'attachments-bucketwooden-01');
  for (const slot of Object.keys(slots)) {
    const piece = outfit.pieces.find(p => p.id === slots[slot as keyof typeof slots]);
    assert.ok(piece || KEPT_SLOTS.includes(slot as never), `${slot} is either the outfit's or kept`);
  }
});

test('two pieces in one builder slot: the bigger one is worn and the other says so', () => {
  const item = (id: string, slot: Item['slot']) => ({ id, name: id, slot }) as Item;
  const items = new Map([['pin', item('pin', 'upperBack')], ['backpack', item('backpack', 'upperBack')], ['boots', item('boots', 'feet')]]);
  const outfit: PresetOutfit = { id: 't', name: 'T', season: 1, icon: 'items/outfits/t.webp', pieces: [
    { id: 'pin', tag: 'TorsoUpperLeft' }, { id: 'backpack', tag: 'BackUpper' }, { id: 'boots', tag: 'Shoes' },
    { id: 'gone', tag: 'Hands' }, { name: 'Sparkles', kind: 'effect', tag: 'Effect' }] };
  const states = presetPieces(outfit, id => items.get(id));
  assert.deepEqual(states.map(s => s.status), ['same-slot', 'worn', 'worn', 'not-on-site', 'effect']);
  assert.equal(states[0].instead?.id, 'backpack');
  assert.deepEqual(presetCoverage(states), { worn: 3, wearable: 4 });
  assert.deepEqual(presetSlots(outfit, {}, id => items.get(id)), { upperBack: 'backpack', feet: 'boots' });
});

test('pieces the public catalogue hides count as not on the site', () => {
  const outfit = outfits.find(o => o.pieces.some(p => p.id && !getBrowseItem(p.id)));
  if (!outfit) return; // every piece is public today
  const hidden = presetPieces(outfit).filter(s => s.piece.id && !getBrowseItem(s.piece.id));
  assert.ok(hidden.every(s => s.status === 'not-on-site'));
});
