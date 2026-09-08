// UV: is there a usable TEXCOORD_0, and is it in a sane range?
// Wildly out-of-range UVs are the signature behind the census's `artifact` class —
// smeared vertical stripes are what a mis-mapped texture looks like on a garment.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { dequantize } from "@gltf-transform/functions";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// Tiling is legitimate, so do not demand 0..1 — but a garment atlas never needs ±16.
const UV_LIMIT = 16;

export async function check(absGlbPath) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
    // Some meshes ship int16-quantized TEXCOORD_0 (567/847); getMin/getMax would then
    // return raw integers. Dequantize first — same as build-body-masks.mjs. (User-approved
    // deviation from the plan.)
    await doc.transform(dequantize());
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let checked = 0;
  for (const p of prims) {
    const uv = p.getAttribute("TEXCOORD_0");
    if (!uv) return { mark: "fail", note: "primitive has no TEXCOORD_0" };
    const min = uv.getMin([]);
    const max = uv.getMax([]);
    for (let i = 0; i < 2; i++) {
      if (!Number.isFinite(min[i]) || !Number.isFinite(max[i])) {
        return { mark: "fail", note: "non-finite UV bounds" };
      }
      if (min[i] < -UV_LIMIT || max[i] > UV_LIMIT) {
        return { mark: "fail", note: `UV out of range: ${min[i].toFixed(1)}..${max[i].toFixed(1)}` };
      }
    }
    checked++;
  }
  return { mark: "pass", note: `${checked} primitives with TEXCOORD_0` };
}
