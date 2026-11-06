// HTTP health check of the live app and every asset host it is built against (.github/workflows/site-health.yml).
//
// The expected hosts are read from the files the deploy itself reads: the build env in deploy.yml and the committed
// reconstruction routes file. A release that swaps hosts therefore needs no edit here, and a live bundle that does
// not match them means main's latest deploy did not reach the site.
//
// HTTP availability and configuration only. Rendering stays with the release scenarios, and large files are
// probed with HEAD so a run downloads about 1 MB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactReconstructionRoutes, joinBase, modelBase, parseReconstructionRoutes } from '../../src/lib/asset-routing.mjs';

export const SITE_URL = 'https://chronohaxx.github.io/the-finals-outfit/';
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
// Files every source-mode outfit loads before any item: the body mesh (CharacterViewer.tsx) and the assembly index
// (SourceAssembly.ts, from modelUrl("models/reconstructed-assemblies-v1")). The test pins them to that code.
export const ALWAYS_LOADED = ['models/reconstructed-meshes-v2/SK_Body_M.glb',
  'models/reconstructed-assemblies-v1/supported-items.json'];
const USER_AGENT = 'the-finals-outfit-site-health (+https://github.com/ChronoHaxx/the-finals-outfit)';
const DAY = 86_400;

/** The literal value of `  NAME: value` in a workflow file, or '' when unset or blank. */
export function workflowEnv(text, name) {
  const values = [...text.matchAll(new RegExp(`^[ \\t]+${name}:[ \\t]*(.*?)[ \\t]*$`, 'gm'))]
    .map(match => match[1].replace(/[ \t]+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim());
  assert(new Set(values).size <= 1, `deploy.yml sets ${name} to different values: ${values.join(', ')}`);
  assert(!values[0]?.includes('${{'), `deploy.yml's ${name} is an expression, not a literal URL: ${values[0]}`);
  return values[0] ?? '';
}

function httpsBase(name, value) {
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.search && !url.hash, `${name} must be a plain https URL: ${value}`);
  return joinBase(value, '');
}

/** The hosts the live app should be built against, from deploy.yml and the routes file it names. */
export function readDeployConfig({ root = REPO_ROOT,
  workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8'),
  readFile = path => readFileSync(resolve(root, path), 'utf8') } = {}) {
  const env = name => workflowEnv(workflow, name);
  const raw = { assets: env('ASSETS_BASE'), models: env('MODELS_BASE'), reconstruction: env('RECONSTRUCTION_BASE'),
    animations: env('ANIMATIONS_BASE'), sharePreview: env('SHARE_PREVIEW_BASE') };
  assert(raw.assets, 'deploy.yml sets no ASSETS_BASE');
  const routesFile = env('RECONSTRUCTION_ROUTES_FILE');
  const routesJson = routesFile ? JSON.parse(readFile(routesFile)) : {};
  const bases = {
    assetsBase: httpsBase('ASSETS_BASE', raw.assets),
    modelsBase: raw.models ? httpsBase('MODELS_BASE', raw.models) : undefined,
    reconstructionBase: raw.reconstruction ? httpsBase('RECONSTRUCTION_BASE', raw.reconstruction) : undefined,
    reconstructionRoutes: parseReconstructionRoutes(routesJson),
  };
  const routed = compactReconstructionRoutes(bases.reconstructionRoutes).hosts;
  const hosts = [
    { role: 'icons', base: bases.assetsBase },
    bases.modelsBase && { role: 'models', base: bases.modelsBase },
    bases.reconstructionBase && { role: 'reconstruction control shard', base: bases.reconstructionBase },
    ...routed.map(host => ({ role: `reconstruction shard (${host.prefixes.length} routed prefixes)`, base: host.baseUrl })),
  ].filter(Boolean);
  const animationsBase = raw.animations ? httpsBase('ANIMATIONS_BASE', raw.animations) : null;
  // The strings the build inlines verbatim (vite's import.meta.env and the routes JSON): the live bundle must name each.
  const routedBases = routesJson.formatVersion === 1 ? routesJson.hosts.map(host => host.baseUrl) : Object.values(routesJson);
  const bundleStrings = [raw.assets, raw.models, raw.reconstruction, raw.animations, raw.sharePreview, ...routedBases]
    .filter(Boolean);
  return { bases, hosts, animationsBase, sharePreviewBase: raw.sharePreview || null,
    bundleStrings: [...new Set(bundleStrings)] };
}

