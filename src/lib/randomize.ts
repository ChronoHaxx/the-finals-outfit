import type { Slot } from "./slots";

// Rules-based outfit randomiser. It is deterministic for a given random source, has no
// network or AI dependency, and never touches a locked slot.
//
// Rules:
// - Locked slots keep their current value exactly (including an empty slot).
// - Core slots (face, upper body, lower body, feet) are always filled when they have candidates.
// - Optional slots are filled with a fixed chance, so a random look is not every accessory at once.
// - Candidates are supplied by the caller (the browsable catalog, optionally only items that
//   already have reconstruction work), so the randomiser never offers an item the picker hides.
// - Only one of the two mutually exclusive head coverings from the source hair/headwear guard is
//   rolled: a random hat is not paired with a random hairstyle unless one of them is locked.

export const RANDOM_SLOTS = [
  "face", "hair", "facialHair", "headwear", "facewear", "eyewear", "earrings",
  "upperBody", "outerwear", "lowerBody", "hands", "feet", "upperBack", "lowerBack", "wrist",
  "nailPolish", "blush", "tattoo", "bodyPaint",
] as const satisfies readonly Slot[];

export const CORE_SLOTS: ReadonlySet<Slot> = new Set<Slot>(["face", "upperBody", "lowerBody", "feet"]);

export const OPTIONAL_CHANCE: Partial<Record<Slot, number>> = {
  hair: 0.85, facialHair: 0.2, headwear: 0.35, facewear: 0.15, eyewear: 0.2, earrings: 0.2,
  outerwear: 0.25, hands: 0.3, upperBack: 0.2, lowerBack: 0.15, wrist: 0.2,
  nailPolish: 0.2, blush: 0.15, tattoo: 0.15, bodyPaint: 0.05,
};

export type Random = () => number;

export interface RandomizeInput {
  build: Readonly<Record<Slot, string | null>>;
  locked: ReadonlySet<Slot>;
  candidates: (slot: Slot) => readonly string[];
  random?: Random;
}

const pick = (values: readonly string[], random: Random) =>
  values[Math.min(values.length - 1, Math.floor(random() * values.length))];

export function randomizeBuild({ build, locked, candidates, random = Math.random }: RandomizeInput): Record<Slot, string | null> {
  const next = { ...build } as Record<Slot, string | null>;
  for (const slot of RANDOM_SLOTS) {
    if (locked.has(slot)) continue;
    const pool = candidates(slot);
    const chance = CORE_SLOTS.has(slot) ? 1 : OPTIONAL_CHANCE[slot] ?? 0;
    next[slot] = pool.length && random() < chance ? pick(pool, random) : null;
  }
  // Hair and headwear: keep at most one of them random. A locked one stays; the other yields.
  if (next.hair && next.headwear && !locked.has("hair") && !locked.has("headwear")) {
    if (random() < 0.5) next.headwear = null; else next.hair = null;
  }
  return next;
}

/** A small seeded generator (mulberry32) so a shared seed reproduces the same roll in tests. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
