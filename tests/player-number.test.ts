// The player (contestant) number (21 Nov 2026; 0-9 since 22 Nov). Two halves:
// - the shader route (src/rig/PlayerNumber.ts): find MF_CharacterAtlasUV's arithmetic in a program by its shape, rewrite
//   its six folded lanes to uniforms, and drive every live material from the viewer's choice. Synthetic programs here;
//   the census over the real recovered programs is scripts/check-player-number.mjs (22 Nov: 294 of 294 matched their
//   authored DecalNumber, and every rewrite prints 0, 5, 7, 10, 32 and 99 exactly as the game's assembly does).
// - the outfit field (src/lib/player-number.ts): it must survive everything the body type survives. Loss paths: a
//   number-only edit then a kill, two tabs, a conflict fork, a duplicate, an older tab that does not know the field, a
//   value from a newer site, every link made before numbers, a stale `pn` in the address bar, and the share Worker.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './helpers/load-catalog';
import {
  isPlayerNumber, playerNumberFromShareCode, playerNumberShareCode, samePlayerNumber, shownPlayerNumber, storedPlayerNumber,
} from '../src/lib/player-number';
import {
  evaluatePlayerNumberNode, findPlayerNumberSites, PLAYER_NUMBER_CENTRE_UNIFORM, PLAYER_NUMBER_UNIFORM, playerNumberLanes,
  playerNumberPieces, playerNumberUniforms, referenceAtlasU, rewritePlayerNumberGlsl, setPlayerNumber,
  type PlayerNumberUniforms,
} from '../src/rig/PlayerNumber';
import { encodeOutfit } from '../src/lib/outfit';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { uploadQuery } from '../src/lib/share-preview';
import { OutfitLibrary, type LibraryOptions, type OutfitBackend } from '../src/lib/outfit-library';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { FALLBACK_FACE, useBuildStore } from '../src/store/useBuildStore';
import { getItemById } from '../src/lib/catalog';
import {
  duplicateOutfit, newOutfit, openFromUrl, randomiseOutfit, resetOutfit, startSavedOutfits, stopSavedOutfits,
  useSavedOutfits,
} from '../src/store/useSavedOutfits';
import worker from '../workers/share-preview/src/index';
import { readPlayerNumber, type Env } from '../workers/share-preview/src/share';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const HAT = 'attachment-pumpkinhead-hat';
const BOOTS = 'actionhero-sentinelboots-leather';
const PIECES = { face: FALLBACK_FACE, feet: BOOTS };

// ------------------------------------------------------------------ the shader route

// A literal as the slicer writes it ('%.9g' of the float32, with a '.0' on whole numbers).
const glslFloat = (value: number) => {
  const text = String(Number(Math.fround(value).toPrecision(9)));
  return /[.e]/.test(text) ? text : `${text}.0`;
};
interface ProgramOptions { guarded?: boolean; noScale?: boolean; leak?: boolean }
// A synthetic program in the slicer's output form: per number slot, MF_CharacterAtlasUV with the number's lanes folded
// in exactly as sm5_slice.py folds them (a zero lane leaves no add; single folds into the saturate's +1.0), plus
// unrelated arithmetic. `guarded`: max/min with the NaN rule spelled out, as newer programs carry them.
function program(numbers: number[], options: ProgramOptions = {}) {
  const lines = ['ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, vec3 viewTangent) {',
    '  float n1 = (uv0.x + 0.300000012); // asm:10'];
  let node = 2, asm = 100;
  const clampText = (fn: string, value: string, bound: string) => options.guarded
    ? `(isnan(${value}) ? ${bound} : isnan(${bound}) ? ${value} : ${fn}(${value}, ${bound}))` : `${fn}(${value}, ${bound})`;
  const emit = (expr: string) => { const name = `n${node++}`; lines.push(`  float ${name} = ${expr}; // asm:${asm++}`); return name; };
  for (const n of numbers) {
    const l = playerNumberLanes(n);
    const m = emit(clampText('max', 'n1', glslFloat(l.lo)));
    const uc = emit(clampText('min', m, glslFloat(l.hi)));
    const s = emit(`(${uc} * 2.0)`);
    const base = emit(options.noScale ? `(${s} * 0.5)` : `(${s} * 0.100000001)`);
    const left = l.tens ? emit(`(${base} + ${glslFloat(l.tens)})`) : base;
    const nL = emit(`(-${left})`);
    const right0 = l.ones ? emit(`(${base} + ${glslFloat(l.ones)})`) : base;
    const right = emit(`(${glslFloat(-l.k)} + ${right0})`);
    const d = emit(`(${nL} + ${right})`);
    const half = emit(`(${uc} + 0.5)`);
    const fl = emit(`floor(${half})`);
    const satIn = l.single ? emit(`(${fl} + 1.0)`) : fl;
    const satLo = emit(clampText('max', satIn, '0.0'));
    const sel = emit(clampText('min', satLo, '1.0'));
    const r = emit(`(${d} * ${sel})`);
    const out = emit(`(${r} + ${left})`);
    lines.push(`  vec4 n${node++} = texture(u_t8, vec2(${out}, uv0.y)); // asm:${asm++}`);
    if (options.leak) emit(`(${uc} * 3.0)`); // the clamp feeds something else: the rewrite would change it too
  }
  lines.push('  return surface;', '}');
  return lines.join('\n');
}
const U_GRID = Array.from({ length: 23 }, (_, i) => -0.05 + i * 0.05);
const atlasAt = (glsl: string, site: { uNode: string; atlasNode: string }, u: number, n?: number) =>
  evaluatePlayerNumberNode(glsl, site.atlasNode, { [site.uNode]: u }, n === undefined ? undefined : playerNumberLanes(n));

