// Archetype (Light / Medium / Heavy) as part of an outfit (22 Nov 2026): the picker's value must survive everything a
// saved outfit or a link survives, like the body type (tests/body-type-outfits.test.ts). Loss paths: an archetype-only
// edit then a kill, an older tab that does not know the field, a value from a newer site, every link made before
// archetypes, a stale `ar` in the address bar, outfit switching, and the share Worker (old and new).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/load-catalog';
import {
  archetypeFromShareCode, archetypeOf, archetypeShareCode, ARCHETYPE_TAGS, bodyTypeSupportsArchetype,
} from '../src/lib/archetype';
import { encodeOutfit } from '../src/lib/outfit';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { uploadQuery } from '../src/lib/share-preview';
import { OutfitLibrary, type LibraryOptions, type OutfitBackend } from '../src/lib/outfit-library';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { FALLBACK_FACE, useBuildStore } from '../src/store/useBuildStore';
import {
  newOutfit, openFromUrl, randomiseOutfit, resetOutfit, startSavedOutfits, stopSavedOutfits, useSavedOutfits,
} from '../src/store/useSavedOutfits';
import worker from '../workers/share-preview/src/index';
import { readArchetype, type Env } from '../workers/share-preview/src/share';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const BOOTS = 'actionhero-sentinelboots-leather';
const HAT = 'attachment-pumpkinhead-hat';
const PIECES = { face: FALLBACK_FACE, feet: BOOTS };
const look = (archetype: string, bodyType = 'masculine') => ({ build: PIECES, bodyType, playerNumber: null, archetype });

// ------------------------------------------------------------------ the ids, codes and the game's rules

test('archetype ids, share codes and resolver tags; absent or unknown is Medium', () => {
  assert.equal(archetypeOf(undefined), 'medium', 'an outfit from before archetypes is Medium');
  assert.equal(archetypeOf('from-a-newer-site'), 'medium');
  assert.equal(archetypeOf('light'), 'light');
  assert.equal(archetypeShareCode('medium'), undefined, 'Medium adds nothing to a link');
  assert.equal(archetypeShareCode('light'), 'l');
  assert.equal(archetypeShareCode('heavy'), 'h');
  assert.equal(archetypeShareCode('from-a-newer-site'), undefined);
  for (const code of [null, undefined, '', 'm', 'L', 'lh', 'h ']) assert.equal(archetypeFromShareCode(code), 'medium', String(code));
  assert.equal(archetypeFromShareCode('l'), 'light');
  assert.equal(archetypeFromShareCode('h'), 'heavy');
  assert.deepEqual(ARCHETYPE_TAGS, { light: 'Customization.Archetype.Light', medium: 'Customization.Archetype.Medium',
    heavy: 'Customization.Archetype.Heavy' });
});

test('which body types each archetype supports is the Season 12 assets\' own SupportedArchetypes', () => {
  const read = (folder: string, name: string) => (JSON.parse(readFileSync(new URL(
    `../_docs/body-types-2026-11-06/${folder}/extract/DA_BodyType_${name}.properties.json`, import.meta.url), 'utf8')) as
    { Name: string; properties: { SupportedArchetypes?: string[] } }[]).find(e => e.Name === `DA_BodyType_${name}`)!.properties;
  const assets = { masculine: read('s12-bodytypes-read', 'Masculine'), feminine: read('s12-bodytypes-read', 'Feminine'),
    androgynous: read('s12-androgynous-read', 'Androgynous') };
  for (const [id, asset] of Object.entries(assets))
    for (const archetype of ['light', 'medium', 'heavy'] as const) {
      // An asset that authors no SupportedArchetypes supports every class.
      const authored = asset.SupportedArchetypes?.map(a => a.replace('EArchetypeSize::', '').toLowerCase());
      assert.equal(bodyTypeSupportsArchetype(id, archetype), !authored || authored.includes(archetype), `${id} on ${archetype}`);
    }
  assert.equal(bodyTypeSupportsArchetype('androgynous', 'light'), false, 'Androgynous is Medium-only');
  assert.equal(bodyTypeSupportsArchetype('from-a-newer-site', 'heavy'), true, 'an unknown body type renders as Masculine');
});

// ------------------------------------------------------------------ links

