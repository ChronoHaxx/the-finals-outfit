import { useSyncExternalStore } from "react";

// The part of an emote a video records (22 Nov 2026): the timeline's range markers, and the typed times in the Video
// tab, set the same range. One per emote, in clip seconds, kept in this browser so a range survives a reload or a trip
// to another emote and back. No range means the whole emote (the default).
//
// Storage is read-modify-write on every change: fields and emotes this version does not know are kept, and two tabs
// editing different emotes cannot drop each other's. Past CAP emotes, the least recently set is forgotten. When storage
// refuses (private mode, quota), the page keeps its own copy until it closes.

export const RANGE_KEY = "finals-outfit.video-range";
export const RANGE_CAP = 60;

export interface VideoRange { from: number; to: number }
interface StoredRange extends VideoRange { at: number }
type Store = Pick<Storage, "getItem" | "setItem">;

const page = new Map<string, StoredRange | null>(); // this page's changes, for when storage refuses them
const listeners = new Set<() => void>();
let version = 0;

const pageStorage = (): Store | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

function readAll(storage: Store | null): Record<string, unknown> {
  try {
    const raw = storage?.getItem(RANGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function valid(value: unknown): value is StoredRange {
  const v = value as StoredRange;
  return !!v && typeof v === "object" && Number.isFinite(v.from) && Number.isFinite(v.to) && v.to > v.from;
}

/** The stored range of a clip (unclamped), or null. */
export function readRange(storage: Store | null, clip: string): VideoRange | null {
  const value = readAll(storage).ranges as Record<string, unknown> | undefined;
  const entry = value && typeof value === "object" ? value[clip] : null;
  return valid(entry) ? { from: entry.from, to: entry.to } : null;
}

/** Set (or with null, clear) a clip's range. Keeps every other field and emote; forgets the oldest past the cap. */
export function writeRange(storage: Store | null, clip: string, range: VideoRange | null, now = Date.now()): boolean {
  if (!storage) return false;
  const all = readAll(storage);
  const ranges = { ...(all.ranges && typeof all.ranges === "object" && !Array.isArray(all.ranges) ? all.ranges as Record<string, unknown> : {}) };
  if (range) ranges[clip] = { ...(ranges[clip] && typeof ranges[clip] === "object" ? ranges[clip] as object : {}), from: range.from, to: range.to, at: now };
  else delete ranges[clip];
  const dated = Object.entries(ranges).map(([id, v]) => [id, valid(v) && Number.isFinite(v.at) ? v.at : 0] as const);
  if (dated.length > RANGE_CAP) dated.sort((a, b) => a[1] - b[1]).slice(0, dated.length - RANGE_CAP).forEach(([id]) => delete ranges[id]);
  try { storage.setItem(RANGE_KEY, JSON.stringify({ ...all, ranges })); return true; } catch { return false; }
}

/** The range of a clip, clamped to its length; null for the whole clip (or a range that no longer fits it). */
export function clampRange(range: VideoRange | null, duration: number, frameTime = 1 / 30): VideoRange | null {
  if (!range || !(duration > 0)) return null;
  const from = Math.min(Math.max(0, range.from), duration), to = Math.min(Math.max(0, range.to), duration);
  return to - from >= frameTime - 1e-6 ? { from, to } : null;
}

/**
 * Move one end of a range to `time` (clip seconds, snapped to a frame), keeping at least a frame between the ends. A
 * missing range starts as the whole clip; an end pushed past the other resets that other end to the clip's edge.
 */
export function moveMark(range: VideoRange | null, end: "from" | "to", time: number, duration: number, frameTime: number): VideoRange {
  const step = Math.min(frameTime, duration);
  const snap = (t: number) => Math.min(duration, Math.max(0, Math.round(t / frameTime) * frameTime));
  const current = range ?? { from: 0, to: duration }, t = snap(time);
  if (end === "from") {
    const from = Math.min(t, duration - step);
    return { from, to: current.to - from >= step - 1e-9 ? current.to : duration };
  }
  const to = Math.max(t, step);
  return { from: to - current.from >= step - 1e-9 ? current.from : 0, to };
}

export function getRange(clip: string): VideoRange | null {
  if (page.has(clip)) { const own = page.get(clip); return own ? { from: own.from, to: own.to } : null; }
  return readRange(pageStorage(), clip);
}

export function setRange(clip: string, range: VideoRange | null): void {
  const stored = writeRange(pageStorage(), clip, range);
  if (stored) page.delete(clip); else page.set(clip, range ? { ...range, at: Date.now() } : null);
  version++;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key === RANGE_KEY) { version++; listener(); } };
  window.addEventListener("storage", storage); // another tab set a range
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
}

/** The clip's range for components, clamped to its length; null for the whole clip. */
export function useVideoRange(clip: string | null | undefined, duration: number, frameTime?: number): VideoRange | null {
  useSyncExternalStore(subscribe, () => version, () => version);
  return clip ? clampRange(getRange(clip), duration, frameTime) : null;
}

export function resetRangesForTests(): void { page.clear(); version++; }
