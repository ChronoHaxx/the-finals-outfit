import { create } from "zustand";
import { AUTOMATED } from "./automation";
import { DEFAULT_LOOK, sameLook, sanitizeLook, studioLook, rotated, KEY_POSITION, type Look } from "./stage-lighting";
import { lightingCode, type LightingRead } from "./share-lighting";

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
 *
 * Beside the look, the same key keeps one viewer preference (21 Nov 2026): `markers`, whether the lights are shown in the
 * 3D view (LightMarkers.tsx). It is not part of any look, so saving, sharing or applying a look never carries it, and the
 * markers never reach a screenshot, share image or export whatever it says. Which light is selected is not stored.
 *
 * Shared looks (22 Nov 2026): a share link can carry its sender's look (share-lighting.ts). Opening one shows that look
 * in place of the viewer's own without writing anything: `look` is what is drawn, `shared.own` the viewer's own look,
 * and storage only ever receives the viewer's own (writeCurrent). The viewer keeps it (it becomes their look, and a new
 * saved look; their look before stays one Undo away) or goes back to theirs. Changing the shared look in the panel or by
 * dragging a light keeps it the same way, without the saved look: an edit is the viewer's work and is written at once.
 * Picking another look leaves the shared one and applies over the viewer's own, so Undo still returns to theirs.
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

/** Optional backdrop fields this version knows: absent from a look means "none", so a write removes them. Without this,
 *  leaving a scene (a ready-made look, a colour) kept `scene` in storage and the scene came back on the next reload
 *  (21 Nov 2026). Fields this version does not know are still kept, for the newer build that wrote them. */
const OPTIONAL_BACKDROP_FIELDS = ["scene"] as const;
/** Likewise a newer build's link additions (stage-lighting.ts `linkExtras`), on the look and on each light: a look that
 *  has none must not inherit the stored look's. */
const OPTIONAL_LINK_FIELDS = ["linkExtras"] as const;
function withoutDropped(merged: Record<string, unknown>, written: object, fields: readonly string[]): Record<string, unknown> {
  for (const field of fields) if (!(field in written)) delete merged[field];
  return merged;
}

/** A look written over what is stored: fields this version does not know are kept, at the top level, in the hemisphere,
 *  environment and backdrop, and in each light (matched by id). A light the viewer removed is removed. */
