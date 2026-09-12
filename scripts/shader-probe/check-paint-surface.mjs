// Independent GPU acceptance of the body-paint surface compositor. Synthetic pixels isolate
// coverage, B/A packing, UV wrapping/bounds and both actual Three shader integration paths.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const out = 'scripts/generated/shader-probe/paint-surface-v1';
fs.mkdirSync(out, { recursive: true });
const png = async pixels => 'data:image/png;base64,' + (await sharp(Buffer.from(pixels), {
  raw: { width: pixels.length / 4, height: 1, channels: 4 },
}).png().toBuffer()).toString('base64');
const fixtures = {
  color: await png([80, 180, 80, 0, 80, 180, 80, 128, 80, 180, 80, 255]),
  opaque: await png([80, 180, 80, 255]),
  surface: await png([13, 17, 64, 192]),
  // Most source paint pixels have A=0. Their roughness B must not disappear during decoding.
  nonmetal: await png([128, 127, 139, 0]),
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let report;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  report = await page.evaluate(async fixtures => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { BodyDecalManager } = await import('/src/rig/BodyDecals.ts');
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(4, 1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const rows = [];
    for (const reconstructed of [false, true]) {
      for (const mode of ['packed', 'colour-disabled', 'surface-disabled', 'legacy', 'no-surface', 'nonmetal', 'bounds']) {
        const width = mode === 'bounds' ? 4 : 3;
        const rt = new THREE.WebGLRenderTarget(width, 1);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.4 });
        mat.userData.reconstructed = reconstructed;
        let baseCalls = 0;
        mat.onBeforeCompile = shader => {
          baseCalls++;
          if (reconstructed) {
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <map_fragment>',
                'struct ProbeSurface { float roughness; float metalness; };\n' +
                'ProbeSurface recovered = ProbeSurface(0.2, 0.4);\n// recovered_surface_ready')
              .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = recovered.roughness;')
              .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = recovered.metalness;');
          }
          // Read the factors actually consumed by the lighting shader; omit display conversion.
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(roughnessFactor, metalnessFactor, 0.0, 1.0);')
            .replace('#include <tonemapping_fragment>', '')
            .replace('#include <colorspace_fragment>', '')
            .replace('#include <fog_fragment>', '')
            .replace('#include <premultiplied_alpha_fragment>', '')
            .replace('#include <dithering_fragment>', '');
        };
        const geometry = new THREE.PlaneGeometry(2, 2);
        const uv = geometry.getAttribute('uv');
        const uv1 = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) {
          uv1[2 * i] = mode === 'bounds' ? uv.getX(i) * 4 - 1 : uv.getX(i) * 2;
          uv1[2 * i + 1] = uv.getY(i) + 1;
        }
        geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
        const mesh = new THREE.Mesh(geometry, mat);
        scene.add(mesh);
        const loader = new THREE.TextureLoader();
        const decals = new BodyDecalManager(loader, 'unused-nail-mask');
        decals.registerTarget('body', [mat]);
        await decals.set('bodyPaint', { layers: [{
          target: 'body', colorUrl: ['bounds', 'nonmetal'].includes(mode) ? fixtures.opaque : fixtures.color,
          surfaceUrl: mode === 'no-surface' ? undefined : mode === 'nonmetal' ? fixtures.nonmetal : fixtures.surface,
          surfaceOverride: mode === 'surface-disabled' ? 0 : 1,
          colorOverride: mode === 'colour-disabled' ? 0 : 1,
          uv: 1, uvScale: [0.5, 1], uvLayout: mode === 'legacy' ? undefined : 'sourceBodyPaint',
        }] });
        const pixels = () => {
          renderer.setRenderTarget(rt);
          renderer.render(scene, camera);
          const bytes = new Uint8Array(width * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, width, 1, bytes);
          return [...bytes];
        };
        const applied = pixels();
        decals.clear('bodyPaint');
        const cleared = pixels();
        rows.push({ reconstructed, mode, applied, cleared, baseCalls });
        decals.clearAll();
        scene.remove(mesh);
        geometry.dispose(); mat.dispose(); rt.dispose();
      }
    }
    renderer.dispose();
    return { rows };
  }, fixtures);
  report.errors = errors;
  for (const row of report.rows) {
    const disabled = ['surface-disabled', 'legacy', 'no-surface'].includes(row.mode);
    const weights = row.mode === 'bounds' ? [0, 1, 1, 0] : row.mode === 'nonmetal' ? [1, 1, 1] : [0, 128 / 255, 1];
    const rough = row.mode === 'nonmetal' ? 139 : 64, metal = row.mode === 'nonmetal' ? 0 : 192;
    for (let i = 0; i < weights.length; i++) {
      const w = disabled ? 0 : weights[i];
      const expected = [51 * (1 - w) + rough * w, 102 * (1 - w) + metal * w, 0, 255];
      for (let c = 0; c < 4; c++) {
        assert(Math.abs(row.applied[i * 4 + c] - expected[c]) <= 1,
          `${row.reconstructed ? 'reconstructed' : 'standard'} ${row.mode} pixel ${i} channel ${c}: ${row.applied[i * 4 + c]} vs ${expected[c]}`);
        assert(Math.abs(row.cleared[i * 4 + c] - [51, 102, 0, 255][c]) <= 1, `${row.mode}: clear changed the base finish`);
      }
    }
    assert(row.baseCalls >= 1, 'base shader callback was bypassed');
  }
  assert.deepEqual(errors, [], 'browser or shader errors');
  report.passed = true;
} finally {
  if (report) fs.writeFileSync(`${out}/synthetic-gpu-checks.json`, JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2) + '\n');
  await browser.close();
}
console.log(`OK: ${report.rows.length} GPU cases, B/A data and coverage verified on both material paths.`);
