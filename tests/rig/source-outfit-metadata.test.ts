import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceOutfit, MissingSourceDefinitionError } from '../../src/rig/SourceAssembly.ts';

const definition = (id: string, tags: string[] = []) => ({
  formatVersion: 1, id, source: `Test/${id}.uasset`, sourceSha256: `${id}-sha`,
  properties: { ActivatesTags: tags, VisualParts: [] },
});

test('complete selected outfits work even when the broader catalog has unknown items', async t => {
  const origin = 'http://metadata.test/complete', fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    fetched.push(url);
    const data = url.endsWith('/catalog.json') ? { formatVersion: 1, items: ['face', 'cap'] }
      : definition(url.includes('face.json') ? 'face' : 'cap', url.includes('cap.json') ? ['Hat.CoversHair'] : []);
    return Response.json(data);
  });
  const outfit = await loadSourceOutfit(['face', 'cap', 'cap'], origin);
  assert.deepEqual(Object.keys(outfit.items), ['face', 'cap']);
  assert.deepEqual(outfit.tags, ['Customization.Archetype.Medium', 'Hat.CoversHair']);
  assert.deepEqual(outfit.unresolvedItems, []);
  assert.equal(fetched.length, 3);
});

test('one missing selected item refuses the whole outfit before reading partial definitions', async t => {
  const origin = 'http://metadata.test/missing', fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    fetched.push(url);
    return Response.json({ formatVersion: 1, items: ['face'] });
  });
  await assert.rejects(loadSourceOutfit(['face', 'unknown-helmet', 'unknown-helmet', 'unknown-gloves'], origin), error => {
    assert(error instanceof MissingSourceDefinitionError);
    assert.deepEqual(error.itemIds, ['unknown-helmet', 'unknown-gloves']);
    return true;
  });
  assert.deepEqual(fetched, [`${origin}/catalog.json`]);
});

test('removing the unknown item recovers using the same metadata index', async t => {
  const origin = 'http://metadata.test/removal';
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(
    url.endsWith('/catalog.json') ? { formatVersion: 1, items: ['face'] } : definition('face')));
  await assert.rejects(loadSourceOutfit(['face', 'unknown'], origin), MissingSourceDefinitionError);
  const outfit = await loadSourceOutfit(['face'], origin);
  assert.deepEqual(Object.keys(outfit.items), ['face']);
});

test('a listed definition that fails to download remains a load error, never a partial outfit', async t => {
  const origin = 'http://metadata.test/download';
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/catalog.json')
    ? Response.json({ formatVersion: 1, items: ['face'] }) : new Response('', { status: 404 }));
  await assert.rejects(loadSourceOutfit(['face'], origin), /Asset download failed \(404\)/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json(definition('face')));
  assert.deepEqual(Object.keys((await loadSourceOutfit(['face'], origin)).items), ['face']);
});

test('mismatched definition identities remain refused and retryable', async t => {
  const origin = 'http://metadata.test/identity';
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/catalog.json')
    ? { formatVersion: 1, items: ['face'] } : definition('different-face')));
  await assert.rejects(loadSourceOutfit(['face'], origin), /Invalid source definition for face/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json(definition('face')));
  assert.deepEqual(Object.keys((await loadSourceOutfit(['face'], origin)).items), ['face']);
});
