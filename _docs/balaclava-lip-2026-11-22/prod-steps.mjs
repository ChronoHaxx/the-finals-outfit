// Production-build run of functional-checklist.md (22 Nov 2026), by the agent under the owner's standing waiver.
// Builds the app with deploy.yml's production settings plus the Chinals host that carries the faces (7c9add72, PR #71;
// main still names dcb131a5, which has none), serves it at /the-finals-outfit/ and drives it as a visitor
// (navigator.webdriver masked): equips through the item list, zooms with the mouse, pauses emotes with the app's own
// window.__rigAnim hook (published in production builds for scripted captures), and measures how far the worn head's
// upper-lip vertices sit outside the balaclava (mm, + = outside). Screenshots and prod-steps.json go to
// scripts/generated/balaclava-lip/prod (gitignored); the summary is copied beside this file.
//   node _docs/balaclava-lip-2026-11-22/prod-steps.mjs [--chinals=<host URL ending in />] [--skip-build]
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = process.cwd();
const deploy = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const host = name => {
  const value = new RegExp("^\\s+" + name + ":\\s*(https://[^\\s'\"]+)", "m").exec(deploy)?.[1];
  if (!value) throw new Error(`deploy.yml has no ${name}`);
  return value;
};
const CHINALS = arg("chinals", "https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/");
const scratch = path.join(root, "scripts/generated/balaclava-lip/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public"), shots = path.join(scratch, "shots");
Object.assign(process.env, {
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: host("ASSETS_BASE"), VITE_MODELS_BASE: host("MODELS_BASE"),
  VITE_RECONSTRUCTION_BASE: host("RECONSTRUCTION_BASE"), VITE_SHARE_PREVIEW_BASE: host("SHARE_PREVIEW_BASE"),
  VITE_SCENES_BASE: host("SCENES_BASE"), VITE_ANIMATIONS_BASE: host("ANIMATIONS_BASE"),
  VITE_CHINALS_ANIMATIONS_BASE: CHINALS, VITE_RECONSTRUCTION_ROUTES_FILE: "src/data/reconstruction-routes.json",
});
mkdirSync(shots, { recursive: true });
if (!process.argv.includes("--skip-build")) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // this script's own scratch output only
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg"));
  await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
    build: { outDir, emptyOutDir: true } });
}
const server = await preview({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir },
  preview: { port: 4358, strictPort: true, host: "127.0.0.1" } });
const APP = "http://127.0.0.1:4358/the-finals-outfit/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const errors = [], bad = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
page.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const settle = ms => page.waitForTimeout(ms);
const ready = () => page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
async function equip(category, name) {
  await page.keyboard.press("Escape");
  await page.locator("button", { hasText: new RegExp(`^\\s*${category}\\s*\\d*\\s*$`, "i") }).first().click();
  await page.getByPlaceholder(new RegExp(`Search ${category}`, "i")).fill(name);
  await settle(800);
  await page.locator("button", { hasText: new RegExp(name, "i") }).first().click();
  await page.waitForFunction(n => document.body.innerText.toLowerCase().includes(n.toLowerCase()), name, { timeout: 30000 });
  await settle(8000);
}
async function zoomOnFace(from) {
  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up({ button: "right" });
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await settle(1500);
}
const pause = async (id, t) => { await page.evaluate(([c, s]) => window.__rigAnim.play(c, s), [id, t]); await settle(3500); };
/** Upper-lip vertices of the worn head against the balaclava: CPU skinning (8 influences, morphs) of both meshes. */
const lip = () => page.evaluate(() => {
  const face = window.__rigAnim.animator.face, heads = face.meshes;
  if (!heads.length) return null;
  let root = heads[0]; while (root.parent) root = root.parent;
  let bala = null; root.traverse(o => { if (o.isMesh && o.userData.headWrapMorphs !== undefined && /Balaclava/i.test(o.name)) bala = o; });
  if (!bala) return { balaclava: false };
  root.updateMatrixWorld(true);
  const V = heads[0].position.constructor, M = heads[0].matrixWorld.constructor;
  const skinned = mesh => {
    const g = mesh.geometry, pos = g.attributes.position, n = pos.count, out = new Float64Array(n * 3);
    const sets = [[g.attributes.skinIndex, g.attributes.skinWeight], [g.attributes.skinIndex1, g.attributes.skinWeight1]].filter(s => s[0]);
    const mats = mesh.skeleton.bones.map((b, i) => new M().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i]));
    const morphs = (g.morphAttributes.position ?? []).map((a, i) => [a, mesh.morphTargetInfluences?.[i] ?? 0]).filter(([, w]) => w);
    const v = new V(), acc = new V(), t = new V();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      for (const [a, w] of morphs) v.addScaledVector(t.fromBufferAttribute(a, i), w);
      v.applyMatrix4(mesh.bindMatrix); acc.set(0, 0, 0);
      for (const [si, sw] of sets) for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w) acc.addScaledVector(t.copy(v).applyMatrix4(mats[si.getComponent(i, k)]), w); }
      acc.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
    }
    return out;
  };
  const head = heads[0], si = head.geometry.attributes.skinIndex, sw = head.geometry.attributes.skinWeight;
  const hp = skinned(head), bp = skinned(bala), idx = bala.geometry.index.array;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const at = (p, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const closest = (p, a, b, c) => { const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
    const bp2 = sub(p, b), d3 = dot(ab, bp2), d4 = dot(ac, bp2); if (d3 >= 0 && d4 <= d3) return b; const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c; const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const bc = sub(c, b); return [b[0] + w * bc[0], b[1] + w * bc[1], b[2] + w * bc[2]]; }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; };
  const lipBones = new Set(head.skeleton.bones.map((b, i) => /LipUpper/.test(b.name) ? i : -1).filter(i => i >= 0));
  const lipVerts = [];
  for (let i = 0; i < hp.length / 3; i++) { let tb = -1, tw = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > tw) { tw = w; tb = si.getComponent(i, k); } } if (lipBones.has(tb)) lipVerts.push(i); }
  const centre = lipVerts.reduce((c, i) => [c[0] + hp[i * 3] / lipVerts.length, c[1] + hp[i * 3 + 1] / lipVerts.length, c[2] + hp[i * 3 + 2] / lipVerts.length], [0, 0, 0]);
  const near = []; for (let t = 0; t < idx.length / 3; t++) { const a = at(bp, idx[t * 3]); if (Math.hypot(...sub(a, centre)) < 0.06) near.push(t); }
  let worst = -Infinity, outside = 0;
  for (const i of lipVerts) {
    const p = at(hp, i); let best = Infinity, bt = -1, q = null;
    for (const t of near) { const c = closest(p, at(bp, idx[t * 3]), at(bp, idx[t * 3 + 1]), at(bp, idx[t * 3 + 2])); const d = Math.hypot(...sub(p, c)); if (d < best) { best = d; bt = t; q = c; } }
    const a = at(bp, idx[bt * 3]), b = at(bp, idx[bt * 3 + 1]), c = at(bp, idx[bt * 3 + 2]), n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n);
    const s = dot(sub(p, q), n) / l; if (s > 0) outside++; worst = Math.max(worst, s);
  }
  return { balaclava: true, upperLipVertices: lipVerts.length, outside, worstMm: +(worst * 1000).toFixed(2), masks: face.masks.map(m => m.name) };
});
const out = { app: APP, chinals: CHINALS, at: new Date().toISOString(), steps: {} };