/** One file per host, in a stable order: the always-loaded files first, then every catalogue icon and model path,
 *  routed exactly as the app routes them (assets.ts). Meshes are preferred. A host none of them reaches falls back
 *  to its deployment manifest, which still proves the deployment is up. */
export function sampleAssets(items, config) {
  const candidates = [...ALWAYS_LOADED];
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (value.startsWith('models/') || (key === 'imageUrl' && value.startsWith('items/'))) candidates.push(value);
    } else if (Array.isArray(value)) value.forEach(entry => walk(entry, key));
    else if (value && typeof value === 'object') for (const [k, entry] of Object.entries(value)) walk(entry, k);
  };
  walk(items);
  const hostOf = path => path.startsWith('models/') ? joinBase(modelBase(path, config.bases), '') : config.bases.assetsBase;
  const byHost = new Map();
  for (const path of candidates) {
    const host = hostOf(path);
    const current = byHost.get(host);
    if (!current || (!current.endsWith('.glb') && path.endsWith('.glb'))) byHost.set(host, path);
  }
  return config.hosts.map(host => ({ ...host, path: byHost.get(host.base) ?? 'manifest.json',
    fromCatalogue: byHost.has(host.base) }));
}

const EXPECTED_TYPES = { glb: /^(model\/gltf-binary|application\/octet-stream)/, webp: /^image\/webp/,
  png: /^image\/png/, json: /^application\/json/, bin: /^application\/octet-stream/ };

