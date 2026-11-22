// One outfit pass: bring a CharacterRig from what it wears to what `build` asks for (moved verbatim out of
// CharacterViewer's effect, 11 Nov 2026, multi-character design Phase 1.1, so every character can run it). The caller
// owns the pass's lifetime exactly as the effect did: `control.cancelled()` turns true when a newer pass supersedes this
// one, `control.signal` aborts in-flight loads, and the caller releases `control.prepared.current` when the pass ends.
// `state` is the rig's committed-selection memory (per slot), kept by the caller between passes.
import * as THREE from "three";
import type { CharacterRig, RigMaterial, RigMaterialBinding, RigDecal, RigItem } from "./CharacterRig";
import { loadHeadWraps, type HeadWrapData } from "./HeadWrap";
import { bodyTypePreview, type BodyTypePreview } from "./BodyTypePreview";
import { shownBodyType } from "../lib/body-type";
import { loadSourceAssemblyAssets, loadSourceAssemblyItems, sourceHeadComponentCarries, loadSourceFaceCosmetics, loadSourceReconstructionItems, faceCosmeticRule, loadSourceOutfit, loadSourceRigParts, loadSourceSkinPair, loadSourceSkinPairAttachments, MissingSourceDefinitionError, hairOverridePrecedenceGate, attachmentMirroredScaleGate, mergedPartTransformsGate, activatedEffectPartsGate, type HairOverridePrecedence, type SourceOutfit, type SourceMaterialParameters } from "./SourceAssembly";
import { sourceHairMissingMeshes, sourceHairUnresolved } from "./SourceHairAvailability";
import { effectiveBuild, withRenderableFace, type Build } from "../store/useBuildStore";
import { equipmentConflicts } from "../lib/equipment";
import { getItemById } from "../lib/catalog";
import { getBrowseItem } from "../lib/browse-catalog";
import { modelUrl } from "../lib/assets";
import { SLOTS, type Slot } from "../lib/slots";
import type { Item } from "../lib/item";
import { DEV } from "../lib/viewer-dev-params";

const RECOVERED_ITEMS = ["casual-longcoat-leather-black", "casual-longcoat-leather-camo", "casual-longcoat-satin"];

const sourcePreviewKey = (id: string, item: SourceOutfit['items'][string], skinParameters: SourceMaterialParameters[] = []) =>
  `${id}|parts:${JSON.stringify(item.parts)}|parameters:${JSON.stringify([item.materialParameters, skinParameters])}`;

// Resolve a catalog item's decal (2D body cosmetic) into rig form (paths -> URLs).
function toRigDecal(decal: NonNullable<Item["decal"]>): RigDecal {
  return {
    layers: decal.layers.map((l) => ({
      target: l.target,
      colorUrl: l.colorPath ? modelUrl(l.colorPath) : undefined,
      colorLinear: l.colorLinear,
      maskUrl: l.maskPath ? modelUrl(l.maskPath) : undefined,
      surfaceUrl: l.surfacePath ? modelUrl(l.surfacePath) : undefined,
      surfaceOverride: l.surfaceOverride,
      normalOverride: l.normalOverride,
      uv: l.uv,
      uvScale: l.uvScale,
      uvLayout: l.uvLayout,
      uvOffsetX: l.uvOffsetX,
      colorOverride: l.colorOverride,
      colorMultiply: l.colorMultiply,
      tint: l.tint,
      emissive: l.emissive,
      faceShadowRoughness: l.faceShadowRoughness,
    })),
  };
}

// Per-skin maps (region map, decals, baked composite) are re-generated in place by the asset
// pipeline (same filename, changed bytes), so a long-lived dev browser caches the stale texture
// and re-bakes never appear. In DEV append a cache-buster so equips always fetch the current
// map; prod keeps clean URLs (content is versioned by the off-repo publish).
const bust = (u: string): string =>
  import.meta.env.DEV ? u + (u.includes("?") ? "&" : "?") + "v=" + Date.now() : u;

