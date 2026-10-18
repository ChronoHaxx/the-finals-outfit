import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceFaceCosmetics, loadSourceReconstructionItems } from '../../src/rig/SourceAssembly.ts';

const responses = new Map<string, () => Response>();
globalThis.fetch = (async (input: string | URL | Request) =>
  responses.get(String(input))?.() ?? new Response('missing', { status: 404 })) as typeof fetch;
const set = (url: string, value: unknown) => responses.set(url, () => Response.json(value));

test('older releases without the optional eye index preserve assemblies and faces', async () => {
  const base = 'https://fixture.test/old';
  set(`${base}/supported-items.json`, { formatVersion: 1, items: ['shirt'] });
  set(`${base}/skin-pairs.json`, { formatVersion: 1, items: { face: {} } });
  assert.deepEqual(await loadSourceReconstructionItems(base), new Set(['shirt', 'face']));
});

test('material-only eyes join picker progress without pretending to have an assembly', async () => {
  const base = 'https://fixture.test/current';
  set(`${base}/supported-items.json`, { formatVersion: 1, items: ['shirt'] });
  set(`${base}/skin-pairs.json`, { formatVersion: 1, items: { face: {} } });
  // Each indexed item lists the recipient slots its validated face variants cover (current-app contract, Oct 2026).
  set(`${base}/face-cosmetics.json`, { formatVersion: 1, items: { eye: { slots: { shader_eyeLeft_shader: {}, shader_eyeRight_shader: {} } } } });
  assert.deepEqual(await loadSourceReconstructionItems(base), new Set(['shirt', 'face', 'eye']));
});

test('missing index is retried when it later becomes available; transient failures remain visible', async () => {
  const base = 'https://fixture.test/retry';
  assert.equal((await loadSourceFaceCosmetics(base)).size, 0);
  responses.set(`${base}/face-cosmetics.json`, () => new Response('failed', { status: 503 }));
  await assert.rejects(loadSourceFaceCosmetics(base), /503/);
  set(`${base}/face-cosmetics.json`, { formatVersion: 1, items: { retryEye: { slots: { shader_eyeLeft_shader: {} } } } });
  assert.deepEqual(await loadSourceFaceCosmetics(base), new Map([['retryEye', ['shader_eyeLeft_shader']]]));
});

test('malformed present eye index is not silently advertised', async () => {
  for (const [i, value] of [null, [], { formatVersion: 2, items: {} }, { formatVersion: 1, items: [] },
    { formatVersion: 1, items: { eye: {} } }, { formatVersion: 1, items: { eye: { slots: {} } } }].entries()) {
    const base = `https://fixture.test/invalid-${i}`;
    set(`${base}/face-cosmetics.json`, value);
    await assert.rejects(loadSourceFaceCosmetics(base));
  }
});
