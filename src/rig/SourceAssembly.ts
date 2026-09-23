// Decoded source relationships, kept independent of Three and the catalog's
// older filename-derived garment guesses. Missing rules stay explicit.
import { fetchAsset } from "../lib/asset-fetch";
import { isRigidSourceRest, multiplySourceMatrices, sourceIdentityDeviation, sourceLocalMatrix,
  type SourceVector } from "./SourceTransform";

interface SoftPath { AssetPathName: string; SubPathString?: string }
interface Override {
  MatchingTags: string[];
  bOverrideMesh: boolean;
  ReplacementStaticMesh: SoftPath;
  ReplacementSkeletalMesh: SoftPath;
  bOverrideEffect: boolean;
  ReplacementEffect: SoftPath;
  bOverrideMaterials: boolean;
  MaterialOverrides: { Key: string; Value: SoftPath }[];
  bOffsetTransform?: boolean;
  OffsetPosition?: { X: number; Y: number; Z: number };
  OffsetRotation?: { Pitch: number; Yaw: number; Roll: number };
  OffsetScale?: { X: number; Y: number; Z: number };
  bAddLogicModules?: boolean;
}
interface VisualPart {
  StaticMesh: SoftPath;
  SkeletalMesh: SoftPath;
  Effect: SoftPath;
  TagOverrides: Override[];
  bIsAttached?: boolean;
  bCanBeMerged?: boolean;
  bIsHeadMesh?: boolean;
  bAttachToHeadMesh?: boolean;
  OptionalAttachmentMesh?: SoftPath;
  OptionalHeadWrapMesh?: SoftPath;
  AttachmentSocket?: string;
  WrapDeformation?: { bIsWrapDeformed: boolean; bIsWrapDeformedByHeadComponent: boolean; OptionalWrapDeformerMesh: SoftPath };
  LocalPosition?: { X: number; Y: number; Z: number };
  LocalRotation?: { Pitch: number; Yaw: number; Roll: number };
  LocalScale?: { X: number; Y: number; Z: number };
  LogicModules?: unknown[];
}
export interface SourceDefinition {
  formatVersion: 1;
  id: string;
  source: string;
  sourceSha256: string;
  properties: {
    ActivatesTags?: string[];
    Slots?: string[];
    VisualParts?: VisualPart[];
    MaterialOverrides?: { Key: string; Value: SoftPath }[];
    ActivatesMaterialParameters?: {
      MaterialInstance: SoftPath; Behavior: string; MatchingTags: string[]; SlotNames: string[];
    }[];
    [key: string]: unknown;
  };
}
export interface ResolvedPart {
  sourceIndex: number;
  staticMesh: string;
  skeletalMesh: string;
  effect: string;
  hidden: boolean;
  rules: number[];
  unresolved: string[];
  materials: Record<string, string>;
  definition: VisualPart;
}
export interface SourceOutfit {
  tags: string[];
  fittingTags: string[];
  items: Record<string, { source: string; hidden: boolean; parts: ResolvedPart[]; materialParameters?: SourceMaterialParameters[] }>;
  slotConflicts: { slot: string; items: string[] }[];
  unresolvedItems: string[];
  materialParameters: SourceMaterialParameters[];
}

export interface SourceMaterialParameters {
  itemId: string;
  source: string;
  slots: string[];
  unresolved: string[];
}

// Material slot names are Unreal FNames: compared case-insensitively, stored with their own spelling.
// Only ASCII letters fold; punctuation, other spelling and non-ASCII case stay different slots.
export function materialSlotIdentity(name: string): string {
  return name.replace(/[A-Z]/g, c => c.toLowerCase());
}

/** The one stored spelling in `names` naming `slot`, or undefined. Distinct case-equivalent spellings
 *  are ambiguous and throw rather than pick an alias, even when their values agree. */
export function matchMaterialSlot(names: Iterable<string>, slot: string, label: string): string | undefined {
  const identity = materialSlotIdentity(slot);
  const matches = [...new Set([...names].filter(name => materialSlotIdentity(name) === identity))];
  if (matches.length > 1) throw new Error(`Ambiguous case-equivalent ${label}: ${matches.join(", ")}`);
  return matches[0];
}

/** The override bound to one mesh slot: exact or unique case-only key, else undefined (the source default).
 *  `slots` are the mesh's own slot names; an override reaching two case-equivalent slots is ambiguous. */
export function materialSlotOverride(materials: Record<string, string>, slot: string, slots: string[] = [slot]): string | undefined {
  const key = matchMaterialSlot(Object.keys(materials), slot, `material overrides for ${slot}`);
  if (key === undefined) return undefined;
  matchMaterialSlot(slots, slot, `material slots for override ${key}`);
  return materials[key];
}

