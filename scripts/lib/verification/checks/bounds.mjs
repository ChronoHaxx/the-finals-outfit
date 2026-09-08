// World-space bounds in metres. dequantize() undoes the int16 accessor encoding;
// getBounds() then applies the node hierarchy, which carries a compensating scale on
// statics (earrings measured at 0.0087-0.0322) but is identity on skinned garments.
// Accessor bounds alone are therefore metres for garments and ~100x too large for statics.
import { NodeIO, getBounds } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { dequantize } from "@gltf-transform/functions";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

export async function worldBounds(absGlbPath) {
  const doc = await io.read(absGlbPath);
  await doc.transform(dequantize());
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return null;
  const b = getBounds(scene);
  const extent = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  const skinned = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
    .some((p) => p.getAttribute("JOINTS_0"));
  return { min: b.min, max: b.max, extent, centreY: (b.min[1] + b.max[1]) / 2, skinned };
}
