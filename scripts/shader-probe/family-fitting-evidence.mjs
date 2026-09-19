// What the rendered page actually carries after an outfit step, and the assertions
// over it. Pure data in, findings out: no Three, no fs, no browser, no dependencies.
// The rig decides the fitting from the assembly it ended up with, so the evidence
// covers body and support meshes too, not only the requested candidates.

export const BODY_UPPER = 'EBodySlot::BodyUpper';
// PushJacket is admitted for its one exact bandolier_squeeze tag only; the leaf stays capture 1.
export const FITTING_TAG = /^Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch|PushJacket(?=\.bandolier_squeeze$))\.([A-Za-z0-9_]+)$/;

/** The morph leaf names a tag set names, exactly as SourceFitting.fittingMorphNames decodes them. */
export function fittingMorphNames(tags) {
  const names = new Set();
  for (const tag of tags ?? []) { const match = FITTING_TAG.exec(tag); if (match) names.add(match[1]); }
  return names;
}

/** Every mesh under the rendered rig root, with its owner, ancestor visibility and morph state.
 *  page.evaluate serializes this function into the browser, so it must stay self-contained:
 *  no module references, no closures. Tests pass {root, assembly} instead of reading window. */
export function collectFittingSnapshot(input) {
  const page = typeof window === 'undefined' ? {} : window;
  const root = input && input.root !== undefined ? input.root : page.__rigRoot;
  const assembly = input && input.assembly !== undefined ? input.assembly : page.__sourceAssembly;
  const meshes = [];
  const walk = (object, owner, visible) => {
    const data = object.userData || {};
    const itemId = typeof data.rigItemId === 'string' && data.rigItemId ? data.rigItemId : owner;
    const shown = visible && object.visible !== false;
    if (object.isMesh) {
      const dictionary = object.morphTargetDictionary, influences = object.morphTargetInfluences;
      const matched = data.sourceFittingMorphs;
      // Keep the authored weights as numbers; JSON turns a non-finite one into null,
      // so record where those are instead of letting them disappear from the report.
      const weights = influences ? Array.prototype.slice.call(influences) : null;
      // CharacterRig tags each source mesh with its part index and mesh, and each material with its source.
      const slots = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      meshes.push({
        sourcePartIndex: Number.isInteger(data.sourcePartIndex) ? data.sourcePartIndex : null,
        sourceMesh: typeof data.sourceMesh === 'string' ? data.sourceMesh : null,
        sourceMaterials: slots.map(material => {
          const source = material && material.userData ? material.userData.sourceMaterial : undefined;
          return typeof source === 'string' ? source : null;
        }),
        uuid: typeof object.uuid === 'string' ? object.uuid : null,
        name: typeof object.name === 'string' ? object.name : '',
        itemId: itemId || null,
        identity: itemId || 'body-or-unowned',
        visible: !!shown, selfVisible: object.visible !== false,
        dictionary: dictionary ? Object.assign({}, dictionary) : null,
        weights,
        nonFiniteWeights: weights ? weights.map((w, i) => Number.isFinite(w) ? -1 : i).filter(i => i >= 0) : [],
        matched: Array.isArray(matched) ? matched.slice() : matched === undefined ? null : matched,
      });
    }
    for (const child of object.children || []) walk(child, itemId, shown);
  };
  if (root) walk(root, null, root.visible !== false);
  const items = assembly && assembly.items ? assembly.items : null;
  return {
    hasRoot: !!root, meshes,
    assembly: items ? {
      itemIds: Object.keys(items),
      hiddenItemIds: Object.keys(items).filter(id => items[id] && items[id].hidden),
      unresolvedItems: (assembly.unresolvedItems || []).slice(),
      fittingTags: (assembly.fittingTags || []).slice(),
      slotConflicts: (assembly.slotConflicts || []).map(c => ({ slot: c.slot, items: (c.items || []).slice() })),
    } : null,
  };
}

export const meshLabel = mesh => mesh.identity + (mesh.name ? `/${mesh.name}` : '') + (mesh.uuid ? `#${mesh.uuid}` : '');

/** A fitting rule is implemented on a mesh only when the morph exists at a drivable
 *  index — the same decision SourceFitting.apply makes before it writes a weight. */
export function implementedMorphs(mesh, names) {
  if (!mesh.dictionary || !mesh.weights) return [];
  return [...names].filter(name => {
    const index = mesh.dictionary[name];
    return Number.isInteger(index) && index >= 0 && index < mesh.weights.length;
  }).sort();
}

const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Assertions over one rendered step. `requested` is the resolution of the requested slots and
 *  `effectiveFittingTags` the resolution of the exact source definitions the page ended up with. */
