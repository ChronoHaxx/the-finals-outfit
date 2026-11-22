import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSpeed, EMOTE_SPEEDS, formatSpeed, NORMAL_SPEED_INDEX, savedFace, savedSpeed, saveFace, saveSpeed, setEmoteSpeed,
  speedIndex, stepSpeed } from "../src/lib/emote-playback";

// Emote speed and the facial animation switch (21 Nov 2026): the slider's stops and the remembered choices.

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const broken = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

test("the stops run 0.25x to 4x with normal speed in the middle, symmetric in ratio", () => {
  assert.equal(EMOTE_SPEEDS[0], 0.25);
  assert.equal(EMOTE_SPEEDS.at(-1), 4);
  assert.equal(NORMAL_SPEED_INDEX, (EMOTE_SPEEDS.length - 1) / 2);
  for (let i = 0; i < EMOTE_SPEEDS.length; i++)
    assert.ok(Math.abs(EMOTE_SPEEDS[i] * EMOTE_SPEEDS[EMOTE_SPEEDS.length - 1 - i] - 1) < 1e-12, `stop ${i} mirrors its partner`);
});

test("speeds clamp to the range; nonsense is normal speed; the nearest stop is by ratio", () => {
  assert.deepEqual([clampSpeed(0.1), clampSpeed(9), clampSpeed(NaN), clampSpeed(-2), clampSpeed(0), clampSpeed(1.7)], [0.25, 4, 1, 1, 1, 1.7]);
  assert.equal(EMOTE_SPEEDS[speedIndex(0.3)], 1 / 3, "0.3 is nearer a third than a quarter by ratio");
  assert.equal(EMOTE_SPEEDS[speedIndex(1.7)], 1.5);
  assert.equal(speedIndex(1), NORMAL_SPEED_INDEX);
  assert.equal(stepSpeed(1, 1), 1.25);
  assert.equal(stepSpeed(1, -1), 0.8);
  assert.equal(stepSpeed(4, 1), 4, "held at the top");
  assert.equal(stepSpeed(0.25, -1), 0.25, "held at the bottom");
});

test("labels have at most two decimals", () => {
  assert.deepEqual(EMOTE_SPEEDS.map(formatSpeed), ["0.25×", "0.33×", "0.5×", "0.67×", "0.8×", "1×", "1.25×", "1.5×", "2×", "3×", "4×"]);
});

test("the speed is remembered as a number; normal speed leaves no key; a hand-edited value is clamped, not dropped", () => {
  const store = memoryStore();
  assert.equal(savedSpeed(store), 1);
  saveSpeed(2, store);
  assert.equal(store.data.get("finals-outfit.emote-speed"), "2");
  assert.equal(savedSpeed(store), 2);
  saveSpeed(1, store);
  assert.equal(store.data.size, 0);
  assert.equal(savedSpeed(memoryStore({ "finals-outfit.emote-speed": "12" })), 4);
  assert.equal(savedSpeed(memoryStore({ "finals-outfit.emote-speed": "fast" })), 1);
  assert.equal(savedSpeed(memoryStore({ "finals-outfit.emote-speed": String(1 / 3) })), 1 / 3);
});

test("the facial animation switch is on unless turned off, and only 'off' is stored", () => {
  const store = memoryStore();
  assert.equal(savedFace(store), true);
  saveFace(false, store);
  assert.equal(store.data.get("finals-outfit.facial-animation"), "off");
  assert.equal(savedFace(store), false);
  saveFace(true, store);
  assert.equal(store.data.size, 0);
});

test("blocked storage: the defaults apply and nothing throws", () => {
  assert.equal(savedSpeed(broken), 1);
  assert.equal(savedFace(broken), true);
  assert.doesNotThrow(() => { saveSpeed(3, broken); saveFace(false, broken); });
  assert.equal(savedSpeed(null), 1);
  assert.equal(savedFace(null), true);
});

test("setEmoteSpeed applies the speed even where there is no storage at all", () => {
  const animator = { state: { speed: 1 }, setSpeed(speed: number) { this.state.speed = clampSpeed(speed); } };
  setEmoteSpeed(animator, 10); // node has no window: the save is skipped, the animator still changes
  assert.equal(animator.state.speed, 4);
});
