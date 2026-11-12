import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAWER_DEFAULT_OPEN, DRAWER_KEY, hideUiKeyAction, isDoubleTap, isTypingTarget, readDrawerOpen, writeDrawerOpen,
} from "../src/lib/viewer-chrome";

const element = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
const key = (k: string, target: EventTarget | null = element("CANVAS"), extra: Record<string, unknown> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target, ...extra });

test("H toggles the UI; Esc only brings it back", () => {
  assert.equal(hideUiKeyAction(key("h"), false), "toggle");
  assert.equal(hideUiKeyAction(key("H"), true), "toggle"); // Shift+H (or Caps Lock) too
  assert.equal(hideUiKeyAction(key("Escape"), true), "show");
  assert.equal(hideUiKeyAction(key("Escape"), false), null, "Esc with the UI showing is left to panels and full screen");
  assert.equal(hideUiKeyAction(key("g"), false), null);
});

test("H is ignored while typing, with a modifier, on repeat, during composition or once handled", () => {
  for (const target of [element("INPUT"), element("INPUT", { type: "search" }), element("TEXTAREA"), element("SELECT"),
    element("DIV", { isContentEditable: true })]) {
    assert.equal(hideUiKeyAction(key("h", target), false), null, (target as unknown as { tagName: string }).tagName);
  }
  // Esc from a field still brings a hidden UI back (nothing to type into while it is hidden anyway).
  assert.equal(hideUiKeyAction(key("Escape", element("INPUT")), true), "show");
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true },
    { defaultPrevented: true }]) assert.equal(hideUiKeyAction(key("h", element("BODY"), extra), false), null, JSON.stringify(extra));
});

test("non-text inputs do not swallow H", () => {
  for (const type of ["checkbox", "radio", "range", "button", "color"]) assert.equal(isTypingTarget(element("INPUT", { type })), false, type);
  for (const type of ["text", "search", "email", "number", "password"]) assert.equal(isTypingTarget(element("INPUT", { type })), true, type);
  assert.equal(isTypingTarget(element("BUTTON")), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({} as EventTarget), false, "a window or document target");
});

test("a double tap is two taps close in time and place", () => {
  const first = { x: 100, y: 100, t: 1000 };
  assert.equal(isDoubleTap(null, first), false);
  assert.equal(isDoubleTap(first, { x: 110, y: 105, t: 1300 }), true);
  assert.equal(isDoubleTap(first, { x: 110, y: 105, t: 1400 }), false, "too slow");
  assert.equal(isDoubleTap(first, { x: 160, y: 100, t: 1100 }), false, "too far apart");
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

test("drawer state: open by default, remembered, other fields kept", () => {
  const store = memoryStorage();
  assert.equal(readDrawerOpen(store), DRAWER_DEFAULT_OPEN);
  writeDrawerOpen(store, false);
  assert.equal(readDrawerOpen(store), false);
  store.setItem(DRAWER_KEY, JSON.stringify({ open: false, width: 640, future: { a: 1 } }));
  writeDrawerOpen(store, true);
  assert.deepEqual(JSON.parse(store.data.get(DRAWER_KEY)!), { open: true, width: 640, future: { a: 1 } });
});

test("drawer state: garbage, a wrong type and blocked storage fall back to the default", () => {
  assert.equal(readDrawerOpen(memoryStorage({ [DRAWER_KEY]: "{not json" })), DRAWER_DEFAULT_OPEN);
  assert.equal(readDrawerOpen(memoryStorage({ [DRAWER_KEY]: JSON.stringify({ open: "no" }) })), DRAWER_DEFAULT_OPEN);
  assert.equal(readDrawerOpen(memoryStorage({ [DRAWER_KEY]: "[1,2]" })), DRAWER_DEFAULT_OPEN);
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(readDrawerOpen(blocked), DRAWER_DEFAULT_OPEN);
  assert.doesNotThrow(() => writeDrawerOpen(blocked, false));
  assert.equal(readDrawerOpen(null), DRAWER_DEFAULT_OPEN);
  // A garbled stored value is replaced by a clean object, not merged into.
  const store = memoryStorage({ [DRAWER_KEY]: "\"string\"" });
  writeDrawerOpen(store, false);
  assert.deepEqual(JSON.parse(store.data.get(DRAWER_KEY)!), { open: false });
});
