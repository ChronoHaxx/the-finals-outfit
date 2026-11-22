// Wrap-formula A/B at a face pose (22 Nov 2026; README.md beside this file): the balaclava re-wrapped on the moved
// cage as the viewer does (offset in the triangle's rigid frame), with the offset along the interpolated cage vertex
// normals (recomputed, or carried by the cage skinning), and left on the still cage; then how far upper-lip vertices
// end up outside it. Each variant is a displacement from the still wrap, so the rest is unchanged. Dev server only:
//   Dev server (worktree root, PowerShell): .env.local with deploy.yml's hosts and VITE_CHINALS_ANIMATIONS_BASE set to the
//   Chinals host with faces (https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/), then
//   npx vite --port 5241 --strictPort --host 127.0.0.1;   CAPTURE_BASE=http://127.0.0.1:5241 node _docs/balaclava-lip-2026-11-22/formula-ab.mjs
import { chromium } from "playwright-core";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5241";
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: process.env.FACE ?? "head-face-01-base", facewear: "streetwear-balaclava-cotton-black" };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", e => console.log("pageerror", String(e).slice(0, 300)));
await page.goto(`${BASE}/?reconstructed=1&outfit=${encode(BODY)}#/chinals`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(() => window.__rigAnim.play("cn-emote-weaponmaster", 3.2));
await page.waitForTimeout(5000);

const configs = process.env.CONFIGS ? JSON.parse(process.env.CONFIGS) : [
  { name: "clip 3.2 s", weights: null },
  { name: "JawOpen", weights: { Face_JawOpen: 1 } },
  { name: "Surprise+BlueSteel", weights: { Face_Surprise: 1, Face_BlueSteel: 1 } },
  { name: "JawOpen+BlueSteel", weights: { Face_JawOpen: 1, Face_BlueSteel: 1 } },
  { name: "BlueSteel", weights: { Face_BlueSteel: 1 } },
  { name: "Happy", weights: { Face_Happy: 1 } },
  { name: "Yawn", weights: { Face_Yawn: 1 } },
];
const out = await page.evaluate(async (configs) => {
  const T = window.__THREE, face = window.__rigAnim.animator.face, root = window.__rigRoot;
  const FA = await import("/src/rig/FaceAnimator.ts"), HW = await import("/src/rig/HeadWrap.ts");
  let custom = null;
  face.apply = function (samples) {
    if (!this.head || !this.enabled) return;
    const weights = custom ? new Map(Object.entries(custom)) : FA.poseWeights(samples, this.curves);
    this.posed = FA.poseHead(this.head, weights, this.scratch, this.maskFor(this.head));
    this.applyWraps(this.posed ? weights : null);
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let bala = null;
  root.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs !== undefined && !bala) bala = o; });
  const AS = await import("/src/lib/assets.ts");
  const url = AS.modelUrl("models/reconstructed-assemblies-v1") + "/head-wraps.json";
  const data = await (await fetch(url)).json();
  const source = Object.keys(data.meshes).find(k => k.endsWith("." + bala.name)) ?? Object.keys(data.meshes).find(k => /Balaclava/.test(k));
  const headMesh = face.meshes.find(m => m.userData.sourceMesh)?.userData.sourceMesh;
  const { target, triangles } = HW.headWrapInputs(data, source, headMesh, bala.userData.headWrapMorphs ?? []);
  // Still wrap: put the part back on the still cage and keep its positions.
  face.wraps[0].rewrap(null, 0);
  const still = bala.geometry.attributes.position.array.slice();
  const binding = HW.bindHeadWrap(still, target, triangles);
  const tris = triangles.length / 3, nv = target.length / 3;
  const vertexNormals = (cage) => {
    const n = new Float64Array(nv * 3), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), f = new T.Vector3();
    for (let t = 0; t < tris; t++) {
      const i = triangles[t * 3], j = triangles[t * 3 + 1], k = triangles[t * 3 + 2];
      a.fromArray(cage, i * 3); b.fromArray(cage, j * 3); c.fromArray(cage, k * 3);
      f.subVectors(b, a).cross(c.sub(a)).normalize();
      for (const v of [i, j, k]) { n[v * 3] += f.x; n[v * 3 + 1] += f.y; n[v * 3 + 2] += f.z; }
    }
    for (let v = 0; v < nv; v++) { const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1; n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l; }
    return n;
  };
  // UE: sum_j w_j (P_j + N_j d), d = the offset along the face normal of the bound triangle (k2; k0, k1 in-plane).
  const ue = (cage) => {
    const N = vertexNormals(cage), outp = new Float64Array(binding.triangle.length * 3);
    for (let i = 0; i < binding.triangle.length; i++) {
      const t = binding.triangle[i], d = binding.offset[i * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const v = triangles[t * 3 + k], w = binding.weights[i * 3 + k];
        for (let j = 0; j < 3; j++) outp[i * 3 + j] += w * (cage[v * 3 + j] + N[v * 3 + j] * d);
      }
    }
    return outp;
  };
  const ueRest = ue(target);
  const restN = vertexNormals(target);
  const ueSkinned = (displace) => {
    const eps = 0.001, base = displace(target).slice(), shifted = Float64Array.from(target, (x, i) => x + eps * restN[i]);
    const tip = displace(shifted), N = new Float64Array(nv * 3);
    for (let v = 0; v < nv; v++) { const d = [0, 1, 2].map(j => (tip[v * 3 + j] - base[v * 3 + j]) / eps); const l = Math.hypot(...d) || 1; for (let j = 0; j < 3; j++) N[v * 3 + j] = d[j] / l; }
    const outp = new Float64Array(binding.triangle.length * 3);
    for (let i = 0; i < binding.triangle.length; i++) {
      const t = binding.triangle[i], dd = binding.offset[i * 3 + 2];
      for (let k = 0; k < 3; k++) { const v = triangles[t * 3 + k], w = binding.weights[i * 3 + k];
        for (let j = 0; j < 3; j++) outp[i * 3 + j] += w * (base[v * 3 + j] + N[v * 3 + j] * dd); }
    }
    return outp;
  };
  const skinned = (mesh) => {
    const g = mesh.geometry, pos = g.attributes.position, n = pos.count, o = new Float32Array(n * 3);
    const sets = [[g.attributes.skinIndex, g.attributes.skinWeight], [g.attributes.skinIndex1, g.attributes.skinWeight1]].filter(s => s[0]);
    const mats = mesh.skeleton.bones.map((b, i) => new T.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i]));
    const morphs = (g.morphAttributes.position ?? []).map((a, i) => [a, mesh.morphTargetInfluences?.[i] ?? 0]).filter(([, w]) => w);
    const v = new T.Vector3(), acc = new T.Vector3(), t = new T.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      for (const [a, w] of morphs) v.addScaledVector(t.fromBufferAttribute(a, i), w);
      v.applyMatrix4(mesh.bindMatrix); acc.set(0, 0, 0);
      for (const [si, sw] of sets) for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w) acc.addScaledVector(t.copy(v).applyMatrix4(mats[si.getComponent(i, k)]), w); }
      acc.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
      o[i * 3] = acc.x; o[i * 3 + 1] = acc.y; o[i * 3 + 2] = acc.z;
    }
    return o;
  };
  const head = face.meshes[0]; // the sections share one vertex buffer
  const boneByName = new Map(head.skeleton.bones.map(b => [b.name, b]));
  const measure = () => {
    root.updateMatrixWorld(true);
    const centre = boneByName.get("FACIAL_C_LipUpper1").getWorldPosition(new T.Vector3());
    const bp = skinned(bala), idx = bala.geometry.index.array, nt = idx.length / 3;
    const A = new T.Vector3(), B = new T.Vector3(), C = new T.Vector3(), P = new T.Vector3(), Q = new T.Vector3(), N = new T.Vector3(), tri = new T.Triangle();
    const near = []; for (let t = 0; t < nt; t++) { A.fromArray(bp, idx[t * 3] * 3); if (A.distanceTo(centre) < 0.07) near.push(t); }
    const hp = skinned(head); let worst = -Infinity, outside = 0, bone = "";
    const si = head.geometry.attributes.skinIndex, sw = head.geometry.attributes.skinWeight;
    for (let i = 0; i < hp.length / 3; i++) {
      P.fromArray(hp, i * 3); if (P.distanceTo(centre) > 0.05) continue; { let tb = "", tw = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > tw) { tw = w; tb = head.skeleton.bones[si.getComponent(i, k)].name; } } if (!/Lip/i.test(tb)) continue; }
      let best = Infinity, bt = -1;
      for (const t of near) { A.fromArray(bp, idx[t * 3] * 3); B.fromArray(bp, idx[t * 3 + 1] * 3); C.fromArray(bp, idx[t * 3 + 2] * 3); tri.set(A, B, C); tri.closestPointToPoint(P, Q); const d = Q.distanceToSquared(P); if (d < best) { best = d; bt = t; } }
      A.fromArray(bp, idx[bt * 3] * 3); B.fromArray(bp, idx[bt * 3 + 1] * 3); C.fromArray(bp, idx[bt * 3 + 2] * 3); tri.set(A, B, C); tri.closestPointToPoint(P, Q); tri.getNormal(N);
      const s = P.clone().sub(Q).dot(N);
      if (s > 0) outside++;
      if (s > worst) { worst = s; let tw = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > tw) { tw = w; bone = head.skeleton.bones[si.getComponent(i, k)].name; } } }
    }
    return { outside, worstMm: +(worst * 1000).toFixed(2), bone };
  };
  const pos = bala.geometry.attributes.position;
  const results = [];
  for (const c of configs) {
    custom = c.weights; face.wrapWeights = null;
    window.__rigAnim.play("cn-emote-weaponmaster", 3.2);
    await frame(); await frame();
    const moved = face.cage.displace(target);
    const row = { name: c.name };
    // (a) the viewer's own wrap, as drawn
    row.viewer = measure();
    // (a') our binding to the worn cage, rigid frame (sanity: should match the viewer)
    const rigid = new Float32Array(still.length);
    HW.applyHeadWrap(binding, moved, target, triangles, rigid);
    pos.array.set(rigid); pos.needsUpdate = true; row.rigid = measure();
    // (b) UE normal-interpolated offset, as a displacement from the still wrap
    const ueMoved = ue(moved);
    for (let i = 0; i < still.length; i++) pos.array[i] = still[i] + (ueMoved[i] - ueRest[i]);
    pos.needsUpdate = true; row.ue = measure();
    const sk = ueSkinned(x => face.cage.displace(x));
    for (let i = 0; i < still.length; i++) pos.array[i] = still[i] + (sk[i] - ueRest[i]);
    pos.needsUpdate = true; row.ueSkinnedN = measure();
    // (c) the still wrap (the part not following the face at all)
    pos.array.set(still); pos.needsUpdate = true; row.still = measure();
    face.wrapWeights = null; // the viewer re-wraps next frame
    results.push(row);
  }
  return { source, headMesh, results };
}, configs);
console.log(out.source, out.headMesh);
for (const r of out.results) console.log(r.name.padEnd(20), "viewer", JSON.stringify(r.viewer), "| rigid", JSON.stringify(r.rigid), "| UE", JSON.stringify(r.ue), "| UE skinned N", JSON.stringify(r.ueSkinnedN), "| still", JSON.stringify(r.still));
await browser.close();
