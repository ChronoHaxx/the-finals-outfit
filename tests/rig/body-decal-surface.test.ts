import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BodyDecalManager, type RigDecalLayer } from '../../src/rig/BodyDecals';

// Optional packed surface data for source body paints: a linear RGBA texture whose B channel is
// roughness and whose A channel is metalness (RG are normals, reserved). The compositor weights it
// by the colour layer's own coverage — the traced bounds gate times the colour texture's alpha —
// and never by the packed alpha. Because this path emits GLSL, these tests read the generated
// shader (against the real ShaderLib.physical template), the installed uniforms and the owned
// texture lifecycle instead of inferring any of it from a render.

const PAINT: RigDecalLayer = {
  target: 'body',
  colorUrl: 'models/reconstructed-body-paints-v1/paint_c.webp',
  uv: 1,
  uvScale: [0.5, 1],
  uvLayout: 'sourceBodyPaint',
  colorOverride: 1,
};
const SURFACE_URL = 'models/reconstructed-body-paints-v1/paint_ba.webp';
const SURFACE_PAINT: RigDecalLayer = { ...PAINT, surfaceUrl: SURFACE_URL, surfaceOverride: 1 };
const TATTOO: RigDecalLayer = { target: 'body', colorUrl: 'tattoo_c.webp' };

/** The shader MeshStandardMaterial actually compiles from, not a one-line stub: the insertions have
 *  to land in the real chunk layout, next to the real roughness/metalness declarations. */
function physicalShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
}

/** three's own include resolution, so ordering can be asserted against real declarations. */
function resolveIncludes(src: string): string {
  const chunks = THREE.ShaderChunk as Record<string, string>;
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_match, name: string) => chunks[name] ?? '');
}

/** Loads immediately; lifecycle is covered by the deferred harness below. */
function immediateLoader() {
  const requests: string[] = [];
  const loader = {
    load: (url: string, onLoad: (t: THREE.Texture) => void) => {
      requests.push(url);
      const tex = new THREE.Texture();
      onLoad(tex);
      return tex;
    },
  } as unknown as THREE.TextureLoader;
  return { loader, requests };
}

function harness(opts: { reconstructed?: boolean } = {}) {
  const { loader, requests } = immediateLoader();
  const decals = new BodyDecalManager(loader, 'models/decals/_shared/nailmask.webp');
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  let baseCalls = 0;
  const baseCompile: THREE.Material['onBeforeCompile'] = (shader, renderer) => {
    baseCalls++;
    originalCompile.call(material, shader, renderer);
    // The reconstructed skin surface the real rig installs before the decal compositor: the map
    // chunk becomes a ReconstructedSurface named `recovered` with a readiness marker, and the
    // roughness/metalness chunks become plain reads of that surface.
    if (opts.reconstructed) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          'ReconstructedSurface recovered = ReconstructedSurface( vec3( 1.0 ), 0.5, 0.0 );\n// recovered_surface_ready',
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = recovered.roughness;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = recovered.metalness;');
    }
  };
  material.onBeforeCompile = baseCompile;
  if (opts.reconstructed) material.userData.reconstructed = true;
  decals.registerTarget('body', [material]);
  decals.registerTarget('head', [material]);
  const compile = (shader = physicalShader()) => {
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader;
  };
  return {
    decals,
    material,
    requests,
    compile,
    baseCalls: () => baseCalls,
    baseCompile,
    originalKey,
    patched: () => material.userData.decalPatched === true,
    key: () => material.customProgramCacheKey(),
  };
}

// ---------------------------------------------------------------------------------------------
// Generated shader integration
// ---------------------------------------------------------------------------------------------

