// Geometry: does this mesh contain renderable triangles at a sane scale?
// Catches the census's `wrong-mesh` and `missing-part` classes at their cheapest —
// a collapsed or empty mesh is detectable without rendering anything.
//
// Bounds come from worldBounds() (world-space, dequantized) — accessor bounds alone are
// ~100x too large for statics, whose wrapper nodes carry the compensating dequant scale.
// Revised per spec.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { worldBounds } from "./bounds.mjs";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// A character cosmetic larger than this is certainly mis-scaled; the tallest body is ~2m.
const MAX_EXTENT_M = 4;

export async function check(absGlbPath) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let tris = 0;
  for (const p of prims) {
    const pos = p.getAttribute("POSITION");
    if (!pos) return { mark: "fail", note: "primitive has no POSITION" };
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
  if (tris < 1) return { mark: "fail", note: "zero triangles" };

  let b;
  try {
    b = await worldBounds(absGlbPath);
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  if (!b) return { mark: "fail", note: "no scene" };
  const extent = Math.max(...b.extent);
  if (!Number.isFinite(extent)) return { mark: "fail", note: "non-finite bounds" };
  if (extent <= 0) return { mark: "fail", note: "degenerate bounds — mesh is collapsed" };
  if (extent > MAX_EXTENT_M) return { mark: "fail", note: `extent ${extent.toFixed(2)}m exceeds ${MAX_EXTENT_M}m` };

  return { mark: "pass", note: `${Math.round(tris)} triangles, extent ${extent.toFixed(2)}m` };
}
