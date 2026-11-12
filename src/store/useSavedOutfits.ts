// Saved outfits, wired into the builder.
//
// The outfit on screen is always one of: a saved outfit (every hand edit is saved into it as you go), or a
// draft that is not saved yet (an opened share link, or a roll made while at the cap). Nothing here ever
// overwrites work the user made by hand:
// - Opening a share link shows it as a draft. Your saved outfits are untouched; the first edit (or Save)
//   makes it a saved outfit of its own. Until then the link stays in the address bar, so a reload shows it.
// - Randomise and Reset replace the outfit in place only when that outfit was itself made by Randomise,
//   Reset or New and not edited since. A hand-made outfit is kept; the roll goes into a new outfit.
// - Delete is a tombstone with an Undo.
import { create } from "zustand";
import {
  isReadOnly, OutfitLibrary, uniqueName,
  type Draft, type LibraryOptions, type LibrarySnapshot, type OutfitRecord, type SlotMap,
} from "../lib/outfit-library";
import { MemoryBackend, openOutfitStorage, requestPersistentStorage, type StorageEnvironment } from "../lib/outfit-storage";
import { keepMissing, labelsFor, resolveSavedSlots, sameBuild, type MissingPiece } from "../lib/saved-outfit-pieces";
import { readOutfitLink } from "../lib/share-url";
import { POSE_KEYS } from "../lib/share-pose";
import { migrateOutfit } from "../lib/outfit-slots";
import type { Slot } from "../lib/slots";
import { startingOutfit, useBuildStore } from "./useBuildStore";

export interface Toast {
  id: number;
  message: string;
  /** "roll" toasts (Randomise, Reset) expire on the next edit: undoing then would also undo that edit. */
  kind: "roll" | "info";
  undo?: () => void;
}

interface SavedOutfitsState {
  library: LibrarySnapshot | null;
  /** Pieces of the outfit on screen that are saved but cannot be shown with today's catalogue. */
  missing: MissingPiece[];
  toast: Toast | null;
}

export const useSavedOutfits = create<SavedOutfitsState>(() => ({ library: null, missing: [], toast: null }));

let library: OutfitLibrary | undefined;
/** Set while this module changes the build or the library itself, so neither is mistaken for a hand edit. */
let applying = false;
let ownChange = false;
/** The record content last put on screen (by identity): a different object means another tab changed it. */
let appliedSlots: SlotMap | undefined;
let urlCleaner: (() => void) | undefined;
let confirmLeave = (message: string) => { try { return window.confirm(message); } catch { return true; } };
let toastSeq = 0;
let teardown: (() => void)[] = [];

// ------------------------------------------------------------------ start / stop

export interface StartOptions {
  env?: StorageEnvironment;
  /** Test seams: clock, scheduler, ids, or a ready backend. */
  library?: Partial<LibraryOptions>;
  confirm?: (message: string) => boolean;
}

/** Opens storage and loads saved outfits. Never rejects: with no usable storage, saving is off. */
export async function startSavedOutfits(options: StartOptions = {}): Promise<void> {
  stopSavedOutfits();
  if (options.confirm) confirmLeave = options.confirm;
  try {
    const storage = options.library?.backend ? {} : await openOutfitStorage(options.env);
    library = await OutfitLibrary.open({ ...storage, ...options.library } as LibraryOptions);
  } catch (error) {
    console.error("[saved outfits] could not start; saving is off", error);
    library = await OutfitLibrary.open({ backend: new MemoryBackend(false) });
  }
  const lib = library;
  teardown.push(lib.subscribe(onLibraryChange));
  teardown.push(useBuildStore.subscribe((state, previous) => {
    if (!applying && state.build !== previous.build) onHandEdit();
  }));
  teardown.push(() => lib.close());
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    // Write before the page can be frozen or closed, and catch up on other tabs when it comes back.
    const visibility = () => { if (document.visibilityState === "hidden") void lib.flush(); else void lib.refresh(); };
    const hide = () => void lib.flush();
    const show = (event: PageTransitionEvent) => { if (event.persisted) void lib.refresh(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    teardown.push(() => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    });
  }
  useSavedOutfits.setState({ library: lib.snapshot(), missing: [], toast: null });
}

/** Tests: drop the library without writing anything (a killed tab), and forget module state. */
export function stopSavedOutfits() {
  for (const stop of teardown.splice(0)) stop();
  library = undefined;
  appliedSlots = undefined;
  urlCleaner = undefined;
  useSavedOutfits.setState({ library: null, missing: [], toast: null });
}

