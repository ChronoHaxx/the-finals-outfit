// Takes (22 Nov 2026): the model (lib/video-take.ts), storage (lib/take-store.ts) and recorder (lib/take-recorder.ts).
// The loss paths first: a tab killed mid-recording, the cap with unrendered takes, a full disk, a take discarded in
// another tab, fields from a newer version; then how samples replay (ideal clocks, scrubs, crossfades, the camera) and
// the sound segments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TAKES, TakeTimeline, decodeSamples, encodeSamples, lookAt, slerp, type TakeAction, type TakeSample } from '../src/lib/video-take';
import { MemoryTakeBackend, STALE_MS, TakeLibrary, type TakeMeta } from '../src/lib/take-store';
import { TakeRecorder } from '../src/lib/take-recorder';

const still = { position: [0, 1, 3] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number], fov: 40,
  target: [0, 1, 0] as [number, number, number], yaw: 0, sway: true, moving: true, audible: true };
const act = (clip: string, time: number, extra: Partial<TakeAction> = {}): TakeAction =>
  ({ clip, time, weight: 1, rate: 1, loop: false, front: true, ...extra });
const sample = (t: number, actions: TakeAction[], extra: Partial<TakeSample> = {}): TakeSample => ({ ...still, t, actions, ...extra });
const lengths: Record<string, number> = { clap: 4, idle: 2, wave: 3 };
const length = (clip: string) => lengths[clip] ?? 0;

// ------------------------------------------------------------------ storage and recording: the loss paths

function rig(backend = new MemoryTakeBackend(true)) {
  let ms = 0, wall = 1_000_000, id = 0;
  const library = new TakeLibrary(backend, () => wall);
  const own = new Set<string>();
  const begin = (name = 'Take') => TakeRecorder.begin({ library, own, name, mode: 'global', now: () => ms, clock: () => wall,
    newId: () => `t${++id}`, look: () => look, probe: () => ({ ...still, actions: [act('clap', ms / 1000)] }) });
  let look: unknown = { exposure: 1 };
  return { backend, library, own, begin, setLook: (next: unknown) => { look = next; },
    advance: (seconds: number, recorder: TakeRecorder) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) { ms += 1000 / 60; wall += 1000 / 60; recorder.sample(); }
    },
    later: (millis: number) => { wall += millis; } };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a tab killed mid-recording keeps everything up to the last saved second, listed as interrupted', async () => {
  const r = rig();
  const started = await r.begin();
  assert.ok('recorder' in started);
  const recorder = started.recorder;
  r.advance(2.5, recorder);
  await recorder.flush(); // what the periodic saves had written by now (2 s) plus this one: as a hidden page would
  r.advance(0.4, recorder); // never saved: the tab dies here
  const library = new TakeLibrary(r.backend, () => 1_000_000 + 3000 + STALE_MS);
  const [entry] = await library.list();
  assert.equal(entry.state, 'interrupted');
  const loaded = await library.load(entry.meta.id);
  assert.ok(loaded);
  assert.ok(loaded.samples.length >= 149 && loaded.samples.length <= 151, `${loaded.samples.length} samples saved`);
  assert.ok(Math.abs(loaded.samples.at(-1)!.t - 2.5) < 0.02);
  assert.equal(loaded.events.length, 1, 'the look at the start');
});

test('saves come every second while recording, and Stop saves the rest and marks it done', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  // A browser's frames are separate tasks: a save runs between them (here, between the seconds).
  for (const seconds of [1.05, 1, 1.1]) { r.advance(seconds, recorder); await settle(); }
  assert.equal(r.backend.stored.get(recorder.id)?.size, 3, 'a chunk at 1, 2 and 3 s');
  r.setLook({ exposure: 2 });
  r.advance(0.5, recorder);
  await recorder.stop();
  const loaded = await r.library.load(recorder.id);
  assert.equal(loaded?.meta.status, 'done');
  assert.equal(loaded?.samples.length, recorder.samples.length);
  assert.deepEqual(loaded?.events.map(e => (e.look as { exposure: number }).exposure), [1, 2]);
  assert.equal((await r.library.list())[0].state, 'done');
});

