// Body type as part of an outfit: the ids, which ones visitors can pick, and their share-link codes.
//
// The rig's side (morph names, customization tags, socket offsets) is src/rig/BodyTypePreview.ts; its table is
// checked against these ids at compile time. This module stays free of three.js so the outfit store, the saved-outfit
// library and the share-link codec can use it in Node tests.
//
// Season 12 (6 Nov 2026) has three Medium body types. Feminine is held back from visitors: on today's data it clips in
// outfits that mix Season 12 garments with older ones, and in all-Season-12 outfits on the pre-Season-12 body
// (_docs/body-type-picker-2026-11-11/PLAN.md). It arrives with the Season 12 item refresh. Until then it stays a valid
// stored value (a link or saved outfit carrying it is kept as it is) and renders as Masculine.
//
// An outfit without a body type (every link and saved outfit made before 12 Nov 2026) is Masculine, which is what
// the site always showed.

export const BODY_TYPE_IDS = ["masculine", "feminine", "androgynous"] as const;
export type BodyTypeId = (typeof BODY_TYPE_IDS)[number];

export const DEFAULT_BODY_TYPE: BodyTypeId = "masculine";

export const BODY_TYPE_LABELS: Record<BodyTypeId, string> = {
  masculine: "Masculine",
  feminine: "Feminine",
  androgynous: "Androgynous",
};

/** The body types the picker offers, in order. */
export const VISITOR_BODY_TYPES: readonly BodyTypeId[] = ["masculine", "androgynous"];

// Share-link codes, carried as `bt=<code>`. Append-only: a code, once published, keeps its meaning. Masculine has none:
// a link without `bt` is Masculine, so every link made before body types still opens exactly as it did.
const SHARE_CODES: Partial<Record<BodyTypeId, string>> = { feminine: "f", androgynous: "a" };
export const BODY_TYPE_PARAM = "bt";

export function isBodyTypeId(id: unknown): id is BodyTypeId {
  return typeof id === "string" && (BODY_TYPE_IDS as readonly string[]).includes(id);
}

/** The body type an outfit's stored value names. Absent or unknown (a value from a newer site) reads as Masculine. */
export function bodyTypeOf(value: unknown): BodyTypeId {
  return isBodyTypeId(value) ? value : DEFAULT_BODY_TYPE;
}

/** The body type to render: the outfit's own when visitors can pick it, else Masculine. */
export function shownBodyType(value: unknown): BodyTypeId {
  const id = bodyTypeOf(value);
  return VISITOR_BODY_TYPES.includes(id) ? id : DEFAULT_BODY_TYPE;
}

/** The `bt` value for a body type, or undefined when the link needs none (Masculine, or a value this site cannot
 *  name: it opens as Masculine either way). */
export function bodyTypeShareCode(value: unknown): string | undefined {
  return isBodyTypeId(value) ? SHARE_CODES[value] : undefined;
}

/** The body type a `bt` value names. Missing or unknown codes give Masculine and never throw. */
export function bodyTypeFromShareCode(code: string | null | undefined): BodyTypeId {
  const entry = Object.entries(SHARE_CODES).find(([, value]) => value === code);
  return entry ? entry[0] as BodyTypeId : DEFAULT_BODY_TYPE;
}