test('the lanes are the preshader\'s float32 values: 32 gives the literals the shipped programs carry', () => {
  const l32 = playerNumberLanes(32);
  assert.equal(l32.tens, Math.fround(0.300000012));
  assert.equal(l32.ones, Math.fround(0.200000048), 'frac(3.2) in float32, not 0.2');
  assert.deepEqual([l32.lo, l32.hi, l32.k, l32.single], [0, 1, Math.fround(0.1), 0], 'two digits: the whole decal, two cells');
  const l7 = playerNumberLanes(7);
  assert.deepEqual([l7.tens, l7.lo, l7.hi, l7.k, l7.single], [0, 0.25, 0.75, Math.fround(0.05), 1], 'one digit: the middle half');
  assert.equal(playerNumberLanes(0).ones, 0);
  const sets = new Set<string>();
  for (let n = 0; n <= 99; n++) {
    const l = playerNumberLanes(n);
    sets.add(JSON.stringify(l));
    assert.ok(Math.abs(l.tens - Math.floor(n / 10) / 10) < 1e-6 && Math.abs(l.ones - (n % 10) / 10) < 1e-6, String(n));
  }
  assert.equal(sets.size, 100, 'every number has its own lanes');
});

test('the game\'s layout: two digits fill the decal; one digit prints centred at one cell\'s width', () => {
  const cell = (u: number, n: number) => referenceAtlasU(u, n) * 10;
  assert.ok(Math.abs(cell(0.25, 42) - 4.5) < 1e-5, 'left half: the middle of the 4 cell');
  assert.ok(Math.abs(cell(0.75, 42) - 2.5) < 1e-5, 'right half: the middle of the 2 cell');
  assert.ok(Math.abs(cell(0.5, 7) - 7.5) < 1e-5, 'a lone 7 is centred on the decal');
  assert.ok(Math.abs(cell(0.25, 7) - 7) < 1e-5 && Math.abs(cell(0.75, 7) - 8) < 1e-5, 'across the middle half only');
  assert.equal(referenceAtlasU(0.1, 7), referenceAtlasU(0.25, 7), 'outside it the clamp holds the cell\'s edge column');
  assert.equal(referenceAtlasU(0.9, 7), referenceAtlasU(0.75, 7));
  assert.ok(Math.abs(cell(0.5, 0) - 0.5) < 1e-5, '0 is a digit like the others');
});

