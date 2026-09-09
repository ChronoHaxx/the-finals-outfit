import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ASPECTS, aspectKey, inputHash } from "../../scripts/lib/verification/inputs.mjs";

const shirtRed = {
  id: "shirt-red",
  model: { gltfPath: "models/cosmetics/shirt.glb", material: { bakedSet: { albedo: "a-red.webp", normal: "n.webp", orm: "o-red.webp" } } },
  slot: "upperBody",
};
const shirtBlue = {
  id: "shirt-blue",
  model: { gltfPath: "models/cosmetics/shirt.glb", material: { bakedSet: { albedo: "a-blue.webp", normal: "n.webp", orm: "o-blue.webp" } } },
  slot: "upperBody",
};

test("the five machine aspects are declared", () => {
  assert.deepEqual([...ASPECTS], ["transform", "geometry", "uv", "bindings", "bodyCulling"]);
});

test("mesh-scoped aspects share a key across colourways", () => {
  for (const aspect of ["geometry", "uv", "bodyCulling"]) {
    const a = aspectKey(shirtRed, aspect);
    const b = aspectKey(shirtBlue, aspect);
    assert.equal(a.scope, "mesh");
    assert.equal(a.key, b.key, `${aspect} must dedupe across skins`);
  }
});

test("skin-scoped aspects do not share a key", () => {
  const a = aspectKey(shirtRed, "bindings");
  const b = aspectKey(shirtBlue, "bindings");
  assert.equal(a.scope, "skin");
  assert.notEqual(a.key, b.key);
});

test("transform is mesh-scoped but slot-sensitive", () => {
  const a = aspectKey(shirtRed, "transform");
  const b = aspectKey({ ...shirtRed, slot: "earrings" }, "transform");
  assert.equal(a.scope, "mesh");
  assert.notEqual(a.key, b.key);
});

test("transform inputs include the rig — a rig edit expires transform marks", async () => {
  const root = mkdtempSync(join(tmpdir(), "vrig-"));
  const rig = join(root, "src", "rig", "CharacterRig.ts");
  mkdirSync(dirname(rig), { recursive: true });
  writeFileSync(rig, "export const A = 1;");
  const item = { id: "x", slot: "earrings", model: { gltfPath: "models/cosmetics/x.glb" } };
  const before = await inputHash(item, "transform", root);
  writeFileSync(rig, "export const A = 2;");
  assert.notEqual(await inputHash(item, "transform", root), before);
});

test("bodyCulling keys are slot-sensitive — one mesh across two slots is two verdicts", () => {
  const a = aspectKey({ ...shirtRed, slot: "upperBody" }, "bodyCulling");
  const b = aspectKey({ ...shirtRed, slot: "wrist" }, "bodyCulling");
  assert.equal(a.scope, "mesh");
  assert.notEqual(a.key, b.key);
});
