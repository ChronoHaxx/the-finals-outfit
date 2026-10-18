// Pure image helpers for the UV-space export bake (src/rig/OutfitExport.ts).

/** Linear [0, 1] to the sRGB transfer curve, as glTF expects for base colour and emissive images. */
export function linearToSrgb(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v <= 0.0031308 ? 12.92 * v : v >= 1 ? 1 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * Where a section's UV0 range lands in the baked square. Inside the unit square the bake is 1:1. A range outside
 * it (tiled or offset islands) is fitted to the square, and the exported texture repeats/offsets it back, so
 * uv * scale + offset = baked position (three's Texture.repeat/offset, written as KHR_texture_transform).
 */
export function bakeRect(min: [number, number], max: [number, number], epsilon = 1e-4) {
  if (min[0] >= -epsilon && min[1] >= -epsilon && max[0] <= 1 + epsilon && max[1] <= 1 + epsilon)
    return { offset: [0, 0] as [number, number], scale: [1, 1] as [number, number] };
  const scale = [0, 1].map(i => 1 / Math.max(max[i] - min[i], epsilon)) as [number, number];
  return { offset: [-min[0] * scale[0], -min[1] * scale[1]] as [number, number], scale };
}

/**
 * Seam padding. Each pass fills every uncovered texel that touches a covered one with the average of its covered
 * 8-neighbours, so bilinear filtering and mip levels at UV island edges read surface colour instead of the clear
 * colour. Only the growing ring is visited, so the cost follows the filled area, not the image size.
 * `channels` are RGBA-packed (length width * height * 4) and share one mask; `covered` is updated in place.
 */
export function dilate(channels: Float32Array[], covered: Uint8Array, width: number, height: number, passes: number): number {
  const count = width * height;
  if (covered.length !== count || channels.some(c => c.length !== count * 4)) throw new Error("Bake image size mismatch");
  const visit = (i: number, fn: (j: number) => void) => {
    const x = i % width, y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx || dy) && xx >= 0 && xx < width) fn(yy * width + xx);
      }
    }
  };
  const queued = new Uint8Array(count);
  let ring: number[] = [];
  for (let i = 0; i < count; i++) {
    if (covered[i]) continue;
    let edge = false;
    visit(i, j => { if (covered[j]) edge = true; });
    if (edge) { ring.push(i); queued[i] = 1; }
  }
  const components = channels.length * 4, sums = new Float64Array(components);
  let filled = 0;
  for (let pass = 0; pass < passes && ring.length; pass++) {
    // Average from the previous pass only, then commit, so the fill is isotropic.
    const values = new Float32Array(ring.length * components);
    ring.forEach((i, k) => {
      sums.fill(0);
      let n = 0;
      visit(i, j => {
        if (!covered[j]) return;
        n++;
        channels.forEach((c, ci) => { for (let q = 0; q < 4; q++) sums[ci * 4 + q] += c[j * 4 + q]; });
      });
      for (let q = 0; q < components; q++) values[k * components + q] = sums[q] / n;
    });
    ring.forEach((i, k) => {
      channels.forEach((c, ci) => { for (let q = 0; q < 4; q++) c[i * 4 + q] = values[k * components + ci * 4 + q]; });
      covered[i] = 1;
    });
    filled += ring.length;
    const next: number[] = [];
    for (const i of ring) visit(i, j => { if (!covered[j] && !queued[j]) { queued[j] = 1; next.push(j); } });
    ring = next;
  }
  return filled;
}
