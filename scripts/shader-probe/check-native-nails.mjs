// Focused real-app check of the native nail preview index. Runs its own headless Edge page against
// the running dev server (never the user's tab), serves the preview index in place of the active one
// through the existing harness, and closes the HMR socket so an edit elsewhere cannot reload it.
//
// Behaviour, not appearance: which item each slot really assembled, the exact source material, the
// body skeleton the nail skins from, glove suppression and restore, removal, legacy-only fallback, and
// that no legacy grey nail tint is compiled into the body while a source nail owns the slot. A few
// closeups are saved for Astra's review; they are not visual acceptance.
//
//   node scripts/shader-probe/check-native-nails.mjs [--no-shots]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE_OUTFIT, outfitUrl, servePreviewIndex, watch, classify, waitIdle, swap, shoot, read } from './coverage-preview-harness.mjs';

const PREVIEW = 'public/models/reconstructed-nails-preview-v1';
const OUT = 'scripts/generated/shader-probe/native-nails-opus-v1/browser-check.json';
const SHOTS = 'visual-diff/reconstructed/native-nails-opus-v1';
const NAILS = '/models/reconstructed-nails-v1/';
const MESH = '/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M';
const GLOVE = 'municipal-gloves-polyester'; // legacy glove whose definition activates HideMesh.NailsCovered
const PAINT = 'bodycosmetics-bodypaint-armsblack-01';
const LEGACY_ONLY = 'bodycosmetics-nails-lavalamp';
const SWAPS = ['bodycosmetics-nails-black-01', 'bodycosmetics-nails-white-01', 'bodycosmetics-nails-red-01',
  'bodycosmetics-nails-metallic-blue', 'bodycosmetics-nails-gradient-orangepurple', 'bodycosmetics-nails-camo',
  'bodycosmetics-nails-flag-usa', 'bodycosmetics-nails-leopard', 'bodycosmetics-nails-solidsplit'];
// A-pose hands sit near x = +-0.68 m at 1.0-1.05 m height.
const CAMERAS = { right: '-1.02,1.22,0.34,-0.68,1.02,0.02', left: '1.02,1.22,0.34,0.68,1.02,0.02' };
const shots = !process.argv.includes('--no-shots');

const supported = read(`${PREVIEW}/supported-items.json`);
const expectedMaterial = Object.fromEntries(supported.ready.filter(r => r.id.startsWith('bodycosmetics-nails-'))
  .map(r => [r.id, r.parts[0].materials.Nails.source]));
for (const id of SWAPS) if (!expectedMaterial[id]) throw new Error(`Preview does not support ${id}`);
if (expectedMaterial[LEGACY_ONLY]) throw new Error(`${LEGACY_ONLY} is expected to stay legacy-only`);

/** What the rig assembled for the nail slot, and every decal program compiled into the scene. */
const state = page => page.evaluate(() => {
  const root = window.__rigRoot;
  const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const inItem = o => { for (let n = o; n; n = n.parent) if (n.userData.rigItemId) return true; return false; };
  // The body is the one skinned mesh outside every equipped item: preserved source or legacy geometry.
  let body;
  root.traverse(o => { if (!body && o.isSkinnedMesh && !inItem(o)) body = o; });
  const driver = new Set(body?.skeleton.bones ?? []);
  const nail = root.children.find(c => c.userData.rigItemId?.startsWith('bodycosmetics-nails-'));
  const meshes = [];
  nail?.traverse(o => {
    if (!o.isMesh) return;
    meshes.push({ visible: shown(o), sourceMesh: o.userData.sourceMesh, skinned: !!o.isSkinnedMesh,
      boundToBody: !!o.skeleton && o.skeleton.bones.every(b => driver.has(b)),
      materials: [].concat(o.material).map(m => ({ source: m.userData.sourceMaterial, instance: m.userData.sourceInstance,
        reconstructed: m.userData.reconstructed === true })) });
  });
  const decals = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m?.userData?.decalPatched) decals.push(m.customProgramCacheKey());
  });
  return { nail: nail?.userData.rigItemId ?? null, nailGroupVisible: nail ? shown(nail) : null, meshes, decals };
});
const nailTint = s => s.decals.some(k => /decal-(?:h-)?(?:[^:]*-)?nails/.test(k.split(':').pop()));

