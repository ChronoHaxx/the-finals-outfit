import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALWAYS_LOADED, REPO_ROOT, SITE_URL, checkSiteHealth, readDeployConfig, sampleAssets, workflowEnv }
  from './site-health.mjs';
import { joinBase, modelBase } from '../../src/lib/asset-routing.mjs';

const host = label => `https://${label}.the-finals-outfit-assets.pages.dev/`;
const WORKFLOW = `
jobs:
  build:
    env:
      ASSETS_BASE: ${host('icons')}
      MODELS_BASE: ${host('models')}
      RECONSTRUCTION_BASE: ${host('control')}  # comment
      SHARE_PREVIEW_BASE: https://share.example.workers.dev
      ANIMATIONS_BASE: '${host('anim')}'
      RECONSTRUCTION_ROUTES_FILE: routes.json
    steps:
      - env:
          VITE_ASSETS_BASE: \${{ env.ASSETS_BASE }}
`;
// leaf2 serves nothing the catalogue names, so its probe falls back to the deployment manifest.
const ROUTES = { formatVersion: 1, hosts: [{ baseUrl: host('leaf'), prefixes: ['models/reconstructed-family-a-v1/'] },
  { baseUrl: host('leaf2'), prefixes: ['models/reconstructed-unused-v1/'] }] };
const ITEMS = [
  { id: 'a', imageUrl: 'items/hair/a.webp', model: { gltfPath: 'models/hair/a.glb', material: { albedo: 'models/hair/a.albedo.webp' } } },
  { id: 'b', imageUrl: 'items/top/b.webp', decal: { layers: [{ colorPath: 'models/reconstructed-family-a-v1/b_c.png' }] } },
];
const config = (workflow = WORKFLOW, routes = ROUTES) => readDeployConfig({ workflow, readFile: () => JSON.stringify(routes) });

const ALL = [host('icons'), host('models'), host('control'), host('leaf'), host('leaf2'), host('anim'),
  'https://share.example.workers.dev'];

// A fake live site and asset hosts; `change` edits a response by URL substring.
function site({ bundle, change = {} } = {}) {
  const calls = [];
  bundle ??= `const hosts = ${JSON.stringify(ALL)};`;
  const fetcher = async (url, options) => {
    url = String(url);
    calls.push({ url, method: options.method });
    let body = '', status = 200;
    let headers = { 'content-type': 'application/json' };
    if (url === SITE_URL) {
      headers = { 'content-type': 'text/html; charset=utf-8' };
      body = '<script type="module" crossorigin src="/the-finals-outfit/assets/index-x.js"></script>' +
        '<link rel="stylesheet" crossorigin href="/the-finals-outfit/assets/index-x.css">' +
        '<link rel="preload" href="/the-finals-outfit/assets/items-x.json" as="fetch" crossorigin="">';
    } else if (url.endsWith('index-x.js')) { headers = { 'content-type': 'text/javascript' }; body = bundle; }
    else if (url.endsWith('index-x.css')) headers = { 'content-type': 'text/css' };
    else if (url.endsWith('items-x.json')) body = '[]';
    else {
      const type = { glb: 'model/gltf-binary', webp: 'image/webp', png: 'image/png', json: 'application/json' }[url.split('.').pop()];
      headers = { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable',
        server: 'cloudflare', 'cf-ray': 'test-LHR' };
      if (url === `${host('anim')}manifest.json`) body = JSON.stringify({ formatVersion: 1, defaultIdle: 'idle', base: 'set-1/',
        props: 'props-1/props.json', clips: [{ id: 'emote', file: 'emote.json' }, { id: 'idle', file: 'idle.json' }] });
      if (url.endsWith('props.json')) body = JSON.stringify({ formatVersion: 1, actors: { Prop: { file: 'Prop.glb' } } });
    }
    for (const [match, edit] of Object.entries(change)) if (url.includes(match)) ({ status = status, headers = headers, body = body } = edit(headers));
    return new Response(options.method === 'HEAD' ? null : body, { status, headers });
  };
  return { calls, fetcher };
}
const check = (fake, cfg = config()) => checkSiteHealth({ config: cfg, items: ITEMS, fetcher: fake.fetcher });

test('reads the hosts from the deploy workflow and the routes file', () => {
  const cfg = config();
  assert.deepEqual(cfg.hosts.map(h => h.base), [host('icons'), host('models'), host('control'), host('leaf'), host('leaf2')]);
  assert.equal(cfg.animationsBase, host('anim'));
  assert.equal(cfg.sharePreviewBase, 'https://share.example.workers.dev');
  assert.equal(workflowEnv(WORKFLOW, 'PREVIEW_REF'), '');
  assert.throws(() => workflowEnv(`${WORKFLOW}      ASSETS_BASE: ${host('other')}\n`, 'ASSETS_BASE'), /different values/);
  assert.throws(() => workflowEnv('      ASSETS_BASE: ${{ vars.ASSETS }}\n', 'ASSETS_BASE'), /expression/);
  assert.throws(() => config(WORKFLOW.replace(host('icons'), 'http://insecure.example/')), /plain https URL/);
});

