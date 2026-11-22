// Squads, storage core (22 Nov 2026, multi-character Phase 2): the loss paths. A tab killed mid-drag, two tabs on one
// squad (different contestants merge; the same contestant keeps both), an outfit deleted or edited under a squad, an
// item gone from the catalogue, records from a newer version, unknown fields, writes that must not rebuild the squad,
// tombstones and undo, caps, and squads kept apart from saved outfits in every browser store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutfitLibrary, type OutfitBackend } from '../src/lib/outfit-library';
import { LocalStorageBackend, MemoryBackend, OUTFIT_STORAGE, storageJournal } from '../src/lib/outfit-storage';
import {
  SQUAD_STORAGE, SquadLibrary, contestantFromOutfit, openSquadStorage, type SquadLibraryOptions,
} from '../src/lib/squad-library';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

function harness(backend: OutfitBackend = new MemoryBackend(true), storage = memoryStorage()) {
  const timers = manualScheduler();
  let time = 1_000;
  let id = 0;
  const open = (extra: Partial<SquadLibraryOptions> = {}) => SquadLibrary.open({
    backend, journal: storageJournal(storage, SQUAD_STORAGE.journal), schedule: timers.schedule, now: () => time,
    newId: () => `rec-${++id}`, ...extra,
  });
  return { backend, storage, timers, open, tick: (ms = 1000) => { time += ms; } };
}

const stored = async (backend: OutfitBackend, id: string) =>
  (await backend.readAll()).find(raw => (raw as { id: string }).id === id) as Record<string, unknown> | undefined;
const at = (x: number) => ({ x, z: 0, yaw: 0 });
const outfit = (face: string) => ({ slots: { face }, place: at(0) });

test('a tab killed mid-drag is recovered from the journal: the last position survives', async () => {
  const h = harness();
  const tab = await h.open();
  const squad = tab.createSquad()!;
  const a = tab.addContestant(squad.id, outfit('a'))!;
  await tab.flush();
  for (const x of [0.1, 0.2, 0.35]) tab.updateContestant(a.id, { place: at(x) });
  assert.equal(h.timers.pending, 1, 'the backend write is still waiting on its debounce');
  const next = await h.open(); // killed: nothing flushed
  assert.deepEqual(next.snapshot().contestants[squad.id].map(c => c.place.x), [0.35]);
  await next.flush();
  assert.equal(((await stored(h.backend, a.id))?.place as { x: number }).x, 0.35);
  assert.deepEqual(h.storage.keys().filter(key => key.includes('journal')), [], 'the journal is settled once written');
});

test('two tabs editing different contestants of one squad merge contestant by contestant, without a copy', async () => {
  const h = harness();
  const first = await h.open();
  const squad = first.createSquad()!;
  const a = first.addContestant(squad.id, outfit('a'))!;
  const b = first.addContestant(squad.id, outfit('b'))!;
  await first.flush();
  const second = await h.open();
  first.updateContestant(a.id, { place: at(-0.9) });
  second.updateContestant(b.id, { slots: { face: 'b2' } });
  await first.flush();
  await second.flush();
  await first.refresh(); // in the browser the channel triggers these
  await second.refresh();
  for (const tab of [first, second]) {
    const list = tab.snapshot().contestants[squad.id];
    assert.equal(list.length, 2, 'no extra contestant');
    assert.equal(list.find(c => c.id === a.id)?.place.x, -0.9);
    assert.deepEqual(list.find(c => c.id === b.id)?.slots, { face: 'b2' });
    assert.equal(tab.snapshot().notice, undefined);
  }
});

