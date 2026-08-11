import rawItems from "../data/items.json";
import rawSponsors from "../data/sponsors.json";
import {
  CatalogSchema,
  SponsorsSchema,
  type Item,
  type Rarity,
  type Sponsor,
  type Source,
} from "./item";
import { SLOTS, type Slot } from "./slots";

const ITEMS: readonly Item[] = Object.freeze(CatalogSchema.parse(rawItems));
const SPONSORS: readonly Sponsor[] = Object.freeze(
  SponsorsSchema.parse(rawSponsors),
);

const SPONSOR_IDS = new Set(SPONSORS.map((s) => s.id));
for (const item of ITEMS) {
  if (item.sponsor && !SPONSOR_IDS.has(item.sponsor)) {
    throw new Error(
      `Item '${item.id}' references unknown sponsor '${item.sponsor}'`,
    );
  }
}

const BY_SLOT: Record<Slot, Item[]> = Object.fromEntries(
  SLOTS.map((s) => [s, [] as Item[]]),
) as Record<Slot, Item[]>;
for (const item of ITEMS) BY_SLOT[item.slot].push(item);

const BY_ID = new Map<string, Item>(ITEMS.map((i) => [i.id, i]));

export function getAllItems(): readonly Item[] {
  return ITEMS;
}

export function getItemsBySlot(slot: Slot): readonly Item[] {
  return BY_SLOT[slot];
}

export function getItemById(id: string): Item | undefined {
  return BY_ID.get(id);
}

export function getSponsors(): readonly Sponsor[] {
  return SPONSORS;
}

export function getSeasons(): readonly (number | "beta" | "launch")[] {
  const set = new Set<number | "beta" | "launch">();
  for (const item of ITEMS) if (item.season !== undefined) set.add(item.season);
  return [...set].sort((a, b) => {
    const rank = (v: number | "beta" | "launch") =>
      v === "beta" ? -1 : v === "launch" ? 0 : v;
    return rank(a) - rank(b);
  });
}

export function getRarities(): readonly Rarity[] {
  const set = new Set<Rarity>();
  for (const item of ITEMS) if (item.rarity !== undefined) set.add(item.rarity);
  return [...set];
}

export function getSources(): readonly Source[] {
  const set = new Set<Source>();
  for (const item of ITEMS) if (item.source !== undefined) set.add(item.source);
  return [...set];
}
