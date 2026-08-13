import { test } from "node:test";
import assert from "node:assert/strict";
import { check as bindings } from "../../scripts/lib/verification/checks/bindings.mjs";
import { check as bodyCulling } from "../../scripts/lib/verification/checks/body-culling.mjs";

const ROOT = process.cwd();

test("an item with no baked set is n/a, not a failure", async () => {
  const r = await bindings({ id: "x", model: { gltfPath: "models/cosmetics/x.glb" } }, ROOT);
  assert.equal(r.mark, "na");
});

test("a baked set pointing at a missing file fails and names it", async () => {
  const r = await bindings({
    id: "x",
    model: { gltfPath: "models/cosmetics/x.glb", material: { bakedSet: {
      albedo: "models/cosmetics/nope.albedo.webp",
      normal: "models/cosmetics/nope.normal.webp",
      orm: "models/cosmetics/nope.orm.webp",
    } } },
  }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /nope\.albedo\.webp/);
});

test("a mesh with no bodymask fails, and says so", async () => {
  const r = await bodyCulling({ id: "x", model: { gltfPath: "models/cosmetics/definitely-not-real.glb" } }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /bodymask/i);
});