// Resolve a catalog item's material into rig form (ColorMask path -> resolved URL).
function toRigMaterial(model: NonNullable<Item["model"]>): RigMaterial | undefined {
  const m = model.material;
  if (!m) return undefined;
  return {
    regionMapUrl: m.regionMapPath ? bust(modelUrl(m.regionMapPath)) : undefined,
    regionColors: m.regionColors,
    regionRoughness: m.regionRoughness,
    regionMetalness: m.regionMetalness,
    regionSheen: m.regionSheen,
    regionMeanLuma: m.regionMeanLuma,
    garmentDecals: m.garmentDecals?.map((d) => ({
      region: d.region,
      url: bust(modelUrl(d.path)),
      place: d.place,
      colorA: d.colorA,
      colorB: d.colorB,
    })),
    bakedSet:
      m.bakedSet && !DEV.noBaked
        ? {
            albedo: bust(modelUrl(m.bakedSet.albedo)),
            normal: bust(modelUrl(m.bakedSet.normal)),
            orm: bust(modelUrl(m.bakedSet.orm)),
          }
        : undefined,
    roughness: m.roughness,
    metalness: m.metalness,
    emissiveMapUrl: m.emissiveMap ? bust(modelUrl(m.emissiveMap)) : undefined,
    emissiveIntensity: m.emissiveIntensity,
  };
}

function toRigMaterialBindings(
  model: NonNullable<Item["model"]>,
  tintRecolor?: string,
): Record<string, RigMaterialBinding> | undefined {
  if (!model.materialBindings) return undefined;
  const resolve = (path: string | undefined) => path ? bust(modelUrl(path)) : undefined;
  return Object.fromEntries(Object.entries(model.materialBindings).map(([name, binding]) => [name, {
    ...toRigMaterial({ gltfPath: model.gltfPath, material: binding }),
    ...(tintRecolor ? { tintRecolor } : {}),
    family: binding.family,
    doubleSided: binding.doubleSided,
    glass: binding.glass ? { ...binding.glass, normal: resolve(binding.glass.normal) } : undefined,
    ledScreen: binding.ledScreen ? {
      ...binding.ledScreen,
      animation: resolve(binding.ledScreen.animation)!,
      colorRamp: resolve(binding.ledScreen.colorRamp),
      normal: resolve(binding.ledScreen.normal),
    } : undefined,
  }]));
}

/** What a rig wore after its last committed pass, per slot (the dedup keys the pass compares against). */
export interface OutfitPassState {
  prev: Partial<Record<Slot, string | null>>;
  /** The item whose companion decal is installed for each slot (null: none). */
  companions: Partial<Record<Slot, string | null>>;
}

export const newOutfitPassState = (): OutfitPassState => ({ prev: {}, companions: {} });

export type PreparedAppearance = Awaited<ReturnType<CharacterRig["prepareSourceItems"]>>;

export interface OutfitPassControl {
  cancelled(): boolean;
  signal: AbortSignal;
  /** A staged face/hair appearance; the caller releases it when the pass ends or is cancelled. */
  prepared: { current?: PreparedAppearance };
}

export interface OutfitPassReport {
  setError(message: string | null): void;
  setMissingFittingData(missing: boolean): void;
  setHasRecoveredPreview(recovered: boolean): void;
  /** The resolved source assembly, as soon as it is final (the builder publishes it to the browser harness). */
  onAssembly?(assembly: SourceOutfit): void;
}

