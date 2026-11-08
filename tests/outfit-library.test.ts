// Saved outfits, storage core (7 Nov 2026): the loss paths. A tab killed mid-session, saving twice, two tabs on
// one outfit, records from a newer version, storage that is missing, hangs or fills up, and the cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutfitLibrary, uniqueName, type LibraryOptions, type OutfitBackend } from '../src/lib/outfit-library';
import { MemoryBackend, openOutfitStorage, storageJournal } from '../src/lib/outfit-storage';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

function harness(backend: OutfitBackend = new MemoryBackend(true), storage = memoryStorage()) {
  const timers = manualScheduler();
  let time = 1_000;
  let id = 0;
  const open = (extra: Partial<LibraryOptions> = {}) => OutfitLibrary.open({
    backend, journal: storageJournal(storage), schedule: timers.schedule, now: () => time,
    newId: () => `outfit-${++id}`, ...extra,
  });
  return { backend, storage, timers, open, tick: (ms = 1000) => { time += ms; } };
}

const stored = async (backend: OutfitBackend, id: string) =>
  (await backend.readAll()).find(raw => (raw as { id: string }).id === id) as Record<string, unknown> | undefined;

test('a tab killed mid-session is recovered from the journal on the next visit', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: { face: 'a' } })!;
  await tab.flush();
  tab.setContent(outfit.id, { face: 'a', feet: 'b' }, undefined, false);
  tab.setContent(outfit.id, { face: 'a', feet: 'c' }, undefined, false);
  assert.equal(h.timers.pending, 1, 'the backend write is still waiting on its debounce');
  // Killed: the debounced write never runs, nothing is flushed.
  const next = await h.open();
  assert.deepEqual(next.get(outfit.id)?.slots, { face: 'a', feet: 'c' }, 'the last edit survives');
  await next.flush();
  assert.deepEqual((await stored(h.backend, outfit.id))?.slots, { face: 'a', feet: 'c' });
  assert.equal(next.snapshot().outfits.length, 1, 'no duplicate outfit');
  assert.deepEqual(h.storage.keys().filter(key => key.includes('journal')), [], 'the journal is settled once written');
});

test('without a journal, a kill costs only the edits still inside the debounce window', async () => {
  const h = harness();
  const tab = await h.open({ journal: undefined });
  const outfit = tab.create({ name: 'Outfit 1', slots: { face: 'a' } })!;
  tab.setContent(outfit.id, { face: 'b' }, undefined, false);
  await tab.flush();
  tab.setContent(outfit.id, { face: 'c' }, undefined, false);
  const next = await h.open({ journal: undefined });
  assert.deepEqual(next.get(outfit.id)?.slots, { face: 'b' });
});

test('saving twice: rapid edits and repeated flushes land once, in order, without forking', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: {} })!;
  for (const face of ['a', 'b', 'c']) tab.setContent(outfit.id, { face }, undefined, false);
  await Promise.all([tab.flush(), tab.flush()]);
  await tab.flush();
  const record = await stored(h.backend, outfit.id);
  assert.deepEqual(record?.slots, { face: 'c' });
  assert.equal(record?.rev, tab.get(outfit.id)?.rev);
  assert.equal(tab.snapshot().outfits.length, 1);
  assert.equal(tab.snapshot().status, 'saved');
  assert.equal(tab.snapshot().notice, undefined);
});

test('an edit made while a write is in flight is written next, not lost or forked', async () => {
  const backend = new MemoryBackend(true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let gated = false;
  const slow: OutfitBackend = { ...backend, kind: 'memory', persistent: true,
    readAll: () => backend.readAll(), readMeta: () => backend.readMeta(), updateMeta: fn => backend.updateMeta(fn),
    update: async (id, fn) => { if (gated) await gate; return backend.update(id, fn); } };
  const h = harness(slow);
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: { face: 'a' } })!;
  await tab.flush();
  gated = true;
  tab.setContent(outfit.id, { face: 'b' }, undefined, false);
  const first = tab.flush();
  tab.setContent(outfit.id, { face: 'c' }, undefined, false);
  release();
  await first;
  await tab.flush();
  assert.deepEqual((await stored(backend, outfit.id))?.slots, { face: 'c' });
  assert.equal(tab.snapshot().outfits.length, 1, 'its own earlier write is not a conflict');
});

