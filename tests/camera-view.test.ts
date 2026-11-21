// Camera views (21 Nov 2026, Shocka's feedback item 3): the link grammar and its Worker twin, links built with and
// without a view, a link's view reaching the viewer only when its outfit opened, and views saved with an outfit,
// including the loss paths (a kill before the write, an edit elsewhere in the record, an entry this version can't read,
// Undo after switching outfits).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import {
  DEFAULT_VIEW, VIEW_CAP, formatView, hasDeletedView, isDefaultView, liveViews, parseView, pendingView, readViewLink,
  roundView, takePendingView, viewsWritable, withViewAdded, withViewDeleted, withViewRenamed, withViewRestored,
  withoutView, wrapRoll, type CameraView,
} from '../src/lib/camera-view';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { readPoseLink } from '../src/lib/share-pose';
import { uploadQuery } from '../src/lib/share-preview';
import { readView as workerReadView } from '../workers/share-preview/src/share';
import { OutfitLibrary, type LibraryOptions } from '../src/lib/outfit-library';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { useBuildStore } from '../src/store/useBuildStore';
import { getItemById } from '../src/lib/catalog';
import {
  deleteCameraView, flushSavedOutfits, newOutfit, randomiseOutfit, renameCameraView, saveCameraView, selectOutfit,
  startSavedOutfits, stopSavedOutfits, useSavedOutfits,
} from '../src/store/useSavedOutfits';
import { openLink } from '../src/store/open-link';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const outfit = { face: 'head-face-01-base', hair: 'hairs-afrofade', feet: 'casual-tallsneakers-canvas' };
const look = { build: outfit, bodyType: 'masculine' };
const tilted: CameraView = { position: [0.6213, 1.4204, 3.1], target: [0, 0.95, -0.00001], roll: -8.04 };

beforeEach(() => { takePendingView(); });

test('a view is written to the millimetre and a tenth of a degree, the roll only when there is one', () => {
  assert.equal(formatView(tilted), '0.621_1.42_3.1_0_0.95_0_-8');
  assert.equal(formatView(DEFAULT_VIEW), '0_1_3.6_0_0.9_0');
  assert.equal(formatView({ ...DEFAULT_VIEW, roll: 0.04 }), '0_1_3.6_0_0.9_0', 'a roll that rounds to 0 is left out');
  assert.equal(formatView({ position: [-0.0004, 250, -250], target: [Number.NaN, 0, 0], roll: 190 }), '0_100_-100_0_0_0_-170',
    'no "-0", coordinates clamped to 100 m, junk read as 0, roll wrapped');
  assert.equal(wrapRoll(-180), 180);
  assert.equal(wrapRoll(540), 180);
  assert.equal(wrapRoll(-190.04), 170);
  assert.deepEqual(roundView(tilted), { position: [0.621, 1.42, 3.1], target: [0, 0.95, 0], roll: -8 });
});

test('the grammar reads its own output and refuses anything else', () => {
  for (const view of [tilted, DEFAULT_VIEW, { position: [-9.999, 0.001, 99.5], target: [1, 2, 3], roll: 179.9 } as CameraView])
    assert.equal(formatView(parseView(formatView(view))!), formatView(view));
  assert.deepEqual(parseView('0_1_3.6_0_0.9_0'), { position: [0, 1, 3.6], target: [0, 0.9, 0], roll: 0 });
  for (const bad of [null, '', '0_1_3.6_0_0.9', '0_1_3.6_0_0.9_0_5_5', '0,1,3.6,0,0.9,0', '0_1_3.6_0_0.9_0_5.25',
    '0_1_3.6_0_0.9_0.0001', '1e2_1_3.6_0_0.9_0', '0_1_101_0_0.9_0', '0_1_3.6_0_0.9_0_181', '1_1_1_1_1_1', ' 0_1_3.6_0_0.9_0'])
    assert.equal(parseView(bad), null, String(bad));
});

