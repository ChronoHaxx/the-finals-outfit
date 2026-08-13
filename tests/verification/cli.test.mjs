import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerification } from "../../scripts/verify.mjs";

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