await page.goto(`${APP}#/chinals`, { waitUntil: "load", timeout: 180000 });
await ready();
await page.keyboard.press("Escape");
await settle(5000);
await zoomOnFace([1000, 290]);
// 1. Full Beard in Unrivaled Master at 3.2 s (the jaw carries the beard).
await equip("Facial Hair", "Full Beard");
await pause("cn-emote-weaponmaster", 3.2);
await shot("step1-beard-unrivaled-master-3.2s");
out.steps.s1 = { wraps: await page.evaluate(() => window.__rigAnim.animator.face.wraps.length) };
// 2. Balaclava Cotton Black, same frame: the known sliver of upper lip at the knit's centre.
await equip("Facewear", "Balaclava Cotton Black");
await pause("cn-emote-weaponmaster", 3.2);
await shot("step2-balaclava-unrivaled-master-3.2s");
out.steps.s2 = await lip();
// 3. Facial animation off at the same frame, then on again.
const toggle = page.getByRole("button", { name: /Facial animation/ });
await toggle.click(); await settle(2500);
await shot("step3-balaclava-face-off");
out.steps.s3 = { off: await lip() };
await toggle.click(); await settle(2500);
out.steps.s3.onAgain = await lip();
// 4. Global Carrot Crusher at 1.47 s (Face_JawOpen 0.8): the same sliver.
await page.locator('button[title="THE FINALS as published worldwide"]:visible').first().click();
await settle(2000); await ready(); await settle(12000);
await pause("rabbit-carrot", 1.47);
await shot("step4-balaclava-global-carrot-crusher-1.47s");
// (The head is in profile at this frame and the carrot covers the mouth; balaclava-pout.mjs gives the front view.)
out.steps.s4 = { route: page.url(), ...(await lip()) };
// 5. Global, a pout without the jaw: Goblin Horn's Face_BlueSteel peak (0.3 s): the knit holds.
await pause("goblin-horn", 0.3).catch(e => { out.steps.s5error = String(e).slice(0, 200); });
await shot("step5-balaclava-global-goblin-horn-0.3s");
out.steps.s5 = await lip();
out.badResponses = bad; out.errors = [...new Set(errors)];
writeFileSync(path.join(scratch, "prod-steps.json"), JSON.stringify(out, null, 2));
writeFileSync(path.join(root, "_docs/balaclava-lip-2026-11-22/prod-steps.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
await new Promise(resolve => server.httpServer.close(resolve));
