import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A look opened from a share link (22 Nov 2026, lighting-store.ts `shared`) against a fake localStorage: the loss paths
// the user's rules name. Opening a link must not overwrite the viewer's own look or saved looks; keeping it never
// replaces a saved look; an edit in flight is written first; another tab's change is not lost behind the shared look.

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage, addEventListener() {} };
(globalThis as unknown as { document: unknown }).document = { addEventListener() {}, visibilityState: "visible" };

const { useLightingStore, LIGHTING_KEY, MAX_LOOKS, offerLinkLighting, sharedLookName } = await import("../src/lib/lighting-store");
const { coolLook, lobbyLook, sanitizeLook, studioLook, warmLook } = await import("../src/lib/stage-lighting");
const { lightingCode, parseLighting } = await import("../src/lib/share-lighting");
const store = () => useLightingStore.getState();
const raw = () => storage.getItem(LIGHTING_KEY);
const stored = () => JSON.parse(raw()!);

/** The viewer's own look: Warm with the exposure turned up, a saved look, and a field from a newer version. */
function mine() {
  const look = warmLook();
  look.exposure = 1.4;
  return look;
}
beforeEach(() => {
  storage.data.clear();
  storage.setItem(LIGHTING_KEY, JSON.stringify({ version: 2, futureTop: "kept", current: mine(), previous: coolLook(),
    looks: [{ id: "a", name: "Look 1", savedAt: 1, look: lobbyLook() }] }));
  store().refresh();
  useLightingStore.setState({ shared: null, sharedOutcome: null });
  store().refresh();
});

test("opening a link shows its look and writes nothing; going back restores the viewer's own", () => {
  const before = raw();
  store().showShared(studioLook(), "Studio");
  assert.equal(lightingCode(store().look), "studio");
  assert.equal(store().shared?.label, "Studio");
  assert.equal(lightingCode(store().shared!.own), lightingCode(mine()));
  store().flush(); // pagehide / visibilitychange
  assert.equal(raw(), before, "storage untouched while the shared look shows");
  store().leaveShared();
  assert.equal(lightingCode(store().look), lightingCode(mine()));
  assert.equal(store().shared, null);
  assert.equal(raw(), before, "going back writes nothing either");
});

test("a link with the look the viewer already has changes nothing", () => {
  store().showShared(mine());
  assert.equal(store().shared, null);
  // Rounded to the link's millimetres, it is still the same look.
  const read = parseLighting(lightingCode(mine()));
  assert.ok(read.kind === "look");
  if (read.kind === "look") store().showShared(read.look);
  assert.equal(store().shared, null);
});

test("an edit still waiting to be written is written before the shared look shows", () => {
  store().edit(look => ({ ...look, exposure: 2.2 }));
  assert.equal(stored().current.exposure, 1.4, "not yet written (drag in progress)");
  store().showShared(lobbyLook());
  assert.equal(stored().current.exposure, 2.2, "the viewer's change is kept");
  assert.equal(store().shared!.own.exposure, 2.2);
});

test("keeping makes it the viewer's look and a new saved look; Undo returns to theirs", () => {
  store().showShared(coolLook(), "Cool");
  store().keepShared();
  assert.equal(store().shared, null);
  assert.equal(lightingCode(sanitizeLook(stored().current)), "cool");
  assert.deepEqual(stored().looks.map((l: { name: string }) => l.name), ["Look 1", "Shared look"], "added, nothing replaced");
  assert.deepEqual(store().sharedOutcome, { kind: "kept", savedAs: "Shared look", added: true });
  assert.equal(stored().futureTop, "kept", "fields another version wrote survive");
  store().undo();
  assert.equal(lightingCode(store().look), lightingCode(mine()));
  assert.equal(lightingCode(sanitizeLook(stored().current)), lightingCode(mine()));
});

test("keeping a look already saved does not save it twice; at the cap it is kept without saving", () => {
  store().showShared(lobbyLook(), "Lobby");
  store().keepShared();
  assert.equal(stored().looks.length, 1);
  assert.deepEqual(store().sharedOutcome, { kind: "kept", savedAs: "Look 1", added: false });

  const full = stored();
  full.looks = Array.from({ length: MAX_LOOKS }, (_, i) => ({ id: `l${i}`, name: `Look ${i + 1}`, savedAt: i, look: lobbyLook() }));
  storage.setItem(LIGHTING_KEY, JSON.stringify(full));
  store().refresh();
  store().showShared(coolLook());
  store().keepShared();
  assert.equal(stored().looks.length, MAX_LOOKS, "nothing evicted");
  assert.equal(lightingCode(sanitizeLook(stored().current)), "cool", "still kept as the current look");
  assert.deepEqual(store().sharedOutcome, { kind: "kept", savedAs: null, added: false });
});

