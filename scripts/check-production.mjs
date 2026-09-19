// Exercise the actual optimized build, its default renderer, and hosted URLs.
// --local-assets serves local files at the production asset origin before upload.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.PRODUCTION_URL ?? 'http://127.0.0.1:4173/the-finals-outfit/';
const assetsBase = process.env.ASSETS_BASE;
if (!assetsBase) throw new Error('Set ASSETS_BASE to the immutable asset release being checked');
const modelsBase = process.env.MODELS_BASE || assetsBase;
const output = process.env.PRODUCTION_REPORT_DIR ?? 'scripts/generated/release';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (process.argv.includes('--local-assets')) for (const host of new Set([assetsBase, modelsBase])) await page.route(`${host}**`, async route => {
    const root = resolve(process.env.ASSET_SOURCE_DIR || 'public');
    const path = resolve(root, decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(host).pathname.length)));
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
    { name: 'new-turtleneck', source: true, expectedPaths: ["/models/reconstructed-family-batch16-turtle-neck-v1/meshes/SK_Casual_TurtleNeck_M.glb"], slots: { face: 'head-face-01-base', hair: 'hairs-afrofade',
      upperBody: 'casual-turtleneck-cotton-yellow', lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' } },
    { name: 'multipart-hoodie-and-shoes', source: true, expectedPaths: ["/models/reconstructed-multipart-hoodie-tag-reuse-v1/meshes/SK_Casual_HoodieZipup_M.glb", "/models/reconstructed-multipart-batch02-streetwear-jacket-v1/meshes/SK_Streetwear_BaseTankTop_M.glb", "/models/reconstructed-multipart-dress-shoes-v1/meshes/SK_FancyDress_DressShoes_M.glb", "/models/reconstructed-multipart-dress-shoes-v1/meshes/SK_Socks_Quarter_M.glb"], slots: { face: 'head-face-01-base', hair: 'hairs-afrofade',
      upperBody: 'casual-hoodiezipup-cotton-enorino', lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'fancydress-dressshoes-leather' } },
    { name: 'hood-earring-identity-offset', source: true, slots: { face: 'head-face-01-base', hair: 'hairs-afrofade',
      upperBody: 'streetwear-techhoodie-cotton-black', earrings: 'bodycosmetics-earrings-chain-01-gold',
      lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' } },
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
    const artwork = requested.filter(url => /\/(models|items)\//.test(new URL(url).pathname));
    assert(artwork.length > 0);
    for (const url of artwork) {
      const host = new URL(url).pathname.includes('/models/') ? modelsBase : assetsBase;
      assert(url.startsWith(host), `${test.name}: asset requested from unexpected host: ${url}`);
    }
    assert(!requested.some(url => new URL(url).hostname.endsWith('.netlify.app')), 'No Netlify requests');
    assert.deepEqual(badResponses, [], `${test.name}: failed asset requests`);
    assert.deepEqual(errors, [], `${test.name}: browser errors`);
    const capture = `${output}/${new URL(base).hostname === '127.0.0.1' ? 'preview' : 'live'}-${test.name}.png`;
    await page.screenshot({ path: capture });
    results.push({ name: test.name, url: url.href, requests: requested.length, source: test.source, capture, passed: true });
    console.log(`${test.name}: passed (${requested.length} requests)`);
  }
  writeFileSync(`${output}/production-checks-${new URL(base).hostname}.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
