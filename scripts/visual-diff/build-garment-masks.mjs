// build-garment-masks.mjs — generate per-piece body-hide masks (clipping fix).
//
//   node scripts/visual-diff/build-garment-masks.mjs [--limit=N] [--only=<itemId>]
//
// For each unique garment piece (one item per gltfPath, slots that wrap the body), equip
// it in the live app (A-pose), find body vertices lying within PROXIMITY of the garment
// surface, and rasterize fully-covered body triangles into a body-UV mask saved as a
// sibling of the GLB: public/models/cosmetics/<piece>.bodymask.png. The runtime unions the
// masks of everything equipped and discards those body fragments (no more elbows through
// sleeves). Conservative: only triangles with ALL vertices covered are hidden, so garment
// edges never reveal holes. Requires `npm run dev`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const BASE = process.env.VDIFF_BASE ?? "http://localhost:5173";
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const LIMIT = Number(arg("limit", "100000"));
const ONLY = arg("only", "");

// face included: each head's neck/chest shell is cut differently, so the body-hide mask
// must be per-head (a shared mask leaves holes where a shorter shell ends).
const ALL_MASK_SLOTS = ["upperBody", "outerwear", "lowerBody", "feet", "hands", "face"];
const MASK_SLOTS = new Set((arg("slots", "") || ALL_MASK_SLOTS.join(",")).split(","));
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byPiece = new Map();
for (const i of items) {
  if (!i.model?.gltfPath || !MASK_SLOTS.has(i.slot)) continue;
  if (!byPiece.has(i.model.gltfPath)) byPiece.set(i.model.gltfPath, i);
}
let pieces = ONLY
  ? items.filter((i) => i.id === ONLY && i.model?.gltfPath)
  : [...byPiece.values()];
pieces = pieces.slice(0, LIMIT);
console.log(`garment masks: ${pieces.length} unique pieces`);

const encodeOutfit = (slots) =>
  "1." +
  Buffer.from(JSON.stringify({ slots }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 600 } });