export function parameterOverlays(parameters: SourceMaterialParameters[], slot: string, slots: string[] = [slot]): string[] {
  const matching = parameters.filter(p =>
    matchMaterialSlot(p.slots, slot, `material parameter slots for ${slot}`) !== undefined);
  if (matching.length) matchMaterialSlot(slots, slot, "material slots for parameter overrides");
  // Preserve the authored array order within one customization item. Priority
  // between different items remains unknown, even if a combination was indexed.
  if (new Set(matching.map(p => p.itemId)).size > 1 || matching.some(p => p.unresolved.length))
    throw new Error(`Unresolved material parameter overrides: ${slot}`);
  return [...new Set(matching.map(p => p.source))];
}

function path(value?: SoftPath): string { return value?.AssetPathName ?? ""; }

// An offset is a no-op only when every component is authored as exactly the numeric identity.
// A missing, partial, extended, non-numeric or non-identity offset stays unsupported placement.
const OFFSET_IDENTITY = [
  ["OffsetPosition", { X: 0, Y: 0, Z: 0 }],
  ["OffsetRotation", { Pitch: 0, Yaw: 0, Roll: 0 }],
  ["OffsetScale", { X: 1, Y: 1, Z: 1 }],
] as const;
function offsetsPlacement(rule: Override): boolean {
  if (!rule.bOffsetTransform) return false;
  return !OFFSET_IDENTITY.every(([field, identity]) => {
    const value = rule[field] as unknown;
    return !!value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(identity).length &&
      Object.entries(identity).every(([axis, expected]) => (value as Record<string, unknown>)[axis] === expected);
  });
}

export function hasSourceTag(tags: Iterable<string>, requested: string): boolean {
  for (const tag of tags) if (tag === requested || tag.startsWith(requested + ".")) return true;
  return false;
}

export function resolveSourceOutfit(definitions: SourceDefinition[], contextTags: string[] = []): SourceOutfit {
  const tags = new Set(contextTags);
  for (const item of definitions) for (const tag of item.properties.ActivatesTags ?? []) tags.add(tag);
  const slots = new Map<string, string[]>();
  const items: SourceOutfit["items"] = {};
  for (const item of definitions) {
    for (const slot of item.properties.Slots ?? []) slots.set(slot, [...(slots.get(slot) ?? []), item.id]);
    const parts = (item.properties.VisualParts ?? []).map((part, sourceIndex): ResolvedPart => {
      const resolved: ResolvedPart = { sourceIndex, staticMesh: path(part.StaticMesh),
        skeletalMesh: path(part.SkeletalMesh), effect: path(part.Effect), hidden: false, rules: [], unresolved: [],
        materials: Object.fromEntries((item.properties.MaterialOverrides ?? []).map(m => [m.Key, path(m.Value)])),
        definition: part };
      const matching: { rule: Override; index: number }[] = [];
      part.TagOverrides.forEach((rule, index) => {
        const known = rule.MatchingTags.filter((tag) => hasSourceTag(tags, tag));
        if (!known.length && rule.MatchingTags.length) return;
        // A single tag is unambiguous. Preserve multi-tag conditions for the full
        // evaluator until the game's all/any matching and priority are verified.
        if (rule.MatchingTags.length > 1) {
          if (rule.bOverrideMesh || rule.bOverrideEffect || rule.bOverrideMaterials || offsetsPlacement(rule) || rule.bAddLogicModules)
            resolved.unresolved.push(`multi-tag condition ${index}`);
          return;
        }
        if (offsetsPlacement(rule) || rule.bAddLogicModules) resolved.unresolved.push(`unsupported placement or logic override ${index}`);
        matching.push({ rule, index });
      });
      for (const field of ["mesh", "effect"] as const) {
        const rules = matching.filter(({ rule }) => field === "mesh" ? rule.bOverrideMesh : rule.bOverrideEffect);
        const values = new Set(rules.map(({ rule }) => field === "mesh"
          ? JSON.stringify([path(rule.ReplacementStaticMesh), path(rule.ReplacementSkeletalMesh)])
          : path(rule.ReplacementEffect)));
        if (values.size > 1) {
          resolved.unresolved.push(`conflicting ${field} overrides: ${rules.map(r => r.index).join(",")}`);
          continue;
        }
        if (rules.length) {
          const rule = rules[0].rule;
          if (field === "mesh") {
            resolved.staticMesh = path(rule.ReplacementStaticMesh);
            resolved.skeletalMesh = path(rule.ReplacementSkeletalMesh);
          } else resolved.effect = path(rule.ReplacementEffect);
          resolved.rules.push(...rules.map(r => r.index));
        }
      }
      const materials = new Map<string, Set<string>>();
      for (const { rule } of matching) if (rule.bOverrideMaterials) {
        for (const material of rule.MaterialOverrides) {
          if (!materials.has(material.Key)) materials.set(material.Key, new Set());
          materials.get(material.Key)!.add(path(material.Value));
        }
      }
      for (const [slot, values] of materials) {
        if (values.size > 1) resolved.unresolved.push(`conflicting material overrides: ${slot}`);
        else resolved.materials[slot] = [...values][0];
      }
      // Do not hide an effect-only part or infer hiding from occupied body slots.
      // An explicit empty mesh replacement is required for this first runtime stage.
      resolved.hidden = matching.some(({ rule }) => rule.bOverrideMesh)
        && !resolved.staticMesh && !resolved.skeletalMesh && !resolved.effect && !resolved.unresolved.length;
      return resolved;
    });
    items[item.id] = { source: item.source, parts,
      hidden: parts.length > 0 && parts.every(part => part.hidden) };
  }
  const fittingTags = new Set(definitions.filter(item => !items[item.id].hidden)
    .flatMap(item => item.properties.ActivatesTags ?? []));
  const materialParameters = definitions.flatMap(item => (item.properties.ActivatesMaterialParameters ?? []).flatMap(rule => {
    if (rule.MatchingTags.length && !rule.MatchingTags.some(tag => hasSourceTag(tags, tag))) return [];
    return [{ itemId: item.id, source: path(rule.MaterialInstance), slots: rule.SlotNames,
      unresolved: [
        ...(rule.MatchingTags.length > 1 ? ['multi-tag material parameter condition'] : []),
        ...(rule.Behavior !== 'ECustomizationMaterialBehavior::OverrideParameters' ? ['unsupported material parameter behavior'] : []),
      ] }];
  }));
  for (const item of Object.values(items)) item.materialParameters = [];
  for (const parameter of materialParameters) items[parameter.itemId].materialParameters!.push(parameter);
  return { tags: [...tags].sort(), fittingTags: [...fittingTags].sort(), items, unresolvedItems: [],
    materialParameters,
    slotConflicts: [...slots].filter(([, ids]) => ids.length > 1).map(([slot, ids]) => ({ slot, items: ids })) };
}

