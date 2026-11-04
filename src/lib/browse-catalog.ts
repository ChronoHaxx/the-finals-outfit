import { derivedFromCatalog, getAllItems, getCatalogData, getItemById } from "./catalog";
import type { WikiMatch } from "./catalog-files";
import { DEVELOPER_CATALOG } from "./catalog-mode";
import type { Item } from "./item";
import type { Slot } from "./slots";

const wikiNames = derivedFromCatalog(() => {
  const { wikiCatalog, sourceNames } = getCatalogData();
  return {
    matches: wikiCatalog.items,
    // Keep verified game names across wiki refreshes. Previously accepted names and
    // reviewed wiki identities retain their existing precedence.
    localizedNames: { ...sourceNames.names, ...wikiCatalog.localizedNames },
  };
});

function specificName(name?: string): string | undefined {
  const value = name?.trim();
  // Category labels and numbered heads identify a wiki entry, but do not help
  // people distinguish hairstyles, colours or faces in the picker.
  return value && !/^(?:hair|hairs[ _-]+headwear|facial[ _-]+hair|face|head(?:\s+\d+)?|eyes?|skin[ _-]+tone|body[ _-]+paint|nail[ _-]+polish|makeup)$/i.test(value)
    ? value : undefined;
}

export function getPublicCatalogItem(item: Item, match?: WikiMatch, localizedName?: string): Item | undefined {
  // An incomplete wiki match must not hide an otherwise usable cosmetic.
  if (match?.isHidden === true || match?.isUnreleased === true) return undefined;
  return { ...item, name: specificName(match?.name) ?? specificName(localizedName) ?? item.name };
}

// Renderer dependencies keep using catalog.ts: an undershirt or hidden body
// companion is not a selectable cosmetic and must remain loadable internally.
export function getBrowseItem(id: string, developer = DEVELOPER_CATALOG): Item | undefined {
  const item = getItemById(id);
  if (!item || developer) return item;
  const { matches, localizedNames } = wikiNames();
  return getPublicCatalogItem(item, matches[id], localizedNames[id]);
}

const publicItems = derivedFromCatalog(() => getAllItems().flatMap(item => {
  const visible = getBrowseItem(item.id, false);
  return visible ? [visible] : [];
}));

export function getBrowseItemsBySlot(slot: Slot, developer = DEVELOPER_CATALOG): readonly Item[] {
  return getBrowseItems(developer).filter(item => item.slot === slot);
}

export function getBrowseItems(developer = DEVELOPER_CATALOG): readonly Item[] {
  return developer ? getAllItems() : publicItems();
}

export function filterBrowseBuild(slots: Partial<Record<Slot, string>>, developer = DEVELOPER_CATALOG) {
  return Object.fromEntries(Object.entries(slots).filter(([slot, id]) => {
    const item = id ? getBrowseItem(id, developer) : undefined;
    return item?.slot === slot;
  })) as Partial<Record<Slot, string>>;
}

export function getPublicCatalogCount(): number {
  return publicItems().length;
}
