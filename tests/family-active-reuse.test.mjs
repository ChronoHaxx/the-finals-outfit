// freeze-family.mjs side of activeMeshReuse, without game assets: node --test tests/family-active-reuse.test.mjs
// Python parity of the entry hash is exercised by tests/test_family_active_reuse.py through node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import * as m from '../scripts/shader-probe/freeze-family.mjs';

const gloves = {url: '../reconstructed-racing-gloves-v1/meshes/SK_Racing_Gloves_M.glb',
  sha256: '4ef9280b50dcf274e9fc6ffacae8f788465c4ab1d2454b586d0d5c8826e38b00',
  slots: [{slot: 'Gloves', material: '/Game/Discovery/Characters/Racing/Assets/Gloves/MI_Gloves_Gloves.MI_Gloves_Gloves'}],
  kind: 'skeletal', bodyMaskUrl: '../reconstructed-racing-gloves-v1/coverage/SK_Racing_Gloves_M.bodymask.png',
  bodyMaskUvTiles: [2, 1], coverageSource: 'derived-projection'};

test('accepted integer-only entry pins are unchanged', () => {
  assert.equal(m.entrySha(gloves), '250d19cc3749423572d2c9de53e3aa9b212003228488fedeec8976b9d711aa75');
  assert.equal(m.entryCanonical(gloves), m.canonical(gloves));
});

test('decimals hash as JSON.stringify prints them; unsharable values are refused, not rounded', () => {
  assert.equal(m.entryCanonical(JSON.parse('{"b":[1.0,-0.0,1E-7,2.5e+2],"a":{"u":0.1}}')), '{"a":{"u":0.1},"b":[1,0,1e-7,250]}');
  for (const bad of [NaN, Infinity, 2 ** 53, -(2 ** 53), 1e21, '\ud800', {'\udc00': 1}, {a: [1, {b: undefined}]}, () => 1, new Date(0), 1n])
    assert.throws(() => m.entryCanonical({futureField: bad}), /activeMeshReuse/, String(bad));
});

test('freeze refuses a manifest pin that is not the early preflight pin; pre-hardening evidence has none', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'reuse-')), cwd = process.cwd();
  try {
    process.chdir(dir);
    const put = (p, data) => { fs.mkdirSync(nodePath.dirname(p), {recursive: true}); fs.writeFileSync(p, data); };
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    const source = '/Game/A/SK_A.SK_A', entry = {url: '../old/SK.glb', sha256: hash('glb'), kind: 'skeletal', slots: [{slot: 'S', material: 'M'}],
      bodyMaskUrl: '../old/mask.png', bodyMaskUvTiles: [2, 1], coverageSource: 'derived-projection', futureField: {scale: 1.5e-7}};
    put('public/models/old/SK.glb', 'glb'); put('public/models/old/mask.png', 'mask');
    put('public/models/active/assets.json', JSON.stringify({meshes: {[source]: entry}, materials: {}}));
    put('public/models/active/supported-items.json', '{"items":[]}'); put('public/models/active/skin-pairs.json', '{"items":{}}');
    const pin = {policy: m.REUSE_POLICY, entrySha256: m.entrySha(entry), glbSha256: hash('glb'), maskSha256: hash('mask')};
    const cfg = {paths: {active: 'public/models/active', docs: '_docs/f'}, mesh: {source}, activeMeshReuse: pin};
    const cohort = {items: [{id: 'new', materials: ['/Game/A/MI_New.MI_New']}]};
    put('_docs/f/frozen-baseline.json', JSON.stringify({hashes: {}}));
    assert.deepEqual(m.assertActiveReuse(cfg, cohort), pin);
    put('_docs/f/frozen-baseline.json', JSON.stringify({hashes: {}, activeMeshReuse: {...pin, source}}));
    assert.deepEqual(m.assertActiveReuse(cfg, cohort), pin);
    for (const early of [{...pin, source, maskSha256: hash('old mask')}, {...pin, source: '/Game/B/SK_B.SK_B'}, {...pin}, null]) {
      put('_docs/f/frozen-baseline.json', JSON.stringify({hashes: {}, activeMeshReuse: early}));
      assert.throws(() => m.assertActiveReuse(cfg, cohort), /early preflight pin/);
    }
  } finally { process.chdir(cwd); fs.rmSync(dir, {recursive: true, force: true}); }
});
