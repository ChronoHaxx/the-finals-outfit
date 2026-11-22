// The game's own preset outfits (DA_Outfit_*): what each one is made of, and the outfit it becomes in this builder.
//
// The data (src/data/preset-outfits.json) is generated offline from the game files and loaded only when the Outfits
// view opens. Everything that depends on today's catalogue is decided here at runtime: an outfit piece the public
// catalogue hides counts as not on the site, and each piece's slot is the slot the catalogue files it under now.
import type { Item } from "./item";
import type { SlotMap } from "./outfit-library";
import type { Slot } from "./slots";
import { getBrowseItem } from "./browse-catalog";

export interface PresetPiece {
  /** Catalogue id, when the piece is in the catalogue. */
  id?: string;
  /** The game's name for a piece that is not, if it has one. */
  name?: string | null;
  /** Why a piece has no catalogue id: an effect, a voice or a pet the builder cannot show, or not added yet. */
  kind?: "effect" | "voice" | "pet" | "absent";
  /** The game's slot tag (Customization.Slot.*), used to choose between two pieces that share an app slot. */
  tag: string | null;
}

export interface PresetOutfit {
  id: string;
  name: string;
  season: number;
  rarity?: string;
  icon: string;
  pieces: PresetPiece[];
  /** Slots the outfit leaves bare in the game (a mask over the whole head hides the hair and beard). */
  hide?: ("hair" | "facialHair")[];
}

export interface PresetData {
  version: 1;
  source: string;
  outfits: PresetOutfit[];
}

let loading: Promise<PresetData> | undefined;
/** Loads the outfit list once. A failed load is not cached, so opening the view again retries. */
export function loadPresetOutfits(): Promise<PresetData> {
  loading ??= fetchPresetOutfits().catch(error => { loading = undefined; throw error; });
  return loading;
}

// Fetched as its own content-hashed JSON file (Vite's ?url emits it beside the code), never imported as a module: a
// bundled copy would be a JavaScript chunk naming thousands of catalog items, which the catalog-split check refuses
// (scripts/check-catalog-split.mjs), and JSON parses faster than the same data as script. Imported here, not at the top
// of the module, so Node tests can use the functions below without Vite.
async function fetchPresetOutfits(): Promise<PresetData> {
  const { default: url } = await import("../data/preset-outfits.json?url");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Outfit list ${url} returned HTTP ${response.status}`);
  return await response.json() as PresetData;
}

/** The contestant's own head, skin and body: kept when an outfit goes on, unless the outfit has a piece there or hides it. */
export const KEPT_SLOTS: readonly Slot[] = ["bodyType", "face", "hair", "facialHair", "eyes", "blush", "tattoo", "nailPolish",
  "earrings", "bodyPaint", "emote"];

// This builder files chest pins, crossbody bags and backpacks all under Upper Back (and some hip items there too), where
// the game wears them side by side. When two pieces of one outfit land in one slot, the bigger one is worn.
const TAG_RANK: Record<string, number> = { BackUpper: 3, Bandolier: 2, BackLowerRight: 1, TorsoUpperLeft: 0 };
const rank = (tag: string | null) => TAG_RANK[tag ?? ""] ?? 4;

export type PieceStatus = "worn" | "same-slot" | "not-on-site" | "effect" | "voice" | "pet";

export interface PieceState {
  piece: PresetPiece;
  status: PieceStatus;
  /** The catalogue item, for pieces the catalogue shows. */
  item?: Item;
  /** For "same-slot": the piece worn in that slot instead. */
  instead?: Item;
}

/** Every piece of an outfit against today's public catalogue, in the game's order. */
export function presetPieces(preset: PresetOutfit, lookup: (id: string) => Item | undefined = id => getBrowseItem(id)): PieceState[] {
  const states: PieceState[] = preset.pieces.map(piece => {
    const item = piece.id ? lookup(piece.id) : undefined;
    if (item) return { piece, item, status: "worn" };
    const kind = piece.kind;
    return { piece, status: kind === "effect" || kind === "voice" || kind === "pet" ? kind : "not-on-site" };
  });
  const winners = new Map<Slot, PieceState>();
  for (const state of states) {
    if (state.status !== "worn") continue;
    const slot = state.item!.slot;
    const held = winners.get(slot);
    if (!held) { winners.set(slot, state); continue; }
    const [keep, drop] = rank(state.piece.tag) > rank(held.piece.tag) ? [state, held] : [held, state];
    winners.set(slot, keep);
    drop.status = "same-slot";
  }
  for (const state of states) if (state.status === "same-slot") state.instead = winners.get(state.item!.slot)!.item;
  return states;
}

/** The outfit on screen once this preset goes on: the preset's pieces, over the kept head and skin slots. */
export function presetSlots(preset: PresetOutfit, current: Readonly<Partial<Record<Slot, string | null>>>,
  lookup?: (id: string) => Item | undefined): SlotMap {
  const slots: SlotMap = {};
  for (const slot of KEPT_SLOTS) {
    const id = current[slot];
    if (id) slots[slot] = id;
  }
  for (const slot of preset.hide ?? []) delete slots[slot];
  for (const state of presetPieces(preset, lookup)) if (state.status === "worn") slots[state.item!.slot] = state.item!.id;
  return slots;
}

/** Pieces on the site out of the pieces this builder could ever show (effects, voices and pets are left out). */
export function presetCoverage(states: readonly PieceState[]): { worn: number; wearable: number } {
  const wearable = states.filter(s => s.status === "worn" || s.status === "same-slot" || s.status === "not-on-site").length;
  return { worn: states.filter(s => s.status === "worn" || s.status === "same-slot").length, wearable };
}
