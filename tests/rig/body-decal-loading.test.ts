import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BodyDecalManager, type RigDecalLayer } from '../../src/rig/BodyDecals';

// Equipping a decal is awaited by the viewer, and the rig reports idle once that await returns. If
// set() resolves while its textures are still in flight, the caller is told the body is dressed
// before the GPU has anything to draw: on a cold page a 1.5s texture left the rig idle after 296ms
// with the paint request unreleased, and the first captured frame was bare skin.
//
// These tests drive the loader by hand instead of waiting on real timing, so "not finished yet" is
// asserted rather than raced. Nothing here sleeps.

const PAINT: RigDecalLayer = { target: 'body', colorUrl: 'paint_c.webp', uv: 1, uvScale: [0.5, 1], uvLayout: 'sourceBodyPaint', colorOverride: 1 };
const TATTOO: RigDecalLayer = { target: 'body', colorUrl: 'tattoo_c.webp' };

/** A TextureLoader whose every request stays open until the test releases it by url. */
function deferredLoader() {
  const open: { url: string; texture: THREE.Texture; onLoad: (t: THREE.Texture) => void; onError: (e: unknown) => void }[] = [];
  const disposed = new Set<THREE.Texture>();
  const requests: string[] = []; // every request ever issued, settled or not
  const loader = {
    load: (url: string, onLoad: (t: THREE.Texture) => void, _onProgress?: unknown, onError?: (e: unknown) => void) => {
      const texture = new THREE.Texture();
      texture.addEventListener('dispose', () => disposed.add(texture));
      requests.push(url);
      open.push({ url, texture, onLoad, onError: onError ?? (() => {}) });
      return texture;
    },
  } as unknown as THREE.TextureLoader;
  // The index-th still-open request for a url, in request order (0 = oldest). A url can legitimately
  // be requested more than once across a clearAll(), so the two must be settleable apart.
  const take = (url: string, index = 0) => {
    const r = open.filter(o => o.url === url)[index];
    assert.ok(r, `no open request ${index} for ${url} (open: ${open.map(o => o.url).join(', ') || 'none'})`);
    open.splice(open.indexOf(r), 1);
    return r;
  };
  return {
    loader, open, disposed, requests,
    requested: (url: string) => open.some(r => r.url === url),
    release: (url: string) => { const r = take(url); r.onLoad(r.texture); return r.texture; },
    releaseAt: (url: string, index: number) => { const r = take(url, index); r.onLoad(r.texture); return r.texture; },
    fail: (url: string) => { const r = take(url); r.onError(new Error(`404 ${url}`)); return r.texture; },
    failAt: (url: string, index: number) => { const r = take(url, index); r.onError(new Error(`404 ${url}`)); return r.texture; },
  };
}

function harness() {
  const io = deferredLoader();
  const decals = new BodyDecalManager(io.loader, 'nailmask.webp');
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  decals.registerTarget('body', [material]);
  return { ...io, decals, material, patched: () => material.userData.decalPatched === true, key: () => material.customProgramCacheKey() };
}

/** Let every already-resolvable promise run, without advancing any timer. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/** The shader three would compile for the material right now, so sampler bindings are asserted
 *  from the installed material state rather than from a private cache field. */
function installedShader(mat: THREE.MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n\t#include <map_fragment>\n}',
  };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

test('an awaited equip does not resolve until its textures have loaded', async () => {
  const h = harness();
  let resolved = false;
  const equip = h.decals.set('bodyPaint', { layers: [PAINT] }).then(() => { resolved = true; });
  await settle();
  assert.equal(resolved, false, 'set() resolved before its texture loaded');
  assert.equal(h.patched(), false, 'the material was patched with an unloaded texture');
  assert.ok(h.requested('paint_c.webp'), 'the texture was never requested');

  h.release('paint_c.webp');
  await equip;
  assert.equal(resolved, true);
  assert.equal(h.patched(), true);
  assert.match(h.key(), /bodycu1s0\.5x1po1/);
});

