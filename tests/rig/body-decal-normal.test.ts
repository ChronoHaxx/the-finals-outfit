import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BodyDecalManager, type RigDecalLayer } from '../../src/rig/BodyDecals';
import { ItemSchema } from '../../src/lib/item';

// The opt-in RG paint-normal composite and the fractional B/A surface weight (w55-paint-normals), both
// traced from the preserved M_Skin/M_Face SM5 base passes:
//   w = a*BodyNormalOverride; N_flat = lerp(N, up, w); N1 = N_flat + up
//   pn.xy = G*(2R-1, 2G-1); pn.z = sqrt(max(1-|pn.xy|^2, 0))
//   n' = ((2g-1)*pn.x, -pn.y, pn.z)  (reoriented n2 prep; g = floor(uv.y), the tile-parity x mirror)
//   N_out = (1-a)*N + a*(dot(N1,n')*N1 - N1.z*n')  — reoriented normal map, after the material's own normal.
// The B/A weight is `coverage * surfaceOverride`; 1 keeps the earlier GLSL byte-for-byte (the existing
// body-decal-surface tests pin those strings). These tests pin the new paths against the same real
// ShaderLib.physical template the compositor patches.

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

// The recovered skin/face shader's normal_fragment_maps replacement (ReconstructedMaterial, tangent branch).
const RECOVERED_NORMAL = `
            #ifdef USE_TANGENT
              mat3 recoveredFrame = mat3(normalize(vTangent), normalize(vBitangent), normal);
              #ifdef DOUBLE_SIDED
                recoveredFrame[0] *= faceDirection;
                recoveredFrame[1] *= faceDirection;
              #endif
              normal = normalize(recoveredFrame * normalize(recovered.normal));
            #else
            normal = normalize(recoveredTangentFrame(-vViewPosition, normal, vRecoveredUv0) * normalize(recovered.normal));
            #endif
            `;

function physicalShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
}

