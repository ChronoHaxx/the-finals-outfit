import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The builder's discovery (22 Nov 2026; before it, the "What you can do" guide of 21 Nov): the words in
// src/data/feature-guide.ts are public text and must name controls that exist; what a visitor has found, the tour's
// place and the one-time nudges are per-browser preferences that must survive every way storage fails and never drop
// what another version wrote.

class FakeStorage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string) { if (this.failGet) throw new Error("blocked"); return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { if (this.failSet) throw new Error("quota"); this.data.set(key, value); }
}
const pageStorage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: pageStorage, addEventListener() {}, removeEventListener() {},
};

const {
  FEATURES, FEATURE_GROUPS, GUIDE_FEATURE, NUDGES, POINTER_SHORTCUTS, TOUCH_SHORTCUTS, TOUR, featureById, featureGuideStrings,
} = await import("../src/data/feature-guide");
const { lintPublicText } = await import("../src/lib/public-text");
const { HINTS_KEY, dismissHint, hintDismissed, readHintDismissed, writeHintDismissed } = await import("../src/lib/hints");
const discovery = await import("../src/lib/discovery");
const { distanceToBox, isControlSized, nearest, place } = await import("../src/lib/discovery-layout");
const { guideKeyAction } = await import("../src/components/FeatureGuide");

// ---------------------------------------------------------------------------------------------------------------------
// The words.

test("every guide string passes the public-text rules", () => {
  const strings = featureGuideStrings();
  assert.ok(strings.length > 40, "the check sees the whole guide");
  const problems = strings.flatMap(({ text, where }) => lintPublicText(text, where));
  assert.deepEqual(problems, []);
});

test("ids are unique, groups exist, and every hint is one short line that starts with a verb", () => {
  const all = [...FEATURES, GUIDE_FEATURE];
  const ids = all.map(feature => feature.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(FEATURE_GROUPS.map(group => group.id));
  for (const feature of all) {
    assert.ok(groups.has(feature.group), feature.id);
    assert.ok(feature.name.length <= 20, `${feature.id}: a name is the control's own label`);
    assert.ok(feature.hint.length <= 80, `${feature.id}: one line ("${feature.hint}")`);
    assert.match(feature.hint, /^[A-Z][a-z]+(?:,| |$)/, `${feature.id}: starts with a word`);
    assert.doesNotMatch(feature.hint, /\b(?:top right|on the right|at the foot|under the|beside the|next to)\b/i,
      `${feature.id}: says what it does, not where it is (the interface points at it)`);
  }
});

test("the tour and the nudges only name features that exist", () => {
  for (const id of TOUR) assert.ok(featureById(id), id);
  assert.equal(new Set(TOUR).size, TOUR.length);
  for (const [id, nudge] of Object.entries(NUDGES)) assert.ok(featureById(nudge.feature), id);
});

// Every feature id must be on a control (useFeature("<id>") in src), so a renamed or removed control cannot leave the
// tour or the index pointing at nothing.
test("every feature is on a control, and every control's feature is in the guide", () => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(import.meta.dirname, "..", "src", "components"));
  walk(join(import.meta.dirname, "..", "src", "pages"));
  const used = new Set(sources.join("\n").match(/useFeature\("([a-z-]+)"/g)?.map(call => call.slice(12, -1)) ?? []);
  for (const feature of [...FEATURES, GUIDE_FEATURE]) assert.ok(used.has(feature.id), `no control calls useFeature("${feature.id}")`);
  for (const id of used) assert.ok(featureById(id), `useFeature("${id}") has no entry in feature-guide.ts`);
});

test("the shortcut lists name the keys the builder handles, and features' keys are among them", () => {
  const keys = POINTER_SHORTCUTS.flatMap(shortcut => shortcut.keys);
  for (const key of ["H", "Esc", ",", ".", "<", ">", "?"]) assert.ok(keys.includes(key), key);
  for (const feature of [...FEATURES, GUIDE_FEATURE]) for (const key of feature.keys ?? []) assert.ok(keys.includes(key), `${feature.id}: ${key}`);
  assert.ok(TOUCH_SHORTCUTS.some(shortcut => shortcut.keys.includes("Double-tap")));
});

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, isComposing: false,
  target: { tagName: "BODY" } as unknown as EventTarget, ...extra,
});

test("? opens and closes the guide, and leaves typing and other dialogs alone", () => {
  assert.equal(guideKeyAction(key("?"), false, false), "show");
  assert.equal(guideKeyAction(key("?"), true, false), "hide");
  assert.equal(guideKeyAction(key("?"), false, true), null, "the welcome screen or another dialog is open");
  assert.equal(guideKeyAction(key("/"), false, false), null);
  assert.equal(guideKeyAction(key("?", { ctrlKey: true }), false, false), null);
  assert.equal(guideKeyAction(key("?", { repeat: true }), false, false), null);
  const search = { tagName: "INPUT", type: "search" } as unknown as EventTarget;
  assert.equal(guideKeyAction(key("?", { target: search }), false, false), null, "typing ? into a search box");
  const slider = { tagName: "INPUT", type: "range" } as unknown as EventTarget;
  assert.equal(guideKeyAction(key("?", { target: slider }), false, false), "show", "a focused slider takes no text");
});

