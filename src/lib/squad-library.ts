// Squads: several contestants standing together (multi-character design, _docs/multi-character-2026-11-11, Phase 2),
// kept in this browser and written as you go.
//
// A sibling of outfit-library.ts with the same rules and the same browser backends (outfit-storage.ts, under the
// disjoint `finals-squad` root: SQUAD_STORAGE below). Saved outfits are never read or written here, and their code
// does not change. The differences:
// - Two kinds of record in one store: a squad (name, camera) and a contestant (one character: its own COPY of an
//   outfit, its place on the floor and its pose). A contestant names its squad by id. Because each contestant is its
//   own record, two tabs editing different contestants of one squad never conflict: they merge contestant by
//   contestant. A write never rebuilds a squad from what is on screen, so a squad of three opened on a phone that shows
//   two keeps the third through every edit.
// - Copies, not links: a contestant copies the whole outfit (every field, known or not, minus the outfit's own
//   bookkeeping), so deleting or editing the saved outfit cannot change the squad, and a field a newer site adds to
//   outfits (dyes, say) comes along.
// - The rest as for outfits: every record has an id, a write counter (`rev`) and timestamps; deleting writes a tombstone
//   (`deletedAt`) with undo; a write is a read-modify-write of one record that keeps fields this version does not
//   know; edits go to memory, then a synchronous journal, then the backend after a short debounce (a killed tab is
//   replayed on the next visit); a record that moved on in another tab is never overwritten (this tab's version is
//   kept as a copy); a record from a newer schema is never overwritten; caps refuse, never evict.

import {
  cleanName, makeId, uniqueName, type Channel, type Journal, type OutfitBackend, type SaveStatus, type SlotMap, type TabMemory,
} from "./outfit-library";
import { openRecordStorage, type StorageEnvironment, type StorageNames } from "./outfit-storage";
import { samePlayerNumber, storedPlayerNumber } from "./player-number";

export const SQUAD_SCHEMA_VERSION = 1;
/** Live squads kept in this browser. */
export const SQUAD_CAP = 30;
/** Contestants per squad: the most any device shows (desktop 3; phones show the first 2 and keep the rest). */
export const CONTESTANT_CAP = 3;
const DEBOUNCE_MS = 300;

/** Where squads live: their own IndexedDB database and keys, never under the saved outfits' `finals-outfit` root. */
export const SQUAD_STORAGE: StorageNames = {
  db: "finals-squad", store: "records", records: "finals-squad:record:", meta: "finals-squad:meta",
  journal: "finals-squad:journal:", tab: "finals-squad:tab-current", channel: "finals-squad", label: "squads",
  stamp: raw => readSquadRecord(raw),
};

/** Squad storage in this browser (IndexedDB, else localStorage, else memory). Never rejects. */
export const openSquadStorage = (env?: StorageEnvironment) => openRecordStorage(SQUAD_STORAGE, env);

/** On the floor: metres from the centre of the stage, and a turn about the vertical axis in degrees (0 faces the
 *  default camera). Nothing else: a contestant who floats or leans is a bug, not a feature. */
export interface Place { x: number; z: number; yaw: number }
/** What the contestant is doing: a clip, a time in seconds, and whether it is held there. */
export interface Pose { clip: string; time: number; paused: boolean }
export interface SquadCamera { position: [number, number, number]; target: [number, number, number]; fov: number }

interface RecordBase {
  v: number;
  id: string;
  /** Write counter. Conflicts are detected by comparing it with the counter this tab last read. */
  rev: number;
  /** The tab session that made this revision. */
  writer?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  [field: string]: unknown;
}

export interface SquadRecord extends RecordBase {
  kind: "squad";
  name: string;
  camera?: SquadCamera;
}

export interface ContestantRecord extends RecordBase {
  kind: "contestant";
  /** The squad's id. */
  squad: string;
  /** Slot -> item id, exactly as copied or left (may hold ids the catalogue no longer has). */
  slots: SlotMap;
  labels?: SlotMap;
  bodyType?: string;
  playerNumber?: number;
  /** Where the copy came from; shown, never followed. */
  from?: { outfitId: string; name: string };
  place: Place;
  pose?: Pose | null;
}

