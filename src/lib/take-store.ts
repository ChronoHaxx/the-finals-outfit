// Where takes live (22 Nov 2026): this browser's IndexedDB, database `finals-take` (its own root, apart from saved
// outfits' and squads'), or memory when IndexedDB is missing or blocked (the panel then says takes last only until the
// tab closes). localStorage is no fallback here: a minute of samples is about a megabyte.
//
// The user's rule, never lose their work, applied:
// - a take is saved while it records: a chunk of samples a second (lib/take-recorder.ts), its record updated in the same
//   transaction, so a closed tab, a crash or a dead battery costs at most the last second;
// - a take that stopped recording without being finished (that tab was closed) is still a take: listed as interrupted,
//   rendered from what was saved;
// - several takes are kept (MAX_TAKES). Past the cap the oldest take already rendered makes room; a take never rendered
//   is never evicted: recording is refused instead, and the panel says which takes to render or discard;
// - rendering never deletes a take; only Discard does, after the panel's confirmation;
// - every write reads the stored record and changes only its own fields, so fields a newer version wrote survive.
import { MAX_TAKES, TAKE_VERSION, decodeSamples, type TakeChunk, type TakeLookEvent, type TakeSample } from "./video-take";

/** A take's record (the samples are in its chunks). */
export interface TakeMeta {
  id: string;
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** "recording" until its tab stops it. */
  status: "recording" | "done";
  /** Seconds recorded and saved. */
  duration: number;
  /** Chunks saved (0, 1, ... chunks - 1). */
  chunks: number;
  /** Clip ids, indexed by the samples. */
  clips: string[];
  /** The site mode it was recorded in (its clips belong to that mode's set). */
  mode: string;
  /** When it was last rendered, or null. */
  renderedAt: number | null;
}

/** A recording take whose tab has written nothing for this long is taken as interrupted (its tab was closed). */
export const STALE_MS = 5000;

export type TakeState = "recording" | "interrupted" | "done";
export interface TakeEntry { meta: TakeMeta; state: TakeState }

export interface TakeBackend {
  readonly kind: "indexeddb" | "memory";
  /** False when nothing survives the tab. */
  readonly persistent: boolean;
  metas(): Promise<unknown[]>;
  /** One transaction: `change` gets the stored record (undefined if none) and returns the record to store, or
   *  undefined to write nothing at all (the chunk included). */
  write(id: string, chunk: TakeChunk | null, change: (stored: unknown) => unknown): Promise<boolean>;
  chunks(id: string): Promise<TakeChunk[]>;
  /** The record and every chunk. */
  remove(id: string): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** A stored record as this version reads it; null when it is not a take record at all. */
export function readMeta(raw: unknown): TakeMeta | null {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || raw.id.startsWith("\u0000")) return null; // "\0probe": the open check
  return {
    id: raw.id,
    version: num(raw.version, TAKE_VERSION),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Take",
    createdAt: num(raw.createdAt, 0),
    updatedAt: num(raw.updatedAt, num(raw.createdAt, 0)),
    status: raw.status === "recording" ? "recording" : "done",
    duration: Math.max(0, num(raw.duration, 0)),
    chunks: Math.max(0, Math.floor(num(raw.chunks, 0))),
    clips: Array.isArray(raw.clips) ? raw.clips.filter((c): c is string => typeof c === "string") : [],
    mode: typeof raw.mode === "string" ? raw.mode : "global",
    renderedAt: typeof raw.renderedAt === "number" ? raw.renderedAt : null,
  };
}

/** `patch` written over the stored record: its other fields (a newer version's) stay. Clips only ever grow. */
function merged(stored: unknown, patch: Partial<TakeMeta>): Record<string, unknown> {
  const base = isObject(stored) ? stored : {};
  const out: Record<string, unknown> = { ...base, ...patch };
  if (patch.clips && Array.isArray(base.clips)) out.clips = [...new Set([...base.clips.filter(c => typeof c === "string"), ...patch.clips])];
  return out;
}

export type CreateResult = { ok: true; evicted: TakeMeta[] } | { ok: false; reason: "full" | "failed"; waiting?: TakeMeta[] };

export class TakeLibrary {
  constructor(readonly backend: TakeBackend, private readonly now: () => number = Date.now) {}