const pending = new Map<string, Promise<unknown>>();
async function readJson(url: string): Promise<unknown> {
  let value = pending.get(url);
  if (!value) {
    value = fetchAsset(url).then(async (response) => {
      return response.json() as Promise<unknown>;
    }).catch((error) => { pending.delete(url); throw error; });
    pending.set(url, value);
  }
  return value;
}

export class MissingSourceDefinitionError extends Error {
  constructor(readonly itemIds: string[]) {
    super(`Missing outfit fitting data: ${itemIds.join(', ')}`);
    this.name = 'MissingSourceDefinitionError';
  }
}

export async function loadSourceOutfit(ids: string[], baseUrl: string): Promise<SourceOutfit> {
  const catalog = await readJson(`${baseUrl}/catalog.json`) as { formatVersion: number; items: string[] };
  if (catalog.formatVersion !== 1 || !Array.isArray(catalog.items)) {
    pending.delete(`${baseUrl}/catalog.json`);
    throw new Error("Unsupported source outfit index");
  }
  const available = new Set(catalog.items);
  const selected = [...new Set(ids)];
  // Unknown selected items may author tags that replace the head, hide hair, or change materials.
  // Never resolve a partial selection as if those items contributed no rules. The viewer keeps
  // its last appearance on this error; missing metadata elsewhere in the catalog is irrelevant.
  const missing = selected.filter(id => !available.has(id));
  if (missing.length) throw new MissingSourceDefinitionError(missing);
  const definitions = await Promise.all(selected.map(async (id) => {
    const record = await readJson(`${baseUrl}/items/${encodeURIComponent(id)}.json`) as SourceDefinition;
    if (record.formatVersion !== 1 || record.id !== id || !record.properties || !record.sourceSha256) {
      pending.delete(`${baseUrl}/items/${encodeURIComponent(id)}.json`);
      throw new Error(`Invalid source definition for ${id}`);
    }
    return record;
  }));
  // The current rig is the medium body in the third-person frontend. Body-type
  // morphs and further context tags will be bound when those controls are added.
  return resolveSourceOutfit(definitions, ["Customization.Archetype.Medium"]);
}

/** One socket rest authored by a component that is not the body: a head mesh, or an optional
 *  attachment mesh. Matrices are the converted (GLB) axes the preserved meshes already use. */
export interface SourceSocketFrame {
  source: string;        // exact source object path of the component that carries the socket
  sourceSha256: string;  // exact source package hash of that component
  bone: string;          // the live bone the socket hangs from, inside that component
  bodyBone: boolean;     // that bone is the preserved body's own, at the same rest, not the component's
  parentRest: number[];  // 16 — that bone's component-space rest
  rest: number[];        // 16 — the socket's component-space rest, including its own scale
  restScale: [number, number, number]; // the diagonal the socket itself carries, converted axes
}

/** Where a socket lives when it is not a body bone. A head-component socket is resolved against
 *  the source head that is actually equipped; an optional attachment mesh authors exactly one. */
export type SourceAttachmentFrame =
  | { kind: 'head-component'; components: SourceSocketFrame[] }
  | { kind: 'optional-mesh'; component: SourceSocketFrame };

export interface AssemblyAssets {
  formatVersion: number;
  meshes: Record<string, { url: string; kind?: 'skeletal' | 'static'; bodyMaskUrl?: string; bodyMaskUvTiles?: [number, number]; slots: { slot: string; material: string }[] }>;
  materials: Record<string, string>;
  materialVariants?: Record<string, string>;
  attachmentBody?: { source: string; url: string; restBones: Record<string, number[]> };
  attachmentFrames?: {
    headComponents?: Record<string, SourceFrameComponent>;
    optionalMeshes?: Record<string, SourceFrameComponent>;
  };
}