test('the share Worker accepts exactly what the app writes', () => {
  const params = (view: string) => new URLSearchParams({ view });
  for (const view of [tilted, DEFAULT_VIEW, { position: [-99.999, 0, 0.5], target: [0, -0.25, 0], roll: -179.5 } as CameraView])
    assert.equal(workerReadView(params(formatView(view))), formatView(view));
  assert.equal(workerReadView(new URLSearchParams()), undefined);
  for (const bad of ['0_1', '0_1_3.6_0_0.9_0_"><script>', '0,1,3.6,0,0.9,0', '0_1_3.6_0_0.9_0_1.25'])
    assert.equal(workerReadView(params(bad)), null, bad);
});

test('a view rides last in both link styles and reads back; links without one have none', () => {
  const pose = { clip: 'ace-pilot', time: 1.5, paused: true };
  const short = buildShareUrl(SITE, look, 'short', pose, tilted);
  assert.match(new URL(short).hash, /^#\/\?o=2\.[0-9a-z.]+&emote=ace-pilot&t=1\.5&paused=1&view=0\.621_1\.42_3\.1_0_0\.95_0_-8$/,
    'no escaping needed');
  assert.deepEqual(readViewLink(short), roundView(tilted));
  assert.deepEqual(readPoseLink(short), pose, 'the pose still reads');
  assert.deepEqual(readOutfitLink(short)?.slots, outfit, 'the outfit still decodes');

  const names = buildShareUrl(SITE, look, 'names', null, tilted);
  assert.equal(new URL(names).searchParams.get('view'), '0.621_1.42_3.1_0_0.95_0_-8');
  assert.deepEqual(readViewLink(names), roundView(tilted));

  for (const plain of [buildShareUrl(SITE, look), buildShareUrl(SITE, look, 'names'), SITE, `${SITE}#/`,
    `${SITE}?cam=0,1,2,0,1,0`, `${SITE}#/?o=2.&view=junk`])
    assert.equal(readViewLink(plain), null, plain);
  assert.deepEqual(readViewLink(`${SITE}#/chinals?o=2.&view=0_1_2_0_1_0`), { position: [0, 1, 2], target: [0, 1, 0], roll: 0 },
    'the Chinals route carries it too');
});

test('a new share never inherits the view of the link it was opened from', () => {
  const opened = buildShareUrl(SITE, look, 'names', null, tilted);
  for (const style of ['short', 'names'] as const) {
    assert.equal(readViewLink(buildShareUrl(opened, look, style)), null, style);
    const other = buildShareUrl(opened, look, style, null, DEFAULT_VIEW);
    assert.deepEqual(readViewLink(other), DEFAULT_VIEW, style);
    assert.equal(other.match(/view=/g)?.length, 1, style);
  }
});

test('the mode switch drops the view (the router re-reads the address); the preview upload carries it last', () => {
  assert.equal(withoutView('?o=2.12a&emote=wave&view=0_1_2_0_1_0'), '?o=2.12a&emote=wave');
  assert.equal(withoutView('?view=0_1_2_0_1_0'), '');
  assert.equal(uploadQuery('2.12a', null, 'a', tilted), 'o=2.12a&bt=a&view=0.621_1.42_3.1_0_0.95_0_-8');
  assert.equal(uploadQuery('2.12a', null), 'o=2.12a', 'without a view the upload is as before');
  assert.ok(isDefaultView({ position: [0.0004, 1, 3.6], target: [0, 0.9, 0], roll: 0 }));
});

// ---------------------------------------------------------------------------------------------------------------------
// The stored list.

test('views are named View 1, View 2...; saving past the cap is refused, never an eviction', () => {
  let list: unknown = undefined;
  for (let i = 1; i <= VIEW_CAP; i++) {
    list = withViewAdded(list, tilted, { id: `v${i}`, now: i });
    assert.ok(list);
  }
  assert.deepEqual(liveViews(list).slice(0, 3).map(v => v.name), ['View 1', 'View 2', 'View 3']);
  assert.equal(withViewAdded(list, DEFAULT_VIEW, { id: 'over', now: 99 }), null);
  const freed = withViewDeleted(list, 'v2', 100);
  assert.equal(liveViews(freed).length, VIEW_CAP - 1);
  assert.equal(liveViews(withViewAdded(freed, DEFAULT_VIEW, { id: 'v21', now: 101 })).at(-1)!.name, 'View 2', 'the free number is reused');
  assert.equal(withViewRestored(withViewAdded(freed, DEFAULT_VIEW, { id: 'v21', now: 101 }), 'v2', 102), null,
    'Undo past the cap is refused too');
});

