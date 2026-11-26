// Merge-modifier drift (S12 batch C wave C1, 26 Nov 2026; approved by the coordinator as "option A").
//
// The 17 Nov 2026 build appended one TagOverride to many items' parts: when the tag
// Customization.Feature.MeshMergeModifiers matches, swap the mesh for a suffix-less one (SK_Streetwear_Hoodie for
// SK_Streetwear_Hoodie_M). The resolver needs every MatchingTags entry in its context and never has a
// Customization.Feature.* tag, so the override is inactive and the item resolves as before. The cohort drift gate
// (s12-definition-drift.py) still reports the item as `differs` in VisualParts.
//
// A drifted item is admitted as neutral only when BOTH hold:
//  (1) mergeModifierOnly(stored, fresh): the 17 Nov VisualParts equal the stored ones plus appended TagOverrides whose
//      MatchingTags are exactly ["Customization.Feature.MeshMergeModifiers"] and which only swap the mesh (no
//      material, effect, logic-module, offset or wrap-deformer override); no existing override and no other field of
//      any part changed;
//  (2) resolvedEqual(resolve, stored, fresh): the resolver resolves the stored and the 17 Nov definitions identically
//      on Medium. The caller passes its own resolver and records the result per item.
// Whether the shipping game grants that tag is a separate question (the suffix-less meshes exist in the build); this
// rule only says our resolver draws the same outfit from either definition.

export const MERGE_MODIFIER_TAG = 'Customization.Feature.MeshMergeModifiers';

// Key order never matters in the source property trees (the drift gate compares with sorted keys too).
const canonical = (value) => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a, b) => canonical(a) === canonical(b);

// Narrower than "no material override": the appended rule may only swap the mesh. Effects, logic modules, placement
// offsets and wrap-deformer swaps are refused too, so nothing but the inactive mesh swap can ride in on this rule.
const empty = (asset) => !asset?.AssetPathName && !asset?.SubPathString;
const isMergeModifierOverride = (o) =>
  Array.isArray(o?.MatchingTags) && o.MatchingTags.length === 1 && o.MatchingTags[0] === MERGE_MODIFIER_TAG &&
  o.bOverrideMaterials === false && Array.isArray(o.MaterialOverrides) && o.MaterialOverrides.length === 0 &&
  o.bOverrideEffect === false && o.bAddLogicModules === false && Array.isArray(o.LogicModules) &&
  o.LogicModules.length === 0 && o.bOffsetTransform === false && empty(o.OptionalWrapDeformerMeshOverride);

/**
 * Condition (1). `stored` and `fresh` are VisualParts arrays. Returns {ok: true, appended} or {ok: false, reason}.
 * `appended` counts the merge-modifier overrides the fresh parts add (at least one, or this is not that drift).
 */
export function mergeModifierOnly(stored, fresh) {
  if (!Array.isArray(stored) || !Array.isArray(fresh)) return { ok: false, reason: 'VisualParts is not a list' };
  if (stored.length !== fresh.length) return { ok: false, reason: `part count ${stored.length} -> ${fresh.length}` };
  let appended = 0;
  for (let n = 0; n < stored.length; n++) {
    const a = stored[n] ?? {}, b = fresh[n] ?? {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (key === 'TagOverrides') continue;
      if (!(key in a) || !(key in b) || !same(a[key], b[key])) return { ok: false, reason: `part ${n} field ${key} changed` };
    }
    const before = a.TagOverrides ?? [], after = b.TagOverrides ?? [];
    if (!Array.isArray(before) || !Array.isArray(after)) return { ok: false, reason: `part ${n} TagOverrides is not a list` };
    if (after.length < before.length) return { ok: false, reason: `part ${n} lost a TagOverride` };
    for (let k = 0; k < before.length; k++)
      if (!same(before[k], after[k])) return { ok: false, reason: `part ${n} TagOverrides[${k}] changed` };
    for (let k = before.length; k < after.length; k++) {
      if (!isMergeModifierOverride(after[k]))
        return { ok: false, reason: `part ${n} TagOverrides[${k}] is not a material-free ${MERGE_MODIFIER_TAG}-only override` };
      appended++;
    }
  }
  return appended ? { ok: true, appended } : { ok: false, reason: 'no merge-modifier override appended' };
}

/**
 * Condition (2). `resolve(definition)` is the caller's resolver call (for example
 * d => resolveSourceOutfit([d], ['Customization.Archetype.Medium'])). `storedDefinition` is the stored item definition;
 * `freshProperties` the 17 Nov DA properties. The fresh definition is the stored one with its properties replaced.
 */
export function resolvedEqual(resolve, storedDefinition, freshProperties) {
  const fresh = { ...storedDefinition, properties: freshProperties };
  return resolution(resolve(storedDefinition)) === resolution(resolve(fresh));
}

// The resolver echoes each raw VisualPart back as `definition`. That echo is the drift itself, so it is left out;
// everything the resolver decided (meshes, effect, hidden, applied rules, unresolved notes, materials, tags) is kept.
const resolution = (outfit) => JSON.stringify(outfit, (key, v) => key === 'definition' ? undefined
  : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

/**
 * Both conditions for one drift-gate row. `drift` is the gate's {status, keys}; only `differs` in exactly VisualParts
 * qualifies. Returns {ok, appended?, resolvedEqual?, reason?} for the run report.
 */
export function admitMergeModifierDrift(drift, storedDefinition, freshProperties, resolve) {
  if (drift?.status !== 'differs' || canonical(drift.keys ?? []) !== canonical(['VisualParts']))
    return { ok: false, reason: `drift is not VisualParts only: ${canonical(drift ?? null)}` };
  const structural = mergeModifierOnly(storedDefinition?.properties?.VisualParts, freshProperties?.VisualParts);
  if (!structural.ok) return structural;
  const equal = resolvedEqual(resolve, storedDefinition, freshProperties);
  return equal ? { ok: true, appended: structural.appended, resolvedEqual: true }
    : { ok: false, appended: structural.appended, resolvedEqual: false, reason: 'the resolver resolves the two definitions differently' };
}
