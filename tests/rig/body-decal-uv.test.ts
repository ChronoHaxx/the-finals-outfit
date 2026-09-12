import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BodyDecalManager, type RigDecalLayer } from '../../src/rig/BodyDecals';

// The compositor decides which UV set each decal layer reads. Getting that wrong is invisible in
// every other check: a paint still equips, still compiles and still reports success while sampling
// the wrong atlas — which is exactly how two body paints shipped with zero pixel difference. These
// tests read the generated GLSL, so the routing is asserted rather than inferred from a screenshot.

// Loads immediately; the deferred case has its own suite in body-decal-loading.test.ts.
const loader = {
  load: (_url: string, onLoad: (t: THREE.Texture) => void) => { const tex = new THREE.Texture(); onLoad(tex); return tex; },
} as unknown as THREE.TextureLoader;

// A stand-in for what three hands onBeforeCompile: only the anchors the patch needs.
const fakeShader = () => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: '#include <common>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <begin_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main() {\n\t#include <map_fragment>\n}',
});

async function compile(layers: RigDecalLayer[]) {
  const decals = new BodyDecalManager(loader, 'models/decals/_shared/nailmask.webp');
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  let baseCalls = 0;
  material.onBeforeCompile = () => { baseCalls++; };
  decals.registerTarget('body', [material]);
  decals.registerTarget('head', [material]);
  await decals.set('bodyPaint', { layers });
  const shader = fakeShader();
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { ...shader, baseCalls, cacheKey: material.customProgramCacheKey() };
}

const SOURCE_PAINT: RigDecalLayer = {
  target: 'body', colorUrl: 'models/reconstructed-body-paints-v1/paint_c.webp',
  uv: 1, uvScale: [0.5, 1], uvLayout: 'sourceBodyPaint', colorOverride: 1,
};

test('a source paint reproduces the compiled M_Skin coordinates: X divided, V folded with fract', async () => {
  const { vertexShader, fragmentShader, cacheKey } = await compile([SOURCE_PAINT]);
  // asm:144 horizontal multiply, asm:146 `frc`. NOT a second tile division on V — reading the
  // TextureStreamingData SamplingScale as a uniform 0.5 gave a half-height atlas and misplaced
  // the coverage on the body.
  assert.match(fragmentShader, /vec2 duv = vec2\( vDecalUv1\.x \* 0\.500000, fract\( vDecalUv1\.y \) \);/);
  assert.doesNotMatch(fragmentShader, /vDecalUv1 \* vec2/);
  assert.match(fragmentShader, /texture2D\( uDecalC0, duv \)/);
  assert.match(vertexShader, /vDecalUv1 = uv1;/);
  // A material that already declares uv1 (the recovered skin surface sets USE_UV1) must not get a
  // second declaration, or the shader fails to compile and the body disappears.
  assert.match(vertexShader, /#ifndef USE_UV1\nattribute vec2 uv1;\n#endif/);
  assert.match(cacheKey, /bodycu1s0\.5x1po1/);
});

test('the source bounds gate multiplies the coverage, not the colour', async () => {
  const { fragmentShader } = await compile([SOURCE_PAINT]);
  // asm:148-151 then asm:152: coverage = ceil(clamp(x*(1-x)) * clamp(y*(1-y))) * BodyPaintColor.a.
  assert.match(fragmentShader,
    /float ins = ceil\( clamp\( duv\.x \* \( 1\.0 - duv\.x \), 0\.0, 1\.0 \) \* clamp\( duv\.y \* \( 1\.0 - duv\.y \), 0\.0, 1\.0 \) \);/);
  assert.match(fragmentShader, /float a = dc\.a;\n\s*a \*= ins;/);
  assert.match(fragmentShader, /diffuseColor\.rgb = mix\( diffuseColor\.rgb, dc\.rgb, a \);/);
});

test('a scaled layer without the source layout gets neither fract nor the gate', async () => {
  // The layout is named, never inferred: a layer that has not been traced to M_Skin must not
  // silently acquire its wrapping.
  const { fragmentShader, cacheKey } = await compile([{ ...SOURCE_PAINT, uvLayout: undefined }]);
  assert.match(fragmentShader, /vec2 duv = \( vDecalUv1 \* vec2\( 0\.500000, 1\.000000 \) \);/);
  assert.doesNotMatch(fragmentShader, /fract|ceil/);
  assert.match(cacheKey, /bodycu1s0\.5x1o1/);
  assert.doesNotMatch(cacheKey, /s0\.5x1p/);
});

test('the UV set is only honoured for layers carrying a source transform', async () => {
  // The 26 body paints still on the old importer output carry uv:1 next to a mask converted from
  // the packed `_M` texture. Those masks are not coverage and were never sampled on UV1; rerouting
  // them here would silently change items nobody has looked at.
  const legacy: RigDecalLayer = { target: 'body', tint: '#28e828', maskUrl: 'models/decals/bodyPaint/legacy_m.webp', uv: 1 };
  const { vertexShader, fragmentShader, cacheKey } = await compile([legacy]);
  assert.match(fragmentShader, /vec2 duv = vMapUv;/);
  assert.match(fragmentShader, /texture2D\( uDecalM0, duv \)/);
  assert.doesNotMatch(fragmentShader, /vDecalUv1|fract|ceil/);
  assert.doesNotMatch(vertexShader, /vDecalUv1/);
  assert.doesNotMatch(cacheKey, /u1s/);
});

test('UV0 overlays are untouched and the base compile still runs', async () => {
  const makeup: RigDecalLayer = { target: 'head', colorUrl: 'models/decals/blush/clown_c.webp', maskUrl: 'models/decals/blush/clown_m.webp', uv: 0 };
  const { vertexShader, fragmentShader, baseCalls } = await compile([makeup]);
  assert.match(fragmentShader, /vec2 duv = vMapUv;/);
  assert.match(fragmentShader, /texture2D\( uDecalC0, duv \)/);
  assert.match(fragmentShader, /texture2D\( uDecalM0, duv \).r \* 2\.0/);
  assert.doesNotMatch(fragmentShader, /fract|ceil/);
  assert.doesNotMatch(vertexShader, /vDecalUv1/);
  // Body coverage and decals compose with the source skinning patch; replacing it would drop
  // influences 5-8 on the GPU.
  assert.equal(baseCalls, 1);
});

test('a paint layer keeps its own UV set when a UV0 overlay is composited with it', async () => {
  const makeup: RigDecalLayer = { target: 'body', colorUrl: 'models/decals/blush/skull_c.webp', uv: 0 };
  const { fragmentShader } = await compile([SOURCE_PAINT, makeup]);
  assert.match(fragmentShader, /vec2 duv = vec2\( vDecalUv1\.x \* 0\.500000, fract\( vDecalUv1\.y \) \);[\s\S]*texture2D\( uDecalC0, duv \)/);
  assert.match(fragmentShader, /vec2 duv = vMapUv;\n\s*vec4 dc = texture2D\( uDecalC1, duv \)/);
});

test('the source head paint uses the M_Face UV0 layout and bounds gate', async () => {
  const { vertexShader, fragmentShader, cacheKey } = await compile([
    { ...SOURCE_PAINT, target: 'head', uv: 0, uvScale: [1, 1] },
  ]);
  assert.match(fragmentShader, /vec2 duv = vec2\( vMapUv\.x \* 1\.000000, fract\( vMapUv\.y \) \);/);
  assert.match(fragmentShader, /float a = dc\.a;\n\s*a \*= ins;/);
  assert.doesNotMatch(vertexShader, /vDecalUv1/);
  assert.match(cacheKey, /headcu0s1x1po1/);
});