test('the route finds every authored shape, and its rewrite prints every number 0-99 as the game does', () => {
  for (const [numbers, options] of [[[68, 68], {}], [[32], { guarded: true }], [[5], {}], [[8], { guarded: true }],
    [[10], {}], [[30], { guarded: true }], [[0], {}], [[11], {}]] as [number[], ProgramOptions][]) {
    const source = program(numbers, options);
    const found = findPlayerNumberSites(source);
    const label = `${numbers.join('+')}${options.guarded ? ' guarded' : ''}`;
    assert.equal(found?.authored, numbers[0], label);
    assert.equal(found?.sites.length, numbers.length, label);
    const rewritten = rewritePlayerNumberGlsl(source, found!);
    assert.ok(rewritten.startsWith(`uniform vec4 ${PLAYER_NUMBER_UNIFORM};\nuniform vec2 ${PLAYER_NUMBER_CENTRE_UNIFORM};\n`), label);
    assert.match(rewritten, /float n1 = \(uv0\.x \+ 0\.300000012\); \/\/ asm:10/, 'an unrelated 0.3 is left alone');
    assert.equal(rewritten.split('\n').length, source.split('\n').length + 2, 'lines are rewritten in place, none added');
    for (const site of found!.sites) for (const u of U_GRID) {
      assert.equal(atlasAt(source, site, u), referenceAtlasU(u, numbers[0]), `${label}: the original prints its own, u=${u}`);
      for (let n = 0; n <= 99; n++) assert.equal(atlasAt(rewritten, site, u, n), referenceAtlasU(u, n), `${label}: N=${n} u=${u}`);
    }
  }
});

test('the route refuses what it cannot change exactly: disagreeing sites, other shapes, a clamp that feeds more', () => {
  assert.equal(findPlayerNumberSites(program([32, 68])), undefined, 'sites must agree on the one DecalNumber');
  assert.equal(findPlayerNumberSites(program([32], { noScale: true })), undefined, 'not the two-cell atlas scale');
  assert.equal(findPlayerNumberSites(program([32], { leak: true })), undefined, 'the clamp is used elsewhere');
  assert.equal(findPlayerNumberSites('void main() {}'), undefined);
  assert.throws(() => rewritePlayerNumberGlsl('void main() {}', findPlayerNumberSites(program([32]))!), /every expression/);
});

const lanesOf = (uniforms: PlayerNumberUniforms) => {
  const [tens, ones, lo, hi] = uniforms[PLAYER_NUMBER_UNIFORM].value.toArray();
  const [k, single] = uniforms[PLAYER_NUMBER_CENTRE_UNIFORM].value.toArray();
  return { tens, ones, lo, hi, k, single };
};

test('live materials follow the viewer\'s number; null puts each piece\'s own back; disposed ones leave', () => {
  setPlayerNumber(null);
  const a = new THREE.MeshPhysicalMaterial(), b = new THREE.MeshPhysicalMaterial(), shadow = new THREE.MeshDepthMaterial();
  const ua = playerNumberUniforms(a, 32, 'jersey'), ub = playerNumberUniforms(b, 68, 'shorts');
  playerNumberUniforms(shadow, 32, 'jersey');
  assert.equal(playerNumberPieces(), 2, 'counted by piece, not by pass');
  assert.deepEqual(lanesOf(ua), playerNumberLanes(32));
  assert.deepEqual(lanesOf(ub), playerNumberLanes(68));
  const version = a.version;
  setPlayerNumber(7);
  assert.deepEqual(lanesOf(ua), playerNumberLanes(7), 'a one-digit number prints');
  assert.deepEqual(lanesOf(ub), playerNumberLanes(7));
  assert.ok(a.version > version, 'marked for update, which restarts the still-view accumulation');
  setPlayerNumber(0);
  assert.deepEqual(lanesOf(ua), playerNumberLanes(0), '0 is a number, not "none"');
  setPlayerNumber(100);
  assert.deepEqual(lanesOf(ua), playerNumberLanes(32), 'a value the site cannot print: each piece\'s own');
  setPlayerNumber(45);
  assert.deepEqual(lanesOf(ub), playerNumberLanes(45));
  setPlayerNumber(null);
  assert.deepEqual(lanesOf(ub), playerNumberLanes(68));
  b.dispose();
  assert.equal(playerNumberPieces(), 1);
  a.dispose(); shadow.dispose();
  assert.equal(playerNumberPieces(), 0);
});

