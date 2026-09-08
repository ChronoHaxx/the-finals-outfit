import { test } from "node:test";
import assert from "node:assert/strict";
import { seedFromCensus } from "../../scripts/lib/verification/seed-census.mjs";
import { loadStore, getMark } from "../../scripts/lib/verification/store.mjs";
import { aspectKey } from "../../scripts/lib/verification/inputs.mjs";

const item = { id: "a", slot: "upperBody", model: { gltfPath: "models/cosmetics/a.glb" } };

test("colour categories seed a colour fail carrying the reviewer's note", async () => {
  const store = await loadStore("/nonexistent.json");
  const n = await seedFromCensus([item], store, process.cwd(), {
    a: { category: "color-wrong", issue: "reads grey, icon is black", score: 40 },
  });
  assert.equal(n, 1);
  const { key } = aspectKey(item, "colour");
  const m = getMark(store, key, "colour");
  assert.equal(m.mark, "fail");
  assert.equal(m.by, "human");
  assert.match(m.note, /grey/);
});

test("seeded marks carry inputs: null — they can never read as current", async () => {
  const store = await loadStore("/nonexistent.json");
  await seedFromCensus([item], store, process.cwd(), {
    a: { category: "color-wrong", issue: "grey", score: 40 },
  });
  const { key } = aspectKey(item, "colour");
  assert.equal(getMark(store, key, "colour").inputs, null);
});

test("framing becomes notCheckable, not a failure", async () => {
  const store = await loadStore("/nonexistent.json");
  await seedFromCensus([item], store, process.cwd(), {
    a: { category: "framing", issue: "icon is a hand close-up", score: 45 },
  });
  const { key } = aspectKey(item, "colour");
  const m = getMark(store, key, "colour");
  assert.equal(m.mark, "notCheckable");
  assert.equal(m.inputs, null);
});

test("a `good` verdict seeds nothing — it predates every current asset", async () => {
  const store = await loadStore("/nonexistent.json");
  const n = await seedFromCensus([item], store, process.cwd(), {
    a: { category: "good", issue: "matches", score: 85 },
  });
  assert.equal(n, 0);
});
