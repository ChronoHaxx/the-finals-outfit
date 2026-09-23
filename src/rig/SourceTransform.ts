// Unreal -> preserved-GLB transform arithmetic, shared by the source resolver and the static
// attachment path so one conversion formula serves both. Matrices are 16-element column-major
// arrays in the converted basis (X, Z, Y), metres at 0.01 per authored centimetre. Nothing here
// depends on Three or on any other module: the functions take and return plain arrays and booleans.

export type SourceVector = [number, number, number];
export type SourceQuaternion = [number, number, number, number];
/** 16 elements, column-major, the same layout the preserved rest bones and Three both use. */
export type SourceMatrix = number[];

const ELEMENTS = 16;
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10];
const TRANSLATION = [12, 13, 14];
const AFFINE = [3, 7, 11, 15];

export function isSourceMatrix(value: unknown): value is SourceMatrix {
  return Array.isArray(value) && value.length === ELEMENTS &&
    value.every(v => typeof v === 'number' && Number.isFinite(v));
}

/** An FRotator in degrees as the converted quaternion. Yaw turns about +Z, pitch about -Y and roll
 *  about -X; the components are then reflected through the same X/Z/Y mapping as the preserved
 *  GLBs. This is the expression, and the normalization, the static attachment path has always used. */
export function sourceRotationQuaternion(rotation: SourceVector): SourceQuaternion {
  const [pitch, yaw, roll] = rotation.map(v => v * Math.PI / 360);
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const x = cr * sp * sy - sr * cp * cy, y = -cr * sp * cy - sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy, w = cr * cp * cy + sr * sp * sy;
  const [qx, qy, qz, qw]: SourceQuaternion = [-x, -z, -y, w];
  const length = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  if (length === 0) return [0, 0, 0, 1];
  const inverse = 1 / length;
  return [qx * inverse, qy * inverse, qz * inverse, qw * inverse];
}

/** Translation, rotation and a possibly nonuniform scale as one matrix, in the order FTransform
 *  applies them: scale, then rotation, then translation. Inputs are already in converted axes. */
export function composeSourceMatrix(translation: SourceVector, quaternion: SourceQuaternion,
  scale: SourceVector): SourceMatrix {
  const [x, y, z, w] = quaternion;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = scale;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

/** One authored local transform — a VisualPart's or an attachment's — in the converted basis:
 *  centimetres become metres and the authored (X, Y, Z) axes become (X, Z, Y). */
export function sourceLocalMatrix(position: SourceVector, rotation: SourceVector,
  scale: SourceVector): SourceMatrix {
  const [px, py, pz] = position, [sx, sy, sz] = scale;
  return composeSourceMatrix([px * .01, pz * .01, py * .01], sourceRotationQuaternion(rotation), [sx, sz, sy]);
}

/** a * b, accumulated in the same order as the matrix library the preserved rests were measured
 *  with, so a product computed here and one computed there agree element for element. */
export function multiplySourceMatrices(a: SourceMatrix, b: SourceMatrix): SourceMatrix {
  const out = new Array<number>(ELEMENTS);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** How far one matrix is from the identity, split by what the numbers mean: the linear basis and
 *  the affine row are unitless, the translation is in metres. Together these cover all 16 elements. */
export interface SourceIdentityDeviation { linear: number; translation: number; affine: number }

export function sourceIdentityDeviation(matrix: SourceMatrix): SourceIdentityDeviation {
  const off = (i: number) => Math.abs(matrix[i] - (i % 5 === 0 ? 1 : 0));
  return {
    linear: Math.max(...LINEAR.map(off)),
    translation: Math.max(...TRANSLATION.map(off)),
    affine: Math.max(...AFFINE.map(off)),
  };
}

/** A finite affine rigid rest: no perspective row, orthonormal basis, determinant +1. `tolerance`
 *  is unitless and only absorbs the float32 roundoff an imported rest carries — singular, scaled,
 *  reflected, sheared and projective matrices all fall outside it. */
export function isRigidSourceRest(matrix: unknown, tolerance: number): matrix is SourceMatrix {
  if (!isSourceMatrix(matrix) || !(tolerance >= 0)) return false;
  const affine = Math.max(...AFFINE.map(i => Math.abs(matrix[i] - (i === 15 ? 1 : 0))));
  const basis = [0, 1, 2].map(c => [matrix[c * 4], matrix[c * 4 + 1], matrix[c * 4 + 2]]);
  const dot = (i: number, j: number) =>
    basis[i][0] * basis[j][0] + basis[i][1] * basis[j][1] + basis[i][2] * basis[j][2];
  const orthonormality = Math.max(...[0, 1, 2].flatMap(i =>
    [0, 1, 2].map(j => Math.abs(dot(i, j) - (i === j ? 1 : 0)))));
  const [x, y, z] = basis;
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1]) +
    x[1] * (y[2] * z[0] - y[0] * z[2]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  return affine <= tolerance && orthonormality <= tolerance && Math.abs(determinant - 1) <= tolerance;
}
