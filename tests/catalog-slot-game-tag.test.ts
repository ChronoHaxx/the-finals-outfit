import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySlot, gameTagSlot, GAME_TAG_SLOT, GAME_TAG_SPLIT } from '../scripts/lib/catalog-slots.ts';
import { SLOTS } from '../src/lib/slots.ts';

// Piece folders the June catalog import skipped because no keyword names them, with the
// Customization.Slot tag their item definition carries (public/models/reconstructed-assembly-v2).
const SKIPPED: [piece: string, fileToken: string, tag: string, slot: string][] = [
  ['Durag', 'Casual_Durag_Black_Gold', 'Headwear', 'headwear'], // TGM25 "Final Fly Durag"
  ['Earmuffs', 'Casual_Earmuffs_Cotton', 'Headwear', 'headwear'],
  ['ClownNose', 'Attachment_ClownNose', 'Facewear', 'facewear'],
  ['TogaUpper', 'Historic_TogaUpper_Cotton', 'BodyUpper', 'upperBody'],
  ['TogaLower', 'Historic_TogaLower_Cotton', 'BodyLower', 'lowerBody'],
  ['ORFSlippers', 'Cute_ORFSlippers_Cotton', 'Shoes', 'feet'],
  ['SimpleRings', 'Historic_SimpleRings_Metal', 'Hands', 'hands'],
  ['FloatingSkull', 'Medieval_FloatingSkull_Skeleton_GreenGlow', 'Head', 'face'],
  ['SeasonalLeague_01', 'Attachments_LeagueDiamond_S10_01', 'TorsoUpperLeft', 'upperBack'],
  ['HuntingKnife', 'Cowboy_HuntingKnife_Nylon', 'TorsoUpperLeft', 'upperBack'],
  ['BearPlushie_01', 'Attachments_BearPlushie_01', 'BackLowerRight', 'lowerBack'],
];

test('a piece no keyword names takes the slot its game definition is tagged with', () => {
  for (const [piece, token, tag, slot] of SKIPPED) {
    assert.equal(classifySlot(piece, token), null, `${piece} still has no keyword`);
    assert.equal(classifySlot(piece, token, tag), slot, piece);
  }
});

test('a keyword match still wins, so slots the catalog already assigns do not move', () => {
  // Deliberate app groupings the tag would otherwise override (catalog-slot-tag-audit).
  assert.equal(classifySlot('BaseballCap', null, 'Facewear'), 'headwear');
  assert.equal(classifySlot('SteampunkHoodedVest', null, 'BodyUpper'), 'headwear');
  assert.equal(classifySlot('GasMask', null, 'Headwear'), 'facewear');
  assert.equal(classifySlot('JeansJacket', null, 'BodyLower'), 'upperBody');
});

test('split tags keep a keyword inside their own slots and otherwise default to the first', () => {
  assert.equal(gameTagSlot('BodyUpper', 'outerwear'), 'outerwear');
  assert.equal(gameTagSlot('BodyUpper', 'feet'), 'upperBody');
  assert.equal(gameTagSlot('Facewear', 'eyewear'), 'eyewear');
  assert.equal(gameTagSlot('BackLowerRight', null), 'lowerBack');
});

test('non-wearable or missing tags leave the icon unclassified', () => {
  for (const tag of ['Pet', 'VisualEffects', 'Voice', '', null, undefined]) assert.equal(classifySlot('Unknown', 'Unknown', tag), null, String(tag));
});

test('every mapped slot is an app slot, and no tag is both direct and split', () => {
  for (const slot of [...Object.values(GAME_TAG_SLOT), ...Object.values(GAME_TAG_SPLIT).flat()]) assert.ok(SLOTS.includes(slot), slot);
  for (const tag of Object.keys(GAME_TAG_SPLIT)) assert.equal(GAME_TAG_SLOT[tag], undefined, tag);
});

test('the importer reads the durag tag from the tracked customization recovery', () => {
  const cust = JSON.parse(readFileSync(new URL('../scripts/customization.generated.json', import.meta.url), 'utf8'));
  assert.equal(cust.DA_Casual_Durag_Black_Gold?.slot, 'Headwear');
});