test('two tabs editing the same contestant: the stored one stays and the other is kept as an extra contestant', async () => {
  const h = harness();
  const first = await h.open();
  const squad = first.createSquad()!;
  const a = first.addContestant(squad.id, outfit('a'))!;
  await first.flush();
  const second = await h.open();
  first.updateContestant(a.id, { slots: { face: 'mine' } });
  second.updateContestant(a.id, { slots: { face: 'theirs' } });
  await first.flush();
  await second.flush();
  await second.flush(); // the copy lands
  const faces = second.snapshot().contestants[squad.id].map(c => c.slots.face).sort();
  assert.deepEqual(faces, ['mine', 'theirs'], 'both versions kept');
  assert.match(second.snapshot().notice ?? '', /extra contestant/);
  const backendFaces = (await h.backend.readAll()).filter(r => (r as { kind: string }).kind === 'contestant')
    .map(r => (r as { slots: { face: string } }).slots.face).sort();
  assert.deepEqual(backendFaces, ['mine', 'theirs']);
});

test('a contestant is a copy: every outfit field comes along, and deleting or editing the outfit changes nothing', async () => {
  const outfits = await OutfitLibrary.open({ backend: new MemoryBackend(true), schedule: manualScheduler().schedule });
  const saved = outfits.create({ name: 'Look', slots: { face: 'f', feet: 'x' }, labels: { x: 'Boots X' }, playerNumber: 45 })!;
  const raw = { ...saved, dyes: { feet: '#ff0000' } }; // a field a newer site added to outfits
  const h = harness();
  const tab = await h.open();
  const squad = tab.createSquad()!;
  const c = tab.addContestant(squad.id, contestantFromOutfit(raw, at(0.9), { outfitId: saved.id, name: saved.name }))!;
  await tab.flush();
  const written = await stored(h.backend, c.id);
  assert.deepEqual(written?.slots, { face: 'f', feet: 'x' });
  assert.deepEqual(written?.labels, { x: 'Boots X' });
  assert.equal(written?.playerNumber, 45);
  assert.deepEqual(written?.dyes, { feet: '#ff0000' }, 'unknown outfit fields are copied');
  assert.deepEqual(written?.from, { outfitId: saved.id, name: 'Look' });
  for (const key of ['name', 'generated']) assert.ok(!(key in (written ?? {})), `${key}: outfit bookkeeping not copied`);
  assert.equal(written?.id, c.id, 'its own id, not the outfit\'s');
  outfits.setContent(saved.id, { face: 'other' }, undefined, false);
  outfits.remove(saved.id);
  const reopened = await h.open();
  assert.deepEqual(reopened.snapshot().contestants[squad.id][0].slots, { face: 'f', feet: 'x' });
});

test('an item gone from the catalogue stays on the contestant through every edit', async () => {
  const h = harness();
  const tab = await h.open();
  const squad = tab.createSquad()!;
  const c = tab.addContestant(squad.id, { slots: { face: 'f', hat: 'retired-hat' }, labels: { 'retired-hat': 'Old Hat' }, place: at(0) })!;
  tab.updateContestant(c.id, { place: at(0.5) });
  tab.updateContestant(c.id, { pose: { clip: 'wave', time: 1.2, paused: true } });
  await tab.flush();
  const written = await stored(h.backend, c.id);
  assert.deepEqual(written?.slots, { face: 'f', hat: 'retired-hat' });
  assert.deepEqual(written?.labels, { 'retired-hat': 'Old Hat' });
});

test('records from a newer version are shown and never overwritten: an edit becomes a copy', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('squad-new', () => ({ v: 2, id: 'squad-new', rev: 4, kind: 'squad', name: 'Future', createdAt: 1, updatedAt: 1, lights: [1] }));
  await backend.update('c-new', () => ({ v: 2, id: 'c-new', rev: 3, kind: 'contestant', squad: 'squad-new', createdAt: 1, updatedAt: 1,
    slots: { face: 'f' }, place: { x: 0, z: 0, yaw: 0 }, stand: 'crate' }));
  const before = JSON.stringify(await backend.readAll());
  const h = harness(backend);
  const tab = await h.open();
  assert.equal(tab.snapshot().contestants['squad-new'].length, 1, 'shown');
  tab.updateContestant('c-new', { place: at(1) });
  await tab.flush();
  await tab.flush();
  const records = await backend.readAll() as Record<string, unknown>[];
  assert.equal(JSON.stringify(records.filter(r => r.id === 'c-new' || r.id === 'squad-new')), JSON.stringify(JSON.parse(before)),
    'the newer records are untouched');
  const copy = records.find(r => r.kind === 'contestant' && r.id !== 'c-new');
  assert.equal((copy?.place as { x: number }).x, 1, 'the edit is kept as a copy');
  assert.equal(copy?.stand, 'crate', 'with the fields it carried');
});

