// Focused compile check for the remaining source paint contracts in the real app. Runs its own
// headless Edge page against the running dev server, never the user's tab, with the HMR socket
// closed so an edit elsewhere cannot reload it mid-run. Each of the eight paints is equipped on the
// base face; recorded per paint are page/shader errors, the decal program keys the body and head
// materials actually carry, and the prepared PNG requests. No screenshots: appearance is Astra's.
//
//   node scripts/shader-probe/compile-remaining-paints.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { outfitUrl, waitIdle, swap, watch, classify } from './coverage-preview-harness.mjs';

const OUT = 'scripts/generated/shader-probe/paint-contracts-opus-v1/compile-check.json';
const ASSETS = '/models/reconstructed-paint-contracts-v1/';
const SKIN = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const IDS = [
  'bodycosmetics-bodypaint-90sskateboarder-01',
  'bodycosmetics-bodypaint-armsblack-01',
  'bodycosmetics-bodypaint-bruises-02',
  'bodycosmetics-bodypaint-oilyhands-01',
  'bodycosmetics-bodypaint-runnyfingersblack-01',
  'bodycosmetics-bodypaint-runnyfingersgold-01',
  'bodycosmetics-bodypaint-sweat-01',
  'bodycosmetics-bodypaint-techwearsymbols-01',
];
const catalog = JSON.parse(fs.readFileSync('src/data/items.json', 'utf8'));

// The signature BodyDecals compiles for a catalog layer (BodyDecalManager.patch), new fields included.
const signature = (l) => `${l.target}c${l.surfacePath ? 'b' : ''}u${l.uv}s${l.uvScale.join('x')}p` +
  `${l.uvOffsetX ? `x${l.uvOffsetX}` : ''}o${l.colorOverride}*${l.colorMultiply === 'nonMasked' ? 'n' : 'm'}`;

/** Every decal-patched material under the rig with the signature part of its program key. */
const decalPrograms = (page) => page.evaluate(() => {
  const out = [];
  window.__rigRoot.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m?.userData?.decalPatched) continue;
      const match = /decal-(.*)-\d+$/.exec(m.customProgramCacheKey());
      out.push({ mesh: o.name, material: m.name, signature: match ? match[1] : null });
    }
  });
  return out;
});

const report = { at: new Date().toISOString(), cases: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const log = watch(page);
  await page.goto(outfitUrl(SKIN, { cam: '0,0.95,4.3,0,0.95,0', extra: '&temporal=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  for (const id of IDS) {
    const errorsBefore = log.errors.length;
    const started = Date.now();
    await swap(page, { ...SKIN, bodyPaint: id });
    await waitIdle(page);
    const programs = await decalPrograms(page);
    const layers = catalog.find((i) => i.id === id).decal.layers;
    const expected = layers.map((l) => ({ target: l.target, signature: signature(l) }));
    const found = expected.map((e) => ({ ...e, compiled: programs.some((p) => p.signature?.includes(e.signature)) }));
    const assets = log.requests.filter((r) => r.url.includes(ASSETS) && r.url.includes(id));
    report.cases.push({ id, ms: Date.now() - started, expected: found, programs,
      assets: assets.map((r) => `${r.outcome} ${r.status} ${new URL(r.url).pathname}`),
      errors: log.errors.slice(errorsBefore) });
    console.log(`${id}: ${found.map((f) => `${f.target} ${f.compiled ? 'compiled' : 'MISSING'} ${f.signature}`).join('; ')}`);
  }
  await swap(page, SKIN);
  await waitIdle(page);
  const leftover = (await decalPrograms(page)).filter((p) => /\*[nm]|x-1/.test(p.signature ?? ''));
  report.removal = { leftover };
  report.requests = classify(log);
  // The HMR socket is closed on purpose above; that one diagnostic is expected, every other error fails.
  report.requests.errors = report.requests.errors.filter((e) => !e.startsWith('[vite] failed to connect to websocket'));
  report.passed = report.cases.every((c) => c.expected.every((e) => e.compiled) && !c.errors
    .filter((e) => !e.startsWith('[vite] failed to connect to websocket')).length)
    && !leftover.length && !report.requests.errors.length && !report.requests.failedRequests.length;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(report.passed ? 'PASS: eight paints compiled with their source programs; removal left no contract program'
  : `FAIL: see ${OUT}`);
if (!report.passed) process.exitCode = 1;
