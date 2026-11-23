// Archetype (the game's contestant class size: Light, Medium or Heavy) as part of an outfit: the ids, which ones
// visitors can pick, their share-link codes, and which body types each supports.
//
// The rig's side (the scaled skeleton, the class morph, the class socket offsets) is src/rig/Archetype.ts and
// src/rig/BodyTypePreview.ts. This module stays free of three.js so the outfit store, the saved-outfit library and the
// share-link codec can use it in Node tests.
//
// How the game builds the three classes (survey 6 Nov 2026, _docs/body-types-2026-11-06/README.md; re-checked
// 22 Nov 2026 in _docs/archetypes-2026-11-22/README.md):
// - one skeleton per class, the Light and Heavy ones exact uniform scales of Medium (bone translations x0.85 / x1.15,
//   rotations identical);
// - the shape comes from each mesh's class morph (light_* / heavy_*), which cannot be derived from the Medium one;
// - almost every Medium part names its own Light and Heavy mesh (Customization.Archetype.* TagOverrides);
// - the head is shared, and on Light and Heavy it is the Medium head scaled with the class, morphs included (measured
//   23 Nov 2026: the neck rim fits to 0.1 cm scaled, against 1.5-2 cm at full size; src/rig/Archetype.ts).
//
// An outfit without an archetype (every link and saved outfit made before 22 Nov 2026) is Medium, which is what the
// site always showed.

export const ARCHETYPE_IDS = ["light", "medium", "heavy"] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export const DEFAULT_ARCHETYPE: ArchetypeId = "medium";

export const ARCHETYPE_LABELS: Record<ArchetypeId, string> = { light: "Light", medium: "Medium", heavy: "Heavy" };

/** The customization tag the game's resolver context carries for each class (TagOverride MatchingTags). */
export const ARCHETYPE_TAGS: Record<ArchetypeId, string> = {
  light: "Customization.Archetype.Light",
  medium: "Customization.Archetype.Medium",
  heavy: "Customization.Archetype.Heavy",
};

// Share-link codes, carried as `ar=<code>`. Append-only: a code, once published, keeps its meaning. Medium has none:
// a link without `ar` is Medium, so every link made before archetypes still opens exactly as it did.
const SHARE_CODES: Partial<Record<ArchetypeId, string>> = { light: "l", heavy: "h" };
export const ARCHETYPE_PARAM = "ar";

export function isArchetypeId(id: unknown): id is ArchetypeId {
  return typeof id === "string" && (ARCHETYPE_IDS as readonly string[]).includes(id);
}

/** The archetype an outfit's stored value names. Absent or unknown (a value from a newer site) reads as Medium. */
export function archetypeOf(value: unknown): ArchetypeId {
  return isArchetypeId(value) ? value : DEFAULT_ARCHETYPE;
}

/** The `ar` value for an archetype, or undefined when the link needs none (Medium, or a value this site cannot name:
 *  it opens as Medium either way). */
export function archetypeShareCode(value: unknown): string | undefined {
  return isArchetypeId(value) ? SHARE_CODES[value] : undefined;
}

/** The archetype an `ar` value names. Missing or unknown codes give Medium and never throw. */
export function archetypeFromShareCode(code: string | null | undefined): ArchetypeId {
  const entry = Object.entries(SHARE_CODES).find(([, value]) => value === code);
  return entry ? entry[0] as ArchetypeId : DEFAULT_ARCHETYPE;
}

// DA_BodyType_* SupportedArchetypes (Season 12 read, _docs/body-types-2026-11-06/s12-*-read): Androgynous authors
// [Medium]; Masculine and Feminine author none, which the game reads as every class. The Muscular types are
// Heavy-only and not body types this site offers yet. tests/archetype.test.ts checks this table against those files.
const BODY_TYPE_ARCHETYPES: Record<string, readonly ArchetypeId[]> = {
  masculine: ARCHETYPE_IDS,
  feminine: ARCHETYPE_IDS,
  androgynous: ["medium"],
};

/** Whether the game offers this body type on this archetype. An unknown body type renders as Masculine
 *  (body-type.ts), which every archetype supports. */
export function bodyTypeSupportsArchetype(bodyType: string, archetype: ArchetypeId): boolean {
  return (BODY_TYPE_ARCHETYPES[bodyType] ?? ARCHETYPE_IDS).includes(archetype);
}

// The picker is a preview behind a flag until every item has its Light and Heavy meshes (the bulk extraction,
// _docs/archetypes-2026-11-22/README.md): on in development, or once `?archetypes=on` has been opened in this browser
// (`?archetypes=off` turns it off again). Even with the flag on, the picker offers a class only when the index the site
// loads carries that class's body (rig/Archetype.ts archetypeBodies).
const FLAG_KEY = "finals-archetypes:preview";

/** Reads `?archetypes=on|off` from the address once (remembering it) and returns whether the preview is on. */
export function archetypePreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("archetypes")
      ?? new URLSearchParams(window.location.hash.replace(/^#[^?]*\??/, "")).get("archetypes");
    if (param === "on") window.localStorage.setItem(FLAG_KEY, "1");
    else if (param === "off") window.localStorage.removeItem(FLAG_KEY);
    if (param === "off") return false;
  } catch { /* storage blocked: the flag stays as it was */ }
  if (import.meta.env?.DEV) return true;
  try { return window.localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
}
