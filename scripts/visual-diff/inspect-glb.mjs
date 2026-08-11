// throwaway: dump a glb's node hierarchy + world transforms (no deps; reads the JSON chunk).
// usage: node scripts/visual-diff/_inspect-glb.mjs <path-to-glb>
import { readFileSync } from "node:fs";
const f = process.argv[2];
const buf = readFileSync(f);
// glb: 12-byte header, then chunks [u32 len][u32 type][data]. First chunk = JSON.
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
const N = json.nodes ?? [];
const mul = (a, b) => {
  const o = new Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
  return o;
};
const trs = (n) => {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const childParent = new Map();
N.forEach((n, i) => (n.children ?? []).forEach((c) => childParent.set(c, i)));
const worldOf = (i) => {
  let m = trs(N[i]);
  let p = childParent.get(i);
  while (p != null) {
    m = mul(trs(N[p]), m);
    p = childParent.get(p);
  }
  return m;
};
console.log(`== ${f}  (${N.length} nodes) ==`);
N.forEach((n, i) => {
  if (n.mesh == null) return;
  const w = worldOf(i);
  console.log(
    `node[${i}] "${n.name ?? ""}" mesh=${n.mesh}  worldPos=(${w[12].toFixed(3)}, ${w[13].toFixed(3)}, ${w[14].toFixed(3)})  ` +
      `localT=${JSON.stringify(n.translation ?? null)} localR=${JSON.stringify(n.rotation ?? null)} scale=${JSON.stringify(n.scale ?? null)}`,
  );
});
