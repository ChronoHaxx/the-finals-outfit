import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFiles, hashValues } from "../../scripts/lib/verification/hash.mjs";

const dir = mkdtempSync(join(tmpdir(), "vhash-"));
const a = join(dir, "a.txt");
const b = join(dir, "b.txt");
writeFileSync(a, "alpha");
writeFileSync(b, "beta");

test("hashFiles is stable for the same content", async () => {
  assert.equal(await hashFiles([a]), await hashFiles([a]));
});

test("hashFiles changes when content changes", async () => {
  const before = await hashFiles([a]);
  writeFileSync(a, "alpha!");
  assert.notEqual(await hashFiles([a]), before);
  writeFileSync(a, "alpha");
});

test("hashFiles is order-sensitive", async () => {
  assert.notEqual(await hashFiles([a, b]), await hashFiles([b, a]));
});

test("a missing file is not the same as an empty one", async () => {
  const missing = join(dir, "nope.txt");
  const empty = join(dir, "empty.txt");
  writeFileSync(empty, "");
  assert.notEqual(await hashFiles([missing]), await hashFiles([empty]));
});

test("hashValues is stable and sensitive", () => {
  assert.equal(hashValues([1, "x"]), hashValues([1, "x"]));
  assert.notEqual(hashValues([1, "x"]), hashValues([1, "y"]));
});
