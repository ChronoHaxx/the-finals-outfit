// The order of SLOTS is the wire order for the M4 share-link encoder — only
// append. Renaming or reordering existing entries invalidates every outfit
// URL already in the wild.
export const SLOTS = [
  "bodyType",
  "hair",
  "facialHair",
  "face",
  "eyes",
  "headwear",
  "facewear",
  "eyewear",
  "upperBody",
  "outerwear",
  "lowerBody",
  "hands",
  "feet",
  "upperBack",
  "lowerBack",
  "wrist",
  "nailPolish",
  "blush",
  "tattoo",
  "emote",
  // Appended after M2a (append-only keeps existing share-link URLs valid): cover
  // datamined BodyCosmetics categories that had no existing slot.
  "earrings",
  "bodyPaint",
] as const;

export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Record<Slot, string> = {
  bodyType: "Body Type",
  hair: "Hair",
  facialHair: "Facial Hair",
  face: "Face",
  eyes: "Eyes",
  headwear: "Headwear",
  facewear: "Facewear",
  eyewear: "Eyewear",
  upperBody: "Upper Body",
  outerwear: "Outerwear",
  lowerBody: "Lower Body",
  hands: "Hands",
  feet: "Feet",
  upperBack: "Upper Back",
  lowerBack: "Lower Back",
  wrist: "Wrist",
  nailPolish: "Nail Polish",
  blush: "Blush",
  tattoo: "Tattoo",
  emote: "Emote",
  earrings: "Earrings",
  bodyPaint: "Body Paint",
};

export function isSlot(value: string): value is Slot {
  return (SLOTS as readonly string[]).includes(value);
}
