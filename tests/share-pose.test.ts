// Poses in share links (10 Nov 2026): the grammar, links built with and without one, the preview upload's query, and
// a link's pose going to the viewer only when its outfit was opened.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import { buildShareUrl, readOutfitLink } from '../src/lib/share-url';
import { formatPoseTime, frameAt, pendingPose, poseKey, readPoseLink, takePendingPose } from '../src/lib/share-pose';
import { uploadQuery } from '../src/lib/share-preview';
import { readPose as workerReadPose } from '../workers/share-preview/src/share';
import { MemoryBackend, storageJournal } from '../src/lib/outfit-storage';
import { getItemById } from '../src/lib/catalog';
import { FALLBACK_FACE, useBuildStore } from '../src/store/useBuildStore';
import { randomiseOutfit, startSavedOutfits, stopSavedOutfits, useSavedOutfits } from '../src/store/useSavedOutfits';
import { openLink } from '../src/store/open-link';
import { manualScheduler, memoryStorage } from './helpers/saved-outfits';

const SITE = 'https://chronohaxx.github.io/the-finals-outfit/';
const outfit = { face: 'head-face-01-base', hair: 'hairs-afrofade', feet: 'casual-tallsneakers-canvas' };
const paused = { clip: 'ace-pilot', time: 37 / 30, paused: true };

beforeEach(() => { takePendingPose(); });

test('times are written to the millisecond without exponents; frames count from 0', () => {
  assert.equal(formatPoseTime(37 / 30), '1.233');
  assert.equal(formatPoseTime(0), '0');
  assert.equal(formatPoseTime(2.5), '2.5');
  assert.equal(formatPoseTime(1e-7), '0');
  assert.equal(formatPoseTime(-3), '0');
  assert.equal(formatPoseTime(Number.NaN), '0');
  assert.equal(formatPoseTime(5000), '999.999');
  assert.equal(frameAt(1.233, 1 / 30), 37);
  assert.equal(frameAt(37 / 30, 1 / 30), 37);
  assert.equal(frameAt(0, 1 / 30), 0);
});

test('a pose rides beside the outfit in both link styles and reads back; old links have none', () => {
  const short = buildShareUrl(SITE, outfit, 'short', paused);
  assert.equal(new URL(short).hash, `#/?o=${new URLSearchParams(new URL(short).hash.slice(3)).get('o')}&emote=ace-pilot&t=1.233&paused=1`);
  assert.deepEqual(readPoseLink(short), { clip: 'ace-pilot', time: 1.233, paused: true });
  assert.deepEqual(readOutfitLink(short)?.slots, outfit, 'the outfit still decodes');

  const names = buildShareUrl(SITE, outfit, 'names', { clip: 'wave', time: 0.5, paused: false });
  assert.equal(new URL(names).searchParams.get('emote'), 'wave');
  assert.equal(new URL(names).searchParams.has('paused'), false);
  assert.deepEqual(readPoseLink(names), { clip: 'wave', time: 0.5, paused: false });
  assert.deepEqual(readOutfitLink(names)?.slots, outfit);

  for (const old of [buildShareUrl(SITE, outfit), buildShareUrl(SITE, outfit, 'names'), SITE, `${SITE}#/`, `${SITE}?anim=wave&animTime=1`])
    assert.equal(readPoseLink(old), null, old);
});

test('a new share never inherits the pose of the link it was opened from', () => {
  const opened = buildShareUrl(SITE, outfit, 'names', paused); // the address bar after opening a readable posed link
  for (const style of ['short', 'names'] as const) {
    const plain = buildShareUrl(opened, outfit, style);
    assert.equal(readPoseLink(plain), null, style);
    const other = buildShareUrl(opened, outfit, style, { clip: 'bow', time: 2, paused: false });
    assert.deepEqual(readPoseLink(other), { clip: 'bow', time: 2, paused: false }, style);
    assert.equal(new URL(other).search.match(/emote=/g)?.length ?? 0, style === 'names' ? 1 : 0);
  }
});

