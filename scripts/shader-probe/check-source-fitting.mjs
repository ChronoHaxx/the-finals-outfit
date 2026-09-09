// Actual viewer checks and before/after captures for the shared fitting preview.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const output = process.argv[2] ?? "visual-diff/reconstructed/source-fitting";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
let errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
const base = { face: "head-face-01-base", hair: "hairs-afrofade", feet: "casual-tallsneakers-canvas" };
const cases = [
  { name: "cropped-shirt-jeans", slots: { ...base, upperBody: "streetwear-croppedtshirtoversize-cotton-red", lowerBody: "casual-loosejeans-denim-darkblue" }, body: ["push_upper_torso", "push_upper_back", "push_full_pants"] },
  { name: "knight-skirt", slots: { ...base, upperBody: "casual-basictshirt-cotton-alfaacta", lowerBody: "medieval-knightpants-cotton" }, body: ["push_full_pants"], garment: "shrink_pants_under_skirt" },
  { name: "coat-demonpants", slots: { ...base, outerwear: "casual-longcoat-leather-black", lowerBody: "medieval-demonpants-leather-black" }, body: ["push_full_jacket", "push_lower_torso", "push_full_pants"] },
];
const report = [];
async function idle() {
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
try {
  for (const test of cases) for (const enabled of [false, true]) {
    const outfit = "1." + Buffer.from(JSON.stringify({ slots: test.slots })).toString("base64url");
    await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&sourceFitting=${+enabled}&isolate=0&pose=a&cam=0,0.9,4.2,0,0.9,0&fov=28`, { waitUntil: "networkidle" });
    await idle();
    const state = await page.evaluate(() => {
      const T = window.__THREE, root = window.__rigRoot;
      root.updateMatrixWorld(true);
      const body = root.getObjectsByProperty("isSkinnedMesh", true).find(m => m.userData.sourceBody);
      const garments = root.getObjectsByProperty("isSkinnedMesh", true).filter(m => m.userData.sourceMesh);
      let maxDisplacement = 0, maxRestError = 0;
      if (body) {
        const p = new T.Vector3(), delta = new T.Vector3(), expected = new T.Vector3(), actual = new T.Vector3();
        for (let v = 0; v < body.geometry.attributes.position.count; v++) {
          p.fromBufferAttribute(body.geometry.attributes.position, v); expected.copy(p);
          for (let i = 0; i < body.morphTargetInfluences.length; i++) if (body.morphTargetInfluences[i]) {
            delta.fromBufferAttribute(body.geometry.morphAttributes.position[i], v);
            expected.addScaledVector(delta, body.morphTargetInfluences[i]);
          }
          body.getVertexPosition(v, actual);
          maxDisplacement = Math.max(maxDisplacement, expected.distanceTo(p));
          maxRestError = Math.max(maxRestError, expected.distanceTo(actual));
          if (!Number.isFinite(actual.length())) throw new Error("Nonfinite fitted body vertex");
        }
      }
      return { sourceBody: !!body, morphTargets: body?.morphTargetInfluences.length ?? 0,
        bodyMorphs: body?.userData.sourceFittingMorphs ?? [], maxDisplacement, maxRestError,
        garmentMorphs: garments.map(m => ({ mesh: m.userData.sourceMesh, morphs: m.userData.sourceFittingMorphs ?? [] })) };
    });
    assert.deepEqual(errors, []);
    assert.equal(state.sourceBody, enabled);
    if (enabled) {
      assert.equal(state.morphTargets, 33);
      for (const morph of test.body) assert(state.bodyMorphs.includes(morph), `Missing ${morph}`);
      if (test.garment) assert(state.garmentMorphs.some(m => m.morphs.includes(test.garment)));
      assert(state.maxDisplacement > .005 && state.maxDisplacement < .2);
      assert(state.maxRestError < 1e-6, JSON.stringify(state));
    }
    await page.locator("canvas").first().screenshot({ path: `${output}/${test.name}.${enabled ? "after" : "before"}.png` });
    if (enabled) {
      await page.evaluate(() => { window.__rigRoot.rotation.y = Math.PI; });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.locator("canvas").first().screenshot({ path: `${output}/${test.name}.back.png` });
      await page.goto(page.url().replace("pose=a", "pose=idle"), { waitUntil: "networkidle" });
      await idle();
      const idleBodyMorphs = await page.evaluate(() => {
        const root = window.__rigRoot, p = new window.__THREE.Vector3();
        root.updateMatrixWorld(true);
        for (const mesh of root.getObjectsByProperty("isSkinnedMesh", true))
          for (let v = 0; v < mesh.geometry.attributes.position.count; v++)
            if (!Number.isFinite(mesh.getVertexPosition(v, p).length())) throw new Error("Nonfinite idle vertex");
        return root.getObjectsByProperty("isSkinnedMesh", true).find(m => m.userData.sourceBody).userData.sourceFittingMorphs;
      });
      assert.deepEqual(idleBodyMorphs, state.bodyMorphs);
      assert.deepEqual(errors, []);
      await page.locator("canvas").first().screenshot({ path: `${output}/${test.name}.idle.png` });
      state.idlePosePassed = true;
    }
    report.push({ name: test.name, enabled, ...state });
    console.log(`${test.name} fitting=${enabled}: passed`);
  }
  await page.evaluate(async () => {
    window.__rigIdle = false;
    (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().load({});
  });
  await idle();
  const cleared = await page.evaluate(() => window.__rigRoot.getObjectsByProperty("isSkinnedMesh", true)
    .filter(m => m.userData.sourceBody).every(m => m.userData.sourceFittingMorphs.length === 0 && m.morphTargetInfluences.every(w => w === 0)));
  assert(cleared, "Removing clothing did not restore the body");
  assert.deepEqual(errors, []);
  report.push({ name: "Removing the outfit restores all fitting weights", passed: true });
  const lifecycle = await page.evaluate(async () => {
    const { CharacterRig } = await import("/src/rig/CharacterRig.ts");
    const { createGltfLoader } = await import("/src/rig/loaders.ts");
    const loader = createGltfLoader(), rig = new CharacterRig(loader);
    const legacy = "/models/body/SK_Body_M.glb", source = "/models/reconstructed-meshes-v2/SK_Body_M.glb";
    await rig.loadBody(legacy, source);
    const original = rig.root.children[0];
    const load = loader.loadAsync.bind(loader);
    loader.loadAsync = url => url === "failure-fixture" ? Promise.reject(new Error("Expected source failure")) : load(url);
    let rejected = false;
    try { await rig.loadBody(legacy, "failure-fixture"); } catch { rejected = true; }
    if (!rejected || rig.root.children[0] !== original || !rig.isReady()) throw new Error("Failed source body replaced the previous body");
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    loader.loadAsync = async url => { if (url === source) await gate; return load(url); };
    const pending = rig.loadBody(legacy, source);
    rig.dispose(); release(); await pending;
    if (rig.root.children.length || rig.isReady()) throw new Error("Disposed rig attached a late body");
    return { failedBodyPreservesPrevious: true, disposedRigRejectsLateBody: true };
  });
  report.push({ name: "Source body load lifecycle", ...lifecycle });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