test('links carry the archetype in both styles beside the body type; Medium and every older link have none', () => {
  const short = buildShareUrl(SITE, look('heavy', 'androgynous'), 'short', { clip: 'wave', time: 0.5, paused: true });
  assert.match(short, /#\/\?o=2\.[0-9a-z.]+&bt=a&ar=h&emote=wave&t=0\.5&paused=1$/);
  assert.equal(readOutfitLink(short)?.archetype, 'heavy');
  assert.equal(readOutfitLink(short)?.bodyType, 'androgynous', 'the stored body type is kept even where it cannot show');
  const named = buildShareUrl(short, look('light'), 'names');
  assert.equal(new URL(named).searchParams.get('ar'), 'l');
  assert.equal(readOutfitLink(named)?.archetype, 'light');
  // The address bar after opening a readable Light link: the next Medium link must not keep its `ar`.
  const medium = buildShareUrl(named, look('medium'), 'names');
  assert.equal(new URL(medium).searchParams.get('ar'), null, 'a stale ar is removed');
  assert.equal(readOutfitLink(medium)?.archetype, undefined);
  for (const old of [`${SITE}#/?o=2.36o.1l9.81qo.a17f.cct`, `${SITE}?o=2.36o.1l9.81qo.a17f.cct&bt=a`,
    `${SITE}?outfit=${encodeOutfit({ slots: { face: FALLBACK_FACE } })}`])
    assert.equal(readOutfitLink(old)?.archetype, undefined, old);
  for (const ar of ['z', 'LL', '%22%3E', '', 'm'])
    assert.equal(readOutfitLink(`${SITE}#/?o=2.36o.1l9.81qo.a17f.cct&ar=${ar}`)?.archetype, undefined, `malformed ar=${ar}`);
});

// ------------------------------------------------------------------ saved outfits, storage core

function harness(backend: OutfitBackend = new MemoryBackend(true), storage = memoryStorage()) {
  let time = 1_000, id = 0;
  const open = (extra: Partial<LibraryOptions> = {}) => OutfitLibrary.open({
    backend, journal: storageJournal(storage), schedule: manualScheduler().schedule, now: () => time,
    newId: () => `outfit-${++id}`, ...extra,
  });
  return { backend, open, tick: (ms = 1000) => { time += ms; } };
}
const stored = async (backend: OutfitBackend, id: string) =>
  (await backend.readAll()).find(raw => (raw as { id: string }).id === id) as Record<string, unknown> | undefined;

test('an archetype-only edit is saved and survives a kill; absent and "medium" are the same', async () => {
  const h = harness();
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES })!;
  tab.setContent(outfit.id, PIECES, undefined, false, undefined, undefined, 'medium');
  assert.equal(tab.get(outfit.id)?.rev, 1, 'saying Medium again is not an edit');
  tab.setContent(outfit.id, PIECES, undefined, false, undefined, undefined, 'heavy');
  assert.equal(tab.get(outfit.id)?.rev, 2, 'an archetype change alone is an edit');
  const next = await h.open(); // killed before the debounced write
  assert.equal(next.get(outfit.id)?.archetype, 'heavy', 'replayed from the journal');
  next.setContent(outfit.id, { ...PIECES, headwear: HAT }, undefined, false);
  assert.equal(next.get(outfit.id)?.archetype, 'heavy', 'undefined keeps the outfit\'s own');
  assert.equal(next.duplicate(outfit.id)?.archetype, 'heavy', 'a duplicate copies it');
});

test('an older tab that does not know archetypes keeps the stored one; a newer site\'s value is kept', async () => {
  const backend = new MemoryBackend(true);
  const h = harness(backend);
  const tab = await h.open();
  const outfit = tab.create({ name: 'Outfit 1', slots: PIECES, archetype: 'light' })!;
  await tab.flush();
  const OLD_KNOWN = ['v', 'id', 'rev', 'writer', 'name', 'createdAt', 'updatedAt', 'slots', 'labels', 'generated', 'deletedAt',
    'bodyType', 'playerNumber', 'cameraViews'];
  await backend.update(outfit.id, raw => {
    const base = { ...(raw as Record<string, unknown>) };
    for (const key of OLD_KNOWN) delete base[key];
    return { ...base, v: 1, id: outfit.id, rev: 2, writer: 'old-tab', name: 'Outfit 1', createdAt: 1, updatedAt: 2, slots: PIECES };
  });
  assert.equal((await stored(backend, outfit.id))?.archetype, 'light');
  await backend.update('newer', () => ({ v: 1, id: 'newer', rev: 3, name: 'From the future', createdAt: 1, updatedAt: 1,
    slots: PIECES, archetype: 'ultra-heavy' }));
  const later = await harness(backend).open();
  later.setContent('newer', { ...PIECES, headwear: HAT }, undefined, false);
  await later.flush();
  assert.equal((await stored(backend, 'newer'))?.archetype, 'ultra-heavy');
});