export function checkFittingEvidence({ label, snapshot, requested, effectiveFittingTags }) {
  const errors = [], notes = [];
  const fail = message => errors.push(`${label}: ${message}`);
  const requestedIds = requested?.itemIds ?? [];
  if (!snapshot?.hasRoot) fail('missing rendered rig root');
  if (!snapshot?.assembly) {
    fail('missing final source assembly');
    return { errors, notes, meshes: [], suppressed: [], added: [] };
  }
  const assembly = snapshot.assembly;
  if (requestedIds.length && !assembly.itemIds.length) fail('final source assembly has no items');
  // The page's own fitting tags must be what these exact definitions resolve to. A suppressed
  // shirt is absent from the assembly, so its tags cannot reappear here as active.
  if (!same(assembly.fittingTags, effectiveFittingTags ?? []))
    fail(`final fitting tags ${JSON.stringify(assembly.fittingTags)} disagree with the resolver ${JSON.stringify(effectiveFittingTags ?? [])}`);
  // A requested item leaves the assembly only when it is unsupported, or when CharacterViewer
  // drops it for a BodyUpper conflict. Anything else that vanished is a failure, not evidence.
  const conflicted = new Set((requested?.slotConflicts ?? [])
    .filter(conflict => conflict.slot === BODY_UPPER && conflict.items.length > 1).flatMap(conflict => conflict.items));
  const suppressed = requestedIds.filter(id => !assembly.itemIds.includes(id)).map(id => ({
    id, reason: assembly.unresolvedItems.includes(id) ? 'unsupported'
      : requested.completeCoat && id === requested.shirtId && assembly.itemIds.includes(requested.coatId)
        && conflicted.has(id) && conflicted.has(requested.coatId) ? 'body-upper-conflict' : 'unexplained',
  }));
  for (const entry of suppressed) if (entry.reason === 'unexplained')
    fail(`requested item is missing from the final assembly: ${entry.id}`);
  const added = assembly.itemIds.filter(id => !requestedIds.includes(id));

  const names = fittingMorphNames(assembly.fittingTags);
  const covered = new Set();
  const meshes = snapshot.meshes.map(mesh => {
    const where = meshLabel(mesh);
    const implemented = implementedMorphs(mesh, names);
    for (const name of implemented) covered.add(name);
    if (mesh.nonFiniteWeights.length) fail(`${where}: non-finite morph weight at index ${mesh.nonFiniteWeights.join(',')}`);
    // An item may be hidden and still fitted, so visibility is recorded, never an excuse.
    for (const name of implemented) {
      const weight = mesh.weights[mesh.dictionary[name]];
      if (weight !== 1) fail(`${where}: ${name} weight ${weight}, expected 1`);
    }
    // SourceFitting records exactly the names it drove. Other weights on this mesh stay
    // whatever they were; only the bookkeeping has to match what is implemented here.
    if (implemented.length || (Array.isArray(mesh.matched) ? mesh.matched.length : mesh.matched != null)) {
      const matched = Array.isArray(mesh.matched) ? [...mesh.matched].sort() : null;
      if (!matched || !same(matched, implemented))
        fail(`${where}: fitting bookkeeping ${JSON.stringify(mesh.matched)}, expected ${JSON.stringify(implemented)}`);
    }
    return { uuid: mesh.uuid, name: mesh.name, itemId: mesh.itemId, identity: mesh.identity,
      visible: mesh.visible, selfVisible: mesh.selfVisible, implemented,
      dictionary: mesh.dictionary, weights: mesh.weights, matched: mesh.matched };
  });
  // Recorded, not required: a decoded tag may name a morph this preview stage never authored.
  for (const name of names) if (!covered.has(name)) notes.push(`${label}: no mesh implements ${name}`);
  return { errors, notes, meshes, suppressed, added };
}

/** Same-page restoration, checked against weights this page was actually observed to hold.
 *  A weight is only owned once it was seen inactive; a first sighting that is already active
 *  has no recoverable baseline and is recorded as such instead of guessed. */
export class FittingBaselines {
  constructor() { this.meshes = new Map(); }

  /** A reload builds a new page: every observed weight is discarded. */
  reset() { this.meshes.clear(); }

  observe(label, snapshot, activeNames) {
    const errors = [], notes = [], restored = [];
    for (const mesh of snapshot.meshes ?? []) {
      if (!mesh.uuid || !mesh.dictionary || !mesh.weights) continue;
      // Keyed by the page's own mesh uuid, so a replaced mesh starts from its own observation.
      let tracked = this.meshes.get(mesh.uuid);
      if (!tracked) { tracked = new Map(); this.meshes.set(mesh.uuid, tracked); }
      for (const [name, index] of Object.entries(mesh.dictionary)) {
        if (!Number.isInteger(index) || index < 0 || index >= mesh.weights.length) continue;
        const weight = mesh.weights[index], active = activeNames.has(name);
        let state = tracked.get(name);
        if (!state) { state = { baseline: undefined, sawActive: false }; tracked.set(name, state); }
        if (active) {
          if (state.baseline === undefined && !state.sawActive)
            notes.push(`${label}: ${meshLabel(mesh)}/${name} was already active when first observed — no baseline to restore`);
          state.sawActive = true;
        } else if (state.baseline === undefined || !state.sawActive) {
          state.baseline = weight; // first owned observation, or still never activated
        } else {
          if (weight === state.baseline) restored.push({ uuid: mesh.uuid, identity: mesh.identity, name, baseline: state.baseline });
          else errors.push(`${label}: ${meshLabel(mesh)}/${name} is ${weight} after removal, expected the observed ${state.baseline}`);
          state.sawActive = false;
        }
      }
    }
    return { errors, notes, restored };
  }
}
