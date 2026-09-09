// Same camera, lighting and head material, with the previous hair path and the
// recovered hair/scalp path. Browser rendering is the only image source.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output = 'visual-diff/reconstructed/reference-hair-01';
mkdirSync(output, { recursive: true });
const supported = JSON.parse(readFileSync('public/models/reconstructed-assemblies-v1/supported-items.json', 'utf8'));
const baseline = { ...supported, items: supported.items.filter(id => id !== 'hairs-afrofade') };
const outfit = '1.' + Buffer.from(JSON.stringify({ slots: { face: 'head-face-01-base', hair: 'hairs-afrofade' } })).toString('base64url');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  for (const stage of ['before', 'after']) {
    if (stage === 'before') await page.route('**/reconstructed-assemblies-v1/supported-items.json', route => route.fulfill({ json: baseline }));
    else await page.unroute('**/reconstructed-assemblies-v1/supported-items.json');
    await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=a&cam=0,1.66,1.05,0,1.66,0&fov=28`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    assert.deepEqual(errors, []);
    const state = await page.evaluate(() => {
      const root = window.__rigRoot;
      const hair = root.children.find(o => o.userData.rigItemId === 'hairs-afrofade');
      const head = root.children.find(o => o.userData.sourceSkinPair);
      const meshes = hair.getObjectsByProperty('isMesh', true);
      const material = head.getObjectsByProperty('isMesh', true).flatMap(m => Array.isArray(m.material) ? m.material : [m.material])
        .find(m => m.userData.sourceSlot.MaterialSlotName === 'shader_head_shader');
      return { sourceHair: !!hair.userData.sourceAssembly, scalp: material.userData.parameterOverrides ?? [],
        meshes: meshes.map(m => ({ vertices: m.geometry.attributes.position.count, attachment: m.userData.sourceStaticAttachment,
          rest: m.userData.sourceAttachmentRest, surface: m.material.userData.surfaceKind, alphaHash: m.material.alphaHash })) };
    });
    assert.equal(state.sourceHair, stage === 'after');
    assert.equal(state.scalp.length, stage === 'after' ? 1 : 0);
    if (stage === 'after') {
      assert.equal(state.meshes[0].surface, 'hair'); assert.equal(state.meshes[0].attachment, 'head');
      assert.equal(state.meshes[0].vertices, 37507);
    }
    await page.addStyleTag({ content: 'button[title="Toggle scene lighting"], div:has(> select[aria-label="Recovered material view"]) { visibility:hidden !important; }' });
    for (const [view, angle] of [['front', 0], ['oblique', .38], ['side', 1.57]]) {
      await page.evaluate(angle => { window.__rigRoot.rotation.y = angle; }, angle);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const file = `${output}/hair-${stage}-${view}.png`;
      await page.locator('canvas').first().screenshot({ path: file });
      report.push({ stage, view, ...state, file });
    }
  }
  writeFileSync(`${output}/hair-comparison.json`, JSON.stringify(report, null, 2));
  console.log('Captured six matched before/after hair views with recovered scalp and head attachment');
} catch (e) { console.error(errors.map(e => e.slice(0, 1600))); throw e; }
finally { await browser.close(); }
