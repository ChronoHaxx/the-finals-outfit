// The player (contestant) number (21 Nov 2026). Two halves:
// - the shader route (src/rig/PlayerNumber.ts): find the two atlas lanes the slicer left as literals, rewrite them to a
//   uniform, and drive every live material from the viewer's choice. Synthetic programs here; the census over the
//   real recovered programs is scripts/check-player-number.mjs (237 of 237 matched their authored DecalNumber).
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
  findPlayerNumberSites, PLAYER_NUMBER_UNIFORM, playerNumberLanes, playerNumberPieces, playerNumberUniform,
  rewritePlayerNumberGlsl, setPlayerNumber,
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

const literal = (value: number) => Math.fround(value).toPrecision(9);
// A synthetic program in the slicer's output form: one atlas site (u * 2 * 0.1, then the tens and ones adds from one
// instruction) per number slot, plus unrelated arithmetic.
function program(numbers: number[], options: { foldOnes?: boolean; noScale?: boolean } = {}) {
  const lines = ['ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, vec3 viewTangent) {',
    '  float n1 = (uv0.x + 0.300000012); // asm:10'];
  let node = 2;
  numbers.forEach((n, i) => {
    const [tens, ones] = playerNumberLanes(n);
    const u = node++, scaled = node++, tensNode = node++, onesNode = node++;
    lines.push(`  float n${u} = (n1 * 2.0); // asm:${100 + i}`);
    lines.push(options.noScale ? `  float n${scaled} = (n${u} * 0.5); // asm:${110 + i}`
      : `  float n${scaled} = (n${u} * 0.100000001); // asm:${110 + i}`);
    lines.push(`  float n${tensNode} = (n${scaled} + ${literal(tens)}); // asm:${140 + i}`);
    if (!options.foldOnes) lines.push(`  float n${onesNode} = (n${scaled} + ${literal(ones)}); // asm:${140 + i}`);
  });
  lines.push('  return surface;', '}');
  return lines.join('\n');
}

test('the lanes are the preshader\'s float32 values: 32 gives the literals the shipped programs carry', () => {
  const [tens, ones] = playerNumberLanes(32);
  assert.equal(tens, Math.fround(0.300000012));
  assert.equal(ones, Math.fround(0.200000048), 'frac(3.2) in float32, not 0.2');
  const pairs = new Set<string>();
  for (let n = 10; n <= 99; n++) {
    const [t, o] = playerNumberLanes(n);
    pairs.add(`${t}|${o}`);
    assert.ok(Math.abs(t - Math.floor(n / 10) / 10) < 1e-6 && Math.abs(o - (n % 10) / 10) < 1e-6, String(n));
  }
  assert.equal(pairs.size, 90, 'every two-digit number has its own pair');
});

test('the route finds every site of an authored two-digit number and rewrites exactly those adds', () => {
  const source = program([68, 68]);
  const found = findPlayerNumberSites(source);
  assert.equal(found?.authored, 68);
  assert.equal(found?.sites.length, 2);
  const rewritten = rewritePlayerNumberGlsl(source, found!);
  assert.ok(rewritten.startsWith(`uniform vec2 ${PLAYER_NUMBER_UNIFORM};\n`));
  assert.equal(rewritten.split(`${PLAYER_NUMBER_UNIFORM}.x`).length - 1, 2);
  assert.equal(rewritten.split(`${PLAYER_NUMBER_UNIFORM}.y`).length - 1, 2);
  assert.match(rewritten, /float n1 = \(uv0\.x \+ 0\.300000012\); \/\/ asm:10/, 'an unrelated 0.3 is left alone');
  const untouched = source.split('\n').filter(line => !/\+ 0\.(600000024|800000[0-9]+)\)/.test(line));
  for (const line of untouched) assert.ok(rewritten.includes(line), line);
});

