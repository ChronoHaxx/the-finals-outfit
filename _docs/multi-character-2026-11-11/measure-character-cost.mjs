// What one more character would cost (11 Nov 2026, multi-character design). Read-only probe of the running dev app:
// it changes nothing in the repository or the asset folders.
//
// 1. Downloads: the app loaded with an EMPTY outfit, then outfit A, then outfit B, each in a fresh browser context.
//    Files the empty outfit already loads are what every character shares (body, skin, data); the rest belong to
//    the outfit. A and B share some pieces, so their overlap shows what two characters in similar outfits share.
//    Local files are served as stored; release hosts serve meshes gzip -9, so meshes also get a gzip estimate.
// 2. GPU memory of the rig (window.__rigRoot, DEV only): unique textures and geometries, body versus items.
// 3. Draw calls per frame (renderer.info, autoReset off for one frame), still and while the idle plays.
// 4. Frame time with 1 and with 4 characters on screen: three extra copies of the rig are cloned into the scene
//    (shared geometry and materials, own skeletons; the copies hold the still pose while the original plays the idle).
//    That is a lower bound on the draw cost of four characters: real extra characters bring their own materials.
//
// Usage (Git Bash, worktree root, dev server running: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/measure-character-cost.mjs > _docs/multi-character-2026-11-11/cost-v2.json
// (cost-v1.json lost most download entries to the 250-entry resource timing buffer; its GPU and frame numbers stand.)
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../../../../public"); // the root checkout's public/ (what the server serves)
const code = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const OUTFITS = {
  empty: {},
  A: { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
    feet: "casual-tallsneakers-canvas" }, // the starting look
  B: { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban",
    lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" },
  C: { face: "head-face-03-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban",
    lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" },
};

const gzCache = new Map();
function hostedBytes(url, bytes) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  if (!pathname.endsWith(".glb")) return bytes;
  if (gzCache.has(pathname)) return gzCache.get(pathname);
  const file = path.join(publicDir, pathname);
  const size = existsSync(file) ? gzipSync(readFileSync(file), { level: 9 }).length : bytes;
  gzCache.set(pathname, size);
  return size;
}

// In the page: unique GPU payloads under the rig, split into the body scene (first child) and everything else.
const GPU_PROBE = () => {
  const root = window.__rigRoot, THREE = window.__THREE;
  const body = root.children[0];
  const under = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };
  const textures = new Map(), geometries = new Map();
  const bpp = (t) => {
    const perChannel = t.type === THREE.FloatType ? 4 : t.type === THREE.HalfFloatType ? 2 : 1;
    const channels = t.format === THREE.RedFormat ? 1 : t.format === THREE.RGFormat ? 2 : t.format === THREE.RGBFormat ? 3 : 4;
    return perChannel * channels;
  };
  const texBytes = (t) => {
    if (t.isCompressedTexture) return (t.mipmaps ?? []).reduce((s, m) => s + (m.data?.byteLength ?? 0), 0);
    const img = t.image ?? {}; const w = img.width ?? 0, h = img.height ?? 0, d = img.depth ?? 1;
    if (t.mipmaps?.length && t.mipmaps[0]?.data) return t.mipmaps.reduce((s, m) => s + (m.data?.byteLength ?? 0), 0);
    const mips = t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
    return Math.round(w * h * d * bpp(t) * mips);
  };
  const geoBytes = (g) => {
    let s = g.index?.array.byteLength ?? 0;
    for (const a of Object.values(g.attributes)) s += a.array?.byteLength ?? 0;
    for (const list of Object.values(g.morphAttributes ?? {})) for (const a of list) s += a.array?.byteLength ?? 0;
    return s;
  };
  let meshes = 0, visibleMeshes = 0, skinned = 0, materialSlots = 0;
  const materials = new Set(), programs = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++; if (o.visible) visibleMeshes++; if (o.isSkinnedMesh) skinned++;
    const part = under(o, body) ? "body" : "items";
    if (!geometries.has(o.geometry)) geometries.set(o.geometry, { part, bytes: geoBytes(o.geometry) });
    const list = Array.isArray(o.material) ? o.material : [o.material];
    materialSlots += list.length;
    for (const m of list) {
      materials.add(m);
      try { programs.add(m.customProgramCacheKey?.() + "|" + m.type); } catch { /* ignore */ }
      const values = [...Object.values(m), ...Object.values(m.userData ?? {}), ...Object.values(m.uniforms ?? {}).map(u => u?.value)];
      for (const v of values) for (const t of Array.isArray(v) ? v : [v])
        if (t?.isTexture && !textures.has(t)) textures.set(t, { part, bytes: texBytes(t), w: t.image?.width, h: t.image?.height, name: t.name });
    }
  });
  const sum = (map, part) => [...map.values()].filter(e => !part || e.part === part).reduce((s, e) => s + e.bytes, 0);
  const mb = (n) => +(n / 1048576).toFixed(1);
  const big = [...textures.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8)
    .map(t => `${t.part}:${t.w}x${t.h}:${mb(t.bytes)}MB${t.name ? ":" + t.name : ""}`);
  return {
    meshes, visibleMeshes, skinned, materialSlots, materials: materials.size, distinctProgramKeys: programs.size,
    textures: textures.size, textureMB: { body: mb(sum(textures, "body")), items: mb(sum(textures, "items")), all: mb(sum(textures)) },
    geometries: geometries.size, geometryMB: { body: mb(sum(geometries, "body")), items: mb(sum(geometries, "items")), all: mb(sum(geometries)) },
    biggestTextures: big,
  };
};

