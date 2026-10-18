import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, resolveSourceRigParts, type AssemblyAssets, type SourceDefinition } from "../../src/rig/SourceAssembly";

const MEDIUM = ["Customization.Archetype.Medium"];
const soft = (p = "") => ({ AssetPathName: p, SubPathString: "" });
const MESH = "/Game/Test/SK_Boots.SK_Boots";
const boots = (id: string) => ({ formatVersion: 1, id, source: `Discovery/Test/DA_${id}.uasset`, sourceSha256: "0",
  properties: { VisualParts: [{ SkeletalMesh: soft(MESH), StaticMesh: soft(), Effect: soft(), TagOverrides: [] }] } }) as unknown as SourceDefinition;
const assets = (itemBodyMasks?: AssemblyAssets["itemBodyMasks"]): AssemblyAssets => ({
  formatVersion: 1,
  meshes: { [MESH]: { url: "meshes/boots.glb", kind: "skeletal", bodyMaskUrl: "coverage/boots-a.png", bodyMaskUvTiles: [2, 1],
    slots: [{ slot: "Boots", material: "/Game/Test/MI_Boots" }] } },
  materials: { "/Game/Test/MI_Boots": "materials/boots.json" },
  ...(itemBodyMasks ? { itemBodyMasks } : {}),
});
const parts = (id: string, a: AssemblyAssets) => {
  const def = boots(id);
  return resolveSourceRigParts(resolveSourceOutfit([def], MEDIUM).items[id], a);
};

test("a shared mesh keeps its own mask when no item override exists", () => {
  const [part] = parts("black", assets());
  assert.equal(part.bodyMaskUrl, "coverage/boots-a.png");
  assert.deepEqual(part.bodyMaskUvTiles, [2, 1]);
});

test("an item override replaces the mask for that item only", () => {
  const a = assets({ "Discovery/Test/DA_purple.uasset": { [MESH]: { url: "coverage/boots-b.png", uvTiles: [1, 1] } } });
  const [purple] = parts("purple", a), [black] = parts("black", a);
  assert.equal(purple.bodyMaskUrl, "coverage/boots-b.png");
  assert.deepEqual(purple.bodyMaskUvTiles, [1, 1]);
  assert.equal(purple.url, black.url); // same preserved geometry
  assert.equal(black.bodyMaskUrl, "coverage/boots-a.png");
});
