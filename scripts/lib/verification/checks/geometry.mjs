// Geometry: does this mesh contain renderable triangles at a sane scale?
// Catches the census's `wrong-mesh` and `missing-part` classes at their cheapest —
// a collapsed or empty mesh is detectable without rendering anything.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { dequantize } from "@gltf-transform/functions";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// A character cosmetic larger than this is certainly mis-scaled; the tallest body is ~2m.
const MAX_EXTENT_M = 4;

export async function check(absGlbPath) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
    // Meshopt stores POSITION as int16-quantized data in this pipeline, so getMin/getMax
    // return raw integers (±32767) instead of metres. Dequantize first — same as
    // build-body-masks.mjs. (User-approved deviation from the plan.)
    await doc.transform(dequantize());
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let tris = 0;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const pos = p.getAttribute("POSITION");
    if (!pos) return { mark: "fail", note: "primitive has no POSITION" };
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    const min = pos.getMin([]);
    const max = pos.getMax([]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min[i]);
      hi[i] = Math.max(hi[i], max[i]);
    }
  }
  if (tris < 1) return { mark: "fail", note: "zero triangles" };

  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!Number.isFinite(extent)) return { mark: "fail", note: "non-finite bounds" };
  if (extent <= 0) return { mark: "fail", note: "degenerate bounds — mesh is collapsed" };
  if (extent > MAX_EXTENT_M) return { mark: "fail", note: `extent ${extent.toFixed(2)}m exceeds ${MAX_EXTENT_M}m` };

  return { mark: "pass", note: `${Math.round(tris)} triangles, extent ${extent.toFixed(2)}m` };
}
