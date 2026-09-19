// Decoded source relationships, kept independent of Three and the catalog's
// older filename-derived garment guesses. Missing rules stay explicit.
import { fetchAsset } from "../lib/asset-fetch";

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
  bIsHeadMesh?: boolean;
  bAttachToHeadMesh?: boolean;
  OptionalAttachmentMesh?: SoftPath;
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

function parameterOverlays(parameters: SourceMaterialParameters[], slot: string): string[] {
  const matching = parameters.filter(p => p.slots.includes(slot));
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

export async function loadSourceOutfit(ids: string[], baseUrl: string): Promise<SourceOutfit> {
  const catalog = await readJson(`${baseUrl}/catalog.json`) as { formatVersion: number; items: string[] };
  if (catalog.formatVersion !== 1 || !Array.isArray(catalog.items)) {
    pending.delete(`${baseUrl}/catalog.json`);
    throw new Error("Unsupported source outfit index");
  }
  const available = new Set(catalog.items);
  const selected = [...new Set(ids)];
  const definitions = await Promise.all(selected.filter(id => available.has(id)).map(async (id) => {
    const record = await readJson(`${baseUrl}/items/${encodeURIComponent(id)}.json`) as SourceDefinition;
    if (record.formatVersion !== 1 || record.id !== id || !record.properties || !record.sourceSha256) {
      pending.delete(`${baseUrl}/items/${encodeURIComponent(id)}.json`);
      throw new Error(`Invalid source definition for ${id}`);
    }
    return record;
  }));
  // The current rig is the medium body in the third-person frontend. Body-type
  // morphs and further context tags will be bound when those controls are added.
  const outfit = resolveSourceOutfit(definitions, ["Customization.Archetype.Medium"]);
  outfit.unresolvedItems = selected.filter(id => !available.has(id));
  return outfit;
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

export interface SourceRigPart {
  sourceIndex: number;
  sourceMesh: string;
  url: string;
  bodyMaskUrl?: string;
  bodyMaskUvTiles?: [number, number];
  materials: Record<string, { url: string; source: string }>;
  attachment?: {
    bodyUrl: string; socket: string;
    sourceRestMatrix?: number[]; // body-bone sockets only; a frame carries its own component rest
    position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number];
    frame?: SourceAttachmentFrame;
  };
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
export interface SourceSkinPair { head: SourceSkinPart; body: SourceSkinPart }

export async function loadSourceSkinPair(id: string, item: SourceOutfit["items"][string], baseUrl: string,
  parameters: SourceMaterialParameters[] = []): Promise<SourceSkinPair | undefined> {
  const index = await readJson(`${baseUrl}/skin-pairs.json`) as {
    formatVersion: number; items: Record<string, SourceSkinPair & { source: string }>;
  };
  if (index.formatVersion !== 1 || !index.items) {
    pending.delete(`${baseUrl}/skin-pairs.json`);
    throw new Error("Invalid source skin-pair index");
  }
  const pair = index.items[id];
  if (!pair) return;
  const variants = parameters.length ? (await readJson(`${baseUrl}/assets.json`) as AssemblyAssets).materialVariants : undefined;
  if (pair.source !== item.source || item.parts.length !== 2) throw new Error("Source skin pair definition changed");
  const resolve = (part: SourceSkinPart, isHead: boolean): SourceSkinPart => {
    const actual = item.parts.find(p => p.sourceIndex === part.sourceIndex);
    if (!actual || actual.hidden || actual.unresolved.length || actual.skeletalMesh !== part.sourceMesh ||
        actual.staticMesh || actual.effect || !!actual.definition.bIsHeadMesh !== isHead || actual.definition.bIsAttached ||
        actual.definition.LogicModules?.length || Object.values(actual.definition.LocalPosition ?? {}).some(v => v !== 0) ||
        Object.values(actual.definition.LocalRotation ?? {}).some(v => v !== 0) || Object.values(actual.definition.LocalScale ?? {}).some(v => v !== 1))
      throw new Error("Unsupported source skin pair placement or replacement");
    if (part.boundsOrigin.length !== 3 || !part.boundsOrigin.every(Number.isFinite)) throw new Error("Invalid source skin bounds");
    const url = (path: string) => new URL(path, new URL(baseUrl + "/", window.location.href)).href;
    const materials = Object.fromEntries(Object.entries(part.materials).map(([slot, binding]) => {
      if ((actual.materials[slot] ?? binding.defaultSource) !== binding.source)
        throw new Error(`Unvalidated skin material override: ${slot}`);
      const overlays = parameterOverlays(parameters, slot);
      const variant = overlays.length ? variants?.[JSON.stringify([binding.source, ...overlays])] : undefined;
      if (overlays.length && !variant) throw new Error(`Unvalidated skin parameter variant: ${slot}`);
      const materialUrl = variant ?? binding.url;
      return [slot, { ...binding, url: materialUrl ? url(materialUrl) : undefined,
        ...(overlays.length ? { parameterOverrides: overlays } : {}) }];
    }));
    return { ...part, url: url(part.url), materials };
  };
  return { head: resolve(pair.head, true), body: resolve(pair.body, false) };
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

// The offline coverage audit and runtime use the same support boundary. An item
// becomes available only when every active part has its exact mesh and materials.
export function resolveSourceRigParts(item: SourceOutfit["items"][string], assets: AssemblyAssets,
  url: (path: string) => string = path => path): SourceRigPart[] {
  return item.parts.filter(part => !part.hidden).map(part => {
    const p = part.definition;
    const attached = !!part.staticMesh && !part.skeletalMesh && !!p.bIsAttached;
    const optionalMesh = path(p.OptionalAttachmentMesh);
    if (part.unresolved.length || part.effect || p.LogicModules?.length ||
        (attached && (p.WrapDeformation?.bIsWrapDeformed || p.WrapDeformation?.bIsWrapDeformedByHeadComponent || path(p.WrapDeformation?.OptionalWrapDeformerMesh))) ||
        // A socket belongs to the body, to the head component, or to one optional attachment
        // mesh — never to two of them, and never to a part that is not an attached static.
        (p.bAttachToHeadMesh && optionalMesh) || (!attached && (p.bAttachToHeadMesh || optionalMesh)) ||
        p.bIsHeadMesh ||
        (!attached && (part.staticMesh || p.bIsAttached ||
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
    for (const slot of mesh.slots) {
      const source = part.materials[slot.slot] ?? slot.material;
      const overlays = parameterOverlays(item.materialParameters ?? [], slot.slot);
      const material = overlays.length ? assets.materialVariants?.[JSON.stringify([source, ...overlays])] : assets.materials[source];
      if (!material) throw new Error(`Missing recovered material for ${slot.slot}: ${source}`);
      materials[slot.slot] = { url: url(material), source };
    }
    return { sourceIndex: part.sourceIndex, sourceMesh, url: url(mesh.url), materials, attachment,
      bodyMaskUvTiles: mesh.bodyMaskUvTiles,
      bodyMaskUrl: mesh.bodyMaskUrl ? url(mesh.bodyMaskUrl) : undefined };
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
