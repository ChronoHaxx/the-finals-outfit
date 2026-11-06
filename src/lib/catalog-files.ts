import { CatalogSchema, type Item } from "./item";

// Catalog data the browser fetches beside the entry chunk instead of bundling it
// (catalog-load.ts). Each file is listed with what ships: the build validates it and keeps
// only the fields the app reads. Provenance the importers keep for their own refreshes
// (wiki page and revision IDs, input hashes, timestamps) never reaches a phone. The
// runtime types below are derived from these projections, so reading a field that is not
// shipped fails to compile instead of returning undefined.
//
// Used by the Vite plugin (vite.config.ts), the Node test loader
// (tests/helpers/load-catalog.ts) and the build check (scripts/check-catalog-split.mjs),
// so the app, the tests and CI all see the same shipped data.

export type WikiMatch = { name: string; isHidden: boolean | null; isUnreleased: boolean | null };
type Projection<Raw, Shipped> = { path: string; ship: (raw: Raw) => Shipped };
const file = <Raw, Shipped>(path: string, ship: (raw: Raw) => Shipped): Projection<Raw, Shipped> => ({ path, ship });

export const CATALOG_FILES = {
  // Validated at build time, not on the phone: CatalogSchema.parse cost about 300 ms of
  // main thread on a 4x CPU-throttled phone profile, and the build serves exactly the
  // output it validated, under a content hash.
  items: file("src/data/items.json", (raw: unknown): Item[] => CatalogSchema.parse(raw)),
  wikiCatalog: file("src/data/wiki-catalog.json",
    (raw: { items: Record<string, WikiMatch>; localizedNames: Record<string, string> }) => ({
      items: Object.fromEntries(Object.entries(raw.items).map(([id, { name, isHidden, isUnreleased }]) =>
        [id, { name, isHidden, isUnreleased }])),
      localizedNames: raw.localizedNames,
    })),
  sourceNames: file("src/data/source-catalog-names.json",
    (raw: { names: Record<string, string> }) => ({ names: raw.names })),
  shareIds: file("src/data/share-item-ids.json",
    (raw: { slots: string[]; items: string[] }) => ({ slots: raw.slots, items: raw.items })),
  equipmentSlots: file("src/data/source-equipment-slots.json",
    (raw: { fullBody: string[]; spansShoes: string[]; slotsByItem: Record<string, string[]> }) =>
      ({ fullBody: raw.fullBody, spansShoes: raw.spansShoes, slotsByItem: raw.slotsByItem })),
};

export type CatalogFileKey = keyof typeof CATALOG_FILES;
export type CatalogData = { readonly [K in CatalogFileKey]: ReturnType<(typeof CATALOG_FILES)[K]["ship"]> };

// The exact JSON text the browser receives for one catalog file. Throws on invalid items.
export function shippedCatalogJson(key: CatalogFileKey, sourceText: string): string {
  return JSON.stringify(CATALOG_FILES[key].ship(JSON.parse(sourceText)));
}
