import { test } from "node:test";
import assert from "node:assert/strict";
import { initialTier, isResolution, judgeWindow, percentile, rememberedAuto, renderDpr, SLOW_FACTOR, TARGET_PERIOD, tierDpr, type AutoState } from "../src/lib/graphics-quality";

// Auto graphics (6 Nov 2026): the decision rule on measured windows of moving frame times (seconds).
const fresh = (tier: AutoState["tier"] = "high"): AutoState => ({ tier, settled: false, cpuBound: false, slowWindows: 0 });
const frames = (typical: number, slowShare = 0, slow = typical) =>
  Array.from({ length: 120 }, (_, i) => (i < Math.round(120 * slowShare) ? slow : typical));
const SMOOTH = frames(1 / 60), JANKY = frames(1 / 60, 0.2, 1 / 30); // 20% of frames miss vsync
const slowTwice = (state: AutoState) => judgeWindow(judgeWindow(state, JANKY), JANKY);

test("the 95th percentile, not the average, decides", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.ok(percentile(JANKY, 0.95) > SLOW_FACTOR * TARGET_PERIOD, "a fifth of frames at 30 fps is slow");
  assert.ok(percentile(frames(1 / 60, 0.03, 1 / 20), 0.95) <= SLOW_FACTOR * TARGET_PERIOD, "a few hitches are not");
  assert.ok(percentile(frames(1 / 120), 0.95) <= SLOW_FACTOR * TARGET_PERIOD, "120 Hz is fine");
});

test("a smooth first window settles at the starting tier", () => {
  assert.deepEqual(judgeWindow(fresh(), SMOOTH), { ...fresh(), settled: true });
  assert.equal(initialTier(true), "balanced", "touch devices start at Balanced");
  assert.equal(initialTier(false), "high");
});

test("two slow windows step down, then the next window checks that the step helped", () => {
  const spike = judgeWindow(fresh(), JANKY);
  assert.deepEqual([spike.tier, spike.slowWindows], ["high", 1], "one slow window can be background load: kept");
  assert.equal(judgeWindow(spike, SMOOTH).tier, "high", "a passing spike changes nothing");
  const stepped = slowTwice(fresh());
  assert.equal(stepped.tier, "balanced");
  assert.equal(stepped.previous?.tier, "high");
  // Faster and smooth: kept.
  assert.deepEqual(judgeWindow(stepped, SMOOTH), { tier: "balanced", settled: true, cpuBound: false, slowWindows: 0, previous: undefined });
  // Faster but still slow: down again.
  const stillSlow = frames(1 / 60, 0.2, 1 / 35); // 28.6 ms: faster than 33 ms, still over the 25 ms line
  assert.equal(judgeWindow(stepped, stillSlow).tier, "low");
});

test("a step that did not help means processor-bound: undo it and stop lowering visuals", () => {
  const stepped = slowTwice(fresh());
  const undone = judgeWindow(stepped, JANKY);
  assert.deepEqual(undone, { tier: "high", settled: true, cpuBound: true, slowWindows: 0 });
  assert.equal(judgeWindow(undone, JANKY).tier, "high", "never lowered again this session");
  assert.equal(judgeWindow(judgeWindow(undone, JANKY), JANKY).tier, "high");
});

test("after settling, too, one slow window is tolerated and two in a row step down; never up", () => {
  const settled = judgeWindow(fresh(), SMOOTH);
  const once = judgeWindow(settled, JANKY);
  assert.deepEqual([once.tier, once.slowWindows], ["high", 1]);
  assert.equal(judgeWindow(once, SMOOTH).slowWindows, 0, "a smooth window resets the count");
  assert.equal(judgeWindow(once, JANKY).tier, "balanced");
  const low = { ...fresh("low"), settled: true };
  assert.equal(judgeWindow(judgeWindow(low, JANKY), JANKY).tier, "low", "Low is the floor");
  assert.equal(judgeWindow({ ...fresh("balanced"), settled: true }, frames(1 / 240)).tier, "balanced", "fast frames never step up");
});

// 10 Nov 2026: every preset has motion vectors; presets differ only in pixel density, so a step must lower it.
test("presets are pixel densities, capped by the screen and never below 1x", () => {
  assert.deepEqual([tierDpr("high", 3), tierDpr("balanced", 3), tierDpr("low", 3)], [2, 1.5, 1]);
  assert.deepEqual([tierDpr("high", 1.25), tierDpr("balanced", 1.25), tierDpr("low", 1.25)], [1.25, 1.25, 1]);
  assert.equal(tierDpr("high", 0.8), 1, "a zoomed-out page still draws at least 1x, as dpr={[1, max]} did");
});

test("a hand-picked resolution is a share of the screen's own pixels and overrides the preset", () => {
  assert.equal(renderDpr("low", "auto", 2), 1);
  assert.equal(renderDpr("low", 1, 2), 2, "100% on a 2x screen is 2x whatever the preset");
  assert.equal(renderDpr("high", 0.5, 2), 1);
  assert.equal(renderDpr("high", 0.5, 0.4), 0.25, "never below a quarter");
  assert.ok(isResolution("auto") && isResolution(0.75) && !isResolution(0) && !isResolution(2) && !isResolution("75"));
});

test("Auto skips presets that draw the same pixels on this screen (Fable review, 10 Nov)", () => {
  const twice = (state: AutoState, dpr: number) => judgeWindow(judgeWindow(state, JANKY, dpr), JANKY, dpr);
  // 150% Windows scaling: High and Balanced are both 1.5x, so the step goes straight to Low.
  const at150 = twice(fresh(), 1.5);
  assert.deepEqual([at150.tier, at150.previous?.tier], ["low", "high"]);
  // A 1x screen: nothing draws fewer pixels. Settle without calling the device processor-bound.
  assert.deepEqual(twice(fresh(), 1), { ...fresh(), settled: true });
  assert.equal(twice(fresh(), 1).cpuBound, false);
});

test("Auto's result from before the presets changed is not reused", () => {
  const device = "GPU|2|2560x1440";
  assert.equal(rememberedAuto({ auto: { device, tier: "low" } }, device), null, "unversioned (6 Nov) result ignored");
  assert.equal(rememberedAuto({ auto: { device: "other", tier: "low", version: 2 } }, device), null);
  assert.deepEqual(rememberedAuto({ auto: { device, tier: "balanced", cpuBound: true, version: 2 } }, device),
    { tier: "balanced", settled: true, cpuBound: true, slowWindows: 0 });
});