// ------------------------------------------------------------------ saved outfits in the builder

let backend: MemoryBackend;
let storage: ReturnType<typeof memoryStorage>;
async function visit() {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  useBuildStore.setState({ bodyType: 'masculine', archetype: 'medium' });
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

test('picking an archetype saves it into the outfit, and a reload restores it', async () => {
  await visit();
  openFromUrl(SITE);
  store().setArchetype('light');
  assert.equal(currentRecord()?.archetype, 'light');
  await visit(); // killed before the debounced write
  openFromUrl(SITE);
  assert.equal(store().archetype, 'light');
  assert.equal(library().outfits.length, 1);
});

test('New, Reset and Randomise keep the archetype on screen; switching outfits switches it', async () => {
  await visit();
  openFromUrl(SITE);
  store().setArchetype('heavy');
  const heavy = currentRecord()!;
  resetOutfit();
  assert.equal(currentRecord()?.archetype, 'heavy');
  randomiseOutfit({ face: FALLBACK_FACE, feet: BOOTS });
  assert.equal(currentRecord()?.archetype, 'heavy');
  newOutfit();
  assert.equal(currentRecord()?.archetype, 'heavy');
  store().setArchetype('medium');
  openFromUrl(buildShareUrl(SITE, { build: heavy.slots, bodyType: 'masculine', playerNumber: null, archetype: 'heavy' }));
  assert.equal(currentRecord()?.id, heavy.id, 'the same pieces and archetype select the saved outfit');
  assert.equal(store().archetype, 'heavy');
});

test('a link is exact: the same pieces on another archetype are another outfit; a link without one is Medium', async () => {
  await visit();
  openFromUrl(SITE);
  store().load(PIECES);
  store().setArchetype('light');
  const light = currentRecord()!;
  openFromUrl(buildShareUrl(SITE, look('medium')));
  assert.equal(library().current?.kind, 'draft', 'not the Light outfit');
  assert.equal(store().archetype, 'medium');
  assert.equal(library().outfits.find(r => r.id === light.id)?.archetype, 'light', 'the saved outfit is untouched');
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

test('the share Worker stores the archetype with the card and opens the builder on it', async () => {
  const e = workerEnv();
  const query = uploadQuery('2.12a', null, 'a', undefined, null, null, 'h');
  assert.equal(query, 'o=2.12a&bt=a&ar=h');
  const response = await post(e, query);
  assert.equal(response.status, 201);
  const { url } = await response.json() as { url: string };
  assert.equal(new URL(url).searchParams.get('ar'), 'h', 'the app checks this before using the link');
  const id = /\/s\/(\w{12})/.exec(url)![1];
  assert.equal((e.SHARES.entries.get(`s:${id}`)!.metadata as Record<string, string>).ar, 'h');
  const page = await (await worker.fetch(new Request(url), e)).text();
  assert.match(page, /location\.replace\("https:\/\/chronohaxx\.github\.io\/the-finals-outfit\/#\/\?o=2\.12a&bt=a&ar=h"\)/);
  const tampered = await (await worker.fetch(new Request(`${BASE}/s/${id}?o=2.12a&ar=l`), e)).text();
  assert.match(tampered, /#\/\?o=2\.12a&bt=a&ar=h"/, 'the stored archetype wins while the entry lives');
  const expired = await (await worker.fetch(new Request(`${BASE}/s/AAAAAAAAAAAA?o=2.12a&ar=l`), e)).text();
  assert.match(expired, /#\/\?o=2\.12a&ar=l"\)/, 'an expired link uses its own');
});

test('the Worker refuses a malformed archetype and keeps Medium uploads exactly as before', async () => {
  const e = workerEnv();
  for (const bad of ['%22%3E', 'ABC', 'abc', '1']) assert.equal((await post(e, `o=2.12a&ar=${bad}`)).status, 400, bad);
  assert.equal(readArchetype(new URLSearchParams('o=2.12a')), undefined);
  const plain = await (await post(e, 'o=2.12a')).json() as { url: string };
  assert.match(plain.url, /\?o=2\.12a$/);
  const id = /\/s\/(\w{12})/.exec(plain.url)![1];
  assert.deepEqual(e.SHARES.entries.get(`s:${id}`)!.metadata, { o: '2.12a' });
});
