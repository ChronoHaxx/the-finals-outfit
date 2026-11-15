// Chinals mode (12 Nov 2026, src/lib/site-mode.ts): the route grammar, share links that keep today's form, the address
// tidy-up staying in the mode, and switching modes never touching the outfit, a link draft or the saved outfits.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { pendingPose, readPoseLink, takePendingPose, withoutPose } from '../src/lib/share-pose';
import {
  builderHashMode, builderHashParams, builderPath, chinalsAvailable, hashSearch, isChinalsClip, modeOfPath, roadmapPath,
} from '../src/lib/site-mode';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { FALLBACK_FACE, useBuildStore } from '../src/store/useBuildStore';
import { getItemById } from '../src/lib/catalog';
import { DEFAULT_BODY_TYPE } from '../src/lib/body-type';
import { saveDraft, startSavedOutfits, stopSavedOutfits, useSavedOutfits } from '../src/store/useSavedOutfits';
import { openLink } from '../src/store/open-link';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const outfit = { face: FALLBACK_FACE, feet: 'actionhero-sentinelboots-leather' };
const chinalsPose = { clip: 'cn-emote-applaud', time: 1.5, paused: true };

// cleanUrl rewrites the address through window.history when no router cleaner is registered (as at boot).
const address = { href: SITE };
(globalThis as { window?: unknown }).window = {
  get location() { return new URL(address.href); },
  history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { address.href = new URL(url, address.href).href; } },
};

let backend: MemoryBackend;
async function visit() {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  let n = 0;
  await startSavedOutfits({
    library: { backend, journal: storageJournal(memoryStorage()), schedule: manualScheduler().schedule,
      newId: () => `o${++n}-${Math.random().toString(36).slice(2, 6)}` },
    confirm: () => true,
  });
}
const open = (href: string) => { address.href = href; return openLink(href); };
const library = () => useSavedOutfits.getState().library!;
const look = () => ({ build: useBuildStore.getState().build, bodyType: useBuildStore.getState().bodyType });

beforeEach(() => { backend = new MemoryBackend(); takePendingPose(); address.href = SITE; });

test('the mode is a route: exactly #/ and #/chinals are builder routes, with their own query', () => {
  assert.equal(modeOfPath('/'), 'global');
  assert.equal(modeOfPath('/chinals'), 'chinals');
  assert.equal(modeOfPath('/chinals/roadmap'), 'chinals');
  assert.equal(modeOfPath('/chinalsx'), 'global');
  assert.deepEqual([builderPath('chinals'), roadmapPath('chinals'), builderPath('global'), roadmapPath('global')],
    ['/chinals', '/chinals/roadmap', '/', '/roadmap']);
  for (const [hash, mode] of [['', 'global'], ['#', 'global'], ['#/', 'global'], ['#/?o=2.1', 'global'],
    ['#/chinals', 'chinals'], ['#/chinals/', 'chinals'], ['#/chinals?o=2.1', 'chinals'], ['#/chinals/?o=2.1', 'chinals'],
    ['#/roadmap?o=2.1', null], ['#/chinals/roadmap?o=2.1', null], ['#/o/abc', null]] as const)
    assert.equal(builderHashMode(hash), mode, hash);
  assert.equal(builderHashParams('#/chinals?o=2.1&emote=cn-x')?.get('emote'), 'cn-x');
  assert.equal(builderHashParams('#/roadmap?o=2.1'), null, 'a roadmap address is never read as a link');
  assert.equal(builderHashParams('#/chinals'), null);
  assert.equal(hashSearch('#/chinals?o=2.1'), '?o=2.1');
  assert.equal(hashSearch('#/'), '');
  assert.equal(chinalsAvailable(), false, 'off without VITE_CHINALS_ANIMATIONS_BASE');
  assert.ok(isChinalsClip('cn-emote-applaud') && !isChinalsClip('ace-pilot'));
});

