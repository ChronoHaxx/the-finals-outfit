// Real outfit checks: exact companion bindings, occupied slots, atomic failures
// and a superseded companion fetch. Screenshots and source data stay ignored.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = { face: "head-face-01-base", hair: "hairs-afrofade", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const coat = suffix => `casual-longcoat-${suffix}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
let errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const report = [];
async function swap(suffix) {
  await page.evaluate(async slots => {
    window.__rigIdle = false;
    (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().load(slots);
  }, { ...base, ...(suffix ? { outerwear: coat(suffix) } : {}) });
}
async function state() {
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  return page.evaluate(async () => {
    const parts = [], shirt = [], items = [];
    window.__rigRoot.traverse(o => {
      if (o.userData.rigItemId) items.push({ id: o.userData.rigItemId, uuid: o.uuid, visible: o.visible });
      if (o.userData.rigItemId === "casual-basictshirt-cotton-black") shirt.push({ visible: o.visible, uuid: o.uuid });
      if (!o.isMesh || !o.userData.sourceMesh) return;
      let visible = true; for (let p = o; p; p = p.parent) visible &&= p.visible;
      parts.push({ source: o.userData.sourceMesh, index: o.userData.sourcePartIndex, visible,
        materials: (Array.isArray(o.material) ? o.material : [o.material]).map(m => ({
          slot: m.userData.sourceSlot.MaterialSlotName, source: m.userData.sourceMaterial, recovered: !!m.userData.reconstructed,
          cloth: !!m.userData.viewDependentCloth })) });
    });
    const build = (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().build;
    return { parts, shirt, items, build, assembly: window.__sourceAssembly };
  });
}
function pass(name, details = {}) {
  assert.deepEqual(errors, []);
  report.push({ name, passed: true, ...details });
  writeFileSync("visual-diff/reconstructed/complete-assemblies.json", JSON.stringify(report, null, 2));
  console.log(`${name}: passed`);
}
try {
  const outfit = "1." + Buffer.from(JSON.stringify({ slots: { ...base, outerwear: coat("leather-black") } })).toString("base64url");
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=idle&cam=0,0.9,4.2,0,0.9,0&fov=28`, { waitUntil: "networkidle" });
  let shirtUuid;
  for (const suffix of ["leather-black", "leather-camo", "satin"]) {
    if (suffix !== "leather-black") await swap(suffix);
    const actual = await state();
    const expected = JSON.parse(readFileSync(`public/models/reconstructed-assembly-v2/items/${coat(suffix)}.json`, "utf8")).properties;
    assert.equal(actual.parts.length, expected.VisualParts.length);
    for (const part of actual.parts) {
      assert.equal(part.source, expected.VisualParts[part.index].SkeletalMesh.AssetPathName);
      assert(part.visible);
      for (const material of part.materials) {
        assert.equal(material.source, expected.MaterialOverrides.find(m => m.Key === material.slot).Value.AssetPathName);
        assert(material.recovered);
      }
    }
    assert(actual.parts.some(p => p.materials.some(m => m.cloth)));
    assert.equal(actual.shirt.length, 1); assert.equal(actual.shirt[0].visible, false);
    shirtUuid ??= actual.shirt[0].uuid;
    assert.equal(actual.shirt[0].uuid, shirtUuid);
    assert.equal(actual.build.upperBody, base.upperBody);
    assert.equal(actual.assembly.items[base.upperBody], undefined, "Suppressed shirt must not activate source tags");
    await page.screenshot({ path: `visual-diff/reconstructed/${coat(suffix)}.complete.png` });
    pass(`Complete ${suffix} binds every authored part and suppresses the extra shirt`, { parts: actual.parts });
  }
  await swap();
  const restored = await state();
  assert.equal(restored.parts.length, 0); assert.equal(restored.shirt[0].uuid, shirtUuid); assert(restored.shirt[0].visible);
  assert(restored.assembly.items[base.upperBody]);
  pass("Removing the coat restores the selected shirt and its tags");

  await swap("leather-black"); const before = await state();
  const jacket = "**/reconstructed-meshes-v2/SK_FancyDress_LawyerSuitJacket_M.glb";
  await page.route(jacket, route => route.fulfill({ status: 404, body: "Missing companion fixture" }));
  await swap("satin");
  await page.getByText("Couldn’t load this shader preview.", { exact: true }).waitFor();
  const failed = await state();
  assert.deepEqual(failed.parts, before.parts); assert.deepEqual(failed.shirt, before.shirt);
  assert(failed.assembly.items[coat("leather-black")]); assert(!failed.assembly.items[coat("satin")]);
  assert(errors.some(e => e.includes("404"))); errors = [];
  pass("A missing companion preserves the entire previous coat, shirt hiding and fitting tags");
  await page.unroute(jacket);
  await swap("satin"); const recovered = await state();
  assert(recovered.parts.some(p => p.source.includes("LawyerSuitJacket")));
  assert.equal(await page.getByText("Couldn’t load this shader preview.", { exact: true }).count(), 0);
  pass("The failed assembly retries successfully without reloading");

  const tank = "**/reconstructed-meshes-v2/SK_Casual_BandagedTankTop_M.glb";
  await page.route(tank, async route => { await new Promise(r => setTimeout(r, 1200)); await route.continue(); });
  const pending = page.waitForRequest(r => r.url().includes("/SK_Casual_BandagedTankTop_M.glb"));
  await swap("leather-black"); await pending;
  await swap("leather-camo"); await state();
  await page.waitForLoadState("networkidle");
  const last = await state();
  assert.equal(last.parts.length, 4); assert(last.parts.every(p => !p.source.includes("BandagedTankTop")));
  pass("A superseded companion cannot attach to a newer outfit");
} finally { await browser.close(); }