test('the route refuses what it cannot change exactly: one-digit and round numbers, disagreeing sites, other shapes', () => {
  assert.equal(findPlayerNumberSites(program([30], { foldOnes: true })), undefined, 'a round number folded its ones lane');
  assert.equal(findPlayerNumberSites(program([32, 68])), undefined, 'sites must agree on the one DecalNumber');
  assert.equal(findPlayerNumberSites(program([32], { noScale: true })), undefined, 'not the two-cell atlas scale');
  assert.equal(findPlayerNumberSites('void main() {}'), undefined);
  // A one-digit authored number has no tens lane (0 folds away) and centring lanes in its place.
  const single = program([5]).replace(/\n {2}float n\d+ = \(n\d+ \+ 0\.0+\); \/\/ asm:140/, '');
  assert.equal(findPlayerNumberSites(single), undefined);
});

test('live materials follow the viewer\'s number; null puts each piece\'s own back; disposed ones leave', () => {
  setPlayerNumber(null);
  const a = new THREE.MeshPhysicalMaterial(), b = new THREE.MeshPhysicalMaterial(), shadow = new THREE.MeshDepthMaterial();
  const ua = playerNumberUniform(a, 32, 'jersey'), ub = playerNumberUniform(b, 68, 'shorts');
  playerNumberUniform(shadow, 32, 'jersey');
  assert.equal(playerNumberPieces(), 2, 'counted by piece, not by pass');
  assert.deepEqual(ua.value.toArray(), playerNumberLanes(32));
  assert.deepEqual(ub.value.toArray(), playerNumberLanes(68));
  const version = a.version;
  setPlayerNumber(7);
  assert.deepEqual(ua.value.toArray(), playerNumberLanes(32), 'a one-digit number is not printed: each piece\'s own');
  setPlayerNumber(45);
  assert.deepEqual(ua.value.toArray(), playerNumberLanes(45));
  assert.deepEqual(ub.value.toArray(), playerNumberLanes(45));
  assert.ok(a.version > version, 'marked for update, which restarts the still-view accumulation');
  setPlayerNumber(null);
  assert.deepEqual(ub.value.toArray(), playerNumberLanes(68));
  b.dispose();
  assert.equal(playerNumberPieces(), 1);
  a.dispose(); shadow.dispose();
  assert.equal(playerNumberPieces(), 0);
});

// ------------------------------------------------------------------ the value and its link code

test('what a stored value means, and its link code', () => {
  for (const n of [10, 32, 99]) {
    assert.ok(isPlayerNumber(n));
    assert.equal(playerNumberFromShareCode(playerNumberShareCode(n)), n);
  }
  for (const bad of [9, 100, 3.5, -10, NaN, '32', null, undefined]) {
    assert.equal(isPlayerNumber(bad), false, String(bad));
    assert.equal(shownPlayerNumber(bad), null, String(bad));
    assert.equal(playerNumberShareCode(bad), undefined, String(bad));
  }
  assert.equal(storedPlayerNumber(7), 7, 'a value from a newer site is kept as stored');
  assert.equal(storedPlayerNumber('7'), null);
  assert.ok(samePlayerNumber(undefined, null));
  for (const code of [null, undefined, '', '7', '07', '100', '3a', ' 32', '32 ']) assert.equal(playerNumberFromShareCode(code), null, String(code));
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
  // A number this site cannot print is not written into a link.
  assert.doesNotMatch(buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine', playerNumber: 7 }), /pn=/);

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
  for (const pn of ['7', '100', '%22%3E', '', 'ab']) {
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
  for (const bad of ['%22%3E', '7', '100', 'ab']) assert.equal((await post(e, `o=2.12a&pn=${bad}`)).status, 400, bad);
  assert.equal(readPlayerNumber(new URLSearchParams('o=2.12a')), undefined);
  const plain = await (await post(e, 'o=2.12a')).json() as { url: string };
  assert.match(plain.url, /\?o=2\.12a$/);
  const id = /\/s\/(\w{12})/.exec(plain.url)![1];
  assert.deepEqual(e.SHARES.entries.get(`s:${id}`)!.metadata, { o: '2.12a' });
});
