import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BodyDecalManager, type RigDecalLayer } from '../../src/rig/BodyDecals';

// Numeric checks of the GLSL the compositor emits for the remaining source paint contracts. The
// generated statements are executed once per colour channel with stub samplers, so what is asserted
// is the shader's own arithmetic, not a re-implementation of it. Inputs and expected formulas are
// Astra's independently authored oracle (_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json),
// read from M_Skin asm 138-158, 195-198 and 208-235:
//
//   paint:   G = inside; a = G*C.a; mul = clamp(C.rgb + 1 - clamp(a + G*nonMasked, 0, 1), 0, 1)
//            rgb = mix(base*mul, C.rgb, a*override)
//   tattoo:  T = mix(1, C.rgb, G); rgb = mix(base*T, T, G*C.a*override)
//   surface: rough/metal = mix(base, M.b/M.a, G*C.a), body layers with surfaceOverride 1 only

interface Contract {
  id: string; target: 'body' | 'head'; uv: 0 | 1; scale: number; offset: number;
  kind: 'paint' | 'tattoo'; nonMasked: 0 | 1; override: 0 | 1; surface: boolean;
}
const ORACLE = {
  colourBytes: [[80, 160, 224, 0], [80, 160, 224, 128], [80, 160, 224, 255]],
  surfaceBytes: [19, 37, 64, 192],
  baseLinear: [0.2, 0.4, 0.6],
  baseSurface: [0.2, 0.4],
  sampleU: [-0.25, 0, 1 / 6, 0.5, 5 / 6, 1, 1.25],
  sampleRawV: 1.5,
  contracts: [
    { id: 'bodycosmetics-bodypaint-90sskateboarder-01', target: 'body', uv: 1, scale: 1, offset: -1, kind: 'paint', nonMasked: 1, override: 1, surface: true },
    { id: 'bodycosmetics-bodypaint-armsblack-01', target: 'body', uv: 1, scale: 1, offset: -1, kind: 'paint', nonMasked: 0, override: 1, surface: true },
    { id: 'bodycosmetics-bodypaint-bruises-02', target: 'body', uv: 1, scale: 1, offset: -1, kind: 'paint', nonMasked: 1, override: 1, surface: true },
    { id: 'bodycosmetics-bodypaint-oilyhands-01', target: 'body', uv: 1, scale: 1, offset: -1, kind: 'paint', nonMasked: 0, override: 0, surface: true },
    { id: 'bodycosmetics-bodypaint-runnyfingersblack-01', target: 'body', uv: 0, scale: 1, offset: -1, kind: 'paint', nonMasked: 0, override: 1, surface: true },
    { id: 'bodycosmetics-bodypaint-runnyfingersgold-01', target: 'body', uv: 0, scale: 1, offset: -1, kind: 'paint', nonMasked: 0, override: 1, surface: true },
    { id: 'bodycosmetics-bodypaint-sweat-01', target: 'body', uv: 1, scale: 0.5, offset: 0, kind: 'paint', nonMasked: 1, override: 0, surface: true },
    { id: 'bodycosmetics-bodypaint-sweat-01', target: 'head', uv: 0, scale: 1, offset: 0, kind: 'paint', nonMasked: 1, override: 0, surface: false },
    { id: 'bodycosmetics-bodypaint-techwearsymbols-01', target: 'body', uv: 1, scale: 1, offset: -1, kind: 'tattoo', nonMasked: 0, override: 1, surface: false },
  ] as Contract[],
};

// Colour samples go through the sRGB decode the colour texture is uploaded with; packed data is linear.
const srgb = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
interface Texel { rgb: number[]; a: number }
const texel = (bytes: number[]): Texel => ({ rgb: bytes.slice(0, 3).map(srgb), a: bytes[3] / 255 });
const PACK = ORACLE.surfaceBytes.map((b) => b / 255);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** The catalog layer the scoped preparer writes for a contract, as toRigDecal hands it to the rig. */
function layerFor(c: Contract): RigDecalLayer {
  return {
    target: c.target,
    colorUrl: `models/reconstructed-paint-contracts-v1/${c.id}-${c.target}_c.png`,
    uv: c.uv,
    uvScale: [c.scale, 1],
    ...(c.offset ? { uvOffsetX: c.offset } : {}),
    uvLayout: 'sourceBodyPaint',
    colorOverride: c.override,
    // The tattoo branch's T = mix(1, C.rgb, G) is the nonmasked multiply, because G is binary.
    colorMultiply: c.kind === 'tattoo' || c.nonMasked ? 'nonMasked' : 'masked',
    ...(c.surface ? { surfaceUrl: `models/reconstructed-paint-contracts-v1/${c.id}-${c.target}_m.png`, surfaceOverride: 1 as const } : {}),
  };
}

