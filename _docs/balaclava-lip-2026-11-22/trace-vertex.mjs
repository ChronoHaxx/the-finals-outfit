// Trace of the worst poking upper-lip vertex (22 Nov 2026; README.md beside this file): its skin weights and motion,
// and the knit point in front of it: the proxy triangle it is bound to, the cage vertices' weights and their motion.
// WEIGHTS=<pose weights JSON>, default {"Face_JawOpen":1}. Dev server only:
//   Dev server (worktree root, PowerShell): .env.local with deploy.yml's hosts and VITE_CHINALS_ANIMATIONS_BASE set to the
//   Chinals host with faces (https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/), then
//   npx vite --port 5241 --strictPort --host 127.0.0.1;   CAPTURE_BASE=http://127.0.0.1:5241 node _docs/balaclava-lip-2026-11-22/trace-vertex.mjs
import { chromium } from "playwright-core";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5241";
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: process.env.FACE ?? "head-face-01-base", facewear: "streetwear-balaclava-cotton-black" };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`${BASE}/?reconstructed=1&outfit=${encode(BODY)}#/chinals`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(() => window.__rigAnim.play("cn-emote-weaponmaster", 3.2));
await page.waitForTimeout(5000);
const out = await page.evaluate(async (weightsJson) => {
  const T = window.__THREE, face = window.__rigAnim.animator.face, root = window.__rigRoot;
  const FA = await import("/src/rig/FaceAnimator.ts"), HW = await import("/src/rig/HeadWrap.ts"), AS = await import("/src/lib/assets.ts");
  let custom = {};
  face.apply = function (samples) {
    if (!this.head || !this.enabled) return;
    const weights = custom ? new Map(Object.entries(custom)) : FA.poseWeights(samples, this.curves);
    this.posed = FA.poseHead(this.head, weights, this.scratch, this.maskFor(this.head));
    this.applyWraps(this.posed ? weights : null);
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let bala = null;
  root.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs !== undefined && !bala) bala = o; });
  const head = face.meshes[0];
  const skinOne = (mesh, i) => {
    const g = mesh.geometry, v = new T.Vector3().fromBufferAttribute(g.attributes.position, i), t = new T.Vector3(), acc = new T.Vector3();
    (g.morphAttributes.position ?? []).forEach((a, k) => { const w = mesh.morphTargetInfluences?.[k] ?? 0; if (w) v.addScaledVector(t.fromBufferAttribute(a, i), w); });
    v.applyMatrix4(mesh.bindMatrix);
    for (const [si, sw] of [[g.attributes.skinIndex, g.attributes.skinWeight], [g.attributes.skinIndex1, g.attributes.skinWeight1]]) {
      if (!si) continue;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (!w) continue; const b = si.getComponent(i, k);
        acc.addScaledVector(t.copy(v).applyMatrix4(new T.Matrix4().multiplyMatrices(mesh.skeleton.bones[b].matrixWorld, mesh.skeleton.boneInverses[b])), w); }
    }
    return acc.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
  };
  const weightsOf = (mesh, i) => {
    const g = mesh.geometry, r = [];
    for (const [si, sw] of [[g.attributes.skinIndex, g.attributes.skinWeight], [g.attributes.skinIndex1, g.attributes.skinWeight1]]) {
      if (!si) continue; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > 0.01) r.push(`${mesh.skeleton.bones[si.getComponent(i, k)].name}:${w.toFixed(2)}`); }
    }
    return r.join(" ");
  };
  const pose = async (w) => { custom = w; face.wrapWeights = null; window.__rigAnim.play("cn-emote-weaponmaster", 3.2); await frame(); await frame(); root.updateMatrixWorld(true); };
  // Rest: find head lip vertices and the knit's nearest vertex to each.
  await pose({});
  const lipBones = new Set(head.skeleton.bones.map((b, i) => /^FACIAL_C_LipUpper[12]$/.test(b.name) ? i : -1).filter(i => i >= 0));
  const g = head.geometry, n = g.attributes.position.count, cand = [];
  for (let i = 0; i < n; i++) {
    let tb = -1, tw = 0; for (let k = 0; k < 4; k++) { const w = g.attributes.skinWeight.getComponent(i, k); if (w > tw) { tw = w; tb = g.attributes.skinIndex.getComponent(i, k); } }
    if (lipBones.has(tb)) cand.push(i);
  }
  const rest = new Map(cand.map(i => [i, skinOne(head, i)]));
  const bn = bala.geometry.attributes.position.count, knitRest = []; for (let j = 0; j < bn; j++) knitRest.push(skinOne(bala, j));
  await pose(JSON.parse(weightsJson));
  const posed = new Map(cand.map(i => [i, skinOne(head, i)]));
  const knitPosed = []; for (let j = 0; j < bn; j++) knitPosed.push(skinOne(bala, j));
  // Worst: smallest gap along the knit normal (approximate: nearest knit vertex, its rest normal = direction from head).
  const rows = [];
  for (const i of cand) {
    const H0 = rest.get(i), H1 = posed.get(i);
    let best = Infinity, bj = -1; for (let j = 0; j < bn; j++) { const d = knitRest[j].distanceToSquared(H0); if (d < best) { best = d; bj = j; } }
    const K0 = knitRest[bj], K1 = knitPosed[bj];
    const nrm = K0.clone().sub(H0).normalize(); // outward, at rest
    rows.push({ i, j: bj, restGapMm: +(K0.distanceTo(H0) * 1000).toFixed(2),
      headMoveMm: H1.clone().sub(H0).toArray().map(x => +(x * 1000).toFixed(2)), knitMoveMm: K1.clone().sub(K0).toArray().map(x => +(x * 1000).toFixed(2)),
      headAlongN: +((H1.clone().sub(H0)).dot(nrm) * 1000).toFixed(2), knitAlongN: +((K1.clone().sub(K0)).dot(nrm) * 1000).toFixed(2),
      gapNowMm: +((K1.clone().sub(H1)).dot(nrm) * 1000).toFixed(2), normal: nrm.toArray().map(x => +x.toFixed(2)), headWeights: weightsOf(head, i) });
  }
  rows.sort((a, b) => a.gapNowMm - b.gapNowMm);
  // The knit vertex of the worst row: its proxy triangle and the cage vertices' weights.
  const data = await (await fetch(AS.modelUrl("models/reconstructed-assemblies-v1") + "/head-wraps.json")).json();
  const source = Object.keys(data.meshes).find(k => /Balaclava_M\./.test(k));
  const headMesh = face.meshes.find(m => m.userData.sourceMesh)?.userData.sourceMesh;
  const { target, triangles } = HW.headWrapInputs(data, source, headMesh, bala.userData.headWrapMorphs ?? []);
  face.wraps[0].rewrap(null, 0);
  const still = bala.geometry.attributes.position.array.slice();
  const binding = HW.bindHeadWrap(still, target, triangles);
  const skin = face.cage.skin, width = skin.influences ?? 4;
  const tri = (j) => { const t = binding.triangle[j]; return [0, 1, 2].map(k => { const v = triangles[t * 3 + k];
    const ws = []; for (let q = 0; q < width; q++) { const w = skin.weights[v * width + q]; if (w > 0.01) ws.push(`${skin.bones[skin.joints[v * width + q]]}:${w.toFixed(2)}`); }
    return { v, bary: +binding.weights[j * 3 + k].toFixed(2), weights: ws.join(" ") }; }).concat([{ offsetMm: Array.from(binding.offset.slice(j * 3, j * 3 + 3)).map(x => +(x * 1000).toFixed(2)) }]); };
  return { worst: rows.slice(0, 5).map(r => ({ ...r, proxy: tri(r.j) })), count: rows.length };
}, process.env.WEIGHTS ?? '{"Face_JawOpen":1}');
console.log(JSON.stringify(out, null, 1));
await browser.close();