test('fields this version does not know survive a write, and a kind it does not know is left alone', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('c1', () => ({ v: 1, id: 'c1', rev: 1, kind: 'contestant', squad: 's1', createdAt: 1, updatedAt: 1,
    slots: { face: 'f' }, place: { x: 0, z: 0, yaw: 0 }, emoteSpeed: 2 }));
  await backend.update('s1', () => ({ v: 1, id: 's1', rev: 1, kind: 'squad', name: 'S', createdAt: 1, updatedAt: 1 }));
  await backend.update('p1', () => ({ v: 1, id: 'p1', rev: 1, kind: 'prop', squad: 's1', model: 'crate' }));
  const tab = await harness(backend).open();
  tab.updateContestant('c1', { place: at(0.4) });
  await tab.flush();
  assert.equal((await stored(backend, 'c1'))?.emoteSpeed, 2);
  assert.deepEqual(await stored(backend, 'p1'), { v: 1, id: 'p1', rev: 1, kind: 'prop', squad: 's1', model: 'crate' });
});

test('an edit never rebuilds the squad: a third contestant a phone does not show keeps its stored record', async () => {
  const h = harness();
  const tab = await h.open();
  const squad = tab.createSquad()!;
  const [a, , c] = ['a', 'b', 'c'].map(face => tab.addContestant(squad.id, outfit(face))!);
  await tab.flush();
  const third = JSON.stringify(await stored(h.backend, c.id));
  const phone = await h.open();
  phone.updateContestant(a.id, { place: at(0.3) });
  phone.updateContestant(a.id, { pose: null });
  await phone.flush();
  assert.equal(JSON.stringify(await stored(h.backend, c.id)), third);
});

test('removing is a tombstone with undo; deleting a squad keeps its contestants; a deletion never beats an edit', async () => {
  const h = harness();
  const first = await h.open();
  const squad = first.createSquad()!;
  const a = first.addContestant(squad.id, outfit('a'))!;
  first.addContestant(squad.id, outfit('b'));
  await first.flush();
  first.remove(a.id);
  await first.flush();
  assert.equal((await stored(h.backend, a.id))?.deletedAt, 1000, 'tombstone kept in storage');
  assert.equal(first.snapshot().contestants[squad.id].length, 1);
  assert.ok(first.undelete(a.id));
  first.remove(squad.id);
  await first.flush();
  assert.equal(first.snapshot().squads.length, 0);
  assert.ok(first.undelete(squad.id));
  assert.equal(first.snapshot().contestants[squad.id].length, 2, 'undo brings the squad back whole');
  await first.flush();
  const second = await h.open();
  second.updateContestant(a.id, { place: at(2) });
  first.remove(a.id);
  await second.flush();
  await first.flush();
  assert.equal(first.get(a.id)?.deletedAt, undefined, 'the other tab\'s edit stays');
  assert.match(first.snapshot().notice ?? '', /not removed/);
});