/** One component's socket rests as the index records them; `bodyBone` is decided while resolving. */
export interface SourceFrameComponent {
  sourceSha256: string;
  sockets: Record<string, Omit<SourceSocketFrame, 'source' | 'sourceSha256' | 'bodyBone'>>;
}

/** One preserved mesh section's recipient, identified by its exact source material index: the
 *  position the converter writes in GLB materials order, which is the source's own section
 *  MaterialIndex and the order of the index's `slots` array. A repeated authored slot name still
 *  names two different recipients, so the index — not the name — is what selects one. */
export interface SourceMaterialSection {
  materialIndex: number;
  slot: string;          // the authored FName spelling, exactly as the source stores it
  defaultSource: string; // that section's own authored default, before any override
  source: string;        // the effective recipient after overrides
  url: string;           // the recovered material, or the parameter variant when overlays apply
}

export interface SourceRigPart {
  sourceIndex: number;
  sourceMesh: string;
  url: string;
  bodyMaskUrl?: string;
  bodyMaskUvTiles?: [number, number];
  materials: Record<string, { url: string; source: string }>;
  /** Present only when this mesh repeats a material slot name, in source material index order and
   *  covering every section. `materials` then omits the repeated name instead of keeping whichever
   *  section happened to be resolved last: a name that no longer identifies one recipient must not
   *  answer for another. Meshes whose slot names are unique are unchanged and carry no sections. */
  materialSections?: SourceMaterialSection[];
  attachment?: {
    bodyUrl: string; socket: string;
    sourceRestMatrix?: number[]; // body-bone sockets only; a frame carries its own component rest
    position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number];
    frame?: SourceAttachmentFrame;
  };
  /** This merged skeletal part reached support through the neutral compensated head frame below,
   *  not through an ordinary identity placement. It is still body-space geometry with no
   *  attachment: the flag only records which route accepted it. */
  neutralHeadFrame?: true;
}

const MATRIX = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === 16 && value.every(v => typeof v === 'number' && Number.isFinite(v));

// A component bone that is also the preserved body's own must carry the body's rest: the driver
// then supplies it, and no runtime comparison against the driver's own bind axes is possible.
// A bone the component owns is checked against this rest again when the rig resolves it.
function socketFrame(source: string, entry: SourceFrameComponent | undefined, socket: string,
  body: NonNullable<AssemblyAssets['attachmentBody']>, label: string): SourceSocketFrame {
  const rest = entry?.sockets?.[socket];
  if (!entry?.sourceSha256 || !rest || typeof rest.bone !== 'string' || !rest.bone ||
      !MATRIX(rest.rest) || !MATRIX(rest.parentRest) ||
      !Array.isArray(rest.restScale) || rest.restScale.length !== 3 ||
      !rest.restScale.every(v => Number.isFinite(v) && v !== 0))
    throw new Error(`Missing preserved ${label} frame: ${socket}`);
  const anchor = body.restBones[rest.bone];
  const bodyBone = MATRIX(anchor);
  if (bodyBone && anchor.some((v, i) => Math.abs(v - rest.parentRest[i]) > 1e-5))
    throw new Error(`${label} anchor is not the preserved body rest: ${rest.bone}`);
  return { source, sourceSha256: entry.sourceSha256, bone: rest.bone, bodyBone, parentRest: [...rest.parentRest],
    rest: [...rest.rest], restScale: [rest.restScale[0], rest.restScale[1], rest.restScale[2]] };
}

export interface SourceSkinPart {
  sourceIndex: number;
  sourceMesh: string;
  url: string;
  boundsOrigin: [number, number, number]; // imported source bounds, Unreal centimetres
  materials: Record<string, { source: string; defaultSource: string; url?: string; legacyName?: string; parameterOverrides?: string[] }>;
}
export interface SourceSkinPair {
  head: SourceSkinPart;
  body: SourceSkinPart;
  /** Present only when this outfit explicitly replaced the source head's mesh with nothing and the
   *  selected hair needs no scalp. `head` stays the index's own record of that head, so the index
   *  and every visible path are unchanged; the runtime must not request or render it while this is
   *  set, and removing whatever empties it restores the same head through the ordinary path. */
  headOmitted?: SourceHeadOmission;
}

/** Why one outfit does not render the head its face authors. A transient outfit state, derived per
 *  resolution: the immutable index never carries it. */
export interface SourceHeadOmission {
  sourceMesh: string;          // the head mesh the source authored, and that returns when uncovered
  rules: number[];             // indices into that head part's own TagOverrides that emptied it
  hair: SourceScalpSelection;  // why no scalp recipient is needed, keeping the hair's own id
}

/** The hair an outfit selects, as far as a scalp recipient is concerned. */
export interface SourceHairSelection {
  id?: string;                            // undefined only when the outfit selects no hair at all
  item?: SourceOutfit["items"][string];   // its resolved item, when the source path supports it
}

