// Lighting in share links (22 Nov 2026, Shocka's feedback item 10): the lt grammar and its Worker twin, every
// ready-made look by name, custom looks in full, what a newer build adds surviving this one, and links built with and
// without lighting. The store's side (a shared look shown without touching the viewer's own) is in
// shared-lighting-store.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import {
  LIGHTING_GRAMMAR, MAX_LIGHTING_LENGTH, lightingCode, lightingLabel, lookFields, parseLighting, readLightingLink,
  withoutLighting,
} from '../src/lib/share-lighting';
import {
  FULL_LOOKS, MAX_LIGHTS, STUDIO_BACKDROP, lobbyLook, menuS12Look, newLight, positionFrom, sameLook, sanitizeLook,
  studioLook, warmLook, type Look,
} from '../src/lib/stage-lighting';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { readViewLink } from '../src/lib/camera-view';
import { uploadQuery } from '../src/lib/share-preview';
import { readLighting as workerReadLighting } from '../workers/share-preview/src/share';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const outfit = { face: 'head-face-01-base', hair: 'hairs-afrofade', feet: 'casual-tallsneakers-canvas' };
const look = { build: outfit, bodyType: 'masculine', playerNumber: null };

/** A look made in the panel: the Season 12 menu look, its key turned and warmer, a light added, the exposure up. */
function customLook(): Look {
  const next = menuS12Look();
  next.lights[0] = { ...next.lights[0], color: '#ffd9b0', position: positionFrom(80, 40, 7) };
  next.lights.push(newLight(next.lights));
  next.lights[1] = { ...next.lights[1], enabled: false };
  next.exposure = 1.35;
  next.environment = { kind: 'softbox', intensity: 0.85, rotation: -37 };
  return next;
}

/** Two looks draw the same: every field equal, light positions to the millimetre. */
function assertSameDrawing(actual: Look, expected: Look) {
  const strip = (l: Look) => ({ ...l, lights: l.lights.map(({ position, id: _id, ...rest }) => ({ ...rest,
    position: position.map(v => Math.round(v * 1000)) })) });
  assert.deepEqual(strip(actual), strip(sanitizeLook(expected)));
}

test('every ready-made look is written as its id and reads back as that look', () => {
  for (const full of FULL_LOOKS) {
    const code = lightingCode(full.look());
    assert.equal(code, full.id, full.label);
    const read = parseLighting(code);
    assert.equal(read.kind, 'look');
    assert.ok(read.kind === 'look' && sameLook(read.look, full.look()) && read.preset === full.label, full.label);
  }
  assert.equal(lightingCode(studioLook()), 'studio', 'the default is named too, so a link always says which look it shows');
  assert.equal(lightingLabel(lobbyLook()), 'Lobby');
});

test('a custom look is written in full and reads back drawing the same, scene included', () => {
  const custom = customLook();
  const code = lightingCode(custom);
  assert.match(code, /^1\.e1350\.ta\.h9fb4ff_0b2a6b_500\.vs_850_-37000\.c0\.f0_400\.b[0-9a-f_]+\.ss12-menu\.lsc_ffd9b0_2200_/);
  assert.ok(LIGHTING_GRAMMAR.test(code) && code.length < 400, code);
  const read = parseLighting(code);
  assert.equal(read.kind, 'look');
  if (read.kind !== 'look') return;
  assertSameDrawing(read.look, custom);
  assert.deepEqual(read.look.lights.map(l => [l.name, l.enabled, l.castShadow]),
    [['Key', true, true], ['Blue side', false, false], ['Back light', true, false], ['Under fill', true, false], ['Light 5', true, false]]);
  assert.equal(read.look.backdrop.scene, 's12-menu');
  assert.equal(lightingCode(read.look), code, 'writing what was read gives the same value');
  assert.match(lightingLabel(custom), /^Custom · 4 lights · sun 80° \/ 40° · Season 12 menu$/);
});

