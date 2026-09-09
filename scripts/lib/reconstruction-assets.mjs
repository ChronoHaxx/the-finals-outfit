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
    const walk = value => {
      if (typeof value === 'string') {
        if (/^(?!\/|[a-z]+:)[\w./-]+\.(json|glsl|bin|glb|gltf|png|webp|jpg|jpeg|ktx2)$/i.test(value)) add(value, dirname(file));
      } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(json);
    if (rel === 'models/reconstructed-assembly-v2/catalog.json') {
      if (json.formatVersion !== 1 || !Array.isArray(json.items)) throw new Error('Invalid source outfit catalog');
      for (const id of json.items) {
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid source item id: ${id}`);
        add(`items/${id}.json`, dirname(file));
      }
    }
  };
  roots.forEach(path => add(path));
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
