// Saved outfits in the builder (7 Nov 2026), against the shipped catalogue: reloads, share links, Randomise and
// Reset next to hand-made work, catalogue changes under a saved outfit, deleting, and storage being off.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import { getItemById } from '../src/lib/catalog';
import { getBrowseItem } from '../src/lib/browse-catalog';
import { buildShareUrl } from '../src/lib/share-url';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import type { OutfitBackend } from '../src/lib/outfit-library';
import { FALLBACK_FACE, startingOutfit, useBuildStore, withRenderableFace } from '../src/store/useBuildStore';
import {
  deleteOutfit, duplicateOutfit, flushSavedOutfits, forgetMissing, newOutfit, openFromUrl, randomiseOutfit,
  renameOutfit, resetOutfit, saveDraft, selectOutfit, startSavedOutfits, stopSavedOutfits, useSavedOutfits,
} from '../src/store/useSavedOutfits';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const HAT = 'attachment-pumpkinhead-hat';
const BOOTS = 'actionhero-sentinelboots-leather';
const GLASSES = 'attachment-3dpaperglasses-paper';
const ICON_ONLY_FACE = 'head-blankface-absorbeglitter';

let backend: MemoryBackend;
let storage: ReturnType<typeof memoryStorage>;
let confirms: string[];

async function visit(options: { backend?: OutfitBackend; cap?: number; confirm?: boolean } = {}) {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  let n = 0;
  await startSavedOutfits({
    library: { backend: options.backend ?? backend, journal: storageJournal(storage), schedule: manualScheduler().schedule,
      newId: () => `o${Date.now().toString(36)}-${++n}-${Math.random().toString(36).slice(2, 6)}`, cap: options.cap },
    confirm: message => { confirms.push(message); return options.confirm ?? true; },
  });
}

const state = () => useSavedOutfits.getState();
const outfits = () => state().library!.outfits;
const current = () => state().library!.current;
const currentRecord = () => { const c = current(); return c?.kind === 'record' ? outfits().find(r => r.id === c.id) : undefined; };
const build = () => useBuildStore.getState().build;
const equip = (id: string) => useBuildStore.getState().equip(getItemById(id)!);
const linkTo = (slots: Record<string, string>, bodyType = 'masculine') => buildShareUrl(SITE, { build: slots, bodyType });

beforeEach(() => {
  backend = new MemoryBackend(true);
  storage = memoryStorage();
  confirms = [];
});

test('the pieces these tests use are public catalogue items', () => {
  for (const id of [HAT, BOOTS, GLASSES, ICON_ONLY_FACE, 'casual-shortdress-latex']) assert.ok(getBrowseItem(id), id);
  assert.equal(getBrowseItem(HAT)?.slot, 'headwear');
  assert.equal(getBrowseItem('casual-shortdress-latex')?.slot, 'upperBody');
});

test('a first visit starts "Outfit 1"; hand edits are saved into it and a reload restores them', async () => {
  await visit();
  openFromUrl(SITE);
  assert.equal(outfits().length, 1);
  assert.equal(currentRecord()?.name, 'Outfit 1');
  assert.deepEqual(currentRecord()?.slots, startingOutfit());
  equip(HAT);
  assert.equal(currentRecord()?.slots.headwear, HAT);
  assert.equal(currentRecord()?.generated, undefined, 'a hand edit makes it work worth protecting');
  // Killed before the debounced write: the journal brings it back.
  await visit();
  const second = openFromUrl(SITE);
  assert.deepEqual(second, { omitted: false, error: false });
  assert.equal(build().headwear, HAT);
  assert.equal(outfits().length, 1);
  // StrictMode runs the effect twice, and the router re-runs it after the link is removed: no reset.
  openFromUrl(SITE);
  assert.equal(build().headwear, HAT);
});

test('a share link opens as a draft; saved outfits are untouched until the first edit saves it', async () => {
  await visit();
  openFromUrl(SITE);
  equip(HAT);
  const mine = currentRecord()!;
  const link = linkTo({ face: FALLBACK_FACE, feet: BOOTS, eyewear: GLASSES });
  openFromUrl(link);
  openFromUrl(link); // StrictMode double effect: still one draft
  assert.equal(current()?.kind, 'draft');
  assert.equal(outfits().length, 1, 'opening a link saves nothing yet');
  assert.equal(build().feet, BOOTS);
  assert.equal(outfits()[0].slots.headwear, HAT, 'the hand-made outfit is untouched');
  // A reload with the link still in the address bar shows the same draft.
  await visit();
  openFromUrl(link);
  assert.equal(current()?.kind, 'draft');
  assert.equal(outfits().length, 1);
  useBuildStore.getState().unequip('eyewear');
  assert.equal(current()?.kind, 'record');
  assert.equal(currentRecord()?.name, 'Shared outfit');
  assert.equal(currentRecord()?.slots.eyewear, undefined);
  assert.equal(outfits().length, 2);
  assert.equal(outfits().find(r => r.id === mine.id)?.slots.headwear, HAT);
});

