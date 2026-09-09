// Stage partial head/body skin support separately from complete clothing assemblies.
// Unrecovered eye/mouth slots retain explicitly matched legacy preview materials.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveSourceOutfit } from "../../src/rig/SourceAssembly.ts";

const [definitionsPath, assetsPath, boundsFolder, sourceFolder, output, ...ids] = process.argv.slice(2);
if (!ids.length) throw new Error("Usage: node --import tsx build-skin-pairs.mjs <customization.json> <assets.json> <bounds-export> <mesh-source-export> <output.json> <item-id>...");
const read = path => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const definitions = read(definitionsPath), assets = read(assetsPath);
const sourceRecords = new Map(read(`${sourceFolder}/assets.json`).filter(r => r.path).map(r => [r.path, r]));
const bounds = new Map();
for (const record of read(`${boundsFolder}/assets.json`)) {
  const source = sourceRecords.get(record.path);
  if (!source) continue;
  assert.equal(record.sha256, source.sha256, `Bounds and mesh belong to different source packages: ${record.path}`);
  const mesh = read(`${boundsFolder}/${record.propertiesFile}`).find(r => r.type === "SkeletalMesh");
  if (mesh?.importedBounds) bounds.set(record.path, mesh.importedBounds);
}
const catalog = new Map(read("src/data/items.json").map(i => [i.id, i]));
const items = {};
for (const id of ids) {
  const record = definitions.definitions[definitions.catalog[id]];
  assert.ok(record, `Missing source definition: ${id}`);
  const item = resolveSourceOutfit([{ ...record, id }], ["Customization.Archetype.Medium"]).items[id];
  assert.equal(item.parts.length, 2);
  const head = item.parts.find(p => p.definition.bIsHeadMesh);
  const body = item.parts.find(p => !p.definition.bIsHeadMesh);
  assert.ok(head && body);
  const legacyPath = `public/${catalog.get(id).model.gltfPath}`;
  const binary = readFileSync(legacyPath);
  const gltf = JSON.parse(binary.subarray(20, 20+binary.readUInt32LE(12)).toString());
  const legacyNames = new Set(gltf.materials.map(m => m.name));
  const part = (p, isHead) => {
    const mesh = assets.meshes[p.skeletalMesh];
    assert.ok(mesh);
    const packagePath = "Discovery/Content/" + p.skeletalMesh.slice(6).split(".")[0] + ".uasset";
    const origin = bounds.get(packagePath)?.Origin;
    assert.ok(origin, `Missing independently matched source bounds: ${packagePath}`);
    const materials = Object.fromEntries(mesh.slots.map(slot => {
      const source = p.materials[slot.slot] ?? slot.material;
      const url = assets.materials[source];
      const legacyName = slot.material.split(".").at(-1);
      if (isHead) assert.ok(legacyNames.has(legacyName), `No exact legacy slot match: ${legacyName}`);
      else assert.ok(url, `Missing recovered body material: ${source}`);
      if (!url) assert.equal(source, slot.material, "Unrecovered material override cannot borrow the mesh default");
      return [slot.slot, { source, defaultSource: slot.material, ...(url ? { url } : {}), ...(isHead ? { legacyName } : {}) }];
    }));
    return { sourceIndex: p.sourceIndex, sourceMesh: p.skeletalMesh, url: mesh.url,
      boundsOrigin: [origin.X, origin.Y, origin.Z], materials };
  };
  const pair = { source: record.source, sourceSha256: record.sourceSha256, head: part(head, true), body: part(body, false) };
  assert.ok(Object.values(pair.head.materials).some(m => m.url), "No recovered head surfaces");
  assert.equal(Object.keys(pair.body.materials).length, 1);
  items[id] = pair;
}
writeFileSync(output, JSON.stringify({ formatVersion: 1,
  scope: "Partial head/body adapter; recovered eye/mouth materials and raw lash coverage use preview lighting and alpha hashing. Translucent eye layers, native neck coverage and scattering remain pending. Imported mesh bounds; animated engine bounds not recovered.",
  items }, null, 2)+"\n");
console.log(`Staged ${Object.keys(items).length} partial head/body skin pair(s).`);
