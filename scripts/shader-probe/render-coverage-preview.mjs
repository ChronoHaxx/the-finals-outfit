// Exercise the Stage A preview index in the real app and capture reviewable evidence.
//
// Every capture here is a render/diagnostic result. A successful screenshot is not a
// visual acceptance: appearance is judged by review, not by this script.
//
// Modes: cohort (all candidates, three views), compare (existing vs preview), interactions
// (outfit behaviour), sheets (contact sheets from what was already captured).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { APP_URL, ACTIVE_INDEX, PREVIEW_DIR, STAGE_A_SET, BASE_OUTFIT, cameras, classify, outfitUrl,
  read, rigState, servePreviewIndex, shoot, swap, waitIdle, watch } from './coverage-preview-harness.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
};
const mode = flag('mode', 'all');
const limit = Number(flag('limit', '0'));
const out = path.resolve(flag('out', 'visual-diff/reconstructed/coverage-sprint-a-integration-01'));
const generated = path.resolve(flag('generated', 'scripts/generated/shader-probe/coverage-sprint-a-integration-01'));
const coverage = read(path.join(generated, 'preview-coverage.json'));
const catalog = new Map(read('src/data/items.json').map(i => [i.id, i]));
const expected = new Map(coverage.newlyResolvedBindings.map(row => [row.id, row]));
const VIEWS = [['front', 0], ['back', Math.PI], ['oblique', 0.7]];
const SLOT_ORDER = ['upperBody', 'outerwear', 'lowerBody', 'feet'];
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(generated, { recursive: true });

const write = (file, value) => fs.writeFileSync(path.join(generated, file), JSON.stringify(value, null, 2) + '\n');
const label = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const sorted = ids => [...ids].sort((a, b) =>
  SLOT_ORDER.indexOf(catalog.get(a).slot) - SLOT_ORDER.indexOf(catalog.get(b).slot) || a.localeCompare(b));

