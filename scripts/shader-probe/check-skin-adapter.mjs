// Synthetic GPU checks of the runtime skin frame and coverage/decal composition.
// No game assets are used by these fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const shader = `uniform int skinFixtureOutput;
struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 objectPosition; };
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry g) {
  ReconstructedSurface s;
  s.baseColor = skinFixtureOutput == 0 ? g.position / 100.0 : skinFixtureOutput == 1 ? g.normal
    : skinFixtureOutput == 2 ? g.tangent : skinFixtureOutput == 3 ? g.view / 100.0
    : skinFixtureOutput == 4 ? g.objectPosition / 100.0 : skinFixtureOutput == 5 ? vec3(g.handedness) : vec3(0.25);
  s.normal = vec3(0.0, 0.0, 1.0); s.roughness = 0.5; s.metalness = 0.0;
  s.specular = 0.5; s.ao = 1.0; s.subsurfaceColor = vec3(0.0); return s;
}`;
const manifest = { formatVersion: 1, itemId: 'synthetic-skin', shader: 'shader.glsl',
  shaderSha256: createHash('sha256').update(shader).digest('hex'), textures: [], skinSurface: true, requiredUvSets: [0] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/__skin_fixture__/manifest.json', route => route.fulfill({ json: manifest }));
  await page.route('**/__skin_fixture__/shader.glsl', route => route.fulfill({ body: shader, contentType: 'text/plain' }));
  const outfit = '1.' + Buffer.from(JSON.stringify({ slots: {} })).toString('base64url');
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle);
  const report = await page.evaluate(async () => {
    const T = window.__THREE;
    const { loadReconstructedMaterial } = await import('/src/rig/ReconstructedMaterial.ts');
    const { enableSourceSkinning } = await import('/src/rig/SourceMesh.ts');
    const { BodyDecalManager } = await import('/src/rig/BodyDecals.ts');
    const recovered = await loadReconstructedMaterial('/__skin_fixture__/manifest.json');
    const geometry = new T.PlaneGeometry(2, 2), count = geometry.attributes.position.count;
    const attribute = (name, values, type = T.Float32BufferAttribute) =>
      geometry.setAttribute(name, new type(Array.from({ length: count }, () => values).flat(), 4));
    attribute('tangent', [1,0,0,-1]);
    attribute('skinIndex', [0,1,2,3], T.Uint16BufferAttribute);
    attribute('skinIndex1', [4,5,6,7], T.Uint16BufferAttribute);
    attribute('skinWeight', [0,0,0,0]); attribute('skinWeight1', [0,0,0,1]);
    const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial({ side: T.DoubleSide }));
    const bones = Array.from({ length: 8 }, () => new T.Bone());
    const scene = new T.Scene(), group = new T.Group(); scene.add(group); group.add(mesh, ...bones);
    mesh.bind(new T.Skeleton(bones, bones.map(() => new T.Matrix4())), new T.Matrix4());
    mesh.frustumCulled = false;
    const bounds = [11, -7, 22];
    recovered.apply(mesh, undefined, { boundsOrigin: bounds }); enableSourceSkinning(mesh);
    const material = mesh.material, compile = material.onBeforeCompile, mode = { value: 0 };
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer); shader.uniforms.skinFixtureOutput = mode;
      // Record diffuse after the actual surface adapter and decal stack, before lighting.
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>');
    };
    material.toneMapped = false;
    const manager = new BodyDecalManager(new T.TextureLoader(), 'unused'); manager.registerTarget('body', [material]);
    // An odd-sized target puts the inspected pixel on the optical axis. Enough
    // raster resolution keeps subpixel triangle quantization below the tolerance.
    const renderer = new T.WebGLRenderer(); renderer.setSize(257, 257); renderer.outputColorSpace = T.LinearSRGBColorSpace;
    renderer.setClearColor(0, 0);
    const target = new T.WebGLRenderTarget(257, 257, { type: T.FloatType, depthBuffer: false });
    const camera = new T.PerspectiveCamera(40, 1, .01, 100), checks = [];
    const read = () => {
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const data = new Float32Array(4); renderer.readRenderTargetPixels(target, 128, 128, 1, 1, data); return [...data];
    };
    const compare = (name, actual, expected) => {
      const maxError = Math.max(...expected.map((v, i) => Math.abs(v - actual[i])));
      if (!Number.isFinite(maxError) || maxError > 3e-5) throw new Error(`${name}: ${actual} != ${expected} (error ${maxError})`);
      checks.push({ name, maxError, passed: true });
    };
    const sourceAxes = v => [v.x, v.z, v.y];
    for (const pose of [0, 1]) for (const cameraSide of [0, 1]) {
      group.position.set(.2 + pose * .5, 1.3 - pose * .5, -.1 + pose * .4);
      group.rotation.set(pose * .2, pose * .7, pose * -.15);
      bones[7].position.set(.17, -.13, .04); bones[7].rotation.set(pose * .22, pose * -.12, pose * .08);
      scene.updateMatrixWorld(true);
      const centre = bones[7].position.clone().applyMatrix4(group.matrixWorld);
      const normal = new T.Vector3(0,0,1).applyQuaternion(bones[7].quaternion).applyQuaternion(group.quaternion);
      const tangent = new T.Vector3(1,0,0).applyQuaternion(bones[7].quaternion).applyQuaternion(group.quaternion);
      const view = normal.clone().multiplyScalar(3).addScaledVector(tangent, cameraSide * .8);
      camera.position.copy(centre).add(view); camera.lookAt(centre); camera.updateMatrixWorld(true);
      const object = new T.Vector3(bounds[0], bounds[2], bounds[1]).multiplyScalar(.01).applyMatrix4(group.matrixWorld);
      for (const [i, expected] of [sourceAxes(centre), sourceAxes(normal), sourceAxes(tangent), sourceAxes(view), sourceAxes(object), [1,1,1]].entries()) {
        mode.value = i; compare(`frame pose=${pose} camera=${cameraSide} output=${i}`, read(), [...expected, 1]);
      }
    }
    const mask = color => {
      const c = document.createElement('canvas'); c.width = c.height = 4;
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,4,4); return c.toDataURL();
    };
    const black = mask('black'), white = mask('white');
    mode.value = 6;
    for (const [name, hidden, tint] of [
      ['unmasked', false, false], ['covered', true, false], ['covered with paint', true, true],
      ['paint only', false, true], ['paint cleared', false, false],
    ]) {
      manager.setBodyHideMasks([hidden ? white : black]); await manager.whenBodyHidesReady();
      if (tint) await manager.set('bodyPaint', { layers: [{ target: 'body', tint: '#ff0000' }] });
      else manager.clear('bodyPaint');
      compare(name, read(), hidden ? [0,0,0,0] : tint ? [.25/.299,0,0,1] : [.25,.25,.25,1]);
    }
    manager.setBodyHideMasks([]); await manager.whenBodyHidesReady();
    mode.value = 0;
    compare('clearing patches retains eight-weight skin position', read(), [...sourceAxes(bones[7].position.clone().applyMatrix4(group.matrixWorld)), 1]);
    manager.clearAll(); recovered.dispose(); mesh.skeleton.dispose(); geometry.dispose(); material.dispose();
    mesh.customDepthMaterial.dispose(); mesh.customDistanceMaterial.dispose(); target.dispose(); renderer.dispose();
    return checks;
  });
  assert.deepEqual(errors, []);
  mkdirSync('visual-diff/reconstructed/reference-skin-01', { recursive: true });
  writeFileSync('visual-diff/reconstructed/reference-skin-01/skin-adapter-checks.json', JSON.stringify(report, null, 2));
  console.log(`${report.length} GPU skin adapter/coverage/decal cases passed; maximum error ${Math.max(...report.map(c => c.maxError))}`);
} catch (error) { if (errors.length) console.error(errors.join('\n')); throw error; }
finally { await browser.close(); }
