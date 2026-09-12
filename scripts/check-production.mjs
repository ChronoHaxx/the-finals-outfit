// Exercise the actual optimized build, its default renderer, and hosted URLs.
// --local-assets serves local files at the production asset origin before upload.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.PRODUCTION_URL ?? 'http://127.0.0.1:4173/the-finals-outfit/';
const assetsBase = process.env.ASSETS_BASE ?? 'https://the-finals-outfit-assets.netlify.app/v4-reconstruction/';
const output = process.env.PRODUCTION_REPORT_DIR ?? 'scripts/generated/release';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (process.argv.includes('--local-assets')) await page.route(`${assetsBase}**`, async route => {
    const root = resolve('public');
    const path = resolve(root, decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(assetsBase).pathname.length)));
    const rel = relative(root, path);
    assert(!rel.startsWith('..') && !isAbsolute(rel));
    await route.fulfill({ path, headers: { 'access-control-allow-origin': '*' } });
  });
  let errors = [], requested = [], badResponses = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requested.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  for (const test of [
    { name: 'default', slots: null, source: true },
    { name: 'hair-coat', source: true, slots: { face: 'head-face-01-base', hair: 'hairs-afrofade-blonde',
      outerwear: 'casual-longcoat-leather-black', lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' } },
    { name: 'mixed-materials', source: true, slots: { face: 'head-face-01-base',
      upperBody: 'actionhero-sentineltop-nylon-yellow', lowerBody: 'actionhero-sentinelpants-nylon-yellow',
      earrings: 'bodycosmetics-earrings-beetlegold-01', eyewear: 'attachment-3dpaperglasses-paper',
      feet: 'casual-tallsneakers-canvas' } },
    { name: 'coverage-accessories-nails', source: true, expectedPaths: [
      '/reconstructed-accessory-frames-v1/', '/reconstructed-nails-v1/',
    ], slots: { face: 'head-face-01-base', hair: 'hairs-afrofade',
      upperBody: 'streetwear-tightsinglet-cotton-enorino', lowerBody: 'casual-loosejeans-denim-darkblue',
      feet: 'casual-tallsneakers-canvas', earrings: 'bodycosmetics-earrings-chain-01-gold',
      lowerBack: 'attachment-boombox-01-finals-lumbar', nailPolish: 'bodycosmetics-nails-crosses-01' } },
    { name: 'ordinary-accessory', source: true, expectedPaths: ['/reconstructed-accessories-v1/'],
      slots: { face: 'head-face-01-base', hair: 'hairs-afrofade', facewear: 'attachment-asianmask',
        upperBody: 'casual-basictshirt-cotton-alfaacta', lowerBody: 'casual-loosejeans-denim-darkblue',
        feet: 'casual-tallsneakers-canvas' } },
    { name: 'body-paint', source: true, slots: { face: 'head-face-01-base',
      hair: 'hairs-afrofade', bodyPaint: 'bodycosmetics-bodypaint-bodytight-01' } },
    { name: 'legacy', slots: null, source: false },
  ]) {
    errors = []; requested = []; badResponses = [];
    const url = new URL(base);
    if (test.slots) url.searchParams.set('outfit', '1.' + Buffer.from(JSON.stringify({ slots: test.slots })).toString('base64url'));
    if (!test.source) url.searchParams.set('reconstructed', '0');
    // Developer display switches must not isolate or recolour the production outfit.
    url.searchParams.set('surface', 'normal'); url.searchParams.set('isolate', '1');
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 120000 });
    await page.evaluate(() => new Promise(resolve => {
      let remaining = 40; const frame = () => --remaining ? requestAnimationFrame(frame) : resolve(); requestAnimationFrame(frame);
    }));
    assert.equal(await page.getByLabel('Recovered material view').count(), 0);
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal(await page.evaluate(() => !!window.__rigRoot), false, 'production excludes developer rig access');
    assert.equal(requested.some(url => url.includes('/reconstructed-neck-v1/')), test.source);
    assert.equal(requested.some(url => url.includes('/reconstructed-meshes-v2/SK_Body_M.glb')), test.source);
    for (const path of test.expectedPaths ?? []) {
      assert(requested.some(url => url.includes(path)), `${test.name}: missing reconstructed dependency ${path}`);
    }
    assert.deepEqual(badResponses, [], `${test.name}: failed asset requests`);
    assert.deepEqual(errors, [], `${test.name}: browser errors`);
    const capture = `${output}/${new URL(base).hostname === '127.0.0.1' ? 'preview' : 'live'}-${test.name}.png`;
    await page.screenshot({ path: capture });
    results.push({ name: test.name, url: url.href, requests: requested.length, source: test.source, capture, passed: true });
    console.log(`${test.name}: passed (${requested.length} requests)`);
  }
  writeFileSync(`${output}/production-checks-${new URL(base).hostname}.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
