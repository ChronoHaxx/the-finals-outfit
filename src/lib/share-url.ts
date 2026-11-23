import { decodeOutfit, type Outfit } from "./outfit";
import { getBrowseItem } from "./browse-catalog";
import { derivedFromCatalog, getCatalogData } from "./catalog";
import type { Slot } from "./slots";
import { POSE_KEYS, poseParams, type SharePose } from "./share-pose";
import { builderHashParams } from "./site-mode";
import { BODY_TYPE_PARAM, bodyTypeFromShareCode, bodyTypeShareCode, DEFAULT_BODY_TYPE } from "./body-type";
import { ARCHETYPE_PARAM, archetypeFromShareCode, archetypeShareCode, DEFAULT_ARCHETYPE } from "./archetype";
import { VIEW_PARAM, viewParams, type CameraView } from "./camera-view";
import { PLAYER_NUMBER_PARAM, playerNumberFromShareCode, playerNumberShareCode } from "./player-number";
import { LIGHTING_PARAM, lightingParams } from "./share-lighting";

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

/** What a link carries: the pieces, the body type, the player number and the archetype (the build store's outfit
 *  fields). Each is required so every caller says which one it means; Masculine, each piece's own number (null) and
 *  Medium add nothing. */
export interface ShareLook { build: Partial<Record<Slot, string | null>>; bodyType: string; playerNumber: number | null;
  archetype: string }

// Append-only IDs make links independent of current catalog order and names.
// The readable label is informational; its stable suffix identifies the variant.
// `pose` (share-pose.ts) adds the animation frame on screen beside the outfit; a link without one opens as before.
// `bt` (body-type.ts) follows the outfit code when the body type is not Masculine; a link without one is Masculine.
// `ar` (archetype.ts) follows when the archetype is not Medium; a link without one is Medium.
// `pn` (player-number.ts) follows it when the outfit sets a number; a link without one shows each piece's own number.
// `view` (camera-view.ts) follows: the camera on screen; a link without one opens on the default framing.
// `lt` (share-lighting.ts) comes last: the lighting look's code; a link without one opens with the viewer's own lighting.
export function buildShareUrl(currentUrl: string, look: ShareLook, style: ShareStyle = "short",
  pose: SharePose | null = null, view: CameraView | null = null, lighting: string | null = null): string {
  const url = new URL(currentUrl);
  const { items: itemCodes, slots: slotCodes } = shareCodes();
  const { build } = look;
  const parts = Object.entries(build).flatMap(([slot, id]) => {
    if (!id) return [];
    const item = itemCodes.get(id), category = slotCodes.get(slot);
    if (item === undefined || category === undefined) throw new Error("Item is missing a stable share ID");
    const code = category + item;
    return [style === "names" ? `${nameSlug(getBrowseItem(id)?.name ?? id)}--${code}` : code];
  });
  for (const key of ["outfit", "o", "look", BODY_TYPE_PARAM, ARCHETYPE_PARAM, PLAYER_NUMBER_PARAM, VIEW_PARAM, LIGHTING_PARAM, ...POSE_KEYS])
    url.searchParams.delete(key);
  url.hash = "";
  const bodyType = bodyTypeShareCode(look.bodyType);
  const archetype = archetypeShareCode(look.archetype);
  const playerNumber = playerNumberShareCode(look.playerNumber);
  const extra: [string, string][] = [...(bodyType ? [[BODY_TYPE_PARAM, bodyType] as [string, string]] : []),
    ...(archetype ? [[ARCHETYPE_PARAM, archetype] as [string, string]] : []),
    ...(playerNumber ? [[PLAYER_NUMBER_PARAM, playerNumber] as [string, string]] : []),
    ...(pose ? poseParams(pose) : []), ...(view ? viewParams(view) : []), ...(lighting ? lightingParams(lighting) : [])];
  if (style === "short") url.hash = `/?o=2.${parts.join(".")}${extra.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join("")}`;
  else {
    url.searchParams.set("look", `2.${parts.join(".")}`);
    for (const [key, value] of extra) url.searchParams.set(key, value);
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

// The body type and player number beside a code, read from the same place as the code. Only a named body type is
// added: a missing or unknown `bt` leaves the outfit without one, which is Masculine. Likewise a missing or malformed
// `pn` leaves it without a number: each piece prints its own.
function withBodyType(outfit: Outfit, params: URLSearchParams): Outfit {
  const bodyType = bodyTypeFromShareCode(params.get(BODY_TYPE_PARAM));
  const archetype = archetypeFromShareCode(params.get(ARCHETYPE_PARAM));
  const playerNumber = playerNumberFromShareCode(params.get(PLAYER_NUMBER_PARAM));
  return { ...outfit, ...(bodyType === DEFAULT_BODY_TYPE ? {} : { bodyType }),
    ...(archetype === DEFAULT_ARCHETYPE ? {} : { archetype }),
    ...(playerNumber === null ? {} : { playerNumber }) };
}

export function readOutfitLink(currentUrl: string): Outfit | null {
  const url = new URL(currentUrl);
  // The builder's route, global (#/?o=) or Chinals (#/chinals?o=: the mode toggle keeps an unsaved link draft's
  // address, so a reload there must still open it). Never another page's query (lib/site-mode.ts).
  const fragment = builderHashParams(url.hash) ?? new URLSearchParams();
  const fromFragment = fragment.get("o");
  if (fromFragment !== null) return withBodyType(decodeCodes(fromFragment, false), fragment);
  const short = url.searchParams.get("o");
  if (short !== null) return withBodyType(decodeCodes(short, false), url.searchParams);
  const names = url.searchParams.get("look");
  if (names !== null) return withBodyType(decodeCodes(names, true), url.searchParams);
  const legacy = url.searchParams.get("outfit");
  return legacy === null ? null : decodeOutfit(legacy);
}