let done = 0;
let written = 0;
for (const item of pieces) {
  const dest = resolve(ROOT, "public", item.model.gltfPath.replace(/\.glb$/, ".bodymask.png"));
  done++;
  try {
    await page.goto(
      `${BASE}/?outfit=${encodeOutfit({ [item.slot]: item.id })}&pose=a&cam=0,1.1,3,0,1,0&fov=30`,
      { waitUntil: "networkidle", timeout: 30000 },
    );
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 25000 });
    await page.waitForTimeout(250);
    const r = await page.evaluate((slot) => {
      const THREE = window.__THREE;
      let body = null;
      let headShell = null;
      const garments = [];
      window.__rigRoot.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m.name === "M_Skin") body = o;
        else if (/_Head$/i.test(m.name)) headShell = o;
        else if (!/Eye|Teeth|lash/i.test(m.name)) garments.push(o);
      });
      // Face pieces: the skin shell IS the covering mesh (eyes/teeth/lashes never are) —
      // include it ALWAYS for the face slot, not just when nothing else matched: stylized
      // heads ship extra meshes (anime hair, lacrimal fluid) that pass the garment filter
      // but never overlap the body, which silently produced zero coverage.
      if (headShell && (slot === "face" || !garments.length)) garments.push(headShell);
      if (!body || !garments.length) return { error: "meshes missing" };

      // Garment shells sit ~5-15mm off the body — use a TIGHT tolerance (a wide one
      // over-covers past the shell rim and exposes hidden-body backfaces as a jagged
      // band). Only when the tight pass finds nothing (stylized heads like the anime
      // face-11 whose shell sits farther out) retry wide.
      const v = new THREE.Vector3();
      const gverts = [];
      let gv = 0;
      for (const g of garments) {
        const pos = g.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          g.getVertexPosition(i, v);
          gverts.push(v.x, v.y, v.z);
          gv++;
        }
      }
      const bp = body.geometry.attributes.position;
      const bverts = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++) {
        body.getVertexPosition(i, v);
        bverts[i * 3] = v.x;
        bverts[i * 3 + 1] = v.y;
        bverts[i * 3 + 2] = v.z;
      }
      const coverAt = (TOL) => {
        const grid = new Set();
        const key = (x, y, z) =>
          `${Math.round(x / TOL)},${Math.round(y / TOL)},${Math.round(z / TOL)}`;
        for (let i = 0; i < gverts.length; i += 3)
          grid.add(key(gverts[i], gverts[i + 1], gverts[i + 2]));
        const cov = new Uint8Array(bp.count);
        let n = 0;
        for (let i = 0; i < bp.count; i++) {
          const cx = Math.round(bverts[i * 3] / TOL);
          const cy = Math.round(bverts[i * 3 + 1] / TOL);
          const cz = Math.round(bverts[i * 3 + 2] / TOL);
          let hit = false;
          for (let dx = -1; dx <= 1 && !hit; dx++)
            for (let dy = -1; dy <= 1 && !hit; dy++)
              for (let dz = -1; dz <= 1 && !hit; dz++)
                if (grid.has(`${cx + dx},${cy + dy},${cz + dz}`)) hit = true;
          if (hit) {
            cov[i] = 1;
            n++;
          }
        }
        return { cov, n };
      };
      let pass = coverAt(0.014);
      if (pass.n < 12 && slot === "face") pass = coverAt(0.022);
      let covered = pass.cov;
      const cv = pass.n;

      const idx = body.geometry.index;
      if (slot === "face") {
        // Erode the coverage by two vertex rings: the head shell's alphaTest rim eats the
        // shell's edge, so an un-eroded mask pokes past the visible shell and exposes the
        // discard hole (dark interior-backface ring at the clavicle).
        for (let step = 0; step < 2; step++) {
          const keep = covered.slice();
          for (let t = 0; t < idx.count; t += 3) {
            const a = idx.getX(t);
            const b = idx.getX(t + 1);
            const c = idx.getX(t + 2);
            const ca = covered[a];
            const cb = covered[b];
            const cc = covered[c];
            if (ca !== cb || cb !== cc) {
              // boundary triangle: drop its covered verts
              if (ca) keep[a] = 0;
              if (cb) keep[b] = 0;
              if (cc) keep[c] = 0;
            }
          }
          covered = keep;
        }
      }
      const RES = 512;
      const cnv = document.createElement("canvas");
      cnv.width = RES;
      cnv.height = RES;
      const ctx = cnv.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, RES, RES);
      ctx.fillStyle = "white";
      const uv = body.geometry.attributes.uv;
      let tris = 0;
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t);
        const b = idx.getX(t + 1);
        const c = idx.getX(t + 2);
        if (!(covered[a] && covered[b] && covered[c])) continue;
        tris++;
        ctx.beginPath();
        ctx.moveTo(uv.getX(a) * RES, uv.getY(a) * RES);
        ctx.lineTo(uv.getX(b) * RES, uv.getY(b) * RES);
        ctx.lineTo(uv.getX(c) * RES, uv.getY(c) * RES);
        ctx.closePath();
        ctx.fill();
      }
      return { url: cnv.toDataURL("image/png"), tris, cv, gv };
    }, item.slot);
    if (r.error) {
      console.warn(`  ${item.id}: ${r.error}`);
      continue;
    }
    if (r.tris < 24) continue; // accessories / barely-covering pieces: no mask
    writeFileSync(dest, Buffer.from(r.url.split(",")[1], "base64"));
    written++;
    if (done % 25 === 0) console.log(`  …${done}/${pieces.length} (${written} masks)`);
  } catch (e) {
    console.warn(`  ${item.id}: ${String(e).split("\n")[0].slice(0, 120)}`);
  }
}
await browser.close();
console.log(`done: ${written}/${done} masks written`);
