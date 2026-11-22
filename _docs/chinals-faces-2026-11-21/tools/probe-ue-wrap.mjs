// Probe (22 Nov 2026, the balaclava lip clip; README.md "Balaclava lip clip"): does Unreal's cloth mesh-to-mesh formula (position = sum b_i (X_i + h N_i), N_i the
// proxy's smooth vertex normals) keep the balaclava over the pouting lip, where the viewer's rigid per-triangle frame
// lets it through? The face's motion is applied as a delta on the viewer's rest wrap, so only the motion differs.
//   node _docs/chinals-faces-2026-11-21/tools/probe-ue-wrap.mjs   (worktree root, dev preview on 5202)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const CLIP = process.env.CLIP ?? "cn-emote-weaponmaster", TIME = Number(process.env.TIME ?? 3.2);
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: process.env.FACE ?? "head-face-01-base", facewear: "streetwear-balaclava-cotton-black" };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`${BASE}/?reconstructed=1&outfit=${encode(BODY)}#/chinals`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [CLIP, TIME]);
await page.waitForTimeout(5000);
await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [CLIP, TIME]);
await page.waitForTimeout(1000);

const result = await page.evaluate(async ([TIME]) => {
  const T = window.__THREE, A = window.__rigAnim.animator, F = A.face;
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const reseek = async () => { F.wrapWeights = null; A.seek(TIME); await frames(3); window.__rigRoot.updateMatrixWorld(true); };
  const heads = F.meshes;
  let bal = null; window.__rigRoot.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs && /Balaclava/.test(o.name)) bal = o; });
  const skinned = mesh => {
    const pos = mesh.geometry.attributes.position, n = pos.count, out = new Float32Array(n * 3), v = new T.Vector3();
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
    return out;
  };
  const bone = name => { let b = null; for (const m of heads) for (const x of m.skeleton.bones) if (x.name === name && (!b || x.userData.sourceBoneExtension)) b = x; return b; };
  const lipU = bone("FACIAL_C_LipUpper"), lipL = bone("FACIAL_C_LipLower");
  function measure(label) {
    const c = lipU.getWorldPosition(new T.Vector3()).add(lipL.getWorldPosition(new T.Vector3())).multiplyScalar(0.5);
    const hv = [];
    for (const m of heads) { const p = skinned(m); for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - c.x, p[i + 1] - c.y, p[i + 2] - c.z) < 0.04) hv.push([p[i], p[i + 1], p[i + 2]]); }
    const p = skinned(bal), g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(p, 3)); g.setIndex(bal.geometry.index); g.computeVertexNormals();
    const nn = g.attributes.normal.array, on = bal.geometry.attributes.normal.array, nm = new T.Matrix3().getNormalMatrix(bal.matrixWorld);
    let agree = 0; const q = new T.Vector3(), r = new T.Vector3();
    for (let i = 0; i < nn.length; i += 30) { q.fromArray(nn, i); r.fromArray(on, i).applyMatrix3(nm); agree += Math.sign(q.dot(r)); }
    const s = agree < 0 ? -1 : 1, bp = [], bn = [];
    for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - c.x, p[i + 1] - c.y, p[i + 2] - c.z) < 0.08) { bp.push(p[i], p[i + 1], p[i + 2]); bn.push(s * nn[i], s * nn[i + 1], s * nn[i + 2]); }
    let worst = -Infinity, poke = 0;
    for (const [x, y, z] of hv) {
      let best = Infinity, bi = -1;
      for (let j = 0; j < bp.length; j += 3) { const d = (x - bp[j]) ** 2 + (y - bp[j + 1]) ** 2 + (z - bp[j + 2]) ** 2; if (d < best) { best = d; bi = j; } }
      const d = (x - bp[bi]) * bn[bi] + (y - bp[bi + 1]) * bn[bi + 1] + (z - bp[bi + 2]) * bn[bi + 2];
      if (d > 0) poke++; worst = Math.max(worst, d);
    }
    return { label, pokeVerts: poke, worstMm: +(worst * 1000).toFixed(2) };
  }
  const out = [];
  // 1. the worn rest cage, captured from the displacement the animator asks for
  let worn = null; const cage = F.cage, displace = cage.displace.bind(cage);
  cage.displace = c => { worn = Float32Array.from(c); return displace(c); };
  await reseek();
  out.push(measure("viewer wrap (posed)"));
  const posedViewer = Float32Array.from(bal.geometry.attributes.position.array);
  // 2. the balaclava's rest wrap: no pose weighted
  const source = [...F.curves.keys()].find(k => /WeaponMaster/i.test(k)), keep = F.curves.get(source);
  F.curves.set(source, { ...keep, curves: {} }); await reseek();
  const rest = Float32Array.from(bal.geometry.attributes.position.array);
  F.curves.set(source, keep); await reseek();
  // 3. the moved cage at this frame
  cage.update(); const moved = Float32Array.from(displace(worn));
  // 4. the proxy's triangles
  const url = performance.getEntriesByType("resource").map(e => e.name).find(n => /head-wraps\.json/.test(n)) ?? "/models/reconstructed-assemblies-v1/head-wraps.json";
  const data = await (await fetch(url)).json();
  const key = Object.keys(data.meshes).find(k => /Balaclava_M/.test(k)), tris = data.meshes[key].triangles;
  const V = (a, i) => new T.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
  const vertexNormals = pos => { // area-weighted, over the proxy's triangles
    const n = new Float64Array(pos.length);
    for (let t = 0; t < tris.length; t += 3) {
      const a = V(pos, tris[t]), b = V(pos, tris[t + 1]), c = V(pos, tris[t + 2]);
      const f = new T.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      for (const i of [tris[t], tris[t + 1], tris[t + 2]]) { n[i * 3] += f.x; n[i * 3 + 1] += f.y; n[i * 3 + 2] += f.z; }
    }
    for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return n;
  };
  const N0 = vertexNormals(worn), N1 = vertexNormals(moved);
  // 5. bind each rest vertex: closest proxy triangle, then UE's plane-projection bary + signed plane distance
  const closestOnTri = (p, a, b, c) => { // Ericson 5.1.5, returns the closest point
    const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
    const d1 = ab.dot(ap), d2 = ac.dot(ap); if (d1 <= 0 && d2 <= 0) return a.clone();
    const bp = p.clone().sub(b), d3 = ab.dot(bp), d4 = ac.dot(bp); if (d3 >= 0 && d4 <= d3) return b.clone();
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
    const cp = p.clone().sub(c), d5 = ab.dot(cp), d6 = ac.dot(cp); if (d6 >= 0 && d5 <= d6) return c.clone();
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const den = 1 / (va + vb + vc); return a.clone().addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
  };
  const count = rest.length / 3, ue = Float32Array.from(rest), ueExact = Float32Array.from(rest);
  let restErr = 0, hs = [];
  for (let i = 0; i < count; i++) {
    const p = V(rest, i);
    let best = Infinity, bt = 0;
    for (let t = 0; t < tris.length; t += 3) { const d = closestOnTri(p, V(worn, tris[t]), V(worn, tris[t + 1]), V(worn, tris[t + 2])).distanceToSquared(p); if (d < best) { best = d; bt = t; } }
    const ia = tris[bt], ib = tris[bt + 1], ic = tris[bt + 2], a = V(worn, ia), b = V(worn, ib), c = V(worn, ic);
    const plane = new T.Plane().setFromCoplanarPoints(a, b, c), h = plane.distanceToPoint(p), proj = plane.projectPoint(p, new T.Vector3());
    const bary = T.Triangle.getBarycoord(proj, a, b, c, new T.Vector3());
    // the UE4-style flat binding, and an exact solve of p = sum b_i (X_i + h N_i) (Newton on b, h)
    const na = V(N0, ia), nb = V(N0, ib), nc = V(N0, ic);
    let u = bary.y, v = bary.z, hh = h;
    for (let k = 0; k < 20; k++) {
      const w = 1 - u - v, f = a.clone().multiplyScalar(w).addScaledVector(b, u).addScaledVector(c, v)
        .add(na.clone().multiplyScalar(w).addScaledVector(nb, u).addScaledVector(nc, v).multiplyScalar(hh)).sub(p);
      const ju = b.clone().sub(a).add(nb.clone().sub(na).multiplyScalar(hh)), jv = c.clone().sub(a).add(nc.clone().sub(na).multiplyScalar(hh));
      const jh = na.clone().multiplyScalar(w).addScaledVector(nb, u).addScaledVector(nc, v);
      const J = new T.Matrix3().set(ju.x, jv.x, jh.x, ju.y, jv.y, jh.y, ju.z, jv.z, jh.z).invert();
      const s = f.applyMatrix3(J); u -= s.x; v -= s.y; hh -= s.z;
    }
    hs.push(h);
    const evalUE = (X, N, w0, w1, w2, d) => [0, 1, 2].map(j => w0 * (X[ia * 3 + j] + d * N[ia * 3 + j]) + w1 * (X[ib * 3 + j] + d * N[ib * 3 + j]) + w2 * (X[ic * 3 + j] + d * N[ic * 3 + j]));
    const r0 = evalUE(worn, N0, bary.x, bary.y, bary.z, h), r1 = evalUE(moved, N1, bary.x, bary.y, bary.z, h);
    restErr = Math.max(restErr, Math.hypot(r0[0] - p.x, r0[1] - p.y, r0[2] - p.z));
    for (let j = 0; j < 3; j++) ue[i * 3 + j] = rest[i * 3 + j] + (r1[j] - r0[j]);
    const e0 = evalUE(worn, N0, 1 - u - v, u, v, hh), e1 = evalUE(moved, N1, 1 - u - v, u, v, hh);
    for (let j = 0; j < 3; j++) ueExact[i * 3 + j] = rest[i * 3 + j] + (e1[j] - e0[j]);
  }
  hs.sort((x, y) => x - y);
  out.push({ restErrMm: +(restErr * 1000).toFixed(3), offsetFromCageMm: { min: +(hs[0] * 1000).toFixed(2), median: +(hs[hs.length >> 1] * 1000).toFixed(2), max: +(hs.at(-1) * 1000).toFixed(2) } });
  const attr = bal.geometry.attributes.position;
  attr.array.set(ue); attr.needsUpdate = true; out.push(measure("UE formula, flat binding (delta on the viewer's rest wrap)"));
  attr.array.set(ueExact); attr.needsUpdate = true; out.push(measure("UE formula, exact binding"));
  attr.array.set(posedViewer); attr.needsUpdate = true; out.push(measure("viewer wrap again"));
  return out;
}, [TIME]);
console.log(JSON.stringify(result, null, 1));
writeFileSync(`scripts/generated/chinals-faces-2026-11-21/probe-ue-wrap.json`, JSON.stringify(result, null, 1));
await browser.close();
