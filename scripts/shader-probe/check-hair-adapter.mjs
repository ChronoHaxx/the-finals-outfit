// Test the actual Three adapter against a double-precision reading of the
// published scattering equations, then test fibre orientation and shadow masks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output = 'visual-diff/reconstructed/reference-hair-01';
mkdirSync(output, { recursive: true });
const hash = text => createHash('sha256').update(text).digest('hex');
const shader = `
uniform vec3 testColor; uniform vec3 testTangent;
uniform float testRoughness; uniform float testSpecular; uniform float testScatter; uniform float testCoverage;
struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 objectPosition; vec4 color; };
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry g) {
  ReconstructedSurface s; s.baseColor=testColor*g.color.x; s.normal=testTangent;
  s.roughness=testRoughness; s.specular=testSpecular; s.scatter=testScatter;
  s.metalness=0.0; s.ao=g.color.y; s.opacity=testCoverage; return s;
}`;
const coverage = `
uniform float testCoverage;
struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 objectPosition; vec4 color; };
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry g) {
  ReconstructedSurface s; s.opacity=testCoverage; return s;
}`;
const manifest = { formatVersion: 1, itemId: 'hair-fixture', shader: 'hair.glsl', shaderSha256: hash(shader),
  textures: [], requiredUvSets: [0], worldSurface: true, surfaceKind: 'hair', normalSpace: 'strand-tangent', requiresVertexColor: true,
  twoSided: true, coverageShader: 'coverage.glsl', coverageShaderSha256: hash(coverage), coverageGeometryFields: [] };
const norm = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
function reference(c) {
  const L = c.light, V = [0, 0, 1], T = c.tangent, color = c.color.map(v => v * .8);
  // Angles are computed explicitly here, independently of the GLSL identities.
  const thetaI = Math.asin(clamp(dot(T, L))), thetaV = Math.asin(clamp(dot(T, V)));
  const cosD = Math.max(.001, Math.cos((thetaI - thetaV) / 2));
  const phi = Math.acos(clamp((dot(L, V) - Math.sin(thetaI) * Math.sin(thetaV)) /
    Math.max(1e-5, Math.cos(thetaI) * Math.cos(thetaV))));
  const gaussian = (alpha, beta) => Math.exp(-((Math.sin(thetaI) + Math.sin(thetaV) - alpha) ** 2) / (2 * beta ** 2)) / (beta * Math.sqrt(2 * Math.PI));
  const fresnel = angle => .08 * c.specular + (1 - .08 * c.specular) * (1 - clamp(angle, 0, 1)) ** 5;
  const beta = clamp(c.roughness, .02, 1) ** 2;
  const r = gaussian(-.07, Math.max(.002, beta)) * .25 * Math.cos(phi / 2) * fresnel(Math.cos(Math.acos(clamp(dot(L, V))) / 2));
  const etaPrime = 1.19 / cosD + .36 * cosD;
  const h = clamp((1 + (.6 - .8 * Math.cos(phi)) / etaPrime) * Math.cos(phi / 2), 0, 1);
  const gammaT = Math.asin(h / etaPrime);
  const fTT = fresnel(cosD * Math.sqrt(1 - h * h)), fTRT = fresnel(cosD * .5);
  let n = V.map((v, i) => v - T[i] * dot(V, T));
  if (Math.hypot(...n) < 1e-4) n = [1, 0, 0]; else n = norm(n);
  const wrap = (dot(n, L) + 1) / (4 * Math.PI);
  return color.map(C => r + C ** (Math.cos(gammaT) / (2 * cosD)) * (1 - fTT) ** 2 * Math.exp(-3.65 * Math.cos(phi) - 3.98) * gaussian(.035, Math.max(.002, .5 * beta))
    + C ** (.8 / cosD) * (1 - fTRT) ** 2 * fTRT * Math.exp(17 * Math.cos(phi) - 16.78) * gaussian(.14, Math.max(.002, 2 * beta))
    + Math.sqrt(C) * c.scatter * wrap);
}
const cases = [];
for (const roughness of [.15, .4, .85]) for (const tangent of [[0, 1, 0], [.3, 1, .2], [.9, .2, -.4]])
  for (const light of [[0, .12, 1], [.8, .1, .6], [-.6, .2, -.8], [0, .1, -1], [.3, -.8, .5]]) {
    const c = { roughness, tangent: norm(tangent), light: norm(light), color: [.45, .17, .035], specular: .65, scatter: .32 };
    cases.push({ ...c, expected: reference(c) });
  }