/** Fetch the live app and probe every expected host. Throws on the first failure. */
export async function checkSiteHealth({ site = SITE_URL, config = readDeployConfig(),
  items = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/data/items.json'), 'utf8')), fetcher = fetch } = {}) {
  const origin = new URL(site).origin;
  const checks = [];

  async function request(role, url, { method = 'GET', asset = false } = {}) {
    url = String(url);
    const response = await fetcher(url, { method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': USER_AGENT, ...(asset ? { origin } : {}) } });
    const header = name => response.headers.get(name);
    checks.push({ role, method, url, status: response.status, contentType: header('content-type'),
      cacheControl: header('cache-control'), server: header('server'), ray: header('cf-ray') });
    assert.equal(response.status, 200, `${role}: ${method} ${url} returned HTTP ${response.status}`);
    if (asset) {
      const type = header('content-type') ?? '';
      // Cloudflare Pages answers a missing file with a 404 page, but an SPA fallback would be a 200 page.
      assert(!/^text\/html/i.test(type), `${role}: ${url} returned an HTML page, not the file`);
      const expected = EXPECTED_TYPES[url.split('?')[0].split('.').pop()];
      if (expected) assert.match(type, expected, `${role}: ${url} has content type ${type}`);
      const cors = header('access-control-allow-origin');
      assert(cors === '*' || cors === origin, `${role}: ${url} does not allow browsers on ${origin} to read it (CORS)`);
      const maxAge = Number(/max-age=(\d+)/.exec(header('cache-control') ?? '')?.[1] ?? 0);
      assert(maxAge >= DAY, `${role}: ${url} is cached for ${maxAge} s; immutable assets should be cached for a year`);
    }
    return response;
  }

  // The app: its HTML, entry script, stylesheet and the catalogue files preloaded beside the entry chunk.
  const html = await (await request('app page', site)).text();
  const attribute = (tag, name) => new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(match => match[0]);
  const local = href => href && new URL(href, site).origin === origin ? new URL(href, site) : null;
  const scripts = tags.filter(tag => /^<script/i.test(tag)).map(tag => local(attribute(tag, 'src'))).filter(Boolean);
  const styles = tags.filter(tag => /rel=["']stylesheet/i.test(tag)).map(tag => local(attribute(tag, 'href'))).filter(Boolean);
  const preloads = tags.filter(tag => /rel=["']preload/i.test(tag) && /as=["']fetch/i.test(tag))
    .map(tag => local(attribute(tag, 'href'))).filter(Boolean);
  assert(scripts.length > 0, 'The live page has no app script');
  assert(preloads.some(url => url.pathname.endsWith('.json')), 'The live page preloads no catalogue files');
  const bundles = [];
  for (const url of scripts) bundles.push(await (await request('app script', url)).text());
  for (const url of styles) await request('app stylesheet', url, { method: 'HEAD' });
  for (const url of preloads) {
    const response = await request('catalogue file', url, { method: 'HEAD' });
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/, `${url} is not JSON`);
  }

  // Is the live app the build of main's deploy.yml? Each configured host must be inlined, and no other asset host.
  const source = [html, ...bundles].join('\n');
  const missing = config.bundleStrings.filter(value => !source.includes(value));
  assert.deepEqual(missing, [], `The live app was not built with main's deploy.yml hosts (missing ${missing.join(', ')}). ` +
    'The latest deploy may have failed or not finished.');
  const expectedHosts = new Set([...config.hosts.map(host => new URL(host.base).hostname),
    ...(config.animationsBase ? [new URL(config.animationsBase).hostname] : [])]);
  const foreign = [...new Set([...source.matchAll(/https?:\/\/([a-z0-9.-]+\.(?:pages\.dev|netlify\.app))\b/gi)]
    .map(match => match[1].toLowerCase()))].filter(host => !expectedHosts.has(host));
  assert.deepEqual(foreign, [], `The live app names asset hosts deploy.yml does not: ${foreign.join(', ')}`);

  // One file from every icon, model and reconstruction host, with HEAD: meshes run to 20 MB.
  const samples = sampleAssets(items, config);
  for (const sample of samples) await request(sample.role, new URL(sample.path, sample.base), { method: 'HEAD', asset: true });

  // The showcase animation: the app hides its controls when the clip manifest is missing or empty.
  let animation = null;
  if (config.animationsBase) {
    const manifestUrl = new URL('manifest.json', config.animationsBase);
    const manifest = await (await request('animations', manifestUrl, { asset: true })).json();
    assert(manifest?.formatVersion === 1 && Array.isArray(manifest.clips) && manifest.clips.length > 0,
      `animations: ${manifestUrl} lists no clips, so the app hides the animation controls`);
    const idle = manifest.clips.find(clip => clip.id === manifest.defaultIdle) ?? manifest.clips[0];
    await request('animations', new URL(`${manifest.base ?? ''}${idle.file}`, config.animationsBase), { method: 'HEAD', asset: true });
    animation = { clips: manifest.clips.length, idle: idle.id, props: 0 };
    if (manifest.props) {
      const propsUrl = new URL(manifest.props, config.animationsBase);
      const props = await (await request('animation props', propsUrl, { asset: true })).json();
      const actors = Object.values(props?.actors ?? {});
      assert(actors.length > 0, `animation props: ${propsUrl} lists no props`);
      await request('animation props', new URL(actors[0].file, propsUrl), { method: 'HEAD', asset: true });
      animation.props = actors.length;
    }
  }

  return { checkedAt: new Date().toISOString(), site, bundles: scripts.map(url => url.pathname.split('/').pop()),
    catalogueFiles: preloads.length, hosts: samples, animationsBase: config.animationsBase, animation,
    sharePreviewBase: config.sharePreviewBase, checks };
}

export function healthSummary(report) {
  const label = base => `\`${new URL(base).hostname.split('.')[0]}\``;
  const rows = report.hosts.map(host =>
    `| ${host.role} | ${label(host.base)} | \`${host.path}\`${host.fromCatalogue ? '' : ' (deployment only)'} |`);
  if (report.animation) rows.push(`| animations | ${label(report.animationsBase)} | ` +
    `${report.animation.clips} clips, idle \`${report.animation.idle}\`, ${report.animation.props} props |`);
  return `## Site health: passed\n\nChecked ${report.checkedAt}: ${report.site}\n\n` +
    `- App: \`${report.bundles.join('`, `')}\` names every host in main's deploy.yml and no other asset host; ` +
    `${report.catalogueFiles} preloaded catalogue files respond.\n` +
    `- ${report.checks.length} requests, all HTTP 200; assets allow cross-origin reads and are cached for at least a day.\n\n` +
    `| Host | Deployment | Sample |\n| --- | --- | --- |\n${rows.join('\n')}\n\n` +
    `HTTP availability and configuration only; this does not render the outfit.\n`;
}
