import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAsset } from '../src/lib/asset-fetch';

test('temporary network and server failures recover with bounded attempts', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) throw new TypeError('Network unavailable');
    return calls === 2 ? new Response('', { status: 503 }) : new Response('recovered');
  });
  assert.equal(await (await fetchAsset('https://assets.test/material.bin')).text(), 'recovered');
  assert.equal(calls, 3);
});

test('persistent errors stop; permanent missing files and long Retry-After are not hammered', async t => {
  for (const [status, retryAfter, expected] of [[503, null, 3], [404, null, 1], [429, '120', 1]] as const) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response('', { status, headers: retryAfter ? { 'Retry-After': retryAfter } : undefined });
    });
    await assert.rejects(fetchAsset('https://assets.test/material.bin'), /Asset/);
    assert.equal(calls, expected);
    mock.mock.restore();
  }
});

test('successful HTTP with corrupt contents is not retried or accepted by parsing', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{corrupt'); });
  await assert.rejects((await fetchAsset('https://assets.test/data.json')).json());
  assert.equal(calls, 1);
});
