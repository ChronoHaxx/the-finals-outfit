import { fetchAsset } from "./asset-fetch";

// A release may publish a mesh gzip-compressed under its own .glb name. Cloudflare Pages does not compress
// model/gltf-binary, and meshes with fitting morphs are mostly zeros: the fitted body is 19.5 MB as served and
// 2.7 MB gzipped (28 Oct 2026, _docs/perf-2026-10-28). The first two bytes say which form arrived (a GLB starts
// with "glTF", gzip with 1F 8B), and the decompressed bytes are the extraction's own file, byte for byte, so
// local development and older hosts keep serving plain GLBs unchanged.

/** The bytes of a mesh file, decompressed when the host published it gzipped. */
export async function meshBytes(url: string): Promise<ArrayBuffer> {
  return gunzipIfCompressed(await (await fetchAsset(url)).arrayBuffer());
}

export async function gunzipIfCompressed(data: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return data;
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
