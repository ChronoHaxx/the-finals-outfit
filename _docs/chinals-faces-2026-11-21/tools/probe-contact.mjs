// Probe (22 Nov 2026, the balaclava lip clip; README.md "Balaclava lip clip"): the face contact (FaceWrap.ts FaceContact) against the face coming through a wrapped part.
// For one outfit and clip: the worst depth of the head inside the part over the whole clip (every SAMPLE s), with the
// contact on and off, and the contact's bind and per-frame cost. Dev preview (serve-preview.mjs, port 5202).
// The depth metric still flags skin at the part's holes and rims (eye holes, the neck rim, a scarf's folds), where skin
// shows by design or the body skins the two differently, the same with the contact on and off: judge those by eye
// (capture-contact.mjs). REGION=front keeps the lips, mouth, nose, cheeks, jaw and chin.
//   ROUTE=chinals CLIP=cn-emote-weaponmaster SLOT=facewear ITEM=streetwear-balaclava-cotton-black \
//     node _docs/chinals-faces-2026-11-21/tools/probe-contact.mjs   (worktree root)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const ROUTE = process.env.ROUTE ?? "chinals", CLIP = process.env.CLIP ?? "cn-emote-weaponmaster";
const SLOT = process.env.SLOT ?? "facewear", ITEM = process.env.ITEM ?? "streetwear-balaclava-cotton-black";
const SAMPLE = Number(process.env.SAMPLE ?? 0.1), FACE = process.env.FACE ?? "head-face-01-base";
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: FACE, [SLOT]: ITEM };
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const warnings = [];
page.on("console", m => { if (/\[face\]/.test(m.text())) warnings.push(m.text().slice(0, 300)); });
page.on("pageerror", e => warnings.push(String(e).slice(0, 300)));
await page.goto(`${BASE}/?reconstructed=1&outfit=${encode(BODY)}${ROUTE === "chinals" ? "#/chinals" : ""}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
await page.evaluate(id => window.__rigAnim.play(id, 0.5), CLIP);
await page.waitForTimeout(5000);
await page.evaluate(id => window.__rigAnim.play(id, 0.5), CLIP);
await page.waitForTimeout(1000);

const result = await page.evaluate(async ([SAMPLE, LENGTH, process_env_region]) => {
  const T = window.__THREE, A = window.__rigAnim.animator, F = A.face;
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const heads = F.meshes, parts = F.wraps.filter(p => p.contact), meshes = parts.map(p => p.contact.mesh);
  if (!meshes.length) return { error: "no wrapped part worn" };
  const skinned = mesh => {
    const pos = mesh.geometry.attributes.position, n = pos.count, out = new Float32Array(n * 3), v = new T.Vector3();
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
    return out;
  };
  // The head's vertices that the parts cover at rest (within 1 cm, outside, facing the same way), and their depth now.
  let covered = null;
  // The parts' drawn surfaces now (world space): triangles gridded, each with its outward normal (the side its
  // published vertex normals face). A head vertex's depth = signed distance from its nearest triangle, + outside.
  const CELL = 0.01, key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512), cell = v => Math.floor(v / CELL);
  function surfaces() {
    return meshes.map(m => {
      const p = skinned(m), tris = m.geometry.index ? Array.from(m.geometry.index.array) : [...Array(p.length / 3).keys()];
      const on = m.geometry.attributes.normal.array, nm = new T.Matrix3().getNormalMatrix(m.matrixWorld), N = new Float32Array(tris.length);
      const grid = new Map(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), s = new T.Vector3(), r = new T.Vector3();
      for (let t = 0; t < tris.length; t += 3) {
        a.fromArray(p, tris[t] * 3); b.fromArray(p, tris[t + 1] * 3); c.fromArray(p, tris[t + 2] * 3);
        n.subVectors(b, a).cross(r.subVectors(c, a)).normalize();
        s.set(0, 0, 0); for (let k = 0; k < 3; k++) s.add(r.fromArray(on, tris[t + k] * 3).applyMatrix3(nm));
        if (n.dot(s) < 0) n.negate();
        N.set([n.x, n.y, n.z], t);
        const lo = [0, 1, 2].map(j => cell(Math.min(a.getComponent(j), b.getComponent(j), c.getComponent(j))));
        const hi = [0, 1, 2].map(j => cell(Math.max(a.getComponent(j), b.getComponent(j), c.getComponent(j))));
        for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
          const k = key(x, y, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
        }
      }
      return { p, tris, N, grid };
    });
  }
  const tri = new T.Triangle(), qa = new T.Vector3(), qb = new T.Vector3(), qc = new T.Vector3(), qp = new T.Vector3(), qq = new T.Vector3();
  const bw = new T.Vector3();
  function signed(S, x, y, z) { // the plane distance to the nearest part triangle the point projects INTO (within 1 cm);
    qp.set(x, y, z);              // null at a hole or past the part's edge: skin there shows by design, it does not poke
    let best = 0.01, out = null;
    for (const { p, tris, N, grid } of S) {
      const cx = cell(x), cy = cell(y), cz = cell(z), seen = new Set();
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) for (let k = cz - 1; k <= cz + 1; k++) for (const t of grid.get(key(i, j, k)) ?? []) {
        if (seen.has(t)) continue; seen.add(t);
        tri.set(qa.fromArray(p, tris[t] * 3), qb.fromArray(p, tris[t + 1] * 3), qc.fromArray(p, tris[t + 2] * 3));
        const d = (x - qa.x) * N[t] + (y - qa.y) * N[t + 1] + (z - qa.z) * N[t + 2];
        if (Math.abs(d) >= best) continue;
        qq.set(x - d * N[t], y - d * N[t + 1], z - d * N[t + 2]);
        if (!tri.getBarycoord(qq, bw) || Math.min(bw.x, bw.y, bw.z) < -0.02) continue;
        best = Math.abs(d); out = d;
      }
    }
    return out;
  }
  function depth() {
    const S = surfaces(), H = heads.map(skinned);
    if (!covered) { // called first with the face at rest: the head vertices the parts cover then (within 1 cm, inside)
      covered = [];
      // REGION=front: only head vertices whose strongest bone is a lip, mouth, nose, cheek, jaw or chin bone.
      const FRONT = /FACIAL_.*(Lip|Mouth|Nose|Nostril|Cheek|Jaw|Chin|Teeth|Tongue)/i;
      const front = (s, v) => { if (process_env_region !== "front") return true; const g = heads[s].geometry; let bw = 0, bn = "";
        for (const [ji, wi] of [["skinIndex", "skinWeight"], ["skinIndex1", "skinWeight1"]]) { const J = g.getAttribute(ji), W = g.getAttribute(wi); if (J) for (let k = 0; k < 4; k++) if (W.getComponent(v, k) > bw) { bw = W.getComponent(v, k); bn = heads[s].skeleton.bones[J.getComponent(v, k)].name; } }
        return FRONT.test(bn) && !/UnderChin/i.test(bn); };
      H.forEach((h, s) => { for (let i = 0; i < h.length; i += 3) { if (!front(s, i / 3)) continue; const d = signed(S, h[i], h[i + 1], h[i + 2]); if (d !== null && d < 0) covered.push([s, i]); } });
      return { covered: covered.length };
    }
    const depths = new Float32Array(covered.length);
    covered.forEach(([s, i], k) => { depths[k] = signed(S, H[s][i], H[s][i + 1], H[s][i + 2]) ?? -1; });
    return depths;
  }
  // The face's own pokes: covered head vertices outside the part with the face moving, and further out than with the
  // face held at rest on the same body frame (the body's own skinning differences, e.g. the neck rim, are not the face's).
  const source = A.info?.(A.state.current)?.source ?? [...F.curves.keys()].at(-1), keepCurves = F.curves.get(source);
  async function facePokes(t) {
    F.curves.set(source, { ...keepCurves, curves: {} }); F.wrapWeights = null; A.seek(t); await frames(2); window.__rigRoot.updateMatrixWorld(true);
    const still = depth();
    F.curves.set(source, keepCurves); F.wrapWeights = null; A.seek(t); await frames(2); window.__rigRoot.updateMatrixWorld(true);
    const moving = depth();
    let poke = 0, worst = -Infinity, bodyWorst = -Infinity, worstK = -1;
    moving.forEach((d, k) => { bodyWorst = Math.max(bodyWorst, still[k]); if (d > 0 && still[k] <= 0) { poke++; if (d > worst) { worst = d; worstK = k; } } });
    let where = null;
    if (worstK >= 0) { // the worst vertex: its strongest bones, and how far its still depth was from the surface
      const [s, i] = covered[worstK], g = heads[s].geometry, v = i / 3, bw = [];
      for (const [ji, wi] of [["skinIndex", "skinWeight"], ["skinIndex1", "skinWeight1"]]) { const J = g.getAttribute(ji), W = g.getAttribute(wi); if (J) for (let k = 0; k < 4; k++) if (W.getComponent(v, k) > 0.05) bw.push([heads[s].skeleton.bones[J.getComponent(v, k)].name, +W.getComponent(v, k).toFixed(2)]); }
      where = { section: heads[s].name, vertex: v, bones: bw.sort((x, y) => y[1] - x[1]).slice(0, 3), stillMm: +(still[worstK] * 1000).toFixed(2) };
    }
    return { poke, worstMm: poke ? +(worst * 1000).toFixed(2) : 0, bodyOnlyWorstMm: +(bodyWorst * 1000).toFixed(2), where };
  }
  const duration = A.front?.()?.getClip?.()?.duration ?? A.state.current?.duration ?? null;
  const clip = A.state.current, length = LENGTH || duration || A.info(clip)?.duration || 6;
  const scan = async label => {
    let worst = { worstMm: -Infinity }, pokeFrames = 0;
    for (let t = 0; t <= length + 1e-6; t += SAMPLE) {
      const d = await facePokes(t); if (d.poke) pokeFrames++;
      if (d.worstMm > worst.worstMm) worst = { ...d, t: +t.toFixed(3) };
    }
    return { label, worst, pokeFrames };
  };
  const out = { clip, length, parts: meshes.map(m => m.name) };
  window.__rigAnim.face(false); await frames(3); window.__rigRoot.updateMatrixWorld(true);
  out.rest = { covered: depth().covered, source };
  window.__rigAnim.face(true); await frames(3);
  // cost: bind (a fresh contact) and apply, timed on the worst frame's pose
  out.on = await scan("contact on");
  F.wrapWeights = null; A.seek(out.on.worst.t ?? 0); await frames(2);
  const timings = parts.map(part => {
    F.contacts = new WeakMap();
    let t0 = performance.now(); F.applyContact(part); const bind = performance.now() - t0;
    t0 = performance.now(); for (let k = 0; k < 20; k++) F.applyContact(part); const apply = (performance.now() - t0) / 20;
    const entry = F.contacts.get(part.contact.mesh);
    return { part: part.contact.mesh.name, vertices: part.contact.mesh.geometry.attributes.position.count, held: entry?.contact?.size ?? 0,
      bindMs: +bind.toFixed(1), applyMs: +apply.toFixed(2) };
  });
  out.timings = timings;
  // the same scan with the contact disabled
  const keep = F.applyContact; F.applyContact = () => {};
  out.off = await scan("contact off");
  F.applyContact = keep;
  return out;
}, [SAMPLE, Number(process.env.LENGTH ?? 0), process.env.REGION ?? "all"]);
result.warnings = [...new Set(warnings)];
console.log(JSON.stringify(result, null, 1));
writeFileSync(`scripts/generated/chinals-faces-2026-11-21/probe-contact-${CLIP}-${ITEM}.json`, JSON.stringify(result, null, 1));
await browser.close();