// In the page: the r3f renderer, draw calls for one whole frame (every render() inside it), and renderer memory.
const FRAME_PROBE = () => new Promise((resolve) => {
  const gl = window.__rigRoot.__r3f?.root?.getState?.().gl;
  if (!gl) return resolve({ error: "renderer not reachable through __r3f" });
  requestAnimationFrame(() => {
    gl.info.autoReset = false; gl.info.reset();
    requestAnimationFrame(() => {
      const { calls, triangles } = gl.info.render; gl.info.autoReset = true;
      resolve({ calls, triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries,
        programs: gl.info.programs?.length ?? null });
    });
  });
});

const FRAME_TIMES = (frames) => new Promise((resolve) => {
  const d = []; let last = performance.now();
  const loop = (now) => { d.push(now - last); last = now;
    if (d.length < frames) requestAnimationFrame(loop);
    else { d.sort((a, b) => a - b); resolve({ median: +d[Math.floor(frames / 2)].toFixed(2), p95: +d[Math.floor(frames * 0.95)].toFixed(2) }); } };
  requestAnimationFrame(loop);
});

// In the page: three copies of the rig (SkeletonUtils.clone done by hand with the page's own THREE), 1.2 m apart.
const ADD_COPIES = () => {
  const root = window.__rigRoot, THREE = window.__THREE;
  const made = [];
  for (const x of [-1.2, 1.2, 2.4]) {
    const pairs = new Map();
    const copy = root.clone(true);
    const walk = (a, b) => { pairs.set(a, b); a.children.forEach((c, i) => walk(c, b.children[i])); };
    walk(root, copy);
    copy.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const source = [...pairs].find(([, b]) => b === o)[0];
      const bones = source.skeleton.bones.map(b => pairs.get(b) ?? b);
      o.bind(new THREE.Skeleton(bones, source.skeleton.boneInverses), source.bindMatrix);
    });
    copy.position.x = x;
    root.parent.add(copy);
    made.push(copy);
  }
  window.__copies = made;
  return made.length;
};

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true,
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
const result = { base: BASE, when: new Date().toISOString(), outfits: OUTFITS, loads: {}, gpu: {}, frames: {} };
const sets = {};
for (const [name, slots] of Object.entries(OUTFITS)) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  // Dev mode loads hundreds of JS modules: the default 250-entry resource timing buffer would drop the asset entries.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(100000));
  // anim=0: the still pose (no clip downloads in the outfit comparison).
  await page.goto(`${BASE}/?reconstructed=1&anim=0&outfit=${code(slots)}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot", null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const entries = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(e => ({ url: e.name.split("?")[0], bytes: e.decodedBodySize || e.encodedBodySize || 0 }))
    .filter(e => /\/(models|items|animations)\//.test(e.url) || /\.(glb|webp|png|bin|gz)$/.test(e.url)));
  const byUrl = new Map(); for (const e of entries) if (!byUrl.has(e.url)) byUrl.set(e.url, e.bytes);
  sets[name] = byUrl;
  result.gpu[name] = await page.evaluate(GPU_PROBE);
  result.frames[name] = { still: await page.evaluate(FRAME_PROBE) };
  if (name === "B") {
    // Moving: the idle on the original, measured alone and then with three still copies beside it.
    await page.evaluate(() => window.__rigAnim?.play("outfit-idle"));
    await page.waitForTimeout(2500);
    result.frames.B.idle1 = { draw: await page.evaluate(FRAME_PROBE), time: await page.evaluate(FRAME_TIMES, 240) };
    result.frames.B.copies = await page.evaluate(ADD_COPIES);
    await page.waitForTimeout(2500);
    result.frames.B.idle4 = { draw: await page.evaluate(FRAME_PROBE), time: await page.evaluate(FRAME_TIMES, 240) };
    // A quarter of the pixels: if the time barely drops, four characters are bound by geometry/CPU, not by fill.
    await page.setViewportSize({ width: 750, height: 500 });
    await page.waitForTimeout(2500);
    result.frames.B.idle4QuarterPixels = { time: await page.evaluate(FRAME_TIMES, 240) };
    await page.evaluate(() => window.__copies.forEach(c => c.removeFromParent()));
    await page.waitForTimeout(2500);
    result.frames.B.idle1QuarterPixels = { time: await page.evaluate(FRAME_TIMES, 240) };
  }
  await context.close();
  console.error(`${name}: ${byUrl.size} files`);
}
await browser.close();

const mb = (n) => +(n / 1048576).toFixed(1);
const total = (map, hosted) => [...map].reduce((s, [url, b]) => s + (hosted ? hostedBytes(url, b) : b), 0);
const minus = (a, b) => new Map([...a].filter(([url]) => !b.has(url)));
const both = (a, b) => new Map([...a].filter(([url]) => b.has(url)));
const describe = (map) => ({ files: map.size, localMB: mb(total(map, false)), hostedMB: mb(total(map, true)),
  biggest: [...map].map(([url, b]) => [url.replace(/^.*?\/(models|items|animations)\//, "$1/"), mb(hostedBytes(url, b))])
    .sort((x, y) => y[1] - x[1]).slice(0, 6).map(([u, m]) => `${m} MB ${u}`) });
result.loads = {
  shared_base: describe(sets.empty),
  A_outfit_only: describe(minus(sets.A, sets.empty)),
  B_outfit_only: describe(minus(sets.B, sets.empty)),
  C_outfit_only: describe(minus(sets.C, sets.empty)),
  A_and_B_outfit_overlap: describe(both(minus(sets.A, sets.empty), minus(sets.B, sets.empty))),
  B_and_C_outfit_overlap: describe(both(minus(sets.B, sets.empty), minus(sets.C, sets.empty))),
  C_new_after_B: describe(minus(minus(sets.C, sets.empty), sets.B)),
};
console.log(JSON.stringify(result, null, 2));