test('the real deploy.yml and routes file parse, and every shard gets a file the app requests', () => {
  const cfg = readDeployConfig();
  const items = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/data/items.json'), 'utf8'));
  assert(cfg.hosts.length >= 2 && cfg.hosts.every(h => h.base.startsWith('https://') && h.base.endsWith('/')));
  for (const sample of sampleAssets(items, cfg)) {
    const routed = sample.path.startsWith('models/') ? joinBase(modelBase(sample.path, cfg.bases), '') : cfg.bases.assetsBase;
    assert.equal(routed, sample.base, `${sample.path} is not served by the ${sample.role} host`);
  }
});

test('the always-loaded samples are still what the app loads first', () => {
  const viewer = readFileSync(resolve(REPO_ROOT, 'src/components/CharacterViewer.tsx'), 'utf8');
  const assembly = readFileSync(resolve(REPO_ROOT, 'src/rig/SourceAssembly.ts'), 'utf8');
  assert(viewer.includes(`modelUrl("${ALWAYS_LOADED[0]}")`));
  assert(viewer.includes('modelUrl("models/reconstructed-assemblies-v1")'));
  assert(assembly.includes('${baseUrl}/supported-items.json') && ALWAYS_LOADED[1].endsWith('/supported-items.json'));
});

test('a healthy site passes with one HEAD per host and no large downloads', async () => {
  const fake = site();
  const report = await check(fake);
  assert.deepEqual(report.hosts.map(h => h.path), ['items/hair/a.webp', 'models/hair/a.glb', ALWAYS_LOADED[0],
    'models/reconstructed-family-a-v1/b_c.png', 'manifest.json']);
  assert.deepEqual(report.hosts.map(h => h.fromCatalogue), [true, true, true, true, false]);
  assert.deepEqual(report.animation, { clips: 2, idle: 'idle', props: 1 });
  const gets = fake.calls.filter(c => c.method === 'GET').map(c => c.url);
  assert.deepEqual(gets, [SITE_URL, 'https://chronohaxx.github.io/the-finals-outfit/assets/index-x.js',
    `${host('anim')}manifest.json`, `${host('anim')}props-1/props.json`]);
  assert(fake.calls.some(c => c.method === 'HEAD' && c.url === `${host('anim')}set-1/idle.json`));
  assert(fake.calls.some(c => c.method === 'HEAD' && c.url === `${host('anim')}props-1/Prop.glb`));
});

test('fails when the live app was not built from main\'s deploy.yml', async () => {
  await assert.rejects(check(site({ bundle: `"${host('icons')}"` })), /not built with main's deploy.yml hosts.*leaf/s);
  const old = `${JSON.stringify(ALL)};"https://old.netlify.app/v4/";"${host('stale')}"`;
  await assert.rejects(check(site({ bundle: old })), /names asset hosts deploy.yml does not: old\.netlify\.app, stale\./);
});

test('fails on a missing file, an HTML fallback, missing CORS or short caching', async () => {
  await assert.rejects(check(site({ change: { 'a.glb': () => ({ status: 404, headers: { 'content-type': 'text/html' } }) } })),
    /models: HEAD .*a\.glb returned HTTP 404/);
  await assert.rejects(check(site({ change: { 'b_c.png': h => ({ headers: { ...h, 'content-type': 'text/html' } }) } })),
    /returned an HTML page/);
  await assert.rejects(check(site({ change: { 'a.webp': h => ({ headers: { ...h, 'access-control-allow-origin': '' } }) } })),
    /CORS/);
  await assert.rejects(check(site({ change: { 'control.the': h => ({ headers: { ...h, 'cache-control': 'max-age=60' } }) } })),
    /cached for 60 s/);
  await assert.rejects(check(site({ change: { 'items-x.json': () => ({ status: 404 }) } })), /catalogue file.*HTTP 404/);
});

test('fails when the animation host publishes no clips, which hides the animation controls', async () => {
  const empty = site({ change: { 'anim.the-finals-outfit-assets.pages.dev/manifest.json':
    h => ({ headers: h, body: JSON.stringify({ formatVersion: 1, clips: [] }) }) } });
  await assert.rejects(check(empty), /lists no clips/);
  const noAnimations = config(WORKFLOW.replace(/      ANIMATIONS_BASE.*\n/, ''));
  const report = await check(site({ bundle: JSON.stringify(ALL.filter(h => !h.includes('anim'))) }), noAnimations);
  assert.equal(report.animation, null);
});
