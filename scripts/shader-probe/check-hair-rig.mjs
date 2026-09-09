// Actual preserved hair, source rule variants, head movement and viewer lifecycle.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolveSourceOutfit, resolveSourceRigParts } from '../../src/rig/SourceAssembly.ts';
import { sourceAttachmentRest } from '../../src/rig/SourceAttachment.ts';
const output = 'visual-diff/reconstructed/reference-hair-01';
mkdirSync(output, { recursive: true });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const assets = read('public/models/reconstructed-assemblies-v1/assets.json');
const hair = read('public/models/reconstructed-assembly-v2/items/hairs-afrofade.json');
const face = read('public/models/reconstructed-assembly-v2/items/head-face-01-base.json');
const report = [], record = (name, details = {}) => { report.push({ name, passed: true, ...details }); console.log(`${name}: passed`); };
const rules = [];
for (const [name, tag, ending] of [
  ['default', undefined, 'SM_AfroFade.SM_AfroFade'],
  ['under-hat', 'Customization.Shape.hat_covers_upper_hair', 'SM_AfroFade_UnderHat.SM_AfroFade_UnderHat'],
]) {
  // Get the exact source tag instead of assuming hierarchy spelling.
  const actualTag = tag ? hair.properties.VisualParts[0].TagOverrides.find(r => r.MatchingTags.some(t => t.endsWith('hat_covers_upper_hair'))).MatchingTags[0] : undefined;
  const outfit = resolveSourceOutfit([face, hair], ['Customization.Archetype.Medium', ...(actualTag ? [actualTag] : [])]);
  const parts = resolveSourceRigParts(outfit.items[hair.id], assets);
  assert.equal(parts.length, 1); assert(parts[0].sourceMesh.endsWith(ending));
  const rest = sourceAttachmentRest(parts[0].attachment).elements;
  const error = Math.max(...rest.map((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0))));
  assert(error < 2e-6, `Source head rest × authored local attachment changed position: ${error}`);
  assert(outfit.materialParameters.some(p => p.itemId === hair.id && p.slots.includes('shader_head_shader')));
  rules.push({ name, tag: actualTag }); record(`Source ${name} geometry and attachment`, { restMatrixError: error });
}
for (const suffix of ['hat_covers_head', 'hood_covers_head']) {
  const tag = hair.properties.VisualParts[0].TagOverrides.find(r => r.MatchingTags.some(t => t.endsWith(suffix))).MatchingTags[0];
  const outfit = resolveSourceOutfit([face, hair], [tag]);
  assert(outfit.items[hair.id].hidden); assert.deepEqual(resolveSourceRigParts(outfit.items[hair.id], assets), []);
  assert(outfit.materialParameters.some(p => p.itemId === hair.id));
  record(`Explicit ${suffix} hides cards while retaining scalp activation`);
}
const colored = read('public/models/reconstructed-assembly-v2/items/hairs-afrofade-blonde.json');
assert.throws(() => resolveSourceRigParts(resolveSourceOutfit([colored]).items[colored.id], { ...assets, materialVariants: {} }), /Missing recovered material/);
record('Missing hair-colour parameter bindings do not silently render the base colour');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const slots = { face: face.id, hair: hair.id };
  const outfit = '1.' + Buffer.from(JSON.stringify({ slots })).toString('base64url');
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&pose=a&isolate=0`, { waitUntil: 'networkidle' });
  const idle = async () => {
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await idle(); assert.deepEqual(errors, []);
  const motion = await page.evaluate(async rules => {
    const T = window.__THREE;
    const { CharacterRig } = await import('/src/rig/CharacterRig.ts');
    const { createGltfLoader } = await import('/src/rig/loaders.ts');
    const { loadSourceOutfit, loadSourceRigParts, resolveSourceOutfit, resolveSourceRigParts } = await import('/src/rig/SourceAssembly.ts');
    const rig = new CharacterRig(createGltfLoader()), checks = [];
    await rig.loadBody('/models/body/SK_Body_M.glb', '/models/reconstructed-meshes-v2/SK_Body_M.glb');
    const assets = await (await fetch('/models/reconstructed-assemblies-v1/assets.json')).json();
    const definition = await (await fetch('/models/reconstructed-assembly-v2/items/hairs-afrofade.json')).json();
    const url = path => new URL(path, location.origin + '/models/reconstructed-assemblies-v1/').href;
    let previous;
    for (const rule of rules) {
      rig.root.position.set(0, 0, 0); rig.root.rotation.set(0, 0, 0); rig.root.scale.setScalar(1);
      const resolved = resolveSourceOutfit([definition], rule.tag ? [rule.tag] : []);
      const parts = resolveSourceRigParts(resolved.items[definition.id], assets, url);
      await rig.equip({ id: definition.id, slot: 'hair', url: '', sourceParts: parts });
      rig.root.updateMatrixWorld(true);
      const group = rig.root.children.find(o => o.userData.sourceAssembly);
      const mesh = group.getObjectsByProperty('isSkinnedMesh', true)[0], bone = mesh.skeleton.bones[0];
      const neutralBone = bone.quaternion.clone(), neutralParent = bone.parent.quaternion.clone();
      const oldWorld = [], inverse = bone.matrixWorld.clone().invert();
      const p = new T.Vector3(), q = new T.Vector3();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) oldWorld.push(mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld));
      bone.rotateZ(.47); bone.parent.rotateY(.21);
      rig.root.rotation.set(.15, -.63, .12); rig.root.position.set(.4, -.1, .2); rig.root.scale.setScalar(1.25);
      rig.root.updateMatrixWorld(true);
      const delta = bone.matrixWorld.clone().multiply(inverse);
      let maxError = 0, movement = 0;
      for (let i = 0; i < oldWorld.length; i++) {
        mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
        q.copy(oldWorld[i]).applyMatrix4(delta);
        maxError = Math.max(maxError, p.distanceTo(q)); movement = Math.max(movement, p.distanceTo(oldWorld[i]));
      }
      if (maxError > 1e-6 || movement < .1) throw new Error('Hair does not follow the independently measured head displacement');
      if (mesh.geometry.attributes.color.itemSize !== 4 || mesh.geometry.attributes.tangent.itemSize !== 4 || mesh.geometry.attributes.skinWeight1)
        throw new Error('Lost preserved colour/tangent or misrepresented a rigid attachment as eight influences');
      if (!mesh.customDepthMaterial || !mesh.customDistanceMaterial) throw new Error('Missing masked shadows');
      checks.push({ name: rule.name + ' all-vertex head/neck/root motion', vertices: oldWorld.length, maxError, movement });
      bone.quaternion.copy(neutralBone); bone.parent.quaternion.copy(neutralParent);
      previous = { group, mesh, parts };
    }
    // Invalid attachment and aborted swaps must keep the previous complete hair.
    const bad = structuredClone(previous.parts); bad[0].attachment.bodyUrl = 'http://localhost/wrong-body.glb';
    let failed = false;
    try { await rig.equip({ id: 'invalid', slot: 'hair', url: '', sourceParts: bad }); } catch { failed = true; }
    if (!failed || previous.group.parent !== rig.root || rig.equippedItemId('hair') !== definition.id) throw new Error('Failed hair swap lost the current item');
    const controller = new AbortController(); controller.abort();
    await rig.equip({ id: 'aborted', slot: 'hair', url: '', sourceParts: previous.parts }, controller.signal);
    if (previous.group.parent !== rig.root || rig.equippedItemId('hair') !== definition.id) throw new Error('Aborted hair swap committed');
    const disposed = new Set();
    for (const [name, resource] of [['geometry', previous.mesh.geometry], ['material', previous.mesh.material],
      ['depth', previous.mesh.customDepthMaterial], ['distance', previous.mesh.customDistanceMaterial], ['skeleton', previous.mesh.skeleton]]) {
      if (name === 'skeleton') { const original = resource.dispose.bind(resource); resource.dispose = () => { disposed.add(name); original(); }; }
      else resource.addEventListener('dispose', () => disposed.add(name));
    }
    rig.unequip('hair'); await rig.whenBodyHidesReady();
    if (previous.group.parent || rig.equippedItemId('hair') || disposed.size !== 5) throw new Error('Hair cleanup is incomplete: ' + [...disposed]);
    rig.dispose();
    checks.push({ name: 'Failed/aborted hair replacement and complete resource disposal', disposed: [...disposed] });
    return checks;
  }, rules);
  motion.forEach(({ name, ...details }) => record(name, details));
  const state = () => page.evaluate(() => {
    const root = window.__rigRoot, hair = root.children.find(o => o.userData.rigItemId === 'hairs-afrofade');
    const head = root.children.find(o => o.userData.sourceSkinPair);
    const material = head.getObjectsByProperty('isMesh', true).flatMap(m => Array.isArray(m.material) ? m.material : [m.material])
      .find(m => m.userData.sourceSlot.MaterialSlotName === 'shader_head_shader');
    const body = root.getObjectsByProperty('isSkinnedMesh', true).find(m => m.userData.sourceBody);
    return { hair: !!hair, scalp: material.userData.parameterOverrides ?? [], head: head.uuid,
      bodyGeometry: body.geometry.uuid, bodySkeleton: body.skeleton.uuid, skin: material.userData.sourceInstance };
  });
  const swap = async next => {
    await page.evaluate(async next => { window.__rigIdle = false; (await import('/src/store/useBuildStore.ts')).useBuildStore.getState().load(next); }, next);
    await idle();
  };
  const first = await state(); assert.equal(first.scalp.length, 1);
  await swap({ face: face.id }); const removed = await state();
  assert(!removed.hair); assert.equal(removed.scalp.length, 0); assert.notEqual(removed.head, first.head);
  assert.equal(removed.bodyGeometry, first.bodyGeometry); assert.equal(removed.bodySkeleton, first.bodySkeleton);
  record('Removing hair restores the baseline face without rebuilding body geometry or skeleton');
  await swap(slots); const restored = await state(); assert(restored.hair); assert.equal(restored.scalp.length, 1);
  const head = restored.head;
  await swap({ ...slots, upperBody: 'casual-basictshirt-cotton-alfaacta' });
  assert.equal((await state()).head, head); record('Scalp reapplies after re-equip and unrelated clothing changes reuse the head');
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/hair-rig-checks.json`, JSON.stringify(report, null, 2));
} catch (e) { console.error(errors.map(e => e.slice(0, 1600))); throw e; }
finally { await browser.close(); }
