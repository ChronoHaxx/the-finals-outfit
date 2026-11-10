import type { PreviewScene } from "../rig/SharePreviewRender";
import type { PoseCapture } from "./share-pose";

// The share button lives outside the 3D canvas. The viewer publishes what a preview render needs here while it is
// mounted and the outfit has finished loading, and withdraws it otherwise.
let current: PreviewScene | null = null;

export function setPreviewScene(scene: PreviewScene | null): void {
  current = scene;
}

export function getPreviewScene(): PreviewScene | null {
  return current;
}

export type { PoseCapture };

/** What the animation controls publish (null while no clips are published). */
export interface PoseSource {
  /** The pose a share would record right now, or null for the outfit's still pose (nothing chosen to show). */
  capture(): PoseCapture | null;
  /** Called when the pose changes other than by playing on (a pause, a seek, another clip). */
  subscribe(listener: () => void): () => void;
}

let poseSource: PoseSource | null = null;
const sourceListeners = new Set<() => void>();

export function setPoseSource(source: PoseSource | null): void {
  poseSource = source;
  sourceListeners.forEach(listener => listener());
}

export function getPoseCapture(): PoseCapture | null {
  return poseSource?.capture() ?? null;
}

/** Notified when the source changes or its pose does (for useSyncExternalStore). */
export function subscribePose(listener: () => void): () => void {
  let unsubscribe = poseSource?.subscribe(listener);
  const swap = () => { unsubscribe?.(); unsubscribe = poseSource?.subscribe(listener); listener(); };
  sourceListeners.add(swap);
  return () => { sourceListeners.delete(swap); unsubscribe?.(); };
}