/** No scalp recipient is required: no hair at all, a hair whose every part is explicitly emptied,
 *  or a validated material-only choice — which is never `item.hidden`, having no part to hide. */
export type SourceScalpSelection =
  | { kind: "none" }
  | { kind: "hidden"; id: string }
  | { kind: "material-only"; id: string };

/** A part one of the rules the resolver actually applied replaced with nothing. The hidden flag
 *  alone is not evidence, and neither is an occupied slot or a covering item's name. */
export function explicitlyEmptiedPart(part: ResolvedPart): boolean {
  if (!part.hidden || part.unresolved.length || part.staticMesh || part.skeletalMesh || part.effect) return false;
  if (part.definition.LogicModules?.length) return false;
  if (!part.rules.every(index => {
    const rule = part.definition.TagOverrides?.[index];
    return Number.isInteger(index) && !!rule && rule.MatchingTags.length <= 1 &&
      !offsetsPlacement(rule) && !rule.bAddLogicModules;
  })) return false;
  return part.rules.some(index => {
    const rule = part.definition.TagOverrides?.[index];
    return !!rule?.bOverrideMesh && !path(rule.ReplacementStaticMesh) && !path(rule.ReplacementSkeletalMesh);
  });
}

/** Whether a hair selection leaves no geometry for a scalp to sit under, or undefined when it does —
 *  including a hair this build cannot resolve at all. An unsupported or legacy hairstyle is never
 *  permission: it keeps its own geometry and still needs the head under it. */
export function sourceHairWithoutScalp(id: string | undefined,
  item?: SourceOutfit["items"][string]): SourceScalpSelection | undefined {
  if (id === undefined) return item ? undefined : { kind: "none" };
  if (!item || item.materialParameters?.some(p => p.unresolved.length)) return undefined;
  // Donors and no visual part of its own. Only a choice the offline audit accepted reaches here:
  // that gate is the caller's supported-item index, exactly as it is for geometry.
  if (!item.parts.length) {
    const parameters = item.materialParameters ?? [];
    const scalpOnly = parameters.length > 0 && parameters.every(p => p.source && p.slots.length &&
      p.slots.every(s => ['shader_head_shader', 'm_hair'].includes(materialSlotIdentity(s)))) &&
      parameters.some(p => p.slots.some(s => materialSlotIdentity(s) === 'shader_head_shader'));
    return scalpOnly ? { kind: "material-only", id } : undefined;
  }
  return item.parts.every(explicitlyEmptiedPart) ? { kind: "hidden", id } : undefined;
}

/** The omission this outfit authors for one preserved head part, on that part's own evidence: the
 *  exact source index, the head role, an explicit empty mesh replacement, and the original head
 *  mesh identity the index records. */
export function omittedSourceHead(item: SourceOutfit["items"][string], head: Pick<SourceSkinPart, 'sourceIndex' | 'sourceMesh'>,
  hair: SourceHairSelection): SourceHeadOmission | undefined {
  const part = item.parts.find(p => p.sourceIndex === head.sourceIndex);
  if (!part || !part.definition.bIsHeadMesh || !explicitlyEmptiedPart(part) ||
      path(part.definition.SkeletalMesh) !== head.sourceMesh) return undefined;
  const p = part.definition, wrap = p.WrapDeformation;
  if (path(p.StaticMesh) || path(p.Effect) || p.SkeletalMesh.SubPathString || p.bIsAttached || p.bAttachToHeadMesh ||
      path(p.OptionalAttachmentMesh) || p.LogicModules?.length ||
      wrap?.bIsWrapDeformed || wrap?.bIsWrapDeformedByHeadComponent || path(wrap?.OptionalWrapDeformerMesh) ||
      Object.values(p.LocalPosition ?? {}).some(v => v !== 0) ||
      Object.values(p.LocalRotation ?? {}).some(v => v !== 0) ||
      Object.values(p.LocalScale ?? {}).some(v => v !== 1)) return undefined;
  const scalp = sourceHairWithoutScalp(hair.id, hair.item);
  return scalp ? { sourceMesh: head.sourceMesh, rules: [...part.rules], hair: scalp } : undefined;
}

