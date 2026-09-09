// Exercise the discovered assemblies in the actual viewer, including an item
// with no legacy GLB, multiple recovered slots, and failed companion rollback.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const index = JSON.parse(readFileSync("public/models/reconstructed-assemblies-v1/supported-items.json", "utf8"));
const out = "visual-diff/reconstructed/assembly-batch-01";
mkdirSync(out, { recursive: true });
const base = { face: "head-face-01-base", hair: "hairs-afrofade", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
let errors = [];
const report = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
async function swap(slots) {
  await page.evaluate(async slots => {
    window.__rigIdle = false;
    (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().load(slots);
  }, slots);
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function inspect(ids) {
  return page.evaluate(async ids => {
    const { loadSourceRigParts } = await import("/src/rig/SourceAssembly.ts");
    const root = window.__rigRoot, T = window.__THREE, result = [];
    root.updateMatrixWorld(true);
    for (const id of ids) {
      const group = root.children.find(o => o.userData.rigItemId === id && o.userData.sourceAssembly);
      if (!group) throw new Error(`Missing reconstructed item ${id}`);
      const expected = await loadSourceRigParts(window.__sourceAssembly.items[id], "/models/reconstructed-assemblies-v1");
      const parts = [], p = new T.Vector3(), q = new T.Vector3();
      let restError = 0;
      group.traverse(mesh => {
        if (!mesh.isMesh) return;
        const part = expected.find(part => part.sourceIndex === mesh.userData.sourcePartIndex);
        if (!part || part.sourceMesh !== mesh.userData.sourceMesh) throw new Error("Incorrect assembly mesh");
        if (!mesh.isSkinnedMesh || !mesh.geometry.attributes.tangent) throw new Error("Missing preserved source attributes");
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          const slot = m.userData.sourceSlot?.MaterialSlotName;
          if (!m.userData.reconstructed || m.userData.sourceMaterial !== part.materials[slot]?.source)
            throw new Error(`Incorrect source binding ${id}/${slot}`);
        }
        for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
          p.fromBufferAttribute(mesh.geometry.attributes.position, v);
          for (let i = 0; i < (mesh.morphTargetInfluences?.length ?? 0); i++) {
            const weight = mesh.morphTargetInfluences[i];
            if (weight) p.addScaledVector(new T.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[i], v), weight);
          }
          mesh.getVertexPosition(v, q);
          const error = p.distanceTo(q);
          if (!Number.isFinite(error)) throw new Error("Nonfinite posed vertex");
          restError = Math.max(restError, error);
        }
        parts.push({ index: part.sourceIndex, source: part.sourceMesh, materials: materials.length });
      });
      if (new Set(parts.map(p => p.index)).size !== expected.length) throw new Error("Incomplete item assembly");
      if (restError > 1e-6) throw new Error(`Incorrect neutral bind pose: ${restError}`);
      result.push({ id, uuid: group.uuid, parts, restError });
    }
    return result;
  }, ids);
}
function pass(name, details) {
  assert.deepEqual(errors, []);
  report.push({ name, passed: true, ...details });
  writeFileSync(`${out}/checks.json`, JSON.stringify(report, null, 2));
  console.log(`${name}: passed`);
}
async function fittingState() {
  return page.evaluate(() => ({
    tags: window.__sourceAssembly.fittingTags,
    meshes: window.__rigRoot.getObjectsByProperty("isSkinnedMesh", true)
      .filter(m => m.userData.sourceBody || m.userData.sourceMesh)
      .map(m => ({ source: m.userData.sourceMesh ?? "body", weights: m.morphTargetInfluences,
        active: m.userData.sourceFittingMorphs }))
  }));
}
try {
  const outfit = "1." + Buffer.from(JSON.stringify({ slots: {} })).toString("base64url");
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&pose=a&cam=0,0.9,4.2,0,0.9,0&fov=28`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  for (const entry of index.ready) {
    await swap({ ...base, [entry.slot]: entry.id });
    const actual = await inspect([entry.id]);
    await page.getByRole("combobox", { name: "Recovered material view" }).waitFor();
    await page.locator("canvas").first().screenshot({ path: `${out}/${entry.id}.png` });
    pass(entry.id, { items: actual });
  }
  const mixed = { ...base, upperBody: "casual-basictshirt-cotton-alfaacta", lowerBody: "medieval-demonpants-leather-black" };
  await swap(mixed);
  const before = await inspect([mixed.upperBody, mixed.lowerBody]);
  const fittingBefore = await fittingState();
  await page.locator("canvas").first().screenshot({ path: `${out}/mixed-outfit.png` });
  pass("Recovered upper and lower assemblies render together", { items: before });
  const companion = "**/reconstructed-meshes-batch-01/SK_Streetwear_HeartNecklace_M.glb";
  await page.route(companion, route => route.fulfill({ status: 404, body: "Missing companion fixture" }));
  await swap({ ...mixed, upperBody: "casual-tubetop-cotton-white" });
  await page.getByText("Couldn’t load this shader preview.", { exact: true }).waitFor();
  assert.deepEqual(await inspect([mixed.upperBody, mixed.lowerBody]), before);
  assert.deepEqual(await fittingState(), fittingBefore, "Failed companion changed the active fitting state");
  assert(errors.some(e => e.includes("404"))); errors = [];
  pass("Failed upper-body companion retains both existing assemblies and their source tags");
  await page.unroute(companion);
  await swap({ ...mixed, upperBody: "casual-tubetop-cotton-white" });
  assert.notDeepEqual(await fittingState(), fittingBefore, "Successful retry did not update fitting state");
  pass("Failed upper-body assembly retries", { items: await inspect(["casual-tubetop-cotton-white", mixed.lowerBody]) });
  await page.getByRole("checkbox", { name: "Isolate recovered items" }).check();
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  const isolated = await page.evaluate(() => {
    const meshes = [];
    window.__rigRoot.traverse(o => {
      if (!o.isMesh) return;
      let visible = true; for (let p = o; p; p = p.parent) visible &&= p.visible;
      if (visible) meshes.push((Array.isArray(o.material) ? o.material : [o.material]).some(m => m.userData.reconstructed));
    });
    return meshes;
  });
  assert(isolated.length > 0 && isolated.every(Boolean));
  pass("Isolation works across upper and lower source assemblies");
} catch (error) {
  if (errors.length) console.error(errors.join("\n"));
  throw error;
} finally { await browser.close(); }
