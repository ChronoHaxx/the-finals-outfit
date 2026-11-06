/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional base URL for off-repo 3D model assets (GLBs + colormask PNGs). When set,
  // modelUrl() resolves model paths against it; unset falls back to the app base.
  readonly VITE_MODELS_BASE?: string;
  // Optional base URL for reconstruction files (models/reconstructed/ and
  // models/reconstructed-*/). Unset or blank keeps them on the models/asset host.
  readonly VITE_RECONSTRUCTION_BASE?: string;
  readonly VITE_RECONSTRUCTION_ROUTES?: string;
  // Optional origin of the link-preview Worker (workers/share-preview). Unset turns preview links off.
  readonly VITE_SHARE_PREVIEW_BASE?: string;
}

// Emitted by the catalog-assets plugin in vite.config.ts: one URL per catalog JSON file.
declare module "virtual:catalog-assets" {
  export const CATALOG_URLS: Readonly<Record<import("./lib/catalog-files").CatalogFileKey, string>>;
}

// Emitted by the roadmap plugin in vite.config.ts: ROADMAP.md, parsed and checked at build time.
declare module "virtual:roadmap" {
  export const ROADMAP: import("./lib/roadmap").Roadmap;
}