  get persistent(): boolean { return this.backend.persistent; }

  /** Every take, newest first, with its state. `own`: takes this tab is recording (never stale to itself). */
  async list(own: ReadonlySet<string> = new Set()): Promise<TakeEntry[]> {
    const metas = (await this.backend.metas()).map(readMeta).filter((m): m is TakeMeta => !!m);
    return metas.sort((a, b) => b.createdAt - a.createdAt).map(meta => ({ meta,
      state: meta.status === "done" ? "done" : own.has(meta.id) || this.now() - meta.updatedAt < STALE_MS ? "recording" : "interrupted" }));
  }

  /**
   * Start a take's record. At the cap, the oldest rendered takes make room (returned as `evicted`, so the panel can
   * say so); when every take is still waiting to be rendered, nothing is evicted and the take is refused ("full").
   */
  async create(meta: TakeMeta, own: ReadonlySet<string> = new Set()): Promise<CreateResult> {
    const entries = await this.list(own);
    const evicted: TakeMeta[] = [];
    let count = entries.length;
    const rendered = entries.filter(e => e.state !== "recording" && e.meta.renderedAt !== null)
      .sort((a, b) => a.meta.createdAt - b.meta.createdAt);
    while (count >= MAX_TAKES && rendered.length) {
      const oldest = rendered.shift()!.meta;
      await this.backend.remove(oldest.id);
      evicted.push(oldest);
      count--;
    }
    if (count >= MAX_TAKES) return { ok: false, reason: "full", waiting: entries.filter(e => e.meta.renderedAt === null).map(e => e.meta) };
    try {
      const written = await this.backend.write(meta.id, null, stored => stored === undefined ? { ...meta } : undefined);
      return written ? { ok: true, evicted } : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }

  /** Save a chunk and update the record in one transaction. False when the take is gone (discarded elsewhere). */
  append(id: string, chunk: TakeChunk | null, patch: Partial<TakeMeta>): Promise<boolean> {
    return this.backend.write(id, chunk, stored => stored === undefined ? undefined : merged(stored, patch));
  }

  /** Change fields of a stored take (rename, rendered). False when it is gone. */
  update(id: string, patch: Partial<TakeMeta>): Promise<boolean> {
    return this.append(id, null, patch);
  }

  /** A take's samples and look events, in order. Chunks after a missing one are still read (each stands alone). */
  async load(id: string): Promise<{ meta: TakeMeta; samples: TakeSample[]; events: TakeLookEvent[] } | null> {
    const raw = (await this.backend.metas()).find(m => isObject(m) && m.id === id);
    const meta = readMeta(raw);
    if (!meta) return null;
    const chunks = (await this.backend.chunks(id)).sort((a, b) => a.index - b.index);
    const samples: TakeSample[] = [], events: TakeLookEvent[] = [];
    for (const chunk of chunks) {
      samples.push(...decodeSamples(chunk.samples ?? [], meta.clips));
      if (Array.isArray(chunk.events)) events.push(...chunk.events.filter(e => isObject(e) && typeof e.t === "number"));
    }
    return { meta, samples, events };
  }

  /** Delete a take for good (the panel confirms first). */
  discard(id: string): Promise<void> {
    return this.backend.remove(id);
  }
}

// ------------------------------------------------------------------ memory

/** Nothing survives the tab (persistent: false), or, for tests, a durable stand-in across "visits". */
export class MemoryTakeBackend implements TakeBackend {
  readonly kind = "memory" as const;
  readonly records = new Map<string, unknown>();
  readonly stored = new Map<string, Map<number, TakeChunk>>();
  /** Tests: make the next writes fail (a full disk). */
  failWrites = false;
  constructor(readonly persistent = false) {}

  async metas(): Promise<unknown[]> { return [...this.records.values()].map(r => structuredClone(r)); }

