// Batch source bindings, real colour swaps, failure/cancellation and matched views.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { resolveSourceOutfit, resolveSourceRigParts } from '../../src/rig/SourceAssembly.ts';

const output = 'visual-diff/reconstructed/reference-hair-variants-01';
mkdirSync(output, { recursive: true });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const variants = read('scripts/generated/shader-probe/reference-hair-variants-01/variants.json');
const assets = read('public/models/reconstructed-assemblies-v1/assets.json');
const jobUrl = job => assets.materialVariants[JSON.stringify([job.source, ...job.overlays])];
const jobFile = job => resolve('public/models/reconstructed-assemblies-v1', jobUrl(job));
const jobPattern = job => '**' + new URL(jobUrl(job), 'http://localhost/models/reconstructed-assemblies-v1/').pathname;
const face = read('public/models/reconstructed-assembly-v2/items/head-face-01-base.json');
const base = read('public/models/reconstructed-assembly-v2/items/hairs-afrofade.json');
const baseMaterial = read('public/models/reconstructed-details-v2/hair-afrofade.json');
const report = [], captures = [];
const record = (name, details = {}) => { report.push({ name, passed: true, ...details }); console.log(name + ': passed'); };
for (const variant of variants) {
  const def = read(variant.definition), alone = resolveSourceOutfit([def]), withFace = resolveSourceOutfit([face, def]);
  const hairJob = variant.jobs.M_Hair, scalpJob = variant.jobs.shader_head_shader;
  const hairManifest = read(jobFile(hairJob));
  const scalpManifest = read(jobFile(scalpJob));
  assert.equal(hairManifest.assemblySha256, baseMaterial.assemblySha256);
  assert.equal(hairManifest.sourceShaderOwner, baseMaterial.sourceShaderOwner);
  assert.equal(hairManifest.coverageShaderSha256, baseMaterial.coverageShaderSha256);
  assert.deepEqual(hairManifest.textures, baseMaterial.textures);
  assert.deepEqual(hairManifest.parameterOverrides, hairJob.overlays);
  assert.deepEqual(scalpManifest.parameterOverrides, scalpJob.overlays);
  assert.deepEqual(withFace.materialParameters.filter(p => p.itemId === def.id && p.slots.includes('shader_head_shader')).map(p => p.source), scalpJob.overlays);
  const conditional = def.properties.ActivatesMaterialParameters.filter(p => p.SlotNames.includes('shader_head_shader') && p.MatchingTags.length).length;
  assert.equal(alone.materialParameters.filter(p => p.slots.includes('shader_head_shader')).length, 2 - conditional);
  for (const context of [[], ['Customization.Shape.PushHair.hat_covers_upper_hair']]) {
    const resolved = resolveSourceOutfit([face, def], context);
    const part = resolveSourceRigParts(resolved.items[def.id], assets)[0];
    assert.equal(part.materials.M_Hair.url, assets.materialVariants[JSON.stringify([hairJob.source, ...hairJob.overlays])]);
    assert.equal(part.sourceMesh, context.length ? '/Game/Discovery/Characters/Hairs/AfroFade/SM_AfroFade_UnderHat.SM_AfroFade_UnderHat' : base.properties.VisualParts[0].StaticMesh.AssetPathName);
  }
  for (const suffix of ['hat_covers_head', 'hood_covers_head']) {
    const hidden = resolveSourceOutfit([face, def], [`Customization.Shape.PushHair.${suffix}`]);
    assert.deepEqual(resolveSourceRigParts(hidden.items[def.id], assets), []);
    assert.deepEqual(hidden.materialParameters.filter(p => p.itemId === def.id && p.slots.includes('shader_head_shader')).map(p => p.source), scalpJob.overlays);
  }
  record(def.id + ' source colours, original shader/atlas/coverage and all hat/hood rules');
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1160, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const outfit = '1.' + Buffer.from(JSON.stringify({ slots: { face: face.id, hair: base.id } })).toString('base64url');
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&pose=a&isolate=0&cam=0,1.69,1.05,0,1.69,0&fov=28`, { waitUntil: 'networkidle' });
  const idle = async () => {
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const settled = async () => { await idle(); await page.waitForFunction(() => window.__temporalPreview.samples === 32, undefined, { timeout: 60000 }); };
  const select = next => page.evaluate(async next => { window.__rigIdle = false; (await import('/src/store/useBuildStore.ts')).useBuildStore.getState().load(next); }, next);
  const swap = async hair => { await select({ face: face.id, ...(hair ? { hair } : {}) }); await idle(); };
  const state = () => page.evaluate(() => {
    const root = window.__rigRoot, hair = root.children.find(o => o.userData.sourceAssembly && o.userData.rigItemId.startsWith('hairs-afrofade'));
    const hairMesh = hair?.getObjectsByProperty('isSkinnedMesh', true)[0], head = root.children.find(o => o.userData.sourceSkinPair);
    const headMaterials = head?.getObjectsByProperty('isMesh', true).flatMap(m => Array.isArray(m.material) ? m.material : [m.material]) ?? [];
    const scalp = headMaterials.find(m => m.userData.sourceSlot?.MaterialSlotName === 'shader_head_shader');
    const body = root.getObjectsByProperty('isSkinnedMesh', true).find(m => m.userData.sourceBody);
    return { hair: hair?.userData.rigItemId ?? null, hairGroup: hair?.uuid ?? null, head: head?.uuid ?? null,
      hairMaterial: hairMesh?.material.userData.sourceInstance ?? null, hairParameters: hairMesh?.material.userData.parameterOverrides ?? [],
      scalpMaterial: scalp?.userData.sourceInstance, scalpParameters: scalp?.userData.parameterOverrides ?? [],
      bodyGeometry: body.geometry.uuid, bodySkeleton: body.skeleton.uuid, bodyMaterial: body.material.uuid,
      headSections: headMaterials.length, recoveredHeadSections: headMaterials.filter(m => m.userData.reconstructed).length };
  });
  await settled();
  const initial = await state(); assert.equal(initial.hair, base.id);
  const rules = await page.evaluate(async variants => {
    const { loadSourceOutfit, loadSourceSkinPair } = await import('/src/rig/SourceAssembly.ts');
    const checks = [];
    for (const variant of variants) {
      const outfit = await loadSourceOutfit(['head-face-01-base', variant.id], '/models/reconstructed-assembly-v2');
      const parameters = outfit.materialParameters.filter(p => p.itemId === variant.id);
      const resolve = values => loadSourceSkinPair('head-face-01-base', outfit.items['head-face-01-base'], '/models/reconstructed-assemblies-v1', values);
      const pair = await resolve(parameters), head = pair.head.materials.shader_head_shader;
      if (JSON.stringify(head.parameterOverrides) !== JSON.stringify(variant.jobs.shader_head_shader.overlays)) throw new Error('Lost authored scalp order');
      const reversed = [...parameters].reverse(); let rejected = false;
      try { await resolve(reversed); } catch { rejected = true; }
      if (!rejected) throw new Error('Unindexed parameter order was accepted');
      const conflict = parameters.map(p => ({ ...p })); conflict.find(p => p.source === head.parameterOverrides[1]).itemId = 'different-contributor';
      rejected = false; try { await resolve(conflict); } catch { rejected = true; }
      if (!rejected) throw new Error('Cross-item parameter priority was guessed');
      checks.push({ name: variant.id + ' indexed scalp order and cross-item conflict guard', passed: true });
    }
    return checks;
  }, variants);
  report.push(...rules);
  await page.addStyleTag({ content: 'div:has(> select[aria-label="Recovered material view"]) { visibility:hidden !important; }' });
  const capture = async (id, title) => {
    await settled();
    const current = await state(), file = `${output}/${id}.png`;
    await page.locator('canvas').first().screenshot({ path: file });
    captures.push({ id, title, file, ...current });
    assert.equal(current.bodyGeometry, initial.bodyGeometry); assert.equal(current.bodySkeleton, initial.bodySkeleton);
    assert.equal(current.recoveredHeadSections, 5); assert.equal(current.headSections, 7);
    return current;
  };
  await capture(base.id, 'Base');
  for (const variant of variants) {
    await swap(variant.id);
    const current = await capture(variant.id, variant.id.replace('hairs-afrofade-', '').replace('chocolatebrown', 'Chocolate brown').replace('darkblonde', 'Dark blonde').replace('saltpepper', 'Salt & pepper'));
    assert.equal(current.hair, variant.id); assert.equal(current.hairMaterial, variant.jobs.M_Hair.id);
    assert.deepEqual(current.hairParameters, variant.jobs.M_Hair.overlays); assert.deepEqual(current.scalpParameters, variant.jobs.shader_head_shader.overlays);
    record(variant.id + ' complete lit hair/scalp swap and stable body geometry');
  }
  assert.deepEqual(errors, []);

  // A broken member cannot replace either half of the current appearance.
  for (const [slot, target] of [['M_Hair', variants[1]], ['shader_head_shader', variants[0]]]) {
    const previous = await state(), job = target.jobs[slot], manifest = read(jobFile(job));
    const pattern = jobPattern(job);
    await page.route(pattern, route => route.fulfill({ json: { ...manifest, shaderSha256: '0'.repeat(64) } }));
    await swap(target.id); const failed = await state();
    assert.equal(failed.hairGroup, previous.hairGroup); assert.equal(failed.head, previous.head); assert.equal(failed.bodyMaterial, previous.bodyMaterial);
    assert(errors.some(e => /hash/i.test(e)), 'Expected visible hash failure');
    assert(errors.every(e => /hash/i.test(e)), errors.join('\n'));
    errors = []; await page.unroute(pattern); await swap(target.id);
    assert.equal((await state()).hair, target.id);
    record(slot + ' failure preserves both old items and retries successfully');
  }

  // Hold the face member after the new hair can load. Neither may commit early.
  const previous = await state(), delayed = variants[4];
  let release; const gate = new Promise(resolve => { release = resolve; });
  let handlerDone; const handled = new Promise(resolve => { handlerDone = resolve; });
  const pattern = jobPattern(delayed.jobs.shader_head_shader);
  await page.route(pattern, async route => { await gate; await route.continue(); handlerDone(); });
  const requested = page.waitForRequest(r => r.url().endsWith(`/${delayed.jobs.shader_head_shader.id}.json`));
  await select({ face: face.id, hair: delayed.id }); await requested;
  await page.waitForTimeout(180);
  const staged = await state(); assert.equal(staged.hairGroup, previous.hairGroup); assert.equal(staged.head, previous.head);
  const latest = variants[5]; await select({ face: face.id, hair: latest.id }); await idle();
  release(); await handled; await page.unroute(pattern); await page.waitForLoadState('networkidle'); await settled();
  const newest = await state(); assert.equal(newest.hair, latest.id); assert.equal(newest.scalpMaterial, latest.jobs.shader_head_shader.id);
  record('delayed scalp never exposes mixed colours and cancelled pair cannot commit late');
  await swap(null); const removed = await state();
  assert.equal(removed.hair, null); assert.deepEqual(removed.scalpParameters, []);
  assert.equal(removed.bodyGeometry, initial.bodyGeometry); assert.equal(removed.bodySkeleton, initial.bodySkeleton);
  record('hair removal clears colour and scalp together while preserving body');
  await swap(variants[1].id);
  const withoutClothes = await state();
  await select({ face: face.id, hair: variants[1].id, upperBody: 'casual-basictshirt-cotton-alfaacta' }); await idle();
  const clothed = await state(); assert.equal(clothed.head, withoutClothes.head); assert.equal(clothed.hairGroup, withoutClothes.hairGroup);
  record('unrelated clothing change reuses the complete hair/head appearance');
  assert.deepEqual(errors, []);

  // Assemble actual browser captures in a labelled sheet; no painted references.
  const sheet = await browser.newPage({ viewport: { width: 1680, height: 1340 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#111822;color:#eef1f6;font-family:Arial;padding:24px}h1{font-size:26px;margin:0 0 7px}p{color:#b8c1d0;margin:0 0 20px;font-size:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}figure{margin:0;background:#253040;border-radius:12px;overflow:hidden}img{width:100%;height:520px;object-fit:cover;object-position:top}figcaption{padding:12px 14px;font-size:19px;text-transform:capitalize}.note{padding:24px;color:#b8c1d0;font-size:18px;line-height:1.5}</style>
    <h1>AFRO FADE · source colour variants</h1><p>Same camera and lighting · recovered hair and scalp parameters · still-view smoothing</p><div class="grid">${captures.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.title}</figcaption></figure>`).join('')}<div class="note">Six additional colour variants<br><br>Original meshes, texture atlases and shader retained.<br><br>Preview lighting; skin scattering, the neck seam and native culling remain unfinished.</div></div>`);
  await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  await sheet.screenshot({ path: `${output}/colour-variants.png`, fullPage: true }); await sheet.close();
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks: report, captures, errors }, null, 2));
  console.log(`${report.length} source/viewer checks pass; seven real colour captures and comparison sheet saved`);
} catch (error) { console.error(errors.map(e => e.slice(0, 1800))); throw error; }
finally { await browser.close(); }