test('every layer of a decal is awaited, not just the first', async () => {
  const h = harness();
  let resolved = false;
  const equip = h.decals.set('bodyPaint', { layers: [PAINT, TATTOO] }).then(() => { resolved = true; });
  await settle();
  h.release('paint_c.webp');
  await settle();
  assert.equal(resolved, false, 'set() resolved with a second layer still loading');
  h.release('tattoo_c.webp');
  await equip;
  assert.match(h.key(), /bodyc.*-bodyc/, 'both layers should composite');
});

test('a superseded load never repaints over its replacement', async () => {
  const h = harness();
  const first = h.decals.set('bodyPaint', { layers: [PAINT] });
  await settle();
  const second = h.decals.set('bodyPaint', { layers: [TATTOO] });
  await settle();

  // The replacement lands first; the obsolete load arrives afterwards and must be inert.
  h.release('tattoo_c.webp');
  await second;
  const afterReplacement = h.key();
  const stale = h.release('paint_c.webp');
  await first;

  assert.equal(h.key(), afterReplacement, 'a stale load repainted over the replacement');
  assert.doesNotMatch(h.key(), /u1s0\.5x1p/, 'the superseded paint is still installed');
  assert.ok(h.disposed.has(stale), 'the superseded texture leaked');
});

test('clearing a slot while it loads leaves it cleared', async () => {
  const h = harness();
  const equip = h.decals.set('bodyPaint', { layers: [PAINT] });
  await settle();
  h.decals.clear('bodyPaint');
  const stale = h.release('paint_c.webp');
  await equip;

  assert.equal(h.patched(), false, 'a cleared slot was repainted by its own late load');
  assert.ok(h.disposed.has(stale), 'the cancelled texture leaked');
});

test('clearAll while a load is in flight does not resurrect the decal', async () => {
  const h = harness();
  const equip = h.decals.set('bodyPaint', { layers: [PAINT] });
  await settle();
  h.decals.clearAll();
  const stale = h.release('paint_c.webp');
  await equip;

  assert.equal(h.patched(), false, 'a disposed manager was repainted by a late load');
  assert.ok(h.disposed.has(stale), 'the cancelled texture leaked');
});

test('a texture that fails skips its own layer and still finishes the equip', async () => {
  const h = harness();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };
  try {
    const equip = h.decals.set('bodyPaint', { layers: [PAINT, TATTOO] });
    await settle();
    h.fail('paint_c.webp');
    const kept = h.release('tattoo_c.webp');
    await equip; // must not hang on the failure
    assert.equal(h.patched(), true, 'the surviving layer should still composite');
    assert.doesNotMatch(h.key(), /u1s0\.5x1p/, 'the failed layer must not be installed');
    assert.equal(h.disposed.has(kept), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /failed to load 'paint_c\.webp'/);
});

test('a nail polish waits for the shared nail mask', async () => {
  const h = harness();
  let resolved = false;
  const equip = h.decals.set('nailPolish', { layers: [{ target: 'nails', tint: '#ff0044' }] }).then(() => { resolved = true; });
  await settle();
  assert.equal(resolved, false, 'set() resolved before the shared nail mask loaded');
  assert.equal(h.patched(), false, 'an unmasked nail tint would recolour the whole body');

  h.release('nailmask.webp');
  await equip;
  assert.equal(h.patched(), true);
  assert.match(h.key(), /nailsmt/, 'the nail layer should carry the shared mask');
});

const NAIL_POLISH: RigDecalLayer = { target: 'nails', tint: '#ff0044' };

test('a failed nail mask contributes no tint and does not hang the equip', async () => {
  const h = harness();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
    await settle();
    h.fail('nailmask.webp');
    await failed; // a 404 must resolve the equip, not hang it

    // The failed mask drops the nail layer, so no tint and no sampler reach the material.
    const bare = installedShader(h.material);
    assert.equal(bare.uniforms.uDecalT0, undefined, 'an unmasked nail tint was installed');
    assert.equal(bare.uniforms.uDecalM0, undefined, 'a mask sampler was installed without a mask');
    assert.doesNotMatch(bare.fragmentShader, /uDecalT0/, 'the failed equip left nail tint code compiled');
    assert.equal(h.patched(), false, 'a failed mask left the material in a patched state');
    // The failure itself must not retry: no loop, no timer, one request.
    assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 1, 'the failed equip repeated its own request');
  } finally {
    console.warn = warn;
  }
});

