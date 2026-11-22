// The squad page's actions (src/store/useSquads.ts, 22 Nov 2026): opening the page writes nothing, the first Add makes
// a squad, and deleting the last squad then pressing Undo brings it back whole without leaving a stray empty squad (the
// production checklist run found a replacement "Squad 1" beside the restored one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../src/lib/outfit-storage';
import { addContestant, deleteSquad, newSquad, startSquads, stopSquads, useSquads } from '../src/store/useSquads';

const source = (face: string) => ({ slots: { face }, name: `Outfit ${face}` });
const snap = () => useSquads.getState().snapshot!;

test('opening the page writes nothing; the first Add makes Squad 1', async () => {
  stopSquads();
  const backend = new MemoryBackend(true);
  await startSquads({ backend });
  assert.equal(snap().current, null);
  assert.equal(snap().squads.length, 0);
  assert.equal((await backend.readAll()).length, 0, 'no record for a visit');
  assert.ok(addContestant(source('a')));
  assert.deepEqual(snap().squads.map(s => s.name), ['Squad 1']);
  assert.equal(snap().contestants[snap().current!].length, 1);
  stopSquads();
});

test('deleting the last squad leaves none; Undo brings it back with its contestants and no stray squad', async () => {
  stopSquads();
  await startSquads({ backend: new MemoryBackend(true) });
  addContestant(source('a'));
  addContestant(source('b'));
  const id = snap().current!;
  const undo = deleteSquad(id);
  assert.equal(snap().current, null);
  assert.equal(snap().squads.length, 0, 'no replacement squad is made');
  assert.ok(undo());
  assert.deepEqual(snap().squads.map(s => s.id), [id]);
  assert.equal(snap().current, id);
  assert.deepEqual(snap().contestants[id].map(c => c.slots.face), ['a', 'b']);
  stopSquads();
});

test('deleting one of two squads selects the other; an Add after deleting the last makes a new one', async () => {
  stopSquads();
  await startSquads({ backend: new MemoryBackend(true) });
  addContestant(source('a'));
  const first = snap().current!;
  assert.ok(newSquad());
  const second = snap().current!;
  assert.notEqual(second, first);
  deleteSquad(second);
  assert.equal(snap().current, first);
  deleteSquad(first);
  assert.equal(snap().current, null);
  assert.ok(addContestant(source('c')));
  assert.equal(snap().squads.length, 1);
  assert.notEqual(snap().current, first);
  assert.deepEqual(snap().contestants[snap().current!].map(c => c.slots.face), ['c']);
  stopSquads();
});