// ---------------------------------------------------------------------------------------------------------------------
// One-time nudges (lib/hints.ts).

test("a dismissed hint is recorded once and keeps the fields it does not know", () => {
  const store = new FakeStorage();
  // "guide" is a retired hint a visitor may still have stored: it must survive this version's writes.
  store.data.set(HINTS_KEY, JSON.stringify({ "future-hint": { seen: 3 }, guide: 500 }));
  assert.equal(readHintDismissed(store, "emote-keys"), false);
  assert.equal(writeHintDismissed(store, "emote-keys", 1000), true);
  assert.equal(writeHintDismissed(store, "emote-keys", 2000), true);
  assert.deepEqual(JSON.parse(store.data.get(HINTS_KEY)!), { "future-hint": { seen: 3 }, guide: 500, "emote-keys": 1000 });
  assert.equal(readHintDismissed(store, "emote-keys"), true);
  assert.equal(readHintDismissed(store, "pause-share"), false);
});

test("broken or missing storage never throws and never fakes a dismissal", () => {
  const store = new FakeStorage();
  store.data.set(HINTS_KEY, "{not json");
  assert.equal(readHintDismissed(store, "pause-share"), false);
  store.data.set(HINTS_KEY, "[1,2]");
  assert.equal(readHintDismissed(store, "pause-share"), false);
  store.failSet = true;
  assert.equal(writeHintDismissed(store, "pause-share"), false);
  store.failGet = true;
  assert.equal(readHintDismissed(store, "pause-share"), false);
  assert.equal(readHintDismissed(null, "pause-share"), false);
  assert.equal(writeHintDismissed(null, "pause-share"), false);
});

test("without working storage a dismissal still lasts for the page", () => {
  pageStorage.failGet = true;
  pageStorage.failSet = true;
  assert.equal(hintDismissed("pause-share"), false);
  dismissHint("pause-share");
  assert.equal(hintDismissed("pause-share"), true);
  pageStorage.failGet = false;
  pageStorage.failSet = false;
});

// ---------------------------------------------------------------------------------------------------------------------
// What this browser has found (lib/discovery.ts).

const { DISCOVERY_KEY, MARK_LIMIT, addStamp, readDiscovery, storedTour, updateDiscovery } = discovery;

test("a use is stored once per feature, keeps its first time, and keeps every field another version wrote", () => {
  const store = new FakeStorage();
  store.data.set(DISCOVERY_KEY, JSON.stringify({ used: { "future-control": 5, odd: "kept?" }, later: { x: 1 }, tour: { status: "done", extra: true } }));
  updateDiscovery(store, stored => addStamp(stored, "used", "capture", 1000));
  updateDiscovery(store, stored => addStamp(stored, "used", "capture", 2000));
  const stored = JSON.parse(store.data.get(DISCOVERY_KEY)!);
  assert.equal(stored.used.capture, 1000, "the first time wins, so two tabs merge to the same answer");
  assert.equal(stored.used["future-control"], 5);
  assert.equal(stored.used.odd, "kept?", "a value this version cannot read is still not dropped");
  assert.deepEqual(stored.later, { x: 1 });
  assert.deepEqual(stored.tour, { status: "done", extra: true });
});

test("broken storage reads as nothing found and refuses writes without throwing", () => {
  const store = new FakeStorage();
  store.data.set(DISCOVERY_KEY, "{oops");
  assert.deepEqual(readDiscovery(store), {});
  store.data.set(DISCOVERY_KEY, "[]");
  assert.deepEqual(readDiscovery(store), {});
  store.failSet = true;
  assert.equal(updateDiscovery(store, stored => addStamp(stored, "seen", "camera", 1)), false);
  store.failGet = true;
  assert.deepEqual(readDiscovery(store), {});
  assert.equal(updateDiscovery(null, () => {}), false);
});

test("the stored tour never starts by itself, and a stop this version does not know restarts it", () => {
  assert.deepEqual(storedTour({}), { status: "new", stop: null });
  assert.deepEqual(storedTour({ tour: { status: "running", stop: "camera" } }), { status: "paused", stop: "camera" },
    "a tour left running when the page closed comes back paused");
  assert.deepEqual(storedTour({ tour: { status: "paused", stop: "some-future-stop" } }), { status: "new", stop: null });
  assert.deepEqual(storedTour({ tour: { status: "done", stop: "camera" } }), { status: "done", stop: null });
  assert.deepEqual(storedTour({ tour: { status: "weird" } }), { status: "new", stop: null });
  assert.deepEqual(storedTour({ tour: "nonsense" }), { status: "new", stop: null });
});

