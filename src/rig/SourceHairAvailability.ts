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