test('changing a view keeps fields this version does not know; deleting leaves a tombstone that Undo removes', () => {
  const stored = [
    { id: 'a', name: 'Hero', position: [1, 1, 1], target: [0, 1, 0], roll: 0, createdAt: 1, updatedAt: 1, lens: 'wide' },
    { id: 'b', shape: 'from a newer site' }, // unreadable here: kept, never shown
  ];
  assert.deepEqual(liveViews(stored).map(v => v.id), ['a']);
  const renamed = withViewRenamed(stored, 'a', '  Close   up ', 5);
  assert.deepEqual(renamed[0], { ...stored[0], name: 'Close up', updatedAt: 5 });
  assert.equal(renamed[1], stored[1]);
  assert.deepEqual(withViewRenamed(stored, 'a', '   ', 6), stored, 'a blank name changes nothing');

  const deleted = withViewDeleted(renamed, 'a', 7);
  assert.deepEqual(deleted[0], { ...renamed[0], deletedAt: 7, updatedAt: 7 }, 'the entry stays, marked deleted');
  assert.deepEqual(liveViews(deleted), []);
  assert.ok(hasDeletedView(deleted, 'a'));
  const restored = withViewRestored(deleted, 'a', 8)!;
  assert.deepEqual(restored[0], { ...renamed[0], updatedAt: 8 });
  assert.equal(liveViews(restored)[0].name, 'Close up');
  assert.equal(viewsWritable({ some: 'newer format' }), false);
  assert.equal(viewsWritable(undefined), true);
});

function harness() {
  const backend = new MemoryBackend(true), storage = memoryStorage(), timers = manualScheduler();
  let time = 1_000, id = 0;
  const open = (extra: Partial<LibraryOptions> = {}) => OutfitLibrary.open({ backend, journal: storageJournal(storage),
    schedule: timers.schedule, now: () => time, newId: () => `outfit-${++id}`, ...extra });
  return { backend, storage, timers, open, tick: () => { time += 1000; } };
}
const storedRecord = async (backend: MemoryBackend, id: string) =>
  (await backend.readAll()).find(raw => (raw as { id: string }).id === id) as Record<string, unknown>;

test('a saved view survives a tab killed before the write, and other edits of the outfit', async () => {
  const h = harness();
  const tab = await h.open();
  const record = tab.create({ name: 'Outfit 1', slots: { face: 'a' }, generated: true })!;
  await tab.flush();
  const views = withViewAdded(undefined, tilted, { id: 'v1', now: 5 })!;
  tab.setCameraViews(record.id, views);
  assert.equal(tab.get(record.id)!.generated, undefined, 'a saved view makes the outfit hand work Randomise must keep');
  // Killed before the debounced write: the view lives only in the journal.
  const next = await h.open();
  assert.deepEqual(next.get(record.id)!.cameraViews, views, 'replayed from the journal, not settled away as "same"');
  await next.flush();
  next.setContent(record.id, { face: 'a', feet: 'b' }, undefined, false);
  next.rename(record.id, 'Renamed');
  await next.flush();
  assert.deepEqual((await storedRecord(h.backend, record.id)).cameraViews, views, 'edits elsewhere keep the views');
  const copy = next.duplicate(record.id)!;
  assert.deepEqual(copy.cameraViews, views, 'a duplicate keeps them');
});

test('a views value this version cannot read is kept through every write', async () => {
  const h = harness();
  const newer = { format: 2, views: ['opaque'] };
  await h.backend.update('x', () => ({ v: 1, id: 'x', rev: 1, name: 'From later', createdAt: 1, updatedAt: 1,
    slots: { face: 'a' }, cameraViews: newer }));
  const tab = await h.open();
  tab.setContent('x', { face: 'b' }, undefined, false);
  await tab.flush();
  assert.deepEqual((await storedRecord(h.backend, 'x')).cameraViews, newer);
});