test('each owner prints its own number: a squad contestant\'s choice leaves the builder and the others alone', () => {
  setPlayerNumber(null);
  const red = {}, blue = {};
  const builderJersey = new THREE.MeshPhysicalMaterial(), redCargos = new THREE.MeshPhysicalMaterial();
  const builder = playerNumberUniforms(builderJersey, 32, 'jersey');
  const redJersey = new THREE.MeshPhysicalMaterial(), blueJersey = new THREE.MeshPhysicalMaterial();
  const r = playerNumberUniforms(redJersey, 32, 'jersey', red), b = playerNumberUniforms(blueJersey, 32, 'jersey', blue);
  setPlayerNumber(4, red);
  assert.deepEqual(lanesOf(r), playerNumberLanes(4));
  assert.deepEqual(lanesOf(b), playerNumberLanes(32), 'the other contestant keeps its own');
  assert.deepEqual(lanesOf(builder), playerNumberLanes(32), 'the builder keeps its own');
  const blueVersion = blueJersey.version;
  setPlayerNumber(68);
  assert.deepEqual(lanesOf(builder), playerNumberLanes(68));
  assert.deepEqual(lanesOf(r), playerNumberLanes(4), 'the builder\'s choice does not reach a contestant');
  assert.equal(blueJersey.version, blueVersion, 'untouched materials are not marked for update');
  const later = playerNumberUniforms(redCargos, 14, 'cargos', red);
  assert.deepEqual(lanesOf(later), playerNumberLanes(4), 'a piece loaded later takes its owner\'s choice');
  assert.equal(playerNumberPieces(red), 2);
  assert.equal(playerNumberPieces(), 1, 'the builder\'s hint counts its own pieces only');
  setPlayerNumber(null);
  for (const material of [builderJersey, redJersey, blueJersey, redCargos]) material.dispose();
  assert.equal(playerNumberPieces(red) + playerNumberPieces(), 0, 'disposed materials leave the registry');
});

// ------------------------------------------------------------------ the value and its link code

test('what a stored value means, and its link code', () => {
  for (const n of [0, 7, 10, 32, 99]) {
    assert.ok(isPlayerNumber(n));
    assert.equal(playerNumberFromShareCode(playerNumberShareCode(n)), n);
  }
  assert.equal(playerNumberShareCode(7), '7', 'one digit, no leading zero');
  assert.equal(playerNumberShareCode(0), '0');
  for (const bad of [-1, 100, 3.5, -10, NaN, '32', '7', null, undefined]) {
    assert.equal(isPlayerNumber(bad), false, String(bad));
    assert.equal(shownPlayerNumber(bad), null, String(bad));
    assert.equal(playerNumberShareCode(bad), undefined, String(bad));
  }
  assert.equal(storedPlayerNumber(123), 123, 'a value from a newer site is kept as stored');
  assert.equal(storedPlayerNumber(0), 0, '0 is a number, not "none"');
  assert.equal(storedPlayerNumber('7'), null);
  assert.ok(samePlayerNumber(undefined, null));
  assert.ok(!samePlayerNumber(0, null));
  for (const code of [null, undefined, '', '07', '00', '-1', '100', '3a', ' 32', '32 ', '7 ']) assert.equal(playerNumberFromShareCode(code), null, String(code));
});

test('links carry the number in both styles beside the body type and a pose; without one they are as before', () => {
  const look = { build: PIECES, bodyType: 'androgynous', playerNumber: 42 };
  const short = buildShareUrl(SITE, look, 'short', { clip: 'wave', time: 0.5, paused: true });
  assert.match(short, /#\/\?o=2\.[0-9a-z.]+&bt=a&pn=42&emote=wave&t=0\.5&paused=1$/);
  assert.equal(readOutfitLink(short)?.playerNumber, 42);
  assert.equal(readOutfitLink(short)?.bodyType, 'androgynous');
  const named = buildShareUrl(short, look, 'names');
  assert.equal(new URL(named).searchParams.get('pn'), '42');
  assert.equal(readOutfitLink(named)?.playerNumber, 42);

  const own = buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: null });
  assert.doesNotMatch(own, /pn=/);
  assert.equal(readOutfitLink(own)?.playerNumber, undefined);
  const fromNamed = buildShareUrl(named, { build: PIECES, bodyType: 'masculine', playerNumber: null }, 'names');
  assert.equal(new URL(fromNamed).searchParams.get('pn'), null, 'a stale pn is removed');
  // One digit, and 0, travel like any other number; a number this site cannot print is not written into a link.
  for (const n of [7, 0]) {
    const link = buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: n });
    assert.match(link, new RegExp(`&pn=${n}$`));
    assert.equal(readOutfitLink(link)?.playerNumber, n);
    assert.equal(readOutfitLink(buildShareUrl(link, { build: PIECES, bodyType: 'masculine', playerNumber: n }, 'names'))?.playerNumber, n);
  }
  assert.doesNotMatch(buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: 123 }), /pn=/);

  for (const old of [`${SITE}#/?o=2.36o.1l9.81qo.a17f.cct`, `${SITE}?o=2.36o.1l9.81qo.a17f.cct`,
    `${SITE}?outfit=${encodeOutfit({ slots: { face: FALLBACK_FACE } })}`])
    assert.equal(readOutfitLink(old)?.playerNumber, undefined, old);
  assert.equal(readOutfitLink(`${SITE}?outfit=${encodeOutfit({ slots: {}, playerNumber: 12 })}`)?.playerNumber, 12);
  // The JSON grammar drops a malformed number instead of failing the link.
  const bad = btoa(JSON.stringify({ slots: {}, playerNumber: 'x' })).replace(/=+$/, '');
  const dropped = readOutfitLink(`${SITE}?outfit=1.${bad}`);
  assert.deepEqual(dropped?.slots, {});
  assert.equal(dropped?.playerNumber, undefined);
});