test('this tab’s own recording is never taken for interrupted, even when a save is late', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  r.advance(0.5, recorder);
  r.later(STALE_MS * 2);
  assert.equal((await r.library.list(r.own))[0].state, 'recording');
  assert.equal((await r.library.list())[0].state, 'interrupted', 'another tab would say interrupted');
  await recorder.stop();
  assert.equal(r.own.size, 0);
});

test('a full disk: the samples stay in memory, the panel is told, and the next save writes them all', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  r.backend.failWrites = true;
  r.advance(2.2, recorder);
  await settle(); await settle();
  assert.match(recorder.saveError ?? '', /out of space/);
  assert.equal(recorder.data().samples.length, recorder.samples.length, 'renderable from memory');
  r.backend.failWrites = false;
  await recorder.stop();
  assert.equal(recorder.saveError, null);
  const loaded = await r.library.load(recorder.id);
  assert.equal(loaded?.samples.length, recorder.samples.length, 'nothing dropped');
  assert.equal(loaded?.meta.status, 'done');
});

test('the cap: the oldest rendered take makes room; unrendered takes are never evicted, recording is refused', async () => {
  const r = rig();
  for (let i = 0; i < MAX_TAKES; i++) {
    const { recorder } = await r.begin(`Take ${i + 1}`) as { recorder: TakeRecorder };
    r.advance(0.1, recorder);
    await recorder.stop();
  }
  const metas = (await r.library.list()).map(e => e.meta).sort((a, b) => a.createdAt - b.createdAt);
  // Nothing rendered: refused, every take kept.
  const refused = await r.begin('Take 11');
  assert.ok('refused' in refused && refused.refused.ok === false && refused.refused.reason === 'full');
  assert.equal((await r.library.list()).length, MAX_TAKES);
  // Takes 3 and 5 rendered: take 3 (the older) makes room for the next one.
  await r.library.update(metas[4].id, { renderedAt: 2 });
  await r.library.update(metas[2].id, { renderedAt: 1 });
  const next = await r.begin('Take 11');
  assert.ok('recorder' in next);
  assert.deepEqual(next.evicted.map(m => m.name), ['Take 3']);
  const names = (await r.library.list()).map(e => e.meta.name);
  assert.equal(names.length, MAX_TAKES);
  assert.ok(names.includes('Take 1') && names.includes('Take 5') && !names.includes('Take 3'));
  assert.equal(r.backend.stored.has(metas[2].id), false, 'its chunks went with it');
});

test('rendering marks a take, never deletes it; Discard deletes the record and every chunk', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  r.advance(1.5, recorder);
  await recorder.stop();
  await r.library.update(recorder.id, { renderedAt: 123 });
  const [entry] = await r.library.list();
  assert.equal(entry.meta.renderedAt, 123);
  assert.ok((await r.library.load(recorder.id))?.samples.length);
  await r.library.discard(recorder.id);
  assert.equal((await r.library.list()).length, 0);
  assert.equal(r.backend.stored.has(recorder.id), false);
});

test('a take discarded in another tab while this one records: recording stops, nothing brings it back', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  r.advance(1.2, recorder);
  await settle();
  await new TakeLibrary(r.backend).discard(recorder.id);
  r.advance(1.2, recorder);
  await settle(); await settle();
  assert.equal(recorder.state, 'stopped');
  assert.equal(recorder.stopReason, 'gone');
  assert.equal((await r.library.list()).length, 0);
  assert.equal(r.backend.stored.has(recorder.id), false);
});

test('fields a newer version wrote survive every save', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  const stored = r.backend.records.get(recorder.id) as Record<string, unknown>;
  r.backend.records.set(recorder.id, { ...stored, colourGrade: 'warm', clips: ['from-newer'] });
  r.advance(1.1, recorder);
  await recorder.stop();
  await r.library.update(recorder.id, { renderedAt: 5 });
  const raw = r.backend.records.get(recorder.id) as Record<string, unknown>;
  assert.equal(raw.colourGrade, 'warm');
  assert.deepEqual(raw.clips, ['from-newer', 'clap'], 'clips only grow');
});