test('two tabs: a divergent edit is kept as a copy; a tab with no changes takes the stored version', async () => {
  const h = harness();
  const a = await h.open();
  const outfit = a.create({ name: 'Look', slots: { face: 'a' } })!;
  await a.flush();
  const b = await h.open();
  a.select(outfit.id);
  b.select(outfit.id);
  a.setContent(outfit.id, { face: 'from-a' }, undefined, false);
  await a.flush();
  b.setContent(outfit.id, { face: 'from-b' }, undefined, false);
  await b.flush();
  await b.flush(); // writes the fork
  const all = (await h.backend.readAll()) as { id: string; name: string; slots: object }[];
  assert.deepEqual(all.find(r => r.id === outfit.id)?.slots, { face: 'from-a' }, "tab A's write is not overwritten");
  const fork = all.find(r => r.id !== outfit.id);
  assert.equal(fork?.name, 'Look (2)');
  assert.deepEqual(fork?.slots, { face: 'from-b' }, "tab B's edit is kept");
  assert.deepEqual(b.getCurrent(), { kind: 'record', id: fork!.id }, 'tab B carries on in its copy');
  assert.match(b.snapshot().notice ?? '', /another tab/);

  // A has no pending changes, so it adopts what B writes next.
  b.rename(outfit.id, 'Renamed in B');
  await b.flush();
  await a.refresh();
  assert.equal(a.get(outfit.id)?.name, 'Renamed in B');
  assert.equal(a.snapshot().outfits.length, 2);
});

test("a tab opening meanwhile replays a live tab's journal without making that tab fork", async () => {
  const h = harness();
  const a = await h.open();
  const outfit = a.create({ name: 'Look', slots: { face: 'a' } })!;
  await a.flush();
  a.setContent(outfit.id, { face: 'b' }, undefined, false); // journaled, not yet written
  const b = await h.open();
  await b.flush(); // B writes A's journaled revision
  a.setContent(outfit.id, { face: 'c' }, undefined, false);
  await a.flush();
  assert.deepEqual((await stored(h.backend, outfit.id))?.slots, { face: 'c' });
  assert.equal((await h.backend.readAll()).length, 1, 'no fork');
});

test('fields this version does not know survive every write, and meta keeps its own', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('old', () => ({ v: 1, id: 'old', rev: 4, name: 'Old', createdAt: 1, updatedAt: 2,
    slots: { face: 'a', futureSlot: 'x' }, future: { syncId: 'remote-9' } }));
  await backend.updateMeta(() => ({ v: 1, currentId: 'old', theme: 'dark' }));
  const h = harness(backend);
  const tab = await h.open();
  tab.select('old');
  tab.rename('old', 'Renamed');
  tab.setContent('old', { face: 'b', futureSlot: 'x' }, undefined, false);
  await tab.flush();
  let record = await stored(backend, 'old');
  assert.deepEqual(record?.future, { syncId: 'remote-9' });
  assert.equal(record?.name, 'Renamed');
  assert.deepEqual(record?.slots, { face: 'b', futureSlot: 'x' });
  assert.equal(((await backend.readMeta()) as { theme: string }).theme, 'dark');
  tab.remove('old');
  await tab.flush();
  record = await stored(backend, 'old');
  assert.equal(typeof record?.deletedAt, 'number', 'deleting writes a tombstone');
  assert.deepEqual(record?.future, { syncId: 'remote-9' });
  const copy = tab.duplicate('old');
  assert.equal(copy, null, 'a deleted outfit is not duplicated');
});

test('a duplicate gets a new id and does not copy fields it does not understand', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('old', () => ({ v: 1, id: 'old', rev: 1, name: 'Old', createdAt: 1, updatedAt: 1,
    slots: { face: 'a' }, future: { syncId: 'remote-9' } }));
  const tab = await harness(backend).open();
  const copy = tab.duplicate('old')!;
  assert.notEqual(copy.id, 'old');
  assert.equal(copy.name, 'Old copy');
  assert.equal(copy.future, undefined);
  assert.equal(tab.duplicate('old')?.name, 'Old copy 2');
});

test('an outfit saved by a newer version is never overwritten: edits go to a copy', async () => {
  const backend = new MemoryBackend(true);
  const newer = { v: 2, id: 'n', rev: 3, name: 'Newer', createdAt: 1, updatedAt: 1, slots: { face: 'a' }, shape: 'v2' };
  await backend.update('n', () => newer);
  const tab = await harness(backend).open();
  tab.select('n');
  tab.setContent('n', { face: 'b' }, undefined, false);
  await tab.flush();
  await tab.flush();
  assert.deepEqual(await stored(backend, 'n'), newer);
  const copy = tab.snapshot().outfits.find(r => r.id !== 'n');
  assert.deepEqual(copy?.slots, { face: 'b' });
  assert.match(tab.snapshot().notice ?? '', /newer version/);
});

test('deleting is a tombstone with undo, and never beats another tab\'s edit', async () => {
  const h = harness();
  const a = await h.open();
  const outfit = a.create({ name: 'Look', slots: { face: 'a' } })!;
  await a.flush();
  a.remove(outfit.id);
  assert.equal(a.snapshot().outfits.length, 0);
  assert.equal(a.undelete(outfit.id), true);
  await a.flush();
  assert.equal((await stored(h.backend, outfit.id))?.deletedAt, undefined, 'undelete clears the tombstone');

  const b = await h.open();
  b.setContent(outfit.id, { face: 'edited in b' }, undefined, false);
  await b.flush();
  a.remove(outfit.id);
  await a.flush();
  const record = await stored(h.backend, outfit.id);
  assert.equal(record?.deletedAt, undefined, "B's edit survives A's delete");
  assert.deepEqual(record?.slots, { face: 'edited in b' });
  assert.match(a.snapshot().notice ?? '', /not deleted/);
});

