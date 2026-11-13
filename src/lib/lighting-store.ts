import { create } from "zustand";
import { AUTOMATED } from "./automation";
import { DEFAULT_LOOK, sameLook, sanitizeLook, studioLook, rotated, KEY_POSITION, type Look } from "./stage-lighting";

/**
 * The viewer's look (stage-lighting.ts), remembered in this browser.
 *
 * Storage rules (the user's "never lose the user's work"):
 * - every change is kept: at once for a click, and within WRITE_DELAY_MS for a slider or colour-picker drag (which fires
 *   on every move), flushed when the page is hidden or closed;
 * - one key holds the current look, the look a Reset or an applied look replaced (`previous`, so Undo survives a
 *   reload) and the saved looks; every write reads the stored object again and changes only its own fields, lights
 *   are merged by id, so fields another version or another tab wrote survive, and two tabs saving looks do not drop
 *   each other's;
 * - saved looks are separate items with their own id and time; saving never replaces one, and past MAX_LOOKS saving is
 *   refused rather than evicting the oldest; deleting is a deliberate two-step action in the panel;
 * - a stored field that no longer makes sense falls back on its own; the rest of the look still applies. PR #40's
 *   first settings and PR #37's Sun angle are converted.
 * Storage can be missing or blocked: every access is guarded and the choice simply is not remembered.
 * Automated browsers (audits, visual diffs) never read it: they always render DEFAULT_LOOK.
 */
export const LIGHTING_KEY = "finals-outfit.lighting";
/** PR #37's Sun slider kept its angle here (degrees round from the reviewed key); read when nothing newer is stored. */
export const LEGACY_SUN_KEY = "finals-outfit.sun";
export const MAX_LOOKS = 12;
export const WRITE_DELAY_MS = 300;

