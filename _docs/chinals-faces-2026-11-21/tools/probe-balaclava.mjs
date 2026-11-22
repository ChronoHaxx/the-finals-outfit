// Probe (22 Nov 2026, the balaclava lip clip; README.md "Balaclava lip clip"): how far does the head's mouth poke through the balaclava at Unrivaled Master 3.2 s, and
// which part of the face pose and the wrap is responsible? Dev preview (serve-preview.mjs, port 5202).
//   node _docs/chinals-faces-2026-11-21/tools/probe-balaclava.mjs   (worktree root)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const CLIP = process.env.CLIP ?? "cn-emote-weaponmaster", TIME = Number(process.env.TIME ?? 3.2);
const ROUTE = process.env.ROUTE ?? "chinals";
const FACE = process.env.FACE ?? "head-face-01-base";
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: FACE, facewear: process.env.ITEM ?? "streetwear-balaclava-cotton-black" };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("console", m => { if (/face|wrap/i.test(m.text())) console.log("[page]", m.text().slice(0, 300)); });
await page.goto(`${BASE}/?reconstructed=1&outfit=${encode(BODY)}${ROUTE === "chinals" ? "#/chinals" : ""}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [CLIP, TIME]);
await page.waitForTimeout(5000);
await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [CLIP, TIME]);
await page.waitForTimeout(1000);

const result = await page.evaluate(async ([CLIP, TIME]) => {
  const T = window.__THREE, A = window.__rigAnim.animator, F = A.face;
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const reseek = async () => { A.seek(TIME); await frames(3); window.__rigRoot.updateMatrixWorld(true); };
  const heads = F.meshes;
  const wrapped = [];
  window.__rigRoot.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs) wrapped.push(o); });
  const skinned = mesh => {
    const pos = mesh.geometry.attributes.position, n = pos.count, out = new Float32Array(n * 3), v = new T.Vector3();
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
    return out;
  };
  const bone = name => { let b = null; for (const m of heads) for (const x of m.skeleton.bones) if (x.name === name && (!b || x.userData.sourceBoneExtension)) b = x; return b; };
  const lipU = bone("FACIAL_C_LipUpper"), lipL = bone("FACIAL_C_LipLower"), noseTip = bone("FACIAL_C_NoseTip");
  function measure(label) {
    const c = lipU.getWorldPosition(new T.Vector3()).add(lipL.getWorldPosition(new T.Vector3())).multiplyScalar(0.5);
    // head vertices within 4 cm of the mouth centre
    const hv = [];
    for (const m of heads) { const p = skinned(m); for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - c.x, p[i + 1] - c.y, p[i + 2] - c.z) < 0.04) hv.push([p[i], p[i + 1], p[i + 2], m.name]); }
    // balaclava skinned positions + normals from its own triangles
    const bp = [], bn = [];
    for (const m of wrapped) {
      const p = skinned(m), g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(p, 3)); if (m.geometry.index) g.setIndex(m.geometry.index);
      g.computeVertexNormals();
      // orientation: the published normals point outwards; flip the computed ones if they disagree on average
      const nn = g.attributes.normal.array, on = m.geometry.attributes.normal?.array;
      let agree = 0; if (on) { const q = new T.Vector3(), r = new T.Vector3(), nm = new T.Matrix3().getNormalMatrix(m.matrixWorld);
        for (let i = 0; i < nn.length; i += 30) { q.fromArray(nn, i); r.fromArray(on, i).applyMatrix3(nm); agree += Math.sign(q.dot(r)); } }
      const s = agree < 0 ? -1 : 1;
      for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - c.x, p[i + 1] - c.y, p[i + 2] - c.z) < 0.08) { bp.push(p[i], p[i + 1], p[i + 2]); bn.push(s * nn[i], s * nn[i + 1], s * nn[i + 2]); }
    }
    let worst = -Infinity, poke = 0, worstAt = null;
    for (const [x, y, z, name] of hv) {
      let best = Infinity, bi = -1;
      for (let j = 0; j < bp.length; j += 3) { const d = (x - bp[j]) ** 2 + (y - bp[j + 1]) ** 2 + (z - bp[j + 2]) ** 2; if (d < best) { best = d; bi = j; } }
      const d = (x - bp[bi]) * bn[bi] + (y - bp[bi + 1]) * bn[bi + 1] + (z - bp[bi + 2]) * bn[bi + 2];
      if (d > 0) poke++;
      if (d > worst) { worst = d; worstAt = { name, distToMouth: +Math.hypot(x - c.x, y - c.y, z - c.z).toFixed(4) }; }
    }
    return { label, headVerts: hv.length, balVerts: bp.length / 3, pokeVerts: poke, worstMm: +(worst * 1000).toFixed(2), worstAt,
      lipUpperFwdMm: null };
  }
  const out = [];
  const source = A.front?.()?.getClip?.()?.userData?.source ?? [...F.curves.keys()].find(k => /weaponmaster/i.test(k)) ?? [...F.curves.keys()][0];
  const keepCurves = F.curves.get(source);
  out.push({ source, curveNames: Object.keys(keepCurves?.curves ?? {}) });
  await reseek(); out.push(measure("baseline: mask + wrap"));
  // weights at this frame, for the record
  const frame = TIME / keepCurves.frameTime, sample = ([k, v]) => { if (frame <= k[0]) return v[0]; const L = k.length - 1; if (frame >= k[L]) return v[L]; let i = 0; while (k[i + 1] < frame) i++; return v[i] + (v[i + 1] - v[i]) * (frame - k[i]) / (k[i + 1] - k[i]); };
  out.push({ weights: Object.fromEntries(Object.entries(keepCurves.curves).map(([n, c]) => [n, +sample(c).toFixed(3)]).filter(([, w]) => w > 0.01)) });
  // the cage left still: the part keeps its rest wrap while the face moves
  const wraps = F.wraps; F.wraps = []; for (const p of wraps) p.rewrap(null, 0);
  await reseek(); out.push(measure("cage still (no wrap follow)"));
  F.wraps = wraps; F.wrapWeights = null;
  // pose subsets
  const only = async (names, label) => {
    F.curves.set(source, { ...keepCurves, curves: Object.fromEntries(Object.entries(keepCurves.curves).filter(([n]) => names === null ? true : names.some(x => x === n))) });
    F.wrapWeights = null; await reseek(); out.push(measure(label));
  };
  const all = Object.keys(keepCurves.curves);
  await only(all.filter(n => n !== "Face_Surprise"), "without Surprise");
  await only(all.filter(n => n !== "Face_BlueSteel"), "without BlueSteel");
  await only(["Face_Surprise"], "Surprise only");
  await only(["Face_BlueSteel"], "BlueSteel only");
  await only([], "no poses (rest)");
  F.curves.set(source, keepCurves); F.wrapWeights = null;
  // the mask: what if the lips kept less?
  const masks = F.masks;
  F.masks = []; F.boneMask = null; F.wrapWeights = null; await reseek(); out.push(measure("no mask (full motion)"));
  F.masks = masks; F.boneMask = null; F.wrapWeights = null; await reseek(); out.push(measure("baseline again"));
  // cage: which bones carry the cage vertices nearest the upper lip, and the mask's weight on them
  const cage = F.cage;
  if (cage) {
    const skin = cage.skin, width = skin.influences ?? 4, head = heads[0];
    const lipBind = new T.Vector3().setFromMatrixPosition(head.skeleton.boneInverses[head.skeleton.bones.indexOf(lipU)].clone().invert()).applyMatrix4(head.bindMatrixInverse);
    const near = [];
    for (let v = 0; v < skin.positions.length / 3; v++) {
      const d = Math.hypot(skin.positions[v * 3] - lipBind.x, skin.positions[v * 3 + 1] - lipBind.y, skin.positions[v * 3 + 2] - lipBind.z);
      if (d < 0.025) near.push({ v, d: +d.toFixed(4), w: Array.from({ length: width }, (_, k) => [skin.bones[skin.joints[v * width + k]], +skin.weights[v * width + k].toFixed(3)]).filter(([, w]) => w > 0) });
    }
    near.sort((a, b) => a.d - b.d);
    out.push({ lipBind: lipBind.toArray().map(x => +x.toFixed(4)), cageNearUpperLip: near.slice(0, 12), mask: F.masks.map(m => m.name) });
  }
  return out;
}, [CLIP, TIME]);
console.log(JSON.stringify(result, null, 1));
writeFileSync(`scripts/generated/chinals-faces-2026-11-21/probe-balaclava-${CLIP}-${TIME}.json`, JSON.stringify(result, null, 1));
await browser.close();
