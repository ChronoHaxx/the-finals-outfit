import type { Backdrop } from "./stage-lighting";

/**
 * In-game scenes as backdrops (15 Nov 2026; scope and evidence in _docs/scene-backdrops-2026-11-12/). A scene replaces
 * the CSS gradient behind the character with a place from the game:
 * - "stage": live geometry drawn in its own canvas behind the viewer's transparent one (the Season 12 main-menu stage:
 *   self-lit planes, so nothing needs baking);
 * - "plate": one image rendered offline from the viewer's own camera (the Season 12 intro tunnel, relit in Blender).
 *
 * While a scene is shown the camera stays where the scene was made for (a plate is right only from its own camera) and a
 * drag turns the character instead, as the game's menu does ("turntable" mode; the user chose it on 12 Nov). The look's
 * backdrop keeps the scene's id in `backdrop.scene`; its colour stops stay as the fallback: shown while the scene
 * loads, if it fails, on the share card, and by an older build that does not know the id (which keeps the id stored,
 * lighting-store.ts merges unknown fields back).
 *
 * Ids are stored in saved looks, so an id is never renamed or reused; a retired season's scene stays listed here.
 */

export type SceneKind = "stage" | "plate";

/** A camera in the viewer's frame: metres, Y up, the character at the origin facing +Z. `fov`: vertical, degrees. */
export interface SceneCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface SceneDef {
  id: string;
  label: string;
  kind: SceneKind;
  /** The colour stops behind the scene (see above). */
  fallback: Backdrop;
  /** Light chrome over it (corner marks, loading text). */
  dark: boolean;
  /** The fixed camera of turntable mode. */
  camera: SceneCamera;
  /** Plates: the image, relative to the scenes base, and its pixel size (rendered at the camera's vertical field). */
  plate?: { file: string; width: number; height: number };
}

/** The viewer's default camera (CharacterViewer's Canvas and OrbitControls target). */
export const DEFAULT_CAMERA: Readonly<SceneCamera> = Object.freeze({
  position: [0, 1.0, 3.6] as [number, number, number],
  target: [0, 0.9, 0] as [number, number, number],
  fov: 35,
});

/** Zoom in turntable mode narrows the field of view (a plate can follow a pure scale exactly; a dolly it cannot). */
export const SCENE_FOV_MIN = 12;

const NAVY = { ellipse: "ellipse 70% 60% at 50% 38%", middleStop: 58 };

export const SCENES: readonly SceneDef[] = Object.freeze([
  {
    id: "s12-menu",
    label: "Season 12 menu",
    kind: "stage",
    fallback: { inner: "#0b3d8f", middle: "#062456", outer: "#020a1c", ...NAVY },
    dark: true,
    camera: { ...DEFAULT_CAMERA },
  },
  {
    id: "s12-tunnel",
    label: "Season 12 intro tunnel",
    kind: "plate",
    fallback: { inner: "#2a2fd0", middle: "#0d0f4a", outer: "#03030f", ...NAVY },
    dark: true,
    camera: { ...DEFAULT_CAMERA },
    plate: { file: "s12-tunnel/plate-v1.webp", width: 3840, height: 1620 },
  },
]);

/** Ids this or any future build may store: short, lower case. Unknown but well-formed ids are kept, never dropped. */
export const SCENE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const sceneById = (id: string | null | undefined): SceneDef | null =>
  (id && SCENES.find(scene => scene.id === id)) || null;

/** The scenes base URL: VITE_SCENES_BASE when set, else scenes/ next to the app (as animations/). */
export function scenesBaseUrl(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined; // no env in the node tests
  const base = (env?.VITE_SCENES_BASE as string | undefined)?.trim()
    || `${(env?.BASE_URL ?? "/").replace(/\/?$/, "/")}scenes/`;
  return base.replace(/\/?$/, "/");
}

export const sceneUrl = (file: string, base = scenesBaseUrl()) => base + file.replace(/^\/+/, "");

/**
 * How much a plate is scaled for a zoomed field of view: the ratio of the half-heights the two fields show at the same
 * distance. Zoom by field of view is a pure scale about the view's centre, which is why it keeps a plate exact.
 */
export function plateScale(fov: number, plateFov: number): number {
  const half = (degrees: number) => Math.tan((degrees * Math.PI) / 360);
  return half(plateFov) / half(fov);
}

/** Turntable angle in radians, wrapped to (-π, π] so it never grows without bound while someone spins. */
export function wrapAngle(radians: number): number {
  const wrapped = Math.atan2(Math.sin(radians), Math.cos(radians));
  return wrapped === -Math.PI ? Math.PI : wrapped + 0; // + 0 turns -0 into 0
}
