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

/** One baked image of a section: the whole UV tile it covers and where a UV lands in it (as in bakeRect). */
export interface UvTileBake { tile: [number, number]; offset: [number, number]; scale: [number, number] }

/**
 * How a section's UV0 layout splits into baked images. Many garments place their islands in different whole UV tiles
 * (the long coat spans u -1.7 to 2.7) and wrap one texture over them. Fitting that whole span into one square left each
 * tile about 460 of 2048 texels across. Instead each tile gets its own image, at one texel per texel of the tile:
 * - A triangle belongs to its UV island (triangles joined through shared vertices), and an island to the tile under
 *   the centre of its bounds. An island that pokes slightly past its tile widens that tile's image to cover it.
 * - `tileOf` gives each triangle's image, in the order of `indices` (3 vertex indices per triangle); it is null when
 *   there is one image, which keeps the single-image bake exactly as bakeRect placed it.
 * - The split is refused, with a note, when one tile's image would also cover another tile's islands (each image is
 *   drawn from the whole section, and the bake clips by position), or when there are more than `maxTiles` tiles.
 * `uvs` holds u, v for each vertex index.
 */
export function uvTiles(indices: ArrayLike<number>, uvs: ArrayLike<number>, maxTiles = 16, epsilon = 1e-4):
  { tiles: UvTileBake[]; tileOf: Uint16Array | null; note?: string } {
  const triangles = Math.floor(indices.length / 3);
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let root = v;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let x = v; x !== root;) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  for (let k = 0; k < triangles * 3; k++) if (!parent.has(indices[k])) parent.set(indices[k], indices[k]);
  for (let t = 0; t < triangles; t++) {
    const a = find(indices[t * 3]);
    for (let c = 1; c < 3; c++) { const b = find(indices[t * 3 + c]); if (b !== a) parent.set(b, a); }
  }
  const islands = new Map<number, { min: [number, number]; max: [number, number] }>();
  const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
  for (const v of parent.keys()) {
    const root = find(v), u = uvs[v * 2], w = uvs[v * 2 + 1];
    const island = islands.get(root) ?? { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    island.min = [Math.min(island.min[0], u), Math.min(island.min[1], w)];
    island.max = [Math.max(island.max[0], u), Math.max(island.max[1], w)];
    islands.set(root, island);
    min[0] = Math.min(min[0], u); min[1] = Math.min(min[1], w); max[0] = Math.max(max[0], u); max[1] = Math.max(max[1], w);
  }
  const single = (note?: string) => {
    const rect = triangles ? bakeRect(min, max, epsilon) : { offset: [0, 0] as [number, number], scale: [1, 1] as [number, number] };
    const tile: [number, number] = triangles ? [Math.floor((min[0] + max[0]) / 2), Math.floor((min[1] + max[1]) / 2)] : [0, 0];
    return { tiles: [{ tile, ...rect }], tileOf: null, ...(note ? { note } : {}) };
  };
  const tileOfIsland = new Map<number, string>(), groups = new Map<string, { tile: [number, number]; min: [number, number]; max: [number, number] }>();
  for (const [root, island] of islands) {
    const tile: [number, number] = [0, 1].map(i => Math.floor((island.min[i] + island.max[i]) / 2)) as [number, number];
    const key = `${tile[0]},${tile[1]}`;
    tileOfIsland.set(root, key);
    const group = groups.get(key) ?? { tile, min: [tile[0], tile[1]], max: [tile[0] + 1, tile[1] + 1] };
    for (const i of [0, 1]) { group.min[i] = Math.min(group.min[i], island.min[i]); group.max[i] = Math.max(group.max[i], island.max[i]); }
    groups.set(key, group);
  }
  if (groups.size <= 1) return single();
  if (groups.size > maxTiles) return single(`${groups.size} UV tiles (more than ${maxTiles}): baked as one image`);
  // Tiles in row order (v, then u), so the first image is the lowest, leftmost tile.
  const ordered = [...groups.entries()].sort(([, a], [, b]) => a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);
  for (const [key, group] of ordered) for (const [root, island] of islands) {
    if (tileOfIsland.get(root) === key) continue;
    const inside = [0, 1].every(i => island.max[i] > group.min[i] + epsilon && island.min[i] < group.max[i] - epsilon);
    if (inside) return single(`UV tile ${key} would also cover another tile's islands: baked as one image`);
  }
  const ordinal = new Map(ordered.map(([key], i) => [key, i]));
  const tileOf = new Uint16Array(triangles);
  for (let t = 0; t < triangles; t++) tileOf[t] = ordinal.get(tileOfIsland.get(find(indices[t * 3]))!)!;
  const tiles = ordered.map(([, group]) => {
    const scale = [0, 1].map(i => 1 / (group.max[i] - group.min[i])) as [number, number];
    return { tile: group.tile, offset: [0, 1].map(i => -group.min[i] * scale[i] || 0) as [number, number], scale };
  });
  return { tiles, tileOf };
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
