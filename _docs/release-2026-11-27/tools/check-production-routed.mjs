// (27 Nov 2026: + w177, S12 C0/C0b/C2 and a flagged Light scenario.) (23 Nov 2026 release copy of release-2026-11-12/tools; default worktree = loving-napier-b93181.)
// (12 Nov 2026 release copy of release-2026-11-11/tools, unchanged; set RELEASE_WORKTREE to the release worktree.)
// (6 Nov 2026 evening release copy.) The S12 garments-only merge repointed the turtleneck and zip-hoodie meshes to
// models/s12-bodytype-refresh-v1/meshes/, so those two expected paths follow the active index. Otherwise unchanged.
// Production browser scenarios for a SHARDED asset release (icons + base models +
// N reconstruction packages). scripts/check-production.mjs predates the reconstruction
// host split: it asserts every /models/ request comes from MODELS_BASE, which is false
// once RECONSTRUCTION_BASE/ROUTES are set. This keeps its ten scenarios and adds the
// 84% features, and judges every request against the release's own routing/membership.
//
// Required env:
//   PRODUCTION_URL          app under test, e.g. http://127.0.0.1:4341/the-finals-outfit/
//   ASSETS_BASE, MODELS_BASE                 icon / base-model immutable hosts
//   SHARD_PLAN, SHARD_HOSTS                  the release plan and its host receipts
//   PRODUCTION_REPORT_DIR   NEW folder for captures + report (refuses an existing one)
// Optional: RECONSTRUCTION_BASE / RECONSTRUCTION_ROUTES (if set, must equal the values
//   derived from SHARD_HOSTS, catching a build/validation setting mismatch).
//   --simulate-shards  PRE-UPLOAD REHEARSAL ONLY: serve the shard hosts from
//   ASSET_SOURCE_DIR with plan membership enforced (404 otherwise) and shard 0's control
//   indexes rewritten exactly as staging does. Never use it for hosted acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const CANDIDATE = process.env.RELEASE_WORKTREE ?? 'E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181';
const imp = rel => import(pathToFileURL(path.join(CANDIDATE, rel)).href);
const { shardHosts, routesForShards, stagedControlBytes, validateShardPlan, digest } = await imp('scripts/lib/asset-shards.mjs');
const { compactReconstructionRoutes, isReconstructionPath, joinBase, modelBase, parseReconstructionRoutes } = await imp('src/lib/asset-routing.mjs');

