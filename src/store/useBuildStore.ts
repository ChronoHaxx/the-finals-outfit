import { create } from "zustand";
import { SLOTS, type Slot } from "../lib/slots";
import type { Item } from "../lib/item";
import { getItemById } from "../lib/catalog";
import { migrateBuildSlots } from "../lib/outfit-slots";
import { resolveEquipmentSlots } from "../lib/equipment";
import { DEFAULT_BODY_TYPE, type BodyTypeId } from "../lib/body-type";

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
// The default face. It also stands in, at render time only, for a face with nothing to render (see
// withRenderableFace below).
export const FALLBACK_FACE = "head-face-01-base";

const DEFAULT_BUILD: Partial<Record<Slot, string>> = {
  face: FALLBACK_FACE,
  upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas",
};

const defaultBuild = (): Build => ({ ...blankBuild(), ...DEFAULT_BUILD });

/** The starting look's pieces (Reset, and a new saved outfit). */
export const startingOutfit = (): Partial<Record<Slot, string>> => ({ ...DEFAULT_BUILD });

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

// An icon-only face replaces the head with nothing: no legacy model, no source reconstruction, no skin pair. Without
// this the viewer showed a headless body (6 Nov 2026: Hexcrowned Eidolon, Synthetic Citizen, Face of Éternel). The
// viewer renders the default face in its place. Like effectiveBuild, this is render-time only: the build, share links
// and the outfit panel keep the user's choice.
export function withRenderableFace(build: Build, renderable: (id: string) => boolean): Build {
  return build.face && build.face !== FALLBACK_FACE && !renderable(build.face) ? { ...build, face: FALLBACK_FACE } : build;
}

interface BuildState {
  build: Build;
  /** The outfit's body type exactly as it was chosen or stored (src/lib/body-type.ts). A value this site cannot name
   *  is kept as it is, so saving the outfit again does not lose it; it renders as Masculine. Not a slot: the
   *  "bodyType" entry in SLOTS predates this and stays empty. */
  bodyType: string;
  equip: (item: Item) => void;
  unequip: (slot: Slot) => void;
  toggle: (item: Item) => void;
  // Replace the whole build (share-link hydration). Caller validates ids beforehand. Without a body type, the current
  // one stays (Randomise and Reset keep it).
  load: (slots: Partial<Record<Slot, string>>, bodyType?: string) => void;
  setBodyType: (bodyType: BodyTypeId) => void;
  reset: () => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  build: defaultBuild(),
  bodyType: DEFAULT_BODY_TYPE,
  equip: (item) => set((s) => ({ build: { ...blankBuild(),
    ...resolveEquipmentSlots({ ...s.build, [item.slot]: item.id }, item.slot).slots } })),
  unequip: (slot) => set((s) => ({ build: { ...s.build, [slot]: null } })),
  toggle: (item) =>
    set((s) => ({
      build: s.build[item.slot] === item.id ? { ...s.build, [item.slot]: null }
        : { ...blankBuild(), ...resolveEquipmentSlots({ ...s.build, [item.slot]: item.id }, item.slot).slots },
    })),
  // Share links describe the EXACT build — blank base, not defaults, so an absent slot in
  // the link stays empty (and the visual-diff harness renders items in isolation).
  // Slot maps written down before a catalog slot correction are migrated here as well as
  // in the share-link path, so loading a build directly can't disagree with loading its URL.
  load: (slots, bodyType) => set(bodyType === undefined
    ? { build: { ...blankBuild(), ...migrateBuildSlots(slots) } }
    : { build: { ...blankBuild(), ...migrateBuildSlots(slots) }, bodyType }),
  setBodyType: (bodyType) => set(s => s.bodyType === bodyType ? s : { bodyType }),
  // The starting look; the body type is the user's choice and stays.
  reset: () => set({ build: defaultBuild() }),
}));