test('the cap refuses new outfits instead of evicting; tombstones do not count', async () => {
  const tab = await harness().open({ cap: 3 });
  const made = ['A', 'B', 'C'].map(name => tab.create({ name, slots: {} })!);
  assert.equal(tab.create({ name: 'D', slots: {} }), null);
  assert.equal(tab.duplicate(made[0].id), null);
  assert.deepEqual(tab.snapshot().outfits.map(r => r.name).sort(), ['A', 'B', 'C'], 'nothing was evicted');
  tab.remove(made[0].id);
  assert.ok(tab.create({ name: 'D', slots: {} }));
  assert.equal(tab.undelete(made[0].id), false, 'undelete at the cap is refused, not forced');
});

test('a failing write keeps the change, says so, and lands once storage recovers', async () => {
  const backend = new MemoryBackend(true);
  let full = false;
  const flaky: OutfitBackend = { kind: 'memory', persistent: true, readAll: () => backend.readAll(),
    readMeta: () => backend.readMeta(), updateMeta: fn => backend.updateMeta(fn),
    update: async (id, fn) => {
      if (full) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      return backend.update(id, fn);
    } };
  const h = harness(flaky);
  const tab = await h.open();
  const outfit = tab.create({ name: 'Look', slots: { face: 'a' } })!;
  await tab.flush();
  full = true;
  tab.setContent(outfit.id, { face: 'b' }, undefined, false);
  await tab.flush();
  assert.equal(tab.snapshot().status, 'error');
  assert.match(tab.snapshot().error ?? '', /QuotaExceededError/);
  assert.deepEqual(tab.get(outfit.id)?.slots, { face: 'b' }, 'still on screen');
  assert.ok(h.storage.keys().some(key => key.endsWith(outfit.id)), 'still journaled');
  full = false;
  await tab.flush();
  assert.equal(tab.snapshot().status, 'saved');
  assert.deepEqual((await stored(backend, outfit.id))?.slots, { face: 'b' });
});

test('outfits wiped from storage under an open tab are written back', async () => {
  const backend = new MemoryBackend(true);
  const tab = await harness(backend).open();
  const outfit = tab.create({ name: 'Look', slots: { face: 'a' } })!;
  await tab.flush();
  backend.records.clear();
  await tab.refresh();
  await tab.flush();
  assert.deepEqual((await stored(backend, outfit.id))?.slots, { face: 'a' });
});

test('no usable storage: the library still works in memory and reports saving as off', async () => {
  const blocked = memoryStorage({ failWrites: true });
  const factory = { open() { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); } } as unknown as IDBFactory;
  const storage = await openOutfitStorage({ indexedDB: factory, localStorage: blocked, sessionStorage: blocked });
  assert.equal(storage.backend.kind, 'memory');
  assert.equal(storage.backend.persistent, false);
  assert.equal(storage.journal, undefined);
  const tab = await OutfitLibrary.open({ ...storage, schedule: manualScheduler().schedule });
  const outfit = tab.create({ name: 'Look', slots: { face: 'a' } })!;
  tab.setContent(outfit.id, { face: 'b' }, undefined, false);
  await tab.flush();
  assert.equal(tab.snapshot().status, 'off');
  assert.deepEqual(tab.get(outfit.id)?.slots, { face: 'b' });
});

test('an IndexedDB open that never answers falls back to localStorage', async () => {
  const hanging = { open: () => ({}) } as unknown as IDBFactory;
  const local = memoryStorage();
  const storage = await openOutfitStorage({ indexedDB: hanging, localStorage: local, timeoutMs: 20 });
  assert.equal(storage.backend.kind, 'localstorage');
  const tab = await OutfitLibrary.open({ ...storage, schedule: manualScheduler().schedule });
  tab.create({ name: 'Look', slots: { face: 'a' } });
  await tab.flush();
  assert.ok(local.keys().some(key => key.startsWith('finals-outfit:outfit:')));
});

test('names: numbered, unique, clipped', () => {
  assert.equal(uniqueName('Outfit', [], { numberFirst: true }), 'Outfit 1');
  assert.equal(uniqueName('Outfit', ['Outfit 1', 'outfit 2'], { numberFirst: true }), 'Outfit 3');
  assert.equal(uniqueName('Look', ['Look', 'Look (2)'], { paren: true }), 'Look (3)');
  assert.equal(uniqueName('x'.repeat(60), ['x'.repeat(40)]).length, 40);
});
