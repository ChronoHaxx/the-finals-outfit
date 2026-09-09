// Decoded source relationships, kept independent of Three and the catalog's
// older filename-derived garment guesses. Missing rules stay explicit.
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
          if (rule.bOverrideMesh || rule.bOverrideEffect || rule.bOverrideMaterials || rule.bOffsetTransform || rule.bAddLogicModules)
            resolved.unresolved.push(`multi-tag condition ${index}`);
          return;
        }
        if (rule.bOffsetTransform || rule.bAddLogicModules) resolved.unresolved.push(`unsupported placement or logic override ${index}`);
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
    value = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Source outfit data unavailable: ${response.status}`);
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

export interface AssemblyAssets {
  formatVersion: number;
  meshes: Record<string, { url: string; kind?: 'skeletal' | 'static'; bodyMaskUrl?: string; bodyMaskUvTiles?: [number, number]; slots: { slot: string; material: string }[] }>;
  materials: Record<string, string>;
  materialVariants?: Record<string, string>;
  attachmentBody?: { source: string; url: string; restBones: Record<string, number[]> };
}

export interface SourceRigPart {
  sourceIndex: number;
  sourceMesh: string;
  url: string;
  bodyMaskUrl?: string;
  bodyMaskUvTiles?: [number, number];
  materials: Record<string, { url: string; source: string }>;
  attachment?: {
    bodyUrl: string; socket: string; sourceRestMatrix: number[];
    position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number];
  };
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
    if (part.unresolved.length || part.effect || p.LogicModules?.length ||
        (attached && (p.WrapDeformation?.bIsWrapDeformed || p.WrapDeformation?.bIsWrapDeformedByHeadComponent || path(p.WrapDeformation?.OptionalWrapDeformerMesh))) ||
        p.bAttachToHeadMesh || path(p.OptionalAttachmentMesh) || p.bIsHeadMesh ||
        (!attached && (part.staticMesh || p.bIsAttached ||
        Object.values(p.LocalPosition ?? {}).some(v => v !== 0) ||
        Object.values(p.LocalRotation ?? {}).some(v => v !== 0) ||
        Object.values(p.LocalScale ?? {}).some(v => v !== 1)))) {
      throw new Error(`Unsupported source assembly part ${part.sourceIndex}`);
    }
    let attachment: SourceRigPart['attachment'];
    if (attached) {
      const body = assets.attachmentBody, socket = p.AttachmentSocket;
      const frame = socket ? body?.restBones[socket] : undefined;
      if (!body || !socket || !frame || frame.length !== 16 || !frame.every(Number.isFinite))
        throw new Error('Missing preserved source attachment frame');
      const position = p.LocalPosition, rotation = p.LocalRotation, scale = p.LocalScale;
      if (!position || !rotation || !scale ||
          ![...Object.values(position), ...Object.values(rotation), ...Object.values(scale)].every(Number.isFinite) ||
          Object.values(scale).some(v => v !== 1)) throw new Error('Unsupported source attachment transform');
      attachment = { bodyUrl: url(body.url), socket, sourceRestMatrix: frame,
        position: [position.X, position.Y, position.Z], rotation: [rotation.Pitch, rotation.Yaw, rotation.Roll],
        scale: [scale.X, scale.Y, scale.Z] };
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
