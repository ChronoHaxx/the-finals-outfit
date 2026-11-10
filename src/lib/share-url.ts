import { decodeOutfit, type Outfit } from "./outfit";
import { getBrowseItem } from "./browse-catalog";
import { derivedFromCatalog, getCatalogData } from "./catalog";
import type { Slot } from "./slots";
import { POSE_KEYS, poseParams, type SharePose } from "./share-pose";

export type ShareStyle = "short" | "names";
const shareCodes = derivedFromCatalog(() => {
  const registry = getCatalogData().shareIds;
  return {
    registry,
    items: new Map(registry.items.map((id, index) => [id, index.toString(36)])),
    slots: new Map(registry.slots.map((slot, index) => [slot, index.toString(36)])),
  };
});
const nameSlug = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

// Append-only IDs make links independent of current catalog order and names.
// The readable label is informational; its stable suffix identifies the variant.
// `pose` (share-pose.ts) adds the animation frame on screen beside the outfit; a link without one opens as before.
export function buildShareUrl(currentUrl: string, build: Partial<Record<Slot, string | null>>,
  style: ShareStyle = "short", pose: SharePose | null = null): string {
  const url = new URL(currentUrl);
  const { items: itemCodes, slots: slotCodes } = shareCodes();
  const parts = Object.entries(build).flatMap(([slot, id]) => {
    if (!id) return [];
    const item = itemCodes.get(id), category = slotCodes.get(slot);
    if (item === undefined || category === undefined) throw new Error("Item is missing a stable share ID");
    const code = category + item;
    return [style === "names" ? `${nameSlug(getBrowseItem(id)?.name ?? id)}--${code}` : code];
  });
  for (const key of ["outfit", "o", "look", ...POSE_KEYS]) url.searchParams.delete(key);
  url.hash = "";
  const posed = pose ? poseParams(pose) : [];
  if (style === "short") url.hash = `/?o=2.${parts.join(".")}${posed.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join("")}`;
  else {
    url.searchParams.set("look", `2.${parts.join(".")}`);
    for (const [key, value] of posed) url.searchParams.set(key, value);
  }
  return url.href;
}

function decodeCodes(code: string, names: boolean): Outfit {
  if (!code.startsWith("2.") || code.length > 12000) throw new Error("Unsupported outfit link");
  const { registry } = shareCodes();
  const parts = code.slice(2) ? code.slice(2).split(".") : [];
  if (parts.length > registry.slots.length) throw new Error("Too many outfit items");
  const slots: Outfit["slots"] = {};
  for (const part of parts) {
    const value = names ? /^[a-z0-9]+(?:-[a-z0-9]+)*--([a-z0-9]+)$/.exec(part)?.[1] : part;
    if (!value || !/^[0-9a-z]{2,5}$/.test(value)) throw new Error("Invalid outfit item code");
    const slot = registry.slots[parseInt(value[0], 36)] as Slot | undefined;
    const id = registry.items[parseInt(value.slice(1), 36)];
    if (!slot || !id || slots[slot]) throw new Error("Unknown or repeated outfit item");
    slots[slot] = id;
  }
  return { slots };
}

export function readOutfitLink(currentUrl: string): Outfit | null {
  const url = new URL(currentUrl);
  const fragment = url.hash.startsWith("#/?") ? new URLSearchParams(url.hash.slice(3)) : new URLSearchParams();
  const short = fragment.get("o") ?? url.searchParams.get("o");
  if (short !== null) return decodeCodes(short, false);
  const names = url.searchParams.get("look");
  if (names !== null) return decodeCodes(names, true);
  const legacy = url.searchParams.get("outfit");
  return legacy === null ? null : decodeOutfit(legacy);
}
