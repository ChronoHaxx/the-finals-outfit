// Saved outfits: several named outfits kept in this browser, written as you go.
//
// This module is the storage-independent core. It never touches the catalogue or React, so its loss
// paths are testable in Node: src/lib/outfit-storage.ts supplies the browser backends (IndexedDB,
// localStorage, memory) and src/store/useSavedOutfits.ts connects it to the build store.
//
// Rules it enforces (the project's "never lose the user's work" rules):
// - Every outfit is its own record with an id, createdAt, updatedAt and a write counter (`rev`), so a
//   later sync can merge outfit by outfit. Deleting writes a tombstone (`deletedAt`), never removes.
// - A write is a read-modify-write of ONE record: fields this version does not know are kept from the
//   stored copy. A record written by a newer schema is never overwritten; edits to it fork a copy.
// - Edits land in memory first, then in a synchronous journal (one localStorage key per outfit), then
//   in the backend after a short debounce. A tab killed mid-session is replayed from the journal on
//   the next visit, so it costs nothing that the journal could hold.
// - Another tab's write is never overwritten: if the stored copy moved on since this tab read it, this
//   tab's version is saved as a new outfit instead ("Name (2)").
// - The number of live outfits is capped; creating past the cap is refused, never an eviction.

export const SCHEMA_VERSION = 1;
export const OUTFIT_CAP = 100;
export const NAME_MAX = 40;
const DEBOUNCE_MS = 300;

export type SlotMap = Record<string, string>;

export interface OutfitRecord {
  v: number;
  id: string;
  /** Write counter. Conflicts are detected by comparing it with the counter this tab last read. */
  rev: number;
  /** The tab session that made this revision; lets a tab recognise its own journal replayed elsewhere. */
  writer?: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Slot name -> item id, exactly as the user left it. May hold ids the catalogue no longer has. */
  slots: SlotMap;
  /** Item id -> item name when saved, so a piece that later leaves the catalogue can still be named. */
  labels?: Record<string, string>;
  /** Made by Randomise, Reset or New and not edited by hand since: not work worth protecting. */
  generated?: boolean;
  deletedAt?: number;
  [field: string]: unknown;
}

const KNOWN_FIELDS = ["v", "id", "rev", "writer", "name", "createdAt", "updatedAt", "slots", "labels",
  "generated", "deletedAt"] as const;

export interface JournalEntry { record: OutfitRecord; base?: number }

/** Persistent storage. `update` is an atomic read-modify-write of one record; `fn` must be synchronous. */
export interface OutfitBackend {
  readonly kind: "indexeddb" | "localstorage" | "memory";
  /** False when nothing survives the tab (storage blocked): the UI says saving is off. */
  readonly persistent: boolean;
  readAll(): Promise<unknown[]>;
  update(id: string, fn: (stored: unknown) => unknown): Promise<void>;
  readMeta(): Promise<unknown>;
  updateMeta(fn: (stored: unknown) => unknown): Promise<void>;
}

/** Synchronous per-outfit journal. Every method swallows its own errors. */
export interface Journal {
  write(id: string, entry: JournalEntry): void;
  /** Forget the entry once revision `rev` (or a later one) is safely in the backend. */
  settle(id: string, rev: number): void;
  readAll(): unknown[];
}

export interface Channel { post(): void; listen(onChange: () => void): () => void }
export interface TabMemory { get(): string | null; set(id: string): void }

export type SaveStatus = "saved" | "saving" | "off" | "error";

/** An outfit on screen that is not (yet) a saved record: an opened share link, or a roll at the cap. */
export interface Draft {
  name: string;
  slots: SlotMap;
  labels?: SlotMap;
  generated?: boolean;
  reason: "link" | "cap";
  /** Edited by hand while it could not be saved. Leaving it then needs a confirmation. */
  edited?: boolean;
}

export type Current = { kind: "record"; id: string } | { kind: "draft"; draft: Draft };

export interface LibrarySnapshot {
  status: SaveStatus;
  backend: OutfitBackend["kind"];
  /** Live outfits, newest first. */
  outfits: readonly OutfitRecord[];
  current: Current | null;
  cap: number;
  /** One-off explanation of something the library did on its own (a fork, an adopted change). */
  notice?: string;
  error?: string;
}

