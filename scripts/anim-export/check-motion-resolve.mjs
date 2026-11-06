// GPU checks for the still-view accumulator's motion mode (showcase animation, 5 Nov 2026), on the real pass in headless
// Edge, the way scripts/shader-probe/check-temporal-preview.mjs checks the still path. Fixtures: an alpha-hashed plane
// drifting about 0.06 px per frame (an idle's pace), and an opaque hashed card moving 4 px per frame (an emote's).
//
//   TEMPORAL_BASE=http://127.0.0.1:5181 node scripts/anim-export/check-motion-resolve.mjs   (Git Bash, worktree root)
//   (PowerShell: $env:TEMPORAL_BASE='http://127.0.0.1:5181'; node scripts/anim-export/check-motion-resolve.mjs)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.TEMPORAL_BASE ?? 'http://127.0.0.1:5181';
const output = process.env.TEMPORAL_OUT ?? 'scripts/generated/anim-export/motion-check';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${BASE}/?outfit=1.eyJzbG90cyI6e319`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle);
  if (process.env.SWEEP) await page.evaluate(sweep => { globalThis.SWEEP = sweep; }, JSON.parse(process.env.SWEEP));
  const result = await page.evaluate(async () => {
    const T = window.__THREE;
    const { StableFrameAccumulator } = await import('/src/rig/StableFrameAccumulator.ts');
    // The same module instance the accumulator uses: after an edit Vite serves it as AlphaHashSampling.ts?t=..., and a
    // plain import would load a second copy whose motion-frame uniform the accumulator never sets.
    const hashUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => name.includes('/src/rig/AlphaHashSampling.ts')).at(-1) ?? '/src/rig/AlphaHashSampling.ts';
    const { installSampledAlphaHash } = await import(hashUrl);
    const S = 256;
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(S, S); renderer.setClearColor(0, 0); renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const target = new T.WebGLRenderTarget(S, S, { type: T.FloatType, depthBuffer: false });
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 3;
    const material = new T.MeshBasicMaterial({ color: new T.Color(.7, .2, .05), alphaHash: true, opacity: .5 });
    material.userData.reconstructed = true;
    // As every reconstructed hashed material: the sampled threshold (still strata, motion-frame pattern).
    material.onBeforeCompile = shader => installSampledAlphaHash(shader, material);
    const geometry = new T.PlaneGeometry(2.4, 2.4), mesh = new T.Mesh(geometry, material);
    scene.add(mesh);
    const checks = [];
    const check = (name, condition, details = {}) => {
      checks.push({ name, passed: !!condition, ...details });
      if (!condition) throw new Error(JSON.stringify(checks.at(-1)));
    };
    const draw = (pass, moving) => { renderer.setRenderTarget(target); pass.render(renderer, scene, camera, true, moving); };
    const read = (x = 64, y = 64, w = 128, h = 128) => {
      const data = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(target, x, y, w, h, data); return data;
    };
    const alphaStats = data => {
      let mean = 0, square = 0;
      for (let i = 3; i < data.length; i += 4) { mean += data[i]; square += data[i] ** 2; }
      const n = data.length / 4; mean /= n;
      return { mean, variance: square / n - mean ** 2 };
    };
    const flicker = (a, b) => { let sum = 0; for (let i = 3; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]); return sum / (a.length / 4); };

    // 1. Slow drift: grain (spatial variance), bias, and frame-to-frame flicker, motion mode vs one raw sample per frame.
    const drift = [];
    for (const opacity of (globalThis.SWEEP ?? [.1, .15, .3, .5, .8, .95])) {
      material.opacity = opacity;
      const run = moving => {
        const pass = new StableFrameAccumulator();
        mesh.position.x = 0;
        const frames = [];
        for (let i = 0; i < 64; i++) { mesh.position.x += .0005; draw(pass, moving); if (i >= 60) frames.push(read()); }
        const out = { ...alphaStats(frames.at(-1)), flicker: (flicker(frames[0], frames[1]) + flicker(frames[1], frames[2]) + flicker(frames[2], frames[3])) / 3,
          status: { motion: pass.status.motion, motionFrames: pass.status.motionFrames, samples: pass.status.samples } };
        pass.dispose();
        return out;
      };
      const raw = run(false), motion = run(true);
      drift.push({ opacity, raw, motion });
      check(`drift ${opacity}: motion mode runs`, motion.status.motion && motion.status.motionFrames === 64 && motion.status.samples === 0, motion.status);
      check(`drift ${opacity}: raw path resets every frame`, !raw.status.motion && raw.status.samples === 1, raw.status);
      // Exact between 1/9 and 8/9 (each 3x3 window holds one threshold per ninth); outside, a surface thins or firms
      // a little but never vanishes or fills solid.
      if (!globalThis.SWEEP && opacity >= 1 / 9 && opacity <= 8 / 9) check(`drift ${opacity}: unbiased coverage`, Math.abs(motion.mean - opacity) < .01, { measured: motion.mean });
      if (!globalThis.SWEEP && opacity < 1 / 9) check(`drift ${opacity}: faint surface thins but stays`, motion.mean > opacity * .3 && motion.mean <= opacity + .01, { measured: motion.mean });
      if (!globalThis.SWEEP && opacity > 8 / 9) check(`drift ${opacity}: near-solid surface firms but keeps holes`, motion.mean >= opacity - .01 && motion.mean < 1, { measured: motion.mean });
      if (!globalThis.SWEEP) check(`drift ${opacity}: grain at most a quarter of one raw sample's`, motion.variance < raw.variance * .25, { raw: raw.variance, motion: motion.variance });
      if (!globalThis.SWEEP) check(`drift ${opacity}: flicker at most a quarter of raw`, motion.flicker < raw.flicker * .25, { raw: raw.flicker, motion: motion.flicker });
    }

    // 2. Fast motion: an opaque card moving 4 px per frame must not leave a trail behind it.
    material.opacity = 1;
    const card = new T.PlaneGeometry(.5, 1.2); mesh.geometry = card;
    const fast = new StableFrameAccumulator();
    mesh.position.x = -.6;
    for (let i = 0; i < 20; i++) { mesh.position.x += 4 * 2 / S; draw(fast, true); }
    const row = read(0, S / 2, S, 1);
    // Card spans [x-.25, x+.25] in world; columns from world -1..1.
    const toColumn = w => Math.round((w + 1) / 2 * S);
    const left = toColumn(mesh.position.x - .25), right = toColumn(mesh.position.x + .25);
    let trail = 0, behind = 0;
    for (let c = 0; c < left - 1; c++) { const a = row[4 * c + 3]; behind = Math.max(behind, a); if (a > .05) trail++; }
    let inside = 1; for (let c = left + 1; c < right - 1; c++) inside = Math.min(inside, row[4 * c + 3]);
    check('fast card leaves no trail (behind it < 0.05 alpha)', behind < .05, { behind, trail, left, right });
    check('fast card itself stays solid', inside > .95, { inside });

    fast.dispose();
    // 2b. Slow motion: an opaque card drifting 0.5 px per frame (a swaying arm) must not smear more than about a pixel.
    const slow = new StableFrameAccumulator();
    mesh.position.x = -.6;
    for (let i = 0; i < 40; i++) { mesh.position.x += .5 * 2 / S; draw(slow, true); }
    const slowRow = read(0, S / 2, S, 1);
    const slowLeft = toColumn(mesh.position.x - .25);
    let smear = 0; for (let c = 0; c < slowLeft - 1; c++) if (slowRow[4 * c + 3] > .05) smear++;
    check('slow card smears at most one pixel behind its edge', smear <= 1, { smear, edge: slowLeft });
    slow.dispose();
    // 3. Back to still: the still path starts fresh (pixel-identical to a new pass's first frame) and drops the third target.
    mesh.geometry = geometry; material.opacity = .5; mesh.position.x = 0;
    const pass = new StableFrameAccumulator();
    for (let i = 0; i < 10; i++) draw(pass, true);
    const texturesWhileMoving = renderer.info.memory.textures;
    draw(pass, false);
    check('motion end restarts the still history', !pass.status.motion && pass.status.samples === 1 && pass.status.reason === 'motion ended', { status: { ...pass.status } });
    const actual = read(), fresh = new StableFrameAccumulator();
    renderer.setRenderTarget(target); fresh.render(renderer, scene, camera);
    const expected = read(); let error = 0;
    for (let i = 0; i < expected.length; i++) error = Math.max(error, Math.abs(actual[i] - expected[i]));
    fresh.dispose();
    check('first still frame after motion has no motion contribution', error < 1e-6, { maxError: error });
    check('motion uses one extra target and still mode releases it', texturesWhileMoving === 4 && renderer.info.memory.textures === 3,
      { whileMoving: texturesWhileMoving, after: renderer.info.memory.textures });
    // 4. An explicit invalidation (size, custom uniforms) restarts the motion average.
    for (let i = 0; i < 5; i++) draw(pass, true);
    const before = pass.status.motionFrames; pass.invalidate('custom uniform'); draw(pass, true);
    check('explicit invalidation restarts the motion average', before === 5 && pass.status.motionFrames === 1 && pass.status.reason === 'custom uniform',
      { before, after: pass.status.motionFrames, reason: pass.status.reason });
    pass.dispose(); target.dispose(); geometry.dispose(); card.dispose(); material.dispose();
    check('all fixture and pass textures released', renderer.info.memory.textures === 0, { textures: renderer.info.memory.textures });
    renderer.dispose(); renderer.forceContextLoss();
    return { checks, drift };
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/motion-gpu.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(`${result.checks.length} motion-mode checks pass`);
  for (const d of result.drift) console.log(`opacity ${d.opacity}: variance raw ${d.raw.variance.toFixed(4)} -> motion ${d.motion.variance.toFixed(4)}; flicker raw ${d.raw.flicker.toFixed(4)} -> motion ${d.motion.flicker.toFixed(4)}; mean ${d.motion.mean.toFixed(3)}`);
} catch (error) { console.error(errors.map(message => message.slice(0, 1800))); throw error; }
finally { await browser.close(); }