const need = name => { const v = process.env[name]?.trim(); if (!v) throw new Error(`Set ${name}`); return v; };
const appUrl = need('PRODUCTION_URL');
const norm = base => base.replace(/\/*$/, '/');
const assetsBase = norm(need('ASSETS_BASE')), modelsBase = norm(need('MODELS_BASE'));
const plan = JSON.parse(fs.readFileSync(need('SHARD_PLAN'), 'utf8')); validateShardPlan(plan);
const hosts = shardHosts(plan, JSON.parse(fs.readFileSync(need('SHARD_HOSTS'), 'utf8')), { requireAll: true });
const routes = compactReconstructionRoutes(routesForShards(plan, hosts));
if (process.env.RECONSTRUCTION_BASE?.trim()) assert.equal(norm(process.env.RECONSTRUCTION_BASE.trim()), hosts[0], 'RECONSTRUCTION_BASE differs from shard 0 receipt');
if (process.env.RECONSTRUCTION_ROUTES?.trim()) assert.equal(JSON.stringify(compactReconstructionRoutes(process.env.RECONSTRUCTION_ROUTES)), JSON.stringify(routes), 'RECONSTRUCTION_ROUTES differs from receipts');
const bases = { assetsBase, modelsBase, reconstructionBase: hosts[0], reconstructionRoutes: parseReconstructionRoutes(routes) };
const shardOf = Object.fromEntries(Object.entries(hosts).map(([id, base]) => [base, Number(id)]));
const members = plan.shards.map(s => new Set(s.paths));
const output = need('PRODUCTION_REPORT_DIR');
if (fs.existsSync(output)) throw new Error(`Preserve ${output}; choose a new folder`);
fs.mkdirSync(output, { recursive: true });
const simulate = process.argv.includes('--simulate-shards');

// Judge one request. Returns null when it is where the release says it must be.
function misplaced(url) {
  const u = new URL(url), origin = norm(u.origin + '/');
  if (u.hostname.endsWith('.netlify.app')) return 'netlify request';
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (!/^(models|items|textures)\//.test(rel)) return null;
  if (!rel.startsWith('models/')) return origin === assetsBase ? null : `icon/texture not on ASSETS_BASE`;
  if (origin in shardOf) return members[shardOf[origin]].has(rel) ? null : `not a member of ${plan.shards[shardOf[origin]].name}`;
  if (origin === modelsBase) return isReconstructionPath(rel) ? 'reconstruction file fetched from MODELS_BASE (routing not applied)' : null;
  return `unexpected asset host ${origin}`;
}

const contentType = rel => ({ json: 'application/json', glb: 'model/gltf-binary', png: 'image/png', webp: 'image/webp',
  glsl: 'text/plain', bin: 'application/octet-stream', jpg: 'image/jpeg', jpeg: 'image/jpeg', ktx2: 'image/ktx2' })[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

const base = { face: 'head-face-01-base', hair: 'hairs-afrofade', upperBody: 'casual-basictshirt-cotton-alfaacta',
  lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' };
const scenarios = [
  // scripts/check-production.mjs, unchanged outfits.
  { name: 'default', slots: null, source: true },
  { name: 'hair-coat', source: true, slots: { face: 'head-face-01-base', hair: 'hairs-afrofade-blonde',
    outerwear: 'casual-longcoat-leather-black', lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' } },
  { name: 'mixed-materials', source: true, slots: { face: 'head-face-01-base', upperBody: 'actionhero-sentineltop-nylon-yellow',
    lowerBody: 'actionhero-sentinelpants-nylon-yellow', earrings: 'bodycosmetics-earrings-beetlegold-01',
    eyewear: 'attachment-3dpaperglasses-paper', feet: 'casual-tallsneakers-canvas' } },
  { name: 'coverage-accessories-nails', source: true, expectedPaths: ['/reconstructed-accessory-frames-v1/', '/reconstructed-nails-v1/'],
    slots: { face: 'head-face-01-base', hair: 'hairs-afrofade', upperBody: 'streetwear-tightsinglet-cotton-enorino',
      lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas', earrings: 'bodycosmetics-earrings-chain-01-gold',
      lowerBack: 'attachment-boombox-01-finals-lumbar', nailPolish: 'bodycosmetics-nails-crosses-01' } },
  { name: 'ordinary-accessory', source: true, expectedPaths: ['/reconstructed-accessories-v1/'], slots: { face: 'head-face-01-base',
    hair: 'hairs-afrofade', facewear: 'attachment-asianmask', upperBody: 'casual-basictshirt-cotton-alfaacta',
    lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' } },
  { name: 'body-paint', source: true, slots: { face: 'head-face-01-base', hair: 'hairs-afrofade', bodyPaint: 'bodycosmetics-bodypaint-bodytight-01' } },
  { name: 'new-turtleneck', source: true, expectedPaths: ['/models/s12-bodytype-refresh-v1/meshes/SK_Casual_TurtleNeck_M.glb'],
    slots: { ...base, upperBody: 'casual-turtleneck-cotton-yellow' } },
  { name: 'multipart-hoodie-and-shoes', source: true, expectedPaths: ['/models/s12-bodytype-refresh-v1/meshes/SK_Casual_HoodieZipup_M.glb',
    '/models/reconstructed-multipart-dress-shoes-v1/meshes/SK_FancyDress_DressShoes_M.glb'],
    slots: { ...base, upperBody: 'casual-hoodiezipup-cotton-enorino', feet: 'fancydress-dressshoes-leather' } },
  { name: 'hood-earring-identity-offset', source: true, slots: { ...base, upperBody: 'streetwear-techhoodie-cotton-black',
    earrings: 'bodycosmetics-earrings-chain-01-gold' } },
  { name: 'legacy', slots: null, source: false },
  // 84% additions (same outfits as parity-cases-v2.json).
  { name: 'eyes-emissivegreen03-face01', source: true, slots: { ...base, eyes: 'bodycosmetics-eyes-emissivegreen-03' } },
  { name: 'headwrap-beardfull', source: true, expectedPaths: ['/models/reconstructed-assemblies-v1/head-wraps.json'], slots: { ...base, facialHair: 'facialhairs-beardfull-black' } },
  { name: 'headwrap-balaclava', source: true, slots: { ...base, facewear: 'streetwear-balaclava-cotton-white' } },
  { name: 'plasticsheet-phantommask', source: true, slots: { ...base, facewear: 'scifi-phantommask-metal' } },
  { name: 'glass-footballhelmet', source: true, slots: { ...base, headwear: 'sport-footballhelmet-plastic' } },
  { name: 'hat-over-hair-fedora', source: true, slots: { ...base, headwear: 'attachment-fedora-wool' } },
  { name: 'wristband-punk', source: true, slots: { ...base, wrist: 'casual-punkwristband-leather' } },
  { name: 'multitag-ponytaillow', source: true, slots: { ...base, hair: 'hairs-ponytaillow' } },
  // 23 Nov release: S12 tier-2 batch A and v10c meshes and masks, and earrings on a non-Face-01 head.
  { name: 's12-batchA-techcrop-bangles', source: true, expectedPaths: ['/models/s12-bodytype-refresh-v1/meshes/SK_Casual_Bangles_M.glb',
    '/models/s12-refresh-tier2-v1/coverage-s12/SK_Traditional_CloudBag_M.bodymask.png'],
    slots: { ...base, upperBody: 'streetwear-techcroptop-nylon-ivada', upperBack: 'traditional-cloudbag-dark', wrist: 'casual-bangles-metal-gold' } },
  { name: 's12-v10c-clothtop-dadjeans', source: true, expectedPaths: ['/models/s12-bodytype-refresh-v1/meshes/SK_Samurai_ClothTop_M.glb',
    '/models/s12-bodytype-refresh-v1/meshes/SK_Streetwear_DadJeans_M.glb', '/models/s12-bodytype-refresh-v1/meshes/SK_Robots_DiscoBotGloves_M.glb',
    '/models/s12-refresh-tier2-v1/coverage-s12/SK_Samurai_ClothTop_M.bodymask.png'],
    slots: { ...base, upperBody: 'samurai-clothtop-linen-blue', lowerBody: 'streetwear-dadjeans-denim-blackcns', hands: 'robots-discobotgloves-metal' } },
  { name: 's12-v10c-pioneer-frogshoes', source: true, expectedPaths: ['/models/s12-bodytype-refresh-v1/meshes/SK_Space_PioneerUpper_M.glb',
    '/models/s12-bodytype-refresh-v1/meshes/SK_Streetwear_TechPants_M.glb', '/models/s12-bodytype-refresh-v1/meshes/SK_Cute_FrogShoes_M.glb'],
    slots: { ...base, upperBody: 'space-pioneerupper-windbreaker', lowerBody: 'streetwear-techpants-nylon-phantom', feet: 'cute-frogshoes-cotton' } },
  { name: 'earrings-face09', source: true, slots: { ...base, face: 'head-face-09-base', earrings: 'bodycosmetics-earrings-bigthinhoops' } },
  // 27 Nov release: w177 panning (wave 137), S12 C0/C0b/C2, and Light behind its flag (last: the flag persists).
  { name: 'w177-panning-sportsjacket-vaporwave', source: true, expectedPaths: ['/models/reconstructed-w177-panning-v4/'],
    slots: { ...base, upperBody: 'streetwear-sportsjacket-translucentospuze', eyewear: 'streetwear-vaporwaveglasses-plastic-cnss7sp' } },
  { name: 's12-c0-tee-c0b-tallsneakers', source: true, expectedPaths: ['/models/reconstructed-s12-c0-v1/', '/models/s12-refresh-tier2-v1/c0b/SK_Casual_TallSneakers_M.glb'], slots: base },
  { name: 's12-c2-tighttechpants', source: true, expectedPaths: ['/models/reconstructed-s12-c2-v1/'], slots: { ...base, lowerBody: 'streetwear-tighttechpants-polyester-iseult' } },
  // Light (flagged) is checked by light-two-step.mjs: the legacy outfit=1.<json> link this checker builds carries no class.
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [], hostsUsed = new Set();
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (simulate) {
    const source = path.resolve(process.env.ASSET_SOURCE_DIR || 'E:/Coding/the-finals-outfit/public');
    const controls = new Map();
    for (const rel of plan.controls) controls.set(rel, stagedControlBytes(plan, rel, fs.readFileSync(path.join(source, rel)), hosts));
    for (const [id, host] of Object.entries(hosts)) await page.route(`${host}**`, async route => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
      const headers = { 'access-control-allow-origin': '*' };
      if (!members[id].has(rel)) return route.fulfill({ status: 404, headers, body: 'Asset not found' });
      const body = Number(id) === 0 && controls.has(rel) ? controls.get(rel) : fs.readFileSync(path.join(source, rel));
      if (!controls.has(rel) && digest(body) !== plan.nodes[rel].sha256) throw new Error(`Source changed since plan: ${rel}`);
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': contentType(rel) }, body });
    });
  }
  let errors, requested, badResponses;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requested.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
  for (const test of scenarios) {
    errors = []; requested = []; badResponses = [];
    const url = new URL(appUrl);
    if (test.slots) url.searchParams.set('outfit', '1.' + Buffer.from(JSON.stringify({ slots: test.slots })).toString('base64url'));
    if (!test.source) url.searchParams.set('reconstructed', '0');
    for (const [k, v] of Object.entries(test.params ?? {})) url.searchParams.set(k, v);
    url.searchParams.set('surface', 'normal'); url.searchParams.set('isolate', '1');
    const row = { name: test.name, url: url.href, source: test.source };
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
      await page.evaluate(() => new Promise(r => { let n = 40; const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); }));
      assert.equal(await page.getByLabel('Recovered material view').count(), 0, 'production excludes developer material view');
      assert.equal(await page.locator('canvas').count(), 1);
      assert.equal(await page.evaluate(() => !!window.__rigRoot), false, 'production excludes developer rig access');
      if (!test.light) assert.equal(requested.some(u => u.includes('/reconstructed-meshes-v2/SK_Body_M.glb')), test.source, 'fitted body request matches mode');
      for (const p of test.expectedPaths ?? []) assert(requested.some(u => u.includes(p)), `missing reconstructed dependency ${p}`);
      const artwork = requested.filter(u => /^\/(models|items|textures)\//.test(new URL(u).pathname));
      assert(artwork.length > 0, 'no artwork requested');
      const wrong = artwork.map(u => [u, misplaced(u)]).filter(([, why]) => why);
      assert.deepEqual(wrong, [], 'artwork requested from the wrong host');
      artwork.forEach(u => hostsUsed.add(new URL(u).origin + '/'));
      assert.deepEqual(badResponses, [], 'failed requests');
      assert.deepEqual(errors, [], 'browser errors');
      row.capture = path.join(output, `${test.name}.png`);
      await page.screenshot({ path: row.capture });
      Object.assign(row, { passed: true, requests: requested.length, artwork: artwork.length,
        hosts: [...new Set(artwork.map(u => new URL(u).origin + '/'))].sort() });
      console.log(`${test.name}: passed (${artwork.length} asset requests, ${row.hosts.length} hosts)`);
    } catch (error) {
      failed++;
      Object.assign(row, { passed: false, error: String(error?.message ?? error).slice(0, 4000), badResponses: badResponses.slice(0, 20), errors: errors.slice(0, 20) });
      console.log(`${test.name}: FAILED ${row.error.split('\n')[0]}`);
    }
    results.push(row);
  }
} finally { await browser.close(); }
const expectedHosts = [assetsBase, modelsBase, ...Object.values(hosts)].map(h => new URL(h).origin + '/').sort();
const allHostsUsed = expectedHosts.every(h => hostsUsed.has(h));
if (!allHostsUsed) failed++;
const report = { at: new Date().toISOString(), appUrl, simulatedShards: simulate, planSha256: digest(JSON.stringify(plan)),
  hosts: { assetsBase, modelsBase, shards: hosts }, expectedHosts, hostsUsed: [...hostsUsed].sort(), allHostsUsed,
  passed: results.filter(r => r.passed).length, failed, results };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: report.passed, failed, allHostsUsed, hostsUsed: report.hostsUsed }, null, 2));
if (failed) process.exitCode = 1;