/** Tests and page hide: write pending changes now. */
export function flushSavedOutfits(): Promise<void> {
  return library?.flush() ?? Promise.resolve();
}

/** The builder registers its router so removing a link from the address bar goes through it. */
export function setUrlCleaner(cleaner: (() => void) | undefined) {
  urlCleaner = cleaner;
}

// ------------------------------------------------------------------ internals

function own<T>(change: () => T): T {
  const outer = ownChange;
  ownChange = true;
  try { return change(); } finally { ownChange = outer; }
}

function show(slots: SlotMap, labels?: Record<string, string>) {
  const resolved = resolveSavedSlots(slots, labels);
  if (!sameBuild(useBuildStore.getState().build, resolved.build)) {
    applying = true;
    try { useBuildStore.getState().load(resolved.build); } finally { applying = false; }
  }
  useSavedOutfits.setState({ missing: resolved.missing });
}

function showRecord(record: OutfitRecord) {
  appliedSlots = record.slots;
  show(record.slots, record.labels);
}

function showDraft(draft: Draft) {
  appliedSlots = undefined;
  show(draft.slots, draft.labels);
}

function publish() {
  if (library) useSavedOutfits.setState({ library: library.snapshot() });
}

function onLibraryChange() {
  const lib = library;
  if (!lib) return;
  const current = lib.getCurrent();
  if (current?.kind === "record" && !ownChange) {
    const record = lib.get(current.id);
    if (!record || record.deletedAt !== undefined) {
      // Deleted in another tab while shown here (with no unsaved changes here, or it would have forked).
      const next = lib.mostRecent() ?? createStarting(lib).id;
      own(() => lib.select(next));
      showRecord(lib.get(next)!);
      toast(`“${record?.name ?? "This outfit"}” was deleted in another tab.`, "info");
    } else if (record.slots !== appliedSlots) {
      showRecord(record); // another tab's change, or our version moved to a fork
    }
  }
  publish();
}

function onHandEdit() {
  const lib = library;
  if (!lib) return;
  const build = useBuildStore.getState().build;
  const { slots, missing } = keepMissing(build, useSavedOutfits.getState().missing);
  const current = lib.getCurrent();
  if (useSavedOutfits.getState().toast?.kind === "roll") useSavedOutfits.setState({ toast: null });
  if (current?.kind === "record") {
    const record = lib.get(current.id)!;
    own(() => lib.setContent(record.id, slots, labelsFor(slots, record.labels), false));
    appliedSlots = lib.get(record.id)!.slots;
  } else if (current?.kind === "draft") {
    promoteDraft({ ...current.draft, slots, labels: labelsFor(slots, current.draft.labels), generated: false }, true);
  } else {
    // Nothing on screen was chosen yet (should not happen after openFromUrl): keep the edit anyway.
    promoteDraft({ name: "Outfit", slots, labels: labelsFor(slots), reason: "cap" }, true);
  }
  useSavedOutfits.setState({ missing });
  publish();
}

const nextName = (lib: OutfitLibrary, stem: string) => uniqueName(stem, lib.liveNames(), { numberFirst: true });

function createStarting(lib: OutfitLibrary): OutfitRecord {
  const slots = startingOutfit() as SlotMap;
  // Uncapped only in effect: called when there are no live outfits at all.
  return own(() => lib.create({ name: nextName(lib, "Outfit"), slots, labels: labelsFor(slots), generated: true }))!;
}

/** The draft becomes a saved outfit. At the cap it stays a draft (and says so). */
function promoteDraft(draft: Draft, edited: boolean): boolean {
  const lib = library!;
  const record = own(() => lib.create({ name: uniqueName(draft.name, lib.liveNames()), slots: draft.slots,
    labels: draft.labels, generated: draft.generated }));
  if (record) {
    own(() => lib.select(record.id));
    appliedSlots = record.slots;
    cleanUrl();
    return true;
  }
  own(() => lib.setDraft({ ...draft, reason: "cap", edited: !!draft.edited || edited }));
  return false;
}

function leavingDraft(): boolean {
  const current = library?.getCurrent();
  if (current?.kind !== "draft") return true;
  if (current.draft.edited && !confirmLeave(`“${current.draft.name}” is not saved (you have ${library!.cap} saved outfits). Leave it anyway?`))
    return false;
  cleanUrl();
  return true;
}

