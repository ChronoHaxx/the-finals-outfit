// Body type as part of an outfit (12 Nov 2026): the picker's value must survive everything a saved outfit or a link
// survives. Loss paths: a body-type-only edit then a kill, two tabs, a conflict fork, a duplicate, an older tab that
// does not know the field, a value from a newer site, every link made before body types, a stale `bt` in the address
// bar, and the share Worker (old and new).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import { getItemById } from '../src/lib/catalog';
import {
  bodyTypeFromShareCode, bodyTypeOf, bodyTypeShareCode, shownBodyType, VISITOR_BODY_TYPES,
} from '../src/lib/body-type';
import { BODY_TYPE_IDS as RIG_BODY_TYPE_IDS } from '../src/rig/BodyTypePreview';
import { encodeOutfit } from '../src/lib/outfit';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { uploadQuery } from '../src/lib/share-preview';
import { OutfitLibrary, type LibraryOptions, type OutfitBackend } from '../src/lib/outfit-library';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { FALLBACK_FACE, useBuildStore } from '../src/store/useBuildStore';
import {
  duplicateOutfit, newOutfit, openFromUrl, randomiseOutfit, resetOutfit, startSavedOutfits, stopSavedOutfits,
  useSavedOutfits,
} from '../src/store/useSavedOutfits';
import worker from '../workers/share-preview/src/index';
import { readBodyType, type Env } from '../workers/share-preview/src/share';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const HAT = 'attachment-pumpkinhead-hat';
const BOOTS = 'actionhero-sentinelboots-leather';
const PIECES = { face: FALLBACK_FACE, feet: BOOTS };

// ------------------------------------------------------------------ the ids and codes

test('the rig and the outfit agree on the body type ids; visitors get Masculine and Androgynous', () => {
  assert.deepEqual([...RIG_BODY_TYPE_IDS].sort(), ['androgynous', 'feminine', 'masculine']);
  assert.deepEqual(VISITOR_BODY_TYPES, ['masculine', 'androgynous']);
  assert.equal(bodyTypeOf(undefined), 'masculine', 'an outfit from before body types is Masculine');
  assert.equal(bodyTypeOf('from-a-newer-site'), 'masculine');
  assert.equal(shownBodyType('androgynous'), 'androgynous');
  assert.equal(shownBodyType('feminine'), 'masculine', 'Feminine waits for the Season 12 item refresh');
  assert.equal(bodyTypeShareCode('masculine'), undefined, 'Masculine adds nothing to a link');
  assert.equal(bodyTypeShareCode('androgynous'), 'a');
  assert.equal(bodyTypeShareCode('feminine'), 'f');
  assert.equal(bodyTypeShareCode('from-a-newer-site'), undefined);
  for (const code of [null, undefined, '', 'z', 'A', 'f ', 'af']) assert.equal(bodyTypeFromShareCode(code), code === 'f' ? 'feminine' : 'masculine', String(code));
  assert.equal(bodyTypeFromShareCode('a'), 'androgynous');
});

// ------------------------------------------------------------------ links