test('backdrops: solid and gradient leave the Studio shape out; another shape is written', () => {
  const solid = { ...studioLook(), backdrop: { ...STUDIO_BACKDROP, inner: '#00b140', middle: '#00b140', outer: '#00b140' } };
  assert.ok(lookFields(solid).includes('b00b140'));
  assert.ok(lookFields(studioLook({ ...studioRig(), exposure: 1.2 })).includes('bf0f3f7_dee4eb_c5cdd7'));
  const lobby = { ...lobbyLook(), exposure: 1.2 };
  assert.ok(lookFields(lobby).includes('b1b2740_0a0e17_05060a_58000_70000_60000_50000_38000'));
  for (const each of [solid, lobby, { ...warmLook(), exposure: 2 }]) {
    const read = parseLighting(lightingCode(each));
    assert.ok(read.kind === 'look');
    if (read.kind === 'look') assert.deepEqual(read.look.backdrop, each.backdrop);
  }
});

function studioRig() {
  return { room: 0.1, keyPanel: 2, fillPanel: 1, accentPanel: 1, env: 1.5, hemi: 0.3, key: 4, fill: 0, rim: 0.5, exposure: 1.0 };
}

test('no light, six lights, an odd name, a light far away: all written and read back', () => {
  const none = { ...lobbyLook(), lights: [] };
  const read = parseLighting(lightingCode(none));
  assert.ok(read.kind === 'look' && read.look.lights.length === 0);
  const six = lobbyLook();
  while (six.lights.length < MAX_LIGHTS) six.lights.push(newLight(six.lights));
  six.lights[2] = { ...six.lights[2], name: 'Ünïcode  rim / back!!', position: [5000, 0.001, -2000] };
  const sixRead = parseLighting(lightingCode(six));
  assert.ok(sixRead.kind === 'look');
  if (sixRead.kind !== 'look') return;
  assert.equal(sixRead.look.lights.length, MAX_LIGHTS);
  assert.equal(sixRead.look.lights[2].name, 'Unicode rim back');
  const [x, y, z] = sixRead.look.lights[2].position;
  assert.ok(Math.abs(x - 1000) < 1e-9 && Math.abs(z + 400) < 1e-9 && y >= 0, 'scaled within 1000 m, the direction kept');
  assert.ok(lightingCode(six).length < MAX_LIGHTING_LENGTH);
});

test('a ready-made look or format this version does not know is not shown', () => {
  assert.deepEqual(parseLighting('golden-hour'), { kind: 'unknown', code: 'golden-hour' });
  assert.deepEqual(parseLighting('2.zq1_2.e1000'), { kind: 'unknown', code: '2.zq1_2.e1000' });
});

test('a damaged look is refused whole, never shown in part', () => {
  const good = lightingCode(customLook());
  const without = (key: string) => good.split('.').filter((field, i) => i === 0 || field[0] !== key).join('.');
  const bad = [
    '', 'Lobby', '1.', '1', '01.e1000', '1.e1000', // shape
    without('e'), without('t'), without('h'), without('v'), without('c'), without('f'), without('b'), // missing fields
    `${good}.e1000`, // repeated
    good.replace('.ta.', '.tq.'), good.replace('.ta.', '.ttoString.'), good.replace('.c0.', '.c2.'),
    good.replace('h9fb4ff', 'h9FB4FF'), good.replace('h9fb4ff', 'h9fb4f'), good.replace('.e1350.', '.e1.35.'),
    good.replace('.e1350.', '.e-1350.'), good.replace('.e1350.', '.e01350.'),
    good.replace('_Key', '_K%20y'), good.replace('_Key', '_-Key'), good.replace('lsc_', 'llc_'), // light flags
    good.replace(/lsc_ffd9b0_2200_[-0-9]+_[-0-9]+_[-0-9]+/, 'lsc_ffd9b0_2200_0_0_0'), // nowhere
    good.replace('llo_007bff', 'lso_007bff'), // two suns
    `${good}${'.l_ffffff_1000_1000_1000_1000_X'.repeat(3)}`, // seven lights
    good.replace('.ss12-menu', '.sS12'), good.replace('.ss12-menu', '.s'),
    `${good}.b000000`, `${good}._x`, `${good}..e1`, `${good}.q${'x'.repeat(1500)}`,
  ];
  for (const code of bad) assert.notEqual(parseLighting(code).kind, 'look', code);
});

test('numbers out of range are brought within it, as a stored look is', () => {
  const read = parseLighting(lightingCode(customLook()).replace('.e1350.', '.e9000.'));
  assert.ok(read.kind === 'look' && read.look.exposure === 3);
});

