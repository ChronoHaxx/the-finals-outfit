import { getAllItems, getItemById } from "./catalog";
import { DEVELOPER_CATALOG } from "./catalog-mode";
import type { Item } from "./item";
import type { Slot } from "./slots";
import rawMatches from "../data/wiki-catalog.json";
import sourceNames from "../data/source-catalog-names.json";

type WikiMatch = { name: string; isHidden: boolean | null; isUnreleased: boolean | null };
const matches: Readonly<Record<string, WikiMatch>> = rawMatches.items;
// Keep verified game names across wiki refreshes. Previously accepted names and
// reviewed wiki identities retain their existing precedence.
const localizedNames: Readonly<Record<string, string>> = {
  ...sourceNames.names,
  ...rawMatches.localizedNames,
};

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
  return getPublicCatalogItem(item, matches[id], localizedNames[id]);
}

const PUBLIC_ITEMS = getAllItems().flatMap(item => {
  const visible = getBrowseItem(item.id, false);
  return visible ? [visible] : [];
});

export function getBrowseItemsBySlot(slot: Slot, developer = DEVELOPER_CATALOG): readonly Item[] {
  return getBrowseItems(developer).filter(item => item.slot === slot);
}

export function getBrowseItems(developer = DEVELOPER_CATALOG): readonly Item[] {
  return developer ? getAllItems() : PUBLIC_ITEMS;
}

export function filterBrowseBuild(slots: Partial<Record<Slot, string>>, developer = DEVELOPER_CATALOG) {
  return Object.fromEntries(Object.entries(slots).filter(([slot, id]) => {
    const item = id ? getBrowseItem(id, developer) : undefined;
    return item?.slot === slot;
  })) as Partial<Record<Slot, string>>;
}

export const PUBLIC_CATALOG_COUNT = PUBLIC_ITEMS.length;