export async function loadSourceSkinPair(id: string, item: SourceOutfit["items"][string], baseUrl: string,
  parameters: SourceMaterialParameters[] = [], hair?: SourceHairSelection): Promise<SourceSkinPair | undefined> {
  const index = await readJson(`${baseUrl}/skin-pairs.json`) as {
    // The index describes the source, never a transient outfit state: an omission is added here.
    formatVersion: number; items: Record<string, { head: SourceSkinPart; body: SourceSkinPart; source: string }>;
  };
  if (index.formatVersion !== 1 || !index.items) {
    pending.delete(`${baseUrl}/skin-pairs.json`);
    throw new Error("Invalid source skin-pair index");
  }
  const pair = index.items[id];
  if (!pair) return;
  // Callers that pass no hair selection keep the previous contract, where a hidden head stays
  // unsupported. An omitted head has no scalp recipient, so no variant is requested for it.
  const omitted = hair ? omittedSourceHead(item, pair.head, hair) : undefined;
  const needsVariants = parameters.length && (!omitted || Object.keys(pair.body.materials)
    .some(slot => parameterOverlays(parameters, slot, Object.keys(pair.body.materials)).length));
  const variants = needsVariants
    ? (await readJson(`${baseUrl}/assets.json`) as AssemblyAssets).materialVariants : undefined;
  if (pair.source !== item.source || item.parts.length !== 2) throw new Error("Source skin pair definition changed");
  const resolve = (part: SourceSkinPart, isHead: boolean): SourceSkinPart => {
    const actual = item.parts.find(p => p.sourceIndex === part.sourceIndex);
    const emptied = isHead && !!omitted;
    // An omitted head keeps every other requirement; only the mesh it resolves to differs, and
    // that is the authored source mesh the empty replacement removed.
    const replaced = emptied
      ? { mesh: path(actual?.definition.SkeletalMesh),
          extra: !!path(actual?.definition.StaticMesh) || !!path(actual?.definition.Effect) }
      : { mesh: actual?.skeletalMesh ?? "", extra: !!actual?.staticMesh || !!actual?.effect };
    if (!actual || actual.hidden !== emptied || actual.unresolved.length || replaced.mesh !== part.sourceMesh ||
        replaced.extra || !!actual.definition.bIsHeadMesh !== isHead || actual.definition.bIsAttached ||
        actual.definition.LogicModules?.length || Object.values(actual.definition.LocalPosition ?? {}).some(v => v !== 0) ||
        Object.values(actual.definition.LocalRotation ?? {}).some(v => v !== 0) || Object.values(actual.definition.LocalScale ?? {}).some(v => v !== 1))
      throw new Error("Unsupported source skin pair placement or replacement");
    if (part.boundsOrigin.length !== 3 || !part.boundsOrigin.every(Number.isFinite)) throw new Error("Invalid source skin bounds");
    const url = (path: string) => new URL(path, new URL(baseUrl + "/", window.location.href)).href;
    const slots = Object.keys(part.materials);
    const materials = Object.fromEntries(Object.entries(part.materials).map(([slot, binding]) => {
      if ((materialSlotOverride(actual.materials, slot, slots) ?? binding.defaultSource) !== binding.source)
        throw new Error(`Unvalidated skin material override: ${slot}`);
      // An omitted head is no recipient for a scalp donor: none is bound to it and none is
      // demanded of the index. The body's own bindings are unchanged.
      const overlays = emptied ? [] : parameterOverlays(parameters, slot, slots);
      const variant = overlays.length ? variants?.[JSON.stringify([binding.source, ...overlays])] : undefined;
      if (overlays.length && !variant) throw new Error(`Unvalidated skin parameter variant: ${slot}`);
      const materialUrl = variant ?? binding.url;
      return [slot, { ...binding, url: materialUrl ? url(materialUrl) : undefined,
        ...(overlays.length ? { parameterOverrides: overlays } : {}) }];
    }));
    return { ...part, url: url(part.url), materials };
  };
  return { head: resolve(pair.head, true), body: resolve(pair.body, false),
    ...(omitted ? { headOmitted: omitted } : {}) };
}

export async function loadSourceRigParts(item: SourceOutfit["items"][string], baseUrl: string): Promise<SourceRigPart[]> {
  const assets = await readJson(`${baseUrl}/assets.json`) as AssemblyAssets;
  if (assets.formatVersion !== 1 || !assets.meshes || !assets.materials) {
    pending.delete(`${baseUrl}/assets.json`);
    throw new Error("Invalid source assembly assets");
  }
  const url = (path: string) => new URL(path, new URL(baseUrl + "/", window.location.href)).href;
  return resolveSourceRigParts(item, assets, url);
}

// The socket a neutral frame may compensate is the preserved body's own head bone, spelled exactly
// as the source spells it. No other socket, and no case variant, is accepted here.
const BODY_HEAD_SOCKET = 'head';
// Metres, on the converted GLB translation of the rest * local product.
const NEUTRAL_TRANSLATION_METRES = 2e-6;
// Unitless, on that same product's linear basis and its affine row.
const NEUTRAL_LINEAR_UNITLESS = 2e-6;
// Unitless, on the preserved rest itself: rigid within the float32 roundoff an imported rest carries.
const BODY_REST_RIGID_UNITLESS = 1e-4;

/** One authored vector exactly as the source spells it: the named components, every one a finite
 *  number, and nothing else. A missing, partial, extended or non-numeric vector is not a transform. */
function sourceVector(value: unknown, keys: readonly string[]): number[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length) return undefined;
  const values = keys.map(key => record[key]);
  return values.every(v => typeof v === 'number' && Number.isFinite(v)) ? values as number[] : undefined;
}