test('share links keep their one form; a Chinals pose rides in it, and #/chinals addresses read the same', () => {
  const link = buildShareUrl(SITE, { build: outfit, bodyType: DEFAULT_BODY_TYPE }, 'short', chinalsPose);
  assert.match(link, /#\/\?o=2\.[0-9a-z.]+&emote=cn-emote-applaud&t=1\.5&paused=1$/, 'the global route, as the share Worker writes it');
  const onChinals = link.replace('#/?', '#/chinals?');
  assert.deepEqual(readOutfitLink(onChinals), readOutfitLink(link));
  assert.deepEqual(readPoseLink(onChinals), chinalsPose);
  assert.deepEqual(readPoseLink(link), chinalsPose);
  assert.equal(readOutfitLink(link.replace('#/?', '#/roadmap?')), null, 'the roadmap carries ?o= without opening it');
  assert.equal(readOutfitLink(link.replace('#/?', '#/chinals/roadmap?')), null);
  assert.equal(readPoseLink(link.replace('#/?', '#/chinals/roadmap?')), null);
});

test('a body type rides in a Chinals link and reads back on the Chinals route; the switch keeps it', () => {
  const link = buildShareUrl(SITE, { build: outfit, bodyType: 'androgynous' }, 'short', chinalsPose);
  assert.match(link, /&bt=/);
  assert.equal(readOutfitLink(link.replace('#/?', '#/chinals?'))?.bodyType, 'androgynous');
  assert.match(withoutPose(hashSearch(new URL(link).hash)), /&bt=|\?bt=/, 'the switch drops the pose, not the body type');
});

test('the switch keeps an unsaved link draft in the address and drops the pose', () => {
  assert.equal(withoutPose('?o=2.36o&emote=cn-emote-applaud&t=1.5&paused=1'), '?o=2.36o');
  assert.equal(withoutPose('?emote=ace-pilot&t=0'), '');
  assert.equal(withoutPose(''), '');
});

test('a link opened in Chinals mode is tidied away without leaving the mode', async () => {
  await visit();
  open(SITE);
  useBuildStore.getState().equip(getItemById('attachment-pumpkinhead-hat')!); // hand-made: saved into "Outfit 1"
  const own = buildShareUrl(SITE, look(), 'short', chinalsPose).replace('#/?', '#/chinals?');
  open(own); // the sharer's own outfit: it matches the saved one, which is selected, and the link leaves the address
  assert.equal(address.href, `${SITE}#/chinals`, 'still on the Chinals route');
  assert.deepEqual(takePendingPose(), chinalsPose, 'the pose was read before the tidy-up');
  const global = buildShareUrl(SITE, look(), 'short');
  open(global);
  assert.equal(address.href, `${SITE}#/`, 'a global link tidies to the global route, as before');
});

test('switching modes never changes the outfit, a link draft or the saved outfits', async () => {
  await visit();
  open(SITE);
  useBuildStore.getState().equip(getItemById('attachment-pumpkinhead-hat')!);
  const saved = library().outfits.map(o => o.id);
  const link = buildShareUrl(SITE, { build: outfit, bodyType: DEFAULT_BODY_TYPE }, 'short', chinalsPose);
  open(link);
  assert.equal(library().current?.kind, 'draft', 'a shared outfit opens as an unsaved draft');
  const draftBuild = { ...useBuildStore.getState().build };
  takePendingPose();
  // The switch: the same address on the other route, without the pose (ModeSwitch in ProjectLinks.tsx).
  for (const route of ['#/chinals', '#/', '#/chinals']) {
    const switched = `${SITE}${route}${withoutPose(hashSearch(new URL(address.href).hash))}`;
    const result = open(switched);
    assert.equal(result.error, false);
    assert.deepEqual(useBuildStore.getState().build, draftBuild, `outfit unchanged on ${route}`);
    assert.equal(library().current?.kind, 'draft', `the draft is still current on ${route}`);
    assert.equal(pendingPose(), null, 'no pose comes back');
  }
  assert.deepEqual(library().outfits.map(o => o.id), saved, 'saved outfits untouched');
  // A reload on the Chinals route still opens the draft from the address it kept.
  const reload = address.href;
  assert.match(reload, /#\/chinals\?o=2\./);
  await visit();
  open(reload);
  assert.deepEqual(useBuildStore.getState().build, draftBuild);
  saveDraft();
  assert.equal(library().current?.kind, 'record');
});