/** Remove the share link from the address bar once it has done its job, so a reload shows the saved outfit. A link's
 *  pose (share-pose.ts) goes with it: the builder read it before this could run. */
function cleanUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["outfit", "o", "look", ...POSE_KEYS]) if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    if (changed) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const hashLink = url.hash.startsWith("#/?") && new URLSearchParams(url.hash.slice(3)).has("o");
    if (!hashLink) return;
    if (urlCleaner) urlCleaner();
    else window.history.replaceState(window.history.state, "", url.pathname + url.search + "#/");
  } catch (error) {
    console.warn("[saved outfits] could not tidy the address bar", error);
  }
}

function toast(message: string, kind: Toast["kind"], undo?: () => void) {
  useSavedOutfits.setState({ toast: { id: ++toastSeq, message, kind, undo } });
}

function ensureCurrent(createIfEmpty: boolean) {
  const lib = library;
  if (!lib || lib.getCurrent()) return;
  const id = lib.bootCurrentId();
  if (id) {
    own(() => lib.select(id));
    showRecord(lib.get(id)!);
  } else if (createIfEmpty) {
    const record = createStarting(lib);
    own(() => lib.select(record.id));
    showRecord(record);
  }
  publish();
}

// ------------------------------------------------------------------ opening the page

/** `declined`: the viewer chose to keep an unsaved draft instead (the link's pose must not apply either). */
export interface LinkResult { omitted: boolean; error: boolean; declined?: boolean }

/**
 * Show what the address asks for. Idempotent (StrictMode runs effects twice; the router re-runs it after
 * the link is removed): a link already on screen, or no link at all, changes nothing.
 */
export function openFromUrl(href: string): LinkResult {
  let decoded;
  try {
    decoded = readOutfitLink(href);
  } catch (error) {
    console.warn("[outfit] ignoring invalid share code", error);
    ensureCurrent(true);
    return { omitted: false, error: true };
  }
  if (!decoded) {
    ensureCurrent(true);
    return { omitted: false, error: false };
  }
  const outfit = migrateOutfit(decoded);
  const slots = outfit.slots as SlotMap;
  const resolved = resolveSavedSlots(slots);
  const result = { omitted: resolved.missing.length > 0, error: false };
  const lib = library;
  if (!lib) {
    useBuildStore.getState().load(resolved.build);
    return result;
  }
  const opened = openUnsaved(lib, outfit.presetName?.trim() || "Shared outfit", resolved.slots, resolved.build, "link", "Open the link anyway?");
  return opened.kind === "declined" ? { ...result, declined: true } : result;
}

type Opened = { kind: "same" } | { kind: "declined" } | { kind: "record"; record: OutfitRecord } | { kind: "draft"; draft: Draft };

/**
 * Show an outfit that is not saved yet: a share link, or one of the game's own outfits. It becomes a draft beside the
 * saved outfits, so nothing saved changes until the user edits it or presses Save (which makes a NEW saved outfit).
 * An outfit already on screen changes nothing; a saved outfit with exactly these pieces is shown instead of a draft.
 * `slots` is what the draft keeps, `build` what it wears. A link's address stays while its draft is on screen (a reload
 * shows it again); anything else removes a previous link from the address bar, after the draft is in place, so the
 * router's re-run finds the draft and leaves it alone.
 */
function openUnsaved(lib: OutfitLibrary, name: string, slots: SlotMap, build: Partial<Record<Slot, string>>,
  reason: "link" | "preset", ask: string): Opened {
  ensureCurrent(false);
  const current = lib.getCurrent();
  if (current && sameBuild(useBuildStore.getState().build, build)) {
    if (current.kind === "record" && reason === "link") cleanUrl(); // already this saved outfit (also the Roadmap round trip)
    return { kind: "same" };
  }
  if (current?.kind === "draft" && current.draft.edited && !confirmLeave(
    `“${current.draft.name}” is not saved (you have ${lib.cap} saved outfits). ${ask}`)) return { kind: "declined" };
  const match = lib.live().find(record => sameBuild(resolveSavedSlots(record.slots, record.labels).build, build));
  let opened: Opened;
  if (match) {
    own(() => lib.select(match.id));
    showRecord(match);
    cleanUrl();
    opened = { kind: "record", record: match };
  } else {
    const draft: Draft = { name, slots, labels: labelsFor(slots), reason };
    own(() => lib.setDraft(draft));
    showDraft(draft);
    if (reason !== "link") cleanUrl();
    opened = { kind: "draft", draft };
  }
  publish();
  return opened;
}

