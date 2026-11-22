import { test } from "node:test";
import assert from "node:assert/strict";

// The video range (22 Nov 2026): the part of an emote a video records, set by the timeline's markers, I and O, or typed
// times, kept per emote in this browser. A range is a person's work: it must survive storage failures, other versions'
// fields, other tabs' emotes, and a cap that only forgets the least recently set.

class FakeStorage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string) { if (this.failGet) throw new Error("blocked"); return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { if (this.failSet) throw new Error("quota"); this.data.set(key, value); }
}
const pageStorage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: pageStorage, addEventListener() {}, removeEventListener() {} };

const { RANGE_CAP, RANGE_KEY, clampRange, getRange, moveMark, readRange, resetRangesForTests, setRange, writeRange } = await import("../src/lib/video-range");

const ft = 1 / 30;
const near = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  assert.ok(Math.abs(a.from - b.from) < 1e-9 && Math.abs(a.to - b.to) < 1e-9, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test("markers: snapped to frames, a frame apart at least, an end pushed past the other resets that other", () => {
  near(moveMark(null, "from", 1.01, 4, ft), { from: 1, to: 4 }); // no range yet: the whole clip, then the start moves
  near(moveMark({ from: 1, to: 3 }, "to", 2.49, 4, ft), { from: 1, to: 2.5 });
  near(moveMark({ from: 1, to: 3 }, "from", 3.5, 4, ft), { from: 3.5, to: 4 }, ); // past the end: the end goes to the clip's
  near(moveMark({ from: 1, to: 3 }, "to", 0.5, 4, ft), { from: 0, to: 0.5 }); // before the start: the start goes to 0
  near(moveMark({ from: 1, to: 3 }, "from", 99, 4, ft), { from: 4 - ft, to: 4 }); // never past the last frame
  near(moveMark({ from: 1, to: 3 }, "to", -5, 4, ft), { from: 0, to: ft });
  assert.equal(clampRange({ from: 1, to: 9 }, 4)?.to, 4, "clamped to the clip");
  assert.equal(clampRange({ from: 3.99, to: 4 }, 4), null, "less than a frame: the whole clip");
  assert.equal(clampRange({ from: 1, to: 2 }, 0), null);
});

test("stored per emote, keeping fields and emotes this version does not know", () => {
  const store = new FakeStorage();
  store.data.set(RANGE_KEY, JSON.stringify({ future: { x: 1 }, ranges: { other: { from: 0.5, to: 1, at: 5, note: "kept" } } }));
  assert.equal(writeRange(store, "clap", { from: 1, to: 2 }, 100), true);
  assert.deepEqual(readRange(store, "clap"), { from: 1, to: 2 });
  const stored = JSON.parse(store.data.get(RANGE_KEY)!);
  assert.deepEqual(stored.future, { x: 1 });
  assert.deepEqual(stored.ranges.other, { from: 0.5, to: 1, at: 5, note: "kept" });
  // Clearing one emote leaves the rest.
  writeRange(store, "clap", null);
  assert.equal(readRange(store, "clap"), null);
  assert.deepEqual(readRange(store, "other"), { from: 0.5, to: 1 });
});

test("past the cap only the least recently set range is forgotten", () => {
  const store = new FakeStorage();
  for (let i = 0; i < RANGE_CAP; i++) writeRange(store, `e${i}`, { from: 0, to: 1 }, 1000 + i);
  writeRange(store, "e0", { from: 0, to: 2 }, 5000); // e0 set again: now the newest
  writeRange(store, "new", { from: 0, to: 1 }, 6000);
  const ranges = JSON.parse(store.data.get(RANGE_KEY)!).ranges;
  assert.equal(Object.keys(ranges).length, RANGE_CAP);
  assert.ok(!("e1" in ranges), "e1, the oldest, went");
  assert.ok("e0" in ranges && "new" in ranges);
});

test("broken or refusing storage never throws, and the page keeps its own ranges until it closes", () => {
  const store = new FakeStorage();
  store.data.set(RANGE_KEY, "{not json");
  assert.equal(readRange(store, "clap"), null);
  assert.equal(writeRange(store, "clap", { from: 1, to: 2 }), true, "a broken value is replaced, not thrown on");
  store.data.set(RANGE_KEY, JSON.stringify({ ranges: { clap: { from: 2, to: 1, at: 1 } } }));
  assert.equal(readRange(store, "clap"), null, "an inverted range reads as none");
  store.failSet = true;
  assert.equal(writeRange(store, "clap", { from: 1, to: 2 }), false);
  store.failGet = true;
  assert.equal(readRange(store, "clap"), null);
  assert.equal(writeRange(null, "clap", { from: 1, to: 2 }), false);

  resetRangesForTests();
  pageStorage.data.clear();
  pageStorage.failSet = true;
  setRange("clap", { from: 1, to: 2 });
  near(getRange("clap")!, { from: 1, to: 2 });
  setRange("clap", null);
  assert.equal(getRange("clap"), null, "a clear on the page wins over what storage still holds");
  pageStorage.failSet = false;
  setRange("wave", { from: 0.5, to: 1.5 });
  assert.ok(pageStorage.data.get(RANGE_KEY)!.includes("wave"), "stored once storage works again");
  near(getRange("wave")!, { from: 0.5, to: 1.5 });
});