test('links carry the body type in both styles, next to a pose; Masculine and every older link have none', () => {
  const short = buildShareUrl(SITE, { build: PIECES, bodyType: 'androgynous' }, 'short',
    { clip: 'wave', time: 0.5, paused: true });
  assert.match(short, /#\/\?o=2\.[0-9a-z.]+&bt=a&emote=wave&t=0\.5&paused=1$/);
  assert.equal(readOutfitLink(short)?.bodyType, 'androgynous');
  assert.deepEqual(readOutfitLink(short)?.slots, PIECES);
  const named = buildShareUrl(short, { build: PIECES, bodyType: 'androgynous' }, 'names');
  assert.equal(new URL(named).searchParams.get('bt'), 'a');
  assert.equal(readOutfitLink(named)?.bodyType, 'androgynous');

  const masculine = buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine' });
  assert.doesNotMatch(masculine, /bt=/);
  assert.equal(readOutfitLink(masculine)?.bodyType, undefined);
  // The address bar after opening a readable Androgynous link: the next Masculine link must not keep its `bt`.
  const fromNamed = buildShareUrl(named, { build: PIECES, bodyType: 'masculine' }, 'names');
  assert.equal(new URL(fromNamed).searchParams.get('bt'), null, 'a stale bt is removed');
  assert.equal(readOutfitLink(fromNamed)?.bodyType, undefined);

  // A frozen link from before body types, in each grammar, still opens with no body type (Masculine).
  for (const old of [`${SITE}#/?o=2.36o.1l9.81qo.a17f.cct`, `${SITE}?o=2.36o.1l9.81qo.a17f.cct`,
    `${SITE}?outfit=${encodeOutfit({ slots: { face: FALLBACK_FACE } })}`])
    assert.equal(readOutfitLink(old)?.bodyType, undefined, old);
  // The JSON grammar keeps a body type too.
  assert.equal(readOutfitLink(`${SITE}?outfit=${encodeOutfit({ slots: {}, bodyType: 'androgynous' })}`)?.bodyType, 'androgynous');
});

test('an unknown or malformed bt never breaks a link: the outfit opens as Masculine', () => {
  for (const bt of ['z', 'AA', '%22%3E', '']) {
    const link = `${SITE}#/?o=2.36o.1l9.81qo.a17f.cct&bt=${bt}`;
    const outfit = readOutfitLink(link);
    assert.equal(Object.keys(outfit?.slots ?? {}).length, 5, bt);
    assert.equal(outfit?.bodyType, undefined, bt);
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

test('a body-type-only edit is saved, and survives a kill through the journal', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES })!;
  await tab.flush();
  assert.equal((await stored(h.backend, outfit.id))?.bodyType, undefined, 'created without one: Masculine');
  tab.setContent(outfit.id, PIECES, undefined, false, 'androgynous');
  assert.equal(tab.get(outfit.id)?.rev, 2, 'a body type change alone is an edit');
  // Killed before the debounced write.
  const next = await h.open();
  assert.equal(next.get(outfit.id)?.bodyType, 'androgynous', 'replayed from the journal');
  await next.flush();
  assert.equal((await stored(h.backend, outfit.id))?.bodyType, 'androgynous');
  assert.equal(next.snapshot().outfits.length, 1, 'no fork');
});

test('absent and "masculine" mean the same: saying Masculine again is not an edit', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES })!;
  tab.setContent(outfit.id, PIECES, undefined, false, 'masculine');
  assert.equal(tab.get(outfit.id)?.rev, 1);
  tab.setContent(outfit.id, { ...PIECES, headwear: HAT }, undefined, false);
  assert.equal(tab.get(outfit.id)?.bodyType, undefined, 'undefined keeps the outfit\'s own');
});

test('a value from a newer site is kept through this version\'s edits', async () => {
  const backend = new MemoryBackend(true);
  await backend.update('newer', () => ({ v: 1, id: 'newer', rev: 3, name: 'From the future', createdAt: 1, updatedAt: 1,
    slots: PIECES, bodyType: 'heavy-muscular', armHair: 'lots' }));
  const h = harness(backend);
  const tab = await h.open();
  tab.setContent('newer', { ...PIECES, headwear: HAT }, undefined, false);
  await tab.flush();
  const record = await stored(backend, 'newer');
  assert.equal(record?.bodyType, 'heavy-muscular');
  assert.equal(record?.armHair, 'lots', 'unknown fields still survive');
  assert.equal((record?.slots as Record<string, string>).headwear, HAT);
});

