// Match the runtime's assetUrl/modelUrl seam when validating a split release.
export function catalogHostGroups(paths, assetsBase, modelsBase) {
  const normalize = base => base.trim().replace(/\/*$/, '/');
  const assets = normalize(assetsBase);
  const models = modelsBase?.trim() ? normalize(modelsBase) : assets;
  if (assets === models) return [{ base: assets, paths: [...paths], reconstruction: true }];
  return [
    { base: assets, paths: [...paths].filter(path => !path.startsWith('models/')), reconstruction: false },
    { base: models, paths: [...paths].filter(path => path.startsWith('models/')), reconstruction: true },
  ];
}
