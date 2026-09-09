import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_LEDGER, albedoHash, reviewFor } from "../scripts/lib/white-patch-review.mjs";

const AUTHORED = new Set(["legitimate", "unverifiable", "broken"]);
const DERIVED = new Set(["stale", "unreviewed"]);

test("a verdict applies only at the content it was made about", () => {
  const entry = REVIEW_LEDGER[0];
  assert.equal(reviewFor(entry.path, entry.sha256).status, entry.status);
});

test("changed content retires the verdict instead of carrying it forward", () => {
  // The defect this replaces: verdicts were keyed by path prefix, so a re-bake that genuinely
  // broke a reviewed item still printed "legitimate". If this assertion ever reads the old
  // status again, the report has gone back to certifying regressions as fine.
  const entry = REVIEW_LEDGER.find((row) => row.status === "legitimate");
  const rebaked = albedoHash(Buffer.from("a different image than the one that was reviewed"));
  assert.notEqual(rebaked, entry.sha256);

  const review = reviewFor(entry.path, rebaked);
  assert.equal(review.status, "stale");
  assert.notEqual(review.status, entry.status);
  assert.match(review.note, /re-review needed/);
});

test("an albedo nobody has judged reads as unreviewed, not as absent", () => {
  const review = reviewFor("public/models/cosmetics/not-a-real-item.albedo.webp", albedoHash(Buffer.from("x")));
  assert.equal(review.status, "unreviewed");
});

test("the ledger only records judgements a human could make", () => {
  for (const entry of REVIEW_LEDGER) {
    assert.ok(AUTHORED.has(entry.status), `${entry.path} has non-authored status ${entry.status}`);
    assert.ok(!DERIVED.has(entry.status), `${entry.path} stores a derived status`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${entry.path} has no full content hash`);
    assert.ok(entry.note.length > 0, `${entry.path} has no reason recorded`);
  }
});

test("items with no icon are not counted as confirmed", () => {
  // Four legacy assets have no catalogue icon at all. "Nobody could check this" is a different
  // fact from "somebody checked this and it is fine", and the summary must not merge them.
  const unverifiable = REVIEW_LEDGER.filter((entry) => entry.status === "unverifiable");
  assert.ok(unverifiable.length > 0);
  for (const entry of unverifiable) {
    assert.match(entry.note, /no catalogue icon exists/);
    assert.notEqual(entry.status, "legitimate");
  }
});