test('a link matching a saved outfit selects it, and Save keeps a draft as it is', async () => {
  await visit();
  openFromUrl(SITE);
  equip(HAT);
  const first = currentRecord()!;
  newOutfit();
  assert.equal(currentRecord()?.name, 'Outfit 2');
  openFromUrl(linkTo(first.slots));
  assert.equal(currentRecord()?.id, first.id, 'the same pieces select the saved outfit instead of a copy');
  openFromUrl(linkTo({ face: FALLBACK_FACE, feet: BOOTS }));
  assert.equal(current()?.kind, 'draft');
  assert.equal(saveDraft(), true);
  assert.equal(currentRecord()?.name, 'Shared outfit');
  assert.equal(outfits().length, 3);
});

test('Randomise and Reset never overwrite hand-made work; an untouched roll is replaced in place', async () => {
  await visit();
  openFromUrl(SITE);
  equip(HAT);
  const handMade = currentRecord()!;
  randomiseOutfit({ face: FALLBACK_FACE, feet: BOOTS });
  const roll = currentRecord()!;
  assert.notEqual(roll.id, handMade.id);
  assert.equal(roll.name, 'Random 1');
  assert.equal(roll.generated, true);
  assert.match(state().toast?.message ?? '', /is kept/);
  assert.equal(outfits().find(r => r.id === handMade.id)?.slots.headwear, HAT);
  randomiseOutfit({ face: FALLBACK_FACE, eyewear: GLASSES });
  assert.equal(currentRecord()?.id, roll.id, 'rolling again reuses the untouched roll');
  assert.equal(outfits().length, 2);
  state().toast!.undo!();
  assert.equal(build().feet, BOOTS, 'Undo brings the previous roll back');
  assert.equal(state().toast, null, 'the undo cleared it');
  randomiseOutfit({ face: FALLBACK_FACE, eyewear: GLASSES });
  equip(HAT); // the roll becomes hand-made
  resetOutfit();
  assert.equal(outfits().length, 3, 'Reset over a hand-made outfit starts a new one');
  assert.deepEqual(currentRecord()?.slots, startingOutfit());
  state().toast!.undo!();
  assert.equal(currentRecord()?.id, roll.id);
  assert.equal(build().headwear, HAT);
  assert.equal(outfits().length, 2, 'undoing removes the outfit it had started');
});

test('a catalogue change under a saved outfit keeps the outfit and names the missing pieces', async () => {
  await backend.update('saved', () => ({ v: 1, id: 'saved', rev: 1, name: 'Old look', createdAt: 1, updatedAt: 1,
    slots: { face: FALLBACK_FACE, feet: 'removed-boots-zzz', lowerBody: HAT, wrist: 'removed-watch-zzz' },
    labels: { 'removed-boots-zzz': 'Retired Boots' } }));
  await backend.updateMeta(() => ({ v: 1, currentId: 'saved' }));
  await visit();
  openFromUrl(SITE);
  assert.equal(currentRecord()?.id, 'saved');
  assert.equal(build().face, FALLBACK_FACE);
  assert.equal(build().feet, null);
  const missing = state().missing;
  assert.deepEqual(missing.map(p => [p.slot, p.reason]).sort(), [['feet', 'gone'], ['lowerBody', 'moved'], ['wrist', 'gone']]);
  assert.equal(missing.find(p => p.slot === 'feet')?.name, 'Retired Boots');
  assert.equal(missing.find(p => p.slot === 'lowerBody')?.nowIn, 'headwear');

  equip(BOOTS); // fills the feet slot: that stale piece is replaced on purpose
  equip(GLASSES); // another slot: the rest stay saved
  await flushSavedOutfits();
  const saved = (await backend.readAll()).find(r => (r as { id: string }).id === 'saved') as { slots: Record<string, string> };
  assert.deepEqual(saved.slots, { face: FALLBACK_FACE, feet: BOOTS, eyewear: GLASSES, lowerBody: HAT, wrist: 'removed-watch-zzz' });
  assert.equal(state().missing.length, 2);

  forgetMissing();
  assert.equal(currentRecord()?.slots.wrist, undefined);
  state().toast!.undo!();
  assert.equal(currentRecord()?.slots.wrist, 'removed-watch-zzz', 'Remove can be undone');
});

