// Focused real-app check of the attachment-frame preview index. Runs its own headless Edge page
// against the running dev server (never the user's tab), serves the preview index in place of the
// active one, and closes the HMR socket so an edit elsewhere cannot reload it.
//
// Behaviour, not appearance: which component each socketed part really attached to, the exact source
// mesh, material, socket and reflected scale, that a mirrored pair lands on opposite sides, that a
// head socket needs the source head and falls back to the ordinary path without it, removal,
// reselection, reload, and that ordinary accessories, native nails, body paint and the outfit still work.
//
//   node scripts/shader-probe/check-accessory-frames-browser.mjs [--no-shots]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE_OUTFIT, outfitUrl, servePreviewIndex, watch, classify, waitIdle, swap, shoot, read } from './coverage-preview-harness.mjs';

const PREVIEW = 'public/models/reconstructed-accessory-frames-preview-v1';
const OUT = 'scripts/generated/shader-probe/accessory-frames-opus-v1/browser-check.json';
const SHOTS = 'visual-diff/reconstructed/accessory-frames-opus-v1/checks';
const RUNTIME = '/models/reconstructed-accessory-frames-v1/';
const OTHER_FACE = 'head-face-02-base';      // a head with no source skin pair: the fallback case
const ORDINARY = 'attachment-asianmask';      // an already accepted ordinary accessory, as a control
const NAIL = 'bodycosmetics-nails-black-01';
const PAINT = 'bodycosmetics-bodypaint-armsblack-01';
const shots = !process.argv.includes('--no-shots');

const supported = read(`${PREVIEW}/supported-items.json`);
const implemented = read(`${PREVIEW}/preview.json`).implemented;
const expected = new Map(supported.ready.filter(r => implemented.includes(r.id)).map(r => [r.id, r]));
const catalog = new Map(read('src/data/items.json').map(i => [i.id, i]));
const SELECTIONS = implemented.map(id => [catalog.get(id).slot, id]);
const EARRINGS = implemented.filter(id => catalog.get(id).slot === 'earrings');
if (!EARRINGS.length || implemented.length !== expected.size) throw new Error('Preview cohort is incomplete');

/** What the rig assembled: every item group, its parts, component frames and materials. */
const state = page => page.evaluate(() => {
  const root = window.__rigRoot;
  const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const inItem = o => { for (let n = o; n; n = n.parent) if (n.userData.rigItemId) return true; return false; };
  let body;
  root.traverse(o => { if (!body && o.isSkinnedMesh && !inItem(o)) body = o; });
  const driver = new Set(body?.skeleton.bones ?? []);
  const rooted = b => { for (let n = b; n; n = n.parent) if (driver.has(n)) return true; return false; };
  const items = root.children.filter(c => c.userData.rigItemId).map(group => {
    const meshes = [];
    group.traverse(o => {
      if (!o.isMesh) return;
      const box = new window.__THREE.Box3().setFromObject(o);
      const bones = o.skeleton?.bones ?? [];
      meshes.push({ visible: shown(o), sourceMesh: o.userData.sourceMesh ?? null, skinned: !!o.isSkinnedMesh,
        socket: o.userData.sourceStaticAttachment ?? null, scale: o.userData.sourceAttachmentScale ?? null,
        component: o.userData.sourceAttachmentComponent ?? null,
        boneNames: bones.map(b => b.name), driverBones: bones.filter(b => driver.has(b)).length,
        // A head-socketed part rides a bone the head added under the driver, so "follows the body"
        // means the bone is rooted in the driver even when it is not one of the driver's own.
        rootedInBody: bones.length > 0 && bones.every(rooted),
        box: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
        materials: [].concat(o.material).map(m => ({ source: m.userData.sourceMaterial ?? null,
          reconstructed: m.userData.reconstructed === true, doubleSided: m.side === window.__THREE.DoubleSide })) });
    });
    return { id: group.userData.rigItemId, sourceAssembly: !!group.userData.sourceAssembly,
      sourceSkinPair: !!group.userData.sourceSkinPair, groupVisible: shown(group), meshes };
  });
  // Anything still skinned to a bone that has left the scene graph would be a stranded attachment.
  const stranded = [];
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.userData.sourceStaticAttachment) return;
    for (const b of o.skeleton.bones) if (!rooted(b)) stranded.push(`${o.userData.sourceMesh}:${b.name}`);
  });
  const decals = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m?.userData?.decalPatched) decals.push(m.customProgramCacheKey());
  });
  return { items, decals, stranded };
});

