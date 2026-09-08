import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, setMark, getMark, MARKS } from "../../scripts/lib/verification/store.mjs";

const file = join(mkdtempSync(join(tmpdir(), "vstore-")), "v.json");

test("a missing store loads as empty, not an error", async () => {
  const s = await loadStore(file);
  assert.equal(s.version, 1);
  assert.deepEqual(s.marks, {});
});

test("marks round-trip", async () => {
  const s = await loadStore(file);
  setMark(s, "models/x.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "abc" });
  await saveStore(file, s);
  const again = await loadStore(file);
  assert.equal(getMark(again, "models/x.glb", "geometry").mark, "pass");
});

test("saved keys are sorted so diffs stay readable", async () => {
  const s = await loadStore(file);
  setMark(s, "models/z.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "z" });
  setMark(s, "models/a.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "a" });
  await saveStore(file, s);
  const text = readFileSync(file, "utf8");
  assert.ok(text.indexOf('"models/a.glb"') < text.indexOf('"models/z.glb"'));
});

test("an unknown mark value is rejected", async () => {
  const s = await loadStore(file);
  assert.throws(() => setMark(s, "k", "geometry", { mark: "probably", by: "agent", at: "x", inputs: "y" }));
  assert.ok(MARKS.includes("notCheckable"));
});
