// Balaclava lip probe (22 Nov 2026; README.md beside this file): at a face pose (a clip frame, or pose weights set by
// hand through CONFIGS), which head vertices end up outside the balaclava, how far, and which bones drive them.
// Dev server only (window hooks and a /src module import):
//   Dev server (worktree root, PowerShell): .env.local with deploy.yml's hosts and VITE_CHINALS_ANIMATIONS_BASE set to the
//   Chinals host with faces (https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/), then
//   npx vite --port 5241 --strictPort --host 127.0.0.1;   CAPTURE_BASE=http://127.0.0.1:5241 node _docs/balaclava-lip-2026-11-22/measure-lip.mjs
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5241";
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: process.env.FACE ?? "head-face-01-base", facewear: "streetwear-balaclava-cotton-black" };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const url = `${BASE}/?reconstructed=1&outfit=${encode(BODY)}#/chinals`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", e => console.log("pageerror", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(() => window.__rigAnim.play("cn-emote-weaponmaster", 3.2));
await page.waitForTimeout(5000);
await page.evaluate(() => window.__rigAnim.play("cn-emote-weaponmaster", 3.2));
await page.waitForTimeout(1000);

const configs = JSON.parse(process.env.CONFIGS ?? JSON.stringify([
  { name: "clip 3.2 s", weights: null },
  { name: "rest", weights: {} },
  { name: "Surprise", weights: { Face_Surprise: 1 } },
  { name: "BlueSteel", weights: { Face_BlueSteel: 1 } },
  { name: "Surprise+BlueSteel", weights: { Face_Surprise: 1, Face_BlueSteel: 1 } },
  { name: "JawOpen", weights: { Face_JawOpen: 1 } },
  { name: "JawOpen+BlueSteel", weights: { Face_JawOpen: 1, Face_BlueSteel: 1 } },
]));

