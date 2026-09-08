import * as THREE from 'three';
import type { SourceRigPart } from './SourceAssembly';

export function sourceAttachmentRest(attachment: NonNullable<SourceRigPart['attachment']>): THREE.Matrix4 {
  // FRotator uses yaw about +Z, pitch about -Y and roll about -X. Convert
  // the rotation through the same X/Z/Y reflection as the preserved GLBs.
  const [pitch, yaw, roll] = attachment.rotation.map(v => v * Math.PI / 360);
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const x = cr * sp * sy - sr * cp * cy, y = -cr * sp * cy - sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy, w = cr * cp * cy + sr * sp * sy;
  const [px, py, pz] = attachment.position, [sx, syScale, sz] = attachment.scale;
  const local = new THREE.Matrix4().compose(new THREE.Vector3(px, pz, py).multiplyScalar(.01),
    new THREE.Quaternion(-x, -z, -y, w).normalize(), new THREE.Vector3(sx, sz, syScale));
  return new THREE.Matrix4().fromArray(attachment.sourceRestMatrix).multiply(local);
}

export function attachSourceStatic(original: THREE.Mesh, attachment: NonNullable<SourceRigPart['attachment']>,
  bone: THREE.Bone, driverRestInverse: THREE.Matrix4): THREE.SkinnedMesh {
  original.updateWorldMatrix(true, false);
  if ((original as THREE.SkinnedMesh).isSkinnedMesh || original.children.length ||
      original.matrixWorld.elements.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6))
    throw new Error('Source static attachment requires an unchanged source mesh node');
  const rest = sourceAttachmentRest(attachment);
  if (!rest.elements.every(Number.isFinite) || Math.abs(rest.determinant() - 1) > 1e-4)
    throw new Error('Invalid source attachment frame');
  const geometry = original.geometry, count = geometry.getAttribute('position').count;
  if (geometry.hasAttribute('skinIndex') || geometry.hasAttribute('skinWeight'))
    throw new Error('Source static mesh unexpectedly contains skin weights');
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, original.material);
  mesh.name = original.name;
  mesh.userData = { ...original.userData, sourceStaticAttachment: attachment.socket, sourceAttachmentRest: rest.toArray() };
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(rest);
  // The rigid influence transfers head motion from the preview's reoriented
  // driver. Authored positions, tangents, colours and the UE local transform are
  // retained. This is one rigid influence, not a reconstructed skinning claim.
  mesh.bind(new THREE.Skeleton([bone], [driverRestInverse.clone()]), rest);
  original.parent!.add(mesh);
  original.removeFromParent();
  return mesh;
}
