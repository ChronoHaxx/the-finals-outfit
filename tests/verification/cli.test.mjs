import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerification } from "../../scripts/verify.mjs";

test("a dry run reports counts and writes nothing", async () => {
  const report = await runVerification({ root: process.cwd(), dry: true, aspects: ["geometry"], limit: 5 });
  assert.ok(report.checked > 0, "should have checked at least one mesh");
  assert.ok(["pass", "fail"].includes(report.entries[0].mark));
  assert.equal(report.written, false);
});
