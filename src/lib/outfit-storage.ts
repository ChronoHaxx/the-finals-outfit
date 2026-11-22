// Browser storage for saved outfits (the core is src/lib/outfit-library.ts).
//
// IndexedDB first, localStorage if IndexedDB is missing, blocked or hangs, and memory if both are blocked,
// in which case the app keeps working and says saving is off. Every storage access is wrapped: a private
// window, blocked site data or a full disk throws from places that look harmless (even reading
// `window.localStorage`).
import { readRecord, type Channel, type Journal, type OutfitBackend, type TabMemory } from "./outfit-library";

const DB_VERSION = 1;
const META = "meta";

/** Where one kind of record lives: its IndexedDB database and every browser-storage key, all under one root. Saved
 *  outfits use `finals-outfit`; squads (lib/squad-library.ts, 22 Nov 2026) the disjoint `finals-squad`. The roots must
 *  never nest: the localStorage backend, the journal and the storage-event listener find their records by key prefix,
 *  so a squad key under `finals-outfit:outfit:` would be read back as an outfit. Each kind also has its own database,
 *  not a second object store in the other's (that would need a version bump another open tab can block). */
export interface StorageNames {
  /** IndexedDB database name, and its object store for records. */
  db: string;
  store: string;
  /** localStorage: record key prefix, meta key, journal key prefix; sessionStorage: this tab's current record. */
  records: string;
  meta: string;
  journal: string;
  tab: string;
  /** BroadcastChannel name. */
  channel: string;
  /** For console messages. */
  label: string;
  /** A stored record's id and last edit, for adopting localStorage copies into IndexedDB (newest copy wins). */
  stamp(raw: unknown): { id: string; updatedAt: number } | undefined;
}

