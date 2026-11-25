// The visual-diff harness must say which outfit route it renders (25 Nov 2026 route trap, scripts/visual-diff/README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRouteSwitch, routeFromEnv, settleMs, viewerUrl } from '../scripts/visual-diff/viewer-url.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(ROOT, 'scripts/visual-diff');
const BASE = 'http://localhost:5173';
const Q = 'outfit=1.abc&cam=0,1.1,3,0,1,0&fov=30&pose=a';

test('viewerUrl defaults to the route the site draws, reconstructed=1', () => {
  const url = viewerUrl(BASE, Q, { env: {} });
  assert.equal(url, `${BASE}/?${Q}&reconstructed=1`);
  assert.equal(new URL(url).searchParams.get('cam'), '0,1.1,3,0,1,0');
  assert.equal(viewerUrl(`${BASE}/`, Q, { env: {} }), url, 'a trailing slash on the base changes nothing');
  assert.equal(routeFromEnv({}), 'reconstructed');
});

test('VDIFF_ROUTE=cosmetics is the explicit opt-out, reconstructed=0', () => {
  assert.equal(viewerUrl(BASE, Q, { env: { VDIFF_ROUTE: 'cosmetics' } }), `${BASE}/?${Q}&reconstructed=0`);
  assert.throws(() => viewerUrl(BASE, Q, { env: { VDIFF_ROUTE: 'legacy' } }), /VDIFF_ROUTE must be/);
});

test('VDIFF_QUERY adds switches; it may repeat the route switch only with the same value', () => {
  assert.equal(viewerUrl(BASE, Q, { env: { VDIFF_QUERY: 'bodyType=feminine' } }),
    `${BASE}/?${Q}&reconstructed=1&bodyType=feminine`);
  // the form the C0b review documented keeps working, without a second copy of the switch
  assert.equal(viewerUrl(BASE, Q, { env: { VDIFF_QUERY: 'reconstructed=1' } }), `${BASE}/?${Q}&reconstructed=1`);
  assert.throws(() => viewerUrl(BASE, Q, { env: { VDIFF_QUERY: 'reconstructed=0' } }), /set VDIFF_ROUTE instead/);
  assert.throws(() => viewerUrl(BASE, `${Q}&reconstructed=1`, { env: {} }), /through VDIFF_ROUTE/);
});

test('assertRouteSwitch refuses a URL without exactly one explicit switch', () => {
  assert.throws(() => assertRouteSwitch(`${BASE}/?${Q}`), /lacks one explicit route switch/);
  assert.throws(() => assertRouteSwitch(`${BASE}/?${Q}&reconstructed=yes`), /lacks one explicit route switch/);
  assert.throws(() => assertRouteSwitch(`${BASE}/?${Q}&reconstructed=1&reconstructed=1`), /lacks one explicit/);
  assert.equal(assertRouteSwitch(`${BASE}/?${Q}&reconstructed=0`), `${BASE}/?${Q}&reconstructed=0`);
});

test('the reconstructed route waits for the temporal accumulator; the cosmetics route keeps each script\'s wait', () => {
  assert.equal(settleMs(450, 'reconstructed'), 2500);
  assert.equal(settleMs(3000, 'reconstructed'), 3000);
  assert.equal(settleMs(450, 'cosmetics'), 450);
});

// Every harness script that opens a page must build its URL with viewerUrl: no hand-built viewer query.
test('every visual-diff script that navigates builds its URL with viewerUrl', () => {
  const scripts = readdirSync(HARNESS).filter((f) => /\.m?js$/.test(f) && f !== 'viewer-url.mjs');
  const navigating = [];
  for (const file of scripts) {
    const code = readFileSync(join(HARNESS, file), 'utf8').split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)); // whole-line comments may describe old URLs
    const text = code.join('\n');
    if (!/\.goto\(/.test(text)) continue;
    navigating.push(file);
    assert.match(text, /from ["']\.\/viewer-url\.mjs["']/, `${file} navigates but does not import viewer-url.mjs`);
    const handBuilt = code.filter((line) => /[}\w"'`]\/\?\w|[?&]outfit=|\?cam=/.test(line));
    assert.deepEqual(handBuilt, [], `${file} builds a viewer URL by hand; pass it through viewerUrl()`);
    for (const line of code.filter((l) => /\.goto\(/.test(l)))
      assert.ok(/\.goto\(\s*(viewerUrl\(|url\b|$)/.test(line), `${file}: goto takes something other than viewerUrl(): ${line.trim()}`);
  }
  // the 13 scripts named in README.md, "The route trap"
  assert.ok(navigating.length >= 13, `expected the 13 navigating scripts, found ${navigating.join(', ')}`);
});

// viewer-url.mjs relies on this exact behaviour; if the viewer's switch changes, revisit the harness.
test('the viewer still reads the switch the way viewer-url.mjs assumes', () => {
  const source = readFileSync(join(ROOT, 'src/lib/viewer-dev-params.ts'), 'utf8');
  assert.match(source, /reconstructed: p\.get\("reconstructed"\) !== "0"/, 'production: on unless reconstructed=0');
  assert.match(source, /reconstructed: p\.get\("reconstructed"\) === "1"/, 'dev server: on only with reconstructed=1');
});