test('an older tab that does not know body types keeps the stored one when it writes', async () => {
  // The read-modify-write an older version does: every field it does not know comes from the stored copy.
  const backend = new MemoryBackend(true);
  const h = harness(backend);
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES, bodyType: 'androgynous' })!;
  await tab.flush();
  const OLD_KNOWN = ['v', 'id', 'rev', 'writer', 'name', 'createdAt', 'updatedAt', 'slots', 'labels', 'generated', 'deletedAt'];
  await backend.update(outfit.id, raw => {
    const base = { ...(raw as Record<string, unknown>) };
    for (const key of OLD_KNOWN) delete base[key];
    return { ...base, v: 1, id: outfit.id, rev: 2, writer: 'old-tab', name: 'Outfit 1', createdAt: 1, updatedAt: 2,
      slots: { ...PIECES, headwear: HAT } };
  });
  assert.equal((await stored(backend, outfit.id))?.bodyType, 'androgynous');
});

test('two tabs: a conflict fork keeps the losing tab\'s body type; a duplicate copies it', async () => {
  const h = harness();
  const a = await h.open();
  const outfit = a.create({ name: 'Outfit 1', slots: PIECES })!;
  await a.flush();
  const b = await h.open();
  a.setContent(outfit.id, { ...PIECES, headwear: HAT }, undefined, false);
  await a.flush();
  h.tick();
  b.setContent(outfit.id, PIECES, undefined, false, 'androgynous');
  await b.flush();
  const fork = b.snapshot().outfits.find(r => r.id !== outfit.id);
  assert.ok(fork, 'b\'s version was kept as a separate outfit');
  assert.equal(fork.bodyType, 'androgynous');
  assert.equal((await stored(h.backend, outfit.id))?.bodyType, undefined, 'a\'s write stands');
  const copy = b.duplicate(fork.id)!;
  assert.equal(copy.bodyType, 'androgynous');
});

// ------------------------------------------------------------------ saved outfits in the builder

let backend: MemoryBackend;
let storage: ReturnType<typeof memoryStorage>;