// ---------------------------------------------------------------------------------------------------------------------
// The builder's actions (store/useSavedOutfits.ts) and a link's view (store/open-link.ts).

let backend: MemoryBackend;
async function visit(options: { cap?: number } = {}) {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  let n = 0;
  await startSavedOutfits({ library: { backend, journal: storageJournal(memoryStorage()), schedule: manualScheduler().schedule,
    newId: () => `o-${++n}-${Math.random().toString(36).slice(2, 6)}`, cap: options.cap }, confirm: () => true });
  openLink(SITE); // what main.tsx does at boot: the last outfit, or a first one, goes on screen
}
const library = () => useSavedOutfits.getState().library!;
const shown = () => { const c = library().current; return c?.kind === 'record' ? library().outfits.find(r => r.id === c.id) : undefined; };

test('saving, renaming and deleting views edits the outfit on screen; Undo finds the outfit after a switch', async () => {
  backend = new MemoryBackend(true);
  await visit();
  const first = shown()!;
  const saved = saveCameraView(tilted);
  assert.deepEqual(saved, { ok: true, name: 'View 1' });
  const id = liveViews(shown()!.cameraViews)[0].id;
  renameCameraView(id, 'Hero shot');
  assert.equal(liveViews(shown()!.cameraViews)[0].name, 'Hero shot');

  // Randomise leaves an outfit with a saved view alone: the roll goes into an outfit of its own.
  randomiseOutfit({ face: 'head-face-01-base' });
  assert.notEqual(shown()!.id, first.id);
  assert.equal(liveViews(library().outfits.find(r => r.id === first.id)!.cameraViews).length, 1);

  selectOutfit(first.id);
  const undo = deleteCameraView(id)!;
  assert.deepEqual(liveViews(shown()!.cameraViews), []);
  assert.equal(newOutfit(), true);
  assert.deepEqual(undo(), { ok: true, name: 'Hero shot' }, 'Undo restores it on its own outfit, not the one on screen');
  assert.deepEqual(liveViews(shown()!.cameraViews), []);
  assert.equal(liveViews(library().outfits.find(r => r.id === first.id)!.cameraViews)[0].name, 'Hero shot');
  await flushSavedOutfits();

  await visit(); // a reload
  assert.equal(liveViews(library().outfits.find(r => r.id === first.id)!.cameraViews)[0].name, 'Hero shot');
});

test('a view saved on an opened link makes it a saved outfit; at the cap it stays on the draft', async () => {
  backend = new MemoryBackend(true);
  await visit();
  openLink(buildShareUrl(SITE, look));
  assert.equal(library().current?.kind, 'draft');
  assert.equal(saveCameraView(tilted).ok, true);
  assert.equal(library().current?.kind, 'record');
  assert.equal(liveViews(shown()!.cameraViews).length, 1);

  backend = new MemoryBackend(true);
  await visit({ cap: 1 });
  useBuildStore.getState().equip(getItemById('hairs-afrofade')!); // the one saved outfit, hand-made
  openLink(buildShareUrl(SITE, { build: outfit, bodyType: 'androgynous' }));
  assert.equal(saveCameraView(tilted).ok, true);
  const current = library().current;
  assert.equal(current?.kind, 'draft', 'at the cap nothing is evicted');
  assert.equal(current?.kind === 'draft' && liveViews(current.draft.cameraViews).length, 1, 'the view is kept on the draft');
  assert.equal(useSavedOutfits.getState().toast?.message.includes('for this visit only'), true);
});

test("a link's view goes to the viewer only when its outfit opened", async () => {
  backend = new MemoryBackend(true);
  await visit();
  openLink(buildShareUrl(SITE, look, 'short', null, tilted));
  assert.deepEqual(pendingView(), roundView(tilted));
  takePendingView();
  openLink(`${SITE}#/?o=2.zzzzz&view=0_1_2_0_1_0`); // an unreadable outfit code
  assert.equal(pendingView(), null);
  openLink(buildShareUrl(SITE, look)); // no view: the camera stays where it is
  assert.equal(pendingView(), null);
});
