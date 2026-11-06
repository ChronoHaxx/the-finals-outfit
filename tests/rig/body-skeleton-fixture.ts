import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// The base body's skeleton, rebuilt from the GLB's JSON and binary chunks only (node TRS, skin joints, inverse bind
// matrices): no textures or mesh data, so it loads in node. Path: BODY_GLB, else the repo's public/models copy. The
// shipped GLB is meshopt-compressed (EXT_meshopt_compression): the matrices are decoded with three's own decoder.
export const BODY_GLB = process.env.BODY_GLB ?? "public/models/body/SK_Body_M.glb";
export const hasBody = () => existsSync(BODY_GLB);

export async function loadBodySkeleton(path = BODY_GLB) {
  await MeshoptDecoder.ready;
  const glb = readFileSync(path);
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;
  const nodes: THREE.Object3D[] = gltf.nodes.map((n: { name?: string; translation?: number[]; rotation?: number[]; scale?: number[] }, i: number) => {
    const isJoint = gltf.skins[0].joints.includes(i);
    const o = isJoint ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? `node${i}`;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  gltf.nodes.forEach((n: { children?: number[] }, i: number) => (n.children ?? []).forEach(c => nodes[i].add(nodes[c])));
  const root = new THREE.Group();
  for (const i of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[i]);
  const skin = gltf.skins[0];
  const accessor = gltf.accessors[skin.inverseBindMatrices], view = gltf.bufferViews[accessor.bufferView];
  const meshopt = view.extensions?.EXT_meshopt_compression;
  let bytes: Uint8Array;
  if (meshopt) {
    // The compressed copy lives in buffer 0 (the GLB's BIN chunk); buffer 1 is a size-only fallback.
    const source = new Uint8Array(glb.buffer, glb.byteOffset + binStart + meshopt.byteOffset, meshopt.byteLength);
    bytes = new Uint8Array(meshopt.count * meshopt.byteStride);
    MeshoptDecoder.decodeGltfBuffer(bytes, meshopt.count, meshopt.byteStride, source, meshopt.mode, meshopt.filter ?? "NONE");
  } else {
    bytes = new Uint8Array(glb.buffer, glb.byteOffset + binStart + (view.byteOffset ?? 0), view.byteLength);
  }
  const start = accessor.byteOffset ?? 0;
  const floats = new Float32Array(bytes.slice(start, start + accessor.count * 64).buffer);
  const bones = skin.joints.map((j: number) => nodes[j] as THREE.Bone);
  const inverses = bones.map((_: THREE.Bone, i: number) => new THREE.Matrix4().fromArray(floats, i * 16));
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.skeleton = new THREE.Skeleton(bones, inverses);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const bone = (name: string) => {
    const found = bones.find((b: THREE.Bone) => b.name === name);
    if (!found) throw new Error(`no bone ${name}`);
    return found as THREE.Bone;
  };
  return { root, bones: bones as THREE.Bone[], bone };
}
