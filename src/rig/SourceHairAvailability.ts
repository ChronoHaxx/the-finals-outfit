// Whether one selected source hair resolves unambiguously in this exact outfit. The strict resolver
// already records every ambiguity it refuses (conflicting overrides, partially matched multi-tag
// conditions, material parameter conditions); this only asks whether any of it belongs to that hair.
// Ambiguity on other items is theirs to handle. An absent item is never a pass.
import type { SourceOutfit } from "./SourceAssembly";

export function sourceHairUnresolved(outfit: SourceOutfit, hairId: string): string[] {
  const item = outfit.items[hairId];
  if (!item) return [`No resolved source item for ${hairId}`];
  return [
    ...item.parts.flatMap(part => part.unresolved.map(reason => `part ${part.sourceIndex}: ${reason}`)),
    ...outfit.materialParameters.filter(p => p.itemId === hairId)
      .flatMap(p => p.unresolved.map(reason => `material parameters ${p.source}: ${reason}`)),
  ];
}

/** Meshes the hair's parts resolve to in this outfit that the preserved index does not hold. The coverage audit
 *  checks each item standalone, so an outfit-dependent replacement (a hat's "covers upper hair" swaps a static
 *  hair for its _UnderHat mesh) is only known here; without this it fails later as a generic load error. */
export function sourceHairMissingMeshes(outfit: SourceOutfit, hairId: string, meshes: Record<string, unknown>): string[] {
  const item = outfit.items[hairId];
  if (!item) return [];
  return item.parts.filter(part => !part.hidden).flatMap(part => [part.staticMesh, part.skeletalMesh])
    .filter(mesh => mesh && !Object.hasOwn(meshes, mesh)).map(mesh => `missing preserved mesh ${mesh}`);
}
