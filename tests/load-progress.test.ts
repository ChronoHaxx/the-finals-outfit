import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDownloadProgress, subscribeDownloadProgress, trackDownload } from '../src/lib/load-progress';

const delta = (before: ReturnType<typeof getDownloadProgress>) => {
  const now = getDownloadProgress();
  return { loaded: now.loaded - before.loaded, total: now.total - before.total, active: now.active - before.active };
};
const response = (bytes: number, headers: Record<string, string> = { 'Content-Length': String(bytes) }) =>
  new Response(new Uint8Array(bytes), { headers });

test('a download announces its length at once and counts bytes as they are read', async () => {
  const before = getDownloadProgress();
  const tracked = trackDownload(response(5000));
  assert.deepEqual(delta(before), { loaded: 0, total: 5000, active: 1 });
  assert.equal((await tracked.arrayBuffer()).byteLength, 5000);
  assert.deepEqual(delta(before), { loaded: 5000, total: 5000, active: 0 });
});

test('without a usable length the total follows what was read', async () => {
  for (const headers of [{}, { 'Content-Length': '100', 'Content-Encoding': 'br' }]) {
    const before = getDownloadProgress();
    await trackDownload(response(3000, headers)).arrayBuffer();
    assert.deepEqual(delta(before), { loaded: 3000, total: 3000, active: 0 });
  }
});

test('a cancelled body leaves only what was read in the total, so progress can still complete', async () => {
  const before = getDownloadProgress();
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1000)); } }); // never closes
  const tracked = trackDownload(new Response(body, { headers: { 'Content-Length': '9000' } }));
  const reader = tracked.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.deepEqual(delta(before), { loaded: 1000, total: 1000, active: 0 });
});

test('a failing body settles its count and still reports the error', async () => {
  const before = getDownloadProgress();
  let fail!: (error: Error) => void;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); fail = e => c.error(e); } });
  const reading = trackDownload(new Response(body, { headers: { 'Content-Length': '500' } })).arrayBuffer();
  await new Promise(resolve => setTimeout(resolve, 0));
  fail(new Error('connection reset'));
  await assert.rejects(reading, /connection reset/);
  assert.deepEqual(delta(before), { loaded: 10, total: 10, active: 0 });
});

test('listeners hear once per task, however many chunks arrive', async () => {
  let calls = 0;
  const stop = subscribeDownloadProgress(() => calls++);
  const chunks = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 50; i++) c.enqueue(new Uint8Array(10)); c.close(); } });
  await trackDownload(new Response(chunks)).arrayBuffer();
  await new Promise(resolve => setTimeout(resolve, 0));
  stop();
  assert.ok(calls >= 1 && calls <= 3, String(calls));
});
