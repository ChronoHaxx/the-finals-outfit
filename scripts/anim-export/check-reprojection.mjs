// GPU checks for the accumulator's High quality (6 Nov 2026): motion vectors and the reprojected moving average, on the
// real pass in headless Edge, as check-temporal-preview.mjs (still path) and check-motion-resolve.mjs (Balanced's
// screen-locked average) do. Balanced numbers are reported next to High's where they make the point.
//
//   TEMPORAL_BASE=http://127.0.0.1:5181 node scripts/anim-export/check-reprojection.mjs   (Git Bash, worktree root)
//   (PowerShell: $env:TEMPORAL_BASE='http://127.0.0.1:5181'; node scripts/anim-export/check-reprojection.mjs)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.TEMPORAL_BASE ?? 'http://127.0.0.1:5181';
const output = process.env.TEMPORAL_OUT ?? 'scripts/generated/anim-export/reprojection-check';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${BASE}/?outfit=1.eyJzbG90cyI6e319`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle);
  const result = await page.evaluate(async () => {
    const T = window.__THREE;
    const { StableFrameAccumulator } = await import('/src/rig/StableFrameAccumulator.ts');
    // The module instance the accumulator uses (see check-motion-resolve.mjs).
    const hashUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => name.includes('/src/rig/AlphaHashSampling.ts')).at(-1) ?? '/src/rig/AlphaHashSampling.ts';
    const { installSampledAlphaHash } = await import(hashUrl);
    const S = 256;
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(S, S); renderer.setClearColor(0, 0); renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const target = new T.WebGLRenderTarget(S, S, { type: T.FloatType, depthBuffer: false });
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 3;
    const checks = [], numbers = {};
    const check = (name, condition, details = {}) => {
      checks.push({ name, passed: !!condition, ...details });
      if (!condition) throw new Error(JSON.stringify(checks.at(-1)));
    };
    const make = quality => { const pass = new StableFrameAccumulator(); pass.quality = quality; return pass; };
    const draw = (pass, scene, moving) => { renderer.setRenderTarget(target); pass.render(renderer, scene, camera, true, moving); };
    const read = (x = 0, y = 0, w = S, h = S) => { const data = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(target, x, y, w, h, data); return data; };
    const meanAlpha = data => { let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i]; return sum / (data.length / 4); };
    const hashed = (opacity, colour = [.7, .2, .05]) => {
      const material = new T.MeshBasicMaterial({ color: new T.Color(...colour), alphaHash: true, opacity });
      material.userData.reconstructed = true;
      material.onBeforeCompile = shader => installSampledAlphaHash(shader, material);
      return material;
    };
    // A 4-texel checker on an opaque card, nearest-sampled: detail a blurry or misplaced history would wash out.
    const checker = (() => {
      const n = 64, data = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = ((x >> 2) + (y >> 2)) & 1 ? 230 : 25; data.set([v, v, v, 255], 4 * (y * n + x)); }
      const texture = new T.DataTexture(data, n, n); texture.magFilter = texture.minFilter = T.NearestFilter; texture.needsUpdate = true;
      return texture;
    })();
    // Mean absolute difference over all four channels, and the converged still frame of a scene as it stands.
    const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const truth = scene => { const pass = make('balanced'); for (let i = 0; i < 40; i++) draw(pass, scene, false); const image = read(); pass.dispose(); return image; };

    // 1. Stacked dithered layers held on the moving path: High converges to independent layers' combined coverage, as the
    //    still path does. (Balanced's screen-locked clamp ratchets them towards full cover; reported, not required.)
    for (const layers of [[.5, .5], [.8, .5], [.3, .3, .3]]) {
      const scene = new T.Scene(), materials = layers.map(a => hashed(a));
      materials.forEach((material, i) => { const mesh = new T.Mesh(new T.PlaneGeometry(2.4, 2.4, 8, 8), material); mesh.position.z = -.1 * i; scene.add(mesh); });
      const expected = 1 - layers.reduce((p, a) => p * (1 - a), 1), row = { layers, expected };
      for (const quality of ['balanced', 'high']) {
        const pass = make(quality);
        for (let i = 0; i < 300; i++) draw(pass, scene, true);
        row[quality] = meanAlpha(read(64, 64, 128, 128));
        pass.dispose();
      }
      (numbers.stacked ??= []).push(row);
      check(`stacked ${layers.join('+')}: High keeps independent coverage`, Math.abs(row.high - expected) < .02, row);
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }

    // 2. An opaque checker card moving 3.3 px per frame: High follows it (sharp, in place); Balanced cannot reuse history.
    {
      const scene = new T.Scene(), material = new T.MeshBasicMaterial({ map: checker }), mesh = new T.Mesh(new T.PlaneGeometry(1.2, 1.2), material);
      scene.add(mesh);
      // An alpha-hashed sliver keeps the accumulator active (it only runs for masked or additive scenes).
      const sliver = new T.Mesh(new T.PlaneGeometry(.05, .05), hashed(.5)); sliver.position.set(-.97, -.97, -.5); scene.add(sliver);
      const row = {};
      for (const quality of ['balanced', 'high']) {
        const pass = make(quality);
        mesh.position.x = -.5;
        for (let i = 0; i < 40; i++) { mesh.position.x += 3.3 * 2 / S; draw(pass, scene, true); }
        const moving = read(), still = truth(scene);
        row[quality] = difference(moving, still);
        if (quality === 'high') check('moving card: motion vectors in use', pass.status.reprojected && pass.status.velocityRenders === 40, { status: { ...pass.status } });
        pass.dispose();
      }
      numbers.movingCard = row;
      check('moving card: High matches the converged frame of where it is', row.high < .02, row);
      check('moving card: High beats screen-locked Balanced by 2x', row.high < row.balanced / 2, row);
      geometryDispose(scene);
    }

    // 3. No ghost: an opaque card crossing at 4 px per frame leaves nothing behind it (background stays clear).
    {
      const scene = new T.Scene(), mesh = new T.Mesh(new T.PlaneGeometry(.5, 1.2), hashed(1));
      scene.add(mesh);
      const pass = make('high');
      mesh.position.x = -.6;
      for (let i = 0; i < 20; i++) { mesh.position.x += 4 * 2 / S; draw(pass, scene, true); }
      const row = read(0, S / 2, S, 1), left = Math.round((mesh.position.x - .25 + 1) / 2 * S);
      let behind = 0; for (let c = 0; c < left - 1; c++) behind = Math.max(behind, row[4 * c + 3]);
      check('crossing card leaves no ghost behind it', behind < .05, { behind, left });
      pass.dispose(); geometryDispose(scene);
    }

    // 4. A skinned card turned by its parent (three's attached bind mode: bindMatrixInverse follows the mesh's world
    //    matrix, so motion vectors must pair last frame's matrices): High keeps it in place while it turns.
    {
      const scene = new T.Scene(), parent = new T.Group(); scene.add(parent);
      const geometry = new T.PlaneGeometry(1.2, 1.2, 4, 4), count = geometry.attributes.position.count;
      geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
      geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
      const bone = new T.Bone(), mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial({ map: checker }));
      mesh.add(bone); mesh.bind(new T.Skeleton([bone])); parent.add(mesh);
      const sliver = new T.Mesh(new T.PlaneGeometry(.05, .05), hashed(.5)); sliver.position.set(-.97, -.97, -.5); scene.add(sliver);
      const row = {};
      for (const quality of ['balanced', 'high']) {
        const pass = make(quality);
        parent.rotation.z = 0;
        for (let i = 0; i < 40; i++) { parent.rotation.z += .02; draw(pass, scene, true); }
        row[quality] = difference(read(), truth(scene));
        pass.dispose();
      }
      numbers.turningSkinned = row;
      mesh.skeleton.dispose(); // its bone texture is the fixture's, not the pass's
      check('turning skinned card: High matches the converged frame', row.high < .025, row);
      check('turning skinned card: High beats Balanced', row.high < row.balanced * .6, row);
      geometryDispose(scene);
    }

    // 5. Hand-over to the still view: no jump on the first still frame, and the converged frame is exactly Balanced's.
    {
      const scene = new T.Scene(); scene.add(new T.Mesh(new T.PlaneGeometry(2.4, 2.4, 8, 8), hashed(.5)), new T.Mesh(new T.PlaneGeometry(1, 1), hashed(.7, [.1, .6, .9])));
      const row = {};
      truth(scene); const fixtureTextures = renderer.info.memory.textures; // the caller's target, uploaded fixtures
      for (const quality of ['balanced', 'high']) {
        const pass = make(quality);
        for (let i = 0; i < 60; i++) draw(pass, scene, true);
        const last = read(); draw(pass, scene, false); const first = read();
        row[quality] = difference(last, first);
        if (quality === 'high') {
          check('High crossfades from the motion average', pass.status.fading && pass.status.samples === 1, { status: { ...pass.status } });
          for (let i = 0; i < 40; i++) draw(pass, scene, false);
          const converged = read(), expected = truth(scene);
          let worst = 0; for (let i = 0; i < converged.length; i++) worst = Math.max(worst, Math.abs(converged[i] - expected[i]));
          check('High converges to exactly the still frame', worst < 1e-4 && !pass.status.fading && pass.status.samples === pass.status.maxSamples, { worst });
          check('High releases the motion average and velocity targets once converged',
            renderer.info.memory.textures === fixtureTextures + 2 && pass.status.targetBytes === S * S * 20,
            { textures: renderer.info.memory.textures, fixtureTextures, bytes: pass.status.targetBytes });
        }
        pass.dispose();
      }
      numbers.handOver = row;
      check('first still frame after motion: High jumps at most a third as much as Balanced', row.high < row.balanced / 3, row);
      geometryDispose(scene);
    }

    // 6. What reprojects and what restarts, in a still pose.
    {
      const scene = new T.Scene(), material = hashed(.5), mesh = new T.Mesh(new T.PlaneGeometry(1.6, 1.6), material); scene.add(mesh);
      truth(scene); const fixtureTextures = renderer.info.memory.textures;
      const pass = make('high');
      for (let i = 0; i < 40; i++) draw(pass, scene, false);
      camera.position.x += .02; draw(pass, scene, false);
      check('a camera move in a still pose reprojects', pass.status.motion && pass.status.reprojected && pass.status.reason === 'reprojected', { status: { ...pass.status } });
      for (let i = 0; i < 3; i++) draw(pass, scene, false);
      check('quiet frames keep the reprojected average briefly', pass.status.motion, { status: { ...pass.status } });
      draw(pass, scene, false);
      check('then the still view takes over with a crossfade', !pass.status.motion && pass.status.fading, { status: { ...pass.status } });
      for (let i = 0; i < 40; i++) draw(pass, scene, false);
      material.color.setRGB(.1, .8, .3); draw(pass, scene, false);
      check('a material change restarts from a fresh frame', !pass.status.motion && !pass.status.fading && pass.status.samples === 1 && pass.status.reason === 'material',
        { status: { ...pass.status } });
      camera.position.x -= .02;
      // Quality switches rebuild the targets without leaking any.
      pass.quality = 'balanced'; draw(pass, scene, true); pass.quality = 'high'; draw(pass, scene, true); pass.quality = 'balanced'; draw(pass, scene, false);
      for (let i = 0; i < 40; i++) draw(pass, scene, false);
      pass.quality = 'high'; draw(pass, scene, false); // still to still: only the quality changed
      check('quality switches restart cleanly', pass.status.reason === 'quality' && pass.status.samples === 1 && renderer.info.memory.textures === fixtureTextures + 2,
        { reason: pass.status.reason, textures: renderer.info.memory.textures, fixtureTextures });
      pass.dispose(); geometryDispose(scene);
    }
    function geometryDispose(scene) { scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    checker.dispose(); target.dispose();
    check('all fixture and pass textures released', renderer.info.memory.textures === 0, { textures: renderer.info.memory.textures });
    renderer.dispose(); renderer.forceContextLoss();
    return { checks, numbers };
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/reprojection-gpu.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify(result.numbers));
  console.log(`${result.checks.length} reprojection checks pass`);
} finally {
  await browser.close();
}