test('ordinary material: packed B/A compose after the standard factors exist', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  const { fragmentShader, uniforms } = h.compile();

  // The anchor is the standard metalness chunk: roughnessFactor and metalnessFactor are both
  // declared by then, and three only reads them later (lights_physical_fragment).
  const iRough = fragmentShader.indexOf('#include <roughnessmap_fragment>');
  const iMetal = fragmentShader.indexOf('#include <metalnessmap_fragment>');
  const iSurface = fragmentShader.indexOf('roughnessFactor = clamp( mix( roughnessFactor, sp.b');
  assert.ok(iRough >= 0, 'the stock roughness chunk disappeared');
  assert.ok(iMetal > iRough, 'the stock metalness chunk disappeared');
  assert.ok(iSurface > iMetal, 'the pack was composited before metalnessFactor exists');

  assert.match(fragmentShader, /float decalSurfCoverage0 = 0\.0;/);
  assert.match(fragmentShader, /decalSurfCoverage0 = dc\.a \* ins;/);
  assert.match(fragmentShader,
    /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  assert.match(fragmentShader,
    /metalnessFactor = clamp\( mix\( metalnessFactor, sp\.a, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  assert.ok(uniforms.uDecalS0?.value instanceof THREE.Texture, 'no packed sampler was bound');

  // Resolved against the real chunks: both base factors are declared before the assignment, and
  // the base terms are the material's own factors rather than an assumed zero.
  const resolved = resolveIncludes(fragmentShader);
  assert.ok(resolved.indexOf('float roughnessFactor = roughness;') < resolved.indexOf('roughnessFactor = clamp('));
  assert.ok(resolved.indexOf('float metalnessFactor = metalness;') < resolved.indexOf('metalnessFactor = clamp('));
});

test('ordinary material: pack reuses the colour coordinates, bounds gate and alpha, never packed alpha', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [{ ...SURFACE_PAINT, maskUrl: 'paint_m.webp' }] });
  const { fragmentShader } = h.compile();

  // Both fetches derive one duv from the same uvOf contract and share the colour block's gate.
  const duvs = [...fragmentShader.matchAll(/vec2 duv = ([^;]+);/g)].map((m) => m[1]);
  assert.equal(duvs.length, 2, 'colour and packed samples should each derive their duv');
  assert.equal(duvs[0], duvs[1], 'the pack sampled different coordinates than the colour layer');
  assert.equal(duvs[0], 'vec2( vDecalUv1.x * 0.500000, fract( vDecalUv1.y ) )');
  assert.match(fragmentShader, /float ins = ceil\( clamp\( duv\.x \* \( 1\.0 - duv\.x \), 0\.0, 1\.0 \) \* clamp\( duv\.y \* \( 1\.0 - duv\.y \), 0\.0, 1\.0 \) \);/);
  assert.match(fragmentShader, /decalSurfCoverage0 = dc\.a \* ins;/);

  // B is roughness, A is metalness; RG (normals) are reserved and must never be read, and the
  // packed alpha is never a coverage weight.
  const packedChannels = [...fragmentShader.matchAll(/\bsp\.(\w)/g)].map((m) => m[1]);
  assert.deepEqual(packedChannels, ['b', 'a']);
  assert.doesNotMatch(fragmentShader, /decalSurfCoverage0\s*=\s*sp\./);
});

test('a UV0 source transform routes the pack through vMapUv exactly like the colour layer', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [{ ...SURFACE_PAINT, uv: 0 }] });
  const { fragmentShader } = h.compile();

  const duvs = [...fragmentShader.matchAll(/vec2 duv = ([^;]+);/g)].map((m) => m[1]);
  assert.equal(duvs.length, 2);
  assert.equal(duvs[0], 'vec2( vMapUv.x * 0.500000, fract( vMapUv.y ) )');
  assert.equal(duvs[0], duvs[1]);
  assert.match(fragmentShader, /decalSurfCoverage0 = dc\.a \* ins;/);
});

test('surface weight ignores colourOverride and the neutral-mask heuristic', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [{ ...SURFACE_PAINT, colorOverride: 0, maskUrl: 'paint_m.webp' }] });
  const { fragmentShader } = h.compile();

  const iCoverage = fragmentShader.indexOf('decalSurfCoverage0 = dc.a * ins;');
  const iOverride = fragmentShader.indexOf('a *= 0.000000;');
  const iMask = fragmentShader.indexOf('a *= clamp( texture2D( uDecalM0, duv ).r * 2.0, 0.0, 1.0 );');
  assert.ok(iCoverage >= 0, 'no surface coverage was captured');
  assert.ok(iOverride > iCoverage, 'the override weight leaked into the surface coverage');
  assert.ok(iMask > iCoverage, 'the mask heuristic leaked into the surface coverage');
  assert.match(fragmentShader,
    /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  // The pack still compiles into the program it belongs to: colour + mask + pack are all distinct.
  assert.match(h.key(), /bodycmb/);
});

