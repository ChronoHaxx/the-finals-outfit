import { getAllItems, getItemById } from "./catalog";
import { DEVELOPER_CATALOG } from "./catalog-mode";
import type { Item } from "./item";
import type { Slot } from "./slots";
import rawMatches from "../data/wiki-catalog.json";

type WikiMatch = { name: string; pageId: number; revisionId: number; isHidden: boolean; isUnreleased: boolean };
const matches: Readonly<Record<string, WikiMatch>> = rawMatches.items;

// Renderer dependencies keep using catalog.ts: an undershirt or hidden body
// companion is not a selectable cosmetic and must remain loadable internally.
export function getBrowseItem(id: string, developer = DEVELOPER_CATALOG): Item | undefined {
  const item = getItemById(id);
  if (!item || developer) return item;
  const match = matches[id];
  if (!match || match.isHidden || match.isUnreleased) return undefined;
  return { ...item, name: match.name };
}

const PUBLIC_ITEMS = getAllItems().flatMap(item => {
  const visible = getBrowseItem(item.id, false);
  return visible ? [visible] : [];
});

export function getBrowseItemsBySlot(slot: Slot, developer = DEVELOPER_CATALOG): readonly Item[] {
  return (developer ? getAllItems() : PUBLIC_ITEMS).filter(item => item.slot === slot);
}

export function filterBrowseBuild(slots: Partial<Record<Slot, string>>, developer = DEVELOPER_CATALOG) {
  return Object.fromEntries(Object.entries(slots).filter(([slot, id]) => {
    const item = id ? getBrowseItem(id, developer) : undefined;
    return item?.slot === slot;
  })) as Partial<Record<Slot, string>>;
}

export const PUBLIC_CATALOG_COUNT = PUBLIC_ITEMS.length;
