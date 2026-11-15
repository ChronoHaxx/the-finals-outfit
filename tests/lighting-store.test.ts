import { test } from "node:test";
import assert from "node:assert/strict";

// The lighting store against a fake localStorage (11-12 Nov 2026): the loss paths the user's rules name, not only the
// happy path. The store module reads storage when it is imported, so each scenario sets the storage first.

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage, addEventListener() {} };
(globalThis as unknown as { document: unknown }).document = { addEventListener() {}, visibilityState: "visible" };
storage.setItem("finals-outfit.sun", "45"); // PR #37's Sun slider
storage.setItem("finals-outfit.lighting", JSON.stringify({
  futureTop: true,
  // PR #40's first version: a setting, and a saved look under `settings`, plus one with no id from somewhere else.
  current: { sunAzimuth: 0, sunElevation: 20, floorShadow: true, backdrop: { studio: "charcoal", lobby: "default" } },
  looks: [{ id: "old", name: "Look 1", savedAt: 1, settings: { sunAzimuth: 90, floorShadow: true } }, { name: "no id" }],
}));

const { useLightingStore, LIGHTING_KEY, MAX_LOOKS, mergedLook } = await import("../src/lib/lighting-store");
const { DEFAULT_LOOK, KEY_POSITION, lightAngles, lobbyLook, rotated, sanitizeLook, studioLook } = await import("../src/lib/stage-lighting");
const stored = () => JSON.parse(storage.getItem(LIGHTING_KEY)!);
const store = () => useLightingStore.getState();

test("PR #40's first settings and saved looks carry over", () => {
  assert.ok(Math.abs(lightAngles(store().look.lights[0].position).height - 20) < 1e-9);
  assert.equal(store().look.floorShadow, true);
  assert.equal(store().look.backdrop.inner, "#2b2e33");
  assert.equal(store().looks.length, 1);
  assert.deepEqual(store().looks[0].look.lights[0].position, rotated(KEY_POSITION, 90));
});

test("a drag is written once it settles, or at once when the page hides; unknown fields survive", async () => {
  store().edit(look => { look.lights[0].color = "#ff0000"; return look; });
  store().edit(look => { look.lights[0].color = "#ff8800"; return look; });
  assert.equal(stored().current.lights, undefined, "not written mid-drag");
  store().flush(); // what pagehide / visibilitychange do
  assert.equal(stored().current.lights[0].color, "#ff8800");
  assert.equal(stored().futureTop, true);
  assert.equal(stored().current.sunAzimuth, undefined, "the first-version fields went with the conversion");
  // A newer version's per-light field survives this version's write.
  const data = stored(); data.current.lights[0].falloff = 3; data.current.hemisphere.future = "x";
  storage.setItem(LIGHTING_KEY, JSON.stringify(data));
  store().edit(look => { look.exposure = 1.3; return look; });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual([stored().current.exposure, stored().current.lights[0].falloff, stored().current.hemisphere.future], [1.3, 3, "x"]);
  assert.equal(stored().looks.length, 2, "a saved look this version cannot show is kept");
});

test("PR #37's Sun angle alone turns the reviewed sun exactly", async () => {
  const { currentFrom } = await import("../src/lib/lighting-store");
  const only = { getItem: (key: string) => key === "finals-outfit.sun" ? "-60" : null, setItem() {} };
  assert.deepEqual(currentFrom({}, only).lights[0].position, rotated(KEY_POSITION, -60));
  assert.deepEqual(currentFrom({}, { getItem: () => null, setItem() {} }), sanitizeLook(DEFAULT_LOOK));
});

test("a removed light is removed from storage too", () => {
  const ids = (s: { lights: { id: string }[] }) => s.lights.map(l => l.id);
  assert.deepEqual(ids(mergedLook({ lights: [{ id: "sun" }, { id: "rim", extra: 1 }] }, studioLook()) as never), ["sun", "rim"]);
  const one = studioLook(); one.lights = one.lights.slice(0, 1);
  assert.deepEqual(ids(mergedLook({ lights: [{ id: "sun" }, { id: "rim" }] }, one) as never), ["sun"]);
});

test("Reset keeps the replaced look for Undo, and Undo survives a reload", () => {
  const custom = store().look;
  store().reset();
  assert.deepEqual(store().look, sanitizeLook(DEFAULT_LOOK));
  store().refresh(); // as a reload reads it
  assert.deepEqual(store().previous, custom);
  store().undo();
  assert.deepEqual(store().look, custom);
  assert.equal(store().previous, null);
  assert.equal(stored().previous, undefined);
  store().apply(lobbyLook());
  assert.deepEqual(store().look, lobbyLook());
  assert.deepEqual(store().previous, custom, "a ready-made look is undoable too");
});

test("saving adds a separate look; past the cap it is refused, never replacing one", () => {
  while (store().looks.length < MAX_LOOKS) {
    store().edit(look => { look.exposure = 0.5 + store().looks.length / 10; return look; });
    assert.equal(store().saveLook(), true);
  }
  assert.equal(store().saveLook(), false);
  assert.equal(store().looks.length, MAX_LOOKS);
  assert.equal(store().looks[0].id, "old", "the oldest is still there");
  assert.equal(store().looks.at(-1)!.name, `Look ${MAX_LOOKS}`);
});

test("another tab's look survives this tab deleting one; deleting removes only that id", () => {
  const other = stored();
  other.looks.push({ id: "other-tab", name: "From the other tab", savedAt: 9, look: lobbyLook() });
  storage.setItem(LIGHTING_KEY, JSON.stringify(other));
  store().deleteLook("old");
  const ids = stored().looks.map((look: { id?: string }) => look.id);
  assert.ok(!ids.includes("old") && ids.includes("other-tab"));
  assert.equal(ids.filter((id: string | undefined) => id === undefined).length, 1, "the id-less look is still there");
  assert.deepEqual(store().looks.at(-1)!.look, lobbyLook(), "this tab now shows it");
});

test("blocked storage loses nothing in the session and throws nowhere", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  (globalThis as unknown as { window: { localStorage: unknown } }).window.localStorage = blocked;
  assert.doesNotThrow(() => { store().edit(look => { look.exposure = 2; return look; }); store().flush(); });
  assert.equal(store().look.exposure, 2);
  assert.doesNotThrow(() => store().apply(studioLook()));
  assert.doesNotThrow(() => store().refresh());
});