/** Saved outfits: the names they have always had. */
export const OUTFIT_STORAGE: StorageNames = {
  db: "finals-outfit", store: "outfits", records: "finals-outfit:outfit:", meta: "finals-outfit:meta",
  journal: "finals-outfit:journal:", tab: "finals-outfit:tab-current", channel: "finals-outfit", label: "saved outfits",
  stamp: readRecord,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function parse(text: string | null): unknown {
  if (text === null) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Reading `window.localStorage` itself throws when site data is blocked. */
function safeStorage(read: () => Storage | undefined): Storage | undefined {
  try { return read(); } catch { return undefined; }
}

function storageWorks(storage: Storage | undefined): storage is Storage {
  if (!storage) return false;
  try {
    const key = "finals-outfit:probe";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function keysWithPrefix(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

// ------------------------------------------------------------------ IndexedDB

function openDatabase(factory: IDBFactory, timeoutMs: number, names: StorageNames): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // open() can hang for good: another tab holding an older version, or browser bugs.
    const timer = setTimeout(() => { settled = true; reject(new Error("IndexedDB did not open in time")); }, timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(names.db, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(names.store)) db.createObjectStore(names.store, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(request.error ?? new Error("IndexedDB failed to open"));
    };
  });
}

/** Resolves when the transaction commits. A full disk shows up here, as an abort, not as a throw from put(). */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => { /* the abort that follows rejects */ };
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class IndexedDbBackend implements OutfitBackend {
  readonly kind = "indexeddb" as const;
  readonly persistent = true;
  private db?: IDBDatabase;

  constructor(private readonly factory: IDBFactory, private readonly timeoutMs: number,
    private readonly names: StorageNames = OUTFIT_STORAGE) {}

  async connect(): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDatabase(this.factory, this.timeoutMs, this.names);
    } catch (error) {
      if (error instanceof Error && /in time/.test(error.message)) throw error;
      db = await openDatabase(this.factory, this.timeoutMs, this.names); // Safari's first open can fail once
    }
    // A newer version of the site in another tab wants to upgrade: let it, and reopen on next use.
    db.onversionchange = () => { db.close(); if (this.db === db) this.db = undefined; };
    db.onclose = () => { if (this.db === db) this.db = undefined; };
    this.db = db;
    // Opening is not enough: Firefox private windows used to open and then fail every write.
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(Date.now(), "probe");
    await committed(tx);
  }

  private async database(): Promise<IDBDatabase> {
    if (!this.db) await this.connect();
    return this.db!;
  }

  async readAll(): Promise<unknown[]> {
    const db = await this.database();
    return result(db.transaction(this.names.store, "readonly").objectStore(this.names.store).getAll());
  }

  async update(id: string, fn: (stored: unknown) => unknown): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(this.names.store, "readwrite");
    const done = committed(tx);
    const store = tx.objectStore(this.names.store);
    const get = store.get(id);
    let failure: unknown;
    // fn stays synchronous: awaiting anything else here would let the transaction commit early.
    get.onsuccess = () => {
      try {
        const next = fn(get.result);
        if (next !== undefined) store.put(next);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
  }

  async readMeta(): Promise<unknown> {
    const db = await this.database();
    return result(db.transaction(META, "readonly").objectStore(META).get("meta"));
  }

  async updateMeta(fn: (stored: unknown) => unknown): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(META, "readwrite");
    const done = committed(tx);
    const store = tx.objectStore(META);
    const get = store.get("meta");
    get.onsuccess = () => {
      try { store.put(fn(get.result), "meta"); } catch { tx.abort(); }
    };
    await done;
  }
}

// ------------------------------------------------------------------ localStorage

export class LocalStorageBackend implements OutfitBackend {
  readonly kind = "localstorage" as const;
  readonly persistent = true;
  constructor(private readonly storage: Storage, private readonly names: StorageNames = OUTFIT_STORAGE) {}

  async readAll(): Promise<unknown[]> {
    return keysWithPrefix(this.storage, this.names.records).map(key => parse(this.storage.getItem(key)));
  }

  async update(id: string, fn: (stored: unknown) => unknown): Promise<void> {
    const key = this.names.records + id;
    const next = fn(parse(this.storage.getItem(key)));
    if (next !== undefined) this.storage.setItem(key, JSON.stringify(next));
  }

  async readMeta(): Promise<unknown> {
    return parse(this.storage.getItem(this.names.meta));
  }

  async updateMeta(fn: (stored: unknown) => unknown): Promise<void> {
    this.storage.setItem(this.names.meta, JSON.stringify(fn(parse(this.storage.getItem(this.names.meta)))));
  }
}

// ------------------------------------------------------------------ memory

/** Nothing survives the tab. `persistent` is true only for the durable stand-in tests use across "visits". */
export class MemoryBackend implements OutfitBackend {
  readonly kind = "memory" as const;
  readonly records = new Map<string, string>();
  meta: string | undefined;
  constructor(readonly persistent = false) {}

  async readAll(): Promise<unknown[]> {
    return [...this.records.values()].map(text => JSON.parse(text));
  }

  async update(id: string, fn: (stored: unknown) => unknown): Promise<void> {
    const stored = this.records.get(id);
    const next = fn(stored === undefined ? undefined : JSON.parse(stored));
    if (next !== undefined) this.records.set(id, JSON.stringify(next));
  }

  async readMeta(): Promise<unknown> {
    return this.meta === undefined ? undefined : JSON.parse(this.meta);
  }

  async updateMeta(fn: (stored: unknown) => unknown): Promise<void> {
    this.meta = JSON.stringify(fn(await this.readMeta()));
  }
}

// ------------------------------------------------------------------ journal, tab memory, channel

/** The synchronous journal; `prefix` is the kind's journal key prefix (saved outfits' by default). */
export function storageJournal(storage: Storage, prefix = OUTFIT_STORAGE.journal): Journal {
  return {
    write(id, entry) {
      try { storage.setItem(prefix + id, JSON.stringify(entry)); } catch { /* the backend write still runs */ }
    },
    settle(id, rev) {
      try {
        const entry = parse(storage.getItem(prefix + id));
        const journaled = isObject(entry) && isObject(entry.record) ? entry.record.rev : undefined;
        if (typeof journaled !== "number" || journaled <= rev) storage.removeItem(prefix + id);
      } catch { /* an unsettled entry is replayed harmlessly: it matches what is stored */ }
    },
    readAll() {
      try { return keysWithPrefix(storage, prefix).map(key => parse(storage.getItem(key))); } catch { return []; }
    },
  };
}

function tabMemory(storage: Storage | undefined, key: string): TabMemory | undefined {
  if (!storageWorks(storage)) return undefined;
  return {
    get() { try { return storage.getItem(key); } catch { return null; } },
    set(id) { try { storage.setItem(key, id); } catch { /* falls back to the shared last-used record */ } },
  };
}

function browserChannel(names: StorageNames): Channel {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(names.channel); } catch { /* old browser: the storage event still covers localStorage */ }
  return {
    post() { try { channel?.postMessage("changed"); } catch { /* closed */ } },
    listen(onChange) {
      const message = () => onChange();
      const storage = (event: StorageEvent) => { if (event.key?.startsWith(names.records)) onChange(); };
      channel?.addEventListener("message", message);
      window.addEventListener("storage", storage);
      return () => {
        channel?.removeEventListener("message", message);
        window.removeEventListener("storage", storage);
      };
    },
  };
}