test('a later equip retries the shared mask after a transient failure', async () => {
  const h = harness();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
    await settle();
    h.fail('nailmask.webp');
    await failed;
  } finally {
    console.warn = warn;
  }

  // The retry is the later explicit equip, and it must issue a fresh request rather than reuse the
  // resolved-null pending promise that stranded every polish after this failure.
  const recovered = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  assert.ok(h.requested('nailmask.webp'), 'the re-equip reused the resolved-null mask promise');
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 2);
  const mask = h.release('nailmask.webp');
  await recovered;
  const shader = installedShader(h.material);
  assert.equal(shader.uniforms.uDecalM0?.value, mask, 'the installed sampler is not the reloaded mask');
  assert.ok(shader.uniforms.uDecalT0, 'the recovered polish should composite its tint');
  assert.equal(h.patched(), true);
});

test('concurrent nail equips share one mask request and reuse the cached mask', async () => {
  const h = harness();
  const first = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  const second = h.decals.set('nailPolish', { layers: [{ target: 'nails', tint: '#00ff88' }] });
  await settle();
  const inFlight = h.open.filter(r => r.url === 'nailmask.webp');
  assert.equal(inFlight.length, 1, `the shared mask was requested ${inFlight.length} times`);
  const mask = h.release('nailmask.webp');
  await Promise.all([first, second]);
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 1, 'the second equip did not share the request');

  // Success is cached: another equip neither re-requests nor rebinds a different texture.
  const third = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 1, 'the cached mask was requested again');
  await third;
  assert.equal(installedShader(h.material).uniforms.uDecalM0?.value, mask, 'the cached mask is not the installed sampler');
});

test('a stale mask success after clearAll cannot overwrite the newer mask', async () => {
  const h = harness();
  const oldEquip = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  h.decals.clearAll(); // drops the old pending work and the registered target
  h.decals.registerTarget('body', [h.material]);

  const newEquip = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 2, 'the new equip did not issue a fresh request');

  const fresh = h.releaseAt('nailmask.webp', 1); // the newer request settles first
  await newEquip;
  assert.equal(installedShader(h.material).uniforms.uDecalM0?.value, fresh);

  // The old request now succeeds, after everything it belonged to is gone.
  const stale = h.releaseAt('nailmask.webp', 0);
  await oldEquip;
  const after = installedShader(h.material);
  assert.equal(after.uniforms.uDecalM0?.value, fresh, 'the stale mask replaced the newer sampler');
  assert.ok(h.disposed.has(stale), 'the superseded mask texture leaked');
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 2, 'the stale settle issued another request');

  // The stale result must not clear the newer cached mask either.
  const recheck = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 2, 'the stale settle dropped the cached mask');
  await recheck;
  assert.equal(installedShader(h.material).uniforms.uDecalM0?.value, fresh);
});

test('a stale mask failure after clearAll leaves the newer in-flight request alone', async () => {
  const h = harness();
  const oldEquip = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  h.decals.clearAll();
  h.decals.registerTarget('body', [h.material]);
  const newEquip = h.decals.set('nailPolish', { layers: [NAIL_POLISH] });
  await settle();
  assert.equal(h.open.filter(r => r.url === 'nailmask.webp').length, 2);

  const warn = console.warn;
  console.warn = () => {};
  try {
    h.failAt('nailmask.webp', 0); // the stale request fails while the newer one is still loading
    await oldEquip;
  } finally {
    console.warn = warn;
  }

  assert.ok(h.requested('nailmask.webp'), 'the stale failure cancelled the newer request');
  assert.equal(h.requests.filter(u => u === 'nailmask.webp').length, 2, 'the stale failure started another request');
  const fresh = h.release('nailmask.webp');
  await newEquip;
  assert.equal(installedShader(h.material).uniforms.uDecalM0?.value, fresh);
});
