// What the scene holds (21 Nov 2026): meshes, skinned meshes, skeletons, bones, and what StableFrameState.capture walks
// for them, with and without the face. Works on a production build: three.js announces every Scene and WebGLRenderer it
// creates to window.__THREE_DEVTOOLS__ (an EventTarget), which an init script provides.
// Usage: node _docs/igpu-perf-2026-11-21/scene-stats.mjs [face list, default "default,none"]
import { chromium } from "playwright-core";
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5191";
const FACES = (process.argv[2] ?? "default,none").split(",");
const FACE_ITEMS = { default: "head-face-01-base", none: null };
const outfitParam = face => {
  const slots = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
  if (FACE_ITEMS[face] !== null) slots.face = FACE_ITEMS[face] ?? face;
  return "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const face of FACES) {
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
  await page.addInitScript(() => {
    const hook = new EventTarget(); window.__THREE_DEVTOOLS__ = hook; window.__observed = [];
    hook.addEventListener("observe", e => window.__observed.push(e.detail));
  });
  await page.goto(`${BASE}/?outfit=${outfitParam(face)}&anim=outfit-idle`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  const stats = await page.evaluate(() => {
    const scenes = window.__observed.filter(o => o.isScene);
    const scene = scenes.reduce((a, b) => { let n = 0, m = 0; a.traverse(() => n++); b.traverse(() => m++); return m > n ? b : a; });
    let objects = 0, meshes = 0, visibleMeshes = 0, skinned = 0, boneVisits = 0, maxDepth = 0, depthSum = 0;
    const skeletons = new Map(), materials = new Set();
    const depth = o => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    const perMesh = [];
    scene.traverse(o => {
      objects++;
      if (o.isMesh) {
        meshes++;
        let v = true; for (let p = o; p; p = p.parent) if (!p.visible) v = false;
        if (v) visibleMeshes++;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
      if (o.isSkinnedMesh) {
        skinned++;
        const s = o.skeleton;
        boneVisits += s.bones.length;
        for (const b of s.bones) { const d = depth(b); depthSum += d; maxDepth = Math.max(maxDepth, d); }
        skeletons.set(s, (skeletons.get(s) ?? 0) + 1);
        perMesh.push([o.name.slice(0, 40), s.bones.length]);
      }
    });
    const bonesInSkeletons = [...skeletons.keys()].reduce((a, s) => a + s.bones.length, 0);
    const distinctBones = new Set([...skeletons.keys()].flatMap(s => s.bones)).size;
    return { objects, meshes, visibleMeshes, materials: materials.size, skinned, skeletons: skeletons.size, bonesInSkeletons,
      distinctBones, boneVisits, meanBoneDepth: +(depthSum / Math.max(1, boneVisits)).toFixed(1), maxDepth,
      largest: perMesh.sort((a, b) => b[1] - a[1]).slice(0, 12) };
  });
  console.log(face, JSON.stringify(stats));
  await page.close();
}
await browser.close();
