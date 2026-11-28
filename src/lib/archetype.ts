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

// Which classes the picker offers (28 Nov 2026). Light is public: its starting outfit is whole on Light, and the user said
// yes to showing it. Heavy stays a preview until its meshes are built and hosted. A visitor can change that in their own
// browser, which remembers it:
// - `?archetypes=on` is the preview: every class, Heavy included (development builds start here);
// - `?archetypes=off` offers Medium only, and every outfit renders as Medium, as the site did before archetypes;
// - `?archetypes=default` forgets either choice.
// Whatever the access, the picker offers a class only when the index the site loads carries that class's body
// (rig/Archetype.ts indexClass), so an index without a Heavy body never offers Heavy.
export type ArchetypeAccess = "public" | "preview" | "off";

/** The classes every visitor sees without opting in, in picker order. Adding "heavy" here is the Heavy unflag. */
export const PUBLIC_ARCHETYPES: readonly ArchetypeId[] = ["light", "medium"];

// "1" is the preview (the value this key has held since 22 Nov 2026, so a browser that opted in stays in), "0" is off.
// No value is the public default.
const FLAG_KEY = "finals-archetypes:preview";

/** The classes an access allows, in picker order. Medium is always one of them. */
export function archetypesFor(access: ArchetypeAccess): readonly ArchetypeId[] {
  return access === "preview" ? ARCHETYPE_IDS : access === "off" ? ["medium"] : PUBLIC_ARCHETYPES;
}

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The access an address and this browser's remembered choice give. `?archetypes=on|off|default` in the query or the
 *  hash is remembered first. Storage that fails leaves the address to decide this page, and the default otherwise. */
export function readArchetypeAccess(location: { search: string; hash: string }, storage: FlagStorage | null,
  dev = false): ArchetypeAccess {
  let param: string | null = null;
  try {
    param = new URLSearchParams(location.search).get("archetypes")
      ?? new URLSearchParams(location.hash.replace(/^#[^?]*\??/, "")).get("archetypes");
  } catch { /* an address this cannot parse names no access */ }
  try {
    if (param === "on") storage?.setItem(FLAG_KEY, "1");
    else if (param === "off") storage?.setItem(FLAG_KEY, "0");
    else if (param === "default") storage?.removeItem(FLAG_KEY);
  } catch { /* storage blocked: the address still decides this page */ }
  if (param === "on") return "preview";
  if (param === "off") return "off";
  let stored: string | null = null;
  if (param !== "default") try { stored = storage?.getItem(FLAG_KEY) ?? null; } catch { /* blocked: the default */ }
  if (stored === "1") return "preview";
  if (stored === "0") return "off";
  return dev ? "preview" : "public";
}

/** This page's access, read from its address and this browser's storage. */
export function archetypeAccess(): ArchetypeAccess {
  if (typeof window === "undefined") return readArchetypeAccess({ search: "", hash: "" }, null);
  let storage: FlagStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked */ }
  return readArchetypeAccess(window.location, storage, Boolean(import.meta.env?.DEV));
}
