// Read-only census: which morph target names each indexed source mesh carries.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
const [assetsPath, outPath] = process.argv.slice(2);
const base = path.dirname(assetsPath);
const assets = JSON.parse(readFileSync(assetsPath, "utf8"));
function glbJson(file) {
  let buf = readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not glb " + file);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
}
const out = {};
let missing = 0;
for (const [src, e] of Object.entries(assets.meshes)) {
  const file = path.resolve(base, e.url);
  if (!existsSync(file)) { missing++; out[src] = { missing: true, kind: e.kind }; continue; }
  const j = glbJson(file);
  const names = new Set(), defaults = {};
  for (const m of j.meshes ?? []) {
    const tn = m.extras?.targetNames ?? [];
    tn.forEach((n, i) => { names.add(n); if (m.weights?.[i]) defaults[n] = m.weights[i]; });
  }
  out[src] = { kind: e.kind, url: e.url, morphs: [...names].sort(), defaults };
}
import("node:fs").then(fs => fs.writeFileSync(outPath, JSON.stringify(out, null, 1)));
console.log("meshes", Object.keys(out).length, "missing", missing);