function immediateLoader() {
  const requests: string[] = [];
  const loader = {
    load: (url: string, onLoad: (t: THREE.Texture) => void) => {
      requests.push(url);
      onLoad(new THREE.Texture());
      return new THREE.Texture();
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
  material.onBeforeCompile = (shader, renderer) => {
    originalCompile.call(material, shader, renderer);
    // The recovered skin surface the real rig installs: the map chunk becomes a ReconstructedSurface with
    // a readiness marker, the finish chunks become recovered reads, and the normal chunk becomes the
    // recovered tangent-frame perturbation whose final statement the paint normal composites after.
    if (opts.reconstructed) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          'ReconstructedSurface recovered = ReconstructedSurface( vec3( 1.0 ), 0.5, 0.0 );\n// recovered_surface_ready',
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = recovered.roughness;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = recovered.metalness;')
        .replace('#include <normal_fragment_maps>', RECOVERED_NORMAL);
    }
  };
  if (opts.reconstructed) material.userData.reconstructed = true;
  decals.registerTarget('body', [material]);
  decals.registerTarget('head', [material]);
  const compile = (shader = physicalShader()) => {
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader;
  };
  return { decals, material, requests, compile, key: () => material.customProgramCacheKey() };
}

test('a normalOverride layer composites the pack RG after the recovered normal statement', async () => {
  const layer: RigDecalLayer = { ...SURFACE_PAINT, surfaceOverride: 0, normalOverride: 1 };
  const h = harness({ reconstructed: true });
  await h.decals.set('bodyPaint', { layers: [layer] });
  const { fragmentShader, uniforms } = h.compile();

  assert.ok(h.requests.includes(SURFACE_URL), 'the pack was not requested');
  assert.ok(uniforms.uDecalS0, 'no packed sampler was bound');
  // The traced formula, anchored inside the recovered USE_TANGENT branch (the composite needs the frame).
  const anchor = fragmentShader.indexOf('normal = normalize(recoveredFrame * normalize(recovered.normal));');
  const iN = fragmentShader.indexOf('vec3 decalN = transpose( recoveredFrame ) * normal;');
  const iOut = fragmentShader.indexOf('normal = normalize( ( 1.0 - decalSurfCoverage0 ) * normal + decalSurfCoverage0 * ( recoveredFrame * ( decalRnm * decalN1 - decalN1.z * decalPn ) ) );');
  const iElse = fragmentShader.indexOf('normal = normalize(recoveredTangentFrame');
  assert.ok(anchor >= 0, 'the recovered normal statement is missing');
  assert.ok(iN > anchor, 'the composite must follow the material\'s own final normal');
  assert.ok(iOut > iN, 'the reoriented blend is missing or misplaced');
  assert.ok(iElse < 0 || iOut < iElse, 'the composite leaked out of the USE_TANGENT branch');
  assert.match(fragmentShader, /vec3 decalNFlat = mix\( decalN, vec3\( 0\.0, 0\.0, 1\.0 \), decalSurfCoverage0 \* 1\.000000 \);/);
  assert.match(fragmentShader, /vec2 decalPnXY = ins \* \( sp\.rg \* 2\.0 - 1\.0 \);/);
  assert.match(fragmentShader, /float decalPnZ = sqrt\( max\( 1\.0 - dot\( decalPnXY, decalPnXY \), 0\.0 \) \);/);
  assert.match(fragmentShader, /float decalTile = floor\( vDecalUv1\.y \);/);
  assert.match(fragmentShader, /vec3 decalPn = vec3\( \( 2\.0 \* decalTile - 1\.0 \) \* decalPnXY\.x, -decalPnXY\.y, decalPnZ \);/);
  assert.match(fragmentShader, /float decalRnm = dot\( decalN1, decalPn \);/);
  // The traced flatten weight and the tile selector come from the same coverage and UV set as the colour.
  assert.match(fragmentShader, /decalSurfCoverage0 = dc\.a \* ins;/);
  assert.match(h.key(), /n1/, 'the normal weight must enter the program identity');
  assert.match(h.key(), /w0/, 'the zero B/A weight must enter the program identity');
});

test('a normals-only layer keeps the material finish: no B/A lines are emitted', async () => {
  const layer: RigDecalLayer = { ...SURFACE_PAINT, surfaceOverride: 0, normalOverride: 0.1 };
  const h = harness({ reconstructed: true });
  await h.decals.set('bodyPaint', { layers: [layer] });
  const { fragmentShader } = h.compile();
  assert.doesNotMatch(fragmentShader, /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b/);
  assert.doesNotMatch(fragmentShader, /metalnessFactor = clamp\( mix\( metalnessFactor, sp\.a/);
  assert.match(fragmentShader, /vec3 decalNFlat = mix\( decalN, vec3\( 0\.0, 0\.0, 1\.0 \), decalSurfCoverage0 \* 0\.100000 \);/);
});

test('a fractional surfaceOverride weights the B/A lines; 1 keeps the earlier GLSL', async () => {
  const h = harness();
  await h.decals.set('bodyPaint', { layers: [{ ...SURFACE_PAINT, surfaceOverride: 0.5 }] });
  const { fragmentShader } = h.compile();
  assert.match(fragmentShader,
    /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b, \( decalSurfCoverage0 \* 0\.500000 \) \), 0\.0, 1\.0 \);/);
  assert.match(fragmentShader,
    /metalnessFactor = clamp\( mix\( metalnessFactor, sp\.a, \( decalSurfCoverage0 \* 0\.500000 \) \), 0\.0, 1\.0 \);/);
  assert.match(h.key(), /w0\.5/, 'the fractional weight must enter the program identity');

  const one = harness();
  await one.decals.set('bodyPaint', { layers: [SURFACE_PAINT] });
  const frag1 = one.compile().fragmentShader;
  assert.match(frag1,
    /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  assert.doesNotMatch(one.key(), /w1/, 'weight 1 keeps the earlier program identity');
});

test('a normalOverride layer on a plain material keeps its shading, pack still serving B/A', async () => {
  const h = harness(); // not reconstructed: no recovered tangent frame exists
  await h.decals.set('bodyPaint', { layers: [{ ...SURFACE_PAINT, normalOverride: 1 }] });
  const { fragmentShader, uniforms } = h.compile();
  assert.ok(uniforms.uDecalS0, 'the B/A pack was not bound');
  assert.match(fragmentShader, /roughnessFactor = clamp\( mix\( roughnessFactor, sp\.b, decalSurfCoverage0 \), 0\.0, 1\.0 \);/);
  assert.doesNotMatch(fragmentShader, /recoveredFrame/, 'the traced composite needs the recovered frame');
  assert.doesNotMatch(fragmentShader, /decalPn/, 'a plain material must not composite paint normals');
});

test('a UV0 head layer reads its tile selector and paint normal from vMapUv', async () => {
  const layer: RigDecalLayer = { ...SURFACE_PAINT, target: 'head', uv: 0, uvScale: [1, 1],
    surfaceOverride: 0, normalOverride: 1 };
  const h = harness({ reconstructed: true });
  await h.decals.set('makeup', { layers: [layer] });
  const { fragmentShader } = h.compile();
  assert.match(fragmentShader, /float decalTile = floor\( vMapUv\.y \);/);
  assert.match(fragmentShader, /vec2 duv = vec2\( vMapUv\.x \* 1\.000000, fract\( vMapUv\.y \) \);/);
  // The recovered head path (M_Face): the composite sits inside the recovered normal branch.
  const anchor = fragmentShader.indexOf('normal = normalize(recoveredFrame * normalize(recovered.normal));');
  const iOut = fragmentShader.indexOf('normal = normalize( ( 1.0 - decalSurfCoverage0 ) * normal + decalSurfCoverage0 * ( recoveredFrame * ( decalRnm * decalN1 - decalN1.z * decalPn ) ) );');
  assert.ok(anchor >= 0 && iOut > anchor, 'the head composite is missing');
});

test('the schema accepts the traced weights in [0,1] and refuses anything outside', () => {
  const item = (layer: Record<string, unknown>) => ItemSchema.parse({
    id: 'test-item-01', slot: 'bodyPaint', name: 'Test', imageUrl: 'i.webp',
    decal: { layers: [{ target: 'body', colorPath: 'models/x_c.png', ...layer }] },
  });
  assert.equal(item({ surfaceOverride: 0.5 }).decal!.layers[0].surfaceOverride, 0.5);
  assert.equal(item({ normalOverride: 1 }).decal!.layers[0].normalOverride, 1);
  assert.equal(item({ normalOverride: 0.1 }).decal!.layers[0].normalOverride, 0.1);
  assert.throws(() => item({ surfaceOverride: 1.5 }));
  assert.throws(() => item({ surfaceOverride: -0.1 }));
  assert.throws(() => item({ normalOverride: 1.5 }));
  assert.throws(() => item({ normalOverride: -1 }));
});
