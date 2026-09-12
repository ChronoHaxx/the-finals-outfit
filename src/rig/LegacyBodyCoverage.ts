// Reviewed geometry-derived coverage shared by legacy colour variants. Each mask
// is tied to the body and garment geometry recorded beside the generated asset.
// Other body geometries retain their existing coverage. The checked Medium
// outfits also exercise the viewer's normal clothing and neck fitting tags.
export function resolveLegacyBodyCoverage(
  garmentUrl: string,
  sourceBodyUrl: unknown,
): { url: string; uvTiles: [number, number] } | undefined {
  if (typeof sourceBodyUrl !== "string"
    || !/(?:^|\/)models\/reconstructed-meshes-v2\/SK_Body_M\.glb(?:[?#]|$)/.test(sourceBodyUrl)) return undefined;

  if (/(?:^|\/)models\/cosmetics\/streetwear-tight-singlet\.glb(?:[?#]|$)/.test(garmentUrl)) {
    return {
      // Preserve the asset host, deployment prefix and cache query of the mesh.
      url: garmentUrl.replace(/\/cosmetics\/streetwear-tight-singlet\.glb(?=[?#]|$)/,
        "/reconstructed-coverage-legacy-singlet-v1/streetwear-tight-singlet.bodymask.png"),
      uvTiles: [2, 1],
    };
  }
  return undefined;
}
