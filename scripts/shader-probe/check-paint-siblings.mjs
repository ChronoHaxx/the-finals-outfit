// Real Medium renderer review for the newly prepared paint siblings. Captures are evidence
// for a separate visual review, not automatic certification of the game's full material.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright-core';
import { outfitUrl, waitIdle, shoot, watch, classify, swap } from './coverage-preview-harness.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const prep = read('scripts/generated/shader-probe/body-paint-siblings-v1/prepare-report.json');
const before = read('scripts/generated/shader-probe/paint-sibling-audit-v1/catalog-before.json');
const catalog = read('src/data/items.json');
const items = new Map(catalog.map(i => [i.id, i]));
const prior = new Set(['bodycosmetics-bodypaint-bodytight-01', 'bodycosmetics-bodypaint-goblin-01']);
const candidates = prep.items.filter(i => i.status === 'prepared' && !prior.has(i.id));
const out = 'visual-diff/reconstructed/paint-siblings-v1';
const generated = 'scripts/generated/shader-probe/body-paint-siblings-v1';
fs.mkdirSync(out, { recursive: true });
const SKIN = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const report = { startedAt: new Date().toISOString(), scope: prep.scope,
  views: 'Eight azimuths, 45 degrees apart, fixed A pose and preview lighting. Visual review remains separate.',
  catalogChanges: [], cases: [], assets: [] };
const save = () => fs.writeFileSync(`${generated}/browser-checks.json`, JSON.stringify(report, null, 2) + '\n');

// Prove the converter left rejected entries and the two previously activated paints alone.
for (const old of before) {
  const next = items.get(old.id);
  const { decal: a, ...oldRest } = old, { decal: b, ...nextRest } = next;
  assert.deepEqual(nextRest, oldRest, `${old.id}: changed unrelated catalog fields`);
  if (candidates.some(c => c.id === old.id)) {
    assert.notDeepEqual(b, a, `${old.id}: no newly prepared decal`);
    report.catalogChanges.push(old.id);
  } else assert.deepEqual(next, old, `${old.id}: existing or rejected item changed`);
}
assert.equal(report.catalogChanges.length, 20);

// Lossless colour keeps every coverage byte and all covered RGB. Packed data is a byte copy,
// including roughness RGB beneath zero alpha (nonmetallic), at its independent native size.
for (const style of prep.styles) {
  const input = await sharp(style.sourceColor).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = await sharp(`public/${style.output.path}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, input.info.width);
  assert.equal(output.info.height, input.info.height);
  for (let p = 0; p < input.data.length; p += 4) {
    assert.equal(output.data[p + 3], input.data[p + 3], `${style.id}: coverage changed`);
    if (input.data[p + 3]) for (let c = 0; c < 3; c++)
      assert.equal(output.data[p + c], input.data[p + c], `${style.id}: covered colour changed`);
  }
  if (style.surface) assert(fs.readFileSync(style.surface.sourceData).equals(
    fs.readFileSync(`public/${style.surface.surfacePath}`)), `${style.id}: packed data changed`);
  report.assets.push({ id: style.id, part: style.part, nativeColour: style.colorSize,
    nativeData: style.surface?.dataSize, colourCoverageExact: true, packedCopyExact: !!style.surface });
}
save();

const raw = file => sharp(file).ensureAlpha().raw().toBuffer();
const compare = async (a, b) => pixelmatch(await raw(a), await raw(b), null, 900, 1000, { threshold: 0.05 });
const rotate = async (page, index) => {
  await page.evaluate(angle => {
    window.__rigRoot.rotation.y = angle;
    window.__rigRoot.updateMatrixWorld(true);
  }, index * Math.PI / 4);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const materials = page => page.evaluate(() => {
  const result = [];
  window.__rigRoot.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
      if (m.userData.decalPatched || o.userData.sourceBody) result.push({ mesh: o.name,
        sourceBody: !!o.userData.sourceBody, influences: o.userData.sourceSkinInfluences,
        uv1: !!o.geometry.attributes.uv1, key: m.customProgramCacheKey() });
    }
  });
  return result;
});
const label = (text, width, height = 32) => Buffer.from(
  `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#161b22"/><text x="12" y="22" font-family="Arial" font-size="16" fill="#eee">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`);
async function sheet(id, name, views) {
  const tiles = [{ input: label(name, 1440, 40), left: 0, top: 0 }];
  for (let i = 0; i < views.length; i++) {
    const left = (i % 4) * 360, top = 40 + Math.floor(i / 4) * 432;
    tiles.push({ input: await sharp(`${out}/${views[i].file}`).resize(360, 400).toBuffer(), left, top });
    tiles.push({ input: label(`${i * 45} degrees`, 360), left, top: top + 400 });
  }
  await sharp({ create: { width: 1440, height: 904, channels: 4, background: '#161b22' } })
    .composite(tiles).png().toFile(`${out}/${id}.sheet.png`);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const record = watch(page);
  await page.goto(outfitUrl(SKIN, { cam: '0,0.95,4.3,0,0.95,0', extra: '&temporal=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  for (let i = 0; i < 8; i++) {
    await rotate(page, i);
    await shoot(page, `${out}/control.${i}.png`);
  }
  for (const candidate of candidates) {
    const { id, layers } = candidate;
    await swap(page, { ...SKIN, bodyPaint: id });
    await waitIdle(page);
    const live = await materials(page);
    const body = live.find(m => m.sourceBody);
    assert(body?.uv1 && body.influences === 8, `${id}: source body/UV/skinning lost`);
    assert(body.key.includes(`bodycbu1s0.5x1po${layers.find(l => l.target === 'body').colorOverride}`),
      `${id}: source body paint/surface is missing`);
    const head = layers.find(l => l.target === 'head');
    if (head) assert(live.some(m => !m.sourceBody && m.key.includes(`headcu0s1x1po${head.colorOverride}`)),
      `${id}: source head colour is missing`);
    const views = [];
    for (let i = 0; i < 8; i++) {
      await rotate(page, i);
      const file = `${id}.${i}.png`;
      await shoot(page, `${out}/${file}`);
      views.push({ angle: i * 45, file, changedPixels: await compare(`${out}/${file}`, `${out}/control.${i}.png`) });
    }
    assert(views.some(v => v.changedPixels > 25), `${id}: equipping paint has no visible effect`);
    await sheet(id, items.get(id).name, views);
    await swap(page, SKIN);
    await waitIdle(page);
    await rotate(page, 0);
    await shoot(page, `${out}/${id}.removed.png`);
    const removalPixels = await compare(`${out}/${id}.removed.png`, `${out}/control.0.png`);
    assert.equal(removalPixels, 0, `${id}: removing paint did not restore the bare control`);
    report.cases.push({ id, name: items.get(id).name, materials: live, views, removalPixels });
    save();
    console.log(`${report.cases.length}/${candidates.length} ${id}: 8 views; removal exact`);
  }
  report.requests = classify(record);
  assert.deepEqual(report.requests.failedRequests, [], 'Failed asset requests');
  assert.deepEqual(report.requests.errors, [], 'Browser/shader errors');
  const loaded = new Set(record.requests.filter(r => r.outcome === 'finished' && r.status < 400)
    .map(r => decodeURI(new URL(r.url).pathname).slice(1)));
  for (const c of candidates) for (const l of c.layers) for (const p of [l.colorPath, l.surfacePath].filter(Boolean))
    assert(loaded.has(p), `${c.id}: texture was not successfully requested: ${p}`);
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  await browser.close();
}
console.log(`PASS: ${report.cases.length} new paints, 160 views, 20 removal checks. Visual review is still required.`);