/**
 * Put on one of the game's own outfits (src/lib/preset-outfits.ts) as an unsaved draft. `slots` is the whole outfit, built
 * by presetSlots from the outfit on screen; it is resolved against today's catalogue once, and only what can be worn
 * goes into the draft. Undo goes back to what was on screen, but only while the draft is still the one on screen.
 */
export function openPreset(name: string, slots: SlotMap): "same" | "declined" | "draft" | "record" {
  const resolved = resolveSavedSlots(slots);
  const lib = library;
  if (!lib) { useBuildStore.getState().load(resolved.build); return "draft"; }
  const previous = lib.getCurrent();
  const wearing = { ...resolved.build } as SlotMap;
  const opened = openUnsaved(lib, name, wearing, resolved.build, "preset", `Wear “${name}” anyway?`);
  if (opened.kind === "record") toast(`Your saved outfit “${opened.record.name}” already has these pieces.`, "info");
  if (opened.kind !== "draft") return opened.kind;
  const draft = opened.draft;
  const atCap = lib.liveCount() >= lib.cap;
  toast(atCap ? `Wearing “${name}”, not saved: you have ${lib.cap} saved outfits.` : `Wearing “${name}”. Changing anything saves it.`, "roll", () => {
    const now = lib.getCurrent();
    if (now?.kind === "draft" && now.draft === draft) {
      if (previous?.kind === "record" && lib.get(previous.id)?.deletedAt === undefined) {
        own(() => lib.select(previous.id));
        showRecord(lib.get(previous.id)!);
      } else if (previous?.kind === "draft") {
        own(() => lib.setDraft(previous.draft));
        showDraft(previous.draft);
      }
    }
    useSavedOutfits.setState({ toast: null });
    publish();
  });
  return "draft";
}

// ------------------------------------------------------------------ actions

export function selectOutfit(id: string) {
  const lib = library;
  if (!lib) return;
  const current = lib.getCurrent();
  const record = lib.get(id);
  if (!record || record.deletedAt !== undefined || (current?.kind === "record" && current.id === id)) return;
  if (!leavingDraft()) return;
  own(() => lib.select(id));
  showRecord(record);
  if (useSavedOutfits.getState().toast?.kind === "roll") useSavedOutfits.setState({ toast: null });
  publish();
}

const capMessage = (lib: OutfitLibrary) => `You have ${lib.cap} saved outfits, the most this browser keeps. Delete one to make room.`;

export function newOutfit(): boolean {
  const lib = library;
  if (!lib) return false;
  if (lib.liveCount() >= lib.cap) { toast(capMessage(lib), "info"); return false; }
  if (!leavingDraft()) return false;
  const record = createStarting(lib);
  own(() => lib.select(record.id));
  showRecord(record);
  requestPersistentStorage();
  publish();
  return true;
}

export function duplicateOutfit(id: string): boolean {
  const lib = library;
  if (!lib) return false;
  if (lib.liveCount() >= lib.cap) { toast(capMessage(lib), "info"); return false; }
  if (!leavingDraft()) return false;
  const copy = own(() => lib.duplicate(id));
  if (!copy) return false;
  own(() => lib.select(copy.id));
  showRecord(copy);
  requestPersistentStorage();
  publish();
  return true;
}

export function renameOutfit(id: string, name: string) {
  if (!library) return;
  own(() => library!.rename(id, name));
  requestPersistentStorage();
  publish();
}

/** Save the draft on screen as an outfit of its own. */
export function saveDraft(): boolean {
  const lib = library;
  const current = lib?.getCurrent();
  if (!lib || current?.kind !== "draft") return false;
  if (!promoteDraft(current.draft, false)) { toast(capMessage(lib), "info"); publish(); return false; }
  requestPersistentStorage();
  publish();
  return true;
}

