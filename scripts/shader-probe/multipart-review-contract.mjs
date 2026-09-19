// Per-component outfit assertions for one schemaVersion 2 multipart item. Pure data in, errors out:
// no Three, no fs, no browser. Components are matched only by their exact source part index, then
// checked against their exact source mesh, material and morph dictionary. Vertex counts and names
// never decide a match, and an aggregate mesh/material set never stands in for a component.

const sorted = values => [...values].sort();
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Components in source part order, each with the one material this cohort item binds to it. */
export function expectedComponents(manifest, cohort, item) {
  const errors = [];
  const components = Array.isArray(manifest?.components) ? manifest.components : [];
  if (manifest?.schemaVersion !== 2 || components.length < 2) errors.push('not a schemaVersion 2 multipart manifest');
  const sources = components.map(component => component.source);
  if (!Array.isArray(cohort?.meshes) || !same(cohort.meshes, sources))
    errors.push(`cohort meshes ${JSON.stringify(cohort?.meshes)} are not exactly the manifest components in source part order`);
  if (item?.slot !== manifest?.itemSlot) errors.push(`${item?.id}: slot ${JSON.stringify(item?.slot)} is not ${manifest?.itemSlot}`);
  if (!Array.isArray(item?.materials) || item.materials.length !== components.length)
    errors.push(`${item?.id}: must name exactly one material per component (${components.length})`);
  if (errors.length) throw new Error(errors.join('; '));
  return components.map((component, i) => ({ sourceIndex: component.sourceIndex, source: component.source,
    material: item.materials[i], morphNames: sorted(component.morphNames) }));
}

/** The rig's own part records for one item: each component exactly once, with its mesh and only its material. */
export function checkComponentBindings(entry, components, label) {
  const errors = [];
  const fail = message => errors.push(`${label}: ${message}`);
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  const indices = parts.map(part => part?.sourceIndex);
  if (!same(sorted(indices), sorted(components.map(c => c.sourceIndex))))
    fail(`rendered parts ${JSON.stringify(indices)} are not exactly components ${JSON.stringify(components.map(c => c.sourceIndex))}`);
  for (const component of components) {
    const where = `component ${component.sourceIndex}`;
    const own = parts.filter(part => part?.sourceIndex === component.sourceIndex);
    if (own.length !== 1) { fail(`${where}: ${own.length} rendered parts, expected 1`); continue; }
    const [part] = own;
    if (part.sourceMesh !== component.source) fail(`${where}: source mesh ${JSON.stringify(part.sourceMesh)}, expected ${component.source}`);
    const materials = (part.materials ?? []).map(material => material?.sourceMaterial);
    if (!materials.length || materials.some(material => material !== component.material))
      fail(`${where}: materials ${JSON.stringify(materials)}, expected only ${component.material}`);
  }
  return errors;
}

/** The rendered meshes of one item: every component present, each mesh tagged with its own part, source
 *  mesh and material, its own morph dictionary and exactly the weights the active fitting names set. */
export function checkComponentMeshes(meshes, components, activeNames, label) {
  const errors = [];
  const fail = message => errors.push(`${label}: ${message}`);
  const byIndex = new Map(components.map(component => [component.sourceIndex, component]));
  for (const mesh of meshes) {
    if (!byIndex.has(mesh.sourcePartIndex))
      fail(`mesh ${mesh.uuid ?? mesh.name} has source part ${JSON.stringify(mesh.sourcePartIndex)}, not a manifest component`);
  }
  for (const component of components) {
    const where = `component ${component.sourceIndex}`;
    const own = meshes.filter(mesh => mesh.sourcePartIndex === component.sourceIndex);
    if (!own.length) { fail(`${where}: missing rendered mesh`); continue; }
    for (const mesh of own) {
      const at = `${where} mesh ${mesh.uuid ?? mesh.name}`;
      if (mesh.sourceMesh !== component.source) fail(`${at}: source mesh ${JSON.stringify(mesh.sourceMesh)}, expected ${component.source}`);
      const materials = mesh.sourceMaterials ?? [];
      if (!materials.length || materials.some(material => material !== component.material))
        fail(`${at}: materials ${JSON.stringify(materials)}, expected only ${component.material}`);
      const dictionary = mesh.dictionary ?? {}, weights = mesh.weights ?? [];
      if (!same(sorted(Object.keys(dictionary)), component.morphNames))
        fail(`${at}: morph dictionary ${JSON.stringify(sorted(Object.keys(dictionary)))}, expected ${JSON.stringify(component.morphNames)}`);
      for (const name of component.morphNames) {
        const expected = activeNames.has(name) ? 1 : 0, weight = weights[dictionary[name]];
        if (weight !== expected) fail(`${at}: ${name} weight ${JSON.stringify(weight)}, expected ${expected}`);
      }
    }
  }
  return errors;
}
