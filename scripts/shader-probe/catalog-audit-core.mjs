// Pure logic for the current-renderer catalog audit: manifest, cohort, fingerprints,
// resume decisions and result classification. No I/O, no browser — everything here is
// a function of the catalog plus digests the runner measures, so it can be tested.
//
// The states this module produces are deliberately separate and never collapse into one
// "pass". Structural eligibility says an item COULD be captured; capture status says a
// screenshot was taken; target evidence says the requested item was actually attached and
// changed the image; visual review and outfit acceptance are human verdicts this audit
// never writes. A screenshot is not an acceptance.
import { createHash } from 'node:crypto';

export const AUDIT_FORMAT_VERSION = 2;
export const REQUIRED_VIEWS = ['front', 'back', 'oblique'];
export const completeViews = (views, names = REQUIRED_VIEWS) =>
  Array.isArray(views) && views.length === names.length
  && names.every(name => views.filter(view => view.view === name).length === 1);

export const stableHash = (value) =>
  createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');

/** Key-sorted JSON so a fingerprint never changes because a field moved. */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

// ---- structural classification --------------------------------------------------------

/** Every catalog-declared asset this item pulls in, as repo-relative public/ paths. */
export function itemAssets(item) {
  const out = [];
  const model = item.model;
  if (model) {
    if (model.gltfPath) out.push(model.gltfPath);
    if (model.underLayerUrl) out.push(model.underLayerUrl);
    if (model.bodySkin?.texPath) out.push(model.bodySkin.texPath);
    for (const binding of [model.material, ...Object.values(model.materialBindings ?? {})]) {
      if (!binding) continue;
      if (binding.bakedSet) out.push(binding.bakedSet.albedo, binding.bakedSet.normal, binding.bakedSet.orm);
      if (binding.regionMapPath) out.push(binding.regionMapPath);
      if (binding.emissiveMap) out.push(binding.emissiveMap);
      for (const decal of binding.garmentDecals ?? []) out.push(decal.path);
      if (binding.glass?.normal) out.push(binding.glass.normal);
      if (binding.ledScreen) {
        out.push(binding.ledScreen.animation);
        if (binding.ledScreen.colorRamp) out.push(binding.ledScreen.colorRamp);
        if (binding.ledScreen.normal) out.push(binding.ledScreen.normal);
      }
    }
  }
  for (const layer of item.decal?.layers ?? []) {
    if (layer.colorPath) out.push(layer.colorPath);
    if (layer.maskPath) out.push(layer.maskPath);
  }
  return [...new Set(out.filter(Boolean))].sort();
}

/** Assets whose absence makes the item unrenderable rather than merely degraded. */
export function requiredAssets(item) {
  if (item.model?.gltfPath) return [item.model.gltfPath];
  return (item.decal?.layers ?? []).map(l => l.colorPath).filter(Boolean);
}

const BINDING_KIND = (binding) => binding.bakedSet ? 'baked'
  : binding.regionMapPath ? 'regionmap'
  : binding.regionColors ? 'regioncolor'
  : binding.glass ? 'glass'
  : binding.ledScreen ? 'led'
  : 'bare';

/** How this item's surface is actually produced today — the axis a shared fix travels along. */
export function materialKinds(item) {
  if (item.decal) return ['decal'];
  const bindings = Object.values(item.model?.materialBindings ?? {});
  if (bindings.length) return [...new Set(bindings.map(BINDING_KIND))].sort();
  if (item.model?.material) return [BINDING_KIND(item.model.material)];
  return item.model?.gltfPath ? ['bare'] : [];
}

export function bindingFamilies(item) {
  return [...new Set(Object.values(item.model?.materialBindings ?? {})
    .map(b => b.family ?? 'unknown'))].sort();
}

/** Mesh (or decal target) family: the unit a shared fix would repair at once. */
export function familyKey(item) {
  if (item.model?.gltfPath) return `mesh:${item.model.gltfPath}`;
  if (item.decal) return `decal:${item.slot}:${[...new Set(item.decal.layers.map(l => l.target))].sort().join('+')}`;
  return `none:${item.slot}`;
}

/** Material/colour variant inside a family — what distinguishes siblings on one mesh. */
export function variantKey(item) {
  const bindings = Object.values(item.model?.materialBindings ?? {});
  const baked = bindings.map(b => b.bakedSet?.albedo).filter(Boolean).sort();
  if (baked.length) return `baked:${baked.map(p => p.split('/').pop()).join(',')}`;
  const colors = bindings.flatMap(b => b.regionColors ?? []);
  if (colors.length) return `colors:${colors.join(',')}`;
  if (item.decal) return `decal:${item.decal.layers.map(l => (l.colorPath ?? '').split('/').pop()).join(',')}`;
  return `tags:${(item.tags ?? []).join(',')}`;
}

