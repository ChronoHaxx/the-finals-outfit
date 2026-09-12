/**
 * catalog-slots.ts — piece-name -> catalog slot classification for the importer.
 *
 * Extracted from `scripts/import-catalog.ts` so the rules are testable on their own and
 * a reimport cannot quietly revert a slot correction: the rules ARE the correction.
 * The dump encodes no slot metadata next to the icons, so the folder/file names are all
 * the walker has; the game's own `EBodySlot` list (recovered separately into
 * `public/models/reconstructed-assembly-v2/customization.json`) is the ground truth these
 * rules are measured against.
 */
import { type Slot } from "../../src/lib/slots.ts";

// PascalCase/glued tokens -> space-separated lowercase, so \b boundaries work on
// "BaseballCap" -> "baseball cap".
export function spaceCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

// Piece-name keyword -> slot, evaluated in order (most specific first). Used for set
// folders (ActionHero, Cowboy, …) and Attachments. `hood(?!ie)` keeps hoodies out of
// headwear; outerwear before upperBody so capes/coats win over "top/suit"; upperBack
// before lowerBack so clavicle weapons sort to the back.
//
// TWO lower-body rules, and the order between them is the whole point:
//
//   LOWER BODY NOUNS (pant/trouser/skirt/…) are garments in their own right and keep
//   their original precedence, ahead of outerwear and upper-body names — "SuitPants"
//   is trousers, not a suit; "TutuSkirtWithTights" is a bottom, not a top.
//
//   LOWER BODY MODIFIERS (short/tight/jean) are as often adjectives or fabrics as they
//   are garments, so they are tested LAST, after every upper-body name. Testing them
//   first is what filed JeansJacket, JacketShort, ShortDress and TightSinglet under
//   lowerBody — 31 catalog entries whose game source declares `EBodySlot::BodyUpper`
//   and carries the `Customization.Slot.BodyUpper` asset tag, on torso meshes
//   (SK_*_TightSinglet_M, SK_Cowboy_JeansJacket_M, SK_Streetwear_JacketShort_M,
//   SK_Casual_ShortDress_M). Bare "Shorts"/"Jeans"/"Tights" pieces contain no upper-body
//   name, so they still fall through to lowerBody unchanged.
//
// `singlet` is in the upper-body rule because nothing else matched it: with the modifier
// demoted, "TightSinglet" would otherwise reach no rule at all.
export const SLOT_RULES: [RegExp, Slot][] = [
  [/glass|goggle|monocle|shades|sunglass|spectacle/, "eyewear"],
  [/mask|eyepatch|rebreather|respirator|muzzle|faceguard|veil|balaclava|bandana|scarf|gaiter/, "facewear"],
  [/boot|shoe|sneaker|sandal|heel|geta|spur|clog|loafer|pump|cleat|wedge|footwear|flip ?flop/, "feet"],
  [/glove|gauntlet|mitten|knuckle|\bhand|finger/, "hands"],
  [/watch|wrist|bracelet|bangle/, "wrist"],
  [/pant|trouser|skirt|kilt|legging|stocking|chap|legwear|bottom|capri|jogger/, "lowerBody"],
  [/cape|cloak|poncho|coat|duster|mantle|robe|shawl|capelet|cardigan/, "outerwear"],
  [/backpack|bandolier|\bbag|harness|satchel|quiver|\bpack|wing|jetpack|parachute|sling|strap|clavicle|rope/, "upperBack"],
  // NOTE: \bhat\b / \bcaps?\b need BOTH boundaries — bare `\bcap` matched "captain
  // jacket" into headwear.
  [/helmet|\bhats?\b|\bcaps?\b|beanie|crown|cowl|\bhorns?\b|antenna|antler|beret|visor|halo|hood(?!ie)|turban|headband|headgear|tiara|fedora|bolero|sombrero|snapback|headphone|headset|\bears?\b|\bhead\b/, "headwear"],
  [/top|jacket|shirt|vest|hoodie|sweater|tank|jersey|tunic|blouse|\bsuit|torso|armou?r|bodysuit|dress|singlet|overall|uniform|turtle ?neck|pullover|sweatshirt|crop|corset|upper ?body|\bbody\b/, "upperBody"],
  // Ambiguous lower-body modifiers — last, so an upper-body name always wins (see above).
  [/short|tight|jean/, "lowerBody"],
  [/lumbar|\btail|pistol|\bgun|sheath|holster/, "lowerBack"],
];

export function keywordSlot(text: string): Slot | null {
  const spaced = spaceCase(text);
  for (const [re, slot] of SLOT_RULES) if (re.test(spaced)) return slot;
  return null;
}

/** The importer's lookup: the piece folder decides, and the icon's file token is the
 *  fallback for pieces whose folder name carries no garment word. */
export function classifySlot(piece: string | null | undefined, fileToken?: string | null): Slot | null {
  return (piece ? keywordSlot(piece) : null) ?? (fileToken ? keywordSlot(fileToken) : null);
}
