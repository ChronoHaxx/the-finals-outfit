import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AUTOMATED } from "./automation";

// The builder's chrome around the 3D stage (12 Nov 2026, community feedback): the stage takes the whole window and the
// item picker is a drawer beside it (or a sheet under it on a phone), and H hides every control for a clean look.
//
// Nothing here touches the outfit: these are view states only. The drawer and every hidden control stay mounted, so the
// picker keeps its slot, search, filters and scroll position however often they are toggled.

// ---------------------------------------------------------------------------------------------------------------------
// Layout: a drawer at the side, or a sheet at the bottom.

/** Side drawer from Tailwind's lg up, and on a phone held sideways (a sheet would leave a sliver of stage). */
export const SIDE_LAYOUT_QUERY = "(min-width: 64rem), (orientation: landscape) and (max-height: 33.75rem)";
export type ChromeLayout = "side" | "sheet";

export function useChromeLayout(): ChromeLayout {
  const side = useSyncExternalStore(
    listener => {
      const query = window.matchMedia(SIDE_LAYOUT_QUERY);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(SIDE_LAYOUT_QUERY).matches,
    () => true,
  );
  return side ? "side" : "sheet";
}

// ---------------------------------------------------------------------------------------------------------------------
// The drawer's open state, remembered in this browser.
//
// One key, read-modify-write: fields another version writes survive. Storage can be missing or blocked; then the
// choice is simply not remembered. Automated browsers (audits, visual diffs) never read it: they always get the
// default layout, so their canvas box is the one they were written against.

export const DRAWER_KEY = "finals-outfit.drawer";
/** Open on a first visit: the picker is how anything gets equipped. */
export const DRAWER_DEFAULT_OPEN = true;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function readStored(store: StorageLike | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(store?.getItem(DRAWER_KEY) ?? "{}");
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

export function readDrawerOpen(store: StorageLike | null): boolean {
  const open = readStored(store).open;
  return typeof open === "boolean" ? open : DRAWER_DEFAULT_OPEN;
}

export function writeDrawerOpen(store: StorageLike | null, open: boolean): void {
  const stored = readStored(store);
  stored.open = open;
  try { store?.setItem(DRAWER_KEY, JSON.stringify(stored)); } catch { /* not remembered */ }
}

export function useDrawerOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => AUTOMATED ? DRAWER_DEFAULT_OPEN : readDrawerOpen(browserStorage()));
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!AUTOMATED) writeDrawerOpen(browserStorage(), next);
  }, []);
  // Another tab toggled it: follow, so the two do not fight over the stored value on their next toggle.
  useEffect(() => {
    if (AUTOMATED) return;
    const changed = (event: StorageEvent) => { if (event.key === DRAWER_KEY) setOpenState(readDrawerOpen(browserStorage())); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return [open, setOpen];
}

// ---------------------------------------------------------------------------------------------------------------------
// Hide the UI (H).

interface KeyLike {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean;
  isComposing?: boolean; target: EventTarget | null;
}

// Inputs whose keys are not text: H on a focused checkbox or slider still means "hide".
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"]);

/** Whether a key typed here belongs to the field: text inputs, text areas, editable content, and selects (typeahead). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (Partial<HTMLElement> & { tagName?: string; type?: string }) | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return !NON_TEXT_INPUTS.has((element.type ?? "text").toLowerCase());
  return element.isContentEditable === true;
}

/** What a key press does: H toggles (never while typing, with a modifier or on auto-repeat), Esc only brings the UI back. */
export function hideUiKeyAction(event: KeyLike, hidden: boolean): "toggle" | "show" | null {
  if (event.isComposing || event.defaultPrevented) return null;
  if (event.key === "Escape") return hidden ? "show" : null;
  if (event.key !== "h" && event.key !== "H") return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  return isTypingTarget(event.target) ? null : "toggle";
}

/** Two taps or clicks close together in time and place: the touch way back from a hidden UI (there is no H key). */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 30;
export function isDoubleTap(previous: { x: number; y: number; t: number } | null, next: { x: number; y: number; t: number }): boolean {
  return !!previous && next.t - previous.t <= DOUBLE_TAP_MS && Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_PX;
}

/** A tap is a press that barely moved: a drag that orbits the camera must never count towards a double tap. */
const TAP_SLOP_PX = 8;
export const HINT_MS = 2600;

export interface HideUi {
  hidden: boolean;
  /** The "Press H to show UI" hint is showing (for HINT_MS after hiding). */
  hint: boolean;
  hide(): void;
  show(): void;
  toggle(): void;
}

/**
 * H hides every control and the mouse cursor, leaving only the character; H again, Esc or a double tap brings them
 * back. Keys typed into a field, and any key while a modal dialog is open, are left alone. While hidden, the page's
 * root gets `ui-hidden` (index.css hides the cursor everywhere). Focus returns to where it was when the UI comes back.
 * Never persisted: a reload always shows the UI.
 */
export function useHideUi(): HideUi {
  const [hidden, setHidden] = useState(false);
  const [hint, setHint] = useState(false);
  const focusBefore = useRef<Element | null>(null);

  const hide = useCallback(() => {
    focusBefore.current = document.activeElement;
    setHidden(true);
    setHint(true);
  }, []);
  const show = useCallback(() => setHidden(false), []);
  const toggle = useCallback(() => (hidden ? show() : hide()), [hidden, hide, show]);

  useEffect(() => {
    // Capture on window: runs before the full-screen mode's own Esc handler (on the document), which then sees the
    // event handled and stays in full screen. Only one layer goes per Esc press.
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const action = hideUiKeyAction(event, hidden);
      if (!action) return;
      event.preventDefault();
      if (action === "show") show(); else toggle();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hidden, show, toggle]);

  useEffect(() => {
    if (!hidden) return;
    const root = document.documentElement;
    root.classList.add("ui-hidden");
    let down: { x: number; y: number } | null = null;
    let lastTap: { x: number; y: number; t: number } | null = null;
    const onDown = (event: PointerEvent) => { if (event.isPrimary) down = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!event.isPrimary || !down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > TAP_SLOP_PX) { lastTap = null; return; }
      const tap = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      if (isDoubleTap(lastTap, tap)) show();
      else lastTap = tap;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      root.classList.remove("ui-hidden");
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [hidden, show]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // Back: put focus where it was (a control that hid with the UI), if it is still on the page.
  useEffect(() => {
    if (hidden) return;
    setHint(false);
    const before = focusBefore.current as HTMLElement | null;
    focusBefore.current = null;
    if (before?.isConnected && typeof before.focus === "function") before.focus({ preventScroll: true });
  }, [hidden]);

  return { hidden, hint, hide, show, toggle };
}
