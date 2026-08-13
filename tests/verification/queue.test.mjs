import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { deriveQueue } from "../../scripts/lib/verification/queue.mjs";
import { loadStore, setMark } from "../../scripts/lib/verification/store.mjs";
import { inputHash } from "../../scripts/lib/verification/inputs.mjs";

const root = mkdtempSync(join(tmpdir(), "vqueue-"));
const glb = join(root, "public", "models", "cosmetics", "shirt.glb");
mkdirSync(dirname(glb), { recursive: true });
writeFileSync(glb, "MESHBYTES");

const mk = (id) => ({ id, slot: "upperBody", model: { gltfPath: "models/cosmetics/shirt.glb" } });
const items = [mk("shirt-red"), mk("shirt-blue")];

test("unmarked aspects are absent, and colourways collapse to one entry", async () => {
  const store = await loadStore(join(root, "none.json"));
  const q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q.length, 1, "two colourways of one mesh must produce one geometry entry");
  assert.equal(q[0].state, "absent");
  assert.equal(q[0].scope, "mesh");
});

test("a matching hash reads as current; changing the mesh makes it stale", async () => {
  const store = await loadStore(join(root, "none.json"));
  const item = items[0];
  const { key } = (await import("../../scripts/lib/verification/inputs.mjs")).aspectKey(item, "geometry");
  setMark(store, key, "geometry", {
    mark: "pass", by: "agent", at: "2026-08-13",
    inputs: await inputHash(item, "geometry", root),
  });

  let q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q[0].state, "current");

  writeFileSync(glb, "DIFFERENTBYTES");
  q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q[0].state, "stale");
});
