import * as THREE from "three";

export interface SourceBoneAttachment {
  parent: THREE.Bone;
  root: THREE.Bone;
}

// Stage garment-only bone branches without mutating the active body. Their
// authored rest transforms remain intact, with the attachment adjusted for the
// legacy driver's different bone axes. Dynamics are not evaluated here.
export function rebindSourceSkeleton(
  source: THREE.Skeleton,
  driver: ReadonlyMap<string, THREE.Bone>,
  driverRestInverses: ReadonlyMap<string, THREE.Matrix4>,
): { skeleton: THREE.Skeleton; attachments: SourceBoneAttachment[] } {
  const indices = new Map(source.bones.map((bone, index) => [bone, index]));
  const resolved = new Map<THREE.Bone, { bone: THREE.Bone; inverse: THREE.Matrix4; owned: boolean }>();
  const visiting = new Set<THREE.Bone>();
  const attachments: SourceBoneAttachment[] = [];
  const resolve = (bone: THREE.Bone): { bone: THREE.Bone; inverse: THREE.Matrix4; owned: boolean } => {
    const previous = resolved.get(bone);
    if (previous) return previous;
    const target = driver.get(bone.name);
    if (target) {
      const inverse = driverRestInverses.get(bone.name);
      if (!inverse) throw new Error(`Missing source driver bind: ${bone.name}`);
      const result = { bone: target, inverse: inverse.clone(), owned: false };
      resolved.set(bone, result);
      return result;
    }
    const parent = bone.parent as THREE.Bone | null;
    if (!parent?.isBone || !indices.has(parent) || visiting.has(bone))
      throw new Error(`Source bone has no supported body ancestor: ${bone.name}`);
    visiting.add(bone);
    const anchor = resolve(parent);
    visiting.delete(bone);
    const inverse = source.boneInverses[indices.get(bone)!].clone();
    const extension = bone.clone(false);
    extension.matrix.multiplyMatrices(anchor.inverse, inverse.clone().invert());
    extension.matrix.decompose(extension.position, extension.quaternion, extension.scale);
    extension.userData.sourceBoneExtension = true;
    const result = { bone: extension, inverse, owned: true };
    resolved.set(bone, result);
    if (anchor.owned) anchor.bone.add(extension);
    else attachments.push({ parent: anchor.bone, root: extension });
    return result;
  };
  const entries = source.bones.map(resolve);
  return { skeleton: new THREE.Skeleton(entries.map(e => e.bone), entries.map(e => e.inverse)), attachments };
}
