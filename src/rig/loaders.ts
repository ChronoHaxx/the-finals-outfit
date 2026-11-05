import { LoaderUtils } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { sourceMeshPlugin } from "./SourceMesh";
import { meshBytes } from "../lib/mesh-bytes";

// Factory for the GLTFLoader the rig uses. URLs are passed fully-resolved (via
// modelUrl) so no setPath is needed; GLBs are self-contained (no external bin/textures).
export function createGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  // GLBs are meshopt-compressed (EXT_meshopt_compression) by the convert pipeline for
  // scale; the decoder is tiny and backward-compatible (uncompressed GLBs still load).
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(sourceMeshPlugin);
  // Meshes download through fetchAsset like every other recovered asset (the same retries), and may arrive
  // gzipped (mesh-bytes.ts). Concurrent loads of one URL share the download, as Three's FileLoader did, but
  // each later parse gets its own copy: the parser views vertex data in place, and the rig edits some of it
  // (wrap and fitting deformation).
  const inflight = new Map<string, { bytes: Promise<ArrayBuffer>; users: number }>();
  loader.loadAsync = async (url: string): Promise<GLTF> => {
    const href = new URL(url, window.location.href).href;
    let entry = inflight.get(href);
    if (!entry) {
      const created = { users: 0, bytes: meshBytes(href)
        .finally(() => { if (inflight.get(href) === created) inflight.delete(href); }) };
      inflight.set(href, created);
      entry = created;
    }
    const first = entry.users++ === 0;
    const bytes = await entry.bytes;
    return loader.parseAsync(first ? bytes : bytes.slice(0), LoaderUtils.extractUrlBase(href));
  };
  return loader;
}