async function visit() {
  stopSavedOutfits();
  // A page load: the starting look, Masculine.
  useBuildStore.getState().reset();
  useBuildStore.setState({ bodyType: 'masculine' });
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
const pick = (bodyType: 'masculine' | 'androgynous') => store().setBodyType(bodyType);

beforeEach(() => {
  backend = new MemoryBackend(true);
  storage = memoryStorage();
});

test('picking a body type saves it into the outfit, and a reload restores it', async () => {
  await visit();
  openFromUrl(SITE);
  pick('androgynous');
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  assert.equal(currentRecord()?.generated, undefined, 'a body type pick is a hand edit');
  await visit(); // killed before the debounced write
  openFromUrl(SITE);
  assert.equal(store().bodyType, 'androgynous');
  assert.equal(library().outfits.length, 1);
});

test('New, Reset, Randomise and Duplicate keep the body type on screen', async () => {
  await visit();
  openFromUrl(SITE);
  pick('androgynous');
  const first = currentRecord()!;
  resetOutfit();
  assert.equal(store().bodyType, 'androgynous');
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  randomiseOutfit({ face: FALLBACK_FACE, headwear: HAT });
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  newOutfit();
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  duplicateOutfit(first.id);
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  assert.equal(library().outfits.find(r => r.id === first.id)?.bodyType, 'androgynous');
});

test('switching outfits switches the body type with them', async () => {
  await visit();
  openFromUrl(SITE);
  pick('androgynous');
  const andro = currentRecord()!;
  newOutfit();
  pick('masculine');
  assert.equal(currentRecord()?.bodyType, 'masculine');
  openFromUrl(buildShareUrl(SITE, { build: andro.slots, bodyType: 'androgynous' }));
  assert.equal(currentRecord()?.id, andro.id, 'the same pieces and body type select the saved outfit');
  assert.equal(store().bodyType, 'androgynous');
});

test('a link is exact: the same pieces with another body type are another outfit; a link without one is Masculine', async () => {
  await visit();
  openFromUrl(SITE);
  store().load(PIECES);
  pick('androgynous');
  const andro = currentRecord()!;
  assert.deepEqual(andro.slots, PIECES);
  openFromUrl(buildShareUrl(SITE, { build: PIECES, bodyType: 'masculine' }));
  assert.equal(library().current?.kind, 'draft', 'not the Androgynous outfit');
  assert.equal(store().bodyType, 'masculine');
  assert.equal(library().outfits.find(r => r.id === andro.id)?.bodyType, 'androgynous', 'the saved outfit is untouched');
  // Picking a body type on the draft saves it, with its pieces.
  pick('androgynous');
  assert.equal(currentRecord()?.name, 'Shared outfit');
  assert.equal(currentRecord()?.bodyType, 'androgynous');
  assert.deepEqual(currentRecord()?.slots, PIECES);
});

test('the Roadmap round trip (a link of what is on screen) changes nothing', async () => {
  await visit();
  openFromUrl(SITE);
  pick('androgynous');
  const before = currentRecord()!;
  openFromUrl(buildShareUrl(SITE, { build: store().build, bodyType: store().bodyType }));
  assert.equal(currentRecord()?.id, before.id);
  assert.equal(currentRecord()?.rev, before.rev);
  assert.equal(store().bodyType, 'androgynous');
});

test('an unknown body type from a newer site renders as Masculine and is kept when the outfit is edited', async () => {
  await backend.update('newer', () => ({ v: 1, id: 'newer', rev: 1, name: 'From the future', createdAt: 1, updatedAt: 5,
    slots: { face: FALLBACK_FACE }, bodyType: 'heavy-muscular' }));
  await visit();
  openFromUrl(SITE);
  assert.equal(currentRecord()?.id, 'newer');
  assert.equal(store().bodyType, 'heavy-muscular');
  assert.equal(shownBodyType(store().bodyType), 'masculine');
  store().equip(getItemById(HAT)!);
  assert.equal(currentRecord()?.bodyType, 'heavy-muscular');
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

test('the share Worker stores the body type with the card and opens the builder on it', async () => {
  const e = workerEnv();
  const query = uploadQuery('2.12a', { clip: 'wave', time: 1.5, paused: true } as never, 'a');
  assert.match(query, /^o=2\.12a&bt=a&emote=/);
  const response = await post(e, query);
  assert.equal(response.status, 201);
  const { url } = await response.json() as { url: string };
  assert.equal(new URL(url).searchParams.get('bt'), 'a', 'the app checks this before using the link');
  const id = /\/s\/(\w{12})/.exec(url)![1];
  assert.equal((e.SHARES.entries.get(`s:${id}`)!.metadata as Record<string, string>).bt, 'a');
  const page = await (await worker.fetch(new Request(url), e)).text();
  assert.match(page, /location\.replace\("https:\/\/chronohaxx\.github\.io\/the-finals-outfit\/#\/\?o=2\.12a&bt=a&emote=/);
  // The stored body type wins over a tampered link while the entry lives; an expired link uses its own.
  const tampered = await (await worker.fetch(new Request(`${BASE}/s/${id}?o=2.12a&bt=f`), e)).text();
  assert.match(tampered, /#\/\?o=2\.12a&bt=a/);
  const expired = await (await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA?o=2.12a&bt=a`), e)).text();
  assert.match(expired, /#\/\?o=2\.12a&bt=a"\)/);
});

test('the Worker refuses a malformed body type and keeps Masculine uploads exactly as before', async () => {
  const e = workerEnv();
  for (const bad of ['%22%3E', 'ABC', 'abc', '1']) assert.equal((await post(e, `o=2.12a&bt=${bad}`)).status, 400, bad);
  assert.equal(readBodyType(new URLSearchParams('o=2.12a')), undefined);
  const plain = await (await post(e, 'o=2.12a')).json() as { url: string };
  assert.match(plain.url, /\?o=2\.12a$/);
  const id = /\/s\/(\w{12})/.exec(plain.url)![1];
  assert.deepEqual(e.SHARES.entries.get(`s:${id}`)!.metadata, { o: '2.12a' });
});
