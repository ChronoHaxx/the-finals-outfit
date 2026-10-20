import type { PreviewScene } from "../rig/SharePreviewRender";

// The share button lives outside the 3D canvas. The viewer publishes what a preview render needs here while it is
// mounted and the outfit has finished loading, and withdraws it otherwise.
let current: PreviewScene | null = null;

export function setPreviewScene(scene: PreviewScene | null): void {
  current = scene;
}

export function getPreviewScene(): PreviewScene | null {
  return current;
}