test('caps refuse instead of evicting; tombstones do not count', async () => {
  const h = harness();
  const tab = await h.open({ cap: 2, contestantCap: 2 });
  const squad = tab.createSquad()!;
  const other = tab.createSquad()!;
  assert.equal(tab.createSquad(), null);
  const a = tab.addContestant(squad.id, outfit('a'))!;
  tab.addContestant(squad.id, outfit('b'));
  assert.equal(tab.addContestant(squad.id, outfit('c')), null);
  tab.remove(a.id);
  assert.ok(tab.addContestant(squad.id, outfit('c')));
  assert.equal(tab.undelete(a.id), false, 'undo refused at the cap, the tombstone kept');
  tab.remove(other.id);
  assert.ok(tab.createSquad());
  // Names skip live squads only, as saved outfits' do.
  assert.deepEqual(tab.snapshot().squads.map(s => s.name).sort(), ['Squad 1', 'Squad 2']);
});

test('two tabs renaming one squad: the other name is kept as a new squad with copies of its contestants', async () => {
  const h = harness();
  const first = await h.open();
  const squad = first.createSquad()!;
  first.addContestant(squad.id, outfit('a'));
  await first.flush();
  const second = await h.open();
  second.select(squad.id);
  first.renameSquad(squad.id, 'Red team');
  second.renameSquad(squad.id, 'Blue team');
  await first.flush();
  await second.flush();
  await second.flush();
  const snap = second.snapshot();
  const names = snap.squads.map(s => s.name).sort();
  assert.deepEqual(names, ['Blue team', 'Red team']);
  const blue = snap.squads.find(s => s.name === 'Blue team')!;
  assert.equal(snap.current, blue.id, 'the tab follows its own version');
  assert.deepEqual(snap.contestants[blue.id].map(c => c.slots.face), ['a']);
});

test('squads and saved outfits never see each other\'s keys in localStorage', async () => {
  const local = memoryStorage();
  const squads = await SquadLibrary.open({ backend: new LocalStorageBackend(local, SQUAD_STORAGE),
    journal: storageJournal(local, SQUAD_STORAGE.journal), schedule: manualScheduler().schedule });
  const squad = squads.createSquad()!;
  squads.addContestant(squad.id, outfit('a'));
  await squads.flush();
  squads.remove(squad.id); // journaled, not yet flushed: a journal key exists too
  const outfits = await OutfitLibrary.open({ backend: new LocalStorageBackend(local), journal: storageJournal(local),
    schedule: manualScheduler().schedule });
  assert.equal(outfits.snapshot().outfits.length, 0, 'no squad record or journal entry read as an outfit');
  outfits.create({ name: 'Mine', slots: { face: 'f' } });
  await outfits.flush();
  const reopened = await SquadLibrary.open({ backend: new LocalStorageBackend(local, SQUAD_STORAGE),
    journal: storageJournal(local, SQUAD_STORAGE.journal), schedule: manualScheduler().schedule });
  assert.equal(reopened.snapshot().squads.length, 0, 'the journaled delete replayed');
  assert.ok(local.keys().some(k => k.startsWith('finals-outfit:outfit:')) && local.keys().some(k => k.startsWith('finals-squad:record:')));
  for (const [a, b] of [[SQUAD_STORAGE, OUTFIT_STORAGE], [OUTFIT_STORAGE, SQUAD_STORAGE]])
    for (const prefix of [a.records, a.journal, a.meta, a.tab])
      assert.ok(![b.records, b.journal].some(other => prefix.startsWith(other)), `${prefix} is outside ${b.db}`);
  assert.notEqual(SQUAD_STORAGE.db, OUTFIT_STORAGE.db);
});

test('without IndexedDB, squad storage falls back to localStorage under its own keys', async () => {
  const local = memoryStorage();
  const opened = await openSquadStorage({ localStorage: local, sessionStorage: memoryStorage() });
  assert.equal(opened.backend.kind, 'localstorage');
  const tab = await SquadLibrary.open({ ...opened, schedule: manualScheduler().schedule });
  tab.createSquad();
  await tab.flush();
  assert.ok(local.keys().every(k => !k.startsWith('finals-outfit:outfit:') && !k.startsWith('finals-outfit:journal:')));
  assert.ok(local.keys().some(k => k.startsWith('finals-squad:record:')));
});
