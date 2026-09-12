import assert from 'node:assert/strict';

export const SITE_URL = 'https://chronohaxx.github.io/the-finals-outfit/';
export const ASSETS_BASE = 'https://the-finals-outfit-assets.pages.dev/v5-coverage-20260912/';
const ASSETS_HOST = 'the-finals-outfit-assets.pages.dev';

// A small HTTP smoke check. Browser rendering remains check-production.mjs's job.
export async function checkSiteHealth({ site = SITE_URL, assetsBase = ASSETS_BASE, fetcher = fetch } = {}) {
  const base = new URL(assetsBase.replace(/\/*$/, '/'));
  assert(base.protocol === 'https:' && base.hostname === ASSETS_HOST,
    `Expected Cloudflare asset host ${ASSETS_HOST}, got ${base.origin}`);
  const checks = [];
  async function request(url, method = 'GET', asset = false) {
    const response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'cache-control': 'no-cache' },
    });
    assert.equal(response.status, 200, `${method} ${url}: HTTP ${response.status}`);
    if (asset) {
      assert.equal(response.headers.get('server')?.toLowerCase(), 'cloudflare', `${url}: not served by Cloudflare`);
      assert(response.headers.get('cf-ray'), `${url}: missing Cloudflare request ID`);
      const cors = response.headers.get('access-control-allow-origin');
      assert(cors === '*' || cors === new URL(site).origin, `${url}: browser access (CORS) is missing`);
    }
    checks.push({ url: String(url), method, status: response.status,
      server: response.headers.get('server'), ray: response.headers.get('cf-ray') });
    return response;
  }

  const html = await (await request(site)).text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(match => new URL(match[1], site))
    .filter(url => url.origin === new URL(site).origin && url.pathname.endsWith('.js'));
  assert(scripts.length > 0, 'Live page has no app JavaScript');
  const bundles = [];
  for (const url of scripts) bundles.push(await (await request(url)).text());
  const source = [html, ...bundles].join('\n');
  assert(!/\.netlify\.app\b/i.test(source), 'Live app still contains a Netlify host');
  assert(source.includes(base.href), `Live app is not configured for ${base.href}`);

  const manifest = await (await request(new URL('manifest.json', base), 'GET', true)).json();
  assert(Array.isArray(manifest.paths) && manifest.paths.length > 0, 'Asset manifest has no paths');
  // Probe representative icons, meshes and source textures without downloading large files.
  const samples = [
    manifest.paths.find(path => typeof path === 'string' && path.startsWith('items/') && path.endsWith('.webp')),
    manifest.paths.find(path => typeof path === 'string' && path.startsWith('models/') && path.endsWith('.glb')),
    manifest.paths.find(path => typeof path === 'string' && path.startsWith('models/') && path.endsWith('.rgba.gz.bin')),
  ];
  assert(samples.every(Boolean), 'Manifest is missing an icon, mesh or reconstructed texture');
  for (const path of samples) {
    const url = new URL(path, base);
    assert(url.href.startsWith(base.href), `Asset path escapes release directory: ${path}`);
    await request(url, 'HEAD', true);
  }
  return { checkedAt: new Date().toISOString(), site, assetsBase: base.href,
    manifestFiles: manifest.paths.length, netlifyReferences: 0, checks };
}

export function healthSummary(report) {
  return `## Site health: passed\n\n` +
    `Checked: ${report.checkedAt}\n\n` +
    `- App: ${report.site}\n- Assets: ${report.assetsBase}\n` +
    `- Netlify references in live HTML/app bundle: 0\n` +
    `- Manifest: ${report.manifestFiles} files; icon, mesh and texture probes passed.\n\n` +
    `HTTP availability and host configuration only; this does not grade 3D appearance.\n`;
}