/** A neutral compensated head frame: a nonattached, mergeable skeletal part whose authored local
 *  transform, converted the same way an attachment's is, multiplies the preserved body's own `head`
 *  rest back to the identity. Such a part is drawn exactly where an identity placement would draw
 *  it — in the body space its vertices and rest bones are already authored in — so the resolver may
 *  admit it without knowing why the fields were authored.
 *
 *  This recognises one measured frame and nothing more. It is not a claim about how the native
 *  engine consumes these fields; any other placement, any nonzero residue beyond the tolerances,
 *  any head role, attachment, wrapper, effect, logic module or unresolved rule stays refused, and
 *  the caller's supported-item index and its geometry verification remain separate gates. */
export function neutralSourceHeadFrame(part: ResolvedPart, assets: AssemblyAssets): boolean {
  const p = part.definition, wrap = p.WrapDeformation;
  if (p.bCanBeMerged !== true || p.bIsAttached !== false || p.bAttachToHeadMesh !== false ||
      p.bIsHeadMesh === true || p.AttachmentSocket !== BODY_HEAD_SOCKET) return false;
  if (part.hidden || part.unresolved.length || part.effect || path(p.Effect) || p.LogicModules?.length ||
      part.staticMesh || path(p.StaticMesh) || path(p.OptionalAttachmentMesh) || path(p.OptionalHeadWrapMesh) ||
      wrap?.bIsWrapDeformed || wrap?.bIsWrapDeformedByHeadComponent || path(wrap?.OptionalWrapDeformerMesh)) return false;
  // The part has to bring a skeletal mesh of its own: no static, no section reference, no mesh the
  // index would have to guess at.
  if (!part.skeletalMesh || !path(p.SkeletalMesh) || p.SkeletalMesh.SubPathString) return false;
  if (assets.meshes[part.skeletalMesh]?.kind !== 'skeletal') return false;
  const body = assets.attachmentBody;
  if (typeof body?.source !== 'string' || !body.source || typeof body.url !== 'string' || !body.url) return false;
  const position = sourceVector(p.LocalPosition, ['X', 'Y', 'Z']);
  const rotation = sourceVector(p.LocalRotation, ['Pitch', 'Yaw', 'Roll']);
  const scale = sourceVector(p.LocalScale, ['X', 'Y', 'Z']);
  if (!position || !rotation || !scale || !scale.every(v => v === 1)) return false;
  const rest = body.restBones?.[BODY_HEAD_SOCKET];
  if (!MATRIX(rest) || !isRigidSourceRest(rest, BODY_REST_RIGID_UNITLESS)) return false;
  const product = multiplySourceMatrices(rest, sourceLocalMatrix(position as SourceVector,
    rotation as SourceVector, scale as SourceVector));
  const deviation = sourceIdentityDeviation(product);
  return deviation.translation <= NEUTRAL_TRANSLATION_METRES &&
    Math.max(deviation.linear, deviation.affine) <= NEUTRAL_LINEAR_UNITLESS;
}

