import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Factory for the GLTFLoader the rig uses. URLs are passed fully-resolved (via
// modelUrl) so no setPath is needed; GLBs are self-contained (no external bin/textures).
export function createGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  // GLBs are meshopt-compressed (EXT_meshopt_compression) by the convert pipeline for
  // scale; the decoder is tiny and backward-compatible (uncompressed GLBs still load).
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
