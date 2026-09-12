import { SLOTS, type Slot } from "./slots";
import type { Outfit } from "./outfit";

// Catalog slot corrections, applied to build state that was written down BEFORE the fix.
//
// These 31 garments were filed under `lowerBody` because the importer tested the
// lower-body modifiers `short`/`tight`/`jean` ahead of the upper-body garment names
// (see scripts/lib/catalog-slots.ts). Every one of them is a torso garment: the game
// source declares `EBodySlot::BodyUpper` and tags `Customization.Slot.BodyUpper`, and
// none of them declares `EBodySlot::BodyLower` except the five ShortDress skins, which
// the app already files as upperBody for every other dual-slot dress.
//
// Share links store the slot NAME next to the id (src/lib/outfit.ts), so an already-shared
// v1 link still says `lowerBody` for these ids. Builder drops any entry whose encoded slot
// disagrees with the catalog, so without this table every old link holding one of them
// would silently lose that garment. The table is append-only history: never edit an entry
// to match a later correction — add a new one.
const LOWER_TO_UPPER = [
  "casual-shortdress-latex",
  "casual-shortdress-nylon-red",
  "casual-shortdress-shiny",
  "casual-shortdress-translucent-candycorn",
  "casual-shortdress-translucent-green",
  "casual-shortdress-velvet",
  "cowboy-jeansjacket-denim-blackbeige",
  "cowboy-jeansjacket-denim-browngreen",
  "cowboy-jeansjacket-denim-lightblue",
  "cowboy-jeansjacket-neon",
  "streetwear-jacketshort-leather-dissun",
  "streetwear-jacketshort-metal-goldospuze",
  "streetwear-jacketshort-metal-goldwinner",
  "streetwear-tightsinglet-cotton-anubis",
  "streetwear-tightsinglet-cotton-black",
  "streetwear-tightsinglet-cotton-enorino",
  "streetwear-tightsinglet-cotton-gray",
  "streetwear-tightsinglet-cotton-green",
  "streetwear-tightsinglet-cotton-orangeevent",
  "streetwear-tightsinglet-cotton-orangeevent-a5ee",
  "streetwear-tightsinglet-cotton-ospuzestarterpack",
  "streetwear-tightsinglet-cotton-pinkcommunity",
  "streetwear-tightsinglet-cotton-starsstripes",
  "streetwear-tightsinglet-cotton-white",
  "streetwear-tightsinglet-cotton-whiteeaster",
  "streetwear-tightsinglet-cotton-whiteskillissue",
  "streetwear-tightsinglet-jerseyspeckled",
  "streetwear-tightsinglet-jerseyspeckled-ivada",
  "streetwear-tightsinglet-jerseyspeckled-refe-6bf9",
  "streetwear-tightsinglet-translucent-green",
  "streetwear-tightsingletsportevent-cotton",
] as const;

export interface SlotMigration {
  readonly from: Slot;
  readonly to: Slot;
}

export const LEGACY_SLOT_MIGRATIONS: ReadonlyMap<string, SlotMigration> = new Map(
  LOWER_TO_UPPER.map((id) => [id, { from: "lowerBody", to: "upperBody" } as const]),
);

export type SlotMap = Partial<Record<Slot, string>>;
export type DyeMap = Partial<Record<Slot, string>>;

/** One considered migration. `applied: false` means the entry was dropped, not moved. */
export interface SlotMove {
  id: string;
  from: Slot;
  to: Slot;
  applied: boolean;
  /** Id that lost the target slot to this move (never the migrated id itself). */
  displaced?: string;
  reason?: "target-already-migrated";
}

/**
 * Move known mis-slotted garments to their corrected slot, leaving everything else alone.
 *
 * Deterministic by construction — entries are considered once each, in `SLOTS` wire order:
 *
 *  - Only an entry sitting in the migration's recorded `from` slot moves. The same id
 *    encoded anywhere else is left exactly where it is, so an arbitrary invalid
 *    slot/id pair is never normalised into a valid outfit; Builder still drops it.
 *  - A move takes the target slot: the old placement is what created the invalid
 *    two-tops combination, so the migrated garment wins and the incumbent is removed.
 *    Nothing is invented to backfill the vacated slot.
 *  - If a second migration targets a slot a previous one already took, the first (wire
 *    order) keeps it and the later entry is dropped rather than overwriting it.
 *  - Dyes follow their item: the target slot's dye becomes the source slot's dye, or
 *    none, so a displaced garment's colour is never re-applied to a different garment.
 *    Dyes on untouched slots are preserved.
 *
 * Idempotent: running it on its own output changes nothing.
 */
export function migrateSlots(
  slots: Readonly<SlotMap>,
  dyes?: Readonly<DyeMap>,
  migrations: ReadonlyMap<string, SlotMigration> = LEGACY_SLOT_MIGRATIONS,
): { slots: SlotMap; dyes?: DyeMap; moves: SlotMove[] } {
  const nextSlots: SlotMap = { ...slots };
  const nextDyes: DyeMap | undefined = dyes ? { ...dyes } : undefined;
  const moves: SlotMove[] = [];
  const claimed = new Set<Slot>();

  for (const from of SLOTS) {
    const id = slots[from];
    if (!id) continue;
    const migration = migrations.get(id);
    if (!migration || migration.from !== from) continue;
    const to = migration.to;

    if (claimed.has(to)) {
      delete nextSlots[from];
      if (nextDyes) delete nextDyes[from];
      moves.push({ id, from, to, applied: false, reason: "target-already-migrated" });
      continue;
    }

    const displaced = nextSlots[to];
    delete nextSlots[from];
    nextSlots[to] = id;
    if (nextDyes) {
      const dye = nextDyes[from];
      delete nextDyes[from];
      if (dye === undefined) delete nextDyes[to];
      else nextDyes[to] = dye;
    }
    claimed.add(to);
    moves.push({
      id,
      from,
      to,
      applied: true,
      ...(displaced && displaced !== id ? { displaced } : {}),
    });
  }

  return { slots: nextSlots, ...(nextDyes ? { dyes: nextDyes } : {}), moves };
}

/** Share-link hydration: migrate slots and dyes, keeping presetName and any other field. */
export function migrateOutfit(outfit: Outfit): Outfit {
  const migrated = migrateSlots(outfit.slots, outfit.dyes);
  const next: Outfit = { ...outfit, slots: migrated.slots };
  if (migrated.dyes) next.dyes = migrated.dyes;
  return next;
}

/** Direct store loading (harnesses, future presets) — same rules, no dyes to carry. */
export function migrateBuildSlots(slots: Readonly<SlotMap>): SlotMap {
  return migrateSlots(slots).slots;
}