/** `outfitBodyType`: the body type of the outfit, as the build store holds it (the picker, 12 Nov 2026). */
export async function runOutfitPass(rig: CharacterRig, build: Build, outfitBodyType: string, state: OutfitPassState,
  control: OutfitPassControl, report: OutfitPassReport): Promise<void> {
  // Render a base top under Outerwear when Upper Body is empty (never-bare torso). Derived
  // from `build` only for the rig — the store/share-link `build` is untouched.
  let supported = new Set<string>();
  let faceCosmetics = new Map<string, string[]>();
  let headWraps: HeadWrapData | undefined;
  // Every item with a source reconstruction (assemblies, skin pairs, face cosmetics): the picker's "3D" set. Known
  // only when the source data loaded; undefined keeps the old behaviour.
  let sourceRenderable: ReadonlySet<string> | undefined;
  if (DEV.reconstructed && DEV.sourceMeshes && DEV.sourceAssembly) {
    try {
      [supported, faceCosmetics, headWraps, sourceRenderable] = await Promise.all([
        loadSourceAssemblyItems(modelUrl("models/reconstructed-assemblies-v1")),
        loadSourceFaceCosmetics(modelUrl("models/reconstructed-assemblies-v1")),
        loadHeadWraps(modelUrl("models/reconstructed-assemblies-v1")),
        loadSourceReconstructionItems(modelUrl("models/reconstructed-assemblies-v1"))]);
      if (control.cancelled()) return;
    } catch (e) {
      if (control.cancelled()) return;
      console.error(e);
      report.setError("Couldn’t load reconstructed item data.");
      return;
    }
  }
  // The body-type context (BodyTypePreview.ts): the capture-only dev switch, else the outfit's own body type
  // (12 Nov 2026: the picker; before it, the index's "bodyType" field, which the active index sets to
  // "masculine" and the app no longer reads). A body type visitors cannot pick yet renders as Masculine.
  let bodyType: BodyTypePreview | undefined;
  try {
    const selected = DEV.bodyType
      ?? (DEV.reconstructed && DEV.sourceAssembly ? shownBodyType(outfitBodyType) : undefined);
    bodyType = bodyTypePreview(selected);
  } catch (e) {
    if (control.cancelled()) return;
    console.error(e);
    report.setError("Couldn’t load the body-type preview context.");
    return;
  }
  // The gated hair TagOverride precedence (w43-hair-precedence): the capture-only dev switch,
  // or the "hairOverridePrecedence" field a preview index sets in its assets.json — the field
  // the activation will set in the active index. The active index carries none, so the default
  // stays off and the resolver refuses exactly as before.
  let hairPrecedence: HairOverridePrecedence | undefined;
  try {
    hairPrecedence = hairOverridePrecedenceGate(DEV.hairPrecedence
      ?? (DEV.reconstructed && DEV.sourceAssembly
        ? (await loadSourceAssemblyAssets(modelUrl("models/reconstructed-assemblies-v1"))).hairOverridePrecedence
        : undefined));
  } catch (e) {
    if (control.cancelled()) return;
    console.error(e);
    report.setError("Couldn’t load the hair override precedence context.");
    return;
  }
  // The gated rig-part resolver behaviour (w45-resolver, w61): the capture-only dev switches, or
  // the "attachmentMirroredScale" / "mergedPartTransforms" / "activatedEffectParts" fields a
  // preview index sets in its assets.json — the fields the activation will set in the active
  // index. The active index carries none, so all stay off and the resolver refuses exactly as
  // before.
  let resolverGates: { attachmentMirroredScale?: string; mergedPartTransforms?: string; activatedEffectParts?: string };
  try {
    const index = DEV.reconstructed && DEV.sourceAssembly
      ? await loadSourceAssemblyAssets(modelUrl("models/reconstructed-assemblies-v1")) : undefined;
    resolverGates = {
      attachmentMirroredScale: DEV.mirroredScale ?? index?.attachmentMirroredScale,
      mergedPartTransforms: DEV.mergedTransforms ?? index?.mergedPartTransforms,
      activatedEffectParts: DEV.activatedEffectParts ?? index?.activatedEffectParts,
    };
    attachmentMirroredScaleGate(resolverGates.attachmentMirroredScale);
    mergedPartTransformsGate(resolverGates.mergedPartTransforms);
    activatedEffectPartsGate(resolverGates.activatedEffectParts);
  } catch (e) {
    if (control.cancelled()) return;
    console.error(e);
    report.setError("Couldn’t load the rig resolver gate context.");
    return;
  }
  // Before any source staging: the context's morph and socket offsets apply from the
  // first equip, and its tag resolves every outfit below as in game.
  rig.setBodyTypePreview(bodyType);
  const completeCoat = !!build.outerwear && supported.has(build.outerwear);
  const covered = completeCoat ? build : effectiveBuild(build);
  // An icon-only face renders the default face instead of a headless body (render-time only).
  const renderableSet = sourceRenderable;
  const eff = renderableSet
    ? withRenderableFace(covered, id => !!getItemById(id)?.model || renderableSet.has(id))
    : covered;
  let assembly: SourceOutfit | undefined;
  let sourceShirtConflict = false;
  if (DEV.reconstructed && DEV.sourceAssembly) {
    try {
      const ids = Object.values(eff).filter((id): id is string => !!id);
      const sourceUrl = modelUrl("models/reconstructed-assembly-v2");
      assembly = await loadSourceOutfit(ids, sourceUrl, bodyType ? [bodyType.tag] : [],
        { hairOverridePrecedence: hairPrecedence });
      sourceShirtConflict = !!completeCoat && assembly.slotConflicts.some(c =>
        c.slot === "EBodySlot::BodyUpper" && c.items.includes(build.outerwear!) && c.items.includes(build.upperBody!));
      if (sourceShirtConflict) {
        // The coat includes its authored top and occupies BodyUpper. Keep the
        // user's shirt selection for removal of the coat, but it contributes
        // neither geometry nor active tags while that complete coat is worn.
        assembly = await loadSourceOutfit(ids.filter(id => id !== build.upperBody), sourceUrl,
          bodyType ? [bodyType.tag] : [], { hairOverridePrecedence: hairPrecedence });
      }
      if (control.cancelled()) return;
    } catch (e) {
      if (control.cancelled()) return;
      if (e instanceof MissingSourceDefinitionError) {
        const names = e.itemIds.map(id => getBrowseItem(id)?.name ?? getItemById(id)?.name ?? id).join(', ');
        report.setMissingFittingData(true);
        report.setError(`Preview paused: fitting data is missing for ${names}. Remove or replace the item to update the preview.`);
      } else {
        console.error(e);
        report.setError("Couldn’t load outfit fitting data.");
      }
      return;
    }
  }
  // A supported source hair this outfit leaves ambiguous is refused as a whole combination:
  // nothing is mutated, the selection is kept, and the next valid change retries.
  if (assembly && eff.hair && DEV.sourceMeshes && DEV.sourceFitting && supported.has(eff.hair)) {
    const ambiguity = sourceHairUnresolved(assembly, eff.hair);
    if (!ambiguity.length) {
      let assets;
      try { assets = await loadSourceAssemblyAssets(modelUrl("models/reconstructed-assemblies-v1")); }
      catch (e) { if (control.cancelled()) return; console.error(e); report.setError("Couldn’t load reconstructed item data."); return; }
      if (control.cancelled()) return;
      ambiguity.push(...sourceHairMissingMeshes(assembly, eff.hair, assets.meshes));
    }
    if (ambiguity.length) {
      console.warn(`Unsupported source hair combination ${eff.hair}: ${ambiguity.join('; ')}`);
      report.setMissingFittingData(true);
      report.setError('Preview paused: this hairstyle and headwear combination is not supported yet. Remove or replace the hair or headwear to update the preview.');
      return;
    }
  }
  // Only touch the current appearance after every selected item has fitting metadata.
  // In particular, a refused outfit must also retain the previous isolation visibility.
  rig.root.traverse((o) => {
    if (typeof o.userData.reconstructionOriginalVisibility === "boolean") {
      o.visible = o.userData.reconstructionOriginalVisibility;
      delete o.userData.reconstructionOriginalVisibility;
    }
  });
  const appearanceSlots = new Set<Slot>();
  let commitAppearance: (() => boolean) | undefined;
  let appearanceOmitsHead = false;
  let equipFailed = false;
  const pendingConflictRemovals: { slot: Slot; replacements: Slot[] }[] = [];
  // Source hair attaches through the preserved body's head frame. The
  // legacy-body diagnostic modes must keep their legacy hair path as well.
  const requestedHair = eff.hair && DEV.sourceMeshes && DEV.sourceFitting && supported.has(eff.hair) ? assembly?.items[eff.hair] : undefined;
  const requestedFace = eff.face && DEV.sourceMeshes && DEV.sourceFitting ? assembly?.items[eff.face] : undefined;
  const faceItem = eff.face ? getItemById(eff.face) : undefined;
  // Whether a scalp has a recipient is a question about the hair the user actually selected,
  // not about the hair the source path happens to support: an unsupported or legacy hairstyle
  // keeps its own geometry and still needs the head it sits on.
  const hairSelection = { id: eff.hair ?? undefined, item: requestedHair };
  // A supported eye cosmetic is material-only: it recolours the worn source face's eye slots.
  const eyes = eff.eyes && faceCosmetics.has(eff.eyes) ? eff.eyes : undefined;
  // A supported makeup or body paint keeps its head paint on the decal path; only its eyelash rule restages the face.
  const cosmeticRule = faceCosmeticRule(faceCosmetics, [eyes, eff.blush, eff.bodyPaint]);
  // A face without a legacy model takes this path too; it renders only when the index holds its legacy-free pair (w91-head-skin).
  if (assembly && requestedFace && faceItem && (requestedHair || !eff.hair)) {
    appearanceSlots.add('hair'); appearanceSlots.add('face');
    if (eyes) appearanceSlots.add('eyes');
    try {
      const parameters = assembly.materialParameters.filter(p => p.itemId === eff.hair || cosmeticRule(p));
      const assetsUrl = modelUrl('models/reconstructed-assemblies-v1');
      const pair = await loadSourceSkinPair(faceItem.id, requestedFace, assetsUrl, parameters, hairSelection);
      if (control.cancelled()) return;
      if (!pair) appearanceSlots.clear(); // this face remains on the existing path
      else {
        const hairKey = requestedHair ? sourcePreviewKey(eff.hair!, requestedHair) : null;
        const faceKey = sourcePreviewKey(faceItem.id, requestedFace, parameters);
        const changes: RigItem[] = [], removals: Slot[] = [];
        if (state.prev.hair !== hairKey) {
          if (requestedHair) changes.push({ id: eff.hair!, slot: 'hair', url: '',
            sourceParts: await loadSourceRigParts(requestedHair, assetsUrl, resolverGates),
            sourceSurfaceView: DEV.debugAlbedo ? 'baseColor' : DEV.surfaceView });
          else removals.push('hair');
        }
        // (w128) A pair that records attached statics (a face's skull) brings their rig parts; none otherwise.
        const faceAttachments = pair.attachedParts?.length
          ? await loadSourceSkinPairAttachments(requestedFace, pair, assetsUrl, resolverGates) : undefined;
        if (control.cancelled()) return;
        if (state.prev.face !== faceKey) changes.push({ id: faceItem.id, slot: 'face',
          url: faceItem.model?.gltfPath ? modelUrl(faceItem.model.gltfPath) : '',
          sourceSkinPair: pair, ...(faceAttachments?.length ? { sourceParts: faceAttachments } : {}),
          sourceSurfaceView: DEV.debugAlbedo ? 'baseColor' : DEV.surfaceView,
          bodySkin: faceItem.model?.bodySkin ? { colorMultiply: faceItem.model.bodySkin.colorMultiply,
            roughness: faceItem.model.bodySkin.roughness,
            texUrl: faceItem.model.bodySkin.texPath ? modelUrl(faceItem.model.bodySkin.texPath) : undefined } : undefined });
        if (control.cancelled()) return;
        control.prepared.current = await rig.prepareSourceItems(changes, removals, control.signal);
        if (control.cancelled()) return;
        if (!control.prepared.current) { delete state.prev.hair; delete state.prev.face; return; }
        commitAppearance = () => {
          const committed = control.prepared.current!.commit();
          if (committed) {
            state.prev.hair = hairKey; state.prev.face = faceKey;
            if (eyes) delete state.prev.eyes; // legacy decal was cleared by the face transaction
          }
          else { delete state.prev.hair; delete state.prev.face; }
          return committed;
        };
        appearanceOmitsHead = !!pair.headOmitted;
        // Restore a head before removing its covering. For the reverse transition, keep
        // the previous head until every requested covering has actually loaded.
        if (!appearanceOmitsHead) { if (!commitAppearance()) return; commitAppearance = undefined; }
      }
    } catch (e) {
      if (control.cancelled()) return;
      console.error(e); report.setError('Couldn’t load this face and hair preview.');
      delete state.prev.hair; delete state.prev.face;
      return; // Do not remove a covering while the head underneath failed to restore.
    }
  }
  for (const slot of SLOTS) {
    if (appearanceSlots.has(slot)) continue;
    const id = eff[slot];
    // Open-coat undersuit tint: when Upper Body was auto-substituted under an open coat,
    // recolour the base top to the coat's mean colour so its open back blends. The tint
    // lives on the OUTERWEAR, so fold it into the dedup key — otherwise switching between two
    // coats that share the same undersuit mesh would keep the previous coat's colour.
    const underTint =
      slot === "upperBody" && !build.upperBody && build.outerwear
        ? getItemById(build.outerwear)?.model?.underLayerTint
        : undefined;
    // Real under-mesh: composite the actual game lining/undershirt onto a torso garment. An
    // upperBody garment (vest/open jacket) always shows its own lining; an outerwear coat shows
    // its lining only when the user hasn't equipped their own Upper Body (then THAT shows).
    const realUnder =
      id && (slot === "upperBody" || (slot === "outerwear" && !build.upperBody))
        ? getItemById(id)?.model?.underLayerUrl
        : undefined;
    const sourceCandidate = id && supported.has(id) && (slot !== 'hair' || (DEV.sourceMeshes && DEV.sourceFitting))
      ? assembly?.items[id] : undefined;
    // A part socketed onto the head component only exists while a source head is worn: its
    // sockets are that head's own. Without one, keep the ordinary path instead of failing.
    const headSocketed = !!sourceCandidate?.parts.some(part => !part.hidden && part.definition.bAttachToHeadMesh);
    if (headSocketed && appearanceOmitsHead) {
      // No native replacement-head socket is established. Do not fall back to an unrelated
      // legacy/body socket, or leave an accessory attached to the head about to be removed.
      rig.unequip(slot);
      delete state.prev[slot];
      continue;
    }
    const headComponent = headSocketed ? rig.sourceHeadComponentKey() : undefined;
    // (15 Nov 2026) The index preserves head-component sockets for some heads only (Face 01's): on another worn
    // head the rig cannot place the part, so the item keeps its ordinary path as without a source head, instead
    // of failing the whole preview. An item with no ordinary model is left off with a notice (below).
    const headSockets = headSocketed ? sourceCandidate!.parts
      .filter(part => !part.hidden && part.definition.bAttachToHeadMesh)
      .map(part => part.definition.AttachmentSocket ?? "") : [];
    const headCarries = !headComponent || await sourceHeadComponentCarries(
      modelUrl("models/reconstructed-assemblies-v1"), rig.sourceHeadMesh(), headSockets).catch(() => false);
    if (control.cancelled()) return;
    const headUncarried = !!headComponent && !headCarries;
    // A part wrapped by the head component is shaped by the worn head's wrap cage, so it is re-staged per head.
    const headWrapped = !!sourceCandidate?.parts.some(part => !part.hidden && part.definition.WrapDeformation?.bIsWrapDeformed
      && part.definition.WrapDeformation?.bIsWrapDeformedByHeadComponent);
    const sourceItem = headSocketed && (!headComponent || headUncarried) ? undefined : sourceCandidate;
    const skinCandidate = id && slot === "face" && DEV.sourceMeshes && DEV.sourceFitting ? assembly?.items[id] : undefined;
    let skinParameters: SourceMaterialParameters[] = [];
    if (skinCandidate && assembly) {
      // Hair is staged before the face. Use the successfully equipped source
      // hairstyle, including the previous one when a replacement fails.
      const hair = rig.sourceAssemblyId('hair');
      try {
        const parameterOutfit = hair === eff.hair ? assembly : await loadSourceOutfit(
          [...Object.entries(eff).filter(([slot]) => slot !== 'hair').map(([, id]) => id), hair]
            .filter((id): id is string => !!id), modelUrl('models/reconstructed-assembly-v2'),
          bodyType ? [bodyType.tag] : [], { hairOverridePrecedence: hairPrecedence });
        if (control.cancelled()) return;
        skinParameters = parameterOutfit.materialParameters.filter(p => p.itemId === hair || cosmeticRule(p));
      } catch (e) {
        if (control.cancelled()) return;
        console.error(e); report.setError('Couldn’t load scalp fitting data.'); delete state.prev[slot]; continue;
      }
    }
    const sourceKey = sourceItem ?? skinCandidate;
    // An item socketed onto the head component belongs to the head that is worn: the face is
    // staged before this loop, so a head swap has to re-stage it rather than be deduplicated.
    const key = sourceKey ? sourcePreviewKey(id!, sourceKey, skinParameters)
      + (headSocketed ? `|head:${headComponent ?? "none"}` : "")
      + (headWrapped ? `|wrap:${rig.sourceHeadComponentKey() ?? "none"}` : "") : underTint
      ? `${id}|${underTint}`
      : realUnder
        ? `${id}|u:${realUnder}`
        : id;
    if (state.prev[slot] === key) continue;
    const item = id ? getItemById(id) : undefined;
    if (headUncarried && !item?.model?.gltfPath) {
      // No ordinary model to fall back on, and no preserved socket on this head: leave it off rather than place it
      // on another head's socket.
      rig.unequip(slot);
      report.setError("This item can’t be placed on the current face yet.");
      state.prev[slot] = key ?? null;
      continue;
    }
    // A face without a legacy model renders only through its legacy-free source skin pair (w91-head-skin); with no
    // pair in the index it stays the empty slot it was.
    let legacyFreePair: Awaited<ReturnType<typeof loadSourceSkinPair>>;
    if (item && !item.model?.gltfPath && !sourceItem && skinCandidate) {
      try {
        legacyFreePair = await loadSourceSkinPair(item.id, skinCandidate,
          modelUrl("models/reconstructed-assemblies-v1"), skinParameters, hairSelection);
      } catch (e) {
        if (control.cancelled()) return;
        console.error(e);
        report.setError("Couldn’t load the selected preview. Some items may still show the previous selection.");
        delete state.prev[slot];
        equipFailed = true;
        continue;
      }
      if (control.cancelled()) return;
    }
    if (item && (item.model?.gltfPath || sourceItem || legacyFreePair)) {
      try {
        // TODO(M4-dye): override material.regions[].tint from build dyes here.
        const base = item.model ? toRigMaterial(item.model) : undefined;
        if (base && DEV.reconstructed && RECOVERED_ITEMS.includes(item.id)) {
          base.reconstructed = {
            url: bust(modelUrl(`models/reconstructed/${item.id}.json`)),
            view: DEV.debugAlbedo ? "baseColor" : DEV.surfaceView,
          };
        }
        const material = underTint ? { ...(base ?? {}), tintRecolor: underTint } : base;
        // Fallback under-mesh (the generic recoloured top) if the real one fails to load — keeps
        // a shirt under the coat instead of a bare torso.
        const fallbackGlb =
          realUnder && item.model?.underLayer
            ? getItemById(item.model.underLayer)?.model?.gltfPath
            : undefined;
        const sourceParts = sourceItem ? await loadSourceRigParts(sourceItem,
          modelUrl("models/reconstructed-assemblies-v1"), resolverGates) : undefined;
        const sourceSkinPair = legacyFreePair ?? (skinCandidate ? await loadSourceSkinPair(item.id, skinCandidate,
          modelUrl("models/reconstructed-assemblies-v1"), skinParameters, hairSelection) : undefined);
        // (w128) A pair that records attached statics (a face's skull) brings their rig parts instead.
        const pairAttachments = sourceSkinPair?.attachedParts?.length && skinCandidate
          ? await loadSourceSkinPairAttachments(skinCandidate, sourceSkinPair,
              modelUrl("models/reconstructed-assemblies-v1"), resolverGates) : undefined;
        await rig.equip({
          id: item.id,
          slot,
          url: item.model?.gltfPath ? modelUrl(item.model.gltfPath) : sourceParts?.[0]?.url ?? "",
          sourceMeshUrl: DEV.reconstructed && DEV.sourceMeshes && RECOVERED_ITEMS.includes(item.id)
            ? modelUrl("models/reconstructed-meshes-v2/SK_Casual_LongCoat_M.glb") : undefined,
          sourceParts: pairAttachments?.length ? pairAttachments : sourceParts,
          sourceSkinPair,
          sourceSurfaceView: DEV.debugAlbedo ? "baseColor" : DEV.surfaceView,
          headWraps,
          material,
          materialBindings: item.model ? toRigMaterialBindings(item.model, underTint) : undefined,
          underLayerUrl: realUnder ? modelUrl(realUnder) : undefined,
          underLayerTint: realUnder ? item.model?.underLayerTint : undefined,
          underLayerFallbackUrl: fallbackGlb ? modelUrl(fallbackGlb) : undefined,
          bodySkin: item.model?.bodySkin
            ? {
                colorMultiply: item.model.bodySkin.colorMultiply,
                roughness: item.model.bodySkin.roughness,
                texUrl: item.model.bodySkin.texPath
                  ? modelUrl(item.model.bodySkin.texPath)
                  : undefined,
              }
            : undefined,
        }, control.signal);
        if (!control.cancelled() && sourceSkinPair && eyes) {
          // The fallback-hair path also binds eyes through the recovered face.
          // Do not apply this same item's legacy decal later in the slot loop.
          appearanceSlots.add('eyes');
          delete state.prev.eyes;
        }
      } catch (e) {
        if (control.cancelled()) return;
        console.error(e);
        report.setError("Couldn’t load the selected preview. Some items may still show the previous selection.");
        // Failed loads remain retryable on the next build change.
        delete state.prev[slot];
        equipFailed = true;
        continue;
      }
      if (control.cancelled()) return;
    } else if (item?.decal) {
      // 2D body cosmetic (tattoo/makeup/paint/eyes/nails) composited onto the body/head.
      // A source item may still occupy the slot (a native nail replaced by a legacy-only
      // polish). Remove it, and forget the committed key so a control.cancelled() pass reprocesses it.
      rig.unequip(slot);
      delete state.prev[slot];
      try {
        await rig.equipDecal(slot, toRigDecal(item.decal));
      } catch (e) {
        console.error(e);
      }
      if (control.cancelled()) return;
    } else {
      // empty slot
      const previousId = rig.equippedItemId(slot);
      const replacements = previousId ? SLOTS.filter(other => eff[other] &&
        equipmentConflicts(slot, previousId, other, eff[other]!)) : [];
      if (replacements.length) {
        // A full-body replacement may occupy another UI slot that loads later.
        // Keep its old companions until that exact replacement commits, so a
        // failed request cannot strip trousers/coat (or the old full outfit).
        pendingConflictRemovals.push({ slot, replacements });
        continue;
      }
      rig.unequip(slot);
      rig.unequipDecal(slot);
    }
    state.prev[slot] = key ?? null;
  }
  for (const { slot, replacements } of pendingConflictRemovals) {
    if (!replacements.every(other => rig.equippedItemId(other) === eff[other])) continue;
    rig.unequip(slot);
    rig.unequipDecal(slot);
    state.prev[slot] = null;
  }
  if (commitAppearance) {
    if (equipFailed) { delete state.prev.hair; delete state.prev.face; return; }
    if (!commitAppearance()) return;
  }
  // A source item's companion decal (a mask's face shadow on the worn head) follows the item actually equipped
  // from its own source assembly; a failed or legacy equip leaves none.
  for (const slot of SLOTS) {
    const id = rig.equippedItemId(slot);
    const companion = id && rig.sourceAssemblyId(slot) === id ? getItemById(id)?.companionDecal : undefined;
    const key = companion ? id : null;
    if ((state.companions[slot] ?? null) === key) continue;
    delete state.companions[slot];
    if (companion) {
      try { await rig.equipCompanionDecal(slot, toRigDecal(companion)); } catch (e) { console.error(e); }
      if (control.cancelled()) return;
    } else rig.unequipCompanionDecal(slot);
    state.companions[slot] = key;
  }
  if (assembly) {
    const activeCoat = rig.sourceAssemblyId("outerwear");
    // Failed replacements retain their previous source assemblies in any slot.
    // Resolve visibility from the items actually equipped after the batch.
    const actual = Object.fromEntries(SLOTS.map(slot => [slot, rig.equippedItemId(slot)
      ?? (getItemById(eff[slot] ?? "")?.decal ? eff[slot] : undefined)])) as typeof eff;
    if (SLOTS.some(slot => actual[slot] !== eff[slot])) {
      try {
        const ids = Object.values(actual).filter((id): id is string => !!id);
        assembly = await loadSourceOutfit(ids, modelUrl("models/reconstructed-assembly-v2"),
          bodyType ? [bodyType.tag] : [], { hairOverridePrecedence: hairPrecedence });
        sourceShirtConflict = !!activeCoat && assembly.slotConflicts.some(c =>
          c.slot === "EBodySlot::BodyUpper" && c.items.includes(activeCoat) && c.items.includes(actual.upperBody!));
        if (sourceShirtConflict) assembly = await loadSourceOutfit(ids.filter(id => id !== actual.upperBody),
          modelUrl("models/reconstructed-assembly-v2"), bodyType ? [bodyType.tag] : [],
          { hairOverridePrecedence: hairPrecedence });
        if (control.cancelled()) return;
      } catch (e) {
        if (control.cancelled()) return;
        console.error(e);
        report.setError("Couldn’t load outfit fitting data.");
      }
    }
    for (const slot of SLOTS) rig.setAssemblyVisibility(slot,
      !(slot === "upperBody" && sourceShirtConflict && !!activeCoat) &&
      !assembly.items[actual[slot] ?? ""]?.hidden);
    rig.setSourceFittingTags(DEV.sourceFitting ? assembly.fittingTags : []);
    report.onAssembly?.(assembly);
  }
  await rig.whenBodyHidesReady();
  if (control.cancelled()) return;
  let recovered = false;
  rig.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .some(m => m.userData.reconstructed === true)) recovered = true;
  });
  if (!control.cancelled()) report.setHasRecoveredPreview(recovered);
  if (DEV.reconstructed && DEV.isolate && recovered) {
    rig.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.userData.reconstructionOriginalVisibility = mesh.visible;
      mesh.visible = materials.some((m) => m.userData.reconstructed === true);
    });
  }
}