const find = (s, id) => s.items.find(i => i.id === id);
const nailTint = s => s.decals.some(k => /decal-(?:h-)?(?:[^:]*-)?nails/.test(k.split(':').pop()));
const report = { at: new Date().toISOString(), preview: PREVIEW, cases: [], shots: [], observations: [] };
const check = (name, condition, detail) => {
  report.cases.push({ name, passed: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
};

/** The assembled item must match the index entry exactly: meshes, materials, component and socket. */
function verify(s, id) {
  const want = expected.get(id), got = find(s, id);
  const problems = [];
  if (!got) return { problems: ['no assembly attached'], observed: null };
  if (!got.sourceAssembly) problems.push('attached through a non-source path');
  if (!got.groupVisible) problems.push('assembly group hidden');
  const wantMeshes = [...new Set(want.parts.map(p => p.sourceMesh))].sort();
  const gotMeshes = [...new Set(got.meshes.map(m => m.sourceMesh))].sort();
  if (String(wantMeshes) !== String(gotMeshes)) problems.push(`meshes ${gotMeshes} != ${wantMeshes}`);
  const wantMaterials = [...new Set(want.parts.flatMap(p => Object.values(p.materials).map(m => m.source)))].sort();
  const gotMaterials = [...new Set(got.meshes.flatMap(m => m.materials.map(x => x.source)))].sort();
  if (String(wantMaterials) !== String(gotMaterials)) problems.push(`materials ${gotMaterials} != ${wantMaterials}`);
  if (got.meshes.some(m => !m.visible)) problems.push('a section is not visible');
  if (got.meshes.some(m => m.materials.some(x => !x.reconstructed))) problems.push('a slot is not a reconstructed source material');
  if (got.meshes.length < want.parts.length) problems.push(`${got.meshes.length} sections for ${want.parts.length} parts`);
  for (const part of want.parts) {
    const a = part.attachment;
    if (!a) { problems.push(`${part.sourceMesh} has no attachment in the index`); continue; }
    const component = a.frame ? (a.frame.kind === 'head-component' ? a.frame.components[0] : a.frame.component) : null;
    // The rig applies one diagonal: the socket's own scale times the authored part scale, in GLB axes.
    const [x, y, z] = a.scale, [mx, my, mz] = component?.restScale ?? [1, 1, 1];
    const total = [x * mx, z * my, y * mz];
    const wanted = total.every(v => v === 1) ? null : total;
    const sections = got.meshes.filter(m => m.socket === a.socket && m.sourceMesh === part.sourceMesh
      && String(m.scale) === String(wanted));
    if (!sections.length) {
      problems.push(`no section on ${a.socket} for ${part.sourceMesh} with scale ${wanted}`);
      continue;
    }
    for (const section of sections) {
      if (component && String(section.component) !== String([a.frame.kind, component.bone]))
        problems.push(`component ${section.component} != ${[a.frame.kind, component.bone]}`);
      if (component && section.boneNames[0] !== component.bone)
        problems.push(`bone ${section.boneNames[0]} != ${component.bone}`);
      if (!section.skinned || section.boneNames.length !== 1 || !section.rootedInBody)
        problems.push(`attached part does not ride one bone rooted in the body (${section.boneNames})`);
    }
  }
  if (s.stranded.length) problems.push(`stranded attachments: ${s.stranded}`);
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
  const EAR_CAM = '0.55,1.70,0.55,0,1.70,0';
  const BACK_CAM = '0,1.0,-1.9,0,1.0,0';

  const [firstSlot, firstId] = SELECTIONS[0];
  await page.goto(outfitUrl(outfit({ [firstSlot]: firstId }), { cam: EAR_CAM, extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  let s = await state(page);
  let result = verify(s, firstId);
  check(`${firstId} assembles from source on its authored component socket`, !result.problems.length, result);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/${firstId}.png`));

  for (const [slot, id] of SELECTIONS.slice(1)) {
    s = await equip(outfit({ [slot]: id }));
    result = verify(s, id);
    check(`select ${id}`, !result.problems.length, result);
    report.observations.push({ id, slot, boxes: result.observed?.meshes.map(m => m.box) ?? null,
      sockets: result.observed?.meshes.map(m => m.socket) ?? null,
      scales: result.observed?.meshes.map(m => m.scale) ?? null,
      components: result.observed?.meshes.map(m => m.component) ?? null,
      doubleSided: result.observed?.meshes.some(m => m.materials.some(x => x.doubleSided)) ?? null });
  }

  // A mirrored socket puts the same source mesh on the other ear: opposite sides, same height.
  for (const id of EARRINGS) {
    s = await equip(outfit({ earrings: id }));
    const sections = find(s, id).meshes.filter(m => m.box);
    const centres = sections.map(m => m.box.min.map((v, i) => (v + m.box.max[i]) / 2));
    const [left, right] = [centres.find(c => c[0] > 0), centres.find(c => c[0] < 0)];
    const mirrored = sections.filter(m => (m.scale ?? [1, 1, 1])[0] < 0);
    check(`${id} places a mirrored pair on opposite ears`, !!left && !!right && mirrored.length === 1 &&
      Math.abs(left[0] + right[0]) < 0.01 && Math.abs(left[1] - right[1]) < 0.01 && Math.abs(left[2] - right[2]) < 0.01,
      { centres, mirroredSections: mirrored.length, sockets: sections.map(m => m.socket) });
    report.observations.push({ id, slot: 'earrings', centres, mirroredSections: mirrored.length });
  }

  // Head region and lower-back region: a socket mistake shows here before any screenshot does.
  const regions = report.observations.filter(o => o.boxes?.length);
  check('earrings assemble in the ear region and lumbar props on the lower back', regions.every(o =>
    o.boxes.every(b => !b || (o.slot === 'earrings'
      ? b.min[1] > 1.45 && b.max[1] < 1.95 && Math.abs(b.min[0]) < 0.25 && Math.abs(b.max[0]) < 0.25
      : b.min[1] > 0.55 && b.max[1] < 1.45 && b.min[2] < 0))),
    regions.map(o => ({ id: o.id, slot: o.slot, boxes: o.boxes })));

  // The source head is what carries an earring socket. Replacing it with a head that has no source
  // skin pair must leave no stranded attachment, and must not error: the ordinary path takes over.
  const earring = EARRINGS[0];
  s = await equip(outfit({ earrings: earring }));
  check(`${earring} is a source assembly on the source head`, !!find(s, earring)?.sourceAssembly, find(s, earring)?.meshes.length);
  s = await equip(outfit({ earrings: earring, face: OTHER_FACE }));
  const fallback = find(s, earring);
  check('replacing the source head leaves the earring on the ordinary path with nothing stranded',
    !s.stranded.length && (!fallback || !fallback.sourceAssembly),
    { stranded: s.stranded, fallback: fallback && { sourceAssembly: fallback.sourceAssembly, meshes: fallback.meshes.length } });
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/head-replaced-fallback.png`));
  s = await equip(outfit({ earrings: earring }));
  result = verify(s, earring);
  check('returning to the source head restores the source earring', !result.problems.length, result);

  // Removal and reselection.
  s = await equip(outfit({}));
  check('removing every frame accessory leaves none attached',
    !SELECTIONS.some(([, id]) => find(s, id)) && !s.stranded.length, s.items.map(i => i.id));
  s = await equip(outfit({ earrings: earring, lowerBack: 'attachment-boombox-01-finals-lumbar' }));
  check('reselecting an earring and a lumbar prop together assembles both',
    !verify(s, earring).problems.length && !verify(s, 'attachment-boombox-01-finals-lumbar').problems.length,
    { earring: verify(s, earring).problems, prop: verify(s, 'attachment-boombox-01-finals-lumbar').problems });

  // Nearby workflows keep working beside the new attachments.
  s = await equip(outfit({ earrings: earring, lowerBack: 'attachments-oilbarrel-01-lumbar', facewear: ORDINARY, nailPolish: NAIL }));
  const nail = find(s, NAIL);
  check('native nails and an ordinary accessory still assemble beside a frame attachment',
    !!nail && nail.meshes.length > 0 && nail.meshes.every(m => m.visible && m.materials.every(x => x.reconstructed)) &&
    !nailTint(s) && !!find(s, ORDINARY)?.sourceAssembly && !!find(s, earring)?.sourceAssembly,
    { nail: nail?.meshes.map(m => m.sourceMesh), ordinary: !!find(s, ORDINARY)?.sourceAssembly });
  s = await equip(outfit({ earrings: earring, bodyPaint: PAINT }));
  check('a source body paint still composites beside a frame attachment',
    s.decals.some(k => /bodyc/.test(k)) && !!find(s, earring)?.sourceAssembly, s.decals.length);
  const garments = [BASE_OUTFIT.upperBody, BASE_OUTFIT.lowerBody, BASE_OUTFIT.feet, BASE_OUTFIT.hair, BASE_OUTFIT.face];
  check('the ordinary source outfit still assembles with a frame attachment worn', garments.every(id => {
    const item = find(s, id);
    return item && (item.sourceAssembly || item.sourceSkinPair) && item.meshes.some(m => m.visible);
  }), garments.map(id => ({ id, meshes: find(s, id)?.meshes.length ?? 0 })));

  // A fresh load of a saved outfit must rebuild the same attachments from the same files.
  await page.goto(outfitUrl(outfit({ earrings: 'bodycosmetics-earrings-elfearring',
    lowerBack: 'attachments-oilbarrel-01-lumbar', headwear: 'fromtencent-asianspirithorn-silverblue' }),
    { cam: BACK_CAM, extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  s = await state(page);
  const reloaded = ['bodycosmetics-earrings-elfearring', 'attachments-oilbarrel-01-lumbar', 'fromtencent-asianspirithorn-silverblue']
    .map(id => ({ id, problems: verify(s, id).problems }));
  check('reloading a saved outfit rebuilds every frame attachment from source',
    reloaded.every(r => !r.problems.length), reloaded);
  if (shots) report.shots.push(await shoot(page, `${SHOTS}/reload-three.png`));

  const requests = classify(log);
  requests.errors = requests.errors.filter(e => !e.startsWith('[vite] failed to connect to websocket'));
  const frameRequests = log.requests.filter(r => r.url.includes(RUNTIME));
  check('no page errors or failed requests', !requests.errors.length && !requests.failedRequests.length, requests);
  check('frame meshes and materials load from the attachment-frame runtime folder',
    frameRequests.some(r => r.url.includes('/meshes/') && r.status === 200) &&
    frameRequests.some(r => r.url.includes('/materials/') && r.status === 200) &&
    frameRequests.every(r => r.outcome === 'finished' && r.status < 400),
    [...new Set(frameRequests.map(r => `${r.status} ${new URL(r.url).pathname}`))].slice(0, 12));
  check('the preview index was served in place of the active one', indexRequests.length > 0, [...new Set(indexRequests)]);
  report.requests = { ...requests, frames: frameRequests.length };
} finally {
  report.passed = report.cases.length > 0 && report.cases.every(c => c.passed);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync('scripts/generated/shader-probe/accessory-frames-opus-v1', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(report.passed ? `PASS: ${report.cases.length} attachment-frame cases` : `FAIL: see ${OUT}`);
if (!report.passed) process.exitCode = 1;
