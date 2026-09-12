import { create } from "zustand";
import { SLOTS, type Slot } from "../lib/slots";
import type { Item } from "../lib/item";
import { getItemById } from "../lib/catalog";
import { migrateBuildSlots } from "../lib/outfit-slots";

// `build` is the serializable source of truth: slot -> selected item id (or null).
// It maps 1:1 onto Outfit.slots (src/lib/outfit.ts) for the M4 share-link encoder.
// Runtime 3D handles (SkinnedMesh, skeletons) live in the CharacterRig, NOT here —
// keeping the store pure/serializable.
export type Build = Record<Slot, string | null>;

const blankBuild = (): Build =>
  Object.fromEntries(SLOTS.map((s) => [s, null])) as Build;

// First-paint / Reset look: a complete neutral character instead of a headless bare body.
// Ids must exist in the catalog with converted models (verified; harmless if one goes
// missing — the slot just renders empty).
const DEFAULT_BUILD: Partial<Record<Slot, string>> = {
  face: "head-face-01-base",
  upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas",
};

const defaultBuild = (): Build => ({ ...blankBuild(), ...DEFAULT_BUILD });

// In-game the torso is never bare: equipping Outerwear over an empty Upper Body slot still
// shows a base top underneath (the icon-capture mannequin always wears one). Substituted only
// at render time (see CharacterViewer) so the serializable `build` — and therefore share links
// and the visual-diff harness, which render items in isolation — stay exact.
export const FALLBACK_UPPER_BODY = "casual-basictshirt-cotton-black";

export function effectiveBuild(build: Build): Build {
  if (!build.outerwear || build.upperBody) return build;
  const coat = getItemById(build.outerwear)?.model;
  // When the coat has a REAL under-garment mesh, the rig composites it directly (CharacterViewer
  // passes underLayerUrl on the coat's RigItem) — don't ALSO substitute a generic top, or both
  // would render. The generic recoloured top is the fallback only when no real mesh resolved.
  if (coat?.underLayerUrl) return build;
  // Prefer the coat's own colour-coordinated undersuit (import-catalog assigns one to each
  // outerwear item) so its open back reads as tonal layering; fall back to the neutral base top.
  const under = coat?.underLayer ?? FALLBACK_UPPER_BODY;
  return { ...build, upperBody: under };
}

interface BuildState {
  build: Build;
  equip: (item: Item) => void;
  unequip: (slot: Slot) => void;
  toggle: (item: Item) => void;
  // Replace the whole build (share-link hydration). Caller validates ids beforehand.
  load: (slots: Partial<Record<Slot, string>>) => void;
  reset: () => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  build: defaultBuild(),
  equip: (item) => set((s) => ({ build: { ...s.build, [item.slot]: item.id } })),
  unequip: (slot) => set((s) => ({ build: { ...s.build, [slot]: null } })),
  toggle: (item) =>
    set((s) => ({
      build: {
        ...s.build,
        [item.slot]: s.build[item.slot] === item.id ? null : item.id,
      },
    })),
  // Share links describe the EXACT build — blank base, not defaults, so an absent slot in
  // the link stays empty (and the visual-diff harness renders items in isolation).
  // Slot maps written down before a catalog slot correction are migrated here as well as
  // in the share-link path, so loading a build directly can't disagree with loading its URL.
  load: (slots) => set({ build: { ...blankBuild(), ...migrateBuildSlots(slots) } }),
  reset: () => set({ build: defaultBuild() }),
}));
