import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { gunzipIfCompressed, meshBytes } from '../src/lib/mesh-bytes';

// A tiny GLB header is enough: the helper only decides between the two published forms.
const glb = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(4096, 7)]);
const arrayBuffer = (bytes: Buffer) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('a gzipped mesh decompresses to the extraction\'s exact bytes', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(gzipSync(glb, { level: 9 })));
  assert.deepEqual(Buffer.from(await meshBytes('https://assets.test/meshes/SK_Body_M.glb')), glb);
});

test('a plain GLB passes through untouched, as served by development and older hosts', async () => {
  const plain = arrayBuffer(glb);
  assert.equal(await gunzipIfCompressed(plain), plain);
  const empty = new ArrayBuffer(0);
  assert.equal(await gunzipIfCompressed(empty), empty);
});

test('a corrupt gzip stream fails instead of handing the parser partial bytes', async () => {
  const broken = gzipSync(glb).subarray(0, 40);
  await assert.rejects(gunzipIfCompressed(arrayBuffer(broken)));
});