export type SquadStoreRecord = SquadRecord | ContestantRecord;

/** What a new contestant shows: a copy of an outfit's content, plus where it stands. */
export interface ContestantContent {
  slots: SlotMap;
  labels?: SlotMap;
  bodyType?: string;
  playerNumber?: number | null;
  from?: { outfitId: string; name: string };
  place: Place;
  pose?: Pose | null;
  /** Fields an outfit carried that this version does not know: copied along. */
  extra?: Record<string, unknown>;
}

const COMMON_FIELDS = ["v", "id", "rev", "writer", "kind", "createdAt", "updatedAt", "deletedAt"] as const;
const SQUAD_FIELDS = [...COMMON_FIELDS, "name", "camera"] as const;
const CONTESTANT_FIELDS = [...COMMON_FIELDS, "squad", "slots", "labels", "bodyType", "playerNumber", "from", "place", "pose"] as const;
const fieldsOf = (record: SquadStoreRecord): readonly string[] => record.kind === "squad" ? SQUAD_FIELDS : CONTESTANT_FIELDS;
/** An outfit's own bookkeeping, never copied into a contestant. */
const OUTFIT_BOOKKEEPING = new Set(["v", "id", "rev", "writer", "name", "createdAt", "updatedAt", "deletedAt", "generated"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function stringMap(value: unknown): SlotMap {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
}

function readVector(value: unknown): [number, number, number] | undefined {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n))
    ? [value[0], value[1], value[2]] : undefined;
}

function readCamera(value: unknown): SquadCamera | undefined {
  if (!isObject(value)) return undefined;
  const position = readVector(value.position), target = readVector(value.target);
  const fov = finite(value.fov, NaN);
  return position && target && fov > 0 && fov < 180 ? { position, target, fov } : undefined;
}

export function readPlace(value: unknown): Place {
  const raw = isObject(value) ? value : {};
  return { x: finite(raw.x, 0), z: finite(raw.z, 0), yaw: finite(raw.yaw, 0) };
}

function readPose(value: unknown): Pose | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || typeof value.clip !== "string" || !value.clip) return undefined;
  return { clip: value.clip, time: Math.max(0, finite(value.time, 0)), paused: value.paused === true };
}

/** Validate a stored record of either kind, keeping every field it carries. Undefined: unusable here (no id, or a kind
 *  this version does not know); such a record is left in storage untouched, never overwritten. */
export function readSquadRecord(raw: unknown): SquadStoreRecord | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const common = { v: finite(raw.v, SQUAD_SCHEMA_VERSION), id: raw.id, rev: finite(raw.rev, 0),
    createdAt: finite(raw.createdAt, 0), updatedAt: finite(raw.updatedAt, 0) };
  let record: SquadStoreRecord;
  if (raw.kind === "squad") {
    record = { ...raw, ...common, kind: "squad", name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Squad" };
    const camera = readCamera(raw.camera);
    if (camera) record.camera = camera; else delete record.camera;
  } else if (raw.kind === "contestant") {
    if (typeof raw.squad !== "string" || !raw.squad) return undefined;
    record = { ...raw, ...common, kind: "contestant", squad: raw.squad, slots: stringMap(raw.slots), place: readPlace(raw.place) };
    if (raw.labels === undefined) delete record.labels; else record.labels = stringMap(raw.labels);
    if (typeof raw.bodyType !== "string" || !raw.bodyType) delete record.bodyType;
    if (storedPlayerNumber(raw.playerNumber) === null) delete record.playerNumber;
    const from = raw.from;
    if (isObject(from) && typeof from.outfitId === "string" && typeof from.name === "string")
      record.from = { outfitId: from.outfitId, name: from.name };
    else delete record.from;
    const pose = readPose(raw.pose);
    if (pose === undefined) delete record.pose; else record.pose = pose;
  } else {
    return undefined;
  }
  if (typeof raw.writer !== "string") delete record.writer;
  if (typeof raw.deletedAt !== "number") delete record.deletedAt;
  return record;
}

