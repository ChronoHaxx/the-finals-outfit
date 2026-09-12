import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS_BASE, SITE_URL, checkSiteHealth } from './site-health.mjs';

function fixture({ bundle = `const assetBase = '${ASSETS_BASE}';`, missingMesh = false, cors = '*' } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    url = String(url);
    calls.push({ url, method: options.method });
    let body;
    let status = 200;
    const headers = {};
    if (url === SITE_URL) body = '<html><script type="module" src="./assets/app.js"></script></html>';
    else if (url.endsWith('/assets/app.js')) body = bundle;
    else {
      headers.server = 'cloudflare';
      headers['cf-ray'] = 'example-LHR';
      if (cors) headers['access-control-allow-origin'] = cors;
      if (url.endsWith('manifest.json')) body = JSON.stringify({ paths: ['items/hair/icon.webp', 'models/body.glb', 'models/source/texture.rgba.gz.bin'] });
      else if (url.endsWith('.glb') && missingMesh) status = 404;
    }
    return new Response(options.method === 'HEAD' ? null : body, { status, headers });
  };
  return { calls, fetcher };
}

test('checks the live app and asset host without downloading model or texture bodies', async () => {
  const { fetcher, calls } = fixture();
  const report = await checkSiteHealth({ fetcher });
  assert.equal(report.netlifyReferences, 0);
  assert.equal(report.manifestFiles, 3);
  assert.deepEqual(calls.slice(-3).map(call => call.method), ['HEAD', 'HEAD', 'HEAD']);
});

test('fails if a deployed app still points at Netlify, even with a Cloudflare base present', async () => {
  const { fetcher } = fixture({ bundle: `'${ASSETS_BASE}'; const models = 'https://old.netlify.app/v4/';` });
  await assert.rejects(checkSiteHealth({ fetcher }), /still contains a Netlify host/);
});

test('fails if deployment is stale, asset is absent, or browser cannot access assets', async () => {
  await assert.rejects(checkSiteHealth({ fetcher: fixture({ bundle: 'const base = "/old/";' }).fetcher }), /not configured for/);
  await assert.rejects(checkSiteHealth({ fetcher: fixture({ missingMesh: true }).fetcher }), /HTTP 404/);
  await assert.rejects(checkSiteHealth({ fetcher: fixture({ cors: null }).fetcher }), /CORS/);
});

test('does not accept a repository-variable regression to Netlify', async () => {
  await assert.rejects(checkSiteHealth({ assetsBase: 'https://old.netlify.app/v4/' }), /Expected Cloudflare asset host/);
});