// ------------------------------------------------------------------ choosing a backend

export interface StorageEnvironment {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
  sessionStorage?: Storage;
  timeoutMs?: number;
}

export interface OpenedStorage {
  backend: OutfitBackend;
  journal?: Journal;
  tab?: TabMemory;
  channel?: Channel;
}

function browserEnvironment(): StorageEnvironment {
  const scope = globalThis as { indexedDB?: IDBFactory; localStorage?: Storage; sessionStorage?: Storage };
  return {
    indexedDB: (() => { try { return scope.indexedDB; } catch { return undefined; } })(),
    localStorage: safeStorage(() => scope.localStorage),
    sessionStorage: safeStorage(() => scope.sessionStorage),
  };
}

/** Never rejects. Falls back IndexedDB -> localStorage -> memory. */
export async function openOutfitStorage(env: StorageEnvironment = browserEnvironment()): Promise<OpenedStorage> {
  return openRecordStorage(OUTFIT_STORAGE, env);
}

/** The same for any kind of record under its own names (squads: lib/squad-storage.ts). Never rejects. */
export async function openRecordStorage(names: StorageNames, env: StorageEnvironment = browserEnvironment()): Promise<OpenedStorage> {
  const local = storageWorks(env.localStorage) ? env.localStorage : undefined;
  const extras = {
    journal: local ? storageJournal(local, names.journal) : undefined,
    tab: tabMemory(env.sessionStorage, names.tab),
    channel: typeof window === "undefined" ? undefined : browserChannel(names),
  };
  if (env.indexedDB) {
    try {
      const backend = new IndexedDbBackend(env.indexedDB, env.timeoutMs ?? 3000, names);
      await backend.connect();
      if (local) await adoptLocalStorageRecords(local, backend, names);
      return { backend, ...extras };
    } catch (error) {
      console.warn(`[${names.label}] IndexedDB unavailable, trying localStorage`, error);
    }
  }
  if (local) return { backend: new LocalStorageBackend(local, names), ...extras };
  console.warn(`[${names.label}] no browser storage: saving is off`);
  return { backend: new MemoryBackend(false), ...extras };
}

/** Records saved while IndexedDB was unavailable move into it, newest copy of each record winning. */
async function adoptLocalStorageRecords(storage: Storage, backend: OutfitBackend, names: StorageNames) {
  for (const key of keysWithPrefix(storage, names.records)) {
    const raw = parse(storage.getItem(key));
    const incoming = names.stamp(raw);
    if (!incoming) continue;
    await backend.update(incoming.id, stored => {
      const existing = names.stamp(stored);
      return !existing || incoming.updatedAt > existing.updatedAt ? raw : undefined;
    });
    // Only after the transaction committed.
    try { storage.removeItem(key); } catch { /* left in place; adopted again next time, harmlessly */ }
  }
}

/** Ask the browser not to evict saved outfits under storage pressure. Called once, after a deliberate save. */
let persistenceAsked = false;
export function requestPersistentStorage() {
  if (persistenceAsked) return;
  persistenceAsked = true;
  try { void navigator.storage?.persist?.().catch(() => undefined); } catch { /* unsupported */ }
}
