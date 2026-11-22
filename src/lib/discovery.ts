import { useCallback, useSyncExternalStore } from "react";
import { FEATURES, GUIDE_FEATURE, TOUR, featureById, type FeatureId } from "../data/feature-guide";
import { AUTOMATED } from "./automation";

// Discovery (22 Nov 2026): what this browser has found of the builder, so its hints can be smart about it.
//
// - A control the visitor has *used* (pressed, or its key) gets quiet: its callout waits for a direct hover.
// - A control they have *seen* (its callout stayed up, the tour stopped on it, or "Show me" framed it) loses the red
//   "not tried yet" corner. A few corners show at a time, in tour order, so the screen never fills with them.
// - The tour's place: which stop it was on, and whether it was finished, so it can be resumed.
//
// All of it is a per-browser preference, never part of an outfit: nothing here can touch saved outfits or looks. One
// key, read-modify-write per change, so fields another version of the site writes survive and two tabs merge (each id
// keeps its first time). Storage can be missing, full or throw (private windows, blocked site data): then this page
// remembers on its own until it closes, and nothing ever breaks or blocks the builder. Automated browsers see none of
// it (every control reads as known), so harness captures stay as they were.

export const DISCOVERY_KEY = "finals-outfit.discovery";

/** How many "not tried yet" corners show at once. */
export const MARK_LIMIT = 3;