export function mergedLook(stored: unknown, look: Look): Record<string, unknown> {
  const base = isObject(stored) ? stored : {};
  const part = (key: string, value: object) => ({ ...(isObject(base[key]) ? base[key] as object : {}), ...value });
  const storedLights = Array.isArray(base.lights) ? base.lights.filter(isObject) : [];
  // A first-version setting stored here: its fields do not belong to a look; start from a clean object.
  const top = Array.isArray(base.lights) ? base : {};
  return withoutDropped({
    ...top, ...look,
    hemisphere: part("hemisphere", look.hemisphere),
    environment: part("environment", look.environment),
    backdrop: withoutDropped(part("backdrop", look.backdrop), look.backdrop, OPTIONAL_BACKDROP_FIELDS),
    lights: look.lights.map(l => withoutDropped({ ...(storedLights.find(s => s.id === l.id) ?? {}), ...l }, l, OPTIONAL_LINK_FIELDS)),
  }, look, OPTIONAL_LINK_FIELDS);
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

/** "Shared look", then "Shared look 2", 3...: the first name no saved look has. */
export function sharedLookName(looks: readonly SavedLook[]): string {
  const taken = new Set(looks.map(look => look.name));
  let n = 1;
  while (taken.has(n === 1 ? "Shared look" : `Shared look ${n}`)) n++;
  return n === 1 ? "Shared look" : `Shared look ${n}`;
}

/** What became of a link's lighting, for the notice that says so (cleared when dismissed). */
export type SharedOutcome =
  /** Kept: it is the viewer's look now. `savedAs` names the saved look holding it (new, or one that already did);
   *  null when the saved looks were full. */
  | { kind: "kept"; savedAs: string | null; added: boolean }
  /** The link's lighting cannot be shown by this build (a newer look or format, or a broken value): theirs stays. */
  | { kind: "unavailable" };

/** The next free "Look N" name. */
export function nextLookName(looks: readonly SavedLook[]): string {
  const taken = looks.map(look => /^Look (\d+)$/.exec(look.name)?.[1]).filter(Boolean).map(Number);
  return `Look ${Math.max(looks.length, ...taken) + 1}`;
}

interface LightingStore {
  look: Look;
  /** Whether the lights are shown in the 3D view (bulbs and cones that can be dragged). Starts off in automated browsers. */
  markers: boolean;
  /** The light last picked in the 3D view (its card opens in the panel); null when none. Not stored. */
  selected: string | null;
  setMarkers(on: boolean): void;
  select(id: string | null): void;
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
  /**
   * A look from a share link, shown while the viewer's own waits (null when none). `code` is its lt value, `label` the
   * ready-made look's name when the link named one.
   */
  shared: { own: Look; code: string; label: string | null } | null;
  /** What became of the last link's lighting; the notice shows it until dismissed. */
  sharedOutcome: SharedOutcome | null;
  /** Show a link's look in place of the viewer's own, writing nothing. A look the viewer already has changes nothing. */
  showShared(look: Look, label?: string | null): void;
  /** The shared look becomes the viewer's own (Undo returns to theirs) and is added to the saved looks when there is room
   *  and no saved look holds it already. */
  keepShared(): void;
  /** Back to the viewer's own look. Nothing was written, so nothing changes. */
  leaveShared(): void;
  dismissSharedOutcome(): void;
  /** A take's render (22 Nov 2026, rig/VideoExport.ts renderTake): the lights, environment and exposure drawn instead of
   *  the look's while it renders, as they were when the take was recorded; null otherwise. Never stored: storage only
   *  ever receives the viewer's own look (writeCurrent), and the backdrop on screen stays theirs. */
  takeLook: Look | null;
  showTakeLook(look: Look | null): void;
  /** Write a pending change now (page hidden or closing). */
  flush(): void;
  /** Re-read storage (another tab changed it). */
  refresh(): void;
}

function initial(): Pick<LightingStore, "look" | "previous" | "looks" | "markers"> {
  if (AUTOMATED) return { look: sanitizeLook(DEFAULT_LOOK), previous: null, looks: [], markers: false };
  const store = storage(), stored = readStored(store);
  return { look: currentFrom(stored, store), previous: previousFrom(stored), looks: looksFrom(stored), markers: stored.markers === true };
}

export const useLightingStore = create<LightingStore>((set, get) => {
  let pending: ReturnType<typeof setTimeout> | null = null;
  /** The viewer's own look: the one on screen, unless a shared look stands in for it. */
  const own = () => get().shared?.own ?? get().look;
  const writeCurrent = (previous?: Look | null) => {
    if (pending) { clearTimeout(pending); pending = null; }
    const written = writeStored(storage(), stored => {
      stored.version = 2;
      // Never the shared look: it reaches storage only once the viewer keeps or changes it (shared is null by then).
      stored.current = mergedLook(stored.current, own());
      if (previous === null) delete stored.previous;
      else if (previous) stored.previous = mergedLook(stored.previous, previous);
    });
    set({ looks: looksFrom(written) });
  };
  return {
    ...initial(),
    selected: null,
    shared: null,
    sharedOutcome: null,
    takeLook: null,
    showTakeLook: look => { if (get().takeLook !== look) set({ takeLook: look }); },
    setMarkers: on => {
      set({ markers: on, ...(on ? {} : { selected: null }) });
      // Automated browsers start with the markers off and never store the choice (they never read it either).
      if (!AUTOMATED) writeStored(storage(), stored => { stored.markers = on; });
    },
    select: id => set({ selected: id }),
    edit: change => {
      const { shared } = get();
      if (shared) {
        // Changing the shared look makes it the viewer's: written at once, their own look kept for Undo.
        set({ look: change(structuredClone(get().look)), previous: shared.own, shared: null, sharedOutcome: null });
        writeCurrent(shared.own);
        return;
      }
      set({ look: change(structuredClone(get().look)) });
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => writeCurrent(), WRITE_DELAY_MS);
    },
    apply: next => {
      // Over the viewer's own look: picking a look leaves a shared one, and Undo returns to theirs.
      const current = own();
      if (get().shared) set({ look: current, shared: null, sharedOutcome: null });
      if (sameLook(current, next)) return;
      set({ look: sanitizeLook(next), previous: current });
      writeCurrent(current);
    },
    reset: () => get().apply(sanitizeLook(DEFAULT_LOOK)),
    undo: () => {
      // While a shared look shows, the viewer's own history is not on screen: Undo first returns to their look.
      if (get().shared) { get().leaveShared(); return; }
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
    showShared: (next, label = null) => {
      const look = sanitizeLook(next), code = lightingCode(look), mine = own();
      if (code === lightingCode(mine)) { if (get().shared) get().leaveShared(); return; }
      get().flush(); // the viewer's own pending change is written first
      set({ look, shared: { own: mine, code, label }, sharedOutcome: null, selected: null });
    },
    keepShared: () => {
      const { shared, look } = get();
      if (!shared) return;
      const code = lightingCode(look);
      let savedAs: string | null = null, added = false;
      const written = writeStored(storage(), stored => {
        const looks = Array.isArray(stored.looks) ? stored.looks : [];
        const existing = looksFrom({ looks });
        const holding = existing.find(saved => lightingCode(saved.look) === code);
        if (holding) { savedAs = holding.name; return; }
        if (existing.length >= MAX_LOOKS) return;
        savedAs = sharedLookName(existing);
        looks.push({ id: `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: savedAs, savedAt: Date.now(), look: structuredClone(look) });
        stored.looks = looks;
        added = true;
      });
      set({ looks: looksFrom(written), previous: shared.own, shared: null, sharedOutcome: { kind: "kept", savedAs, added } });
      writeCurrent(shared.own);
    },
    leaveShared: () => {
      const { shared } = get();
      if (shared) set({ look: shared.own, shared: null, sharedOutcome: null, selected: null });
    },
    dismissSharedOutcome: () => set({ sharedOutcome: null }),
    flush: () => { if (pending) writeCurrent(); },
    refresh: () => {
      if (AUTOMATED) return;
      get().flush();
      const next = initial(), { shared } = get();
      // Another tab changed the viewer's own look: it waits behind a shared look still on screen.
      set(shared ? { ...next, look: get().look, shared: { ...shared, own: next.look } } : next);
    },
  };
});

/** The address the builder last read (store/open-link.ts): it reads the address at boot and again whenever the router's
 *  copy changes, often the same address twice in a row, and one reading of a link offers its look once. Opening the link
 *  again after the address moved on (or a reload) offers it again, as it shows the link's outfit again. */
let lastRead: string | null = null;

/** A share link's lighting, as store/open-link.ts read it: shown in place of the viewer's own, or a notice when this build
 *  cannot show it. Null (a link without lighting) changes nothing. */
export function offerLinkLighting(href: string, read: LightingRead | null): void {
  if (href === lastRead) return;
  lastRead = href;
  if (!read) return;
  const store = useLightingStore.getState();
  if (read.kind === "look") store.showShared(read.look, read.preset);
  else useLightingStore.setState({ sharedOutcome: { kind: "unavailable" } });
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !AUTOMATED) {
  window.addEventListener("storage", event => {
    if (event.key === LIGHTING_KEY || event.key === null) useLightingStore.getState().refresh();
  });
  window.addEventListener("pagehide", () => useLightingStore.getState().flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") useLightingStore.getState().flush();
  });
}