/** A record from a newer app version: shown, never overwritten. */
export const isReadOnly = (record: SquadStoreRecord) => record.v > SQUAD_SCHEMA_VERSION;

/** Read, change, write back: unknown fields come from the stored copy (or, for a record not stored yet, from ours: a
 *  contestant copied from an outfit brings the outfit's extra fields), the known ones are ours. */
function mergeForWrite(stored: unknown, mine: SquadStoreRecord): Record<string, unknown> {
  const known = fieldsOf(mine);
  const base: Record<string, unknown> = isObject(stored) ? { ...stored } : { ...mine };
  for (const key of known) delete base[key];
  const out: Record<string, unknown> = { ...base };
  for (const key of known) if (mine[key] !== undefined) out[key] = mine[key];
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameMap = (a: SlotMap | undefined, b: SlotMap | undefined) => {
  const left = Object.entries(a ?? {}), right = b ?? {};
  return left.length === Object.keys(right).length && left.every(([k, v]) => right[k] === v);
};

export function sameContent(a: SquadStoreRecord, b: SquadStoreRecord): boolean {
  if (a.kind !== b.kind || a.deletedAt !== b.deletedAt) return false;
  if (a.kind === "squad" && b.kind === "squad") return a.name === b.name && sameJson(a.camera, b.camera);
  if (a.kind === "contestant" && b.kind === "contestant")
    return a.squad === b.squad && sameMap(a.slots, b.slots) && sameMap(a.labels, b.labels)
      && (a.bodyType ?? "") === (b.bodyType ?? "") && samePlayerNumber(a.playerNumber, b.playerNumber)
      && sameJson(a.from, b.from) && sameJson(a.place, b.place) && sameJson(a.pose, b.pose);
  return false;
}

/** A contestant's content from a saved outfit (or any outfit-shaped record): everything but its bookkeeping. */
export function contestantFromOutfit(outfit: Record<string, unknown> & { slots: SlotMap }, place: Place,
  from?: { outfitId: string; name: string }): ContestantContent {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(outfit))
    if (!OUTFIT_BOOKKEEPING.has(key) && !(CONTESTANT_FIELDS as readonly string[]).includes(key)) extra[key] = value;
  const playerNumber = storedPlayerNumber(outfit.playerNumber);
  return {
    slots: { ...outfit.slots },
    ...(isObject(outfit.labels) ? { labels: stringMap(outfit.labels) } : {}),
    ...(typeof outfit.bodyType === "string" && outfit.bodyType ? { bodyType: outfit.bodyType } : {}),
    ...(playerNumber !== null ? { playerNumber } : {}),
    ...(from ? { from } : {}),
    place,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

/** A contestant's content, for a copy (a fork). Its unknown fields come along: they are the copy's content. */
function contentOf(record: ContestantRecord): ContestantContent {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) if (!(CONTESTANT_FIELDS as readonly string[]).includes(key)) extra[key] = value;
  return { slots: record.slots, labels: record.labels, bodyType: record.bodyType, playerNumber: record.playerNumber,
    from: record.from, place: record.place, pose: record.pose, ...(Object.keys(extra).length ? { extra } : {}) };
}

type Verdict = "write" | "same" | "conflict";

function judge(stored: SquadStoreRecord | undefined, mine: SquadStoreRecord, base: number | undefined, writer: string): Verdict {
  if (!stored) return "write"; // new, or storage cleared under an open tab: writing it back loses nothing
  if (stored.rev === mine.rev && stored.writer === mine.writer && sameContent(stored, mine)) return "same";
  if (isReadOnly(stored)) return "conflict";
  if (stored.rev === base) return "write";
  if (stored.writer === writer && stored.rev < mine.rev) return "write"; // our own journal replayed by a newer tab
  return "conflict";
}

export interface SquadSnapshot {
  status: SaveStatus;
  backend: OutfitBackend["kind"];
  /** Live squads, newest first. */
  squads: readonly SquadRecord[];
  /** Each live squad's live contestants, oldest first (the order they joined). */
  contestants: Readonly<Record<string, readonly ContestantRecord[]>>;
  current: string | null;
  cap: number;
  contestantCap: number;
  notice?: string;
  error?: string;
}

export interface SquadLibraryOptions {
  backend: OutfitBackend;
  journal?: Journal;
  channel?: Channel;
  tab?: TabMemory;
  now?: () => number;
  newId?: () => string;
  schedule?: (run: () => void, ms: number) => () => void;
  debounceMs?: number;
  cap?: number;
  contestantCap?: number;
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

const byAge = (a: SquadStoreRecord, b: SquadStoreRecord) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export class SquadLibrary {
  readonly backend: OutfitBackend;
  readonly cap: number;
  readonly contestantCap: number;
  private readonly journal?: Journal;
  private readonly channel?: Channel;
  private readonly tab?: TabMemory;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly schedule: (run: () => void, ms: number) => () => void;
  private readonly debounceMs: number;
  private readonly writer: string;

  private readonly records = new Map<string, SquadStoreRecord>();
  private readonly confirmed = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private cancelTimer?: () => void;
  private current: string | null = null;
  private metaCurrent: string | null = null;
  private failure?: string;
  private notice?: string;
  private listeners = new Set<() => void>();
  private snap?: SquadSnapshot;
  private stopListening?: () => void;
  /** The last createdAt this tab gave out: strictly increasing, so records made in one millisecond keep their order. */
  private lastCreated = 0;

  private constructor(options: SquadLibraryOptions) {
    this.backend = options.backend;
    this.journal = options.journal;
    this.channel = options.channel;
    this.tab = options.tab;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? makeId;
    this.schedule = options.schedule ?? defaultSchedule;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.cap = options.cap ?? SQUAD_CAP;
    this.contestantCap = options.contestantCap ?? CONTESTANT_CAP;
    this.writer = makeId();
  }

  /** Load every record, replay the journal of a tab that died with unsaved changes, and start listening. */
  static async open(options: SquadLibraryOptions): Promise<SquadLibrary> {
    const library = new SquadLibrary(options);
    await library.load();
    library.replayJournal();
    library.stopListening = library.channel?.listen(() => void library.refresh());
    if (library.dirty.size) library.scheduleWrite();
    return library;
  }

  private async load() {
    try {
      for (const raw of await this.backend.readAll()) {
        const record = readSquadRecord(raw);
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
      const entry = readSquadRecord(raw.record);
      const base = typeof raw.base === "number" ? raw.base : undefined;
      if (!entry) continue;
      const stored = this.records.get(entry.id);
      const ownLater = !!stored && stored.writer === entry.writer && stored.rev < entry.rev;
      if (stored && sameContent(stored, entry)) {
        this.journal?.settle(entry.id, entry.rev);
      } else if (!stored || ((stored.rev === base || ownLater) && !isReadOnly(stored))) {
        // The backend never got this revision: it is the newest copy of the work.
        this.records.set(entry.id, entry);
        this.dirty.add(entry.id);
      } else {
        // Changed elsewhere after this entry was made: keep both.
        if (entry.deletedAt === undefined) this.keepCopy(entry, "Recovered unsaved changes");
        this.journal?.settle(entry.id, entry.rev);
      }
    }
  }

  // ---------------------------------------------------------------- reading

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): SquadSnapshot {
    if (this.snap) return this.snap;
    const live = [...this.records.values()].filter(r => r.deletedAt === undefined);
    const squads = live.filter((r): r is SquadRecord => r.kind === "squad")
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const contestants: Record<string, ContestantRecord[]> = {};
    for (const squad of squads) contestants[squad.id] = [];
    for (const record of live)
      if (record.kind === "contestant" && contestants[record.squad]) contestants[record.squad].push(record);
    for (const list of Object.values(contestants)) list.sort(byAge);
    this.snap = {
      status: !this.backend.persistent ? "off" : this.failure ? "error" : this.dirty.size ? "saving" : "saved",
      backend: this.backend.kind,
      squads,
      contestants,
      current: this.current,
      cap: this.cap,
      contestantCap: this.contestantCap,
      ...(this.notice ? { notice: this.notice } : {}),
      ...(this.failure ? { error: this.failure } : {}),
    };
    return this.snap;
  }

  get(id: string): SquadStoreRecord | undefined {
    return this.records.get(id);
  }

  private liveSquads(): SquadRecord[] {
    return [...this.records.values()].filter((r): r is SquadRecord => r.kind === "squad" && r.deletedAt === undefined);
  }

  /** The squad's live contestants, oldest first. */
  contestantsOf(squadId: string): ContestantRecord[] {
    return [...this.records.values()]
      .filter((r): r is ContestantRecord => r.kind === "contestant" && r.squad === squadId && r.deletedAt === undefined)
      .sort(byAge);
  }

  private isLiveSquad(id: string | null | undefined): id is string {
    const record = id ? this.records.get(id) : undefined;
    return record?.kind === "squad" && record.deletedAt === undefined;
  }

  /** This tab's last squad, else the last one any tab selected, else the most recently edited. */
  bootCurrentId(): string | null {
    const tab = this.tab?.get();
    if (this.isLiveSquad(tab)) return tab;
    if (this.isLiveSquad(this.metaCurrent)) return this.metaCurrent;
    let best: SquadRecord | undefined;
    for (const squad of this.liveSquads()) if (!best || squad.updatedAt > best.updatedAt) best = squad;
    return best?.id ?? null;
  }

  // ---------------------------------------------------------------- changing

  select(id: string) {
    if (!this.isLiveSquad(id)) return;
    this.current = id;
    this.tab?.set(id);
    this.metaCurrent = id;
    this.queue = this.queue.then(() => this.backend.updateMeta(meta =>
      ({ ...(isObject(meta) ? meta : {}), v: SQUAD_SCHEMA_VERSION, currentId: id }))).catch(error => this.fail(error));
    this.changed();
  }

  /** No current squad (the last one was deleted). Nothing is written: the next Add or New makes one, so deleting and
   *  undoing never leaves a stray empty squad behind. */
  deselect() {
    if (this.current === null) return;
    this.current = null;
    this.changed();
  }

  /** A new, empty squad ("Squad 1", "Squad 2"...), or null at the cap (nothing is evicted to make room). */
  createSquad(name?: string): SquadRecord | null {
    if (this.liveSquads().length >= this.cap) return null;
    const taken = this.liveSquads().map(s => s.name);
    return this.addSquad(name ? uniqueName(cleanName(name) || "Squad", taken) : uniqueName("Squad", taken, { numberFirst: true }));
  }

  private addSquad(name: string, camera?: SquadCamera): SquadRecord {
    const time = this.createdNow();
    const record: SquadRecord = { v: SQUAD_SCHEMA_VERSION, id: this.newId(), rev: 1, writer: this.writer, kind: "squad",
      name, createdAt: time, updatedAt: time };
    if (camera) record.camera = camera;
    this.insert(record);
    return record;
  }

  renameSquad(id: string, name: string) {
    const clean = cleanName(name);
    const record = this.records.get(id);
    if (record?.kind !== "squad" || !clean || clean === record.name) return;
    this.touch(id, r => ({ ...r, name: clean }));
  }

  setCamera(id: string, camera: SquadCamera) {
    const record = this.records.get(id);
    const clean = readCamera(camera);
    if (record?.kind !== "squad" || !clean || sameJson(record.camera, clean)) return;
    this.touch(id, r => ({ ...r, camera: clean }));
  }

  /** A new contestant in the squad, or null at the squad's cap (or for a squad that is gone). */
  addContestant(squadId: string, content: ContestantContent): ContestantRecord | null {
    if (!this.isLiveSquad(squadId) || this.contestantsOf(squadId).length >= this.contestantCap) return null;
    return this.insertContestant(squadId, content);
  }

  // Uncapped: recovered work (a conflict fork, a journal replay) is kept even past the cap.
  private insertContestant(squadId: string, content: ContestantContent): ContestantRecord {
    const time = this.createdNow();
    const record: ContestantRecord = { ...(content.extra ?? {}), v: SQUAD_SCHEMA_VERSION, id: this.newId(), rev: 1,
      writer: this.writer, kind: "contestant", squad: squadId, createdAt: time, updatedAt: time,
      slots: { ...content.slots }, place: readPlace(content.place) };
    if (content.labels) record.labels = { ...content.labels };
    if (content.bodyType) record.bodyType = content.bodyType;
    if (storedPlayerNumber(content.playerNumber) !== null) record.playerNumber = content.playerNumber!;
    if (content.from) record.from = { ...content.from };
    const pose = readPose(content.pose);
    if (pose !== undefined) record.pose = pose;
    this.insert(record);
    return record;
  }

  /** Change what a contestant wears, where it stands or what it does. Unnamed fields stay as they are; null clears
   *  `pose` (still) and `playerNumber` (each piece's own). */
  updateContestant(id: string, patch: { slots?: SlotMap; labels?: SlotMap | null; bodyType?: string; playerNumber?: number | null;
    place?: Place; pose?: Pose | null }) {
    const record = this.records.get(id);
    if (record?.kind !== "contestant") return;
    const next: ContestantRecord = { ...record };
    if (patch.slots) next.slots = { ...patch.slots };
    if (patch.labels === null) delete next.labels; else if (patch.labels) next.labels = { ...patch.labels };
    if (patch.bodyType) next.bodyType = patch.bodyType;
    if (patch.playerNumber !== undefined) {
      if (storedPlayerNumber(patch.playerNumber) === null) delete next.playerNumber; else next.playerNumber = patch.playerNumber!;
    }
    if (patch.place) next.place = readPlace(patch.place);
    if (patch.pose !== undefined) { const pose = readPose(patch.pose); if (pose === undefined) delete next.pose; else next.pose = pose; }
    if (sameContent(record, next)) return;
    this.touch(id, () => next);
  }

  /** Tombstones, with undo. A squad's contestants stay as they are under a deleted squad, so undo brings them back. */
  remove(id: string) {
    const record = this.records.get(id);
    if (!record || record.deletedAt !== undefined) return;
    this.touch(id, r => ({ ...r, deletedAt: this.now() }));
  }

  undelete(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.deletedAt === undefined) return false;
    if (record.kind === "squad" && this.liveSquads().length >= this.cap) return false;
    if (record.kind === "contestant" && this.contestantsOf(record.squad).length >= this.contestantCap) return false;
    this.touch(id, r => { const next = { ...r }; delete next.deletedAt; return next; });
    return true;
  }

  dismissNotice() {
    if (!this.notice) return;
    this.notice = undefined;
    this.changed();
  }

  private createdNow(): number {
    this.lastCreated = Math.max(this.now(), this.lastCreated + 1);
    return this.lastCreated;
  }

  private insert(record: SquadStoreRecord) {
    this.records.set(record.id, record);
    this.dirty.add(record.id);
    this.journal?.write(record.id, { record: record as never });
    this.scheduleWrite();
    this.changed();
  }

  private touch(id: string, change: (record: SquadStoreRecord) => SquadStoreRecord) {
    const record = this.records.get(id)!;
    const next = { ...change(record), rev: record.rev + 1, writer: this.writer,
      updatedAt: Math.max(this.now(), record.updatedAt + 1) } as SquadStoreRecord;
    this.records.set(id, next);
    this.dirty.add(id);
    this.journal?.write(id, { record: next as never, base: this.confirmed.get(id) });
    this.scheduleWrite();
    this.changed();
  }

  /** Keep this tab's version of a record that moved on elsewhere: a contestant becomes an extra contestant in its squad;
   *  a squad becomes a new squad holding copies of the contestants this tab shows. Uncapped (recovered work). */
  private keepCopy(mine: SquadStoreRecord, why: string): SquadStoreRecord {
    if (mine.kind === "contestant") {
      const copy = this.insertContestant(mine.squad, contentOf(mine));
      this.notice = `${why}: a contestant was kept as an extra contestant.`;
      return copy;
    }
    const copy = this.addSquad(uniqueName(mine.name, this.liveSquads().map(s => s.name), { paren: true }), mine.camera);
    for (const contestant of this.contestantsOf(mine.id)) this.insertContestant(copy.id, contentOf(contestant));
    this.notice = `${why}: “${mine.name}” was kept as “${copy.name}”.`;
    return copy;
  }

  // ---------------------------------------------------------------- writing

  private scheduleWrite() {
    this.cancelTimer?.();
    this.cancelTimer = this.schedule(() => { this.cancelTimer = undefined; void this.flush(); }, this.debounceMs);
  }

  /** Write every pending change now (page hidden, unloading, tests). Resolves when the backend has them. */
  flush(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.queue = this.queue.then(() => this.writeDirty()).catch(error => this.fail(error));
    return this.queue;
  }

  private async writeDirty() {
    let wrote = false;
    // Squads first: a forked contestant may need its squad, and a squad fork its copies.
    const order = [...this.dirty].sort((a, b) => (this.records.get(a)?.kind === "squad" ? 0 : 1) - (this.records.get(b)?.kind === "squad" ? 0 : 1));
    for (const id of order) {
      const mine = this.records.get(id);
      if (!mine) { this.dirty.delete(id); continue; }
      const base = this.confirmed.get(id);
      let verdict = "write" as Verdict;
      let stored = undefined as SquadStoreRecord | undefined;
      try {
        await this.backend.update(id, raw => {
          stored = readSquadRecord(raw);
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

  private resolveConflict(mine: SquadStoreRecord, stored: SquadStoreRecord) {
    const id = mine.id;
    this.records.set(id, stored);
    this.confirmed.set(id, stored.rev);
    this.dirty.delete(id);
    this.journal?.settle(id, mine.rev);
    if (mine.deletedAt !== undefined) {
      // A deletion never beats someone else's edit: their version stays.
      this.notice = mine.kind === "squad"
        ? `“${(stored as SquadRecord).name}” was changed in another tab, so it was not deleted.`
        : "A contestant was changed in another tab, so it was not removed.";
      return;
    }
    // A squad's copy takes the contestants this tab shows (they are separate records, untouched by this conflict).
    const copy = this.keepCopy(mine, isReadOnly(stored) ? "Saved by a newer version of the site" : "Changed in another tab");
    if (copy.kind === "squad" && this.current === id) this.select(copy.id);
  }

  /** Re-read storage after another tab wrote. Records with no local changes take the stored version. */
  async refresh(): Promise<void> {
    let raws: unknown[];
    try { raws = await this.backend.readAll(); } catch (error) { this.fail(error); return; }
    const seen = new Set<string>();
    for (const raw of raws) {
      const stored = readSquadRecord(raw);
      if (!stored) continue;
      seen.add(stored.id);
      const mine = this.records.get(stored.id);
      if (this.dirty.has(stored.id)) continue; // our pending write decides
      if (!mine || mine.rev !== stored.rev || mine.writer !== stored.writer) {
        this.records.set(stored.id, stored);
        this.confirmed.set(stored.id, stored.rev);
      }
    }
    // Confirmed records that vanished from storage (site data cleared under an open tab): write them back.
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
    console.warn("[squads] storage failed", error);
    this.changed();
  }

  private changed() {
    this.snap = undefined;
    for (const listener of this.listeners) listener();
  }
}