export interface SavedLook { id: string; name: string; savedAt: number; look: Look }

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Stored = Record<string, unknown>;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function storage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readStored(store: StorageLike | null): Stored {
  try {
    const parsed = JSON.parse(store?.getItem(LIGHTING_KEY) ?? "{}");
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Read the stored object, let `change` edit it in place, write it back. Returns what was written (or would have been). */
export function writeStored(store: StorageLike | null, change: (stored: Stored) => void): Stored {
  const stored = readStored(store);
  change(stored);
  try { store?.setItem(LIGHTING_KEY, JSON.stringify(stored)); } catch { /* not remembered */ }
  return stored;
}

/** A look written over what is stored: fields this version does not know are kept, at the top level, in the hemisphere,
 *  environment and backdrop, and in each light (matched by id). A light the viewer removed is removed. */
export function mergedLook(stored: unknown, look: Look): Record<string, unknown> {
  const base = isObject(stored) ? stored : {};
  const part = (key: string, value: object) => ({ ...(isObject(base[key]) ? base[key] as object : {}), ...value });
  const storedLights = Array.isArray(base.lights) ? base.lights.filter(isObject) : [];
  // A first-version setting stored here: its fields do not belong to a look; start from a clean object.
  const top = Array.isArray(base.lights) ? base : {};
  return {
    ...top, ...look,
    hemisphere: part("hemisphere", look.hemisphere),
    environment: part("environment", look.environment),
    backdrop: part("backdrop", look.backdrop),
    lights: look.lights.map(l => ({ ...(storedLights.find(s => s.id === l.id) ?? {}), ...l })),
  };
}

export function currentFrom(stored: Stored, store: StorageLike | null): Look {
  if (isObject(stored.current)) return sanitizeLook(stored.current);
  try {
    const legacy = Number(store?.getItem(LEGACY_SUN_KEY) ?? NaN);
    if (Number.isFinite(legacy) && legacy !== 0 && Math.abs(legacy) <= 180) {
      const look = studioLook();
      look.lights[0] = { ...look.lights[0], position: rotated(KEY_POSITION, Math.round(legacy)) };
      return look;
    }
  } catch { /* none */ }
  return sanitizeLook(undefined);
}

export function looksFrom(stored: Stored): SavedLook[] {
  if (!Array.isArray(stored.looks)) return [];
  return stored.looks.flatMap((entry): SavedLook[] => isObject(entry) && typeof entry.id === "string" ? [{
    id: entry.id,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name : "Saved look",
    savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0,
    // `look` since 12 Nov; PR #40's first version kept `settings`.
    look: sanitizeLook(entry.look ?? entry.settings),
  }] : []);
}

const previousFrom = (stored: Stored) => isObject(stored.previous) ? sanitizeLook(stored.previous) : null;

/** The next free "Look N" name. */
export function nextLookName(looks: readonly SavedLook[]): string {
  const taken = looks.map(look => /^Look (\d+)$/.exec(look.name)?.[1]).filter(Boolean).map(Number);
  return `Look ${Math.max(looks.length, ...taken) + 1}`;
}

interface LightingStore {
  look: Look;
  /** What Reset or the last applied look replaced, for Undo; null when there is nothing to undo. */
  previous: Look | null;
  looks: SavedLook[];
  /** Change the look (a slider, a picker, a toggle): kept within WRITE_DELAY_MS. */
  edit(change: (look: Look) => Look): void;
  /** Replace the look (a ready-made or saved look, a sun look), keeping the old one for Undo. */
  apply(next: Look): void;
  reset(): void;
  undo(): void;
  /** Save the current look as a new one. False when MAX_LOOKS are already saved (nothing is replaced). */
  saveLook(): boolean;
  deleteLook(id: string): void;
  /** Write a pending change now (page hidden or closing). */
  flush(): void;
  /** Re-read storage (another tab changed it). */
  refresh(): void;
}

function initial(): Pick<LightingStore, "look" | "previous" | "looks"> {
  if (AUTOMATED) return { look: sanitizeLook(DEFAULT_LOOK), previous: null, looks: [] };
  const store = storage(), stored = readStored(store);
  return { look: currentFrom(stored, store), previous: previousFrom(stored), looks: looksFrom(stored) };
}

export const useLightingStore = create<LightingStore>((set, get) => {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const writeCurrent = (previous?: Look | null) => {
    if (pending) { clearTimeout(pending); pending = null; }
    const written = writeStored(storage(), stored => {
      stored.version = 2;
      stored.current = mergedLook(stored.current, get().look);
      if (previous === null) delete stored.previous;
      else if (previous) stored.previous = mergedLook(stored.previous, previous);
    });
    set({ looks: looksFrom(written) });
  };
  return {
    ...initial(),
    edit: change => {
      set({ look: change(structuredClone(get().look)) });
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => writeCurrent(), WRITE_DELAY_MS);
    },
    apply: next => {
      const current = get().look;
      if (sameLook(current, next)) return;
      set({ look: sanitizeLook(next), previous: current });
      writeCurrent(current);
    },
    reset: () => get().apply(sanitizeLook(DEFAULT_LOOK)),
    undo: () => {
      const previous = get().previous;
      if (!previous) return;
      set({ look: previous, previous: null });
      writeCurrent(null);
    },
    saveLook: () => {
      get().flush();
      let saved = false;
      const written = writeStored(storage(), stored => {
        const looks = Array.isArray(stored.looks) ? stored.looks : [];
        if (looksFrom({ looks }).length >= MAX_LOOKS) return;
        looks.push({ id: `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: nextLookName(looksFrom({ looks })), savedAt: Date.now(), look: structuredClone(get().look) });
        stored.looks = looks;
        saved = true;
      });
      set({ looks: looksFrom(written) });
      return saved;
    },
    deleteLook: id => {
      const written = writeStored(storage(), stored => {
        if (Array.isArray(stored.looks)) stored.looks = stored.looks.filter(entry => !(isObject(entry) && entry.id === id));
      });
      set({ looks: looksFrom(written) });
    },
    flush: () => { if (pending) writeCurrent(); },
    refresh: () => { if (!AUTOMATED) { get().flush(); set(initial()); } },
  };
});

if (typeof window !== "undefined" && !AUTOMATED) {
  window.addEventListener("storage", event => {
    if (event.key === LIGHTING_KEY || event.key === null) useLightingStore.getState().refresh();
  });
  window.addEventListener("pagehide", () => useLightingStore.getState().flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") useLightingStore.getState().flush();
  });
}
