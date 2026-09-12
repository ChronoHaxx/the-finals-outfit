// Production GPU check for the two activated source body paints.
//
// Everything here runs against the real dev server, the real store and the real rig: the paints
// are equipped by loading outfits into the app's own Zustand store, and the evidence is the
// canvas pixels plus the material state the renderer actually compiled. The failure this replaces
// was a paint that equipped cleanly and changed nothing on screen, so "no errors" is not a pass —
// each paint has to move pixels, in its own authored colour, and removing it has to restore the
// control exactly.
//
//   node scripts/shader-probe/check-body-paints.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright-core';
import { outfitUrl, waitIdle, shoot, watch, classify, rigState, swap } from './coverage-preview-harness.mjs';

const out = 'visual-diff/reconstructed/body-paints-v2';
const generated = 'scripts/generated/shader-probe/body-paints-v2';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(generated, { recursive: true });

// Bare skin on the Medium body: the paint has to be judged on the body it paints, and the source
// face pair is what swaps in the recovered skin material the paint composites onto.
const SKIN = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const BODYTIGHT = 'bodycosmetics-bodypaint-bodytight-01';
const GOBLIN = 'bodycosmetics-bodypaint-goblin-01';
const SINGLET = 'streetwear-tightsinglet-cotton-enorino';

// Fixed A-pose views. The camera comes from the page url and is read once at mount, so each
// framing is its own pass rather than a mid-session parameter change. The torso pass exists for
// the two details Astra has to judge directly: the BodyTight wrist cutoff and zipper line, and
// where Goblin leaves skin bare.
const PASSES = [
  { pass: 'body', cam: '0,0.95,4.3,0,0.95,0', fov: 28, cases: null,
    views: [{ view: 'front', angle: 0 }, { view: 'back', angle: Math.PI }, { view: 'oblique', angle: 0.7 }] },
  { pass: 'torso', cam: '0,1.00,2.40,0,1.00,0', fov: 20, cases: ['skin-control', 'bodytight', 'goblin', 'singlet-bodytight'],
    views: [{ view: 'closeup', angle: 0 }, { view: 'closeup-back', angle: Math.PI }] },
];

const CASES = [
  { name: 'skin-control', slots: {} },
  { name: 'bodytight', slots: { bodyPaint: BODYTIGHT } },
  { name: 'goblin-replaces-bodytight', slots: { bodyPaint: GOBLIN } },
  { name: 'paint-removed', slots: {} },
  { name: 'goblin', slots: { bodyPaint: GOBLIN } },
  { name: 'makeup-clown', slots: { blush: 'bodycosmetics-makeup-clown-01' } },
  { name: 'eyes-emissiveblue', slots: { eyes: 'bodycosmetics-eyes-emissiveblue-02' } },
  { name: 'singlet', slots: { upperBody: SINGLET } },
  { name: 'singlet-bodytight', slots: { upperBody: SINGLET, bodyPaint: BODYTIGHT } },
];

// What the renderer compiled, read off the live materials. The decal cache key spells out the
// layer routing, the UV set and the source tiling, so a paint that silently fell back to vMapUv
// or lost its colour texture is visible here and not only in the pixels.
const probe = page => page.evaluate(() => {
  const seen = [];
  window.__rigRoot.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
      if (!m.userData.decalPatched && !o.userData.sourceBody) continue;
      seen.push({
        mesh: o.name, item: o.parent?.userData?.rigItemId ?? null,
        sourceBody: !!o.userData.sourceBody, skinInfluences: o.userData.sourceSkinInfluences ?? null,
        hasUv1: !!o.geometry?.attributes?.uv1, material: m.name,
        reconstructed: m.userData.reconstructed === true, decalPatched: m.userData.decalPatched === true,
        cacheKey: m.customProgramCacheKey(),
      });
    }
  });
  return seen;
});

const raw = async file => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

// Changed-pixel share against the control, plus the mean colour of what changed: a paint has to
// arrive in its own authored hue, not merely differ.
async function compare(file, controlFile, diffFile) {
  const a = await raw(controlFile), b = await raw(file);
  assert.equal(`${a.width}x${a.height}`, `${b.width}x${b.height}`, `${file}: capture size drifted`);
  const diff = Buffer.alloc(a.width * a.height * 4);
  // diffMask keeps the output opaque ONLY where the images differ, so the same buffer selects the
  // pixels to average. Pixelmatch's default overlay tints unchanged pixels too, which would
  // average in the backdrop and report the paint as whatever the studio background is.
  const changed = pixelmatch(a.data, b.data, diff, a.width, a.height, { threshold: 0.05, diffMask: true });
  const mean = [0, 0, 0];
  let counted = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    if (!diff[i * 4 + 3]) continue;
    for (let k = 0; k < 3; k++) mean[k] += b.data[i * 4 + k];
    counted++;
  }
  if (diffFile) await sharp(diff, { raw: { width: a.width, height: a.height, channels: 4 } }).png().toFile(diffFile);
  return { changed, pixels: a.width * a.height, share: changed / (a.width * a.height),
    changedMeanRgb: counted ? mean.map(v => Math.round(v / counted)) : null };
}