test('an ineligible or disabled pack keeps the colour-only program and issues no request', async () => {
  const cases: [string, RigDecalLayer][] = [
    ['no pack URL', PAINT],
    ['URL without the switch', { ...SURFACE_PAINT, surfaceOverride: undefined }],
    ['switch off', { ...SURFACE_PAINT, surfaceOverride: 0 }],
    ['not a body layer', { ...SURFACE_PAINT, target: 'head' }],
    ['nails ride the body material but are not the body target', { ...SURFACE_PAINT, target: 'nails' }],
    ['no colour coverage', { ...SURFACE_PAINT, colorUrl: undefined }],
    ['no source layout', { ...SURFACE_PAINT, uvLayout: undefined }],
    ['no source transform', { ...SURFACE_PAINT, uvScale: undefined }],
  ];
  for (const [name, layer] of cases) {
    const h = harness();
    await h.decals.set('bodyPaint', { layers: [layer] });
    const { fragmentShader, uniforms } = h.compile();
    assert.equal(h.requests.includes(SURFACE_URL), false, `${name}: the pack was requested`);
    assert.equal(uniforms.uDecalS0, undefined, `${name}: a pack sampler was installed`);
    assert.doesNotMatch(fragmentShader, /decalSurfCoverage|uDecalS0/, `${name}: pack GLSL was emitted`);
    assert.doesNotMatch(h.key(), /bodycb/, `${name}: the pack entered the program identity`);
    if (layer.colorUrl) assert.match(fragmentShader, /uDecalC0/, `${name}: the colour layer must still composite`);
  }
});

test('a pack on a later resolved layer binds its own indexed sampler and weight', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [PAINT, SURFACE_PAINT] });
  const { fragmentShader, uniforms } = h.compile();

  assert.ok(uniforms.uDecalC0 && uniforms.uDecalC1, 'both colour layers should composite');
  assert.equal(uniforms.uDecalS0, undefined, 'layer 0 has no pack, so it must not bind a sampler');
  assert.ok(uniforms.uDecalS1, 'the second layer should bind the pack sampler');
  assert.match(fragmentShader, /decalSurfCoverage1 = dc\.a \* ins;/);
  assert.match(fragmentShader, /mix\( roughnessFactor, sp\.b, decalSurfCoverage1 \)/);
  assert.match(fragmentShader, /mix\( metalnessFactor, sp\.a, decalSurfCoverage1 \)/);
  assert.doesNotMatch(fragmentShader, /decalSurfCoverage0/);
});