export interface LibraryOptions {
  backend: OutfitBackend;
  journal?: Journal;
  channel?: Channel;
  tab?: TabMemory;
  now?: () => number;
  newId?: () => string;
  /** Debounce timer. Returns a cancel function. Tests pass a manual scheduler. */
  schedule?: (run: () => void, ms: number) => () => void;
  debounceMs?: number;
  cap?: number;
}

export function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* insecure context */ }
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function stringMap(value: unknown): SlotMap {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
}

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Validate a stored record, keeping every field it carries. Returns undefined for something unusable. */
export function readRecord(raw: unknown): OutfitRecord | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const record: OutfitRecord = {
    ...raw,
    v: finite(raw.v, SCHEMA_VERSION),
    id: raw.id,
    rev: finite(raw.rev, 0),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Outfit",
    createdAt: finite(raw.createdAt, 0),
    updatedAt: finite(raw.updatedAt, 0),
    slots: stringMap(raw.slots),
  };
  if (typeof raw.writer !== "string") delete record.writer;
  if (raw.labels === undefined) delete record.labels; else record.labels = stringMap(raw.labels);
  if (raw.generated !== true) delete record.generated;
  if (typeof raw.deletedAt !== "number") delete record.deletedAt;
  return record;
}

/** A record from a newer app version: shown, never overwritten. */
export const isReadOnly = (record: OutfitRecord) => record.v > SCHEMA_VERSION;

function knownFields(record: OutfitRecord): Partial<OutfitRecord> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_FIELDS) if (record[key] !== undefined) out[key] = record[key];
  return out as Partial<OutfitRecord>;
}

/** Read, change, write back: the stored copy's unknown fields survive, the known ones are ours. */
function mergeForWrite(stored: unknown, mine: OutfitRecord): Record<string, unknown> {
  const base: Record<string, unknown> = isObject(stored) ? { ...stored } : {};
  for (const key of KNOWN_FIELDS) delete base[key];
  return { ...base, ...knownFields(mine) };
}

const sameMap = (a: SlotMap | undefined, b: SlotMap | undefined) => {
  const left = Object.entries(a ?? {}), right = b ?? {};
  return left.length === Object.keys(right).length && left.every(([k, v]) => right[k] === v);
};

export function sameContent(a: OutfitRecord, b: OutfitRecord): boolean {
  return a.name === b.name && sameMap(a.slots, b.slots) && sameMap(a.labels, b.labels)
    && !!a.generated === !!b.generated && a.deletedAt === b.deletedAt;
}