test('a recording stops by itself at the length cap, saved', async () => {
  const r = rig();
  const { recorder } = await r.begin() as { recorder: TakeRecorder };
  r.advance(181, recorder);
  await settle(); await settle();
  await recorder.stop(); // a no-op once stopped: resolves when its saves have
  assert.equal(recorder.stopReason, 'limit');
  assert.ok(recorder.elapsed >= 180 && recorder.elapsed < 180.05);
  assert.equal((await r.library.load(recorder.id))?.meta.status, 'done');
});

// ------------------------------------------------------------------ samples

test('samples round-trip through their encoding; a write cut short loses only its tail', () => {
  const clips: string[] = [];
  const samples = [sample(0, [act('clap', 0.5), act('idle', 1.25, { weight: 0.25, rate: 0, loop: true, front: false })]),
    sample(0.0167, [act('wave', 2, { front: true })], { sway: false, audible: false, yaw: 0.5 })];
  const encoded = encodeSamples(samples, clips);
  assert.deepEqual(clips, ['clap', 'idle', 'wave']);
  assert.deepEqual(decodeSamples(encoded, clips), samples);
  assert.deepEqual(decodeSamples(encoded.slice(0, encoded.length - 3), clips), samples.slice(0, 1));
  assert.deepEqual(decodeSamples(encoded, ['clap']), samples.slice(0, 0).concat(), 'an unknown clip index ends the read');
});

test('between few samples a playing clip moves smoothly, at the pace the viewer saw', () => {
  // Recorded at 10 fps: the clip's own clock, exactly, at every 60 fps frame between the samples.
  const steady = new TakeTimeline(Array.from({ length: 11 }, (_, i) => sample(i * 0.1, [act('clap', i * 0.1)])), length);
  for (let frame = 0; frame <= 60; frame++) assert.ok(Math.abs(steady.frameAt(frame / 60).actions[0].time - frame / 60) < 1e-9, `frame ${frame}`);
  // Under 10 fps the mixer advanced only 0.08 s per 0.1 s: the video keeps that pace, evenly, never jumping back.
  const slow = new TakeTimeline(Array.from({ length: 41 }, (_, i) => sample(i * 0.1, [act('clap', i * 0.08)])), length);
  let last = -1;
  for (let frame = 0; frame <= 240; frame++) {
    const time = slow.frameAt(frame / 60).actions[0].time;
    assert.ok(Math.abs(time - 0.8 * frame / 60) < 1e-9 && time > last, `frame ${frame}: ${time}`);
    last = time;
  }
});

test('a seek, a loop wrap, a speed change', () => {
  const timeline = new TakeTimeline([
    sample(0, [act('clap', 0)]), sample(0.5, [act('clap', 0.5)]),
    sample(1, [act('clap', 3)]), // a seek forward
    sample(1.5, [act('idle', 1.9, { loop: true, front: false })]), sample(2, [act('idle', 0.4, { loop: true, front: false })]), // wraps at 2 s
    sample(2.5, [act('wave', 1, { rate: 0.5 })]), sample(3, [act('wave', 1.25, { rate: 0.5 })]),
  ], length);
  assert.ok(Math.abs(timeline.frameAt(0.75).actions[0].time - 0.75) < 1e-9, 'before the seek: its own clock');
  assert.ok(Math.abs(timeline.frameAt(1.25).actions.find(a => a.clip === 'clap')!.time - 3.25) < 1e-9, 'after: from the seek');
  assert.ok(Math.abs(timeline.frameAt(1.9).actions.find(a => a.clip === 'idle')!.time - 0.3) < 1e-9, 'wrapped');
  assert.ok(Math.abs(timeline.frameAt(2.9).actions.find(a => a.clip === 'wave')!.time - 1.2) < 1e-9, 'half speed');
});

