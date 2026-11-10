// Scratch GPU probe (6 Nov): combined coverage of stacked alpha-hashed planes, still path vs motion path (held still),
// against independent layers' 1 - prod(1 - a). Balanced and High.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:5181/?outfit=1.eyJzbG90cyI6e319`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__rigIdle);
const result = await page.evaluate(async () => {
  const T = window.__THREE;
  const { StableFrameAccumulator } = await import('/src/rig/StableFrameAccumulator.ts');
  const hashUrl = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/rig/AlphaHashSampling.ts')).at(-1) ?? '/src/rig/AlphaHashSampling.ts';
  const { installSampledAlphaHash } = await import(hashUrl);
  const S = 256;
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: false });
  renderer.setSize(S, S); renderer.setClearColor(0, 0); renderer.outputColorSpace = T.LinearSRGBColorSpace;
  const target = new T.WebGLRenderTarget(S, S, { type: T.FloatType, depthBuffer: false });
  const out = [];
  for (const layers of [[.5, .5], [.3, .3, .3], [.8, .5], [.15, .15, .15, .15]]) {
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 3;
    layers.forEach((opacity, i) => {
      const material = new T.MeshBasicMaterial({ color: new T.Color(.7, .2, .05), alphaHash: true, opacity });
      material.userData.reconstructed = true; material.onBeforeCompile = shader => installSampledAlphaHash(shader, material);
      const mesh = new T.Mesh(new T.PlaneGeometry(2.4, 2.4, 8, 8), material); mesh.position.z = -i * .1; scene.add(mesh);
    });
    const expected = 1 - layers.reduce((p, a) => p * (1 - a), 1);
    const row = { layers, expected };
    for (const [label, quality, moving, frames] of [['still', 'balanced', false, 40], ['motion-balanced', 'balanced', true, 300], ['motion-high', 'high', true, 300]]) {
      const pass = new StableFrameAccumulator(); pass.quality = quality;
      for (let i = 0; i < frames; i++) { renderer.setRenderTarget(target); pass.render(renderer, scene, camera, true, moving); }
      const data = new Float32Array(128 * 128 * 4); renderer.readRenderTargetPixels(target, 64, 64, 128, 128, data);
      let mean = 0, sq = 0; for (let i = 3; i < data.length; i += 4) { mean += data[i]; sq += data[i] ** 2; }
      const n = data.length / 4; mean /= n;
      row[label] = { mean: +mean.toFixed(4), sd: +Math.sqrt(sq / n - mean * mean).toFixed(4) };
      pass.dispose();
    }
    out.push(row);
  }
  return out;
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
