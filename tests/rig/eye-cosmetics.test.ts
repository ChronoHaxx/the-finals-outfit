import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceSkinPair, parameterOverlays, resolveSourceOutfit,
  type SourceDefinition } from '../../src/rig/SourceAssembly.ts';

const soft = (AssetPathName = '') => ({ AssetPathName });
const face: SourceDefinition = { formatVersion: 1, id: 'face', source: 'face-source', sourceSha256: 'test',
  properties: { ActivatesTags: ['Customization.Slot.Head'], VisualParts: [true, false].map(head => ({
    StaticMesh: soft(), SkeletalMesh: soft(head ? 'head-mesh' : 'body-mesh'), Effect: soft(),
    bIsHeadMesh: head, TagOverrides: [],
  })) } };
const eyes = (replace: boolean): SourceDefinition => ({ formatVersion: 1, id: 'eyes', source: 'eyes-source', sourceSha256: 'test',
  properties: { ActivatesMaterialParameters: [{ MaterialInstance: soft('eye-donor'),
    Behavior: `ECustomizationMaterialBehavior::${replace ? 'ReplaceMaterial' : 'OverrideParameters'}`,
    MatchingTags: ['Customization.Slot.Head'], SlotNames: ['shader_eyeLeft_shader'] }] } });
const binding = (source: string) => ({ source, defaultSource: source, url: `${source}.json` });
const pair = { source: face.source,
  head: { sourceIndex: 0, sourceMesh: 'head-mesh', boundsOrigin: [0, 0, 0], url: 'head.glb', materials: {
    shader_eyeLeft_shader: binding('face-eye'), shader_eyeRight_shader: binding('face-eye'),
    shader_head_shader: binding('face-skin'),
  } },
  body: { sourceIndex: 1, sourceMesh: 'body-mesh', boundsOrigin: [0, 0, 0], url: 'body.glb',
    materials: { body: binding('body-skin') } },
};
const documents = new Map<string, unknown>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const data = documents.get(String(input));
  return data === undefined ? new Response('missing', { status: 404 }) : Response.json(data);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: 'http://eyes.test/' } };

for (const replace of [false, true]) test(`eye ${replace ? 'replacement' : 'override'} preserves other eye, skin and removal`, async () => {
  const base = `http://eyes.test/${replace}`;
  const outfit = resolveSourceOutfit([face, eyes(replace)], ['Customization.Archetype.Medium']);
  const token = replace ? 'replace:eye-donor' : 'eye-donor';
  documents.set(`${base}/skin-pairs.json`, { formatVersion: 1, items: { face: pair } });
  documents.set(`${base}/assets.json`, { formatVersion: 1, materialVariants: {
    [JSON.stringify(['face-eye', token])]: 'changed-eye.json',
    [JSON.stringify(['face-eye', replace ? 'eye-donor' : 'replace:eye-donor'])]: 'wrong-behavior.json',
  } });
  const changed = await loadSourceSkinPair('face', outfit.items.face, base, outfit.materialParameters);
  assert.equal(changed?.head.materials.shader_eyeLeft_shader.url, `${base}/changed-eye.json`);
  assert.equal(changed?.head.materials.shader_eyeRight_shader.url, `${base}/face-eye.json`);
  assert.equal(changed?.head.materials.shader_head_shader.url, `${base}/face-skin.json`);
  assert.equal(changed?.body.materials.body.url, `${base}/body-skin.json`);
  const removed = await loadSourceSkinPair('face', outfit.items.face, base);
  assert.equal(removed?.head.materials.shader_eyeLeft_shader.url, `${base}/face-eye.json`);
});

test('missing eye variants refuse instead of showing an unchanged eye as reconstructed', async () => {
  const base = 'http://eyes.test/missing';
  documents.set(`${base}/skin-pairs.json`, { formatVersion: 1, items: { face: pair } });
  documents.set(`${base}/assets.json`, { formatVersion: 1, materialVariants: {} });
  const outfit = resolveSourceOutfit([face, eyes(true)], ['Customization.Archetype.Medium']);
  await assert.rejects(loadSourceSkinPair('face', outfit.items.face, base, outfit.materialParameters), /Unvalidated skin parameter/);
});

test('overlapping replacement and override are refused; unrelated scalp parameters can coexist', () => {
  const outfit = resolveSourceOutfit([face, eyes(true)], ['Customization.Archetype.Medium']);
  const replacement = outfit.materialParameters[0];
  assert.throws(() => parameterOverlays([replacement, { ...replacement, replace: undefined }], 'shader_eyeLeft_shader'), /Unresolved/);
  assert.deepEqual(parameterOverlays([replacement, { ...replacement, itemId: 'hair', replace: undefined,
    slots: ['shader_head_shader'], source: 'scalp' }], 'shader_eyeLeft_shader'), ['replace:eye-donor']);
});