// The offline coverage audit and runtime use the same support boundary. An item
// becomes available only when every active part has its exact mesh and materials.
export function resolveSourceRigParts(item: SourceOutfit["items"][string], assets: AssemblyAssets,
  url: (path: string) => string = path => path): SourceRigPart[] {
  return item.parts.filter(part => !part.hidden).map(part => {
    const p = part.definition;
    const attached = !!part.staticMesh && !part.skeletalMesh && !!p.bIsAttached;
    const optionalMesh = path(p.OptionalAttachmentMesh);
    // The one added route for a nonattached part: an authored local transform that is exactly the
    // inverse of the preserved head rest. Every other placement below is refused as before.
    const neutral = !attached && neutralSourceHeadFrame(part, assets);
    if (part.unresolved.length || part.effect || p.LogicModules?.length ||
        (attached && (p.WrapDeformation?.bIsWrapDeformed || p.WrapDeformation?.bIsWrapDeformedByHeadComponent || path(p.WrapDeformation?.OptionalWrapDeformerMesh))) ||
        // A socket belongs to the body, to the head component, or to one optional attachment
        // mesh — never to two of them, and never to a part that is not an attached static.
        (p.bAttachToHeadMesh && optionalMesh) || (!attached && (p.bAttachToHeadMesh || optionalMesh)) ||
        p.bIsHeadMesh ||
        (!attached && !neutral && (part.staticMesh || p.bIsAttached ||
        Object.values(p.LocalPosition ?? {}).some(v => v !== 0) ||
        Object.values(p.LocalRotation ?? {}).some(v => v !== 0) ||
        Object.values(p.LocalScale ?? {}).some(v => v !== 1)))) {
      throw new Error(`Unsupported source assembly part ${part.sourceIndex}`);
    }
    let attachment: SourceRigPart['attachment'];
    if (attached) {
      const body = assets.attachmentBody, socket = p.AttachmentSocket;
      let frame: SourceAttachmentFrame | undefined, restMatrix: number[] | undefined;
      if (!body || !socket) throw new Error('Missing preserved source attachment frame');
      if (p.bAttachToHeadMesh) {
        // Head-component sockets are authored per head mesh. The item is supported only when
        // every preserved head provides the socket; the rig then uses the one actually equipped.
        const heads = Object.entries(assets.attachmentFrames?.headComponents ?? {});
        if (!heads.length) throw new Error(`Missing preserved head component frame: ${socket}`);
        frame = { kind: 'head-component',
          components: heads.map(([source, entry]) => socketFrame(source, entry, socket, body, 'head component')) };
      } else if (optionalMesh) {
        const component = socketFrame(optionalMesh, assets.attachmentFrames?.optionalMeshes?.[optionalMesh],
          socket, body, 'optional attachment mesh');
        // An optional mesh is only ever driven through the body, so its anchor has to be a
        // preserved body bone; its own added joints are not simulated.
        if (!component.bodyBone)
          throw new Error(`Optional attachment mesh anchor is not the preserved body rest: ${component.bone}`);
        frame = { kind: 'optional-mesh', component };
      } else {
        restMatrix = body.restBones[socket];
        if (!MATRIX(restMatrix)) throw new Error('Missing preserved source attachment frame');
      }
      const position = p.LocalPosition, rotation = p.LocalRotation, scale = p.LocalScale;
      // Authored positive scales, uniform or not, are applied at rest by the rig. Mirrored or
      // singular authored scales stay unsupported; only a socket's own source scale may reflect.
      if (!position || !rotation || !scale ||
          ![...Object.values(position), ...Object.values(rotation), ...Object.values(scale)].every(Number.isFinite) ||
          Object.values(scale).some(v => !(v > 0))) throw new Error('Unsupported source attachment transform');
      attachment = { bodyUrl: url(body.url), socket, ...(restMatrix ? { sourceRestMatrix: restMatrix } : {}),
        position: [position.X, position.Y, position.Z], rotation: [rotation.Pitch, rotation.Yaw, rotation.Roll],
        scale: [scale.X, scale.Y, scale.Z], ...(frame ? { frame } : {}) };
    }
    const sourceMesh = attached ? part.staticMesh : part.skeletalMesh;
    const mesh = assets.meshes[sourceMesh];
    if (!mesh) throw new Error(`Missing preserved source mesh: ${sourceMesh}`);
    if (attached && mesh.kind !== 'static') throw new Error('Attachment requires a preserved static mesh');
    const materials: SourceRigPart["materials"] = {};
    const slots = mesh.slots.map(slot => slot.slot);
    // One authored name may name several sections of one mesh, each with its own default. Such a
    // name cannot be a key, so those meshes carry every section by exact source material index
    // instead; the overrides and donors an occurrence receives are still looked up by that name.
    const repeated = new Set(slots.filter((slot, index) => slots.indexOf(slot) !== index));
    const sections: SourceMaterialSection[] = [];
    for (const [materialIndex, slot] of mesh.slots.entries()) {
      const source = materialSlotOverride(part.materials, slot.slot, slots) ?? slot.material;
      const overlays = parameterOverlays(item.materialParameters ?? [], slot.slot, slots);
      const material = overlays.length ? assets.materialVariants?.[JSON.stringify([source, ...overlays])] : assets.materials[source];
      if (!material) throw new Error(`Missing recovered material for ${slot.slot}: ${source}`);
      const materialUrl = url(material);
      sections.push({ materialIndex, slot: slot.slot, defaultSource: slot.material, source, url: materialUrl });
      if (!repeated.has(slot.slot)) materials[slot.slot] = { url: materialUrl, source };
    }
    return { sourceIndex: part.sourceIndex, sourceMesh, url: url(mesh.url), materials, attachment,
      ...(repeated.size ? { materialSections: sections } : {}),
      bodyMaskUvTiles: mesh.bodyMaskUvTiles,
      bodyMaskUrl: mesh.bodyMaskUrl ? url(mesh.bodyMaskUrl) : undefined,
      ...(neutral ? { neutralHeadFrame: true as const } : {}) };
  });
}

export async function loadSourceAssemblyItems(baseUrl: string): Promise<Set<string>> {
  const index = await readJson(`${baseUrl}/supported-items.json`) as { formatVersion: number; items: string[] };
  if (index.formatVersion !== 1 || !Array.isArray(index.items) || index.items.some(id => typeof id !== "string")) {
    pending.delete(`${baseUrl}/supported-items.json`);
    throw new Error("Invalid source assembly item index");
  }
  return new Set(index.items);
}

// Picker progress follows the active asset release, including the separately reconstructed face.
// These entries indicate work has been applied; neither index claims perfect visual fidelity.
export async function loadSourceReconstructionItems(baseUrl: string): Promise<Set<string>> {
  const [assemblies, skinPairs] = await Promise.all([
    loadSourceAssemblyItems(baseUrl),
    readJson(`${baseUrl}/skin-pairs.json`) as Promise<{ formatVersion: number; items: Record<string, unknown> }>,
  ]);
  if (skinPairs.formatVersion !== 1 || !skinPairs.items || typeof skinPairs.items !== "object" || Array.isArray(skinPairs.items)) {
    pending.delete(`${baseUrl}/skin-pairs.json`);
    throw new Error("Invalid source skin pair item index");
  }
  return new Set([...assemblies, ...Object.keys(skinPairs.items)]);
}
