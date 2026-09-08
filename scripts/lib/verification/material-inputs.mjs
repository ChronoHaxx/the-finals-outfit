// Follow the same binding selection as the viewer. Once explicit slots exist, a
// legacy piece-wide set is not rendered and cannot stand in for a missing visor.
export function effectiveMaterials(item) {
  if (item.model?.materialBindings) return Object.values(item.model.materialBindings);
  return item.model?.material ? [item.model.material] : [];
}

export function materialMapPaths(item) {
  const paths = new Set();
  const visit = (value) => {
    if (typeof value === "string" && /\.(?:webp|png|jpe?g|ktx2)$/i.test(value)) paths.add(value);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  effectiveMaterials(item).forEach(visit);
  return [...paths].sort();
}
