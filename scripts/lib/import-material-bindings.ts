import { MaterialBindingSchema, type Material, type MaterialBinding } from "../../src/lib/item.ts";

export interface ImportMaterialSlot {
  materialName: string;
  sourceName?: string;
  family: MaterialBinding["family"];
  doubleSided?: boolean;
  complete?: boolean;
  resolution?: string;
}

export interface MaterialBindingIssue {
  materialName: string;
  reason: string;
}

// A GLB's embedded material name is the binding boundary. An item-wide baked set is
// safe only for one material or the exact source instance the old importer selected.
// In particular, sharing a mesh, skin folder, or shader family is not evidence that
// two materials share textures or parameters.
export function composeMaterialBindings(options: {
  materialNames: string[];
  slots: ImportMaterialSlot[];
  sourceBindings?: Record<string, MaterialBinding>;
  sidecar?: Record<string, MaterialBinding>;
  legacy?: Material;
  primarySourceName?: string;
}): { bindings: Record<string, MaterialBinding>; issues: MaterialBindingIssue[] } {
  const names = [...new Set(options.materialNames)];
  const issues: MaterialBindingIssue[] = [];
  const bindings: Record<string, MaterialBinding> = {};
  for (const name of Object.keys(options.sidecar ?? {})) {
    if (!names.includes(name)) throw new Error(`Material sidecar references '${name}', absent from the GLB`);
  }
  for (const materialName of names) {
    const slot = options.slots.find((candidate) => candidate.materialName === materialName);
    const override = options.sidecar?.[materialName];
    const unresolvedSkin = !!slot?.resolution?.match(/unresolved|ambiguous/);
    const source = unresolvedSkin ? undefined : options.sourceBindings?.[materialName];
    const family = unresolvedSkin ? "unknown" : source?.family ?? slot?.family ?? "unknown";
    const isPrimary = !!slot?.sourceName && slot.sourceName === options.primarySourceName;
    const canReuseLegacy = !unresolvedSkin && (names.length === 1 || isPrimary) &&
      family !== "glass" && family !== "led" && family !== "attachment";
    const legacy = canReuseLegacy ? { ...options.legacy } : undefined;
    // An explicit layered entry without a bake records a failed/unavailable
    // source bake. Retain its tint fallback, but never resurrect an old bake
    // left in the catalog by a previous import.
    if (legacy && family === "layered" && override?.family === family && !override.bakedSet)
      delete legacy.bakedSet;
    const binding: MaterialBinding = {
      ...legacy,
      ...source,
      family,
      ...(slot?.doubleSided !== undefined ? { doubleSided: slot.doubleSided } : {}),
      // Sidecars cache expensive layered bakes. Current source parameters and
      // sidedness are authoritative; an older bake cannot override them.
      ...(!unresolvedSkin && family === "layered" && override?.family === family && override?.bakedSet ? { bakedSet: override.bakedSet } : {}),
    };
    bindings[materialName] = MaterialBindingSchema.parse(binding);
    if (!slot && !override) issues.push({ materialName, reason: "source material slot not resolved" });
    else if (slot?.resolution?.includes("unresolved") || slot?.resolution?.includes("ambiguous"))
      issues.push({ materialName, reason: slot.resolution });
    if (slot?.complete === false)
      issues.push({ materialName, reason: "source material parent chain is incomplete" });
    if (override && override.family !== family)
      issues.push({ materialName, reason: "bake sidecar family does not match resolved source; ignored" });
    if (family === "layered" && !binding.bakedSet && !binding.regionColors)
      issues.push({ materialName, reason: "layered material has no matching bake or dye parameters; preserved embedded material" });
    if (family === "led" && !binding.ledScreen)
      issues.push({ materialName, reason: "LED material has no resolved animation texture; displayed as a dark screen" });
    if (family === "attachment" && !binding.bakedSet)
      issues.push({ materialName, reason: "attachment material has no resolved CR/NOM texture pair; preserved embedded material" });
  }
  return { bindings, issues };
}