test('a malformed pn never breaks a link: the outfit opens with each piece\'s own number', () => {
  for (const pn of ['07', '100', '-1', '%22%3E', '', 'ab']) {
    const outfit = readOutfitLink(`${SITE}#/?o=2.36o.1l9.81qo.a17f.cct&pn=${pn}`);
    assert.equal(Object.keys(outfit?.slots ?? {}).length, 5, pn);
    assert.equal(outfit?.playerNumber, undefined, pn);
  }
});

// ------------------------------------------------------------------ saved outfits, storage core

function harness(backend: OutfitBackend = new MemoryBackend(true), storage = memoryStorage()) {
  const timers = manualScheduler();
  let time = 1_000, id = 0;
  const open = (extra: Partial<LibraryOptions> = {}) => OutfitLibrary.open({
    backend, journal: storageJournal(storage), schedule: timers.schedule, now: () => time,
    newId: () => `outfit-${++id}`, ...extra,
  });
  return { backend, open, tick: (ms = 1000) => { time += ms; } };
}
const stored = async (backend: OutfitBackend, id: string) =>
  (await backend.readAll()).find(raw => (raw as { id: string }).id === id) as Record<string, unknown> | undefined;

test('a number-only edit is saved, survives a kill through the journal, and null clears it', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES })!;
  await tab.flush();
  assert.equal((await stored(h.backend, outfit.id))?.playerNumber, undefined);
  tab.setContent(outfit.id, PIECES, undefined, false, undefined, 23);
  assert.equal(tab.get(outfit.id)?.rev, 2, 'a number change alone is an edit');
  const next = await h.open(); // killed before the debounced write
  assert.equal(next.get(outfit.id)?.playerNumber, 23, 'replayed from the journal');
  await next.flush();
  assert.equal((await stored(h.backend, outfit.id))?.playerNumber, 23);
  next.setContent(outfit.id, PIECES, undefined, false, undefined, undefined);
  assert.equal(next.get(outfit.id)?.playerNumber, 23, 'undefined keeps the outfit\'s own');
  next.setContent(outfit.id, PIECES, undefined, false, undefined, null);
  assert.equal(next.get(outfit.id)?.playerNumber, undefined, 'null: each piece\'s own again');
  assert.equal(next.snapshot().outfits.length, 1, 'no fork');
});

test('a value from a newer site and an older tab\'s write both keep the stored number', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('newer', () => ({ v: 1, id: 'newer', rev: 3, name: 'From the future', createdAt: 1, updatedAt: 1,
    slots: PIECES, playerNumber: 7, armHair: 'lots' }));
  const h = harness(backend);
  const tab = await h.open();
  tab.setContent('newer', { ...PIECES, headwear: HAT }, undefined, false);
  await tab.flush();
  assert.equal((await stored(backend, 'newer'))?.playerNumber, 7);
  assert.equal((await stored(backend, 'newer'))?.armHair, 'lots');

  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES, playerNumber: 55 })!;
  await tab.flush();
  const OLD_KNOWN = ['v', 'id', 'rev', 'writer', 'name', 'createdAt', 'updatedAt', 'slots', 'labels', 'generated', 'deletedAt', 'bodyType'];
  await backend.update(outfit.id, raw => {
    const base = { ...(raw as Record<string, unknown>) };
    for (const key of OLD_KNOWN) delete base[key];
    return { ...base, v: 1, id: outfit.id, rev: 2, writer: 'old-tab', name: 'Outfit 1', createdAt: 1, updatedAt: 2,
      slots: { ...PIECES, headwear: HAT } };
  });
  assert.equal((await stored(backend, outfit.id))?.playerNumber, 55);
});

