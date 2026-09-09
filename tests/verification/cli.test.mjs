import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerification } from "../../scripts/verify.mjs";
import { loadStore, saveStore, setMark } from "../../scripts/lib/verification/store.mjs";
import { aspectKey, inputHash } from "../../scripts/lib/verification/inputs.mjs";

// H7: the test must not depend on the ambient store — a previous non-dry `npm run verify`
// writes scripts/verification.generated.json and made everything read as current (checked
// 0). A temp store keeps the suite independent of whether anyone ran the CLI.
const storePath = join(mkdtempSync(join(tmpdir(), "vcli-")), "store.json");

test("a dry run reports counts and writes nothing", async () => {
  const report = await runVerification({ root: process.cwd(), dry: true, aspects: ["geometry"], limit: 5, storePath });
  assert.ok(report.checked > 0, "should have checked at least one mesh");
  assert.ok(["pass", "fail"].includes(report.entries[0].mark));
  assert.equal(report.written, false);
});

test("a needs-human mark stays in the standing section and is never re-checked", async () => {
  const items = JSON.parse(readFileSync("src/data/items.json", "utf8"));
  const item = items.find((i) => i.model?.material?.bakedSet);
  const store = await loadStore(storePath);
  const { key } = aspectKey(item, "bindings");
  setMark(store, key, "bindings", {
    mark: "needs-human", by: "agent", at: "2026-08-13",
    inputs: await inputHash(item, "bindings", process.cwd()), // fresh hash
    note: "albedo is uniform",
  });
  await saveStore(storePath, store);

  const report = await runVerification({ root: process.cwd(), dry: true, aspects: ["bindings"], limit: 5, storePath });
  assert.ok(report.needsHuman.some((e) => e.key === key && e.note === "albedo is uniform"),
    "needs-human mark must appear in the standing section");
  assert.ok(!report.entries.some((e) => e.key === key), "machine must not re-check a needs-human mark");
});