/** "Outfit" -> "Outfit 1", "Outfit 2"...; "Name (2)" style when `paren` is set. */
export function uniqueName(stem: string, taken: Iterable<string>, opts: { numberFirst?: boolean; paren?: boolean } = {}): string {
  const used = new Set([...taken].map(name => name.toLocaleLowerCase()));
  const clip = (name: string) => name.slice(0, NAME_MAX);
  if (!opts.numberFirst && !used.has(clip(stem).toLocaleLowerCase())) return clip(stem);
  for (let n = opts.numberFirst ? 1 : 2; ; n++) {
    const suffix = opts.paren ? ` (${n})` : ` ${n}`;
    const name = clip(stem.slice(0, NAME_MAX - suffix.length) + suffix);
    if (!used.has(name.toLocaleLowerCase())) return name;
  }
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

type Verdict = "write" | "same" | "conflict";

function judge(stored: OutfitRecord | undefined, mine: OutfitRecord, base: number | undefined, writer: string): Verdict {
  // Missing: a new outfit, or storage was cleared under an open tab. Writing it back loses nothing.
  if (!stored) return "write";
  if (stored.rev === mine.rev && stored.writer === mine.writer && sameContent(stored, mine)) return "same";
  if (isReadOnly(stored)) return "conflict";
  if (stored.rev === base) return "write";
  // Our own earlier revision, replayed from this tab's journal by a tab that opened meanwhile.
  if (stored.writer === writer && stored.rev < mine.rev) return "write";
  return "conflict";
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export class OutfitLibrary {
  readonly backend: OutfitBackend;
  readonly cap: number;
  private readonly journal?: Journal;
  private readonly channel?: Channel;
  private readonly tab?: TabMemory;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly schedule: (run: () => void, ms: number) => () => void;
  private readonly debounceMs: number;
  private readonly writer: string;

  private readonly records = new Map<string, OutfitRecord>();
  /** The revision of each outfit known to be in the backend (what this tab last read or wrote). */
  private readonly confirmed = new Map<string, number>();
  /** Outfits with changes the backend does not have yet. */
  private readonly dirty = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private cancelTimer?: () => void;
  private current: Current | null = null;
  private failure?: string;
  private notice?: string;
  private metaCurrent: string | null = null;
  private listeners = new Set<() => void>();
  private snap?: LibrarySnapshot;
  private stopListening?: () => void;

  private constructor(options: LibraryOptions) {
    this.backend = options.backend;
    this.journal = options.journal;
    this.channel = options.channel;
    this.tab = options.tab;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? makeId;
    this.schedule = options.schedule ?? defaultSchedule;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.cap = options.cap ?? OUTFIT_CAP;
    this.writer = makeId();
  }

  /** Load every outfit, replay the journal of a tab that died with unsaved changes, and start listening. */
  static async open(options: LibraryOptions): Promise<OutfitLibrary> {
    const library = new OutfitLibrary(options);
    await library.load();
    library.replayJournal();
    library.stopListening = library.channel?.listen(() => void library.refresh());
    if (library.dirty.size) library.scheduleWrite();
    return library;
  }

  private async load() {
    try {
      for (const raw of await this.backend.readAll()) {
        const record = readRecord(raw);
        if (!record) continue;
        this.records.set(record.id, record);
        this.confirmed.set(record.id, record.rev);
      }
      const meta = await this.backend.readMeta();
      if (isObject(meta) && typeof meta.currentId === "string") this.metaCurrent = meta.currentId;
    } catch (error) {
      this.fail(error);
    }
  }

  private replayJournal() {
    for (const raw of this.journal?.readAll() ?? []) {
      if (!isObject(raw)) continue;
      const entry = readRecord(raw.record);
      const base = typeof raw.base === "number" ? raw.base : undefined;
      if (!entry) continue;
      const stored = this.records.get(entry.id);
      const ownLater = !!stored && stored.writer === entry.writer && stored.rev < entry.rev;
      if (stored && sameContent(stored, entry)) {
        this.journal?.settle(entry.id, entry.rev); // it landed (or someone wrote the same thing)
      } else if (!stored || ((stored.rev === base || ownLater) && !isReadOnly(stored))) {
        // The backend never got this revision: it is the newest copy of the work. Writing it merges with
        // the stored copy, so fields this version does not know survive.
        this.records.set(entry.id, entry);
        this.dirty.add(entry.id);
      } else {
        // Someone else changed it after this journal entry was made: keep both.
        if (entry.deletedAt === undefined) {
          this.addRecord({ name: uniqueName(entry.name, this.liveNames(), { paren: true }),
            slots: entry.slots, labels: entry.labels, generated: entry.generated });
          this.notice = `Recovered unsaved changes to “${entry.name}” as a separate outfit.`;
        }
        this.journal?.settle(entry.id, entry.rev);
      }
    }
  }

  // ---------------------------------------------------------------- reading

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): LibrarySnapshot {
    if (this.snap) return this.snap;
    const outfits = [...this.records.values()].filter(r => r.deletedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    this.snap = {
      status: !this.backend.persistent ? "off" : this.failure ? "error" : this.dirty.size ? "saving" : "saved",
      backend: this.backend.kind,
      outfits,
      current: this.current,
      cap: this.cap,
      ...(this.notice ? { notice: this.notice } : {}),
      ...(this.failure ? { error: this.failure } : {}),
    };
    return this.snap;
  }

  get(id: string): OutfitRecord | undefined {
    return this.records.get(id);
  }

  live(): OutfitRecord[] {
    return [...this.snapshot().outfits];
  }

  liveCount(): number {
    let count = 0;
    for (const record of this.records.values()) if (record.deletedAt === undefined) count++;
    return count;
  }

  liveNames(): string[] {
    return [...this.records.values()].filter(r => r.deletedAt === undefined).map(r => r.name);
  }

  getCurrent(): Current | null {
    return this.current;
  }

  /** This tab's last outfit, else the last one any tab selected, else the most recently edited. */
  bootCurrentId(): string | null {
    const isLive = (id: string | null | undefined): id is string => !!id && this.records.get(id)?.deletedAt === undefined;
    const tab = this.tab?.get();
    if (isLive(tab)) return tab;
    if (isLive(this.metaCurrent)) return this.metaCurrent;
    return this.mostRecent();
  }

  mostRecent(except?: string): string | null {
    let best: OutfitRecord | undefined;
    for (const record of this.records.values())
      if (record.deletedAt === undefined && record.id !== except && (!best || record.updatedAt > best.updatedAt)) best = record;
    return best?.id ?? null;
  }

  // ---------------------------------------------------------------- changing

  select(id: string) {
    if (this.records.get(id)?.deletedAt !== undefined) return;
    this.current = { kind: "record", id };
    this.tab?.set(id);
    this.metaCurrent = id;
    this.queue = this.queue.then(() => this.backend.updateMeta(meta =>
      ({ ...(isObject(meta) ? meta : {}), v: SCHEMA_VERSION, currentId: id }))).catch(error => this.fail(error));
    this.changed();
  }

  setDraft(draft: Draft) {
    this.current = { kind: "draft", draft };
    this.changed();
  }

  /** A new outfit, or null at the cap (nothing is evicted to make room). */
  create(content: { name: string; slots: SlotMap; labels?: SlotMap; generated?: boolean }): OutfitRecord | null {
    if (this.liveCount() >= this.cap) return null;
    return this.addRecord(content);
  }

  // Uncapped: recovered work (a conflict fork, a journal replay) is kept even past the cap.
  private addRecord(content: { name: string; slots: SlotMap; labels?: SlotMap; generated?: boolean }) {
    const time = this.now();
    const record: OutfitRecord = { v: SCHEMA_VERSION, id: this.newId(), rev: 1, writer: this.writer,
      name: cleanName(content.name) || "Outfit", createdAt: time, updatedAt: time, slots: { ...content.slots } };
    if (content.labels) record.labels = { ...content.labels };
    if (content.generated) record.generated = true;
    this.records.set(record.id, record);
    this.dirty.add(record.id);
    this.journal?.write(record.id, { record });
    this.scheduleWrite();
    this.changed();
    return record;
  }

  /** A copy with a fresh id. Fields this version does not know are NOT copied: they may identify the original. */
  duplicate(id: string): OutfitRecord | null {
    const source = this.records.get(id);
    if (!source || source.deletedAt !== undefined) return null;
    return this.create({ name: uniqueName(`${source.name} copy`, this.liveNames()), slots: source.slots,
      labels: source.labels });
  }

  rename(id: string, name: string) {
    const clean = cleanName(name);
    const record = this.records.get(id);
    if (!record || !clean || clean === record.name) return;
    this.touch(id, r => ({ ...r, name: clean }));
  }

  setContent(id: string, slots: SlotMap, labels: SlotMap | undefined, generated: boolean) {
    const record = this.records.get(id);
    if (!record) return;
    if (sameMap(record.slots, slots) && sameMap(record.labels, labels) && !!record.generated === generated) return;
    this.touch(id, r => {
      const next: OutfitRecord = { ...r, slots: { ...slots } };
      if (labels) next.labels = { ...labels }; else delete next.labels;
      if (generated) next.generated = true; else delete next.generated;
      return next;
    });
  }

  /** Tombstone: the record stays in storage with `deletedAt`, so a sync cannot bring an old copy back. */
  remove(id: string) {
    const record = this.records.get(id);
    if (!record || record.deletedAt !== undefined) return;
    this.touch(id, r => ({ ...r, deletedAt: this.now() }));
  }

  undelete(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.deletedAt === undefined) return false;
    if (this.liveCount() >= this.cap) return false;
    this.touch(id, r => { const next = { ...r }; delete next.deletedAt; return next; });
    return true;
  }

  dismissNotice() {
    if (!this.notice) return;
    this.notice = undefined;
    this.changed();
  }

  private touch(id: string, change: (record: OutfitRecord) => OutfitRecord) {
    const record = this.records.get(id)!;
    const next: OutfitRecord = { ...change(record), rev: record.rev + 1, writer: this.writer,
      updatedAt: Math.max(this.now(), record.updatedAt + 1) };
    this.records.set(id, next);
    this.dirty.add(id);
    this.journal?.write(id, { record: next, base: this.confirmed.get(id) });
    this.scheduleWrite();
    this.changed();
  }

  // ---------------------------------------------------------------- writing

  private scheduleWrite() {
    this.cancelTimer?.();
    this.cancelTimer = this.schedule(() => { this.cancelTimer = undefined; void this.flush(); }, this.debounceMs);
  }

  /** Write every pending change now (page hidden, page unloading, tests). Resolves when the backend has them. */
  flush(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.queue = this.queue.then(() => this.writeDirty()).catch(error => this.fail(error));
    return this.queue;
  }

  private async writeDirty() {
    let wrote = false;
    for (const id of [...this.dirty]) {
      // Snapshot at write time, not at schedule time: the newest edit is the one that lands.
      const mine = this.records.get(id);
      if (!mine) { this.dirty.delete(id); continue; }
      const base = this.confirmed.get(id);
      let verdict = "write" as Verdict; // assigned inside the transaction callback
      let stored = undefined as OutfitRecord | undefined;
      try {
        await this.backend.update(id, raw => {
          stored = readRecord(raw);
          verdict = judge(stored, mine, base, this.writer);
          return verdict === "write" ? mergeForWrite(raw, mine) : undefined;
        });
      } catch (error) {
        this.fail(error);
        return; // stays dirty (and journaled); the next change or flush retries
      }
      this.failure = undefined;
      if (verdict === "conflict" && stored) this.resolveConflict(mine, stored);
      else {
        this.confirmed.set(id, mine.rev);
        if (this.records.get(id)?.rev === mine.rev) this.dirty.delete(id);
        this.journal?.settle(id, mine.rev);
        wrote = true;
      }
    }
    if (wrote) this.channel?.post();
    if (this.dirty.size && !this.cancelTimer) this.scheduleWrite();
    this.changed();
  }

  private resolveConflict(mine: OutfitRecord, stored: OutfitRecord) {
    const id = mine.id;
    this.records.set(id, stored);
    this.confirmed.set(id, stored.rev);
    this.dirty.delete(id);
    this.journal?.settle(id, mine.rev);
    if (mine.deletedAt !== undefined) {
      // A deletion never beats someone else's edit: their version stays.
      this.notice = `“${stored.name}” was changed in another tab, so it was not deleted.`;
      return;
    }
    const copy = this.addRecord({ name: uniqueName(mine.name, this.liveNames(), { paren: true }), slots: mine.slots,
      labels: mine.labels, generated: mine.generated });
    if (this.current?.kind === "record" && this.current.id === id) this.select(copy.id);
    this.notice = isReadOnly(stored)
      ? `“${stored.name}” was saved by a newer version of the site, so your changes were saved as “${copy.name}”.`
      : `“${stored.name}” was changed in another tab, so your version was saved as “${copy.name}”.`;
  }

  /** Re-read storage after another tab wrote. Outfits with no local changes take the stored version. */
  async refresh(): Promise<void> {
    let raws: unknown[];
    try { raws = await this.backend.readAll(); } catch (error) { this.fail(error); return; }
    const seen = new Set<string>();
    for (const raw of raws) {
      const stored = readRecord(raw);
      if (!stored) continue;
      seen.add(stored.id);
      const mine = this.records.get(stored.id);
      if (this.dirty.has(stored.id)) continue; // our pending write decides
      if (!mine || mine.rev !== stored.rev || mine.writer !== stored.writer) {
        this.records.set(stored.id, stored);
        this.confirmed.set(stored.id, stored.rev);
      }
    }
    // Confirmed outfits that vanished from storage (site data cleared under an open tab): write them back.
    for (const id of this.records.keys()) if (!seen.has(id) && this.confirmed.has(id)) this.dirty.add(id);
    if (this.dirty.size) this.scheduleWrite();
    this.changed();
  }

  close() {
    this.stopListening?.();
    this.cancelTimer?.();
  }

  private fail(error: unknown) {
    this.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn("[saved outfits] storage failed", error);
    this.changed();
  }

  private changed() {
    this.snap = undefined;
    for (const listener of this.listeners) listener();
  }
}