const report = { startedAt: new Date().toISOString(), meaning:
  'Renderer behaviour for the two activated source body paints on the Medium body. Not full visual acceptance, and not a statement about the packed _M data.',
  cases: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const { pass, cam, fov, cases, views: framings } of PASSES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const record = watch(page);
    await page.goto(outfitUrl(SKIN, { cam, fov, pose: 'a', extra: '&temporal=0' }), { waitUntil: 'networkidle' });
    await waitIdle(page);
    for (const testCase of CASES) {
      if (cases && !cases.includes(testCase.name)) continue;
      await swap(page, { ...SKIN, ...testCase.slots });
      await waitIdle(page);
      const materials = await probe(page);
      const state = await rigState(page);
      const views = [];
      for (const { view, angle } of framings) {
        await page.evaluate(angle => { window.__rigRoot.rotation.y = angle; window.__rigRoot.updateMatrixWorld(true); }, angle);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const file = `${testCase.name}.${view}.png`;
        await shoot(page, `${out}/${file}`);
        views.push({ view, file, ...(testCase.name === 'skin-control' ? {}
          : await compare(`${out}/${file}`, `${out}/skin-control.${view}.png`, `${out}/${testCase.name}.${view}.diff.png`)) });
      }
      const existing = report.cases.find(c => c.name === testCase.name);
      if (existing) existing.views.push(...views);
      else report.cases.push({ ...testCase, pass, materials, views, target: state, requests: classify(record) });
      fs.writeFileSync(`${generated}/gpu-checks.json`, JSON.stringify(report, null, 2) + '\n');
      console.log(pass, testCase.name, views.map(v => `${v.view}:${v.share === undefined ? 'control' : (v.share * 100).toFixed(2) + '%'}`).join(' '));
    }
    await page.close();
  }

  // Cold page, slow texture. The rig reporting idle is the app's own promise that the outfit is
  // ready to look at, so the frame taken the moment it resolves must already show the paint. This
  // is the failure Astra reproduced: idle at 296ms with the paint request still unreleased. The
  // delay lives in the route handler — it simulates a slow host, it is not a wait inserted to let
  // the renderer catch up, and nothing downstream of it sleeps.
  {
    const delayMs = 1500;
    const texture = 'bodycosmetics-bodypaint-goblin-01-bodyhands_c.webp';
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); // empty cache
    const page = await context.newPage();
    const record = watch(page);
    const timeline = { delayMs, requestedAt: null, releasedAt: null, idleAt: null };
    const start = Date.now();
    await page.route(url => String(url).includes(texture), async route => {
      timeline.requestedAt ??= Date.now() - start;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      timeline.releasedAt = Date.now() - start;
      await route.continue();
    });
    // Not networkidle: a routed request that has not been released yet does not keep the page busy,
    // so networkidle would vouch for a frame it cannot see. `__rigIdle` is the claim under test.
    await page.goto(outfitUrl({ ...SKIN, bodyPaint: GOBLIN }, { cam: PASSES[0].cam, fov: PASSES[0].fov, pose: 'a', extra: '&temporal=0' }),
      { waitUntil: 'domcontentloaded' });
    await waitIdle(page);
    timeline.idleAt = Date.now() - start;
    const file = 'cold-delayed-goblin.front.png';
    await shoot(page, `${out}/${file}`);
    report.coldDelayed = { texture, timeline, materials: await probe(page),
      view: { view: 'front', file, ...await compare(`${out}/${file}`, `${out}/skin-control.front.png`, `${out}/${file.replace('.png', '.diff.png')}`) },
      requests: classify(record) };
    fs.writeFileSync(`${generated}/gpu-checks.json`, JSON.stringify(report, null, 2) + '\n');
    console.log('cold-delayed-goblin', `requested=${timeline.requestedAt}ms released=${timeline.releasedAt}ms idle=${timeline.idleAt}ms`,
      `front:${(report.coldDelayed.view.share * 100).toFixed(2)}%`);
    await context.close();
  }

  const find = name => report.cases.find(c => c.name === name);
  const front = name => find(name).views.find(v => v.view === 'front');
  const body = name => find(name).materials.find(m => m.sourceBody);

  // The body geometry and its eight source skin influences must survive the decal patch.
  for (const testCase of report.cases) {
    const skin = testCase.materials.find(m => m.sourceBody);
    assert(skin, `${testCase.name}: preserved source body missing`);
    assert.equal(skin.skinInfluences, 8, `${testCase.name}: source skinning influences lost`);
    assert(skin.hasUv1, `${testCase.name}: body geometry has no UV1`);
  }

  // Each paint composites through the source UV set with its source tiling.
  for (const name of ['bodytight', 'goblin', 'goblin-replaces-bodytight']) {
    assert.match(body(name).cacheKey, /bodycbu1s0\.5x1po1/, `${name}: body layer is not the source UV1 overlay`);
  }
  // ...and the head layer BodyTight's data asset activates stays on UV0.
  assert(find('bodytight').materials.some(m => !m.sourceBody && /headcu0s1x1po1/.test(m.cacheKey)),
    'BodyTight head paint layer missing');
  assert(!find('goblin').materials.some(m => /headcu0s1x1/.test(m.cacheKey)), 'Goblin must not paint the head');

  // Real pixels: both paints are clearly visible, and BodyTight arrives green.
  assert(front('bodytight').share > 0.05, `BodyTight changed only ${front('bodytight').share} of the frame`);
  assert(front('goblin').share > 0.01, `Goblin changed only ${front('goblin').share} of the frame`);
  const [r, g, b] = front('bodytight').changedMeanRgb;
  assert(g > r && g > b, `BodyTight rendered ${r},${g},${b} — not the authored green`);
  // Goblin must leave skin: a full repaint would mean the coverage alpha was thrown away again.
  assert(front('goblin').share < front('bodytight').share, 'Goblin covers as much as the full bodysuit');

  // Removal restores the control exactly; replacement lands on the same image as a direct equip.
  for (const view of PASSES[0].views.map(v => v.view)) {
    const removed = find('paint-removed').views.find(v => v.view === view);
    assert.equal(removed.changed, 0, `${view}: removing the paint left ${removed.changed} changed pixels`);
    const swapped = find('goblin-replaces-bodytight').views.find(v => v.view === view);
    const direct = find('goblin').views.find(v => v.view === view);
    assert(Math.abs(swapped.share - direct.share) < 0.002, `${view}: replacing BodyTight with Goblin differs from equipping it directly`);
  }

  // Controls that must be untouched by this change.
  assert(front('makeup-clown').share > 0.0005, 'makeup control stopped rendering');
  assert(front('eyes-emissiveblue').share > 0.00005, 'eye colour control stopped rendering');
  assert.match(body('singlet').cacheKey, /decal-h-/, 'singlet body coverage (body-hide mask) is not active');
  assert.match(body('singlet-bodytight').cacheKey, /decal-h-bodycbu1s0\.5x1po1/, 'coverage and paint must compose');
  assert(front('singlet').share > 0.02, 'singlet control stopped rendering');

  // The awaited equip must outlast the slow texture, and the first frame after it must be painted.
  const cold = report.coldDelayed;
  assert(cold.timeline.requestedAt !== null, 'the delayed texture was never requested — the route did not match');
  assert(cold.timeline.releasedAt !== null, 'the rig reported idle before the delayed texture was released');
  assert(cold.timeline.releasedAt <= cold.timeline.idleAt,
    `the rig reported idle at ${cold.timeline.idleAt}ms with the paint still unreleased at ${cold.timeline.releasedAt}ms`);
  assert(cold.view.share > front('goblin').share * 0.9,
    `the first frame after idle showed ${(cold.view.share * 100).toFixed(2)}% paint against ${(front('goblin').share * 100).toFixed(2)}% warm`);
  assert.match(cold.materials.find(m => m.sourceBody).cacheKey, /bodycbu1s0\.5x1po1/, 'cold page did not composite the paint');

  const failures = [...report.cases, cold].flatMap(c => c.requests.failedRequests.map(f => `${c.name ?? 'cold-delayed'}: ${f}`));
  const errors = [...report.cases, cold].flatMap(c => c.requests.errors.map(e => `${c.name ?? 'cold-delayed'}: ${e}`));
  assert.deepEqual(failures, [], 'failed asset requests');
  assert.deepEqual(errors, [], 'page errors (a shader that failed to compile lands here)');
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(`${generated}/gpu-checks.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(`OK — ${report.cases.length} cases, captures in ${out}`);