test('malformed poses are ignored (the link opens as before); a clip alone plays from its start', () => {
  for (const bad of ['emote=%22%3E&t=1', 'emote=-x&t=1', 'emote=wave&t=abc', 'emote=wave&t=1.2345', 'emote=wave&t=-1', 't=1&paused=1'])
    assert.equal(readPoseLink(`${SITE}#/?o=2.&${bad}`), null, bad);
  assert.deepEqual(readPoseLink(`${SITE}#/?o=2.&emote=wave`), { clip: 'wave', time: 0, paused: false });
  // The hash route wins over the query when both carry one.
  assert.equal(readPoseLink(`${SITE}?emote=bow&t=1#/?o=2.&emote=wave&t=2`)?.clip, 'wave');
});

test('the preview upload carries the same pose the Worker validates', () => {
  const capture = { ...paused, label: 'Ace Pilot', frame: 37, lastFrame: 90 };
  const query = uploadQuery('2.36o.1l9', capture);
  assert.equal(query, 'o=2.36o.1l9&emote=ace-pilot&t=1.233&paused=1');
  assert.deepEqual(workerReadPose(new URLSearchParams(query)), { emote: 'ace-pilot', t: '1.233', paused: true });
  assert.equal(uploadQuery('2.36o', null), 'o=2.36o');
});

test('"changed since copied": a playing pose is its clip, a paused one its exact frame', () => {
  assert.equal(poseKey(null), '');
  assert.equal(poseKey({ clip: 'wave', time: 0.4, paused: false }), poseKey({ clip: 'wave', time: 0.9, paused: false }));
  assert.notEqual(poseKey({ clip: 'wave', time: 0.4, paused: true }), poseKey({ clip: 'wave', time: 0.9, paused: true }));
  assert.notEqual(poseKey({ clip: 'wave', time: 0.4, paused: true }), poseKey({ clip: 'wave', time: 0.4, paused: false }));
});

async function visit(options: { cap?: number; confirm?: boolean } = {}) {
  stopSavedOutfits();
  useBuildStore.getState().reset();
  let n = 0;
  await startSavedOutfits({
    library: { backend: new MemoryBackend(true), journal: storageJournal(memoryStorage()), schedule: manualScheduler().schedule,
      newId: () => `p${++n}-${Math.random().toString(36).slice(2, 6)}`, cap: options.cap },
    confirm: () => options.confirm ?? true,
  });
}

test('a link hands its pose to the viewer when its outfit opens, including one matching a saved outfit', async () => {
  await visit();
  openLink(SITE);
  assert.equal(pendingPose(), null, 'no link, no pose');
  const link = buildShareUrl(SITE, { face: FALLBACK_FACE, feet: 'actionhero-sentinelboots-leather' }, 'short', paused);
  openLink(link);
  assert.deepEqual(takePendingPose(), { clip: 'ace-pilot', time: 1.233, paused: true });
  openLink(link); // the same outfit is already on screen: the pose still applies (a link to another frame of it)
  assert.deepEqual(takePendingPose()?.clip, 'ace-pilot');
  openLink(SITE); // the address after the link is tidied away: the pose already handed over stays with the viewer
  assert.equal(pendingPose(), null);
  const poseOnly = `${SITE}#/?emote=wave&t=0.5`;
  openLink(poseOnly);
  assert.deepEqual(takePendingPose(), { clip: 'wave', time: 0.5, paused: false }, 'a pose without an outfit poses the current one');
  openLink(`${SITE}#/?o=9.zz&emote=wave&t=1`);
  assert.equal(pendingPose(), null, 'an unreadable outfit link brings no pose');
});

test('a link refused in favour of an unsaved draft brings no pose', async () => {
  await visit({ cap: 1, confirm: false });
  openLink(SITE);
  useBuildStore.getState().equip(getItemById('attachment-pumpkinhead-hat')!); // hand-made: never replaced by a roll
  randomiseOutfit({ face: FALLBACK_FACE, feet: 'actionhero-sentinelboots-leather' }); // at the cap: an unsaved draft
  useBuildStore.getState().equip(getItemById('attachment-3dpaperglasses-paper')!); // edited: leaving it asks first
  assert.equal(useSavedOutfits.getState().library!.current?.kind, 'draft');
  const result = openLink(buildShareUrl(SITE, outfit, 'short', paused));
  assert.equal(result.declined, true);
  assert.equal(pendingPose(), null);
});