test("a few red corners at a time, in tour order, each gone once seen or used", () => {
  pageStorage.data.clear();
  discovery.resetDiscoveryForTests();
  const first = [...discovery.markedFeatures()];
  assert.equal(first.length, MARK_LIMIT);
  const markable = [...TOUR, ...FEATURES.map(feature => feature.id)].filter(id => !featureById(id)?.noMark);
  assert.deepEqual(first, markable.slice(0, MARK_LIMIT));
  for (const id of first) assert.ok(!featureById(id)?.noMark, `${id} opts out of the corner`);
  discovery.markSeen(first[0]);
  discovery.markUsed(first[1]);
  const next = [...discovery.markedFeatures()];
  assert.ok(!next.includes(first[0]) && !next.includes(first[1]));
  assert.equal(next.length, MARK_LIMIT, "the next ones take their place");
  assert.ok(discovery.featureUsed(first[1]) && discovery.featureSeen(first[1]), "a use counts as seen");
  assert.ok(!discovery.featureUsed(first[0]), "seeing a callout is not using the control");
  const stored = JSON.parse(pageStorage.data.get(DISCOVERY_KEY)!);
  assert.ok(stored.seen[first[0]] && stored.used[first[1]]);
});

test("what this page found outlives refused storage until it closes", () => {
  pageStorage.data.clear();
  discovery.resetDiscoveryForTests();
  pageStorage.failSet = true;
  discovery.markUsed("graphics");
  assert.equal(discovery.featureUsed("graphics"), true);
  discovery.setTour({ status: "paused", stop: "share" });
  assert.deepEqual(discovery.tourState(), { status: "paused", stop: "share" });
  pageStorage.failSet = false;
  discovery.resetDiscoveryForTests();
  assert.equal(discovery.featureUsed("graphics"), false, "nothing reached storage");
});

test("the tour's place is stored and read back", () => {
  pageStorage.data.clear();
  discovery.resetDiscoveryForTests();
  discovery.setTour({ status: "running", stop: "lighting" });
  assert.deepEqual(storedTour(readDiscovery(pageStorage)), { status: "paused", stop: "lighting" },
    "on another page load it is a paused tour to resume");
  discovery.setTour({ status: "done", stop: null });
  assert.deepEqual(storedTour(readDiscovery(pageStorage)), { status: "done", stop: null });
});

// ---------------------------------------------------------------------------------------------------------------------
// Where callouts go (lib/discovery-layout.ts).

test("the nearest control within its radius is the one called; nested ties go to the smaller", () => {
  const button = { box: { left: 100, top: 100, width: 32, height: 32 }, radius: 28 };
  const quiet = { box: { left: 140, top: 100, width: 32, height: 32 }, radius: 0 };
  assert.equal(distanceToBox(116, 116, button.box), 0);
  assert.equal(distanceToBox(100, 160, button.box), 28);
  assert.equal(nearest(116, 150, [button, quiet]), button, "within 28 px of a control not yet used");
  assert.equal(nearest(116, 170, [button, quiet]), null, "too far");
  assert.equal(nearest(150, 140, [button, quiet]), button, "a used control waits for a direct hover");
  assert.equal(nearest(150, 110, [button, quiet]), quiet);
  const outer = { box: { left: 0, top: 0, width: 300, height: 100 }, radius: 0 };
  const inner = { box: { left: 10, top: 10, width: 40, height: 20 }, radius: 0 };
  assert.equal(nearest(20, 20, [outer, inner]), inner);
  assert.ok(isControlSized(button.box));
  assert.ok(!isControlSized({ left: 0, top: 0, width: 208, height: 440 }), "the slot rail is a region");
});

test("a callout goes on the first side that fits, slides inside the screen, and docks when nothing fits", () => {
  const viewport = { width: 1000, height: 800 };
  const topRight = { left: 940, top: 20, width: 32, height: 32 };
  const below = place(topRight, { width: 240, height: 60 }, viewport);
  assert.equal(below.side, "below");
  assert.equal(below.left + 240, 1000 - 12, "slid back inside the right edge");
  assert.ok(below.notch > 200, "the notch still points at the control");
  const bottom = place({ left: 400, top: 760, width: 100, height: 30 }, { width: 240, height: 60 }, viewport);
  assert.equal(bottom.side, "above");
  const column = place({ left: 900, top: 300, width: 90, height: 32 }, { width: 240, height: 60 }, viewport, { order: ["left", "below"] });
  assert.equal(column.side, "left");
  const phone = place({ left: 0, top: 100, width: 390, height: 500 }, { width: 366, height: 200 }, { width: 390, height: 844 });
  assert.equal(phone.side, "below");
  const huge = place({ left: 0, top: 50, width: 390, height: 744 }, { width: 366, height: 200 }, { width: 390, height: 844 });
  assert.ok(huge.side.startsWith("dock"), "no room beside a control that fills the screen");
});
