// Every asset URL in the app resolves through here.
//
// No extracted game asset is committed (see CREDITS.md), so a deployed build has none
// of them in its own checkout and must fetch them from somewhere else:
//
//   VITE_ASSETS_BASE   default origin for ALL assets — icons, meshes, textures.
//   VITE_MODELS_BASE   optional override for 3D models only, when meshes live apart
//                      from icons. Falls through to VITE_ASSETS_BASE when unset.
//
// With neither set, paths resolve against the site itself, which is what a local
// checkout with a populated public/ wants.
//
// Bases are treated as immutable and versioned: the deploy uploads to a new prefix
// and switches VITE_ASSETS_BASE atomically, rather than overwriting files in place.
// Assets are served with a one-year immutable cache, so a URL's contents must never
// change once anyone has fetched it.

function join(base: string, path: string): string {
  // Tolerates a base with or without a trailing slash, and a path with or without a
  // leading one, so a mis-punctuated env var cannot produce "//" or a missing "/".
  return base.replace(/\/*$/, "/") + path.replace(/^\/+/, "");
}

export function assetUrl(path: string): string {
  return join(import.meta.env.VITE_ASSETS_BASE || import.meta.env.BASE_URL, path);
}

export function modelUrl(path: string): string {
  const modelsBase = import.meta.env.VITE_MODELS_BASE;
  return modelsBase ? join(modelsBase, path) : assetUrl(path);
}
