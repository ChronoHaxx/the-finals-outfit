import { test } from "node:test";
import assert from "node:assert/strict";

// The "What you can do" guide and its one-time hints (21 Nov 2026). The guide is public text, so it must pass the same
// rules as the roadmap and the patch notes; the hints must survive every way browser storage fails, and never come
// back once dismissed.

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

const { FEATURE_GUIDE, POINTER_SHORTCUTS, TOUCH_SHORTCUTS, featureGuideStrings } = await import("../src/data/feature-guide");
const { lintPublicText } = await import("../src/lib/public-text");
const { HINTS_KEY, dismissHint, hintDismissed, readHintDismissed, writeHintDismissed } = await import("../src/lib/hints");
const { guideKeyAction } = await import("../src/components/FeatureGuide");

test("every guide string passes the public-text rules", () => {
  const strings = featureGuideStrings();
  assert.ok(strings.length > 40, "the check sees the whole guide");
  const problems = strings.flatMap(({ text, where }) => lintPublicText(text, where));
  assert.deepEqual(problems, []);
});

test("section and item ids are unique, and every item says something", () => {
  const sections = FEATURE_GUIDE.map(section => section.id);
  assert.equal(new Set(sections).size, sections.length);
  const items = FEATURE_GUIDE.flatMap(section => section.items.map(item => item.id));
  assert.equal(new Set(items).size, items.length);
  for (const section of FEATURE_GUIDE) for (const item of section.items) assert.ok(item.title && item.text.length > 20, item.id);
});

test("the guide never says a share link carries the lighting", () => {
  // Share links hold the outfit, the body type and optionally the emote frame; lighting stays in the browser
  // (src/lib/share-url.ts). A visitor told otherwise would share a look nobody else sees.
  const share = FEATURE_GUIDE.find(section => section.id === "share")!;
  const text = share.items.map(item => item.text).join(" ");
  assert.match(text, /Lighting is not part of the link/);
});

test("the shortcut lists name the keys the builder handles", () => {
  const keys = POINTER_SHORTCUTS.flatMap(shortcut => shortcut.keys);
  for (const key of ["H", "Esc", ",", ".", "?"]) assert.ok(keys.includes(key), key);
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

test("a dismissed hint is recorded once and keeps the fields it does not know", () => {
  const store = new FakeStorage();
  store.data.set(HINTS_KEY, JSON.stringify({ "future-hint": { seen: 3 } }));
  assert.equal(readHintDismissed(store, "guide"), false);
  assert.equal(writeHintDismissed(store, "guide", 1000), true);
  assert.equal(writeHintDismissed(store, "guide", 2000), true);
  assert.deepEqual(JSON.parse(store.data.get(HINTS_KEY)!), { "future-hint": { seen: 3 }, guide: 1000 });
  assert.equal(readHintDismissed(store, "guide"), true);
  assert.equal(readHintDismissed(store, "pause-share"), false);
});

test("broken or missing storage never throws and never fakes a dismissal", () => {
  const store = new FakeStorage();
  store.data.set(HINTS_KEY, "{not json");
  assert.equal(readHintDismissed(store, "guide"), false);
  store.data.set(HINTS_KEY, "[1,2]");
  assert.equal(readHintDismissed(store, "guide"), false);
  store.failSet = true;
  assert.equal(writeHintDismissed(store, "guide"), false);
  store.failGet = true;
  assert.equal(readHintDismissed(store, "guide"), false);
  assert.equal(readHintDismissed(null, "guide"), false);
  assert.equal(writeHintDismissed(null, "guide"), false);
});

test("without working storage a dismissal still lasts for the page", () => {
  pageStorage.failGet = true;
  pageStorage.failSet = true;
  assert.equal(hintDismissed("pause-share"), false);
  dismissHint("pause-share");
  assert.equal(hintDismissed("pause-share"), true);
  pageStorage.failGet = false;
  pageStorage.failSet = false;
  dismissHint("guide");
  assert.equal(readHintDismissed(pageStorage, "guide"), true, "with storage back, it is written through");
});
