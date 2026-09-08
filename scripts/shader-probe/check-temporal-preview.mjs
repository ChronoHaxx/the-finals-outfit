// GPU coverage statistics, display transforms, and stale-history rejection using
// the actual preview pass. This does not test or claim native engine TAA parity.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output = 'visual-diff/reconstructed/reference-temporal-01';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173/?outfit=1.eyJzbG90cyI6e319', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle);
  const result = await page.evaluate(async () => {
    const T = window.__THREE;
    const { StableFrameAccumulator } = await import('/src/rig/StableFrameAccumulator.ts');
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(256, 256); renderer.setClearColor(0, 0); renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const target = new T.WebGLRenderTarget(256, 256, { type: T.FloatType, depthBuffer: false });
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 3;
    const material = new T.MeshBasicMaterial({ color: new T.Color(.7, .2, .05), alphaHash: true, opacity: .5 });
    material.userData.reconstructed = true;
    const geometry = new T.PlaneGeometry(2.4, 2.4), mesh = new T.Mesh(geometry, material);
    scene.add(mesh);
    const pass = new StableFrameAccumulator(), checks = [], coverage = [];
    const check = (name, condition, details = {}) => {
      checks.push({ name, passed: !!condition, ...details });
      if (!condition) throw new Error(JSON.stringify(checks.at(-1)));
    };
    const draw = () => { renderer.setRenderTarget(target); pass.render(renderer, scene, camera); };
    const pixels = () => {
      const data = new Float32Array(128 * 128 * 4);
      renderer.readRenderTargetPixels(target, 64, 64, 128, 128, data); return data;
    };
    const stats = data => {
      let mean = 0, square = 0, premultiplyError = 0;
      for (let i = 0; i < data.length; i += 4) {
        mean += data[i + 3]; square += data[i + 3] ** 2;
        premultiplyError = Math.max(premultiplyError, Math.abs(data[i] - .7 * data[i + 3]), Math.abs(data[i + 1] - .2 * data[i + 3]));
      }
      mean /= data.length / 4;
      return { mean, variance: square / (data.length / 4) - mean ** 2, premultiplyError };
    };
    const finish = () => {
      for (let i = 0; i < pass.status.maxSamples + 2; i++) draw();
      check('converges to bounded sample count', pass.status.samples === pass.status.maxSamples, { samples: pass.status.samples });
    };
    for (const opacity of [0, .15, .5, .9, 1]) {
      material.opacity = opacity; draw(); const first = stats(pixels());
      finish(); const averaged = stats(pixels());
      coverage.push({ opacity, first, averaged, varianceReduction: first.variance ? 1 - averaged.variance / first.variance : 0 });
      check(`coverage ${opacity} is unbiased`, Math.abs(averaged.mean - opacity) < .012, { measured: averaged.mean });
      check(`coverage ${opacity} keeps premultiplied colour`, averaged.premultiplyError < .006, { error: averaged.premultiplyError });
      if (opacity > 0 && opacity < 1) check(`coverage ${opacity} reduces grain`, averaged.variance < first.variance * .12, { first: first.variance, averaged: averaged.variance });
    }
    const rendered = pass.status.sceneRenders;
    for (let i = 0; i < 8; i++) draw();
    check('converged history stops scene draws', pass.status.sceneRenders === rendered);
    const memory = renderer.info.memory.textures;
    check('exactly two accumulation targets', memory === 3, { textures: memory }); // includes caller output

    // Independent expected coverage/compositing for two separated card layers.
    const backMaterial = new T.MeshBasicMaterial({ color: new T.Color(.05, .4, .7), alphaHash: true, opacity: .6 });
    // Hashing is defined in authored geometry coordinates. Preserve the different
    // card positions there, as the source hair mesh does (not identical instances).
    const backGeometry = geometry.clone().translate(0, 0, -.25);
    const back = new T.Mesh(backGeometry, backMaterial); scene.add(back);
    material.opacity = .4; finish();
    const layeredPixels = pixels(), layeredMean = [0, 0, 0, 0];
    for (let i = 0; i < layeredPixels.length; i += 4) for (let c = 0; c < 4; c++) layeredMean[c] += layeredPixels[i + c] / (layeredPixels.length / 4);
    const layeredExpected = [.7 * .4 + .05 * .36, .2 * .4 + .4 * .36, .05 * .4 + .7 * .36, .4 + .36];
    const layeredError = Math.max(...layeredMean.map((v, i) => Math.abs(v - layeredExpected[i])));
    check('overlapping cards preserve independent coverage and colour', layeredError < .015, { expected: layeredExpected, actual: layeredMean, maxError: layeredError });
    scene.remove(back); backMaterial.dispose(); backGeometry.dispose();
    material.opacity = 1; mesh.scale.set(.5, .8, 1); finish();
    const edgePixels = new Float32Array(256 * 4); renderer.readRenderTargetPixels(target, 0, 128, 256, 1, edgePixels);
    let partialEdgePixels = 0;
    for (let i = 0; i < 256; i++) if (edgePixels[4 * i + 3] > .001 && edgePixels[4 * i + 3] < .999) partialEdgePixels++;
    check('opaque silhouette remains sharp within two pixels per edge', partialEdgePixels > 0 && partialEdgePixels <= 4, { partialEdgePixels });
    mesh.scale.set(1, 1, 1);

    // Display transforms must run once on covered colour, not on coverage-scaled
    // RGB. Compare partially covered pixels with the same fully covered HDR colour.
    const display = [];
    material.color.setRGB(2.8, .4, .07);
    for (const tone of [T.NoToneMapping, T.NeutralToneMapping, T.ACESFilmicToneMapping]) {
      for (const colorSpace of [T.LinearSRGBColorSpace, T.SRGBColorSpace]) {
        renderer.toneMapping = tone; renderer.toneMappingExposure = 1.2; renderer.outputColorSpace = colorSpace;
        material.opacity = 1; draw(); const solid = pixels().slice(0, 3);
        material.opacity = .5; finish(); const data = pixels(); let maxError = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > .01) for (let c = 0; c < 3; c++)
          maxError = Math.max(maxError, Math.abs(data[i + c] / data[i + 3] - solid[c]));
        display.push({ tone, colorSpace, maxError });
        check('HDR coverage edges retain display colour', maxError < .008, { tone, colorSpace, maxError });
      }
    }
    renderer.toneMapping = T.NoToneMapping; renderer.outputColorSpace = T.LinearSRGBColorSpace;
    material.color.setRGB(.7, .2, .05); material.opacity = .5; finish();

    // History after a change must equal a brand-new first render, pixel for pixel.
    const rejection = (name, change) => {
      finish(); const resets = pass.status.resets;
      change(); draw();
      check(`${name} invalidates history immediately`, pass.status.resets > resets && pass.status.samples === 1, { reason: pass.status.reason });
      const actual = pixels(), fresh = new StableFrameAccumulator();
      renderer.setRenderTarget(target); fresh.render(renderer, scene, camera);
      const expected = pixels(); let error = 0;
      for (let i = 0; i < expected.length; i++) error = Math.max(error, Math.abs(actual[i] - expected[i]));
      fresh.dispose();
      check(`${name} leaves no previous-frame contribution`, error < 1e-6, { maxError: error });
    };
    rejection('object motion', () => { mesh.position.x += .14; });
    rejection('camera motion', () => { camera.position.x += .15; });
    rejection('camera projection', () => { camera.zoom = 1.1; camera.updateProjectionMatrix(); });
    finish();
    const subpixelImage = pixels(), subpixelResets = pass.status.resets;
    camera.position.x += .0001; draw();
    check('subpixel control tail retains the sampling camera', pass.status.resets === subpixelResets && pass.status.samples === 32);
    const subpixelActual = pixels(); let subpixelError = 0;
    for (let i = 0; i < subpixelImage.length; i++) subpixelError = Math.max(subpixelError, Math.abs(subpixelImage[i] - subpixelActual[i]));
    check('subpixel damping reuses identical sharp pixels', subpixelError === 0, { maxError: subpixelError });
    for (let i = 0; i < 20; i++) { camera.position.x += .0001; draw(); }
    check('slow cumulative camera motion cannot retain stale history', pass.status.resets > subpixelResets);
    rejection('material colour', () => { material.color.setRGB(.1, .8, .3); });
    rejection('coverage', () => { material.opacity = .25; });
    const texture = new T.DataTexture(new Uint8Array([255, 180, 200, 255]), 1, 1); texture.needsUpdate = true;
    rejection('texture binding', () => { material.map = texture; material.needsUpdate = true; });
    rejection('texture pixels', () => { texture.image.data[0] = 60; texture.needsUpdate = true; });
    rejection('texture transform', () => { texture.offset.x = .2; });
    rejection('vertex buffer', () => { geometry.attributes.position.setX(0, -.6); geometry.attributes.position.needsUpdate = true; });
    const light = new T.HemisphereLight(0xffffff, 0x333333, .2); scene.add(light);
    rejection('light colour', () => { light.color.set(0xff0000); });
    rejection('light intensity', () => { light.intensity = .9; });
    rejection('background', () => { scene.background = new T.Color(.2, .3, .4); });
    rejection('display exposure', () => { renderer.toneMappingExposure = .7; });
    rejection('explicit custom shader invalidation', () => { pass.invalidate('custom uniform'); });

    const parent = new T.Group(); scene.add(parent); parent.add(mesh); finish();
    parent.visible = false; draw();
    check('hidden parent bypasses and releases history', !pass.status.active && renderer.info.memory.textures === 2); // output + data map
    parent.visible = true; draw(); check('visible again starts fresh', pass.status.active && pass.status.samples === 1);
    pass.render(renderer, scene, camera, false); check('explicit bypass releases targets', !pass.status.active && pass.status.samples === 0);

    geometry.morphAttributes.position = [geometry.attributes.position.clone()];
    geometry.morphAttributes.position[0].setX(1, .7); mesh.updateMorphTargets(); material.needsUpdate = true;
    rejection('morph deformation', () => { mesh.morphTargetInfluences[0] = .7; });
    const skinGeometry = new T.PlaneGeometry(2, 2);
    skinGeometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(Array(4).fill([0, 0, 0, 0]).flat(), 4));
    skinGeometry.setAttribute('skinWeight', new T.Float32BufferAttribute(Array(4).fill([1, 0, 0, 0]).flat(), 4));
    const skinned = new T.SkinnedMesh(skinGeometry, material), bone = new T.Bone();
    scene.add(skinned, bone); parent.remove(mesh); skinned.bind(new T.Skeleton([bone]));
    rejection('bone deformation', () => { bone.rotation.z = .2; });

    renderer.setSize(320, 192); target.setSize(320, 192); draw();
    check('resize replaces both targets at physical resolution', pass.status.width === 320 && pass.status.height === 192 && pass.status.samples === 1);
    const unchangedTextures = renderer.info.memory.textures;
    for (let i = 0; i < 3; i++) { target.setSize(256 + 8 * i, 256); renderer.setSize(256 + 8 * i, 256); draw(); }
    check('resizes do not leak target textures', renderer.info.memory.textures === unchangedTextures);

    camera.setViewOffset(800, 600, 80, 120, 300, 280);
    camera.updateMatrixWorld(true);
    const cameraState = () => JSON.stringify({ view: camera.view, projection: camera.projectionMatrix.elements, inverse: camera.projectionMatrixInverse.elements, zoom: camera.zoom,
      world: camera.matrixWorld.elements, worldInverse: camera.matrixWorldInverse.elements, autoUpdate: camera.matrixWorldAutoUpdate, needsUpdate: camera.matrixWorldNeedsUpdate });
    const savedCamera = cameraState();
    renderer.setClearColor(0x123456, .27); renderer.autoClear = true;
    renderer.setViewport(0, 0, 256, 256); renderer.setScissor(5, 6, 180, 190); renderer.setScissorTest(true);
    const rendererState = () => JSON.stringify({ clear: renderer.getClearColor(new T.Color()).toArray(), alpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear, viewport: renderer.getViewport(new T.Vector4()).toArray(), scissor: renderer.getScissor(new T.Vector4()).toArray(), scissorTest: renderer.getScissorTest() });
    const savedRenderer = rendererState(); draw(); draw();
    check('jitter restores existing camera view and matrices', cameraState() === savedCamera);
    check('pass restores renderer state and target', rendererState() === savedRenderer && renderer.getRenderTarget() === target);
    skinned.onBeforeRender = () => { throw new Error('intentional interrupted sample'); }; pass.invalidate();
    let interrupted = false; try { draw(); } catch { interrupted = true; }
    check('interrupted draw restores camera and renderer', interrupted && cameraState() === savedCamera && rendererState() === savedRenderer && renderer.getRenderTarget() === target);
    skinned.onBeforeRender = () => {}; draw(); check('interrupted history is discarded', pass.status.samples === 1);

    pass.dispose(); texture.dispose(); target.dispose(); geometry.dispose(); skinGeometry.dispose(); material.dispose(); skinned.skeleton.dispose();
    check('all fixture and pass textures released', renderer.info.memory.textures === 0, { textures: renderer.info.memory.textures });
    renderer.dispose(); renderer.forceContextLoss();
    return { checks, coverage, display, layered: { expected: layeredExpected, actual: layeredMean, maxError: layeredError }, partialEdgePixels };
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/temporal-gpu.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(`${result.checks.length} temporal coverage, colour, invalidation and lifecycle checks pass`);
  console.log(JSON.stringify(result.coverage));
} catch (error) { console.error(errors.map(message => message.slice(0, 1800))); throw error; }
finally { await browser.close(); }
