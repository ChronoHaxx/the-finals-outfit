// Every asset URL in the app resolves through here.
//
// No extracted game asset is committed (see CREDITS.md), so a deployed build has none
// of them in its own checkout and must fetch them from somewhere else:
//
//   VITE_ASSETS_BASE   default origin for ALL assets — icons, meshes, textures.
//   VITE_MODELS_BASE   optional override for 3D models only, when meshes live apart
//                      from icons. Falls through to VITE_ASSETS_BASE when unset.
//   VITE_RECONSTRUCTION_BASE
//                      optional override for reconstruction files only
//                      (models/reconstructed/ and models/reconstructed-*/). Falls
//                      through to VITE_MODELS_BASE when unset or blank.
//
// Routing lives in asset-routing.mjs so the release validator checks the same hosts.
//
// With neither set, paths resolve against the site itself, which is what a local
// checkout with a populated public/ wants.
//
// Bases are treated as immutable and versioned: the deploy uploads to a new prefix
// and switches VITE_ASSETS_BASE atomically, rather than overwriting files in place.
// Assets are served with a one-year immutable cache, so a URL's contents must never
// change once anyone has fetched it.

import { joinBase, modelUrlFor, parseReconstructionRoutes } from "./asset-routing.mjs";

const reconstructionRoutes = parseReconstructionRoutes(import.meta.env.VITE_RECONSTRUCTION_ROUTES);

export function assetUrl(path: string): string {
  return joinBase(import.meta.env.VITE_ASSETS_BASE || import.meta.env.BASE_URL, path);
}

export function modelUrl(path: string): string {
  return modelUrlFor(path, {
    assetsBase: import.meta.env.VITE_ASSETS_BASE || import.meta.env.BASE_URL,
    modelsBase: import.meta.env.VITE_MODELS_BASE,
    reconstructionBase: import.meta.env.VITE_RECONSTRUCTION_BASE,
    reconstructionRoutes,
  });
}
