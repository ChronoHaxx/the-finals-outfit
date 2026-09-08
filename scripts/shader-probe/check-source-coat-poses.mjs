// Check the fresh UE geometry against the existing Blender-oriented rig driver.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

mkdirSync("scripts/generated/shader-probe", { recursive: true });
const all = process.argv.includes("--all");
const fitting = process.argv.includes("--fitting");
const items = all ? JSON.parse(readFileSync("public/models/reconstructed-assemblies-v1/supported-items.json", "utf8")).ready
  : ["leather-black", "leather-camo", "satin"].map(suffix => ({ id: `casual-longcoat-${suffix}`, slot: "outerwear" }));
writeFileSync("scripts/generated/shader-probe/pose-harness.html", `<!doctype html>
  <html><head><title>Source pose checks</title><link rel="icon" href="data:,"></head><body>
  <script type="module">import * as THREE from 'three'; window.__THREE=THREE;</script></body></html>`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173/scripts/generated/shader-probe/pose-harness.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__THREE);
  const report = await page.evaluate(async ({ items, fitting }) => {
    const T = window.__THREE;
    const { CharacterRig } = await import("/src/rig/CharacterRig.ts");
    const { createGltfLoader } = await import("/src/rig/loaders.ts");
    const { loadSourceOutfit, loadSourceRigParts } = await import("/src/rig/SourceAssembly.ts");
    const rig = new CharacterRig(createGltfLoader());
    const maskCalls = [];
    const setMasks = rig.decals.setBodyHideMasks.bind(rig.decals);
    rig.decals.setBodyHideMasks = (urls, layouts) => { maskCalls.push([...urls]); setMasks(urls, layouts); };
    await rig.loadBody("/models/body/SK_Body_M.glb", fitting ? "/models/reconstructed-meshes-v2/SK_Body_M.glb" : undefined);
    const results = [];
    try {
      for (const { id, slot } of items) {
        const assembly = await loadSourceOutfit([id], "/models/reconstructed-assembly-v2");
        const parts = await loadSourceRigParts(assembly.items[id], "/models/reconstructed-assemblies-v1");
        rig.setPose("idle"); // Equipping while posed must still use neutral inverse binds.
        await rig.equip({ id, slot, url: parts[0].url,
          sourceParts: parts });
        if (fitting) rig.setSourceFittingTags(assembly.fittingTags);
        const meshes = [];
        rig.root.traverse(o => { if (o.isSkinnedMesh && o.material?.userData.reconstructed) meshes.push(o); });
        if (meshes.length !== parts.length || meshes.some(m => m.geometry.hasAttribute("skinIndex1") && m.userData.sourceSkinInfluences !== 8))
          throw new Error("Incomplete preserved source assembly");
        const visibleMasks = maskCalls.at(-1);
        if (!visibleMasks?.length || visibleMasks.length !== parts.filter(p => p.bodyMaskUrl).length)
          throw new Error("Incomplete assembly body coverage masks");
        rig.setAssemblyVisibility(slot, false);
        const hiddenMasks = maskCalls.at(-1);
        if (hiddenMasks.length) throw new Error("Hidden coat still removes underlying body coverage");
        rig.setAssemblyVisibility(slot, true);
        if (JSON.stringify(maskCalls.at(-1)) !== JSON.stringify(visibleMasks)) throw new Error("Restored coat lost its coverage mask");
        await rig.whenBodyHidesReady();
        if (fitting) meshes.push(rig.root.getObjectsByProperty("isSkinnedMesh", true).find(m => m.userData.sourceBody));
        for (const mesh of meshes) {
        rig.setPose("idle");
        const p = new T.Vector3(), q = new T.Vector3(), delta = new T.Vector3();
        const measure = () => {
          rig.root.updateMatrixWorld(true);
          let error = 0;
          for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
            p.fromBufferAttribute(mesh.geometry.attributes.position, i);
            for (let morph = 0; morph < (mesh.morphTargetInfluences?.length ?? 0); morph++) {
              const weight = mesh.morphTargetInfluences[morph];
              if (weight) p.addScaledVector(delta.fromBufferAttribute(mesh.geometry.morphAttributes.position[morph], i), weight);
            }
            mesh.getVertexPosition(i, q);
            error = Math.max(error, p.distanceTo(q));
          }
          return error;
        };
        const posedDisplacement = measure();
        rig.setPose("a"); const restError = measure();
        rig.setPose("idle"); const posedAgain = measure();
        rig.setPose("a"); const restoredError = measure();
        results.push({ id, part: mesh.userData.sourceMesh ?? mesh.userData.sourceBodyUrl,
          fittingMorphs: mesh.userData.sourceFittingMorphs ?? [], restError, restoredError, posedDisplacement,
          poseRepeatError: Math.abs(posedDisplacement - posedAgain),
          coverageMaskFollowsVisibility: true,
          originalTangents: mesh.geometry.hasAttribute("tangent"), morphs: Object.keys(mesh.morphTargetDictionary) });
        }
        rig.unequip(slot);
        if (fitting) rig.setSourceFittingTags([]);
        await rig.whenBodyHidesReady();
        if (maskCalls.at(-1).length) throw new Error("Unequipped item left body cutouts");
        rig.root.traverse(o => {
          if (o.userData.sourceBoneExtension) throw new Error("Unequipped item left accessory bones on the body");
        });
      }
    } finally { rig.dispose(); }
    return results;
  }, { items, fitting });
  for (const result of report) {
    assert(result.originalTangents && (all || result.morphs.length > 0));
    assert(result.restError < 1e-6 && result.restoredError < 1e-6, JSON.stringify(result));
    assert(result.posedDisplacement >= 0 && result.posedDisplacement < 1 && result.poseRepeatError < 1e-8, JSON.stringify(result));
  }
  if (!all) for (const id of new Set(report.map(r => r.id))) assert(report.some(r => r.id === id && r.posedDisplacement > .05));
  mkdirSync("visual-diff/reconstructed", { recursive: true });
  writeFileSync(`visual-diff/reconstructed/source-${all ? "batch" : "coat"}${fitting ? "-fitted" : ""}-poses.json`, JSON.stringify(report, null, 2));
  console.log(`All ${report.length} source mesh cases retain their bind shape and survive repeated A/idle pose changes`);
} finally { await browser.close(); }
