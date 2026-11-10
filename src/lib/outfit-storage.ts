// Browser storage for saved outfits (the core is src/lib/outfit-library.ts).
//
// IndexedDB first, localStorage if IndexedDB is missing, blocked or hangs, and memory if both are blocked,
// in which case the app keeps working and says saving is off. Every storage access is wrapped: a private
// window, blocked site data or a full disk throws from places that look harmless (even reading
// `window.localStorage`).
import { readRecord, type Channel, type Journal, type OutfitBackend, type TabMemory } from "./outfit-library";

const DB_NAME = "finals-outfit";
const DB_VERSION = 1;
const OUTFITS = "outfits";
const META = "meta";
const LS_OUTFIT = "finals-outfit:outfit:";
const LS_META = "finals-outfit:meta";
const LS_JOURNAL = "finals-outfit:journal:";
const TAB_KEY = "finals-outfit:tab-current";
const CHANNEL = "finals-outfit";

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

function openDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // open() can hang for good: another tab holding an older version, or browser bugs.
    const timer = setTimeout(() => { settled = true; reject(new Error("IndexedDB did not open in time")); }, timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTFITS)) db.createObjectStore(OUTFITS, { keyPath: "id" });
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

  constructor(private readonly factory: IDBFactory, private readonly timeoutMs: number) {}

  async connect(): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDatabase(this.factory, this.timeoutMs);
    } catch (error) {
      if (error instanceof Error && /in time/.test(error.message)) throw error;
      db = await openDatabase(this.factory, this.timeoutMs); // Safari's first open can fail once
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
    return result(db.transaction(OUTFITS, "readonly").objectStore(OUTFITS).getAll());
  }

  async update(id: string, fn: (stored: unknown) => unknown): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(OUTFITS, "readwrite");
    const done = committed(tx);
    const store = tx.objectStore(OUTFITS);
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
  constructor(private readonly storage: Storage) {}

  async readAll(): Promise<unknown[]> {
    return keysWithPrefix(this.storage, LS_OUTFIT).map(key => parse(this.storage.getItem(key)));
  }

  async update(id: string, fn: (stored: unknown) => unknown): Promise<void> {
    const key = LS_OUTFIT + id;
    const next = fn(parse(this.storage.getItem(key)));
    if (next !== undefined) this.storage.setItem(key, JSON.stringify(next));
  }

  async readMeta(): Promise<unknown> {
    return parse(this.storage.getItem(LS_META));
  }

  async updateMeta(fn: (stored: unknown) => unknown): Promise<void> {
    this.storage.setItem(LS_META, JSON.stringify(fn(parse(this.storage.getItem(LS_META)))));
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

export function storageJournal(storage: Storage): Journal {
  return {
    write(id, entry) {
      try { storage.setItem(LS_JOURNAL + id, JSON.stringify(entry)); } catch { /* the backend write still runs */ }
    },
    settle(id, rev) {
      try {
        const entry = parse(storage.getItem(LS_JOURNAL + id));
        const journaled = isObject(entry) && isObject(entry.record) ? entry.record.rev : undefined;
        if (typeof journaled !== "number" || journaled <= rev) storage.removeItem(LS_JOURNAL + id);
      } catch { /* an unsettled entry is replayed harmlessly: it matches what is stored */ }
    },
    readAll() {
      try { return keysWithPrefix(storage, LS_JOURNAL).map(key => parse(storage.getItem(key))); } catch { return []; }
    },
  };
}

function tabMemory(storage: Storage | undefined): TabMemory | undefined {
  if (!storageWorks(storage)) return undefined;
  return {
    get() { try { return storage.getItem(TAB_KEY); } catch { return null; } },
    set(id) { try { storage.setItem(TAB_KEY, id); } catch { /* falls back to the shared last-used outfit */ } },
  };
}

function browserChannel(): Channel {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); } catch { /* old browser: the storage event still covers localStorage */ }
  return {
    post() { try { channel?.postMessage("changed"); } catch { /* closed */ } },
    listen(onChange) {
      const message = () => onChange();
      const storage = (event: StorageEvent) => { if (event.key?.startsWith(LS_OUTFIT)) onChange(); };
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
  const local = storageWorks(env.localStorage) ? env.localStorage : undefined;
  const extras = {
    journal: local ? storageJournal(local) : undefined,
    tab: tabMemory(env.sessionStorage),
    channel: typeof window === "undefined" ? undefined : browserChannel(),
  };
  if (env.indexedDB) {
    try {
      const backend = new IndexedDbBackend(env.indexedDB, env.timeoutMs ?? 3000);
      await backend.connect();
      if (local) await adoptLocalStorageOutfits(local, backend);
      return { backend, ...extras };
    } catch (error) {
      console.warn("[saved outfits] IndexedDB unavailable, trying localStorage", error);
    }
  }
  if (local) return { backend: new LocalStorageBackend(local), ...extras };
  console.warn("[saved outfits] no browser storage: saving is off");
  return { backend: new MemoryBackend(false), ...extras };
}

/** Outfits saved while IndexedDB was unavailable move into it, newest copy of each outfit winning. */
async function adoptLocalStorageOutfits(storage: Storage, backend: OutfitBackend) {
  for (const key of keysWithPrefix(storage, LS_OUTFIT)) {
    const raw = parse(storage.getItem(key));
    const incoming = readRecord(raw);
    if (!incoming) continue;
    await backend.update(incoming.id, stored => {
      const existing = readRecord(stored);
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
