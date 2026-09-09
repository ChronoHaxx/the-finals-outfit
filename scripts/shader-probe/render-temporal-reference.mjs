import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output = 'visual-diff/reconstructed/reference-temporal-01';
mkdirSync(output, { recursive: true });
const slots = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const outfit = '1.' + Buffer.from(JSON.stringify({ slots })).toString('base64url');
const base = `http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=a&cam=0,1.66,1.05,0,1.66,0&fov=28`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], captures = [], checks = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const settled = async () => {
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    await page.waitForFunction(() => window.__temporalPreview?.active && window.__temporalPreview.samples === window.__temporalPreview.maxSamples,
      undefined, { timeout: 60000 });
    return await page.evaluate(() => ({ ...window.__temporalPreview }));
  };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const stage of ['before', 'after']) {
    await page.goto(`${base}&temporal=${stage === 'before' ? 0 : 1}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    await page.addStyleTag({ content: 'div:has(> select[aria-label="Recovered material view"]) { visibility:hidden !important; }' });
    for (const [view, angle] of [['front', 0], ['oblique', .38], ['side', 1.57]]) {
      await page.evaluate(angle => { window.__rigRoot.rotation.y = angle; }, angle);
      const state = stage === 'after' ? await settled() : (await frame(), null);
      const file = `${output}/temporal-${stage}-${view}.png`;
      await page.locator('canvas').first().screenshot({ path: file });
      captures.push({ stage, view, state, file });
    }
  }
  const record = (name, condition, data = {}) => { assert.ok(condition, `${name}: ${JSON.stringify(data)}`); checks.push({ name, ...data }); };
  const stable = await settled(); await frame(); await frame();
  const idle = await page.evaluate(() => ({ ...window.__temporalPreview }));
  record('actual hair/lashes converge and stop scene draws', idle.sceneRenders === stable.sceneRenders && idle.samples === 32, idle);
  const moved = await page.evaluate(async () => {
    const initial = window.__temporalPreview.resets, observations = [];
    for (let i = 0; i < 6; i++) {
      window.__rigRoot.rotation.y += .1;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observations.push({ ...window.__temporalPreview });
    }
    return { initial, observations };
  });
  record('rotating the actual rig rejects history throughout motion', moved.observations.every((s, i) => s.resets >= moved.initial + i + 1 && s.samples <= 2), moved);
  await settled();
  const canvas = await page.locator('canvas').first().boundingBox();
  const beforeDrag = await page.evaluate(() => window.__temporalPreview.resets);
  const dragStarted = Date.now();
  await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .5);
  await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .75, canvas.y + canvas.height * .5, { steps: 12 }); await page.mouse.up();
  const afterDrag = await settled();
  record('OrbitControls movement resets then converges', afterDrag.resets > beforeDrag && afterDrag.resets - beforeDrag < 350,
    { ...afterDrag, movementResets: afterDrag.resets - beforeDrag, elapsedMs: Date.now() - dragStarted });
  const skeleton = await page.evaluate(async () => {
    const hair = window.__rigRoot.children.find(o => o.userData.rigItemId === 'hairs-afrofade');
    const mesh = hair.getObjectsByProperty('isSkinnedMesh', true)[0], bone = mesh.skeleton.bones[0];
    const resets = window.__temporalPreview.resets;
    bone.rotation.y += .18;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const changed = { ...window.__temporalPreview };
    bone.rotation.y -= .18;
    return { resets, changed, bone: bone.name };
  });
  record('actual hair attachment motion resets history', skeleton.changed.resets > skeleton.resets && skeleton.changed.samples <= 2, skeleton);
  await settled();
  const equip = async next => {
    await page.evaluate(async next => { window.__rigIdle = false; (await import('/src/store/useBuildStore.ts')).useBuildStore.getState().load(next); }, next);
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 }); await frame();
  };
  await equip({ face: slots.face });
  record('hair removal retains smoothing for recovered lashes', (await settled()).active);
  await equip({});
  const empty = await page.evaluate(() => ({ ...window.__temporalPreview }));
  record('empty outfit disables smoothing and releases buffers', !empty.active && empty.targetBytes === 0, empty);
  await equip(slots); record('hair/scalp re-equip resumes convergence', (await settled()).samples === 32);
  await page.setViewportSize({ width: 1120, height: 900 });
  const resized = await settled();
  const drawingSize = await page.locator('canvas').first().evaluate(c => ({ width: c.width, height: c.height }));
  record('viewer resize matches canvas pixel size', resized.width === drawingSize.width && resized.height === drawingSize.height, { resized, drawingSize });
  await page.getByTitle('Toggle scene lighting').click();
  const lobby = await settled();
  await page.locator('canvas').first().screenshot({ path: `${output}/temporal-lobby.png` });
  record('lobby renderer remount converges', lobby.active && lobby.samples === 32);
  await page.getByTitle('Toggle scene lighting').click(); record('studio renderer remount converges', (await settled()).samples === 32);
  const isolatedUrl = new URL(base); isolatedUrl.searchParams.set('isolate', '1');
  await page.goto(isolatedUrl.href, { waitUntil: 'networkidle' });
  record('isolated recovered hair and lashes converge', (await settled()).samples === 32);
  await page.goto(`${base}&surface=baseColor`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  record('raw surface views bypass display accumulation', !(await page.evaluate(() => window.__temporalPreview)));
  await page.goto(`${base}&debugAlbedo=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  record('albedo calibration bypasses display accumulation', !(await page.evaluate(() => window.__temporalPreview)));
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/viewer-checks.json`, JSON.stringify({ captures, checks, errors }, null, 2));
  console.log(`${checks.length} actual-viewer checks and six matched temporal before/after captures pass`);
} catch (error) {
  console.error(errors.map(e => e.slice(0, 2000)));
  if (page && !page.isClosed()) console.error(await page.evaluate(() => ({ status: window.__temporalPreview, rigIdle: window.__rigIdle })));
  throw error;
} finally { await browser.close(); }
