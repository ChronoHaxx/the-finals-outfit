import rawSponsors from "../data/sponsors.json";
import type { CatalogData } from "./catalog-files";
import {
  SponsorsSchema,
  type Item,
  type Rarity,
  type Sponsor,
  type Source,
} from "./item";
import { SLOTS, type Slot } from "./slots";

// The catalog JSON is fetched beside the entry chunk (catalog-load.ts) instead of being
// bundled into it, but every getter here stays synchronous: src/main.tsx renders nothing
// until installCatalog() has run, so components never observe a half-loaded catalog.
// Anything derived from the catalog must be computed on first use (derivedFromCatalog),
// never at module load, because modules evaluate before the data arrives.
// The items arrive already validated: the build ran them through CatalogSchema
// (catalog-files.ts) and serves exactly that output under a content hash.

export type CatalogSideData = Omit<CatalogData, "items">;

const SPONSORS: readonly Sponsor[] = Object.freeze(
  SponsorsSchema.parse(rawSponsors),
);
const SPONSOR_IDS = new Set(SPONSORS.map((s) => s.id));

interface Installed {
  items: readonly Item[];
  bySlot: Record<Slot, Item[]>;
  byId: Map<string, Item>;
  side: CatalogSideData;
}
let installed: Installed | undefined;
let generation = 0;

export function installCatalog(data: CatalogData): void {
  const { items: shippedItems, ...side } = data;
  const items: readonly Item[] = Object.freeze(shippedItems);
  for (const item of items) {
    if (item.sponsor && !SPONSOR_IDS.has(item.sponsor)) {
      throw new Error(
        `Item '${item.id}' references unknown sponsor '${item.sponsor}'`,
      );
    }
  }
  const bySlot = Object.fromEntries(
    SLOTS.map((s) => [s, [] as Item[]]),
  ) as Record<Slot, Item[]>;
  for (const item of items) bySlot[item.slot].push(item);
  installed = { items, bySlot, byId: new Map(items.map((i) => [i.id, i])), side };
  generation++;
}

function catalog(): Installed {
  if (!installed) {
    throw new Error("Catalog read before it loaded. Render only after loadCatalog() resolves (src/main.tsx); tests import tests/helpers/load-catalog.ts.");
  }
  return installed;
}

// Memoizes a value computed from the catalog, recomputed if a catalog is installed again.
export function derivedFromCatalog<T>(build: () => T): () => T {
  let cached: { generation: number; value: T } | undefined;
  return () => {
    catalog();
    if (cached?.generation !== generation) cached = { generation, value: build() };
    return cached.value;
  };
}

// The non-item catalog files (wiki names, share IDs, equipment slots).
export function getCatalogData(): CatalogSideData {
  return catalog().side;
}

export function getAllItems(): readonly Item[] {
  return catalog().items;
}

export function getItemsBySlot(slot: Slot): readonly Item[] {
  return catalog().bySlot[slot];
}

export function getItemById(id: string): Item | undefined {
  return catalog().byId.get(id);
}

export function getSponsors(): readonly Sponsor[] {
  return SPONSORS;
}

export function getSeasons(): readonly (number | "beta" | "launch")[] {
  const set = new Set<number | "beta" | "launch">();
  for (const item of getAllItems()) if (item.season !== undefined) set.add(item.season);
  return [...set].sort((a, b) => {
    const rank = (v: number | "beta" | "launch") =>
      v === "beta" ? -1 : v === "launch" ? 0 : v;
    return rank(a) - rank(b);
  });
}

export function getRarities(): readonly Rarity[] {
  const set = new Set<Rarity>();
  for (const item of getAllItems()) if (item.rarity !== undefined) set.add(item.rarity);
  return [...set];
}

export function getSources(): readonly Source[] {
  const set = new Set<Source>();
  for (const item of getAllItems()) if (item.source !== undefined) set.add(item.source);
  return [...set];
}
