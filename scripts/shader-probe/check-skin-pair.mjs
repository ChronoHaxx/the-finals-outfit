// Real viewer and atomic head/body lifecycle checks. Extracted assets stay local.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const output = process.argv[2] ?? 'visual-diff/reconstructed/reference-details-01';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
const errors = [], report = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const slots = { face: 'head-face-01-base', hair: 'hairs-afrofade',
  upperBody: 'streetwear-croppedtshirtoversize-cotton-red',
  lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' };
const outfit = '1.' + Buffer.from(JSON.stringify({ slots })).toString('base64url');
async function idle() {
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
try {
  for (const pose of ['a', 'idle']) {
    await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=${pose}&cam=0,1.58,1.4,0,1.58,0&fov=28`, { waitUntil: 'networkidle' });
    await idle();
    const state = await page.evaluate(() => {
      const root = window.__rigRoot, T = window.__THREE;
      root.updateMatrixWorld(true);
      const bodies = root.getObjectsByProperty('isSkinnedMesh', true).filter(m => m.userData.sourceBody);
      const head = root.children.find(o => o.userData.sourceSkinPair);
      if (bodies.length !== 1 || !head) throw new Error('Missing source pair or duplicated body');
      const meshes = head.getObjectsByProperty('isSkinnedMesh', true), p = new T.Vector3(), q = new T.Vector3();
      const sections = [], body = bodies[0];
      let maxDisplacementFromRest = 0, maxFittedRestError = 0, vertices = 0;
      for (const mesh of meshes) {
        if (!mesh.geometry.attributes.tangent || mesh.userData.sourceSkinInfluences !== 8) throw new Error('Source head attributes missing');
        for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
          p.fromBufferAttribute(mesh.geometry.attributes.position, v); mesh.getVertexPosition(v, q);
          if (!Number.isFinite(q.length())) throw new Error('Nonfinite source head vertex');
          maxDisplacementFromRest = Math.max(maxDisplacementFromRest, p.distanceTo(q)); vertices++;
          for (const [i, weight] of mesh.morphTargetInfluences.entries()) if (weight)
            p.addScaledVector(new T.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[i], v), weight);
          maxFittedRestError = Math.max(maxFittedRestError, p.distanceTo(q));
        }
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          sections.push({ slot: m.userData.sourceSlot.MaterialSlotName, recovered: !!m.userData.reconstructed,
            kind: m.userData.surfaceKind ?? (m.userData.skinSurface ? 'skin' : undefined),
            alphaHash: m.alphaHash, twoSided: m.side === T.DoubleSide,
            fallback: !!m.userData.previewMaterialFallback, visible: mesh.visible });
      }
      if (!body.material.userData.skinSurface || !body.material.userData.decalPatched || body.morphTargetInfluences.length !== 33)
        throw new Error('Paired body lost its material, coverage or morph targets');
      return { sections, vertices, maxDisplacementFromRest, maxFittedRestError, bodyMorphs: body.userData.sourceFittingMorphs };
    });
    assert.equal(state.sections.length, 7);
    assert.equal(state.sections.filter(s => s.recovered).length, 5);
    assert.equal(state.sections.filter(s => s.fallback).length, 2);
    assert.equal(state.sections.filter(s => !s.visible).length, 2);
    assert.equal(state.sections.filter(s => s.kind === 'eye').length, 2);
    assert(state.sections.some(s => s.kind === 'eyelash' && s.visible && s.alphaHash && s.twoSided));
    if (pose === 'a') {
      assert(state.maxFittedRestError < 1e-6, JSON.stringify(state));
      assert(state.maxDisplacementFromRest > .001 && state.maxDisplacementFromRest < .003);
      assert(state.bodyMorphs.includes('head_neck_match'));
    }
    assert.deepEqual(errors, []);
    for (const [name, angle] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
      await page.evaluate(angle => { window.__rigRoot.rotation.y = angle; }, angle);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.locator('canvas').first().screenshot({ path: `${output}/head-${pose}-${name}.png` });
    }
    report.push({ name: `Preserved head and paired body in ${pose} pose`, passed: true, ...state });
    console.log(`Source skin pair ${pose}: passed`);
  }
  const lifecycle = await page.evaluate(async () => {
    const { CharacterRig } = await import('/src/rig/CharacterRig.ts');
    const { createGltfLoader } = await import('/src/rig/loaders.ts');
    const { loadSourceOutfit, loadSourceSkinPair } = await import('/src/rig/SourceAssembly.ts');
    const { getItemById } = await import('/src/lib/catalog.ts');
    const { modelUrl } = await import('/src/lib/assets.ts');
    const id = 'head-face-01-base', catalog = getItemById(id);
    const source = await loadSourceOutfit([id], '/models/reconstructed-assembly-v2');
    const pair = await loadSourceSkinPair(id, source.items[id], '/models/reconstructed-assemblies-v1');
    const item = { id, slot: 'face', url: modelUrl(catalog.model.gltfPath), sourceSkinPair: pair };
    const loader = createGltfLoader(), rig = new CharacterRig(loader), checks = [];
    const check = (condition, name) => { if (!condition) throw new Error(name); checks.push({ name, passed: true }); };
    await rig.loadBody('/models/body/SK_Body_M.glb', '/models/reconstructed-meshes-v2/SK_Body_M.glb');
    rig.setSourceFittingTags(['Customization.Shape.PushInsideClothes.push_upper_torso']);
    const body = rig.root.getObjectsByProperty('isSkinnedMesh', true).find(m => m.userData.sourceBody);
    const geometry = body.geometry, skeleton = body.skeleton, baseline = body.material, weights = [...body.morphTargetInfluences];
    const bareBones = rig.root.getObjectsByProperty('isBone', true).length;
    check(weights.some(w => w === 1), 'Lifecycle fixture has an active authored body fitting shape');
    await rig.equip(item); await rig.whenBodyHidesReady();
    const head = rig.root.children.find(o => o.userData.sourceSkinPair), current = body.material;
    const pairedBones = rig.root.getObjectsByProperty('isBone', true).length;
    check(current !== baseline && current.userData.skinSurface && pairedBones > bareBones, 'Source skin owns one body material and facial branches');
    const originalFetch = window.fetch;
    window.fetch = (url, ...args) => String(url) === pair.body.materials.BaseBody.url
      ? Promise.reject(new Error('Expected skin material load failure')) : originalFetch(url, ...args);
    let failed = false;
    try { await rig.equip(item); } catch { failed = true; } finally { window.fetch = originalFetch; }
    check(failed && body.material === current && head.parent === rig.root, 'Failed body shader load retains previous head and body');
    const invalidPair = structuredClone(pair);
    invalidPair.head.materials.shader_eyeRight_shader.legacyName = 'missing-preview-fixture';
    failed = false;
    try { await rig.equip({ ...item, sourceSkinPair: invalidPair }); } catch { failed = true; }
    check(failed && body.material === current && head.parent === rig.root, 'Missing exact legacy baseline rejects the whole pair');
    const load = loader.loadAsync.bind(loader);
    const delayedEquip = () => {
      let release, started;
      const gate = new Promise(r => { release = r; }), waiting = new Promise(r => { started = r; });
      loader.loadAsync = async url => { if (url === pair.head.url) { started(); await gate; } return load(url); };
      return { release, waiting };
    };
    let delay = delayedEquip(), controller = new AbortController();
    let pending = rig.equip(item, controller.signal); await delay.waiting;
    controller.abort(); delay.release(); await pending; loader.loadAsync = load;
    check(body.material === current && head.parent === rig.root, 'Aborted pair does not replace the active selection');
    let disposedMaterial = false;
    current.addEventListener('dispose', () => { disposedMaterial = true; });
    await rig.equip(item); await rig.whenBodyHidesReady();
    check(disposedMaterial && !head.parent && rig.root.getObjectsByProperty('isBone', true).length === pairedBones,
      'Retry releases old skin and does not duplicate facial branches');
    check(body.geometry === geometry && body.skeleton === skeleton && JSON.stringify(weights) === JSON.stringify(body.morphTargetInfluences),
      'Head swaps preserve body geometry, skinning and fitting');
    await rig.equip({ ...item, sourceSkinPair: undefined }); await rig.whenBodyHidesReady();
    check(body.material === baseline && !rig.root.children.some(o => o.userData.sourceSkinPair), 'Legacy head restores the previous body material');
    await rig.equip(item); await rig.whenBodyHidesReady();
    rig.unequip('face'); await rig.whenBodyHidesReady();
    check(body.material === baseline && !body.material.userData.decalPatched && rig.root.getObjectsByProperty('isBone', true).length === bareBones,
      'Removing head restores body coverage and removes facial branches');
    delay = delayedEquip(); pending = rig.equip(item); await delay.waiting;
    rig.dispose(); delay.release(); await pending;
    check(!rig.isReady() && !rig.root.children.length, 'Disposed rig rejects a late head/body pair');
    return checks;
  });
  report.push(...lifecycle);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/skin-pair-checks.json`, JSON.stringify(report, null, 2));
  console.log(`${report.length} source skin viewer/lifecycle cases passed`);
} catch (error) { if (errors.length) console.error(errors.join('\n')); throw error; }
finally { await browser.close(); }