export function deleteOutfit(id: string) {
  const lib = library;
  const record = lib?.get(id);
  if (!lib || !record || record.deletedAt !== undefined) return;
  const current = lib.getCurrent();
  const wasCurrent = current?.kind === "record" && current.id === id;
  own(() => lib.remove(id));
  let replacement: OutfitRecord | undefined;
  if (wasCurrent) {
    let next = lib.mostRecent(id);
    if (!next) { replacement = createStarting(lib); next = replacement.id; }
    const nextId = next;
    own(() => lib.select(nextId));
    showRecord(lib.get(nextId)!);
  }
  toast(`Deleted “${record.name}”`, "info", () => {
    if (!own(() => lib.undelete(id))) { toast(capMessage(lib), "info"); return; }
    if (wasCurrent) {
      own(() => lib.select(id));
      showRecord(lib.get(id)!);
      // The blank outfit made only because nothing was left goes again, if it was never touched.
      if (replacement && lib.get(replacement.id)?.rev === 1) own(() => lib.remove(replacement!.id));
    }
    useSavedOutfits.setState({ toast: null });
    publish();
  });
  publish();
}

/** Stop keeping the saved pieces that cannot be shown. Undoable. */
export function forgetMissing() {
  const lib = library;
  const current = lib?.getCurrent();
  if (!lib || current?.kind !== "record") return;
  const record = lib.get(current.id)!;
  const before = { slots: record.slots, labels: record.labels, generated: !!record.generated };
  const slots = keepMissing(useBuildStore.getState().build, []).slots;
  own(() => lib.setContent(record.id, slots, labelsFor(slots, record.labels), before.generated));
  showRecord(lib.get(record.id)!);
  toast("Removed the missing pieces from this outfit", "info", () => {
    own(() => lib.setContent(record.id, before.slots, before.labels, before.generated));
    showRecord(lib.get(record.id)!);
    useSavedOutfits.setState({ toast: null });
    publish();
  });
  publish();
}

export function randomiseOutfit(build: Partial<Record<Slot, string>>) {
  replaceWithGenerated(build, "Random", "Randomised");
}

export function resetOutfit() {
  replaceWithGenerated(startingOutfit(), "Outfit", "Back to the starting outfit");
}

/** Randomise and Reset: in place only over an outfit that is itself an untouched roll. */
function replaceWithGenerated(build: Partial<Record<Slot, string>>, stem: string, verb: string) {
  const lib = library;
  const slots = { ...build } as SlotMap;
  if (!lib) { useBuildStore.getState().load(build); return; }
  const labels = labelsFor(slots);
  const current = lib.getCurrent();
  const record = current?.kind === "record" ? lib.get(current.id) : undefined;
  if (record?.generated && !isReadOnly(record)) {
    const before = { slots: record.slots, labels: record.labels };
    own(() => lib.setContent(record.id, slots, labels, true));
    showRecord(lib.get(record.id)!);
    toast(verb, "roll", () => {
      own(() => lib.setContent(record.id, before.slots, before.labels, true));
      showRecord(lib.get(record.id)!);
      useSavedOutfits.setState({ toast: null });
      publish();
    });
    publish();
    return;
  }
  if (current?.kind === "draft" && current.draft.edited
    && !confirmLeave(`“${current.draft.name}” is not saved (you have ${lib.cap} saved outfits). Replace it anyway?`)) return;

  const goBack = () => {
    if (current?.kind === "record" && lib.get(current.id)?.deletedAt === undefined) {
      own(() => lib.select(current.id));
      showRecord(lib.get(current.id)!);
    } else if (current?.kind === "draft") {
      own(() => lib.setDraft(current.draft));
      showDraft(current.draft);
    }
  };
  const created = own(() => lib.create({ name: nextName(lib, stem), slots, labels, generated: true }));
  if (created) {
    if (current?.kind === "draft") cleanUrl();
    own(() => lib.select(created.id));
    showRecord(created);
    toast(record ? `${verb} as “${created.name}”. “${record.name}” is kept.` : `${verb} as “${created.name}”.`, "roll", () => {
      own(() => lib.remove(created.id));
      goBack();
      useSavedOutfits.setState({ toast: null });
      publish();
    });
  } else {
    // At the cap: show it unsaved. The outfit you had stays exactly as it was.
    const draft: Draft = { name: stem === "Random" ? "Random outfit" : "New outfit", slots, labels, generated: true, reason: "cap" };
    own(() => lib.setDraft(draft));
    showDraft(draft);
    toast(`${verb}, not saved: you have ${lib.cap} saved outfits.`, "roll", () => {
      goBack();
      useSavedOutfits.setState({ toast: null });
      publish();
    });
  }
  publish();
}

export function dismissToast() {
  useSavedOutfits.setState({ toast: null });
}

export function dismissNotice() {
  library?.dismissNotice();
}
