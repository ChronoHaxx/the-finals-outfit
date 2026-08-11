import { z } from "zod";
import { SLOTS } from "./slots";
import { ItemIdSchema } from "./item";

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  message: "dye must be a #RRGGBB hex string",
});

export const OutfitSchema = z.object({
  slots: z.record(z.enum(SLOTS), ItemIdSchema),
  dyes: z.record(z.enum(SLOTS), HexColorSchema).optional(),
  presetName: z.string().max(32).optional(),
});
export type Outfit = z.infer<typeof OutfitSchema>;

export function emptyOutfit(): Outfit {
  return { slots: {} };
}

// Share-link codec, carried in the `?outfit=` query param. Format v1:
// "1." + base64url(JSON of the Outfit object). Slot NAMES are stored (not indices), so
// adding slots can never shift the meaning of an existing link; ids are schema-constrained
// ASCII slugs, so btoa/atob are safe. Decode is forgiving: unknown keys are stripped by
// zod, and a corrupt payload throws (callers fall back to an empty build).
export function encodeOutfit(outfit: Outfit): string {
  const compact: Outfit = { slots: outfit.slots };
  if (outfit.dyes && Object.keys(outfit.dyes).length) compact.dyes = outfit.dyes;
  if (outfit.presetName) compact.presetName = outfit.presetName;
  const b64 = btoa(JSON.stringify(compact));
  return "1." + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeOutfit(code: string): Outfit {
  const m = /^1\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) throw new Error("unrecognized outfit code");
  const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
  return OutfitSchema.parse(JSON.parse(json));
}
