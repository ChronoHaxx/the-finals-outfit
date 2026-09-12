// Focused real-app check of the accessory preview index. Runs its own headless Edge page against the
// running dev server (never the user's tab), serves the preview index in place of the active one, and
// closes the HMR socket so an edit elsewhere cannot reload it.
//
// Behaviour, not appearance: which item each slot really assembled, the exact source mesh and material,
// the body socket and authored scale each static part attaches with, hair hide and restore under
// headwear, removal, reload, and that native nails, body paint and the ordinary outfit still work.
//
//   node scripts/shader-probe/check-accessories.mjs [--no-shots]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE_OUTFIT, outfitUrl, servePreviewIndex, watch, classify, waitIdle, swap, shoot, read } from './coverage-preview-harness.mjs';

const PREVIEW = 'public/models/reconstructed-accessories-preview-v1';
const OUT = 'scripts/generated/shader-probe/accessory-opus-v1/browser-check.json';
const SHOTS = 'visual-diff/reconstructed/accessories-opus-v1/checks';
const RUNTIME = '/models/reconstructed-accessories-v1/';
const NAIL = 'bodycosmetics-nails-black-01';
const PAINT = 'bodycosmetics-bodypaint-armsblack-01';
const HAIR_MESH = '/Game/Discovery/Characters/Hairs/AfroFade/SM_AfroFade.SM_AfroFade';
const UNDER_HAT_MESH = '/Game/Discovery/Characters/Hairs/AfroFade/SM_AfroFade_UnderHat.SM_AfroFade_UnderHat';
// Materially different choices: plain surface, vertex-tinted (UseColorTint), two mesh slots, skinned
// native parts, a non-uniform authored scale, a uniform scale, and the eyewear slot.
const SWAPS = [
  ['facewear', 'attachment-asianmask'], ['facewear', 'attachment-mask-welding-01-headwear-pink'],
  ['facewear', 'attachment-mask-welding-01-headwear-black'], ['facewear', 'attachment-cardboardboxmask'],
  ['facewear', 'attachment-mask-ballistic-01-headwear-darkgreen'], ['headwear', 'attachment-ballistichelmet-visordown'],
  ['headwear', 'attachment-cowmascothead-cotton'], ['headwear', 'attachment-rubberchickenheadpunk'],
  ['headwear', 'military-cardboardhelmet'], ['headwear', 'attachment-skateboardhelmet'],
  ['eyewear', 'attachment-shootingglasses-a-metal'], ['facewear', 'attachment-keyartmask-headwear-red'],
];
const HIDES_HAIR = 'attachment-skateboardhelmet';      // activates Shape.PushHair.hat_covers_head
const UNDER_HAT = 'attachment-mask-welding-01-headwear-pink'; // activates Shape.PushHair.hat_covers_upper_hair
const shots = !process.argv.includes('--no-shots');

const supported = read(`${PREVIEW}/supported-items.json`);
const implemented = new Set(read(`${PREVIEW}/preview.json`).implemented);
const expected = new Map(supported.ready.filter(r => implemented.has(r.id)).map(r => [r.id, r]));
for (const [, id] of SWAPS) if (!expected.has(id)) throw new Error(`Preview does not implement ${id}`);

/** What the rig assembled: every item group, its parts, sockets, authored scale and materials. */
const state = page => page.evaluate(() => {
  const root = window.__rigRoot;
  const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const inItem = o => { for (let n = o; n; n = n.parent) if (n.userData.rigItemId) return true; return false; };
  let body;
  root.traverse(o => { if (!body && o.isSkinnedMesh && !inItem(o)) body = o; });
  const driver = new Set(body?.skeleton.bones ?? []);
  const items = root.children.filter(c => c.userData.rigItemId).map(group => {
    const meshes = [];
    group.traverse(o => {
      if (!o.isMesh) return;
      const box = new window.__THREE.Box3().setFromObject(o);
      // A native skinned accessory keeps its own extra bones (ears, jaws); the rig re-parents those
      // branches under a driver bone, so "follows the body" means every bone is rooted in the driver.
      const bones = o.skeleton?.bones ?? [];
      const rooted = b => { for (let n = b; n; n = n.parent) if (driver.has(n)) return true; return false; };
      meshes.push({ visible: shown(o), sourceMesh: o.userData.sourceMesh ?? null, skinned: !!o.isSkinnedMesh,
        socket: o.userData.sourceStaticAttachment ?? null, scale: o.userData.sourceAttachmentScale ?? null,
        bones: bones.length, driverBones: bones.filter(b => driver.has(b)).length,
        rootedInBody: bones.length > 0 && bones.every(rooted),
        box: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
        materials: [].concat(o.material).map(m => ({ source: m.userData.sourceMaterial ?? null,
          instance: m.userData.sourceInstance ?? null, reconstructed: m.userData.reconstructed === true,
          doubleSided: m.side === window.__THREE.DoubleSide })) });
    });
    return { id: group.userData.rigItemId, sourceAssembly: !!group.userData.sourceAssembly,
      sourceSkinPair: !!group.userData.sourceSkinPair, groupVisible: shown(group), meshes };
  });
  const decals = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m?.userData?.decalPatched) decals.push(m.customProgramCacheKey());
  });
  return { items, decals };
});