export type TourStatus = "new" | "running" | "paused" | "done";
export interface TourState { status: TourStatus; stop: FeatureId | null }

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Stamps = Record<string, number>;
interface Stored { used?: Stamps; seen?: Stamps; tour?: { status?: string; stop?: string; at?: number }; [key: string]: unknown }

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stamps = (value: unknown): Stamps => isObject(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
  : {};

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readDiscovery(store: StorageLike | null): Stored {
  try {
    const parsed = JSON.parse(store?.getItem(DISCOVERY_KEY) ?? "{}");
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Read, change, write back: every field this version does not know is kept. False when storage refused it. */
export function updateDiscovery(store: StorageLike | null, change: (stored: Stored) => void): boolean {
  if (!store) return false;
  const stored = readDiscovery(store);
  change(stored);
  try { store.setItem(DISCOVERY_KEY, JSON.stringify(stored)); return true; } catch { return false; }
}

/** Adds ids to a stamp set, keeping the first time each was recorded (so two tabs merge to the same answer). */
export function addStamp(stored: Stored, field: "used" | "seen", id: string, now: number): void {
  const set = stamps(stored[field]);
  if (set[id] === undefined) set[id] = now;
  stored[field] = { ...(isObject(stored[field]) ? stored[field] : {}), ...set };
}

const TOUR_STATUSES: readonly TourStatus[] = ["new", "running", "paused", "done"];

/** The stored tour, made safe: an unknown stop (a later version's) restarts it from the top. A tour left running when
 *  the page closed comes back paused: the tour never starts by itself. */
export function storedTour(stored: Stored): TourState {
  const tour = isObject(stored.tour) ? stored.tour : {};
  let status = TOUR_STATUSES.includes(tour.status as TourStatus) ? tour.status as TourStatus : "new";
  if (status === "running") status = "paused";
  const stop = typeof tour.stop === "string" && (TOUR as readonly string[]).includes(tour.stop) ? tour.stop as FeatureId : null;
  return { status: status === "paused" && !stop ? "new" : status, stop: status === "done" || status === "new" ? null : stop };
}

// ---------------------------------------------------------------------------------------------------------------------
// This page's view: storage merged with what this page did (which outlives refused writes).

const usedHere = new Set<string>();
const seenHere = new Set<string>();
let tourHere: TourState | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(listener => listener()); };

// Another tab found something or moved the tour: follow it.
function onStorage(event: StorageEvent) { if (event.key === DISCOVERY_KEY || event.key === null) notify(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// One parsed snapshot per change, so a render that asks about every control reads storage once.
let cache: { version: number; used: Set<string>; seen: Set<string>; tour: TourState } | null = null;
function snapshot() {
  if (cache?.version === version) return cache;
  const stored = readDiscovery(browserStorage());
  const used = new Set([...Object.keys(stamps(stored.used)), ...usedHere]);
  const seen = new Set([...Object.keys(stamps(stored.seen)), ...seenHere, ...used]);
  // This page's own tour state wins over storage while it runs (a write may have been refused).
  cache = { version, used, seen, tour: tourHere ?? storedTour(stored) };
  return cache;
}

export const featureUsed = (id: string) => AUTOMATED || snapshot().used.has(id);
export const featureSeen = (id: string) => AUTOMATED || snapshot().seen.has(id);

/** The few controls that wear the red "not tried yet" corner right now: unseen ones, tour order first. */
export function markedFeatures(): ReadonlySet<string> {
  if (AUTOMATED) return new Set();
  const { seen } = snapshot();
  const order = [...TOUR, ...FEATURES.map(feature => feature.id), GUIDE_FEATURE.id]
    .filter((id, index, all) => all.indexOf(id) === index);
  return new Set(order.filter(id => !featureById(id)?.noMark && !seen.has(id)).slice(0, MARK_LIMIT));
}

export function markUsed(id: string): void {
  if (AUTOMATED || (usedHere.has(id) && seenHere.has(id))) return;
  usedHere.add(id);
  seenHere.add(id);
  const now = Date.now();
  updateDiscovery(browserStorage(), stored => { addStamp(stored, "used", id, now); addStamp(stored, "seen", id, now); });
  notify();
}

export function markSeen(id: string): void {
  if (AUTOMATED || seenHere.has(id)) return;
  seenHere.add(id);
  updateDiscovery(browserStorage(), stored => addStamp(stored, "seen", id, Date.now()));
  notify();
}

export function tourState(): TourState {
  return AUTOMATED ? { status: "done", stop: null } : snapshot().tour;
}

export function setTour(next: TourState): void {
  if (AUTOMATED) return;
  tourHere = next;
  updateDiscovery(browserStorage(), stored => {
    stored.tour = { ...(isObject(stored.tour) ? stored.tour : {}), status: next.status, stop: next.stop ?? undefined, at: Date.now() };
  });
  notify();
}

/** Re-renders when anything here changes; `pick` reads the snapshot. */
export function useDiscovery<T>(pick: () => T): T {
  return useSyncExternalStore(subscribe, pick, pick);
}

// Snapshots for useSyncExternalStore must be stable between changes: memoise the derived set per version.
let marked: { version: number; set: ReadonlySet<string> } | null = null;
function markedSnapshot(): ReadonlySet<string> {
  if (marked?.version !== version) marked = { version, set: markedFeatures() };
  return marked.set;
}
let tourSnap: { version: number; tour: TourState } | null = null;
function tourSnapshot(): TourState {
  if (tourSnap?.version !== version) tourSnap = { version, tour: tourState() };
  return tourSnap.tour;
}

export const useTour = () => useSyncExternalStore(subscribe, tourSnapshot, tourSnapshot);
export const useMarked = () => useSyncExternalStore(subscribe, markedSnapshot, markedSnapshot);

/**
 * Puts a control on the map: spread the result on the element. `data-feature` lets the discovery layer find it (for its
 * callout, the tour and "Show me"); `data-fresh` draws the red corner while it is one of the few not tried yet. The
 * native tooltip is left to automated browsers, whose scripts find some controls by it: for a visitor, the callout
 * says the same with the shortcut, and a native tooltip on top of it would say it twice.
 */
export function useFeature(id: FeatureId, title?: string): { "data-feature": string; "data-fresh"?: ""; title?: string } {
  const fresh = useSyncExternalStore(subscribe, () => markedSnapshot().has(id), () => false);
  return { "data-feature": id, ...(fresh ? { "data-fresh": "" as const } : {}), ...(AUTOMATED && title ? { title } : {}) };
}

/** Whether a control is still worth an eager callout (never pressed here). */
export function useFeatureUsed(id: string): boolean {
  const read = useCallback(() => featureUsed(id), [id]);
  return useSyncExternalStore(subscribe, read, read);
}

/** For tests: forget this page's memory. */
export function resetDiscoveryForTests(): void {
  usedHere.clear(); seenHere.clear(); tourHere = null; cache = null; marked = null; tourSnap = null; notify();
}