  async write(id: string, chunk: TakeChunk | null, change: (stored: unknown) => unknown): Promise<boolean> {
    if (this.failWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    const current = this.records.get(id);
    const next = change(current === undefined ? undefined : structuredClone(current));
    if (next === undefined) return false;
    this.records.set(id, structuredClone(next));
    if (chunk) {
      if (!this.stored.has(id)) this.stored.set(id, new Map());
      this.stored.get(id)!.set(chunk.index, structuredClone(chunk));
    }
    return true;
  }

  async chunks(id: string): Promise<TakeChunk[]> {
    return [...(this.stored.get(id)?.values() ?? [])].map(c => structuredClone(c));
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
    this.stored.delete(id);
  }
}

// ------------------------------------------------------------------ IndexedDB

const DB = "finals-take", DB_VERSION = 1, TAKES = "takes", CHUNKS = "chunks";

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => { /* the abort that follows rejects */ };
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

class IndexedDbTakeBackend implements TakeBackend {
  readonly kind = "indexeddb" as const;
  readonly persistent = true;
  private db: IDBDatabase | null = null;
  constructor(private readonly factory: IDBFactory, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      // open() can hang for good (another tab holding an older version, browser bugs).
      const timer = setTimeout(() => { settled = true; reject(new Error("IndexedDB did not open in time")); }, this.timeoutMs);
      let open: IDBOpenDBRequest;
      try { open = this.factory.open(DB, DB_VERSION); } catch (error) { clearTimeout(timer); reject(error); return; }
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["take", "index"] });
      };
      open.onsuccess = () => { if (settled) { open.result.close(); return; } settled = true; clearTimeout(timer); resolve(open.result); };
      open.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(open.error ?? new Error("IndexedDB failed to open")); };
    });
    // A newer version of the site in another tab wants to upgrade: let it, and reopen on next use.
    db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; };
    db.onclose = () => { if (this.db === db) this.db = null; };
    this.db = db;
    // Opening is not enough: some private windows open and then fail every write.
    const tx = db.transaction(TAKES, "readwrite");
    tx.objectStore(TAKES).put({ id: "\u0000probe" });
    tx.objectStore(TAKES).delete("\u0000probe");
    await done(tx);
  }

  private async database(): Promise<IDBDatabase> {
    if (!this.db) await this.connect();
    return this.db!;
  }

  async metas(): Promise<unknown[]> {
    const db = await this.database();
    return request(db.transaction(TAKES, "readonly").objectStore(TAKES).getAll());
  }

  async write(id: string, chunk: TakeChunk | null, change: (stored: unknown) => unknown): Promise<boolean> {
    const db = await this.database();
    const tx = db.transaction([TAKES, CHUNKS], "readwrite");
    const committed = done(tx);
    const takes = tx.objectStore(TAKES), get = takes.get(id);
    let wrote = false, failure: unknown;
    // `change` stays synchronous: awaiting anything here would let the transaction commit early.
    get.onsuccess = () => {
      try {
        const next = change(get.result);
        if (next === undefined) { tx.abort(); return; }
        takes.put(next);
        if (chunk) tx.objectStore(CHUNKS).put(chunk);
        wrote = true;
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await committed; } catch (error) {
      if (failure) throw failure;
      if (!wrote) return false; // aborted on purpose: nothing to write
      throw error; // a full disk shows up here, as an abort
    }
    return wrote;
  }

  async chunks(id: string): Promise<TakeChunk[]> {
    const db = await this.database();
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    return request(db.transaction(CHUNKS, "readonly").objectStore(CHUNKS).getAll(range)) as Promise<TakeChunk[]>;
  }

  async remove(id: string): Promise<void> {
    const db = await this.database();
    const tx = db.transaction([TAKES, CHUNKS], "readwrite");
    const committed = done(tx);
    tx.objectStore(TAKES).delete(id);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await committed;
  }
}

/** Never rejects: IndexedDB, else memory (takes then last until the tab closes). */
export async function openTakeLibrary(factory: IDBFactory | undefined = (() => { try { return globalThis.indexedDB; } catch { return undefined; } })(),
  timeoutMs = 3000): Promise<TakeLibrary> {
  if (factory) {
    try {
      const backend = new IndexedDbTakeBackend(factory, timeoutMs);
      await backend.connect();
      return new TakeLibrary(backend);
    } catch (error) {
      console.warn("[takes] IndexedDB unavailable: takes last until this tab closes", error);
    }
  }
  return new TakeLibrary(new MemoryTakeBackend(false));
}