test('a historical slot correction moves the saved piece instead of keeping two copies', async () => {
  await backend.update('old', () => ({ v: 1, id: 'old', rev: 1, name: 'Dress', createdAt: 1, updatedAt: 1,
    slots: { face: FALLBACK_FACE, lowerBody: 'casual-shortdress-latex' } }));
  await visit();
  openFromUrl(SITE);
  assert.equal(build().upperBody, 'casual-shortdress-latex');
  assert.deepEqual(state().missing, []);
  equip(BOOTS);
  assert.deepEqual(currentRecord()?.slots, { face: FALLBACK_FACE, upperBody: 'casual-shortdress-latex', feet: BOOTS });
});

test('render-time fallbacks still apply to a loaded outfit', async () => {
  await backend.update('eternel', () => ({ v: 1, id: 'eternel', rev: 1, name: 'Éternel', createdAt: 1, updatedAt: 1,
    slots: { face: ICON_ONLY_FACE } }));
  await visit();
  openFromUrl(SITE);
  assert.equal(build().face, ICON_ONLY_FACE, 'the saved choice is kept, not reported missing');
  assert.deepEqual(state().missing, []);
  assert.equal(withRenderableFace(build(), () => false).face, FALLBACK_FACE);
});

test('delete switches away and can be undone; deleting the last outfit leaves a fresh one', async () => {
  await visit();
  openFromUrl(SITE);
  equip(HAT);
  const only = currentRecord()!;
  deleteOutfit(only.id);
  assert.equal(outfits().length, 1);
  assert.notEqual(currentRecord()?.id, only.id);
  assert.match(state().toast?.message ?? '', /Deleted “Outfit 1”/);
  state().toast!.undo!();
  assert.equal(currentRecord()?.id, only.id);
  assert.equal(build().headwear, HAT);
  assert.equal(outfits().length, 1, 'the untouched stand-in goes again');
  await flushSavedOutfits();
  assert.equal((await backend.readAll()).every(r => (r as { id: string; deletedAt?: number }).id !== only.id
    || (r as { deletedAt?: number }).deletedAt === undefined), true);
});

test('rename and duplicate', async () => {
  await visit();
  openFromUrl(SITE);
  renameOutfit(currentRecord()!.id, '  Night   shift ');
  assert.equal(currentRecord()?.name, 'Night shift');
  duplicateOutfit(currentRecord()!.id);
  assert.equal(currentRecord()?.name, 'Night shift copy');
  selectOutfit(outfits().find(r => r.name === 'Night shift')!.id);
  assert.equal(currentRecord()?.name, 'Night shift');
});

test('at the cap a link or a roll stays unsaved, the existing outfit is untouched, and leaving asks first', async () => {
  await visit({ cap: 1, confirm: false });
  openFromUrl(SITE);
  equip(HAT);
  const mine = currentRecord()!;
  assert.equal(newOutfit(), false);
  assert.match(state().toast?.message ?? '', /Delete one to make room/);
  randomiseOutfit({ face: FALLBACK_FACE, feet: BOOTS });
  assert.equal(current()?.kind, 'draft');
  assert.equal(outfits()[0].slots.headwear, HAT);
  equip(GLASSES); // a hand edit that cannot be saved
  assert.equal(current()?.kind, 'draft');
  assert.equal((current() as { draft: { edited?: boolean } }).draft.edited, true);
  selectOutfit(mine.id); // refused by the confirm stub
  assert.equal(current()?.kind, 'draft');
  assert.equal(confirms.length, 1);
});

test('storage off: everything still works for the visit, and the status says so', async () => {
  await visit({ backend: new MemoryBackend(false) });
  openFromUrl(SITE);
  equip(HAT);
  assert.equal(state().library?.status, 'off');
  assert.equal(currentRecord()?.slots.headwear, HAT);
  assert.equal(newOutfit(), true);
  assert.equal(outfits().length, 2);
});

test('an unreadable link keeps the current outfit', async () => {
  await visit();
  openFromUrl(SITE);
  equip(HAT);
  assert.deepEqual(openFromUrl(`${SITE}#/?o=9.zz`), { omitted: false, error: true });
  assert.equal(build().headwear, HAT);
});