test("changing the shared look keeps it as the viewer's, written at once, with theirs one Undo away", () => {
  store().showShared(lobbyLook());
  store().edit(look => ({ ...look, exposure: 0.8 }));
  assert.equal(store().shared, null);
  assert.equal(stored().current.exposure, 0.8, "written at once, not after the drag delay");
  assert.equal(stored().current.toneMapping, "aces");
  assert.equal(stored().looks.length, 1, "no saved look added by an edit");
  store().undo();
  assert.equal(lightingCode(store().look), lightingCode(mine()));
});

test("picking another look leaves the shared one and applies over the viewer's own", () => {
  store().showShared(lobbyLook());
  store().apply(coolLook());
  assert.equal(store().shared, null);
  assert.equal(lightingCode(store().look), "cool");
  assert.equal(lightingCode(store().previous!), lightingCode(mine()), "Undo returns to the viewer's look, not the link's");
  store().showShared(lobbyLook());
  store().apply(coolLook()); // the viewer's own look already
  assert.equal(store().shared, null);
  assert.equal(lightingCode(store().look), "cool");
  store().showShared(lobbyLook());
  store().undo(); // while shared: back to the viewer's look first
  assert.equal(store().shared, null);
  assert.equal(lightingCode(store().look), "cool");
});

test("saving while the shared look shows adds it and leaves the viewer's look stored as it was", () => {
  store().showShared(coolLook());
  const current = JSON.stringify(stored().current);
  assert.equal(store().saveLook(), true);
  assert.equal(stored().looks.length, 2);
  assert.equal(JSON.stringify(stored().current), current);
  assert.ok(store().shared, "still shown, still the viewer's choice");
});

test("another tab's change to the viewer's look waits behind the shared look and is not overwritten", () => {
  store().showShared(lobbyLook());
  const data = stored();
  data.current.exposure = 2.5;
  storage.setItem(LIGHTING_KEY, JSON.stringify(data));
  store().refresh(); // the storage event
  assert.equal(lightingCode(store().look), lightingCode(lobbyLook()), "the shared look stays on screen");
  assert.equal(store().shared!.own.exposure, 2.5);
  store().leaveShared();
  assert.equal(store().look.exposure, 2.5);
  assert.equal(stored().current.exposure, 2.5);
});

test("a link offers its lighting once per address; one this version cannot show leaves the viewer's own", () => {
  const href = "https://x.test/#/?o=2.&lt=cool";
  offerLinkLighting(href, parseLighting("cool"));
  assert.equal(lightingCode(store().look), "cool");
  store().leaveShared();
  offerLinkLighting(href, parseLighting("cool")); // the builder re-reads the same address
  assert.equal(store().shared, null, "not offered again");
  const before = raw();
  offerLinkLighting("https://x.test/#/?o=2.&lt=golden-hour", parseLighting("golden-hour"));
  assert.equal(store().shared, null);
  assert.deepEqual(store().sharedOutcome, { kind: "unavailable" });
  assert.equal(raw(), before);
  offerLinkLighting("https://x.test/#/?o=2.", null);
  assert.deepEqual(store().sharedOutcome, { kind: "unavailable" }, "a link without lighting changes nothing");
  // The address moved on (the link was tidied away); opening the same link again offers it again.
  offerLinkLighting("https://x.test/#/", null);
  offerLinkLighting(href, parseLighting("cool"));
  assert.equal(lightingCode(store().look), "cool");
  assert.ok(store().shared);
  store().leaveShared();
});

test("a newer build's link additions are stored when kept and dropped when another look replaces them", () => {
  const read = parseLighting(`${lightingCode({ ...coolLook(), exposure: 1.1 })}.gfog_2`);
  assert.ok(read.kind === "look");
  if (read.kind !== "look") return;
  store().showShared(read.look);
  store().keepShared();
  assert.deepEqual(stored().current.linkExtras, ["gfog_2"]);
  store().apply(studioLook());
  assert.equal(stored().current.linkExtras, undefined, "Studio does not inherit them");
});

test("shared look names never repeat", () => {
  const named = (...names: string[]) => names.map((name, i) => ({ id: String(i), name, savedAt: 0, look: studioLook() }));
  assert.equal(sharedLookName([]), "Shared look");
  assert.equal(sharedLookName(named("Shared look", "Shared look 2")), "Shared look 3");
});