test('a held clip (a timeline drag) is interpolated between samples; crossfade weights too', () => {
  const timeline = new TakeTimeline([
    sample(0, [act('clap', 1, { rate: 0 })], { moving: false }), sample(0.1, [act('clap', 2, { rate: 0 })], { moving: false }),
    sample(1, [act('clap', 2, { weight: 1 }), act('wave', 0, { weight: 0, front: false })]),
    sample(1.2, [act('clap', 2.2, { weight: 0, front: false }), act('wave', 0.2, { weight: 1 })]),
  ], length);
  assert.ok(Math.abs(timeline.frameAt(0.05).actions[0].time - 1.5) < 1e-9);
  const mid = timeline.frameAt(1.1);
  assert.ok(Math.abs(mid.actions.find(a => a.clip === 'clap')!.weight - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.actions.find(a => a.clip === 'wave')!.weight - 0.5) < 1e-9);
});

test('the camera: position linear, rotation along the arc; frame count at 60 fps', () => {
  const q90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
  const timeline = new TakeTimeline([sample(0, [], { position: [0, 0, 0] }), sample(1, [], { position: [2, 0, 0], quaternion: q90, fov: 60 })], length);
  const half = timeline.frameAt(0.5);
  assert.deepEqual(half.position, [1, 0, 0]);
  assert.ok(Math.abs(half.fov - 50) < 1e-9);
  const expected = Math.sin(Math.PI / 8);
  assert.ok(Math.abs(half.quaternion[1] - expected) < 1e-9 && Math.abs(Math.hypot(...half.quaternion) - 1) < 1e-12, 'a 45° turn');
  assert.deepEqual(slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.5), [0, 0, 0, 1], 'q and -q are the same turn');
  assert.equal(timeline.frames(60), 61);
  assert.deepEqual(timeline.clips(), []);
});

test('sound segments: a pause cuts, resuming starts another, a one-shot’s end rings out, the last runs to the end', () => {
  const timeline = new TakeTimeline([
    sample(0, [act('clap', 0)]), sample(1, [act('clap', 1)]),
    sample(1.5, [act('clap', 1.5, { rate: 0 })], { audible: false, moving: false }), // paused at 1.5 s
    sample(2.5, [act('clap', 1.5)]), sample(5, [act('clap', 4)]), // resumed; reaches the end (4 s) at 5 s
    sample(5.5, [act('idle', 0.5, { loop: true, front: false })]),
    sample(6, [act('wave', 0)]), sample(7, [act('wave', 1)]),
  ], length);
  const segments = timeline.soundSegments();
  assert.deepEqual(segments.map(s => [s.clip, s.from, s.at, s.end, s.natural]), [
    ['clap', 0, 0, 1.5, false],
    ['clap', 1.5, 2.5, 5.5, true],
    ['wave', 0, 6, Infinity, false],
  ]);
});

test('the look at a time is the last change before it', () => {
  const events = [{ t: 0, look: 'a' }, { t: 1, look: 'b' }, { t: 2.5, look: 'c' }];
  assert.deepEqual([0, 0.99, 1, 2.4, 9].map(t => lookAt(events, t)), ['a', 'a', 'b', 'b', 'c']);
});

test('a take record from a newer version, or a broken one, still reads', async () => {
  const backend = new MemoryTakeBackend(true);
  backend.records.set('x', { id: 'x', name: '', createdAt: 5, status: 'weird', chunks: -2, clips: ['a', 3], future: true });
  backend.records.set('\u0000probe', { id: '\u0000probe' });
  backend.records.set('y', 'not a take');
  const [entry, ...rest] = await new TakeLibrary(backend).list();
  assert.equal(rest.length, 0);
  assert.deepEqual({ ...entry.meta } satisfies TakeMeta, { id: 'x', version: 1, name: 'Take', createdAt: 5, updatedAt: 5, status: 'done',
    duration: 0, chunks: 0, clips: ['a'], mode: 'global', renderedAt: null });
});