const browser = await chromium.launch({ channel: 'msedge', headless: true }), errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/__hair_fixture__/*', route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1);
    return file.endsWith('.json') ? route.fulfill({ json: manifest })
      : route.fulfill({ body: file === 'coverage.glsl' ? coverage : shader, contentType: 'text/plain' });
  });
  await page.goto('http://127.0.0.1:5173/?outfit=1.eyJzbG90cyI6e319', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle);
  const result = await page.evaluate(async cases => {
    const T = window.__THREE;
    const { loadReconstructedMaterial } = await import('/src/rig/ReconstructedMaterial.ts');
    const renderer = new T.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const target = new T.WebGLRenderTarget(256, 256, { type: T.FloatType, depthBuffer: false });
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .01, 10);
    camera.position.z = 3; camera.updateMatrixWorld(true);
    const geometry = new T.PlaneGeometry(2, 2);
    const attribute = (name, value) => geometry.setAttribute(name, new T.Float32BufferAttribute(Array.from({ length: 4 }, () => value).flat(), value.length));
    attribute('tangent', [1, 0, 0, 1]); attribute('color', [.8, .7, .2, 1]);
    attribute('skinIndex', [0, 0, 0, 0]); attribute('skinWeight', [1, 0, 0, 0]);
    const mesh = new T.SkinnedMesh(geometry, new T.MeshPhysicalMaterial()), bone = new T.Bone(), group = new T.Group();
    scene.add(group); group.add(mesh, bone); mesh.bind(new T.Skeleton([bone]), new T.Matrix4()); mesh.frustumCulled = false;
    const values = { testColor: { value: new T.Vector3(.45, .17, .035) }, testTangent: { value: new T.Vector3(0, 1, 0) },
      testRoughness: { value: .4 }, testSpecular: { value: .65 }, testScatter: { value: .32 }, testCoverage: { value: 1 } };
    const bindUniforms = material => {
      const before = material.onBeforeCompile;
      material.onBeforeCompile = function (shader, renderer) { before.call(this, shader, renderer); Object.assign(shader.uniforms, values); };
    };
    const apply = async (view = 'lit') => {
      const recovered = await loadReconstructedMaterial('/__hair_fixture__/hair.json', view);
      recovered.apply(mesh, undefined, { boundsOrigin: [0, 0, 0] });
      mesh.material.toneMapped = false;
      for (const m of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial]) bindUniforms(m);
    };
    const light = new T.DirectionalLight(0xffffff, 1); scene.add(light, light.target);
    const pixel = () => { renderer.setRenderTarget(target); renderer.render(scene, camera);
      const value = new Float32Array(4); renderer.readRenderTargetPixels(target, 128, 128, 1, 1, value); return [...value].slice(0, 3); };
    const check = (condition, name, details = {}) => { if (!condition) throw new Error(name + JSON.stringify(details)); checks.push({ name, passed: true, ...details }); };
    const checks = [];
    await apply('baseColor');
    const color = pixel(); check(Math.max(...color.map((v, i) => Math.abs(v - [.36, .136, .028][i]))) < 1e-6,
      'Raw vertex mask is consumed once without diffuse vertex-colour tinting', { color });
    await apply();
    let maxError = 0;
    for (const c of cases) {
      values.testColor.value.fromArray(c.color); values.testTangent.value.fromArray(c.tangent);
      values.testRoughness.value = c.roughness; values.testSpecular.value = c.specular; values.testScatter.value = c.scatter;
      light.position.fromArray(c.light);
      const actual = pixel(), error = Math.max(...actual.map((v, i) => Math.abs(v - c.expected[i])));
      check(actual.every(Number.isFinite) && error < 2e-5, 'Published lobes in actual Three direct-light adapter', { ...c, actual, error });
      maxError = Math.max(maxError, error);
    }
    values.testTangent.value.set(0, 1, 0); values.testRoughness.value = .4;
    light.position.set(0, .12, -1);
    const backlit = pixel(); check(Math.max(...backlit) > .01, 'Transmission remains visible when the light is behind the card', { backlit });
    light.position.set(.3, .1, 1); const front = pixel(); mesh.rotation.y = Math.PI;
    const back = pixel(); check(Math.max(...front.map((v, i) => Math.abs(v - back[i]))) < 1e-6,
      'Backface viewing preserves the root-to-tip fibre direction', { front, back }); mesh.rotation.y = 0;
    const originalTangent = values.testTangent.value.clone(); values.testTangent.value.set(1, 0, 0);
    const rotated = pixel(); check(Math.max(...front.map((v, i) => Math.abs(v - rotated[i]))) > .001,
      'Rotating fibres changes the highlight without changing the card normal'); values.testTangent.value.copy(originalTangent);
    // Head/bone rotation must transform the fibre along with the mesh on the GPU.
    light.position.set(.3, .1, 1); const neutral = pixel();
    const turn = new T.Quaternion().setFromEuler(new T.Euler(.18, -.27, .23));
    bone.quaternion.copy(turn); camera.position.applyQuaternion(turn); camera.up.applyQuaternion(turn); camera.lookAt(0, 0, 0);
    light.position.applyQuaternion(turn);
    const moved = pixel(); check(Math.max(...neutral.map((v, i) => Math.abs(v - moved[i]))) < 2e-6,
      'Rigid bone, camera and light rotation leave strand lighting invariant', { neutral, moved });
    bone.quaternion.identity(); camera.position.set(0, 0, 3); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
    // A constant environment isolates the shared ambient policy and source AO.
    scene.remove(light); const envScene = new T.Scene(); envScene.background = new T.Color(.2, .3, .4);
    const pmrem = new T.PMREMGenerator(renderer), env = pmrem.fromScene(envScene);
    scene.environment = env.texture; const ambient = pixel();
    attribute('color', [.8, .175, .2, 1]); const occluded = pixel();
    check(ambient.every(v => Number.isFinite(v) && v > 0) && Math.max(...ambient.map((v, i) => Math.abs(occluded[i] - v * .25))) < 2e-6,
      'Environment hair lighting uses source AO exactly once', { ambient, occluded });
    scene.environment = null; env.dispose(); pmrem.dispose(); attribute('color', [.8, .7, .2, 1]);
    await apply('baseColor');
    const visible = mesh.material, depth = mesh.customDepthMaterial, distance = mesh.customDistanceMaterial;
    // WebGLShadowMap normally supplies this light for the distance pass.
    renderer.properties.get(distance).light = new T.PointLight();
    const masks = material => {
      mesh.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Float32Array(256 * 256 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      const result = []; for (let i = 3; i < pixels.length; i += 4) result.push(pixels[i] !== 0); return result;
    };
    // Depth's packed alpha is not coverage; emit white only after the real
    // alpha-hash chunk so all three passes share the same occupancy probe.
    for (const material of [depth, distance]) {
      const before = material.onBeforeCompile;
      material.onBeforeCompile = function (shader, r) {
        before.call(this, shader, r);
        shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, 'gl_FragColor=vec4(1.0);\n}');
      };
    }
    for (const coverage of [.15, .55, .9]) for (const angle of [0, .3]) {
      values.testCoverage.value = coverage; bone.rotation.z = angle;
      const a = masks(visible), b = masks(depth), c = masks(distance);
      const mismatches = a.filter((value, i) => value !== b[i] || value !== c[i]).length;
      const density = a.filter(Boolean).length / a.length;
      check(mismatches === 0 && density > .03 && density < .99, 'Visible/depth/distance hair coverage with rigid skinning', { coverage, angle, mismatches, density });
    }
    mesh.material = visible;
    geometry.deleteAttribute('color');
    let failed = false; const missing = await loadReconstructedMaterial('/__hair_fixture__/hair.json');
    try { missing.apply(mesh, undefined, { boundsOrigin: [0, 0, 0] }); } catch { failed = true; } finally { missing.dispose(); }
    check(failed && mesh.material === visible, 'Missing original hair colour masks reject activation before replacement');
    for (const m of [visible, depth, distance]) m.dispose(); geometry.dispose(); mesh.skeleton.dispose(); target.dispose(); renderer.dispose();
    return { checks, maxError };
  }, cases);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/hair-adapter-checks.json`, JSON.stringify(result, null, 2));
  console.log(`${result.checks.length} hair GPU checks passed; maximum published-equation error ${result.maxError}`);
} catch (e) { console.error(errors.map(e => e.slice(0, 2000))); throw e; }
finally { await browser.close(); }