export const DECAL_TARGETS = (item) =>
  [...new Set((item.decal?.layers ?? []).map(l => l.target))].sort();

/**
 * One manifest row per catalog choice — including decal, source-only and unrenderable rows.
 * `assetExists(path) -> boolean` is injected so this stays pure and testable.
 */
export function buildManifest({ items, sourceItems = [], sourceExceptions = [], assetExists = () => true }) {
  const enabled = new Set(sourceItems);
  const exceptions = new Map(sourceExceptions.map(e => [e.id, e.reason]));
  const rows = items.map((item) => {
    const assets = itemAssets(item);
    const missing = assets.filter(p => !assetExists(p));
    const missingRequired = requiredAssets(item).filter(p => !assetExists(p));
    const declaredPath = enabled.has(item.id) ? 'source-assembly'
      : item.decal ? 'decal'
      : item.model?.gltfPath ? 'legacy-mesh'
      : 'none';
    const reasons = [];
    if (declaredPath === 'none') reasons.push('catalog row has neither a model nor a decal');
    if (declaredPath !== 'source-assembly' && missingRequired.length) reasons.push(`required asset missing locally: ${missingRequired[0]}`);
    return {
      id: item.id, slot: item.slot, name: item.name, set: item.set ?? null, season: item.season ?? null,
      sponsor: item.sponsor ?? null, tags: item.tags ?? [],
      declaredPath, sourceEnabled: enabled.has(item.id),
      sourceException: exceptions.get(item.id) ?? null,
      materialKinds: materialKinds(item), bindingFamilies: bindingFamilies(item),
      familyKey: familyKey(item), variantKey: variantKey(item),
      decalTargets: DECAL_TARGETS(item),
      decalTintOnly: !!item.decal?.layers.length && item.decal.layers.every(l => l.tint && !l.colorPath && !l.maskPath),
      gltfPath: item.model?.gltfPath ?? null,
      thumbnail: item.imageUrl ?? null,
      assets, missingAssets: missing,
      eligible: reasons.length === 0,
      ineligibleReasons: reasons,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const familySizes = new Map();
  for (const row of rows) familySizes.set(row.familyKey, (familySizes.get(row.familyKey) ?? 0) + 1);
  for (const row of rows) row.familySize = familySizes.get(row.familyKey);
  return rows;
}

export function manifestSummary(rows) {
  const tally = (fn) => {
    const out = {};
    for (const row of rows) for (const key of [].concat(fn(row))) out[key] = (out[key] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  return {
    choices: rows.length,
    eligible: rows.filter(r => r.eligible).length,
    ineligible: rows.filter(r => !r.eligible).length,
    bySlot: tally(r => r.slot),
    byDeclaredPath: tally(r => r.declaredPath),
    byMaterialKind: tally(r => r.materialKinds.length ? r.materialKinds.join('+') : 'none'),
    byBindingFamily: tally(r => r.bindingFamilies.length ? r.bindingFamilies : 'none'),
    families: new Set(rows.map(r => r.familyKey)).size,
    ineligibleReasons: tally(r => r.eligible ? [] : r.ineligibleReasons.map(x => x.replace(/: .*/, ''))),
  };
}

// ---- bases, framing and interaction requirements ---------------------------------------

// Body decals need bare skin to be judged at all, so they get a garment-free base. Every
// other slot is reviewed on the reference outfit, which is itself entirely source-enabled.
const SKIN_BASE_SLOTS = new Set(['tattoo', 'bodyPaint', 'nailPolish']);

export const baseKeyFor = (row) => SKIN_BASE_SLOTS.has(row.slot) ? 'skin' : 'reference';

export function baseFor(row, bases) {
  const key = baseKeyFor(row);
  const slots = { ...bases[key] };
  delete slots[row.slot]; // the control is this base with the audited slot empty
  return { key, slots };
}

const FRAMING = {
  hair: 'head', face: 'head', facialHair: 'head', facewear: 'head', eyewear: 'head',
  earrings: 'head', headwear: 'head', blush: 'head', eyes: 'head',
  upperBody: 'upperBody', outerwear: 'outerwear', upperBack: 'outerwear', wrist: 'hands',
  lowerBody: 'lowerBody', lowerBack: 'lowerBody', feet: 'feet',
  hands: 'hands', nailPolish: 'hands', tattoo: 'full', bodyPaint: 'full',
};
export const framingFor = (row) => FRAMING[row.slot] ?? 'full';

// Interactions this audit does NOT test. They are recorded per item so a captured item is
// never mistaken for one that behaves correctly beside its neighbours.
const INTERACTIONS = {
  upperBody: ['coat-over-shirt', 'sleeves-vs-gloves'],
  outerwear: ['coat-over-shirt'],
  hands: ['sleeves-vs-gloves'],
  wrist: ['sleeves-vs-gloves'],
  lowerBody: ['pants-vs-boots'],
  feet: ['pants-vs-boots'],
  headwear: ['headwear-vs-hair'],
  hair: ['headwear-vs-hair'],
  facewear: ['headwear-vs-hair'],
};
export const interactionRequirements = (slot) => (INTERACTIONS[slot] ?? []).map(name => ({
  name, status: 'pending', note: 'not exercised by this audit run',
}));

// ---- cohort selection ------------------------------------------------------------------

/**
 * A deterministic, deliberately mixed first cohort. Selection is seeded by a hash of the
 * id, so the same catalog and seed always yield the same list, and every pick carries the
 * reason it was picked. Strata run in priority order and later strata only add items.
 */
export function selectCohort(rows, { size = 64, seed = 'current-catalog-audit-01', include = [] } = {}) {
  const eligible = rows.filter(r => r.eligible);
  const rank = new Map(eligible.map(r => [r.id, stableHash(`${seed}|${r.id}`)]));
  const shuffled = (list) => [...list].sort((a, b) =>
    (rank.get(a.id) < rank.get(b.id) ? -1 : rank.get(a.id) > rank.get(b.id) ? 1 : 0) || a.id.localeCompare(b.id));
  const byId = new Map(eligible.map(r => [r.id, r]));
  const picked = new Map();
  const add = (row, reason) => {
    if (!row) return false;
    const existing = picked.get(row.id);
    if (existing) { if (!existing.includes(reason)) existing.push(reason); return false; }
    picked.set(row.id, [reason]);
    return true;
  };
  const take = (list, count, reason) => {
    let taken = 0;
    for (const row of list) {
      if (taken >= count) break;
      if (picked.has(row.id)) continue;
      add(row, reason);
      taken++;
    }
    return taken;
  };

  for (const id of include) add(byId.get(id), 'requested explicitly');

  // 1. Controls: items already reconstructed and reviewed, spread over the slots they cover.
  const source = shuffled(eligible.filter(r => r.sourceEnabled));
  for (const slot of [...new Set(source.map(r => r.slot))].sort()) {
    take(source.filter(r => r.slot === slot), 2, `source control (${slot})`);
  }

  // 1b. Source-only choices: reconstructed rows the catalog has no mesh for at all. They can
  //     only render through the source path, so they are their own structural case.
  take(shuffled(eligible.filter(r => r.declaredPath === 'source-assembly' && !r.gltfPath)), 2,
    'source-only choice (no catalog mesh)');

  // 2. Every slot in the catalog is represented by a choice that is NOT source-reconstructed,
  //    so the cohort says something about the renderer the other 2,788 choices still use.
  for (const slot of [...new Set(eligible.map(r => r.slot))].sort()) {
    take(shuffled(eligible.filter(r => r.slot === slot && !r.sourceEnabled)), 1, `slot coverage (${slot})`);
  }

  // 3. Each surface-production path gets enough samples to say something about the path.
  for (const kind of ['baked', 'regionmap', 'regioncolor', 'bare', 'glass', 'led', 'decal']) {
    take(shuffled(eligible.filter(r => r.materialKinds.includes(kind) && !r.sourceEnabled)), 3,
      `material kind ${kind}`);
  }

  // 4. Decal targets differ in plumbing (head/body/eyes/nails composite onto different maps).
  for (const target of ['head', 'body', 'eyes', 'nails']) {
    take(shuffled(eligible.filter(r => r.decalTargets.includes(target))), 2, `decal target ${target}`);
  }

  // 5. Variant sets: siblings on one mesh that differ only in material/colour. Three families
  //    from three different slots, so a shared-fix claim can be checked within a family.
  const families = new Map();
  for (const row of eligible.filter(r => !r.sourceEnabled && r.gltfPath)) {
    families.set(row.familyKey, [...(families.get(row.familyKey) ?? []), row]);
  }
  const candidates = shuffled([...families.values()].filter(f => f.length >= 4).map(f => shuffled(f)[0]));
  const usedSlots = new Set();
  let sets = 0;
  for (const head of candidates) {
    if (sets >= 3 || usedSlots.has(head.slot)) continue;
    usedSlots.add(head.slot);
    sets++;
    take(shuffled(families.get(head.familyKey)), 3, `variant set on ${head.familyKey}`);
  }

  // 6. Fill: round-robin across slots, largest slots first, so the remainder stays spread.
  const slotsBySize = [...new Set(eligible.map(r => r.slot))]
    .map(slot => [slot, eligible.filter(r => r.slot === slot).length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([slot]) => slot);
  const queues = new Map(slotsBySize.map(slot => [slot, shuffled(eligible.filter(r => r.slot === slot))]));
  while (picked.size < size) {
    let progressed = false;
    for (const slot of slotsBySize) {
      if (picked.size >= size) break;
      const queue = queues.get(slot);
      while (queue.length) {
        const row = queue.shift();
        if (picked.has(row.id)) continue;
        add(row, `fill (${slot})`);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }

  const chosen = [...picked.entries()].slice(0, size)
    .map(([id, reasons]) => ({ ...byId.get(id), reasons }));
  return { seed, size, selected: chosen, selectedIds: chosen.map(r => r.id) };
}

/** Capture order: keep the base and the camera still for as long as possible. */
export function captureOrder(rows) {
  return [...rows].sort((a, b) =>
    baseKeyFor(a).localeCompare(baseKeyFor(b))
    || framingFor(a).localeCompare(framingFor(b))
    || a.slot.localeCompare(b.slot)
    || a.familyKey.localeCompare(b.familyKey)
    || a.id.localeCompare(b.id));
}

// ---- fingerprints and resume -----------------------------------------------------------

/**
 * The snapshot this evidence belongs to. Anything that can change what the renderer puts on
 * screen belongs in here: the catalog, the active index, renderer source, this tool, the
 * run configuration and the item's own assets. Stale evidence is never silently reused.
 */
export function globalFingerprint({ config, digests }) {
  return stableHash({ formatVersion: AUDIT_FORMAT_VERSION, config, digests });
}

export const itemFingerprint = (global, assetDigest, context) =>
  stableHash({ global, assetDigest, context });

/**
 * A completed record may be resumed only when its fingerprint still matches AND every image
 * it points at is still on disk. Anything else is re-captured.
 */
export function isResumable(record, fingerprint, fileExists, fileHash) {
  if (!record || record.captureStatus !== 'captured') return { resume: false, reason: 'not captured' };
  if (record.fingerprint !== fingerprint) return { resume: false, reason: 'snapshot changed' };
  if (!completeViews(record.views) || !completeViews(record.controlViews))
    return { resume: false, reason: 'incomplete view set' };
  const files = [...(record.views ?? []).map(v => v.file), ...(record.controlViews ?? []).map(v => v.file)];
  const missing = files.filter(f => !fileExists(f));
  if (missing.length) return { resume: false, reason: `missing capture ${missing[0]}` };
  if (fileHash && files.some(file => !record.imageDigests?.[file] || fileHash(file) !== record.imageDigests[file]))
    return { resume: false, reason: 'capture content changed' };
  return { resume: true, reason: 'unchanged since capture' };
}

// ---- result classification -------------------------------------------------------------

/**
 * Turn observations into explicitly separate states. `targetEvidence` answers only one
 * question: did the requested choice actually attach and change what is on screen? It is
 * never an appearance verdict, and a clean render is not one either.
 */
export function classifyEvidence(row, evidence) {
  const {
    attached = false, sourceAssembly = false, sourceSkinPair = false, groupVisible = false,
    visibleMeshes = 0, decalPatchedMaterials = 0, decalTexturesRequested = [], decalTexturesFetched = [],
    decalAppliedTargets = [],
    changedFraction = null, changeThreshold = 0, views = [],
  } = evidence ?? {};
  const notes = [];
  const observedPath = sourceAssembly ? 'source-assembly'
    : sourceSkinPair ? 'source-skin-pair'
    : attached ? 'legacy-mesh'
    : decalPatchedMaterials > 0 || decalTexturesFetched.length ? 'decal'
    : 'none';
  if (row.declaredPath !== observedPath && !(row.declaredPath === 'source-assembly' && observedPath === 'source-skin-pair'))
    notes.push(`catalog declares ${row.declaredPath}; the rig used ${observedPath}`);

  const changed = changedFraction !== null && changedFraction > changeThreshold;
  let targetEvidence;
  if (row.declaredPath === 'decal') {
    const fetchedAll = decalTexturesRequested.every(t => decalTexturesFetched.includes(t));
    const targetsApplied = row.decalTargets?.length > 0 && row.decalTargets.every(t => decalAppliedTargets.includes(t));
    if (row.decalTintOnly && !targetsApplied) targetEvidence = 'not-applied';
    else if (!row.decalTintOnly && !decalTexturesFetched.length) targetEvidence = 'not-applied';
    else if (!decalPatchedMaterials) targetEvidence = 'texture-fetched-not-composited';
    else if (!targetsApplied || !fetchedAll) targetEvidence = 'partially-applied';
    else if (changedFraction === null) targetEvidence = 'applied-no-pixel-evidence';
    else if (!changed) targetEvidence = 'applied-no-pixel-change';
    else targetEvidence = 'confirmed-visible';
    if (!fetchedAll && decalTexturesFetched.length) notes.push('not every decal layer texture was fetched');
  } else if (!attached) {
    targetEvidence = 'not-attached';
  } else if (!groupVisible || visibleMeshes === 0) {
    targetEvidence = 'attached-not-visible';
  } else if (changedFraction === null) {
    targetEvidence = 'attached-no-pixel-evidence';
  } else if (!changed) {
    targetEvidence = 'attached-no-pixel-change';
  } else {
    targetEvidence = 'confirmed-visible';
  }
  return {
    observedPath, targetEvidence, notes,
    // Deliberately separate states. Only a human sets the last two.
    captureStatus: completeViews(views) ? 'captured' : 'failed',
    visualReview: 'pending',
    outfitAcceptance: 'pending',
  };
}

/** Family counts are a prospective shared-fix gain, never evidence that siblings pass. */
export function prospectiveFamilyGain(row, rows) {
  const siblings = rows.filter(r => r.familyKey === row.familyKey && r.id !== row.id);
  return {
    familyKey: row.familyKey,
    catalogChoicesInFamily: siblings.length + 1,
    untestedSiblings: siblings.length,
    meaning: 'prospective shared-fix gain only; siblings are untested and unaccepted',
  };
}

export function resultsSummary(records) {
  const tally = (key) => {
    const out = {};
    for (const record of records) out[record[key]] = (out[record[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  return {
    items: records.length,
    byCaptureStatus: tally('captureStatus'),
    byTargetEvidence: tally('targetEvidence'),
    byObservedPath: tally('observedPath'),
    cleanRenders: records.filter(r => r.renderClean).length,
    withFailedRequests: records.filter(r => (r.failedRequests ?? []).length).length,
    withErrors: records.filter(r => (r.errors ?? []).length).length,
    visuallyAccepted: 0,
    meaning: 'Captures and attachment evidence only. No item here is visually accepted or '
      + 'accepted in an outfit; both remain a separate human review.',
  };
}

/** Keep a measured target inside every recorded angle, including off-axis accessories. */
export function fitAuditCamera(bounds, {
  framing = 'full', width = 1600, height = 1100, fov = 28,
  rotations = [0, Math.PI, 0.7], margin = 1.5,
} = {}) {
  const { min, max } = bounds;
  if (![...min, ...max].every(Number.isFinite) || min.some((n, i) => n > max[i])) {
    throw new Error('Invalid target bounds');
  }
  const floors = { head: 0.45, hands: 0.5, upperBody: 0.6, outerwear: 0.7,
    lowerBody: 0.6, feet: 0.35, full: 1.9 };
  const centre = Math.round(((min[1] + max[1]) / 2) / 0.05) * 0.05;
  const tanY = Math.tan(fov * Math.PI / 360), tanX = tanY * width / height;
  let distance = Math.max((floors[framing] ?? floors.full) / (2 * tanY), 0.55);
  // A wrist can be only 5 cm wide but sit 60 cm away from the body axis.
  // Fit projected corners about that axis; width alone would crop it out.
  for (const angle of rotations) for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const rx = x * Math.cos(angle) + z * Math.sin(angle);
      const rz = -x * Math.sin(angle) + z * Math.cos(angle);
      distance = Math.max(distance, rz + margin * Math.abs(rx) / tanX,
        rz + margin * Math.abs(y - centre) / tanY);
    }
  // Round away from the target so quantisation cannot clip an edge again.
  const far = (Math.ceil(distance / 0.05) * 0.05).toFixed(2), cy = centre.toFixed(2);
  return `0,${cy},${far},0,${cy},0`;
}
