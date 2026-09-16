import { test } from "node:test";
import assert from "node:assert/strict";
import { getItemById } from "../src/lib/catalog";
import { summarizeReconstruction, formatProgressPercent } from "../src/lib/reconstruction-progress";

test("progress counts each supplied cosmetic once, including reviewed exceptions and unsupported previews", () => {
  const ids = ["hairs-afrofade", "streetwear-tightsinglet-cotton-enorino", "streetwear-tightsinglet-cotton-black", "attachment-boombox-01-finals-lumbar"];
  const items = ids.map(id => getItemById(id)!);
  const summary = summarizeReconstruction(items, new Set([ids[0], ids[2], "outside-this-catalog"]), "ready");
  assert.deepEqual(summary, { total: 4, counts: { untouched: 1, polish: 1, issue: 1, accepted: 1, unknown: 0 } });
  const noPreview = { ...items[3], model: undefined, decal: undefined };
  assert.equal(summarizeReconstruction([noPreview], new Set(), "ready").counts.untouched, 1);
  assert.equal(summarizeReconstruction(items.slice(0, 2), new Set([ids[0]]), "ready").total, 2);
});

test("failed or loading progress stays unknown while explicit reviews remain, and an empty catalog stays empty", () => {
  const items = [getItemById("hairs-afrofade")!, getItemById("streetwear-tightsinglet-cotton-enorino")!];
  for (const state of ["loading", "unavailable"] as const) {
    assert.deepEqual(summarizeReconstruction(items, new Set(), state).counts,
      { untouched: 0, polish: 0, issue: 0, accepted: 1, unknown: 1 });
  }
  assert.deepEqual(summarizeReconstruction([], new Set(), "ready"),
    { total: 0, counts: { untouched: 0, polish: 0, issue: 0, accepted: 0, unknown: 0 } });
});

test("percentage labels distinguish a tiny accepted cohort from zero", () => {
  assert.equal(formatProgressPercent(1, 2866), "<0.1%");
  assert.equal(formatProgressPercent(2605, 2866), "90.9%");
  assert.equal(formatProgressPercent(1, 4), "25.0%");
  assert.equal(formatProgressPercent(0, 2866), "0%");
  assert.equal(formatProgressPercent(0, 0), "0%");
});
