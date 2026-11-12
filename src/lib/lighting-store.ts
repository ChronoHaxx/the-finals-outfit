import { create } from "zustand";
import { AUTOMATED } from "./automation";
import { DEFAULT_LIGHTING, sameLighting, sanitizeLighting, type LightingSettings, type SceneTheme } from "./stage-lighting";

/**
 * The viewer's lighting and backdrop choices (stage-lighting.ts), remembered in this browser.
 *
 * Storage rules (the user's "never lose the user's work"):
 * - every change is written at once; nothing waits for a Save;
 * - one key holds the current settings, the look a Reset or a look replaced (`previous`, so Undo survives a reload)
 *   and the saved looks; every write reads the stored object again, changes only its own fields and writes it back,
 *   so fields another version or another tab wrote survive, and two tabs saving looks do not drop each other's;
 * - saved looks are separate items with their own id and time; saving never replaces one, and past MAX_LOOKS saving is
 *   refused rather than evicting the oldest; deleting is a deliberate two-step action in the panel;
 * - a stored field that no longer makes sense (a backdrop later removed) falls back on its own; the rest of the look
 *   still applies.
 * Storage can be missing or blocked: every access is guarded and the choice simply is not remembered.
 * Automated browsers (audits, visual diffs) never read it: they always render DEFAULT_LIGHTING.
 */
export const LIGHTING_KEY = "finals-outfit.lighting";
/** PR #37's Sun slider kept its angle here; read when the new key has no azimuth yet. */
export const LEGACY_SUN_KEY = "finals-outfit.sun";
export const MAX_LOOKS = 12;

export interface SavedLook { id: string; name: string; savedAt: number; settings: LightingSettings }

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

/** Settings written over what is stored, keeping any field this version does not know. */
function merged(stored: unknown, settings: LightingSettings): Record<string, unknown> {
  const base = isObject(stored) ? stored : {};
  return { ...base, ...settings, backdrop: { ...(isObject(base.backdrop) ? base.backdrop : {}), ...settings.backdrop } };
}

export function currentFrom(stored: Stored, store: StorageLike | null): LightingSettings {
  const current = isObject(stored.current) ? { ...stored.current } : {};
  if (current.sunAzimuth === undefined) {
    try {
      const legacy = store?.getItem(LEGACY_SUN_KEY);
      if (legacy !== null && legacy !== undefined) current.sunAzimuth = Number(legacy);
    } catch { /* none */ }
  }
  return sanitizeLighting(current);
}

export function looksFrom(stored: Stored): SavedLook[] {
  if (!Array.isArray(stored.looks)) return [];
  return stored.looks.flatMap((look): SavedLook[] => isObject(look) && typeof look.id === "string" ? [{
    id: look.id,
    name: typeof look.name === "string" && look.name.trim() ? look.name : "Saved look",
    savedAt: typeof look.savedAt === "number" ? look.savedAt : 0,
    settings: sanitizeLighting(look.settings),
  }] : []);
}

const previousFrom = (stored: Stored) => isObject(stored.previous) ? sanitizeLighting(stored.previous) : null;

/** The next free "Look N" name. */
export function nextLookName(looks: readonly SavedLook[]): string {
  const taken = looks.map(look => /^Look (\d+)$/.exec(look.name)?.[1]).filter(Boolean).map(Number);
  return `Look ${Math.max(looks.length, ...taken) + 1}`;
}

interface LightingStore {
  settings: LightingSettings;
  /** What Reset or the last applied look replaced, for Undo; null when there is nothing to undo. */
  previous: LightingSettings | null;
  looks: SavedLook[];
  /** Change some settings (a slider, a toggle). */
  change(patch: Partial<LightingSettings>): void;
  setBackdrop(theme: SceneTheme, id: string): void;
  /** Replace the settings with a look (or the defaults), keeping the old ones for Undo. */
  apply(next: LightingSettings): void;
  reset(): void;
  undo(): void;
  /** Save the current settings as a new look. False when MAX_LOOKS are already saved (nothing is replaced). */
  saveLook(): boolean;
  deleteLook(id: string): void;
  /** Re-read storage (another tab changed it). */
  refresh(): void;
}

function initial(): Pick<LightingStore, "settings" | "previous" | "looks"> {
  if (AUTOMATED) return { settings: DEFAULT_LIGHTING, previous: null, looks: [] };
  const store = storage(), stored = readStored(store);
  return { settings: currentFrom(stored, store), previous: previousFrom(stored), looks: looksFrom(stored) };
}

export const useLightingStore = create<LightingStore>((set, get) => {
  const commit = (settings: LightingSettings, previous: LightingSettings | null | undefined) => {
    const written = writeStored(storage(), stored => {
      stored.current = merged(stored.current, settings);
      if (previous === null) delete stored.previous;
      else if (previous) stored.previous = merged(stored.previous, previous);
    });
    set({ settings, ...(previous !== undefined ? { previous } : {}), looks: looksFrom(written) });
  };
  return {
    ...initial(),
    change: patch => commit({ ...get().settings, ...patch }, undefined),
    setBackdrop: (theme, id) => {
      const settings = get().settings;
      commit({ ...settings, backdrop: { ...settings.backdrop, [theme]: id } }, undefined);
    },
    apply: next => {
      const current = get().settings;
      if (sameLighting(current, next)) return;
      commit(next, current);
    },
    reset: () => get().apply(DEFAULT_LIGHTING),
    undo: () => {
      const previous = get().previous;
      if (previous) commit(previous, null);
    },
    saveLook: () => {
      let saved = false;
      const written = writeStored(storage(), stored => {
        const looks = Array.isArray(stored.looks) ? stored.looks : [];
        if (looksFrom({ looks }).length >= MAX_LOOKS) return;
        looks.push({ id: `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: nextLookName(looksFrom({ looks })), savedAt: Date.now(), settings: { ...get().settings } });
        stored.looks = looks;
        saved = true;
      });
      set({ looks: looksFrom(written) });
      return saved;
    },
    deleteLook: id => {
      const written = writeStored(storage(), stored => {
        if (Array.isArray(stored.looks)) stored.looks = stored.looks.filter(look => !(isObject(look) && look.id === id));
      });
      set({ looks: looksFrom(written) });
    },
    refresh: () => { if (!AUTOMATED) set(initial()); },
  };
});

if (typeof window !== "undefined" && !AUTOMATED) {
  window.addEventListener("storage", event => {
    if (event.key === LIGHTING_KEY || event.key === null) useLightingStore.getState().refresh();
  });
}
