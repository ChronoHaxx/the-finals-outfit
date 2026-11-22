// The squad page's state (multi-character Phase 2, 22 Nov 2026): the squad library (lib/squad-library.ts) opened once
// on the squad page, its snapshot for React, and the page's actions. It never writes the builder's outfit store or
// saved outfits: a contestant is a copy, read from them once.
import { create } from "zustand";
import { MemoryBackend, requestPersistentStorage } from "../lib/outfit-storage";
import {
  SquadLibrary, contestantFromOutfit, openSquadStorage, type ContestantContent, type Place, type SquadLibraryOptions,
  type SquadSnapshot,
} from "../lib/squad-library";
import type { SlotMap } from "../lib/outfit-library";

// The page is a preview behind a flag until the editor and its checks land (Phase 3): on in development, or once
// `#/squad?preview=on` has been opened in this browser (`?preview=off` turns it off again).
const FLAG_KEY = "finals-squad:preview";
export function squadPreviewEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try { return window.localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
}
export function setSquadPreview(on: boolean) {
  try { if (on) window.localStorage.setItem(FLAG_KEY, "1"); else window.localStorage.removeItem(FLAG_KEY); } catch { /* stays as it was */ }
}

/** Fixed spots on the floor for Phase 2 (no editor yet): the middle, then left and right, 1.2 m apart, facing the
 *  camera (the still pose holds the hands about 0.5 m out: 1 m apart they touched). A newcomer takes the first spot no
 *  live contestant stands within 0.3 m of. */
export const SQUAD_SPOTS: readonly Place[] = [{ x: 0, z: 0, yaw: 0 }, { x: -1.2, z: 0, yaw: 0 }, { x: 1.2, z: 0, yaw: 0 }];
export function nextSpot(taken: readonly Place[]): Place {
  const free = SQUAD_SPOTS.find(spot => taken.every(place => Math.hypot(place.x - spot.x, place.z - spot.z) > 0.3));
  return { ...(free ?? { x: 2.4, z: 0, yaw: 0 }) };
}

interface SquadsState { snapshot: SquadSnapshot | null }
export const useSquads = create<SquadsState>(() => ({ snapshot: null }));

let library: SquadLibrary | undefined;
let starting: Promise<SquadLibrary> | undefined;
let teardown: (() => void)[] = [];

/** Opens squad storage (once) and selects this tab's last squad, else the last used. Opening the page writes nothing:
 *  with no squad yet, the first Add or New makes one. Never rejects: with no usable storage, squads live in memory and
 *  the page says saving is off. */
export function startSquads(options: Partial<SquadLibraryOptions> = {}): Promise<SquadLibrary> {
  if (starting) return starting;
  starting = (async () => {
    let lib: SquadLibrary;
    try {
      const storage = options.backend ? {} : await openSquadStorage();
      lib = await SquadLibrary.open({ ...storage, ...options } as SquadLibraryOptions);
    } catch (error) {
      console.error("[squads] could not start; saving is off", error);
      lib = await SquadLibrary.open({ backend: new MemoryBackend(false) });
    }
    library = lib;
    teardown.push(lib.subscribe(() => useSquads.setState({ snapshot: lib.snapshot() })));
    teardown.push(() => lib.close());
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const visibility = () => { if (document.visibilityState === "hidden") void lib.flush(); else void lib.refresh(); };
      const hide = () => void lib.flush();
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("pagehide", hide);
      teardown.push(() => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pagehide", hide);
      });
    }
    const boot = lib.bootCurrentId();
    if (boot) lib.select(boot);
    useSquads.setState({ snapshot: lib.snapshot() });
    return lib;
  })();
  return starting;
}

/** Tests: drop the library without writing anything (a killed tab). */
export function stopSquads() {
  for (const stop of teardown.splice(0)) stop();
  library = undefined;
  starting = undefined;
  useSquads.setState({ snapshot: null });
}

export const flushSquads = () => library?.flush() ?? Promise.resolve();

export function selectSquad(id: string) { library?.select(id); }

export function newSquad(): boolean {
  const squad = library?.createSquad();
  if (!squad) return false;
  library!.select(squad.id);
  requestPersistentStorage();
  return true;
}

export function renameSquad(id: string, name: string) { library?.renameSquad(id, name); }

/** Tombstone; the returned function undoes it (false when the cap meanwhile refuses). Selects another squad, or none
 *  when it was the last: making a replacement here would leave an empty "Squad 1" beside the one Undo brings back. */
export function deleteSquad(id: string): () => boolean {
  if (!library) return () => false;
  const lib = library;
  lib.remove(id);
  if (lib.snapshot().current === id) {
    const next = lib.bootCurrentId();
    if (next) lib.select(next); else lib.deselect();
  }
  return () => { const ok = lib.undelete(id); if (ok) lib.select(id); return ok; };
}

/** The current squad, or a new one when there is none (or another tab deleted it); null at the squad cap. */
function currentOrNewSquad(lib: SquadLibrary): string | null {
  const { current, squads } = lib.snapshot();
  if (current && squads.some(squad => squad.id === current)) return current;
  const created = lib.createSquad();
  if (!created) return null;
  lib.select(created.id);
  return created.id;
}

/** An outfit-shaped source for a new contestant: a saved outfit record, or the builder's outfit on screen. */
export interface OutfitSource { slots: SlotMap; labels?: SlotMap; bodyType?: string; playerNumber?: number | null;
  name: string; outfitId?: string; [field: string]: unknown }

/** A copy of the outfit joins the current squad (a new one when there is none) at the next free spot; false at a cap. */
export function addContestant(source: OutfitSource): boolean {
  const squad = library ? currentOrNewSquad(library) : null;
  if (!library || !squad) return false;
  const taken = library.contestantsOf(squad).map(c => c.place);
  const content: ContestantContent = contestantFromOutfit(source, nextSpot(taken),
    source.outfitId ? { outfitId: source.outfitId, name: source.name } : { outfitId: "", name: source.name });
  delete content.extra?.outfitId; // the source's own handle, not outfit content
  const added = library.addContestant(squad, content);
  if (added) requestPersistentStorage();
  return !!added;
}

/** Tombstone; the returned function undoes it (false at the cap). */
export function removeContestant(id: string): () => boolean {
  const lib = library;
  lib?.remove(id);
  return () => !!lib?.undelete(id);
}

export function dismissSquadNotice() { library?.dismissNotice(); }