test('two tabs: a conflict fork keeps the losing tab\'s number; a duplicate copies it', async () => {
  const h = harness();
  const a = await h.open();
  const outfit = a.create({ name: 'Outfit 1', slots: PIECES })!;
  await a.flush();
  const b = await h.open();
  a.setContent(outfit.id, { ...PIECES, headwear: HAT }, undefined, false);
  await a.flush();
  h.tick();
  b.setContent(outfit.id, PIECES, undefined, false, undefined, 88);
  await b.flush();
  const fork = b.snapshot().outfits.find(r => r.id !== outfit.id);
  assert.ok(fork, 'b\'s version was kept as a separate outfit');
  assert.equal(fork.playerNumber, 88);
  assert.equal((await stored(h.backend, outfit.id))?.playerNumber, undefined, 'a\'s write stands');
  assert.equal(b.duplicate(fork.id)!.playerNumber, 88);
});

// ------------------------------------------------------------------ saved outfits in the builder

let backend: MemoryBackend;
let storage: ReturnType<typeof memoryStorage>;

async function visit() {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  useBuildStore.setState({ bodyType: 'masculine', playerNumber: null });
  let n = 0;
  await startSavedOutfits({ library: { backend, journal: storageJournal(storage), schedule: manualScheduler().schedule,
    newId: () => `o${++n}-${Math.random().toString(36).slice(2, 8)}` }, confirm: () => true });
}
const library = () => useSavedOutfits.getState().library!;
const currentRecord = () => {
  const c = library().current;
  return c?.kind === 'record' ? library().outfits.find(r => r.id === c.id) : undefined;
};
const store = () => useBuildStore.getState();

beforeEach(() => {
  backend = new MemoryBackend(true);
  storage = memoryStorage();
});

test('setting a number saves it into the outfit, and a reload restores it', async () => {
  await visit();
  openFromUrl(SITE);
  store().setPlayerNumber(42);
  assert.equal(currentRecord()?.playerNumber, 42);
  assert.equal(currentRecord()?.generated, undefined, 'a number is a hand edit');
  await visit();
  openFromUrl(SITE);
  assert.equal(store().playerNumber, 42);
  store().setPlayerNumber(null);
  assert.equal(currentRecord()?.playerNumber, undefined, 'Own clears it');
  assert.equal(library().outfits.length, 1);
});

test('New, Reset, Randomise and Duplicate keep the number on screen; switching outfits switches it', async () => {
  await visit();
  openFromUrl(SITE);
  store().setPlayerNumber(42);
  const first = currentRecord()!;
  resetOutfit();
  assert.equal(store().playerNumber, 42);
  assert.equal(currentRecord()?.playerNumber, 42);
  randomiseOutfit({ face: FALLBACK_FACE, headwear: HAT });
  assert.equal(currentRecord()?.playerNumber, 42);
  newOutfit();
  assert.equal(currentRecord()?.playerNumber, 42);
  store().setPlayerNumber(null);
  duplicateOutfit(first.id);
  assert.equal(currentRecord()?.playerNumber, 42, 'a duplicate copies the original\'s number');
  openFromUrl(buildShareUrl(SITE, { build: first.slots, bodyType: 'masculine', playerNumber: 42 }));
  assert.equal(store().playerNumber, 42);
});

test('a link is exact: other number, other outfit; the Roadmap round trip changes nothing', async () => {
  await visit();
  openFromUrl(SITE);
  store().load(PIECES);
  store().setPlayerNumber(42);
  const numbered = currentRecord()!;
  openFromUrl(buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: null }));
  assert.equal(library().current?.kind, 'draft', 'not the numbered outfit');
  assert.equal(store().playerNumber, null);
  assert.equal(library().outfits.find(r => r.id === numbered.id)?.playerNumber, 42, 'the saved outfit is untouched');
  openFromUrl(buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: 42 }));
  const before = currentRecord()!;
  assert.equal(before.id, numbered.id);
  openFromUrl(buildShareUrl(SITE, { build: store().build, bodyType: store().bodyType, playerNumber: store().playerNumber }));
  assert.equal(currentRecord()?.rev, before.rev);
});

