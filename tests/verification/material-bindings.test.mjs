import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { check } from "../../scripts/lib/verification/checks/bindings.mjs";
import { aspectKey, inputHash } from "../../scripts/lib/verification/inputs.mjs";
import { collectAssetRefs } from "../../scripts/lib/asset-refs.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "material-slots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "public", "models");
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}
const helmet = () => ({
  id: "helmet-orange", model: { gltfPath: "models/helmet.glb",
    material: { bakedSet: { albedo: "models/obsolete.webp", normal: "models/obsolete.webp", orm: "models/obsolete.webp" } },
    materialBindings: {
      Shell: { family: "layered", doubleSided: false, bakedSet: { albedo: "models/shell.png", normal: "models/shell.png", orm: "models/shell.png" } },
      Visor: { family: "led", doubleSided: false, ledScreen: { animation: "models/animation.png", colorRamp: "models/ramp.png" } },
    },
  },
});

test("a missing secondary material map fails even when the shell maps exist", async (t) => {
  const { root, dir } = fixture(t);
  await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } }).png().toFile(join(dir, "shell.png"));
  const result = await check(helmet(), root);
  assert.equal(result.mark, "fail");
  assert.match(result.note, /animation.png/);
  assert.doesNotMatch(result.note, /obsolete/);
});

test("all secondary material images must decode, and nested maps are staged", async (t) => {
  const { root, dir } = fixture(t);
  for (const name of ["shell", "animation"]) {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } }).png().toFile(join(dir, `${name}.png`));
  }
  writeFileSync(join(dir, "ramp.png"), "not an image");
  const item = helmet();
  const result = await check(item, root);
  assert.equal(result.mark, "fail");
  assert.match(result.note, /unreadable: models\/ramp.png/);
  const paths = collectAssetRefs([item]);
  assert.ok(paths.has("models/animation.png"));
  assert.ok(paths.has("models/ramp.png"));
});

test("skins sharing a shell keep separate secondary-material verdicts", () => {
  const a = helmet();
  const b = helmet();
  b.id = "helmet-blue";
  assert.notEqual(aspectKey(a, "bindings").key, aspectKey(b, "bindings").key);
});

test("secondary bytes, slot names, and source-sidedness each expire a verdict", async (t) => {
  const { root, dir } = fixture(t);
  const item = helmet();
  const original = await inputHash(item, "bindings", root);
  writeFileSync(join(dir, "animation.png"), "new content");
  const changedImage = await inputHash(item, "bindings", root);
  assert.notEqual(changedImage, original);
  item.model.materialBindings.Visor.doubleSided = true;
  const changedSide = await inputHash(item, "bindings", root);
  assert.notEqual(changedSide, changedImage);
  item.model.materialBindings.OtherSlot = item.model.materialBindings.Visor;
  delete item.model.materialBindings.Visor;
  assert.notEqual(await inputHash(item, "bindings", root), changedSide);
});

test("a renamed or omitted GLB material cannot pass on another slot's valid maps", async (t) => {
  const { root, dir } = fixture(t);
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, materials: [{ name: "Shell" }, { name: "Visor" }],
    meshes: [{ primitives: [{ material: 0 }, { material: 1 }] }] }));
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.write("JSON", 16);
  writeFileSync(join(dir, "helmet.glb"), Buffer.concat([header, json]));
  const item = { id: "helmet", model: { gltfPath: "models/helmet.glb", materialBindings: {
    Shell: { family: "unknown", doubleSided: false },
  } } };
  assert.match((await check(item, root)).note, /unbound \[Visor\]/);
  item.model.materialBindings.Visor = { family: "unknown", doubleSided: false };
  assert.equal((await check(item, root)).mark, "na");
  const before = await inputHash(item, "bindings", root);
  const changed = Buffer.concat([header, Buffer.from(json.toString().replace("Visor", "Other"))]);
  writeFileSync(join(dir, "helmet.glb"), changed);
  assert.notEqual(await inputHash(item, "bindings", root), before);
  assert.match((await check(item, root)).note, /absent from GLB \[Visor\]/);
});
