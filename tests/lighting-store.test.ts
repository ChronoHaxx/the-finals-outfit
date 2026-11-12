import { test } from "node:test";
import assert from "node:assert/strict";

// The lighting store against a fake localStorage (11 Nov 2026): the loss paths the user's rules name, not only the
// happy path. The store module reads storage when it is imported, so each scenario sets the storage first.

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage, addEventListener() {} };
storage.setItem("finals-outfit.sun", "45"); // PR #37's Sun slider
storage.setItem("finals-outfit.lighting", JSON.stringify({
  current: { futureField: 1, backdrop: { futureTheme: "x" } },
  futureTop: true,
  looks: [{ name: "no id, from somewhere else" }],
}));

const { useLightingStore, LIGHTING_KEY, MAX_LOOKS } = await import("../src/lib/lighting-store");
const { DEFAULT_LIGHTING } = await import("../src/lib/stage-lighting");
const stored = () => JSON.parse(storage.getItem(LIGHTING_KEY)!);
const store = () => useLightingStore.getState();

test("PR #37's remembered Sun angle carries over", () => {
  assert.equal(store().settings.sunAzimuth, 45);
});

test("each change is written at once, keeping fields this version does not know", () => {
  store().change({ floorShadow: true, sunElevation: 20 });
  store().setBackdrop("lobby", "black");
  const s = stored();
  assert.equal(s.futureTop, true);
  assert.equal(s.current.futureField, 1);
  assert.deepEqual(s.current.backdrop, { futureTheme: "x", studio: "default", lobby: "black" });
  assert.deepEqual([s.current.sunAzimuth, s.current.floorShadow, s.current.sunElevation], [45, true, 20]);
  assert.equal(s.looks.length, 1, "a look this version cannot show is kept");
});

test("Reset keeps the replaced look for Undo, and Undo survives a reload", () => {
  const custom = store().settings;
  store().reset();
  assert.deepEqual(store().settings, DEFAULT_LIGHTING);
  store().refresh(); // as a reload reads it
  assert.deepEqual(store().previous, custom);
  store().undo();
  assert.deepEqual(store().settings, custom);
  assert.equal(store().previous, null);
  assert.equal(stored().previous, undefined);
});

test("saving adds a separate look; past the cap it is refused, never replacing one", () => {
  for (let i = 0; i < MAX_LOOKS; i++) {
    store().change({ sunAzimuth: i });
    assert.equal(store().saveLook(), true);
  }
  assert.equal(store().looks.length, MAX_LOOKS);
  assert.deepEqual(store().looks.map(look => look.name).slice(0, 3), ["Look 1", "Look 2", "Look 3"]);
  assert.equal(store().saveLook(), false);
  assert.equal(store().looks.length, MAX_LOOKS);
  assert.deepEqual(store().looks.map(look => look.settings.sunAzimuth), [...Array(MAX_LOOKS).keys()]);
});

test("another tab's look survives this tab deleting one; deleting removes only that id", () => {
  const other = stored();
  other.looks.push({ id: "other-tab", name: "From the other tab", savedAt: 1, settings: { sunAzimuth: 90 } });
  storage.setItem(LIGHTING_KEY, JSON.stringify(other));
  const first = store().looks[0].id; // this tab has not seen the other tab's look yet
  store().deleteLook(first);
  const ids = stored().looks.map((look: { id?: string }) => look.id);
  assert.ok(!ids.includes(first));
  assert.ok(ids.includes("other-tab"));
  assert.equal(ids.filter((id: string | undefined) => id === undefined).length, 1, "the id-less look is still there");
  assert.equal(store().looks.at(-1)!.settings.sunAzimuth, 90, "this tab now shows it");
});

test("a look whose backdrop no longer exists still applies the rest", () => {
  const data = stored();
  data.looks.push({ id: "stale", name: "Stale", savedAt: 2, settings: { sunAzimuth: 30, floorShadow: true, backdrop: { studio: "gone" } } });
  storage.setItem(LIGHTING_KEY, JSON.stringify(data));
  store().refresh();
  const look = store().looks.find(l => l.id === "stale")!;
  store().apply(look.settings);
  assert.deepEqual([store().settings.sunAzimuth, store().settings.floorShadow, store().settings.backdrop.studio], [30, true, "default"]);
});

test("blocked storage loses nothing in the session and throws nowhere", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  (globalThis as unknown as { window: { localStorage: unknown } }).window.localStorage = blocked;
  assert.doesNotThrow(() => store().change({ sunAzimuth: 12 }));
  assert.equal(store().settings.sunAzimuth, 12);
  assert.doesNotThrow(() => store().refresh());
});
