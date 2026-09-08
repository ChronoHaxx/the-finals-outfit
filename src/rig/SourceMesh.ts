import * as THREE from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

// Three's GLTFLoader normalizes WEIGHTS_0 in isolation, even when a mesh also has
// WEIGHTS_1. Save the original accessor before loading meshes and restore it after
// that normalization. Keep this local to our loader; never patch Three globally.
export function sourceMeshPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  const weights = new Map<number, THREE.BufferAttribute>();
  return {
    name: "FINALS_source_skin_weights",
    async beforeRoot() {
      const accessors = new Set<number>();
      for (const mesh of parser.json.meshes ?? []) {
        for (const primitive of mesh.primitives) {
          const a = primitive.attributes;
          if (a.JOINTS_2 !== undefined || a.WEIGHTS_2 !== undefined)
            throw new Error("More than eight skin influences are not supported yet");
          if (a.WEIGHTS_1 !== undefined) {
            if (a.JOINTS_1 === undefined || a.WEIGHTS_0 === undefined)
              throw new Error("Incomplete source skin attributes");
            accessors.add(a.WEIGHTS_0);
          }
        }
      }
      await Promise.all([...accessors].map(async (index) => {
        const source = await parser.getDependency("accessor", index) as THREE.BufferAttribute;
        const copy = new THREE.Float32BufferAttribute(new Float32Array(source.count * 4), 4);
        for (let i = 0; i < source.count; i++)
          copy.setXYZW(i, source.getX(i), source.getY(i), source.getZ(i), source.getW(i));
        weights.set(index, copy);
      }));
    },
    async afterRoot(result) {
      for (const scene of result.scenes) scene.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh || !mesh.geometry.hasAttribute("weights_1")) return;
        const ref = parser.associations.get(mesh) as { meshes?: number; primitives?: number } | undefined;
        if (ref?.meshes === undefined || ref.primitives === undefined)
          throw new Error("Missing source mesh/accessor association");
        const primitive = parser.json.meshes[ref.meshes].primitives[ref.primitives];
        const original = weights.get(primitive.attributes.WEIGHTS_0);
        if (!original) throw new Error("Missing original source skin weights");
        mesh.geometry.setAttribute("skinWeight", original.clone());
        mesh.geometry.setAttribute("skinIndex1", mesh.geometry.getAttribute("joints_1"));
        mesh.geometry.setAttribute("skinWeight1", mesh.geometry.getAttribute("weights_1"));
        enableSourceSkinning(mesh);
      });
    },
  };
}

const patched = new WeakSet<THREE.Material>();
function patchMaterial(material: THREE.Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${cacheKey()}:source-skin8-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    let vertex = shader.vertexShader;
    const replace = (chunk: string, replacement: string) => {
      const marker = `#include <${chunk}>`;
      if (!vertex.includes(marker)) throw new Error(`Missing skinning shader chunk: ${chunk}`);
      vertex = vertex.replace(marker, replacement);
    };
    replace("skinning_pars_vertex", `#include <skinning_pars_vertex>
      #ifdef USE_SKINNING
        attribute vec4 skinIndex1;
        attribute vec4 skinWeight1;
      #endif`);
    replace("skinbase_vertex", `#include <skinbase_vertex>
      #ifdef USE_SKINNING
        mat4 boneMatX1 = getBoneMatrix(skinIndex1.x);
        mat4 boneMatY1 = getBoneMatrix(skinIndex1.y);
        mat4 boneMatZ1 = getBoneMatrix(skinIndex1.z);
        mat4 boneMatW1 = getBoneMatrix(skinIndex1.w);
      #endif`);
    replace("skinning_vertex", THREE.ShaderChunk.skinning_vertex.replace(
      "transformed = ( bindMatrixInverse * skinned ).xyz;", `
        skinned += boneMatX1 * skinVertex * skinWeight1.x;
        skinned += boneMatY1 * skinVertex * skinWeight1.y;
        skinned += boneMatZ1 * skinVertex * skinWeight1.z;
        skinned += boneMatW1 * skinVertex * skinWeight1.w;
        transformed = (bindMatrixInverse * skinned).xyz;`));
    // Depth/distance passes do not always need normals, but when they do their
    // displacement must use the same complete skin transform as the colour pass.
    if (vertex.includes("#include <skinnormal_vertex>")) replace("skinnormal_vertex",
      THREE.ShaderChunk.skinnormal_vertex.replace("skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;", `
        skinMatrix += skinWeight1.x * boneMatX1;
        skinMatrix += skinWeight1.y * boneMatY1;
        skinMatrix += skinWeight1.z * boneMatZ1;
        skinMatrix += skinWeight1.w * boneMatW1;
        skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;`));
    shader.vertexShader = vertex;
  };
  material.needsUpdate = true;
}

// Call again after replacing a mesh's surface material. The patch is idempotent
// per material, and covers visible, shadow, bounding-box and raycast deformation.
export function enableSourceSkinning(mesh: THREE.SkinnedMesh): void {
  if (!mesh.geometry.hasAttribute("skinWeight1")) return;
  (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(patchMaterial);
  mesh.customDepthMaterial ??= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.customDistanceMaterial ??= new THREE.MeshDistanceMaterial();
  patchMaterial(mesh.customDepthMaterial);
  patchMaterial(mesh.customDistanceMaterial);
  mesh.userData.sourceSkinInfluences = 8;
  const base = new THREE.Vector4();
  const sum = new THREE.Vector4();
  const temp = new THREE.Vector4();
  const matrix = new THREE.Matrix4();
  mesh.applyBoneTransform = function <T extends THREE.Vector3 | THREE.Vector4>(this: THREE.SkinnedMesh, index: number, target: T): T {
    const vector4 = target as THREE.Vector4;
    base.set(target.x, target.y, target.z, vector4.isVector4 ? vector4.w : 1).applyMatrix4(this.bindMatrix);
    sum.set(0, 0, 0, 0);
    for (let set = 0; set < 2; set++) {
      const joints = this.geometry.getAttribute(set ? "skinIndex1" : "skinIndex");
      const weights = this.geometry.getAttribute(set ? "skinWeight1" : "skinWeight");
      for (let k = 0; k < 4; k++) {
        const weight = weights.getComponent(index, k);
        if (!weight) continue;
        const bone = joints.getComponent(index, k);
        matrix.multiplyMatrices(this.skeleton.bones[bone].matrixWorld, this.skeleton.boneInverses[bone]);
        sum.addScaledVector(temp.copy(base).applyMatrix4(matrix), weight);
      }
    }
    sum.applyMatrix4(this.bindMatrixInverse);
    target.x = sum.x;
    target.y = sum.y;
    target.z = sum.z;
    if (vector4.isVector4) vector4.w = sum.w;
    return target;
  };
}
