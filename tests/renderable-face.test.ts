// An icon-only face must not leave a headless body (6 Nov 2026). The viewer renders the default face in its place, at
// render time only; the build, and so share links and the outfit panel, keep the user's choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/load-catalog';
import { getItemById } from '../src/lib/catalog';
import { FALLBACK_FACE, useBuildStore, withRenderableFace, type Build } from '../src/store/useBuildStore';

const store = () => useBuildStore.getState();

test('an icon-only face renders the default face; the build keeps the choice', () => {
  store().reset();
  const eternel = getItemById('head-blankface-absorbeglitter');
  assert.ok(eternel, 'Face of Éternel is in the catalogue');
  assert.equal(eternel.slot, 'face');
  store().equip(eternel);
  const build = store().build;
  assert.equal(build.face, 'head-blankface-absorbeglitter');
  const rendered = withRenderableFace(build, () => false);
  assert.equal(rendered.face, FALLBACK_FACE);
  assert.equal(store().build.face, 'head-blankface-absorbeglitter', 'the stored build is unchanged');
  for (const slot of Object.keys(build) as (keyof Build)[])
    if (slot !== 'face') assert.equal(rendered[slot], build[slot], `${slot} untouched`);
});

test('a renderable face, an empty face slot and the default face pass through unchanged', () => {
  store().reset();
  const build = store().build;
  assert.equal(build.face, FALLBACK_FACE, 'the default build wears the fallback face');
  assert.equal(withRenderableFace(build, () => false), build, 'the default face is never substituted');
  const galaxy = { ...build, face: 'head-blankface-galaxy' };
  assert.equal(withRenderableFace(galaxy, id => id === 'head-blankface-galaxy'), galaxy);
  const bare = { ...build, face: null };
  assert.equal(withRenderableFace(bare, () => false), bare, 'an empty face slot stays empty');
});

test('the fallback face exists and has a legacy model', () => {
  assert.ok(getItemById(FALLBACK_FACE)?.model, 'head-face-01-base renders without source data');
});