test('an outfit saved before numbers shows each piece\'s own, and editing it does not invent one', async () => {
  await backend.update('old', () => ({ v: 1, id: 'old', rev: 1, name: 'Before numbers', createdAt: 1, updatedAt: 99,
    slots: { face: FALLBACK_FACE } }));
  await visit();
  openFromUrl(SITE);
  assert.equal(currentRecord()?.id, 'old');
  assert.equal(store().playerNumber, null, 'an outfit saved before numbers shows each piece\'s own');
  store().equip(getItemById(HAT)!);
  assert.equal(currentRecord()?.playerNumber, undefined, 'and editing it does not invent one');
});

// ------------------------------------------------------------------ the share Worker

const APP = 'https://chronohaxx.github.io/the-finals-outfit/';
const BASE = 'https://share.example.workers.dev';
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...sos, 0x12, 0x34, 0xff, 0xd9]);
}
class MemoryKV {
  entries = new Map<string, { value: Uint8Array; metadata: unknown }>();
  async put(key: string, value: Uint8Array, options: { metadata?: unknown }) { this.entries.set(key, { value, metadata: options.metadata }); }
  async get(key: string) { return this.entries.get(key)?.value.slice().buffer ?? null; }
  async getWithMetadata(key: string) {
    const entry = this.entries.get(key);
    return entry ? { value: new Blob([entry.value]).stream(), metadata: entry.metadata } : { value: null, metadata: null };
  }
}
const workerEnv = () => ({ SHARES: new MemoryKV(), APP_URL: APP, ALLOWED_ORIGINS: 'https://chronohaxx.github.io' }) as unknown as Env & { SHARES: MemoryKV };
const post = (e: Env, query: string) => worker.fetch(new Request(`${BASE}/api/share?${query}`, { method: 'POST', body: jpeg(1200, 630),
  headers: { Origin: 'https://chronohaxx.github.io', 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': '203.0.113.7' } }), e);

test('the share Worker stores the number with the card and opens the builder on it', async () => {
  const e = workerEnv();
  const query = uploadQuery('2.12a', { clip: 'wave', time: 1.5, paused: true } as never, 'a', '42');
  assert.match(query, /^o=2\.12a&bt=a&pn=42&emote=/);
  const response = await post(e, query);
  assert.equal(response.status, 201);
  const { url } = await response.json() as { url: string };
  assert.equal(new URL(url).searchParams.get('pn'), '42', 'the app checks this before using the link');
  const id = /\/s\/(\w{12})/.exec(url)![1];
  assert.equal((e.SHARES.entries.get(`s:${id}`)!.metadata as Record<string, string>).pn, '42');
  const page = await (await worker.fetch(new Request(url), e)).text();
  assert.match(page, /location\.replace\("https:\/\/chronohaxx\.github\.io\/the-finals-outfit\/#\/\?o=2\.12a&bt=a&pn=42&emote=/);
  const tampered = await (await worker.fetch(new Request(`${BASE}/s/${id}?o=2.12a&pn=11`), e)).text();
  assert.match(tampered, /#\/\?o=2\.12a&bt=a&pn=42/, 'the stored number wins while the entry lives');
  const expired = await (await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA?o=2.12a&pn=42`), e)).text();
  assert.match(expired, /#\/\?o=2\.12a&pn=42"\)/);
});

test('the Worker refuses a malformed number and keeps number-less uploads exactly as before', async () => {
  const e = workerEnv();
  for (const bad of ['%22%3E', '07', '100', '-1', 'ab']) assert.equal((await post(e, `o=2.12a&pn=${bad}`)).status, 400, bad);
  for (const good of ['0', '7', '10', '99']) assert.equal(readPlayerNumber(new URLSearchParams(`pn=${good}`)), good, good);
  assert.equal(readPlayerNumber(new URLSearchParams('o=2.12a')), undefined);
  const plain = await (await post(e, 'o=2.12a')).json() as { url: string };
  assert.match(plain.url, /\?o=2\.12a$/);
  const id = /\/s\/(\w{12})/.exec(plain.url)![1];
  assert.deepEqual(e.SHARES.entries.get(`s:${id}`)!.metadata, { o: '2.12a' });
});
