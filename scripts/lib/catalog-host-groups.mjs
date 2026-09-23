import { isModelPath, modelBase } from '../../src/lib/asset-routing.mjs';

// Match the runtime's assetUrl/modelUrl seam when validating a split release. Each path
// is checked on the host the browser fetches it from; bases that normalize alike share
// one group, and the group serving reconstruction files carries the full reconstruction
// manifest check even when no catalog path lands there.
export function catalogHostGroups(paths, assetsBase, modelsBase, reconstructionBase) {
  const normalize = base => base.trim().replace(/\/*$/, '/');
  const assets = normalize(assetsBase);
  const models = modelsBase?.trim() ? normalize(modelsBase) : assets;
  const reconstruction = reconstructionBase?.trim() ? normalize(reconstructionBase) : models;
  const groups = new Map([assets, models, reconstruction].map(base =>
    [base, { base, paths: [], reconstruction: base === reconstruction }]));
  const bases = { assetsBase: assets, modelsBase: models, reconstructionBase: reconstruction };
  for (const path of paths) {
    groups.get(isModelPath(path) ? normalize(modelBase(path, bases)) : assets).paths.push(path);
  }
  return [...groups.values()];
}