const find = (s, id) => s.items.find(i => i.id === id);
const nailTint = s => s.decals.some(k => /decal-(?:h-)?(?:[^:]*-)?nails/.test(k.split(':').pop()));
const report = { at: new Date().toISOString(), preview: PREVIEW, cases: [], shots: [], observations: [] };
const check = (name, condition, detail) => {
  report.cases.push({ name, passed: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
};

/** The assembled item must match the index entry exactly: meshes, materials, sockets and scale. */
function verify(s, id) {
  const want = expected.get(id), got = find(s, id);
  const problems = [];
  if (!got) return { problems: ['no assembly attached'], observed: null };
  if (!got.sourceAssembly) problems.push('attached through a non-source path');
  if (!got.groupVisible) problems.push('assembly group hidden');
  const wantMeshes = want.parts.map(p => p.sourceMesh).sort();
  const gotMeshes = [...new Set(got.meshes.map(m => m.sourceMesh))].sort();
  if (String(wantMeshes) !== String(gotMeshes)) problems.push(`meshes ${gotMeshes} != ${wantMeshes}`);
  const wantMaterials = [...new Set(want.parts.flatMap(p => Object.values(p.materials).map(m => m.source)))].sort();
  const gotMaterials = [...new Set(got.meshes.flatMap(m => m.materials.map(x => x.source)))].sort();
  if (String(wantMaterials) !== String(gotMaterials)) problems.push(`materials ${gotMaterials} != ${wantMaterials}`);
  if (got.meshes.some(m => !m.visible)) problems.push('a section is not visible');
  if (got.meshes.some(m => m.materials.some(x => !x.reconstructed))) problems.push('a slot is not a reconstructed source material');
  for (const part of want.parts) {
    const sections = got.meshes.filter(m => m.sourceMesh === part.sourceMesh);
    if (!sections.length) { problems.push(`no section for ${part.sourceMesh}`); continue; }
    if (part.attachment) {
      // The rig stores the authored scale in GLB axes (X, Z, Y); unit scale keeps the loaded geometry.
      const [x, y, z] = part.attachment.scale;
      const wanted = x === 1 && y === 1 && z === 1 ? null : [x, z, y];
      for (const section of sections) {
        if (section.socket !== part.attachment.socket) problems.push(`socket ${section.socket} != ${part.attachment.socket}`);
        if (String(section.scale) !== String(wanted)) problems.push(`authored scale ${section.scale} != ${wanted}`);
        if (!section.skinned || section.bones !== 1 || section.driverBones !== 1)
          problems.push(`attached part does not ride one driver bone (${section.driverBones}/${section.bones})`);
      }
    } else if (sections.some(m => !m.rootedInBody || !m.driverBones))
      problems.push(`${part.sourceMesh} does not follow the body skeleton `
        + `(${sections.map(m => `${m.driverBones}/${m.bones} driver bones, rooted=${m.rootedInBody}`)})`);
  }
  return { problems, observed: got };
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  await page.routeWebSocket('**/*', socket => socket.close());
  const indexRequests = [];
  await servePreviewIndex(page, PREVIEW, { onIndexRequest: file => indexRequests.push(file) });
  const log = watch(page);
  const outfit = extra => ({ ...BASE_OUTFIT, ...extra });
  const equip = async slots => { await swap(page, slots); await waitIdle(page); return state(page); };
  const HEAD_CAM = '0,1.62,1.15,0,1.62,0';

  await page.goto(outfitUrl(outfit({ facewear: SWAPS[0][1] }), { cam: HEAD_CAM, extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  let s = await state(page);
  let result = verify(s, SWAPS[0][1]);
  check(`${SWAPS[0][1]} assembles from source with its exact mesh, material and head socket`, !result.problems.length, result);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/${SWAPS[0][1]}.png`));

  for (const [slot, id] of SWAPS.slice(1)) {
    s = await equip(outfit({ [slot]: id }));
    result = verify(s, id);
    check(`swap to ${id}`, !result.problems.length, result);
    // Fitting evidence for review: where the assembled part actually sits on the body.
    report.observations.push({ id, slot, boxes: result.observed?.meshes.map(m => m.box) ?? null,
      doubleSided: result.observed?.meshes.some(m => m.materials.some(x => x.doubleSided)) ?? null });
    if (shots) report.shots.push(await shoot(page, `${SHOTS}/${id}.png`));
  }

  // Head accessories sit on the head socket: their assembled bounds must be in the head region.
  const heads = report.observations.filter(o => o.slot !== 'wrist' && o.boxes?.length);
  check('assembled head accessories sit in the head region', heads.every(o =>
    o.boxes.every(b => b && b.min[1] > 1.2 && b.max[1] < 2.2 && Math.abs(b.min[0]) < 0.6 && Math.abs(b.max[0]) < 0.6)),
    heads.map(o => ({ id: o.id, boxes: o.boxes })));

  s = await equip(outfit({}));
  check('removing every accessory leaves no accessory assembly', !SWAPS.some(([, id]) => find(s, id)), s.items.map(i => i.id));

  // Hair hide and restore come from the source tag rules the headwear activates.
  s = await equip(outfit({ headwear: HIDES_HAIR }));
  let hair = find(s, 'hairs-afrofade');
  check('headwear that covers the head hides the source hair', !!find(s, HIDES_HAIR) && !!hair && !hair.groupVisible,
    { hairVisible: hair?.groupVisible, hairMeshes: hair?.meshes.map(m => m.sourceMesh) });
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/hair-hidden.png`));
  s = await equip(outfit({}));
  hair = find(s, 'hairs-afrofade');
  check('removing it restores the source hair', !!hair && hair.groupVisible && hair.meshes.some(m => m.sourceMesh === HAIR_MESH),
    { hairVisible: hair?.groupVisible, hairMeshes: hair?.meshes.map(m => m.sourceMesh) });
  s = await equip(outfit({ facewear: UNDER_HAT }));
  hair = find(s, 'hairs-afrofade');
  check('a hat-covers-upper-hair mask swaps the hair to its under-hat mesh', !!hair && hair.groupVisible &&
    hair.meshes.length > 0 && hair.meshes.every(m => m.sourceMesh === UNDER_HAT_MESH),
    { hairMeshes: hair?.meshes.map(m => m.sourceMesh) });
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/hair-under-hat.png`));

  // Nearby workflows: native nails, body paint and the ordinary source outfit keep working.
  s = await equip(outfit({ facewear: SWAPS[0][1], nailPolish: NAIL }));
  const nail = find(s, NAIL);
  check('native nails still assemble beside an accessory', !!nail && nail.meshes.length > 0 &&
    nail.meshes.every(m => m.visible && m.materials.every(x => x.reconstructed)) && !nailTint(s) && !!find(s, SWAPS[0][1]),
    { nail: nail?.meshes.map(m => m.sourceMesh), tint: nailTint(s) });
  s = await equip(outfit({ facewear: SWAPS[0][1], bodyPaint: PAINT }));
  check('a source body paint still composites beside an accessory', s.decals.some(k => /bodyc/.test(k)) && !!find(s, SWAPS[0][1]), s.decals);
  const garments = [BASE_OUTFIT.upperBody, BASE_OUTFIT.lowerBody, BASE_OUTFIT.feet, BASE_OUTFIT.hair, BASE_OUTFIT.face];
  check('the ordinary source outfit still assembles with an accessory worn', garments.every(id => {
    const item = find(s, id);
    return item && (item.sourceAssembly || item.sourceSkinPair) && item.meshes.some(m => m.visible);
  }), garments.map(id => ({ id, meshes: find(s, id)?.meshes.length ?? 0 })));

  // A fresh load of a saved outfit must rebuild the same accessory from the same files.
  await page.goto(outfitUrl(outfit({ headwear: 'attachment-ballistichelmet-visordown' }), { cam: HEAD_CAM, extra: '&temporal=0' }),
    { waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  s = await state(page);
  result = verify(s, 'attachment-ballistichelmet-visordown');
  check('reloading a saved outfit rebuilds the two-slot helmet from source', !result.problems.length, result);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/reload-helmet.png`));

  const requests = classify(log);
  requests.errors = requests.errors.filter(e => !e.startsWith('[vite] failed to connect to websocket'));
  const accessoryRequests = log.requests.filter(r => r.url.includes(RUNTIME));
  check('no page errors or failed requests', !requests.errors.length && !requests.failedRequests.length, requests);
  check('accessory meshes and materials load from the accessory runtime folder',
    accessoryRequests.some(r => r.url.includes('/meshes/') && r.status === 200) &&
    accessoryRequests.some(r => r.url.includes('/materials/') && r.status === 200) &&
    accessoryRequests.every(r => r.outcome === 'finished' && r.status < 400),
    [...new Set(accessoryRequests.map(r => `${r.status} ${new URL(r.url).pathname}`))].slice(0, 12));
  check('the preview index was served in place of the active one', indexRequests.length > 0, [...new Set(indexRequests)]);
  report.requests = { ...requests, accessory: accessoryRequests.length };
} finally {
  report.passed = report.cases.length > 0 && report.cases.every(c => c.passed);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync('scripts/generated/shader-probe/accessory-opus-v1', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(report.passed ? `PASS: ${report.cases.length} accessory cases` : `FAIL: see ${OUT}`);
if (!report.passed) process.exitCode = 1;
