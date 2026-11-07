// A saved outfit against today's catalogue: what can be worn, and which saved pieces cannot be shown.
//
// A saved outfit keeps every piece it was saved with. A piece the catalogue no longer has (or now files
// under another slot, or that clashes with another piece) is not worn, but it stays in the saved outfit
// and the outfit panel names it, until the user puts something else in that slot or removes it. So a
// catalogue edit never deletes part of someone's outfit, and the piece comes back if the item does.
import { SLOTS, type Slot } from "./slots";
import { migrateSlots } from "./outfit-slots";
import { resolveEquipmentSlots } from "./equipment";
import { filterBrowseBuild, getBrowseItem } from "./browse-catalog";
import { getItemById } from "./catalog";
import type { SlotMap } from "./outfit-library";

export type MissingReason = "gone" | "moved" | "clash";

export interface MissingPiece {
  slot: string;
  id: string;
  name?: string;
  reason: MissingReason;
  /** For "moved": the slot the catalogue files the item under now. */
  nowIn?: Slot;
}

export interface ResolvedOutfit {
  /** What to keep: the saved pieces with historical slot corrections applied. */
  slots: SlotMap;
  /** What the viewer wears. */
  build: Partial<Record<Slot, string>>;
  missing: MissingPiece[];
}

const SLOT_NAMES: ReadonlySet<string> = new Set(SLOTS);

export function resolveSavedSlots(saved: Readonly<SlotMap>, labels?: Readonly<Record<string, string>>): ResolvedOutfit {
  const known: Partial<Record<Slot, string>> = {};
  const foreign: SlotMap = {}; // a slot this version does not have (saved by a newer one): kept, not worn
  for (const [slot, id] of Object.entries(saved)) {
    if (SLOT_NAMES.has(slot)) known[slot as Slot] = id; else foreign[slot] = id;
  }
  // Same slot corrections as share links (src/lib/outfit-slots.ts), so a saved outfit and its link agree.
  const migrated = migrateSlots(known).slots;
  // Exactly the share-link filter: in this catalogue, and filed under the slot it was saved in.
  const { slots: build, removed } = resolveEquipmentSlots(filterBrowseBuild(migrated));

  const missing: MissingPiece[] = [];
  const nameOf = (id: string) => getBrowseItem(id)?.name ?? labels?.[id] ?? getItemById(id)?.name;
  for (const [slot, id] of Object.entries(migrated) as [Slot, string][]) {
    if (build[slot]) continue;
    const item = getBrowseItem(id);
    const reason: MissingReason = removed.includes(slot) ? "clash" : item ? "moved" : "gone";
    missing.push({ slot, id, name: nameOf(id), reason, ...(reason === "moved" ? { nowIn: item!.slot } : {}) });
  }
  for (const [slot, id] of Object.entries(foreign)) missing.push({ slot, id, name: labels?.[id], reason: "gone" });
  return { slots: { ...migrated, ...foreign }, build, missing };
}

/** After a hand edit: what is worn, plus the unshown pieces whose slot the user has not filled since. */
export function keepMissing(build: Readonly<Partial<Record<Slot, string | null>>>, missing: readonly MissingPiece[]):
  { slots: SlotMap; missing: MissingPiece[] } {
  const slots: SlotMap = {};
  for (const slot of SLOTS) {
    const id = build[slot];
    if (id) slots[slot] = id;
  }
  const kept = missing.filter(piece => !(piece.slot in slots));
  for (const piece of kept) slots[piece.slot] = piece.id;
  return { slots, missing: kept };
}

/** Item names to store beside the ids, keeping earlier names for pieces the catalogue no longer names. */
export function labelsFor(slots: Readonly<SlotMap>, previous?: Readonly<Record<string, string>>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const id of Object.values(slots)) {
    const name = getBrowseItem(id)?.name ?? previous?.[id] ?? getItemById(id)?.name;
    if (name) labels[id] = name;
  }
  return labels;
}

/** Same pieces worn, ignoring empty slots. */
export function sameBuild(a: Readonly<Partial<Record<string, string | null>>>, b: Readonly<Partial<Record<string, string | null>>>): boolean {
  const left = Object.entries(a).filter(([, id]) => !!id);
  return left.length === Object.values(b).filter(id => !!id).length && left.every(([slot, id]) => b[slot] === id);
}