test("a newer build's fields and light values are kept, stored with the look and written back", () => {
  const code = `${lightingCode(customLook())}.gfog_250.Zfuture`.replace('_Key', '_Key_cone-30_x9');
  const read = parseLighting(code);
  assert.ok(read.kind === 'look');
  if (read.kind !== 'look') return;
  assert.deepEqual(read.look.linkExtras, ['gfog_250', 'Zfuture']);
  assert.deepEqual(read.look.lights[0].linkExtras, ['cone-30', 'x9']);
  assert.equal(lightingCode(read.look), code, 'written back as they came');
  // Kept through a stored copy (sanitizeLook) and an edit.
  const stored = sanitizeLook(JSON.parse(JSON.stringify(read.look)));
  stored.exposure = 1.5;
  assert.match(lightingCode(stored), /\.e1500\..*_Key_cone-30_x9.*\.gfog_250\.Zfuture$/);
  assert.equal(sanitizeLook({ ...stored, linkExtras: ['ok', 3, '<b>', 'also_ok'] }).linkExtras?.join(), 'ok,also_ok');
  assert.ok(!sameLook(read.look, customLook()), 'a look with additions is not the look without them');
});

test('the share Worker carries exactly what the app writes, and passes a newer one through', () => {
  const params = (lt: string) => new URLSearchParams({ lt });
  for (const code of [...FULL_LOOKS.map(f => f.id), lightingCode(customLook()), 'golden-hour', '2.anything_new.x-1'])
    assert.equal(workerReadLighting(params(code)), code, code);
  assert.equal(workerReadLighting(new URLSearchParams()), undefined);
  for (const bad of ['Lobby', '1.e1000"><script>', '1.e1 000', 'lobby&x=1', `1.${'x'.repeat(1501)}`, '0.e1'])
    assert.equal(workerReadLighting(params(bad)), null, bad);
});

test('lighting rides last in both link styles, needs no escaping, and reads back', () => {
  const custom = lightingCode(customLook());
  const view = { position: [0, 1, 2] as [number, number, number], target: [0, 1, 0] as [number, number, number], roll: 0 };
  const short = buildShareUrl(SITE, look, 'short', null, view, custom);
  assert.ok(new URL(short).hash.endsWith(`&view=0_1_2_0_1_0&lt=${custom}`), 'no escaping needed');
  const read = readLightingLink(short);
  assert.ok(read?.kind === 'look' && lightingCode(read.look) === custom);
  assert.deepEqual(readOutfitLink(short)?.slots, outfit, 'the outfit still decodes');
  assert.ok(readViewLink(short), 'the view still reads');

  const names = buildShareUrl(SITE, look, 'names', null, null, 'lobby');
  assert.equal(new URL(names).searchParams.get('lt'), 'lobby');
  assert.equal(readLightingLink(names)?.kind, 'look');

  for (const plain of [buildShareUrl(SITE, look), SITE, `${SITE}#/`, `${SITE}?light=key:2`])
    assert.equal(readLightingLink(plain), null, plain);
  assert.equal(readLightingLink(`${SITE}#/?o=2.&lt=Lobby`)?.kind, 'invalid');
  assert.equal(readLightingLink(`${SITE}#/chinals?o=2.&lt=cool`)?.kind, 'look', 'the Chinals route carries it too');
});

test('a new share never inherits the lighting of the link it was opened from', () => {
  const opened = buildShareUrl(SITE, look, 'names', null, null, 'lobby');
  for (const style of ['short', 'names'] as const) {
    assert.equal(readLightingLink(buildShareUrl(opened, look, style)), null, style);
    const other = buildShareUrl(opened, look, style, null, null, 'cool');
    assert.equal(other.match(/lt=/g)?.length, 1, style);
  }
});

test('the mode switch drops the lighting; the preview upload carries it last', () => {
  assert.equal(withoutLighting('?o=2.12a&emote=wave&lt=lobby'), '?o=2.12a&emote=wave');
  assert.equal(withoutLighting('?lt=lobby'), '');
  assert.equal(uploadQuery('2.12a', null, 'a', undefined, null, 'lobby'), 'o=2.12a&bt=a&lt=lobby');
  assert.equal(uploadQuery('2.12a', null), 'o=2.12a', 'without lighting the upload is as before');
});