/** Rotate the assembled rig instead of reloading: same lighting, same load, three angles. */
async function angle(page, radians) {
  await page.evaluate(async (y) => {
    window.__rigRoot.rotation.y = y;
    window.__rigRoot.updateMatrixWorld(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, radians);
}

const VIEWPORT = { width: 1600, height: 1100 };
const FOV = 28;

/** World bounds of one assembled item, so framing follows the garment instead of a guess. */
async function assemblyBounds(page, id) {
  return page.evaluate((wanted) => {
    const group = window.__rigRoot?.children.find(c => c.userData.rigItemId === wanted);
    if (!group || !window.__THREE) return null;
    const box = new window.__THREE.Box3().setFromObject(group);
    if (!Number.isFinite(box.min.y) || box.isEmpty()) return null;
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }, id);
}

/** Fit the camera to those bounds. Derived per source mesh, never tuned per item. */
function frameCamera(bounds, margin = 1.5) {
  const [minX, minY, minZ] = bounds.min, [maxX, maxY, maxZ] = bounds.max;
  const centre = (minY + maxY) / 2;
  const aspect = VIEWPORT.width / VIEWPORT.height;
  const span = Math.max(maxY - minY, Math.max(maxX - minX, maxZ - minZ) / aspect) * margin;
  const distance = Math.max(span / 2 / Math.tan(FOV * Math.PI / 360), 0.7) + (maxZ - minZ) / 2;
  return `0,${centre.toFixed(3)},${distance.toFixed(3)},0,${centre.toFixed(3)},0`;
}

/** Compare what the rig assembled against what the resolver said this item should use. */
function verify(id, state, record) {
  const want = expected.get(id);
  const item = catalog.get(id);
  const assembly = state.assemblies.find(a => a.id === id);
  const problems = [];
  if (!want) problems.push('item is not in the resolved preview cohort');
  if (!assembly) problems.push('no source assembly was attached for this item');
  else {
    if (!assembly.sourceAssembly) problems.push('attached through a non-source path');
    const got = assembly.parts.map(p => p.sourceMesh).sort();
    const wantMeshes = want ? want.parts.map(p => p.sourceMesh).sort() : [];
    if (String(got) !== String(wantMeshes)) problems.push(`source meshes ${got} != intended ${wantMeshes}`);
    const bindings = assembly.parts.flatMap(p => p.materials.map(m => m.sourceMaterial));
    const wantBindings = want ? want.parts.flatMap(p => Object.values(p.materials).map(m => m.source)) : [];
    for (const source of new Set(wantBindings)) {
      if (!bindings.includes(source)) problems.push(`missing intended material binding ${source}`);
    }
    for (const source of new Set(bindings)) {
      if (!wantBindings.includes(source)) problems.push(`unexpected material binding ${source}`);
    }
    if (assembly.parts.flatMap(p => p.materials).some(m => !m.reconstructed))
      problems.push('a slot did not use a reconstructed source material');
    if (!assembly.groupVisible) problems.push('assembly attached but its group is hidden');
    if (!assembly.visibleMeshes) problems.push('assembly attached but nothing is visible');
  }
  const observed = classify(record);
  if (observed.errors.length) problems.push(...observed.errors.map(e => `browser error: ${e}`));
  if (observed.failedRequests.length) problems.push(...observed.failedRequests.map(e => `failed request: ${e}`));
  const stageA = want ? [...new Set(want.parts.flatMap(p => Object.values(p.materials)
    .filter(m => m.set === 'stage-a').map(m => m.url)))] : [];
  const fetched = stageA.filter(url => record.stageARequests.some(r => r.includes(path.basename(url))));
  if (stageA.length && !fetched.length) problems.push('no Stage A material file was fetched for this item');
  const legacy = record.activeRequests.filter(r => stageA.some(url => r.includes(path.basename(url))));
  if (legacy.length) problems.push(`Stage A material served from the active folder: ${legacy[0]}`);
  return { id, name: item.name, slot: item.slot, problems, stageAMaterials: stageA, stageAFetched: fetched.length,
    supersededLoads: observed.supersededLoads, observedRequests: observed.observedRequests,
    assembly: assembly ?? null };
}

async function newPage(browser, viewport = { width: 1600, height: 1100 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const record = watch(page);
  return { page, record };
}
const clear = record => { for (const key of Object.keys(record)) record[key].length = 0; };

async function captureCohort(browser) {
  const ids = sorted(limit ? read('scripts/generated/shader-probe/coverage-sprint-a-01/cohort.json').itemIds.slice(0, limit)
    : read('scripts/generated/shader-probe/coverage-sprint-a-01/cohort.json').itemIds);
  const report = { formatVersion: 1, startedAt: new Date().toISOString(),
    meaning: 'Render and binding diagnostics for every Stage A candidate in the preview index. '
      + 'Captured views are evidence for review, not an appearance approval.',
    app: APP_URL, previewIndex: PREVIEW_DIR, servedInPlaceOf: ACTIVE_INDEX, viewport: '1600x1100',
    pose: 'a', baseOutfit: BASE_OUTFIT, views: VIEWS.map(([name, y]) => ({ view: name, rigRotationY: y })),
    cases: [] };
  const { page, record } = await newPage(browser);
  await servePreviewIndex(page, PREVIEW_DIR, { onIndexRequest: f => record.indexRequests.push(f) });
  // The camera is only read at mount, so each distinct set of source meshes gets one
  // measured framing that every item sharing those meshes then reuses without reloading.
  const framings = new Map();
  const meshKey = id => JSON.stringify((expected.get(id)?.parts ?? []).map(p => p.sourceMesh).sort());
  try {
    let currentCam = null;
    for (const [index, id] of ids.entries()) {
      const item = catalog.get(id);
      const slots = { ...BASE_OUTFIT, [item.slot]: id };
      const fallback = cameras(item.slot).front;
      clear(record);
      const started = performance.now();
      const entry = { id, name: item.name, slot: item.slot, fov: FOV, pose: 'a',
        context: 'Customization.Archetype.Medium', views: [] };
      try {
        const key = meshKey(id);
        let cam = framings.get(key);
        const show = async (target) => {
          if (currentCam === target) await swap(page, slots);
          else { await page.goto(outfitUrl(slots, { cam: target }), { waitUntil: 'networkidle' }); currentCam = target; }
          await waitIdle(page);
        };
        if (!cam) {
          await show(currentCam ?? fallback);
          const bounds = await assemblyBounds(page, id);
          cam = { value: bounds ? frameCamera(bounds) : fallback, measured: !!bounds, from: id, bounds };
          framings.set(key, cam);
        }
        if (currentCam !== cam.value) clear(record);
        await show(cam.value);
        entry.camera = cam.value;
        entry.framing = cam.measured
          ? `fitted to the assembled bounds of ${cam.from}` : `slot default (${item.slot}); bounds unavailable`;
        entry.bounds = cam.bounds;
        const state = await rigState(page);
        const checked = verify(id, state, record);
        for (const [view, y] of VIEWS) {
          await angle(page, y);
          const file = `cohort/${item.slot}/${id}.${view}.png`;
          await shoot(page, path.join(out, file));
          entry.views.push({ view, rigRotationY: y, file });
        }
        await angle(page, 0);
        Object.assign(entry, checked, { passed: !checked.problems.length });
      } catch (error) {
        entry.problems = [...(entry.problems ?? []), String(error)];
        entry.passed = false;
        await shoot(page, path.join(out, `cohort/failures/${id}.png`)).catch(() => {});
      }
      entry.elapsedSeconds = +((performance.now() - started) / 1000).toFixed(1);
      entry.indexRequests = record.indexRequests.length;
      report.cases.push(entry);
      write('cohort-render.json', report);
      console.log(`${index + 1}/${ids.length} ${id}: ${entry.passed ? 'rendered' : 'FAILED ' + entry.problems[0]}`);
    }
  } finally { await page.close(); }
  report.finishedAt = new Date().toISOString();
  report.counts = { items: report.cases.length, passed: report.cases.filter(c => c.passed).length,
    failed: report.cases.filter(c => !c.passed).length, views: report.cases.reduce((n, c) => n + c.views.length, 0) };
  write('cohort-render.json', report);
  console.log(JSON.stringify(report.counts));
  return report;
}

// Existing appearance = the app with the active index, where these items still take the
// legacy path. Preview = the same app reading the Stage A index. Lighting is the preview's
// studio lighting in both, so neither is comparable to an in-game screenshot.
const COMPARE = ['casual-basictshirt-cotton-black', 'casual-basictshirt-cotton-ospuze',
  'casual-loosejeans-cotton', 'casual-loosejeans-denim-lightblue', 'casual-tallsneakers-canvas-red',
  'casual-tubetop-cotton-red', 'casual-longcoat-polyesterblend-lawyerblack',
  'streetwear-tightsinglet-cotton-enorino'];

async function captureCompare(browser) {
  const report = { formatVersion: 1, startedAt: new Date().toISOString(),
    meaning: 'Side-by-side of the current app appearance and the Stage A preview for the same item. '
      + 'Catalog thumbnails are a rough shape/colour reference only: they are authored under the '
      + 'game\'s own lighting and post-processing, which this preview does not reproduce.',
    app: APP_URL, viewport: '1600x1100', pose: 'a', baseOutfit: BASE_OUTFIT, cases: [] };
  const cohortFile = path.join(generated, 'cohort-render.json');
  const measured = new Map(fs.existsSync(cohortFile)
    ? read(cohortFile).cases.filter(c => c.camera).map(c => [c.id, c.camera]) : []);
  for (const id of sorted(COMPARE)) {
    const item = catalog.get(id);
    // Both variants share the preview's measured framing so the two images are comparable.
    const cam = measured.get(id) ?? cameras(item.slot).front;
    const entry = { id, name: item.name, slot: item.slot, camera: cam, fov: FOV, pose: 'a',
      framing: measured.has(id) ? 'measured Stage A framing, identical in both variants' : `slot default (${item.slot})`,
      thumbnail: item.imageUrl && fs.existsSync(path.resolve('public', item.imageUrl)) ? item.imageUrl : null,
      variants: [] };
    for (const variant of ['existing', 'preview']) {
      const { page, record } = await newPage(browser);
      if (variant === 'preview') await servePreviewIndex(page, PREVIEW_DIR);
      const captured = { variant, index: variant === 'preview' ? PREVIEW_DIR : ACTIVE_INDEX, views: [] };
      try {
        await page.goto(outfitUrl({ ...BASE_OUTFIT, [item.slot]: id }, { cam }), { waitUntil: 'networkidle' });
        await waitIdle(page);
        const state = await rigState(page);
        const assembly = state.assemblies.find(a => a.id === id);
        captured.path = assembly?.sourceAssembly ? 'source-assembly' : 'legacy-preview';
        captured.materials = assembly ? assembly.parts.flatMap(p => p.materials.map(m => m.sourceMaterial)) : [];
        for (const [view, y] of VIEWS.filter(v => v[0] !== 'back')) {
          await angle(page, y);
          const file = `compare/${id}.${variant}.${view}.png`;
          await shoot(page, path.join(out, file));
          captured.views.push({ view, rigRotationY: y, file });
        }
        Object.assign(captured, classify(record));
      } catch (error) { captured.errors = [...(captured.errors ?? []), String(error)]; }
      finally { await page.close(); }
      entry.variants.push(captured);
    }
    report.cases.push(entry);
    write('compare-render.json', report);
    console.log(`compare ${id}: ${entry.variants.map(v => `${v.variant}=${v.path}`).join(' ')}`);
  }
  report.finishedAt = new Date().toISOString();
  write('compare-render.json', report);
  return report;
}

async function captureInteractions(browser) {
  const report = { formatVersion: 1, startedAt: new Date().toISOString(),
    meaning: 'Outfit behaviour of the preview index in the real app. These are behaviour checks, '
      + 'not appearance approvals.', app: APP_URL, checks: [] };
  const { page, record } = await newPage(browser);
  const unroute = await servePreviewIndex(page, PREVIEW_DIR);
  const coat = 'casual-longcoat-polyesterblend-lawyerblack';
  const shirt = 'casual-basictshirt-cotton-black';
  const shots = [];
  const capture = async (name) => { const file = `interactions/${name}.png`; await shoot(page, path.join(out, file)); shots.push(file); return file; };
  const check = async (name, fn) => {
    clear(record);
    const entry = { name, passed: false, details: {} };
    try {
      Object.assign(entry.details, await fn(entry) ?? {});
      const observed = classify(record);
      entry.passed = !observed.errors.length && !observed.failedRequests.length;
      entry.details.supersededLoads = observed.supersededLoads;
      if (!entry.passed) entry.details.unexpected = [...observed.errors, ...observed.failedRequests];
    } catch (error) {
      entry.error = String(error);
      entry.details.browserEvidence = classify(record);
      await capture(`failure-${name.replace(/\W+/g, '-')}`).catch(() => {});
    }
    report.checks.push(entry);
    write('interaction-checks.json', report);
    console.log(`${name}: ${entry.passed ? 'passed' : 'FAILED ' + (entry.error ?? JSON.stringify(entry.details.unexpected))}`);
    return entry;
  };
  // Close one phase of a check: return its evidence and start the next with a clean record.
  const phase = (label) => { const observed = { phase: label, ...classify(record) }; clear(record); return observed; };
  const assemblies = async () => (await rigState(page)).assemblies;
  const find = async (id) => (await assemblies()).find(a => a.id === id);
  try {
    await check('Stage A shirt and pants assemble together on the Medium body', async () => {
      await page.goto(outfitUrl({ ...BASE_OUTFIT, upperBody: shirt, lowerBody: 'casual-loosejeans-denim-lightblue',
        feet: 'casual-tallsneakers-canvas-red' }, { cam: cameras('full').front }), { waitUntil: 'networkidle' });
      await waitIdle(page);
      const state = await rigState(page);
      const ids = [shirt, 'casual-loosejeans-denim-lightblue', 'casual-tallsneakers-canvas-red'];
      const found = ids.map(id => state.assemblies.find(a => a.id === id));
      if (found.some(a => !a?.sourceAssembly || !a.visibleMeshes)) throw new Error('A Stage A garment did not assemble visibly');
      return { file: await capture('pants-and-shoes'), visible: Object.fromEntries(ids.map((id, i) => [id, found[i].visibleMeshes])) };
    });

    await check('Face and hair stay assembled beside Stage A garments', async () => {
      const state = await rigState(page);
      const face = state.assemblies.find(a => a.id === 'head-face-01-base');
      const hair = state.assemblies.find(a => a.id === 'hairs-afrofade');
      if (!face?.sourceSkinPair || !face.visibleMeshes) throw new Error('Source face pair missing');
      if (!hair?.sourceAssembly || !hair.visibleMeshes) throw new Error('Source hair assembly missing');
      return { file: await capture('face-and-hair'), face: face.visibleMeshes, hair: hair.visibleMeshes };
    });

    await check('Complete coat suppresses the Stage A shirt and restores it on removal', async () => {
      await swap(page, { ...BASE_OUTFIT, upperBody: shirt, outerwear: coat });
      await waitIdle(page);
      const worn = await find(coat), suppressed = await find(shirt);
      if (!worn?.sourceAssembly || !worn.visibleMeshes) throw new Error('Stage A coat did not assemble');
      if (suppressed && (suppressed.groupVisible || suppressed.visibleMeshes))
        throw new Error('Shirt still contributes geometry under the complete coat');
      const withCoat = await capture('coat-suppresses-shirt');
      await swap(page, { ...BASE_OUTFIT, upperBody: shirt });
      await waitIdle(page);
      const restored = await find(shirt);
      if (!restored?.sourceAssembly || !restored.visibleMeshes) throw new Error('Shirt was not restored after removing the coat');
      return { withCoat, restored: await capture('shirt-restored'),
        suppressedMeshes: suppressed?.visibleMeshes ?? 0, restoredMeshes: restored.visibleMeshes };
    });

    await check('Repeated Stage A swaps keep the correct assembly and release old textures', async () => {
      const cycle = ['casual-basictshirt-cotton-ospuze', 'casual-tubetop-cotton-red',
        'casual-basictshirt-cotton-white', 'casual-tubetop-cotton-blue'];
      const seen = [];
      for (const pass of [1, 2]) for (const id of cycle) {
        const textures = await page.evaluate(() => {
          window.__disposedRecoveredTextures = [];
          const found = new Map();
          window.__rigRoot.traverse(o => {
            for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []))
              if (m.userData.reconstructed) for (const t of Object.values(m.userData)) if (t?.isTexture) found.set(t.uuid, t);
          });
          found.forEach(t => t.addEventListener('dispose', () => window.__disposedRecoveredTextures.push(t.uuid)));
          return found.size;
        });
        await swap(page, { ...BASE_OUTFIT, upperBody: id });
        await waitIdle(page);
        const assembly = await find(id);
        if (!assembly?.sourceAssembly || !assembly.visibleMeshes) throw new Error(`Swap ${pass} to ${id} did not assemble`);
        const released = await page.evaluate(() => new Set(window.__disposedRecoveredTextures).size);
        if (textures && !released) throw new Error(`Swap ${pass} to ${id} released no previous textures`);
        seen.push({ pass, id, trackedTextures: textures, released });
      }
      return { swaps: seen.length, file: await capture('repeated-swaps'), seen };
    });

    await check('A failed Stage A fetch keeps the previous valid outfit', async (entry) => {
      const good = 'casual-tubetop-cotton-red', broken = 'casual-basictshirt-cotton-alien';
      await swap(page, { ...BASE_OUTFIT, upperBody: good });
      await waitIdle(page);
      const before = await find(good);
      if (!before?.visibleMeshes) throw new Error('Baseline outfit for the failure case is not visible');
      const setup = phase('baseline');
      if (setup.errors.length || setup.failedRequests.length)
        throw new Error(`The baseline for the failure case was not clean: ${[...setup.errors, ...setup.failedRequests][0]}`);

      // Phase 1: exactly one injected fixture failure. Only that request may fail.
      const part = expected.get(broken).parts[0];
      const file = path.basename(part.materials[Object.keys(part.materials)[0]].url);
      let blocked = 0;
      const pattern = `**/${STAGE_A_SET}/${file}`;
      await page.route(pattern, route => { blocked++; return route.fulfill({ status: 404, body: 'Missing preview fixture' }); });
      await swap(page, { ...BASE_OUTFIT, upperBody: broken });
      // The capture layout hides viewer overlays, so wait on the node, not its visibility.
      await page.getByText('Couldn’t load this shader preview.', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
      await waitIdle(page);
      const after = await find(good), attempted = await find(broken);
      const shot = await capture('failed-fetch-preserves-outfit');
      const injected = phase('injected-failure');
      entry.details.injectedFailure = injected;
      if (!blocked) throw new Error(`The intended preview fetch never happened: ${file}`);
      const stray = injected.failedRequests.filter(e => !e.includes(file));
      if (stray.length) throw new Error(`Unrelated request failure while the fixture was blocked: ${stray[0]}`);
      if (!injected.failedRequests.length) throw new Error('The blocked fixture produced no observed failure');
      const strayErrors = injected.errors.filter(e => !e.includes(file) && !e.includes('404') && !e.includes(broken));
      if (strayErrors.length) throw new Error(`Unrelated browser error while the fixture was blocked: ${strayErrors[0]}`);
      if (!after?.visibleMeshes) throw new Error('The previous valid outfit was lost after a failed fetch');
      if (attempted) throw new Error('The failed item was attached anyway');

      // Phase 2: recovery must be completely clean; its errors are not covered by the fixture.
      await page.unroute(pattern);
      await swap(page, { ...BASE_OUTFIT, upperBody: broken });
      await waitIdle(page);
      const recovered = await find(broken);
      const recoveredShot = await capture('failed-fetch-recovered');
      const recovery = phase('recovery');
      entry.details.recovery = recovery;
      if (!recovered?.sourceAssembly || !recovered.visibleMeshes) throw new Error('The item did not recover after the fetch was restored');
      if (recovery.errors.length || recovery.failedRequests.length)
        throw new Error(`Recovery after the failed fetch was not clean: ${[...recovery.errors, ...recovery.failedRequests][0]}`);
      return { blockedFile: file, blockedRequests: blocked, file: shot, recovered: recoveredShot };
    });

    await check('Idle pose renders the same Stage A assemblies', async () => {
      const files = [];
      for (const id of ['casual-basictshirt-cotton-thefinals', 'casual-longcoat-polyesterblend-lawyerwhite',
        'casual-loosejeans-denim-black']) {
        const item = catalog.get(id);
        await page.goto(outfitUrl({ ...BASE_OUTFIT, [item.slot]: id },
          { cam: cameras('full').front, pose: null }), { waitUntil: 'networkidle' });
        await waitIdle(page);
        const assembly = await find(id);
        if (!assembly?.sourceAssembly || !assembly.visibleMeshes) throw new Error(`Idle pose lost the assembly for ${id}`);
        files.push({ id, pose: 'idle', file: await capture(`idle-${id}`) });
      }
      return { samples: files };
    });
  } finally { await unroute(); await page.close(); }
  report.finishedAt = new Date().toISOString();
  report.screenshots = shots;
  report.counts = { checks: report.checks.length, passed: report.checks.filter(c => c.passed).length };
  write('interaction-checks.json', report);
  console.log(JSON.stringify(report.counts));
  return report;
}

// ---- contact sheets -------------------------------------------------------------------
// Tile body matches the captured 1600x1100 aspect, so nothing is padded away.
const TILE = { width: 430, header: 34, get height() { return this.header + Math.round(this.width * 1100 / 1600); } };
async function tile(file, title, subtitle, extra = []) {
  const image = fs.existsSync(file)
    ? await sharp(file).resize(TILE.width, TILE.height - TILE.header, { fit: 'contain', background: '#20242e' }).toBuffer()
    : await sharp({ create: { width: TILE.width, height: TILE.height - TILE.header, channels: 4, background: '#3a2020' } }).png().toBuffer();
  const text = `<svg width="${TILE.width}" height="${TILE.header}">`
    + `<rect width="${TILE.width}" height="${TILE.header}" fill="#171a22"/>`
    + `<text x="8" y="14" fill="#ffffff" font-family="Arial" font-size="12">${label(title)}</text>`
    + `<text x="8" y="28" fill="#9fb0c0" font-family="Arial" font-size="10">${label(subtitle)}</text></svg>`;
  return sharp({ create: { width: TILE.width, height: TILE.height, channels: 4, background: '#20242e' } })
    .composite([{ input: image, left: 0, top: TILE.header }, { input: Buffer.from(text), left: 0, top: 0 }, ...extra])
    .png().toBuffer();
}

async function sheet(name, heading, tiles, columns = 4) {
  const rows = Math.ceil(tiles.length / columns);
  const head = 46;
  const svg = `<svg width="${columns * TILE.width}" height="${head}">`
    + `<rect width="${columns * TILE.width}" height="${head}" fill="#0f1218"/>`
    + `<text x="10" y="19" fill="#ffffff" font-family="Arial" font-size="14">${label(heading)}</text>`
    + `<text x="10" y="36" fill="#94a3b4" font-family="Arial" font-size="11">`
    + `Renders from the local preview only. Studio preview lighting, not the game's lighting. Not a visual acceptance.</text></svg>`;
  const composites = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  for (const [i, buffer] of tiles.entries()) {
    composites.push({ input: buffer, left: (i % columns) * TILE.width, top: head + Math.floor(i / columns) * TILE.height });
  }
  const file = path.join(out, `sheets/${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: columns * TILE.width, height: head + rows * TILE.height, channels: 4, background: '#0f1218' } })
    .composite(composites).png().toFile(file);
  return `sheets/${name}.png`;
}

async function buildSheets() {
  const cohortReport = read(path.join(generated, 'cohort-render.json'));
  const compareReport = fs.existsSync(path.join(generated, 'compare-render.json'))
    ? read(path.join(generated, 'compare-render.json')) : { cases: [] };
  const sheets = [];
  const bySlot = new Map();
  for (const entry of cohortReport.cases) bySlot.set(entry.slot, [...(bySlot.get(entry.slot) ?? []), entry]);
  const PER_SHEET = 12; // three rows of four stays readable at full size
  for (const slot of SLOT_ORDER.filter(s => bySlot.has(s))) {
    const entries = bySlot.get(slot);
    const pages = Math.ceil(entries.length / PER_SHEET) || 1;
    for (const view of ['front', 'back', 'oblique']) {
      for (let p = 0; p < pages; p++) {
        const page = entries.slice(p * PER_SHEET, (p + 1) * PER_SHEET);
        const tiles = [];
        for (const entry of page) {
          const capture = entry.views?.find(v => v.view === view);
          tiles.push(await tile(capture ? path.join(out, capture.file) : 'missing',
            entry.name, `${entry.id} · ${entry.passed ? 'rendered' : 'FAILED'} · ${view}`));
        }
        const suffix = pages > 1 ? `-${p + 1}of${pages}` : '';
        sheets.push({ slot, view, page: p + 1, pages, items: page.map(e => e.id),
          file: await sheet(`cohort-${slot}-${view}${suffix}`,
            `Stage A preview · ${slot} · ${view} view · items ${p * PER_SHEET + 1}–${p * PER_SHEET + page.length}`
            + ` of ${entries.length}`, tiles) });
      }
    }
  }
  for (const entry of compareReport.cases) {
    const tiles = [];
    if (entry.thumbnail) tiles.push(await tile(path.resolve('public', entry.thumbnail), entry.name,
      'catalog thumbnail · game lighting · rough reference only'));
    for (const variant of entry.variants) for (const view of variant.views ?? []) {
      tiles.push(await tile(path.join(out, view.file), entry.name,
        `${entry.id} · ${variant.variant} (${variant.path}) · ${view.view}`));
    }
    sheets.push({ id: entry.id, slot: entry.slot,
      file: await sheet(`compare-${entry.id}`, `Existing vs Stage A preview · ${entry.name} (${entry.slot})`, tiles, Math.min(5, tiles.length || 1)) });
  }

  const rows = [];
  for (const slot of SLOT_ORDER.filter(s => bySlot.has(s))) {
    rows.push(`<h2>${label(slot)} · ${bySlot.get(slot).length} candidates</h2>`);
    for (const view of ['front', 'back', 'oblique']) {
      const pages = sheets.filter(x => x.slot === slot && x.view === view);
      if (!pages.length) continue;
      rows.push(`<p>contact sheets · ${label(view)} view: `
        + pages.map(s => `<a href="${s.file}">${s.pages > 1 ? `part ${s.page}/${s.pages}` : 'all items'}</a>`).join(' · ')
        + '</p>');
    }
    rows.push('<table><tr><th>item</th><th>result</th><th>front</th><th>back</th><th>oblique</th><th>bindings</th></tr>');
    for (const entry of bySlot.get(slot)) {
      const links = ['front', 'back', 'oblique'].map(v => {
        const capture = entry.views?.find(x => x.view === v);
        return capture ? `<td><a href="${capture.file}">${v}</a></td>` : '<td>—</td>';
      }).join('');
      const bindings = (entry.assembly?.parts ?? []).flatMap(p => p.materials.map(m => m.sourceMaterial?.split('.').pop()));
      rows.push(`<tr><td>${label(entry.name)}<br><code>${label(entry.id)}</code></td>`
        + `<td class="${entry.passed ? 'ok' : 'bad'}">${entry.passed ? 'rendered' : label(entry.problems?.[0] ?? 'failed')}</td>`
        + `${links}<td><code>${label([...new Set(bindings)].join(', '))}</code></td></tr>`);
    }
    rows.push('</table>');
  }
  if (compareReport.cases.length) {
    rows.push('<h2>Existing vs preview</h2>');
    for (const entry of compareReport.cases) {
      const s = sheets.find(x => x.id === entry.id);
      const links = entry.variants.flatMap(v => (v.views ?? []).map(view =>
        `<a href="${view.file}">${v.variant} ${view.view}</a>`)).join(' · ');
      rows.push(`<p><b>${label(entry.name)}</b> <code>${label(entry.id)}</code><br>`
        + (s ? `<a href="${s.file}">contact sheet</a> · ` : '') + links + '</p>');
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Stage A preview captures</title>
<style>body{background:#0f1218;color:#e6edf3;font:13px Arial,sans-serif;margin:24px}
h1{font-size:20px}h2{font-size:15px;margin-top:28px;border-bottom:1px solid #2a303c;padding-bottom:4px}
a{color:#7cc4ff}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #2a303c;padding:4px 8px;text-align:left;vertical-align:top}
code{color:#9fb0c0}.ok{color:#7fd88f}.bad{color:#ff8f8f}</style>
<h1>Stage A preview captures</h1>
<p>Preview index <code>${label(PREVIEW_DIR)}</code> served in place of <code>${label(ACTIVE_INDEX)}</code>.
Viewport 1600×1100, A-pose, Medium reference body, studio preview lighting.
These are renders and diagnostics; <b>no item here is visually accepted</b>.</p>
${rows.join('\n')}`;
  fs.writeFileSync(path.join(out, 'index.html'), html);
  write('sheets.json', { formatVersion: 1, sheets, index: 'index.html' });
  console.log(`sheets: ${sheets.length}`);
  return sheets;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const failures = [];
try {
  if (mode === 'cohort' || mode === 'all') {
    const report = await captureCohort(browser);
    failures.push(...report.cases.filter(c => !c.passed).map(c => `cohort ${c.id}: ${c.problems?.[0]}`));
  }
  if (mode === 'compare' || mode === 'all') {
    const report = await captureCompare(browser);
    failures.push(...report.cases.flatMap(c => c.variants.filter(v => v.errors?.length || v.failedRequests?.length)
      .map(v => `compare ${c.id} (${v.variant}): ${(v.errors ?? v.failedRequests)[0]}`)));
  }
  if (mode === 'interactions' || mode === 'all') {
    const report = await captureInteractions(browser);
    failures.push(...report.checks.filter(c => !c.passed)
      .map(c => `interaction ${c.name}: ${c.error ?? JSON.stringify(c.details.unexpected)}`));
  }
} finally { await browser.close(); }
if (['sheets', 'all', 'cohort'].includes(mode)) await buildSheets();
// Captures are kept either way; a nonzero exit reports that requested checks actually failed.
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map(f => ` - ${f}`).join('\n')}`);
  process.exitCode = 1;
}
