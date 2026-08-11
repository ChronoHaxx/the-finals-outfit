// build-body-masks.mjs — generate the body-UV hide mask for the head's overlap zone.
//
// Equipped heads ship their own neck + upper-chest skin shell that duplicates the body's
// geometry (both derive from one master body), so the two surfaces z-fight as camo-like
// patches. Both meshes share vertex POSITIONS in body space, so coverage can be computed
// exactly: a body triangle whose three vertices all coincide (within quantization
// tolerance) with head-mesh vertices is covered, and gets rasterized into a body-UV mask.
// The runtime discards masked body fragments while a head is equipped.
//
//   node scripts/build-body-masks.mjs
//   -> public/models/decals/_shared/bodyhide-face.webp (512², white = hide)
import { resolve } from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = resolve(import.meta.dirname, "..");
const BODY = resolve(ROOT, "public/models/body/SK_Body_M.glb");
const HEAD = resolve(ROOT, "public/models/heads/face-01.glb");
const OUT = resolve(ROOT, "public/models/decals/_shared/bodyhide-face.webp");
const RES = 512;
const TOL = 0.004; // meters — meshopt position quantization wobble

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

function prims(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) out.push(p);
  return out;
}

// spatial hash of the head's skin-shell vertex positions
const headDoc = await io.read(HEAD);
await headDoc.transform(dequantize()); // meshopt stores int16-quantized POSITION/UV
const grid = new Map();
const key = (x, y, z) => `${Math.round(x / TOL)},${Math.round(y / TOL)},${Math.round(z / TOL)}`;
let headVerts = 0;
for (const p of prims(headDoc)) {
  const name = p.getMaterial()?.getName() ?? "";
  if (!/_head$/i.test(name)) continue; // the skin shell only (not eyes/teeth/lashes)
  const pos = p.getAttribute("POSITION").getArray();
  for (let i = 0; i < pos.length; i += 3) {
    grid.set(key(pos[i], pos[i + 1], pos[i + 2]), true);
    headVerts++;
  }
}
console.log(`head skin verts hashed: ${headVerts}`);

// neighborhood lookup (±1 cell) absorbs quantization wobble across the two encodings
function near(x, y, z) {
  const cx = Math.round(x / TOL);
  const cy = Math.round(y / TOL);
  const cz = Math.round(z / TOL);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) if (grid.has(`${cx + dx},${cy + dy},${cz + dz}`)) return true;
  return false;
}

// rasterize covered body triangles into UV space
const mask = new Uint8Array(RES * RES);
function fillTri(uv, a, b, c) {
  const ax = uv[a * 2] * RES;
  const ay = uv[a * 2 + 1] * RES;
  const bx = uv[b * 2] * RES;
  const by = uv[b * 2 + 1] * RES;
  const cx = uv[c * 2] * RES;
  const cy = uv[c * 2 + 1] * RES;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(RES - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(RES - 1, Math.ceil(Math.max(ay, by, cy)));
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-9) return;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den;
      const w1 = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) mask[y * RES + x] = 255;
    }
}

const bodyDoc = await io.read(BODY);
await bodyDoc.transform(dequantize());
let covered = 0;
let total = 0;
for (const p of prims(bodyDoc)) {
  const pos = p.getAttribute("POSITION")?.getArray();
  const uv = p.getAttribute("TEXCOORD_0")?.getArray();
  const idx = p.getIndices()?.getArray();
  if (!pos || !uv || !idx) continue;
  for (let t = 0; t < idx.length; t += 3) {
    total++;
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (
      near(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]) &&
      near(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]) &&
      near(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2])
    ) {
      covered++;
      fillTri(uv, a, b, c);
    }
  }
}
console.log(`body tris covered by head shell: ${covered}/${total}`);
if (!covered) {
  console.error("no coverage found — vertex matching failed; mask NOT written");
  process.exit(1);
}

// dilate 2px so mip/filter bleed can't show a seam line
const dilated = await sharp(Buffer.from(mask), { raw: { width: RES, height: RES, channels: 1 } })
  .blur(1.2)
  .threshold(40)
  .toBuffer();
await sharp(dilated, { raw: { width: RES, height: RES, channels: 1 } })
  .webp({ lossless: true })
  .toFile(OUT);
console.log(`wrote ${OUT}`);