const report = { at: new Date().toISOString(), cases: [], shots: [] };
const cases = report.cases;
const check = (name, condition, detail) => { cases.push({ name, passed: !!condition, detail }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.routeWebSocket('**/*', socket => socket.close());
  const indexRequests = [];
  await servePreviewIndex(page, PREVIEW, { onIndexRequest: file => indexRequests.push(file) });
  const log = watch(page);
  const outfit = extra => ({ ...BASE_OUTFIT, ...extra });
  const equip = async slots => { await swap(page, slots); await waitIdle(page); return state(page); };

  await page.goto(outfitUrl(outfit({ nailPolish: SWAPS[0] }), { cam: CAMERAS.right, extra: '&temporal=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  let s = await state(page);
  const first = s;
  check('black nails render SK_Nails_M with the exact source material', s.nail === SWAPS[0] && s.meshes.length > 0 &&
    s.meshes.every(m => m.visible && m.sourceMesh === MESH && m.skinned && m.boundToBody &&
      m.materials.every(x => x.reconstructed && x.source === expectedMaterial[SWAPS[0]])), s);
  check('no legacy grey nail tint while the source nail owns the slot', !nailTint(s), s.decals);
  check('garment body-hide masks stay active with nails equipped', s.decals.some(k => /decal-h-/.test(k)), s.decals);
  if (shots) { report.shots.push(await shoot(page, `${SHOTS}/black-01-right.png`)); }

  for (const id of SWAPS.slice(1)) {
    s = await equip(outfit({ nailPolish: id }));
    check(`swap to ${id}`, s.nail === id && s.meshes.length === first.meshes.length && s.meshes.every(m => m.visible &&
      m.boundToBody && m.materials.every(x => x.reconstructed && x.source === expectedMaterial[id])) && !nailTint(s),
      { nail: s.nail, materials: s.meshes.map(m => m.materials), tint: nailTint(s) });
    if (shots) report.shots.push(await shoot(page, `${SHOTS}/${id.replace('bodycosmetics-nails-', '')}-right.png`));
  }

  s = await equip(outfit({ nailPolish: SWAPS[0], hands: GLOVE }));
  check('NailsCovered glove suppresses the source nails without the legacy tint', s.nail === SWAPS[0] &&
    s.meshes.every(m => !m.visible) && !nailTint(s), s);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/glove-covered-right.png`));
  s = await equip(outfit({ nailPolish: SWAPS[0] }));
  check('removing the glove restores the source nails', s.nail === SWAPS[0] && s.meshes.length > 0 &&
    s.meshes.every(m => m.visible && m.materials.every(x => x.source === expectedMaterial[SWAPS[0]])) && !nailTint(s), s);

  s = await equip(outfit({ nailPolish: SWAPS[0], bodyPaint: PAINT }));
  check('a source body paint composites beside the source nails', s.nail === SWAPS[0] &&
    s.decals.some(k => /bodyc/.test(k)) && !nailTint(s), s.decals);

  s = await equip(outfit({}));
  check('removing nail polish leaves no nail geometry and no nail tint', s.nail === null && !nailTint(s), s);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/bare-right.png`));

  s = await equip(outfit({ nailPolish: LEGACY_ONLY }));
  check('a deferred nail keeps its explicit legacy tint and no source geometry', s.nail === null && nailTint(s), s.decals);
  s = await equip(outfit({ nailPolish: SWAPS[0] }));
  check('legacy to source swap removes the legacy tint', s.nail === SWAPS[0] && s.meshes.every(m => m.visible) && !nailTint(s), s.decals);
  s = await equip(outfit({ nailPolish: LEGACY_ONLY }));
  check('source to legacy swap removes the source geometry', s.nail === null && nailTint(s), s);

  // Explicit diagnostic modes. Legacy body (sourceFitting=0): source nails behave like the other
  // skinned source garments and follow that body's driver. Source assembly off: the complete
  // legacy comparison keeps the old grey tint and loads no source nail.
  await page.goto(outfitUrl(outfit({ nailPolish: SWAPS[0] }), { cam: CAMERAS.right, extra: '&temporal=0&sourceFitting=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  s = await state(page);
  check('legacy body mode keeps source nails on its driver skeleton', s.nail === SWAPS[0] && s.meshes.length > 0 &&
    s.meshes.every(m => m.visible && m.boundToBody) && !nailTint(s), s);
  await page.goto(outfitUrl(outfit({ nailPolish: SWAPS[0] }), { cam: CAMERAS.right, extra: '&temporal=0&sourceAssembly=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  s = await state(page);
  check('source-assembly-off comparison keeps the legacy tint and no source nail', s.nail === null && nailTint(s), s.decals);

  // Both hands for designs whose left and right colours differ (Christmas Elf) or whose left-hand
  // pattern is mirrored (Australia). Each view needs a fresh page load for its pinned camera.
  if (shots) for (const id of ['bodycosmetics-nails-christmaself-01', 'bodycosmetics-nails-flag-australia']) {
    for (const [side, cam] of Object.entries(CAMERAS)) {
      await page.goto(outfitUrl(outfit({ nailPolish: id }), { cam, extra: '&temporal=0' }), { waitUntil: 'networkidle' });
      await waitIdle(page);
      s = await state(page);
      check(`${id} ${side} hand view`, s.nail === id && s.meshes.every(m => m.visible) && !nailTint(s), { nail: s.nail });
      report.shots.push(await shoot(page, `${SHOTS}/${id.replace('bodycosmetics-nails-', '')}-${side}.png`));
    }
  }

  const requests = classify(log);
  requests.errors = requests.errors.filter(e => !e.startsWith('[vite] failed to connect to websocket'));
  const nailRequests = log.requests.filter(r => r.url.includes(NAILS));
  check('no page errors or failed requests', !requests.errors.length && !requests.failedRequests.length, requests);
  check('nail mesh and materials load from the native nail runtime folder', nailRequests.some(r => r.url.endsWith('/meshes/SK_Nails_M.glb') && r.status === 200) &&
    nailRequests.every(r => r.outcome === 'finished' && r.status < 400), nailRequests.map(r => `${r.status} ${new URL(r.url).pathname}`));
  check('the preview index was served in place of the active one', indexRequests.length > 0, [...new Set(indexRequests)]);
  report.requests = { ...requests, nail: nailRequests.length };
} finally {
  report.passed = report.cases.length > 0 && report.cases.every(c => c.passed);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync('scripts/generated/shader-probe/native-nails-opus-v1', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(report.passed ? `PASS: ${report.cases.length} native nail cases` : `FAIL: see ${OUT}`);
if (!report.passed) process.exitCode = 1;