const result = await page.evaluate(async (configs) => {
  const T = window.__THREE, face = window.__rigAnim.animator.face;
  const FA = await import("/src/rig/FaceAnimator.ts");
  const out = { masks: face.masks.map(m => m.name), head: face.head?.key, configs: [] };
  let custom = null;
  face.apply = function (samples) {
    if (!this.head || !this.enabled) return;
    const weights = custom ? new Map(Object.entries(custom)) : FA.poseWeights(samples, this.curves);
    this.posed = FA.poseHead(this.head, weights, this.scratch, this.maskFor(this.head));
    this.applyWraps(this.posed ? weights : null);
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const root = window.__rigRoot;
  // CPU skinning with up to 8 influences and relative morphs, world space.
  const skinned = (mesh) => {
    const g = mesh.geometry, pos = g.attributes.position, n = pos.count, out = new Float32Array(n * 3);
    const sets = [[g.attributes.skinIndex, g.attributes.skinWeight], [g.attributes.skinIndex1, g.attributes.skinWeight1]].filter(s => s[0]);
    const mats = mesh.skeleton.bones.map((b, i) => new T.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i]));
    const morphs = (g.morphAttributes.position ?? []).map((a, i) => [a, mesh.morphTargetInfluences?.[i] ?? 0]).filter(([, w]) => w);
    const v = new T.Vector3(), acc = new T.Vector3(), t = new T.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      for (const [a, w] of morphs) v.addScaledVector(t.fromBufferAttribute(a, i), w);
      v.applyMatrix4(mesh.bindMatrix);
      acc.set(0, 0, 0);
      for (const [si, sw] of sets) for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k); if (!w) continue;
        acc.addScaledVector(t.copy(v).applyMatrix4(mats[si.getComponent(i, k)]), w);
      }
      acc.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
    }
    return out;
  };
  const heads = face.meshes;
  let bala = null;
  root.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs !== undefined && !bala) bala = o; });
  out.bala = bala?.name;
  // Mouth centre at rest: midpoint of the lip-corner bones.
  const boneByName = new Map();
  for (const m of heads) for (const b of m.skeleton.bones) boneByName.set(b.name, b);
  const measure = () => {
    root.updateMatrixWorld(true);
    const L = boneByName.get("FACIAL_L_LipCorner") ?? boneByName.get("FACIAL_L_MouthCorner"), R = boneByName.get("FACIAL_R_LipCorner") ?? boneByName.get("FACIAL_R_MouthCorner");
    const jaw = boneByName.get("FACIAL_C_Jaw");
    const centre = L && R ? L.getWorldPosition(new T.Vector3()).add(R.getWorldPosition(new T.Vector3())).multiplyScalar(0.5) : jaw.getWorldPosition(new T.Vector3());
    // Balaclava triangles in world space.
    const bp = skinned(bala), idx = bala.geometry.index.array, tris = idx.length / 3;
    const A = new T.Vector3(), B = new T.Vector3(), C = new T.Vector3(), P = new T.Vector3(), Q = new T.Vector3(), N = new T.Vector3();
    const tri = new T.Triangle();
    // Only triangles within 6 cm of the mouth.
    const near = [];
    for (let t = 0; t < tris; t++) {
      A.fromArray(bp, idx[t * 3] * 3); if (A.distanceTo(centre) > 0.06) continue;
      near.push(t);
    }
    const res = [];
    for (const mesh of heads) {
      if (!mesh.visible) continue;
      const hp = skinned(mesh), g = mesh.geometry, n = g.attributes.position.count;
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      for (let i = 0; i < n; i++) {
        P.fromArray(hp, i * 3); if (P.distanceTo(centre) > 0.045) continue;
        let best = Infinity, bestT = -1;
        for (const t of near) {
          A.fromArray(bp, idx[t * 3] * 3); B.fromArray(bp, idx[t * 3 + 1] * 3); C.fromArray(bp, idx[t * 3 + 2] * 3);
          tri.set(A, B, C); tri.closestPointToPoint(P, Q);
          const d = Q.distanceToSquared(P); if (d < best) { best = d; bestT = t; }
        }
        if (bestT < 0) continue;
        A.fromArray(bp, idx[bestT * 3] * 3); B.fromArray(bp, idx[bestT * 3 + 1] * 3); C.fromArray(bp, idx[bestT * 3 + 2] * 3);
        tri.set(A, B, C); tri.closestPointToPoint(P, Q); tri.getNormal(N);
        const signed = P.clone().sub(Q).dot(N); // + outside if the winding faces out
        let topBone = "", topW = 0;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > topW) { topW = w; topBone = mesh.skeleton.bones[si.getComponent(i, k)].name; } }
        res.push({ mesh: mesh.name, i, signed, dist: Math.sqrt(best), bone: topBone, w: +topW.toFixed(2), p: P.toArray().map(x => +x.toFixed(4)) });
      }
    }
    return { centre: centre.toArray(), res };
  };
  for (const c of configs) {
    custom = c.weights;
    if (c.mask === false) { face._savedMasks ??= face.masks; face.masks = []; face.boneMask = null; face.wrapWeights = null; }
    else if (face._savedMasks) { face.masks = face._savedMasks; face._savedMasks = null; face.boneMask = null; face.wrapWeights = null; }
    face.wrapWeights = null;
    window.__rigAnim.play("cn-emote-weaponmaster", 3.2);
    await frame(); await frame();
    const { res, centre } = measure();
    const sorted = res.slice().sort((a, b) => b.signed - a.signed);
    const outside = res.filter(r => r.signed > 0);
    const byMesh = {}; for (const r of outside) byMesh[r.mesh] = (byMesh[r.mesh] ?? 0) + 1;
    const byBone = {}; for (const r of outside) byBone[r.bone] = (byBone[r.bone] ?? 0) + 1;
    out.configs.push({ name: c.name, mask: c.mask !== false, centre, tested: res.length, outside: outside.length, byMesh, byBone,
      top: sorted.slice(0, 8).map(r => ({ ...r, signed: +(r.signed * 1000).toFixed(2) })) });
  }
  return out;
}, configs);
writeFileSync(process.env.OUT ?? "scripts/generated/balaclava-lip/measure.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify({ masks: result.masks, head: result.head, bala: result.bala }));
for (const c of result.configs) console.log(c.name, c.mask ? "" : "(no mask)", "tested", c.tested, "outside", c.outside, JSON.stringify(c.byMesh), JSON.stringify(c.byBone).slice(0, 300), "max mm", c.top[0]?.signed, c.top[0]?.bone);
await browser.close();
