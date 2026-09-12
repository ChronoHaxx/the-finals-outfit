import * as THREE from 'three';
import type { SourceRigPart } from './SourceAssembly';

type SourceAttachmentTransform = NonNullable<SourceRigPart['attachment']>;

/** The socket rest the attachment hangs from, with the diagonal the socket itself carries.
 *  A body bone contributes a rigid rest and no scale; a head-component or optional-mesh socket
 *  contributes its own authored rest, which may reflect one axis. */
export interface SourceSocketRest { rest: number[]; restScale: [number, number, number] }

export function bodySocketRest(attachment: SourceAttachmentTransform): SourceSocketRest {
  if (!attachment.sourceRestMatrix) throw new Error('Source attachment has no body socket rest');
  return { rest: attachment.sourceRestMatrix, restScale: [1, 1, 1] };
}

function sourceAttachmentLocal(attachment: SourceAttachmentTransform, unitScale = false): THREE.Matrix4 {
  // FRotator uses yaw about +Z, pitch about -Y and roll about -X. Convert
  // the rotation through the same X/Z/Y reflection as the preserved GLBs.
  const [pitch, yaw, roll] = attachment.rotation.map(v => v * Math.PI / 360);
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const x = cr * sp * sy - sr * cp * cy, y = -cr * sp * cy - sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy, w = cr * cp * cy + sr * sp * sy;
  const [px, py, pz] = attachment.position, [sx, syScale, sz] = attachment.scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(px, pz, py).multiplyScalar(.01),
    new THREE.Quaternion(-x, -z, -y, w).normalize(), unitScale ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(sx, sz, syScale));
}

export function sourceAttachmentRest(attachment: SourceAttachmentTransform,
  socket: SourceSocketRest = bodySocketRest(attachment)): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(socket.rest).multiply(sourceAttachmentLocal(attachment));
}

/** Split the full authored rest into a frame and a diagonal baked into the vertices.
 *  Signed unit socket scales remain orthogonal through local rotation. General socket scales
 *  can introduce shear; attachSourceStatic rejects any resulting non-rigid frame. */
export function sourceAttachmentFrame(attachment: SourceAttachmentTransform,
  socket: SourceSocketRest = bodySocketRest(attachment)): { frame: THREE.Matrix4; scale: THREE.Vector3 } {
  const [sx, sy, sz] = attachment.scale, [mx, my, mz] = socket.restScale;
  const scale = new THREE.Vector3(sx * mx, sz * my, sy * mz);
  const rest = sourceAttachmentRest(attachment, socket);
  return { frame: rest.clone().multiply(new THREE.Matrix4().makeScale(1 / scale.x, 1 / scale.y, 1 / scale.z)), scale };
}

// A reflected socket scale reverses the triangle order and the bitangent sign. Bake both into the
// private copy so the object's own transform stays rigid and three.js keeps culling front faces.
function reverseWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex();
  if (!index || index.count % 3) throw new Error('A mirrored source attachment requires indexed triangles');
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
  const tangent = geometry.getAttribute('tangent');
  if (tangent) {
    if (tangent.itemSize !== 4) throw new Error('A mirrored source attachment requires a signed tangent');
    for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i));
    tangent.needsUpdate = true;
  }
}

export function attachSourceStatic(original: THREE.Mesh, attachment: SourceAttachmentTransform,
  bone: THREE.Bone, driverRestInverse: THREE.Matrix4,
  socket: SourceSocketRest = bodySocketRest(attachment)): THREE.SkinnedMesh {
  original.updateWorldMatrix(true, false);
  if ((original as THREE.SkinnedMesh).isSkinnedMesh || original.children.length ||
      original.matrixWorld.elements.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6))
    throw new Error('Source static attachment requires an unchanged source mesh node');
  const rest = sourceAttachmentRest(attachment, socket), { frame, scale } = sourceAttachmentFrame(attachment, socket);
  const scaling = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
  // The socket frame must be a rotation and a translation, and every authored part scale positive,
  // so frame * scale is exactly the invertible source rest. Only a source socket may reflect an
  // axis; sheared, stretched, singular and nonfinite transforms stay unsupported.
  const basis = new THREE.Matrix3().setFromMatrix4(frame);
  const orthonormality = basis.clone().transpose().multiply(basis).elements
    .map((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)));
  if (![...rest.elements, ...frame.elements].every(Number.isFinite) ||
      !attachment.scale.every(v => Number.isFinite(v) && v > 0) ||
      !socket.restScale.every(v => Number.isFinite(v) && v !== 0) ||
      ![scale.x, scale.y, scale.z].every(v => Number.isFinite(v) && v !== 0) ||
      Math.abs(frame.determinant() - 1) > 1e-4 || Math.max(...orthonormality) > 1e-4 ||
      [3, 7, 11, 15].some(i => Math.abs(frame.elements[i] - (i === 15 ? 1 : 0)) > 1e-6) ||
      frame.clone().multiply(scaling).elements.some((v, i) => Math.abs(v - rest.elements[i]) > 1e-6))
    throw new Error('Invalid source attachment frame');
  if (original.geometry.hasAttribute('skinIndex') || original.geometry.hasAttribute('skinWeight'))
    throw new Error('Source static mesh unexpectedly contains skin weights');
  const unit = scale.x === 1 && scale.y === 1 && scale.z === 1;
  const mirrored = scale.x * scale.y * scale.z < 0;
  // A scaled part applies its scale once, to a private copy of its vertices (sections share
  // attributes): positions scale, normals take the inverse transpose and tangents the scale, both
  // renormalized. The bind stays rigid, so shading remains exact through any later bone motion.
  const geometry = unit ? original.geometry : original.geometry.clone().applyMatrix4(scaling);
  if (mirrored) reverseWinding(geometry);
  const count = geometry.getAttribute('position').count;
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, original.material);
  mesh.name = original.name;
  mesh.userData = { ...original.userData, sourceStaticAttachment: attachment.socket, sourceAttachmentRest: rest.toArray(),
    ...(unit ? {} : { sourceAttachmentScale: scale.toArray() }),
    ...(attachment.frame ? { sourceAttachmentComponent: [attachment.frame.kind, bone.name] } : {}) };
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(frame);
  // The rigid influence transfers head motion from the preview's reoriented
  // driver. Authored positions, tangents, colours and the UE local transform are
  // retained. This is one rigid influence, not a reconstructed skinning claim.
  mesh.bind(new THREE.Skeleton([bone], [driverRestInverse.clone()]), frame);
  original.parent!.add(mesh);
  original.removeFromParent();
  return mesh;
}
