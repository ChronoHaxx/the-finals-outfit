import { useCallback, useSyncExternalStore } from "react";
import { AUTOMATED } from "./automation";

// One-time hints (21 Nov 2026): a small tip that points at a feature once, at the moment it is useful, and never again
// in this browser once it is dismissed. There are deliberately few of them. Since 22 Nov they are the discovery layer's
// nudges (components/Discovery.tsx; their words are NUDGES in src/data/feature-guide.ts); this file only remembers which
// ones a visitor has had.
//
// One key, read-modify-write, so a hint another version of the site knows about keeps its record. Storage can be
// missing, full or throw (private windows, blocked site data): then a dismissal lasts until the page closes, and a
// hint is never allowed to break or block the viewer. Automated browsers never see hints, so captures stay clean.

export const HINTS_KEY = "finals-outfit.hints";

/** The hints there are. A new hint gets a new id; never reuse one, or visitors who dismissed the old one miss it.
 *  Retired: "guide" (21 Nov, a tip under the Guide button; the welcome screen's tour button replaced it). */
export type HintId = "pause-share" | "emote-keys";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function readStored(store: StorageLike | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(store?.getItem(HINTS_KEY) ?? "{}");
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Dismissed in storage: any recorded value counts, so a later version may store something richer than a time. */
export function readHintDismissed(store: StorageLike | null, id: HintId): boolean {
  return readStored(store)[id] !== undefined;
}

/** Records the dismissal (when, in ms), keeping every other field. False when storage refused it. */
export function writeHintDismissed(store: StorageLike | null, id: HintId, now = Date.now()): boolean {
  if (!store) return false;
  const stored = readStored(store);
  if (stored[id] !== undefined) return true;
  stored[id] = now;
  try { store.setItem(HINTS_KEY, JSON.stringify(stored)); return true; } catch { return false; }
}

// Dismissals this page has made, so a hint stays gone without storage, and every component showing it agrees.
const dismissedHere = new Set<HintId>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

// Another tab dismissed one (or cleared site data): follow it.
function onStorage(event: StorageEvent) { if (event.key === HINTS_KEY || event.key === null) notify(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function hintDismissed(id: HintId): boolean {
  return AUTOMATED || dismissedHere.has(id) || readHintDismissed(browserStorage(), id);
}

export function dismissHint(id: HintId): void {
  if (AUTOMATED) return;
  dismissedHere.add(id);
  writeHintDismissed(browserStorage(), id);
  notify();
}

/** Whether the hint may still be shown here, and the call that retires it for good in this browser. */
export function useHint(id: HintId): [pending: boolean, dismiss: () => void] {
  const dismissed = useSyncExternalStore(subscribe, () => hintDismissed(id), () => true);
  const dismiss = useCallback(() => dismissHint(id), [id]);
  return [!dismissed, dismiss];
}
