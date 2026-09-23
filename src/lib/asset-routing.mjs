// Pure URL routing shared by the runtime (assets.ts) and the release validator
// (scripts/lib/catalog-host-groups.mjs), so CI checks the host a browser will actually
// fetch from. Dependency-free on purpose: Vite bundles it and Node imports it as-is.

// Reconstruction files live under models/reconstructed/ and the versioned
// models/reconstructed-*/ roots; models/reconstructedness/ is not one of them.
const RECONSTRUCTION_PATH = /^\/*models\/reconstructed[-/]/;
const MODEL_PATH = /^\/*models\//;

export const isModelPath = path => MODEL_PATH.test(path);
export const isReconstructionPath = path => RECONSTRUCTION_PATH.test(path);

// Tolerates a base with or without a trailing slash, and a path with or without a
// leading one, so a mis-punctuated env var cannot produce "//" or a missing "/".
export function joinBase(base, path) {
  return base.trim().replace(/\/*$/, '/') + path.replace(/^\/+/, '');
}

// modelUrl's host: the reconstruction override for reconstruction files, else the
// models override, else the asset default. A blank reconstruction override is unset.
export function modelBase(path, { assetsBase, modelsBase, reconstructionBase }) {
  const reconstruction = reconstructionBase?.trim();
  return reconstruction && isReconstructionPath(path) ? reconstruction : modelsBase?.trim() || assetsBase.trim();
}

export function modelUrlFor(path, bases) {
  return joinBase(modelBase(path, bases), path);
}