test('reconstructed material: the pack composes after the recovered factors, base callback intact', async () => {
  const h = harness({ reconstructed: true });
  await h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  const { fragmentShader, vertexShader, uniforms } = h.compile();

  assert.equal(h.baseCalls(), 1, 'the base compile callback was replaced or skipped');
  assert.match(fragmentShader, /\/\/ recovered_surface_ready/);
  assert.doesNotMatch(fragmentShader, /#include <metalnessmap_fragment>/, 'the reconstructed chunks were not replaced');
  const iRecovered = fragmentShader.indexOf('// recovered_surface_ready');
  const iCoverage = fragmentShader.indexOf('float decalSurfCoverage0 = 0.0;');
  const iRough = fragmentShader.indexOf('float roughnessFactor = recovered.roughness;');
  const iMetal = fragmentShader.indexOf('float metalnessFactor = recovered.metalness;');
  const iSurface = fragmentShader.indexOf('roughnessFactor = clamp( mix( roughnessFactor, sp.b, decalSurfCoverage0 ), 0.0, 1.0 );');
  assert.ok(iRough >= 0 && iMetal > iRough, 'the recovered factors are missing or misordered');
  assert.ok(iCoverage > iRecovered, 'the surface weight must be declared where diffuseColor/recovered exist');
  assert.ok(iSurface > iMetal, 'the pack was composited before metalnessFactor exists');
  assert.match(fragmentShader,
    /metalnessFactor = clamp\( mix\( metalnessFactor, sp\.a, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  assert.ok(uniforms.uDecalS0, 'no packed sampler was bound');
  // Colour/UV logic and the source-skinning vertex injection are untouched.
  assert.match(fragmentShader, /diffuseColor\.rgb = mix\( diffuseColor\.rgb, dc\.rgb, a \);/);
  assert.match(vertexShader, /vDecalUv1 = uv1;/);
});

// ---------------------------------------------------------------------------------------------
// Loaded uniforms and texture lifecycle
// ---------------------------------------------------------------------------------------------

/** A TextureLoader whose requests stay open until released by url, with dispose tracking. */
function deferredLoader() {
  const open: { url: string; texture: THREE.Texture; onLoad: (t: THREE.Texture) => void; onError: (e: unknown) => void }[] = [];
  const disposed = new Set<THREE.Texture>();
  const requests: string[] = [];
  const loader = {
    load: (url: string, onLoad: (t: THREE.Texture) => void, _onProgress?: unknown, onError?: (e: unknown) => void) => {
      const texture = new THREE.Texture();
      texture.addEventListener('dispose', () => disposed.add(texture));
      requests.push(url);
      open.push({ url, texture, onLoad, onError: onError ?? (() => {}) });
      return texture;
    },
  } as unknown as THREE.TextureLoader;
  const take = (url: string, index = 0) => {
    const r = open.filter((o) => o.url === url)[index];
    assert.ok(r, `no open request ${index} for ${url} (open: ${open.map((o) => o.url).join(', ') || 'none'})`);
    open.splice(open.indexOf(r), 1);
    return r;
  };
  return {
    loader, open, disposed, requests,
    requested: (url: string) => open.some((r) => r.url === url),
    release: (url: string) => { const r = take(url); r.onLoad(r.texture); return r.texture; },
    fail: (url: string) => { const r = take(url); r.onError(new Error(`404 ${url}`)); return r.texture; },
  };
}

/** Let every already-resolvable promise run, without advancing any timer. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function lifeHarness() {
  const io = deferredLoader();
  const decals = new BodyDecalManager(io.loader, 'models/decals/_shared/nailmask.webp');
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  const baseCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  decals.registerTarget('body', [material]);
  const shader = () => {
    const s = physicalShader();
    material.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return s;
  };
  return {
    ...io,
    decals,
    material,
    shader,
    baseCompile,
    originalKey,
    patched: () => material.userData.decalPatched === true,
    key: () => material.customProgramCacheKey(),
  };
}

test('an equip awaits the packed texture and binds it linear', async () => {
  const h = lifeHarness();
  let resolved = false;
  const equip = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] }).then(() => { resolved = true; });
  await settle();
  assert.equal(resolved, false, 'set() resolved before the colour texture loaded');

  const color = h.release(PAINT.colorUrl!);
  await settle();
  assert.equal(resolved, false, 'set() resolved without the packed texture');
  assert.ok(h.requested(SURFACE_URL), 'the packed texture was never requested');

  const surface = h.release(SURFACE_URL);
  await equip;
  assert.equal(resolved, true);
  // Linear data, glTF UV convention, and owned by the decal manager.
  assert.equal(surface.colorSpace, THREE.NoColorSpace);
  assert.equal(surface.flipY, false);

  const installed = h.shader();
  assert.equal(installed.uniforms.uDecalC0?.value, color);
  assert.equal(installed.uniforms.uDecalS0?.value, surface);
  assert.match(h.key(), /bodycb/);
});

test('a failed packed texture leaves the colour layer usable on the base finish', async () => {
  const h = lifeHarness();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };
  try {
    const equip = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
    await settle();
    const color = h.release(PAINT.colorUrl!);
    await settle();
    h.fail(SURFACE_URL);
    await equip; // a 404 on an optional pack must not hang or drop the colour layer

    const installed = h.shader();
    assert.equal(installed.uniforms.uDecalC0?.value, color);
    assert.equal(installed.uniforms.uDecalS0, undefined);
    assert.doesNotMatch(installed.fragmentShader, /decalSurfCoverage|uDecalS0/);
    assert.equal(h.patched(), true);
    assert.doesNotMatch(h.key(), /bodycb/);
    assert.equal(h.requests.filter((u) => u === SURFACE_URL).length, 1, 'a failed pack retried itself');
    assert.match(warnings.join('\n'), /failed to load '.*paint_ba\.webp'/);
  } finally {
    console.warn = warn;
  }
});

test('replacing a surface layer disposes its pack and drops its program', async () => {
  const h = lifeHarness();
  const first = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  await settle();
  const color = h.release(PAINT.colorUrl!);
  await settle();
  const surface = h.release(SURFACE_URL);
  await first;
  assert.equal(h.shader().uniforms.uDecalS0?.value, surface);

  const second = h.decals.set('bodyPaint', { layers: [TATTOO] });
  await settle();
  const tattoo = h.release('tattoo_c.webp');
  await second;

  assert.ok(h.disposed.has(surface), 'the replaced pack leaked');
  assert.ok(h.disposed.has(color), 'the replaced colour texture leaked');
  const installed = h.shader();
  assert.equal(installed.uniforms.uDecalS0, undefined, 'a stale pack sampler survived the replacement');
  assert.equal(installed.uniforms.uDecalC0?.value, tattoo);
  assert.doesNotMatch(h.key(), /bodycb/);
});

test('a superseded packed load is disposed and never installed', async () => {
  const h = lifeHarness();
  const first = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  await settle();
  const staleColor = h.release(PAINT.colorUrl!);
  await settle();
  assert.ok(h.requested(SURFACE_URL), 'the first load never requested its pack');

  const second = h.decals.set('bodyPaint', { layers: [TATTOO] });
  await settle();
  const tattoo = h.release('tattoo_c.webp');
  await second;
  const afterReplacement = h.key();

  const staleSurface = h.release(SURFACE_URL); // the obsolete load lands after its replacement
  await first;

  assert.equal(h.key(), afterReplacement, 'a stale load repainted over the replacement');
  assert.ok(h.disposed.has(staleSurface), 'the superseded pack leaked');
  assert.ok(h.disposed.has(staleColor), 'the superseded colour texture leaked');
  const installed = h.shader();
  assert.equal(installed.uniforms.uDecalS0, undefined);
  assert.equal(installed.uniforms.uDecalC0?.value, tattoo);
});

test('clearing a slot mid-load disposes the pack and leaves the material cleared', async () => {
  const h = lifeHarness();
  const equip = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  await settle();
  const color = h.release(PAINT.colorUrl!);
  await settle();
  h.decals.clear('bodyPaint');
  const surface = h.release(SURFACE_URL);
  await equip;

  assert.ok(h.disposed.has(surface), 'the cancelled pack leaked');
  assert.ok(h.disposed.has(color), 'the cancelled colour texture leaked');
  assert.equal(h.patched(), false, 'a cleared slot was repainted by its own late load');
});

test('clear and clearAll dispose the pack and restore the base callback and cache key', async () => {
  const h = lifeHarness();
  const install = async () => {
    const equip = h.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
    await settle();
    h.release(PAINT.colorUrl!);
    await settle();
    const surface = h.release(SURFACE_URL);
    await equip;
    return surface;
  };

  const first = await install();
  assert.equal(h.patched(), true);
  h.decals.clear('bodyPaint');
  assert.ok(h.disposed.has(first), 'clear() leaked the pack');
  assert.equal(h.patched(), false);
  assert.equal(h.material.onBeforeCompile, h.baseCompile, 'the base callback was not restored');
  assert.equal(h.material.customProgramCacheKey(), h.originalKey, 'the base cache key was not restored');

  h.decals.registerTarget('body', [h.material]);
  const second = await install();
  h.decals.clearAll();
  assert.ok(h.disposed.has(second), 'clearAll() leaked the pack');
  assert.equal(h.patched(), false);
});

test('the pack changes program identity; without it the colour program is unchanged', async () => {
  const h = lifeHarness();
  const install = async (layer: RigDecalLayer) => {
    const equip = h.decals.set('bodyPaint', { layers: [layer] });
    await settle();
    h.release(layer.colorUrl!);
    await settle();
    if (h.requested(SURFACE_URL)) h.release(SURFACE_URL);
    await equip;
  };

  await install(SURFACE_PAINT);
  const packed = h.key();
  await install(PAINT);
  const plain = h.key();

  assert.match(packed, /bodycb/, 'the packed path was not part of the cache key');
  assert.doesNotMatch(plain, /bodycb/, 'a colour-only layer carried the packed path');
  h.decals.clear('bodyPaint');
  assert.equal(h.material.customProgramCacheKey(), h.originalKey);
  assert.equal(h.material.onBeforeCompile, h.baseCompile);
});
