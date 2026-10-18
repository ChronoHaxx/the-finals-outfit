import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const RECONSTRUCTION_ROOTS = [
  'models/reconstructed-assembly-v2/catalog.json',
  'models/reconstructed-assemblies-v1/supported-items.json',
  'models/reconstructed-assemblies-v1/assets.json',
  'models/reconstructed-assemblies-v1/skin-pairs.json',
  'models/reconstructed-meshes-v2/SK_Body_M.glb',
  ...['casual-longcoat-leather-black', 'casual-longcoat-leather-camo', 'casual-longcoat-satin']
    .map(id => `models/reconstructed/${id}.json`),
];

// Optional indexes: a release predating the feature intentionally has no file, and the
// runtime reads a 404 as "none supported". When present, each must travel with the
// release, including its reachable resources, and pass the same contract check the
// browser applies, so a release never publishes an index the runtime would refuse.
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const OPTIONAL_INDEX_CONTRACTS = {
  // SourceAssembly.loadSourceFaceCosmetics: material-only eye/eyelash items, each
  // listing the recipient slots its validated face variants cover.
  'models/reconstructed-assemblies-v1/face-cosmetics.json': ['Invalid source face cosmetics index', index =>
    index?.formatVersion === 1 && isRecord(index.items)
    && Object.values(index.items).every(entry => isRecord(entry?.slots) && Object.keys(entry.slots).length > 0)],
  // HeadWrap.loadHeadWraps (18 Oct 2026 integration): head-component wrap cages and
  // proxies. Self-contained data; without it head-wrapped facial hair, balaclavas and
  // scarves are refused in the hosted app.
  'models/reconstructed-assemblies-v1/head-wraps.json': ['Invalid head wrap index', index =>
    index?.formatVersion === 1 && index.contract === 'finals-head-component-wrap-v1' && isRecord(index.reference)
    && isRecord(index.cages) && isRecord(index.heads) && isRecord(index.meshes)],
};
export const OPTIONAL_RECONSTRUCTION_ROOTS = Object.keys(OPTIONAL_INDEX_CONTRACTS);

// A string under the repository's evidence folder cites a sign-off or report, not a
// served file: public/ never contains _docs/. PlasticSheet materials record their
// parametric-opacity sign-off this way (parametricOpacity.signoff, 12 Oct 2026).
const EVIDENCE_CITATION = /^(?:\.\/)*_docs\//;

export function reconstructionDependencies(json, rel) {
  const refs = new Set();
  const walk = value => {
    if (typeof value === 'string') {
      if (/^(?!\/|[a-z]+:)[\w./-]+\.(json|glsl|bin|glb|gltf|png|webp|jpg|jpeg|ktx2)$/i.test(value)
        && !EVIDENCE_CITATION.test(value)) refs.add(value);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(json);
  if (rel === 'models/reconstructed-assembly-v2/catalog.json') {
    if (json.formatVersion !== 1 || !Array.isArray(json.items)) throw new Error('Invalid source outfit catalog');
    for (const id of json.items) {
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid source item id: ${id}`);
      refs.add(`items/${id}.json`);
    }
  }
  return refs;
}

// Follow deployed manifests, including shader code, compressed texture payloads,
// coverage and parameter variants. Source /Game identities are not file URLs.
export function collectReconstructionAssetRefs(publicDir, roots = RECONSTRUCTION_ROOTS) {
  const root = resolve(publicDir), refs = new Set();
  const add = (path, parent = root) => {
    const file = resolve(parent, path), rel = relative(root, file).replaceAll('\\', '/');
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Asset escapes public/: ${path}`);
    if (refs.has(rel)) return;
    if (!existsSync(file)) throw new Error(`Missing reconstruction asset: ${rel}`);
    refs.add(rel);
    if (!rel.endsWith('.json')) return;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    for (const dependency of reconstructionDependencies(json, rel)) add(dependency, dirname(file));
  };
  roots.forEach(path => add(path));
  if (roots === RECONSTRUCTION_ROOTS) {
    for (const path of OPTIONAL_RECONSTRUCTION_ROOTS) {
      if (!existsSync(resolve(root, path))) continue;
      const [message, valid] = OPTIONAL_INDEX_CONTRACTS[path];
      if (!valid(JSON.parse(readFileSync(resolve(root, path), 'utf8')))) throw new Error(message);
      add(path);
    }
  }
  return refs;
}

export function collectAssetCompanions(publicDir, references) {
  const companions = new Set();
  for (const path of references) if (path.endsWith('.glb')) {
    for (const suffix of ['.bodymask.png', '.coverage.webp']) {
      const sibling = path.replace(/\.glb$/, suffix);
      if (existsSync(resolve(publicDir, sibling))) companions.add(sibling);
    }
  }
  return companions;
}