const loader = {
  load: (_url: string, onLoad: (t: THREE.Texture) => void) => { const t = new THREE.Texture(); onLoad(t); return t; },
} as unknown as THREE.TextureLoader;

/** Compile against the real ShaderLib.physical template, so every anchor is the production one. */
async function compile(layers: RigDecalLayer[]) {
  const decals = new BodyDecalManager(loader, 'models/decals/_shared/nailmask.webp');
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  decals.registerTarget('body', [material]);
  decals.registerTarget('head', [material]);
  await decals.set('bodyPaint', { layers });
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  const colour = inserted(shader.fragmentShader, '#include <map_fragment>');
  const surface = inserted(shader.fragmentShader, '#include <metalnessmap_fragment>');
  return { ...shader, colour, surface, key: material.customProgramCacheKey() };
}

/** The statements the compositor inserted after an anchor, up to three's next chunk. */
function inserted(fragment: string, anchor: string): string {
  const start = fragment.indexOf(anchor);
  assert.ok(start >= 0, `missing anchor ${anchor}`);
  const rest = fragment.slice(start + anchor.length);
  const end = rest.indexOf('#include <');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Execute the inserted GLSL for one fragment. Every colour statement is channel-wise, so `.rgb` runs
 * once per channel as a scalar. Only the UV set the layer should read is defined: sampling the other
 * one dereferences null and fails the test.
 */
function execute(glsl: string, set: 'vDecalUv1' | 'vMapUv', uv: { x: number; y: number }, colour: Texel,
  base = ORACLE.baseLinear, baseSurface = ORACLE.baseSurface) {
  const js = glsl
    .replace(/\b(?:vec2|vec4|float)\s+(\w+)\s*=/g, 'var $1 =')
    .replace(/\.rgb\b/g, '.c')
    .replace(/\buDecal([CMS])\d+\b/g, "'$1'");
  const helpers = {
    vec2: (x: number, y: number) => ({ x, y }),
    fract: (x: number) => x - Math.floor(x),
    clamp,
    ceil: Math.ceil,
    mix,
  };
  const channels = [0, 1, 2].map((k) => {
    const texture2D = (sampler: string) => {
      if (sampler === 'C') return { c: colour.rgb[k], a: colour.a };
      if (sampler === 'S') return { b: PACK[2], a: PACK[3] };
      throw new Error(`unexpected sampler ${sampler}`);
    };
    const run = new Function('vDecalUv1', 'vMapUv', 'diffuseColor', 'texture2D', ...Object.keys(helpers),
      `var roughnessFactor = ${baseSurface[0]}, metalnessFactor = ${baseSurface[1]};\n${js}\n` +
      'return { duv: typeof duv === "undefined" ? null : duv, ins: typeof ins === "undefined" ? null : ins, ' +
      'c: diffuseColor.c, rough: roughnessFactor, metal: metalnessFactor };');
    return run(set === 'vDecalUv1' ? uv : null, set === 'vMapUv' ? uv : null, { c: base[k] }, texture2D,
      ...Object.values(helpers)) as { duv: { x: number; y: number }; ins: number | null; c: number; rough: number; metal: number };
  });
  return { duv: channels[0].duv, ins: channels[0].ins, rgb: channels.map((c) => c.c), rough: channels[0].rough, metal: channels[0].metal };
}

/** The oracle's own formulas, evaluated directly. */
function expected(c: Contract, u: number, t: Texel) {
  const G = u > 0 && u < 1 ? 1 : 0; // fract(1.5) = 0.5 is strictly interior on V
  const a = G * t.a;
  const rgb = ORACLE.baseLinear.map((base, k) => {
    const C = t.rgb[k];
    if (c.kind === 'tattoo') { const T = mix(1, C, G); return mix(base * T, T, G * t.a * c.override); }
    const mul = clamp(C + 1 - clamp(a + G * c.nonMasked, 0, 1), 0, 1);
    return mix(base * mul, C, a * c.override);
  });
  const surfaced = c.surface && c.target === 'body';
  return { G, rgb, rough: surfaced ? mix(ORACLE.baseSurface[0], PACK[2], a) : ORACLE.baseSurface[0],
    metal: surfaced ? mix(ORACLE.baseSurface[1], PACK[3], a) : ORACLE.baseSurface[1] };
}

const close = (actual: number, want: number, what: string) =>
  assert.ok(Math.abs(actual - want) < 1e-9, `${what}: ${actual} != ${want}`);

test('every remaining contract reproduces the oracle: coordinates, strict bounds, colour and surface', async () => {
  for (const c of ORACLE.contracts) {
    const { colour, surface } = await compile([layerFor(c)]);
    const set = c.uv === 1 ? 'vDecalUv1' : 'vMapUv';
    for (const u of ORACLE.sampleU) {
      // The raw mesh UV that lands on paint-space U under this contract's scale and offset.
      const raw = { x: (u - c.offset) / c.scale, y: ORACLE.sampleRawV };
      for (const bytes of ORACLE.colourBytes) {
        const t = texel(bytes);
        const want = expected(c, u, t);
        const got = execute(colour + surface, set, raw, t);
        const what = `${c.id} ${c.target} U=${u.toFixed(3)} a=${bytes[3]}`;
        close(got.duv.x, u, `${what} U`);
        close(got.duv.y, 0.5, `${what} V`);
        assert.equal(got.ins, want.G, `${what} gate`);
        got.rgb.forEach((v, k) => close(v, want.rgb[k], `${what} rgb[${k}]`));
        close(got.rough, want.rough, `${what} roughness`);
        close(got.metal, want.metal, `${what} metalness`);
      }
    }
  }
});

test('a nonmasked multiply reads RGB beneath zero alpha inside the gate, and nothing outside it', async () => {
  const c = ORACLE.contracts.find((x) => x.id.endsWith('90sskateboarder-01'))!;
  const { colour } = await compile([layerFor(c)]);
  const clear = texel(ORACLE.colourBytes[0]);
  const inside = execute(colour, 'vDecalUv1', { x: 1.5, y: 1.5 }, clear);
  inside.rgb.forEach((v, k) => close(v, ORACLE.baseLinear[k] * clear.rgb[k], `inside rgb[${k}]`));
  // U = uv1.x - 1: the first tile is outside and must not wrap around into the texture.
  const outside = execute(colour, 'vDecalUv1', { x: 0.5, y: 1.5 }, clear);
  assert.equal(outside.ins, 0);
  outside.rgb.forEach((v, k) => close(v, ORACLE.baseLinear[k], `outside rgb[${k}]`));
});

test('override 0 keeps the multiply: Sweat multiplies, Oily Hands darkens only under coverage', async () => {
  const sweat = ORACLE.contracts.find((x) => x.id.endsWith('sweat-01') && x.target === 'body')!;
  const opaque = texel(ORACLE.colourBytes[2]);
  const s = execute((await compile([layerFor(sweat)])).colour, 'vDecalUv1', { x: 1.25, y: 1.5 }, opaque);
  s.rgb.forEach((v, k) => close(v, ORACLE.baseLinear[k] * opaque.rgb[k], `sweat rgb[${k}]`));

  const oily = ORACLE.contracts.find((x) => x.id.endsWith('oilyhands-01'))!;
  const { colour } = await compile([layerFor(oily)]);
  const half = texel(ORACLE.colourBytes[1]);
  const o = execute(colour, 'vDecalUv1', { x: 1.5, y: 1.5 }, half);
  o.rgb.forEach((v, k) => close(v, ORACLE.baseLinear[k] * clamp(half.rgb[k] + 1 - half.a, 0, 1), `oily rgb[${k}]`));
  const bare = execute(colour, 'vDecalUv1', { x: 1.5, y: 1.5 }, texel(ORACLE.colourBytes[0]));
  bare.rgb.forEach((v, k) => close(v, ORACLE.baseLinear[k], `oily zero-alpha rgb[${k}]`));
});

test('UV0 contracts read the map UV and add no UV1 varying', async () => {
  const c = ORACLE.contracts.find((x) => x.id.endsWith('runnyfingersgold-01'))!;
  const { vertexShader, colour, key } = await compile([layerFor(c)]);
  assert.match(colour, /vec2 duv = vec2\( vMapUv\.x \* 1\.000000 - 1\.000000, fract\( vMapUv\.y \) \);/);
  assert.doesNotMatch(vertexShader, /vDecalUv1/);
  assert.match(key, /bodycbu0s1x1px-1o1\*m/);
});

test('the new fields enter program identity only when set', async () => {
  const sweatHead = ORACLE.contracts.find((x) => x.target === 'head')!;
  assert.match((await compile([layerFor(sweatHead)])).key, /headcu0s1x1po0\*n/);
  const tattoo = ORACLE.contracts.find((x) => x.kind === 'tattoo')!;
  assert.match((await compile([layerFor(tattoo)])).key, /bodycu1s1x1px-1o1\*n/);
});

// ---------------------------------------------------------------------------------------------
// Earlier source paints and legacy overlays keep their accepted programs
// ---------------------------------------------------------------------------------------------

const EARLIER: RigDecalLayer = {
  target: 'body', colorUrl: 'models/reconstructed-body-paints-v1/paint_c.webp',
  uv: 1, uvScale: [0.5, 1], uvLayout: 'sourceBodyPaint', colorOverride: 1,
  surfaceUrl: 'models/reconstructed-body-paints-v1/paint_m.png', surfaceOverride: 1,
};

test('an earlier source paint keeps its exact statements, key and mix-only arithmetic', async () => {
  const { colour, surface, key } = await compile([EARLIER]);
  assert.equal(colour, '\n' +
    '  float decalSurfCoverage0 = 0.0;\n' +
    '  {\n' +
    '    vec2 duv = vec2( vDecalUv1.x * 0.500000, fract( vDecalUv1.y ) );\n' +
    '    float ins = ceil( clamp( duv.x * ( 1.0 - duv.x ), 0.0, 1.0 ) * clamp( duv.y * ( 1.0 - duv.y ), 0.0, 1.0 ) );\n' +
    '    vec4 dc = texture2D( uDecalC0, duv );\n' +
    '    float a = dc.a;\n' +
    '    a *= ins;\n' +
    '    decalSurfCoverage0 = dc.a * ins;\n' +
    '    a *= 1.000000;\n' +
    '    diffuseColor.rgb = mix( diffuseColor.rgb, dc.rgb, a );\n' +
    '  }\n' +
    '\n\t');
  assert.match(key, /bodycbu1s0\.5x1po1-\d+$/);
  // No multiply: zero alpha inside the gate leaves the base untouched, partial alpha is a plain mix.
  for (const bytes of ORACLE.colourBytes) {
    const t = texel(bytes);
    const got = execute(colour + surface, 'vDecalUv1', { x: 1, y: 1.5 }, t);
    assert.equal(got.ins, 1);
    got.rgb.forEach((v, k) => close(v, mix(ORACLE.baseLinear[k], t.rgb[k], t.a), `earlier a=${bytes[3]} rgb[${k}]`));
    close(got.rough, mix(ORACLE.baseSurface[0], PACK[2], t.a), `earlier a=${bytes[3]} roughness`);
  }
});

test('offset and multiply are ignored without the source layout or a colour texture', async () => {
  const unlaid = await compile([{ ...EARLIER, uvLayout: undefined, uvOffsetX: -1, colorMultiply: 'nonMasked' }]);
  assert.match(unlaid.colour, /vec2 duv = \( vDecalUv1 \* vec2\( 0\.500000, 1\.000000 \) \);/);
  assert.doesNotMatch(unlaid.colour, /diffuseColor\.rgb \*=|- 1\.000000/);
  assert.doesNotMatch(unlaid.key, /x-1|\*n/);

  const tinted = await compile([{ target: 'body', tint: '#808080', uv: 1, uvScale: [1, 1], uvLayout: 'sourceBodyPaint', colorMultiply: 'masked' }]);
  assert.doesNotMatch(tinted.colour, /diffuseColor\.rgb \*=/);
  assert.doesNotMatch(tinted.key, /\*m/);
});

test('legacy overlays emit no source statements at all', async () => {
  const legacy = await compile([{ target: 'body', tint: '#28e828', maskUrl: 'models/decals/bodyPaint/legacy_m.webp', uv: 1 }]);
  assert.match(legacy.colour, /vec2 duv = vMapUv;/);
  assert.doesNotMatch(legacy.colour, /fract|ceil|diffuseColor\.rgb \*=/);
  const makeup = await compile([{ target: 'head', colorUrl: 'models/decals/blush/clown_c.webp', maskUrl: 'models/decals/blush/clown_m.webp', uv: 0 }]);
  assert.doesNotMatch(makeup.colour, /fract|ceil|diffuseColor\.rgb \*=/);
});
