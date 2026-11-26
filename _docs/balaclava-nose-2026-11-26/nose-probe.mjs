// nose-probe.mjs (26 Nov 2026): capture a face with a head-wrapped part on a DEV server and measure how far the head's
// nose-tip region comes through the knit. Dev builds only (it reads window.__rigRoot / __THREE and pins ?cam/?pose=a).
//   node nose-probe.mjs <worktree> <base, e.g. http://127.0.0.1:5217/the-finals-outfit> <outDir> <shots.json>
// shots.json: [{ name, slots: {face, facewear, ...}, query?: "bodyType=androgynous", cam?: [x,y,z,tx,ty,tz], fov?,
//               tweak?: "<JS expression evaluated in the page before the capture>" }]
// Per shot it prints `through` (nose-tip head vertices with the knit behind them) and `minGapMm` (the nearest knit
// crossing along +z from those vertices: negative = the skin is in front of the knit). Only vertices below the bridge
// count: the eye-hole rim gives false crossings (see face-contact notes).
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const [WT, BASE, OUT, SHOTS] = process.argv.slice(2);
const { chromium } = createRequire(path.join(WT, "package.json"))("playwright-core");
const { viewerUrl, SETTLE_MS } = await import(pathToFileURL(path.join(WT, "scripts/visual-diff/viewer-url.mjs")).href);
const enc = (s) => "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64url");
const shots = JSON.parse(readFileSync(SHOTS, "utf8"));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 840 }, deviceScaleFactor: 1.4 });
page.on("pageerror", (e) => console.warn("  pageerror:", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.warn("  console:", m.text().slice(0, 300)); });
const results = [];
for (const s of shots) {
  const cam = s.cam ?? [0, 1.71, 0.55, 0, 1.68, 0];
  const fov = s.fov ?? 26;
  const url = viewerUrl(BASE, `outfit=${enc(s.slots)}&cam=${cam.join(",")}&fov=${fov}&pose=a${s.query ? "&" + s.query : ""}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(SETTLE_MS.reconstructed + 500);
  if (s.tweak) { const r = await page.evaluate(s.tweak); console.log("  tweak:", JSON.stringify(r)); await page.waitForTimeout(SETTLE_MS.reconstructed + 500); }
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`), clip: await page.locator("canvas").first().boundingBox() });
  const probe = await page.evaluate(() => {
    const THREE = window.__THREE, root = window.__rigRoot;
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const desc = (m) => `${m.name}|${m.userData.sourceMesh ?? ""}|${m.userData.sourceBody ? "body" : ""}`;
    const worldPositions = (m) => {
      const pos = m.geometry.attributes.position, out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      return out;
    };
    const head = meshes.filter((m) => /SK_Head_|SK_CNS_/.test(m.userData.sourceMesh ?? "") && m.isSkinnedMesh);
    const wraps = meshes.filter((m) => m.userData.headWrapMorphs !== undefined || /Balaclava|Beard|Mask|Scarf/i.test(m.userData.sourceMesh ?? ""));
    if (!head.length || !wraps.length) return { meshes: meshes.map(desc), head: head.map(desc), wraps: wraps.map(desc) };
    // head points: the most forward head vertices (within 6 mm of the nose tip's z) near the midline
    let tip = -Infinity, tipY = 0; const hp = [];
    for (const m of head) { const w = worldPositions(m); hp.push(w); for (let i = 0; i < w.length; i += 3) if (Math.abs(w[i]) < 0.03 && w[i + 2] > tip) { tip = w[i + 2]; tipY = w[i + 1]; } }
    const pts = [];
    // the nose tip region only: below the bridge (eye-hole rims give false readings)
    for (const w of hp) for (let i = 0; i < w.length; i += 3) if (w[i + 2] > tip - 0.006 && Math.abs(w[i]) < 0.03 && w[i + 1] < tipY + 0.004) pts.push([w[i], w[i + 1], w[i + 2]]);
    // wrap triangles
    const tris = [];
    for (const m of wraps) {
      const w = worldPositions(m), idx = m.geometry.index;
      const n = idx ? idx.count : w.length / 3;
      for (let k = 0; k < n; k += 3) {
        const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
        tris.push([w[a * 3], w[a * 3 + 1], w[a * 3 + 2], w[b * 3], w[b * 3 + 1], w[b * 3 + 2], w[c * 3], w[c * 3 + 1], w[c * 3 + 2]]);
      }
    }
    // ray along +z from each head point: signed distance to the nearest knit crossing (+ in front, - behind)
    const hit = (o, d, t) => {
      const e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) return null;
      const inv = 1 / det, s = [o[0] - t[0], o[1] - t[1], o[2] - t[2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv; if (u < 0 || u > 1) return null;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 0 || u + v > 1) return null;
      return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    };
    let worst = Infinity, worstPt = null, through = 0;
    for (const o of pts) {
      let best = Infinity;
      for (const t of tris) { const d = hit(o, [0, 0, 1], t); if (d !== null && Math.abs(d) < Math.abs(best) && Math.abs(d) < 0.03) best = d; }
      if (best < 0) through++;
      if (best < worst) { worst = best; worstPt = o; }
    }
    return { head: head.map(desc), wraps: wraps.map((m) => desc(m) + " morphs=" + JSON.stringify(m.userData.headWrapMorphs)),
      headMorphs: head.map((m) => m.userData.sourceFittingMorphs), tipZ: tip, tipY, points: pts.length, through,
      minGapMm: Number.isFinite(worst) ? +(worst * 1000).toFixed(2) : null, at: worstPt?.map((x) => +x.toFixed(4)) };
  });
  console.log(s.name, JSON.stringify(probe));
  results.push({ name: s.name, url, probe });
}
writeFileSync(path.join(OUT, "probe.json"), JSON.stringify(results, null, 1));
await browser.close();
