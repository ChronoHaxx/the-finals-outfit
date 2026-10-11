/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional base URL for off-repo 3D model assets (GLBs + colormask PNGs). When set,
  // modelUrl() resolves model paths against it; unset falls back to the app base.
  readonly VITE_MODELS_BASE?: string;
  // Optional base URL for reconstruction files (models/reconstructed/ and
  // models/reconstructed-*/). Unset or blank keeps them on the models/asset host.
  readonly VITE_RECONSTRUCTION_BASE?: string;
  readonly VITE_RECONSTRUCTION_ROUTES?: string;
}
