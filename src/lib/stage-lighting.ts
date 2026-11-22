import * as THREE from "three";
import { STUDIO_LIGHTING_V2, STUDIO_RIG_V1, STUDIO_RIG_V2 } from "../rig/StudioLighting";
import { SCENE_ID, sceneById } from "./scenes";

/**
 * The viewer's scene: lights, reflections, exposure and backdrop, all the viewer's to change (11-12 Nov 2026, the user's
 * and the community's request: "a colour picker for everything", "as much freedom as possible", no separate
 * Studio/Lobby modes). One "look" holds the whole scene. Studio and Lobby are two ready-made looks; Studio, the reviewed
 * w157 v2 rig, is the default, and automated browsers (audits, visual diffs) always render it (lighting-store.ts).
 *
 * Exactness: a preset holds the very numbers the viewer has always rendered (light positions as vectors, the backdrop
 * as its exact CSS stops), and a light keeps its stored position until the viewer moves it, so an untouched look draws
 * the same pixels as before. Lights are a list with an id and a type so a later editor (Blender-like light placement,
 * the multi-character scene) can add kinds without another migration. Pure functions only, for the node tests.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The Studio rig's numbers (w157 lighting calibration): v1 as it shipped through PR #28, v2 the recalibrated rig.
// Dev builds only: ?light=key:value,... overrides single values for a capture (e.g. ?light=room:0.1,env:1,key:2.5);
// production ignores it. The window check comes first: the node tests have no import.meta.env.
export type StudioRig = typeof STUDIO_RIG_V2;
function readStudioRig(): StudioRig {
  const rig = { ...(STUDIO_LIGHTING_V2 ? STUDIO_RIG_V2 : STUDIO_RIG_V1) };
  if (typeof window === "undefined" || !import.meta.env?.DEV) return rig;
  for (const pair of new URLSearchParams(window.location.search).get("light")?.split(",") ?? []) {
    const [key, raw] = pair.split(":"), value = Number(raw);
    if (key in rig && Number.isFinite(value) && value >= 0) rig[key as keyof StudioRig] = value;
  }
  return rig;
}
export const STUDIO_RIG: StudioRig = readStudioRig();

// ---------------------------------------------------------------------------------------------------------------------
// Types.

/** The sun is the one light that may cast shadows (each shadow-casting light renders the scene once more per frame). */
export type LightRole = "sun" | "light";
export interface StageLight {
  id: string;
  name: string;
  role: LightRole;
  /** Only directional lights today; the field is there so other kinds can be added without a migration. */
  type: "directional";
  /** sRGB #rrggbb, as a colour picker gives it. */
  color: string;
  intensity: number;
  /** Where the light stands; it shines at the character (the origin, or the followed body). */
  position: [number, number, number];
  /** Off keeps the light in the scene at intensity 0: no shader recompile (see CharacterViewer's StageLights). */
  enabled: boolean;
  /** Sun only. */
  castShadow: boolean;
}
export type EnvironmentKind = "softbox" | "room" | "none";
export type ToneMappingChoice = "neutral" | "aces" | "agx";
export interface Backdrop {
  /** Centre, middle and edge colours of a radial gradient; all three equal = a solid colour. */
  inner: string;
  middle: string;
  outer: string;
  /** CSS radial-gradient shape and the middle stop's position, kept so the presets reproduce their exact CSS. */
  ellipse: string;
  middleStop: number;
  /** An in-game scene shown instead of the gradient (scenes.ts); the stops stay as its fallback. Absent: none. */
  scene?: string;
}
export interface Look {
  version: 2;
  lights: StageLight[];
  hemisphere: { sky: string; ground: string; intensity: number };
  environment: { kind: EnvironmentKind; intensity: number; /** degrees round the vertical axis */ rotation: number };
  toneMapping: ToneMappingChoice;
  exposure: number;
  contactShadow: boolean;
  floorShadow: boolean;
  floorShadowOpacity: number;
  backdrop: Backdrop;
}

export const MAX_LIGHTS = 6;
export const SUN_HEIGHT_MIN = 10, SUN_HEIGHT_MAX = 85;
export const LIGHT_HEIGHT_MIN = -45, LIGHT_HEIGHT_MAX = 85;
export const INTENSITY_MAX = 10;
export const EXPOSURE_MIN = 0.2, EXPOSURE_MAX = 3;

// ---------------------------------------------------------------------------------------------------------------------
// Backdrops (CSS behind the transparent canvas: nothing in the 3D scene changes, and the share card paints the stops).

const STUDIO_ELLIPSE = "ellipse 75% 65% at 50% 35%"; // sampled from the icon corners
const LOBBY_ELLIPSE = "ellipse 70% 60% at 50% 38%";
export const STUDIO_BACKDROP: Readonly<Backdrop> = Object.freeze({
  inner: "#f0f3f7", middle: "#dee4eb", outer: "#c5cdd7", ellipse: STUDIO_ELLIPSE, middleStop: 55 });
export const LOBBY_BACKDROP: Readonly<Backdrop> = Object.freeze({
  inner: "#1b2740", middle: "#0a0e17", outer: "#05060a", ellipse: LOBBY_ELLIPSE, middleStop: 58 });

const solid = (color: string): Backdrop => ({ inner: color, middle: color, outer: color, ellipse: STUDIO_ELLIPSE, middleStop: 55 });
export interface BackdropPreset { id: string; label: string; backdrop: Backdrop }
export const BACKDROP_PRESETS: readonly BackdropPreset[] = Object.freeze([
  { id: "studio", label: "Studio grey", backdrop: { ...STUDIO_BACKDROP } },
  { id: "lobby", label: "Lobby navy", backdrop: { ...LOBBY_BACKDROP } },
  { id: "dusk", label: "Dusk", backdrop: { inner: "#3a2b52", middle: "#1b1530", outer: "#0b0a14", ellipse: STUDIO_ELLIPSE, middleStop: 55 } },
  { id: "sand", label: "Sand", backdrop: { inner: "#f6eee3", middle: "#e6dccd", outer: "#cfc2ae", ellipse: STUDIO_ELLIPSE, middleStop: 55 } },
  { id: "white", label: "White", backdrop: solid("#ffffff") },
  { id: "grey", label: "Grey", backdrop: solid("#8c9199") },
  { id: "charcoal", label: "Charcoal", backdrop: solid("#2b2e33") },
  { id: "black", label: "Black", backdrop: solid("#000000") },
  { id: "green", label: "Green screen", backdrop: solid("#00b140") },
]);

export const isSolid = (b: Backdrop) => b.inner === b.middle && b.middle === b.outer;

/** The CSS background: a solid colour, or the radial gradient (the presets' strings exactly as the viewer always had). */
export function backdropCss(b: Backdrop): string {
  if (isSolid(b)) return b.inner;
  return `radial-gradient(${b.ellipse}, ${b.inner} 0%, ${b.middle} ${b.middleStop}%, ${b.outer} 100%)`;
}

/** Whether light chrome (text, corner marks) reads on this backdrop: by the luminance of its middle colour. */
export function backdropIsDark(b: Backdrop): boolean {
  return luminance(new THREE.Color(b.middle)) < 0.3;
}

/** A backdrop as the screenshot paints it (12 Nov 2026): backdropCss in numbers. The ellipse's radii and centre are
 *  fractions of the image (CSS percentages of the box); a solid backdrop has three equal colours. */
export interface BackdropPaint {
  colors: [string, string, string];
  stops: [number, number, number];
  cx: number; cy: number; rx: number; ry: number;
}

/** "ellipse 75% 65% at 50% 35%" → its four percentages as fractions (the form sanitizeBackdrop admits). */
function ellipseNumbers(ellipse: string): { rx: number; ry: number; cx: number; cy: number } | null {
  const m = /^ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%$/.exec(ellipse.trim());
  if (!m) return null;
  const [rx, ry, cx, cy] = m.slice(1).map(n => Number(n) / 100);
  return [rx, ry, cx, cy].every(Number.isFinite) ? { rx, ry, cx, cy } : null;
}

export function backdropPaint(b: Backdrop): BackdropPaint {
  const shape = ellipseNumbers(b.ellipse) ?? ellipseNumbers(STUDIO_BACKDROP.ellipse)!;
  return { colors: [b.inner, b.middle, b.outer], stops: [0, b.middleStop / 100, 1], ...shape };
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets.

/** The reviewed key light (w157 Studio v2): the Studio sun. */
export const KEY_POSITION: readonly [number, number, number] = Object.freeze([2.5, 6, 4]) as unknown as [number, number, number];
const KEY_DISTANCE = Math.hypot(...KEY_POSITION); // 7.63 m
/** The reviewed sun's height above the floor, in degrees (about 51.8°). */
export const DEFAULT_SUN_ELEVATION = THREE.MathUtils.radToDeg(Math.asin(KEY_POSITION[1] / KEY_DISTANCE));

const light = (id: string, name: string, role: LightRole, color: string, intensity: number,
  position: [number, number, number], castShadow = false): StageLight =>
  ({ id, name, role, type: "directional", color, intensity, position, enabled: true, castShadow });

/** The reviewed Studio rig: softbox reflections, the shadowed key (the sun) and a neutral back rim. */
export function studioLook(rig: StudioRig = STUDIO_RIG): Look {
  return {
    version: 2,
    lights: [
      light("sun", "Sun", "sun", "#ffffff", rig.key, [...KEY_POSITION], true),
      // unshadowed direct fill from the camera-left fill panel's direction (w157; 0 = absent, as shipped)
      ...(rig.fill > 0 ? [light("fill", "Fill", "light", "#ffffff", rig.fill, [-4.5, 2.5, 2])] : []),
      light("rim", "Rim", "light", "#ffffff", rig.rim, [-3, 4.5, -4]),
    ],
    hemisphere: { sky: "#e8edf4", ground: "#c4c8ce", intensity: rig.hemi },
    environment: { kind: "softbox", intensity: rig.env, rotation: 0 },
    toneMapping: "neutral",
    exposure: rig.exposure,
    contactShadow: true,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: { ...STUDIO_BACKDROP },
  };
}

/** THE FINALS main-menu inspect look: dark, a warm key, the signature blue rims. */
export function lobbyLook(): Look {
  return {
    version: 2,
    lights: [
      light("sun", "Key", "sun", "#fff3e2", 2.4, [3.5, 5, 5], false),
      light("rim-left", "Rim left", "light", "#3f6dff", 2.8, [-5, 3.5, -4]),
      light("rim-right", "Rim right", "light", "#2f56ff", 1.3, [5, 2, -4]),
      light("front", "Front fill", "light", "#cfe0ff", 0.35, [-3, 2, 3]),
    ],
    hemisphere: { sky: "#bcd2ff", ground: "#161018", intensity: 0.35 },
    environment: { kind: "room", intensity: 0.4, rotation: 0 },
    toneMapping: "aces",
    exposure: 1.05,
    contactShadow: false,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: { ...LOBBY_BACKDROP },
  };
}

export const DEFAULT_LOOK: Readonly<Look> = Object.freeze(studioLook());

/** A light aimed from a bearing and height (degrees, as the panel shows them), PRESET_DISTANCE away. */
const PRESET_DISTANCE = 7;
const aimed = (id: string, name: string, role: LightRole, color: string, intensity: number, bearing: number,
  height: number, castShadow = false): StageLight => light(id, name, role, color, intensity, positionFrom(bearing, height, PRESET_DISTANCE), castShadow);
const gradient = (inner: string, middle: string, outer: string): Backdrop =>
  ({ inner, middle, outer, ellipse: STUDIO_ELLIPSE, middleStop: 55 });

/**
 * The Season 12 main menu: the game's own character lights in front of the menu stage (scenes.ts).
 *
 * Measured, not guessed (21 Nov 2026): the lights of CharacterSelection_Lighting round the menu character, read from
 * the level (_docs/scene-backdrops-2026-11-12, section 7). Of its 25 lights only four reach the character; the rest are
 * switched off in the level (bAffectsWorld false) or at 0 lm. Each is turned into a direction seen from the character's
 * chest (bearing + to the viewer's right), and its strength there is lumens / distance², times Unreal's cone and radius
 * falloff:
 * - the key: a 5600 K spot from the upper right (54° / 54°), 45 lm; its 2.9 m radius fades it from the head down;
 * - a saturated blue (#007bff) spot, low from behind on the left (-116° / 9°), 350 lm: the strongest light on the body;
 * - a cool white point light behind on the left (-155° / 8°), 50 lm, nearly as strong at the chest;
 * - a weak lilac fill from in front and below (0° / -21°), 10 lm.
 * The ratios at the chest are about 1 : 2.6 : 2.3 : 0.6 (key at the head); a directional light has no falloff, so the
 * key is set between its head and chest values. The level's sky light and the stage's blue glow are the hemisphere.
 * Absolute brightness and the exposure were set by eye: the game's auto-exposure is not in the level.
 */
export function menuS12Look(): Look {
  const scene = sceneById("s12-menu");
  return {
    version: 2,
    lights: [
      aimed("sun", "Key", "sun", "#ffeee3", 2.2, 54, 54, true),
      aimed("blue-side", "Blue side", "light", "#007bff", 5.5, -116, 9),
      aimed("back", "Back light", "light", "#edf3f9", 2.6, -155, 8),
      aimed("under-fill", "Under fill", "light", "#dadaff", 0.6, 0, -21),
    ],
    hemisphere: { sky: "#9fb4ff", ground: "#0b2a6b", intensity: 0.5 },
    environment: { kind: "room", intensity: 0.35, rotation: 0 },
    toneMapping: "aces",
    exposure: 1.0,
    contactShadow: false,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: scene ? { ...scene.fallback, scene: scene.id } : { ...LOBBY_BACKDROP },
  };
}

/** One hard key from the side and front (half the face in shadow) and a cool rim, on near black. */
export function dramaticLook(): Look {
  return {
    version: 2,
    lights: [
      aimed("sun", "Key", "sun", "#fff1e0", 6, 60, 30, true),
      aimed("rim", "Rim", "light", "#a8c0ff", 3, -135, 25),
    ],
    hemisphere: { sky: "#556070", ground: "#0a0a0c", intensity: 0.05 },
    environment: { kind: "room", intensity: 0.08, rotation: 0 },
    toneMapping: "aces",
    exposure: 1.0,
    contactShadow: true,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: gradient("#2a2c31", "#121316", "#050506"),
  };
}

/** Blue daylight: a pale blue key, a blue fill and rim, on slate. */
export function coolLook(): Look {
  return {
    version: 2,
    lights: [
      aimed("sun", "Key", "sun", "#dbe7ff", 3.6, 28, 45, true),
      aimed("fill", "Fill", "light", "#9cc0ff", 0.8, -55, 15),
      aimed("rim", "Rim", "light", "#6aa2ff", 2.2, -150, 35),
    ],
    hemisphere: { sky: "#d6e4ff", ground: "#26313d", intensity: 0.35 },
    environment: { kind: "softbox", intensity: 1, rotation: 0 },
    toneMapping: "neutral",
    exposure: 1.0,
    contactShadow: true,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: gradient("#5d7894", "#3a5069", "#1d2a38"),
  };
}

/** Low golden-hour sun with its floor shadow, an orange rim, on sand. */
export function warmLook(): Look {
  return {
    version: 2,
    lights: [
      aimed("sun", "Sun", "sun", "#ffc489", 4.2, 50, 22, true),
      aimed("fill", "Fill", "light", "#ffe0bd", 0.6, -60, 20),
      aimed("rim", "Rim", "light", "#ff9455", 1.8, 150, 30),
    ],
    hemisphere: { sky: "#ffe2c2", ground: "#4d3222", intensity: 0.35 },
    environment: { kind: "room", intensity: 0.35, rotation: 0 },
    toneMapping: "aces",
    exposure: 1.0,
    contactShadow: true,
    floorShadow: true,
    floorShadowOpacity: 0.35,
    backdrop: gradient("#f5d9b4", "#dcae7c", "#9c6a41"),
  };
}

/** Even light from everywhere and no shadows: every part of the outfit visible, colours flat. No lights to cast. */
export function fullbrightLook(): Look {
  return {
    version: 2,
    lights: [],
    hemisphere: { sky: "#ffffff", ground: "#ffffff", intensity: 3 },
    environment: { kind: "softbox", intensity: 1, rotation: 0 },
    toneMapping: "neutral",
    exposure: 1.0,
    contactShadow: false,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: { ...STUDIO_BACKDROP },
  };
}

/** Moonlight from behind, a dim blue fill and a warm lamp low on the right, on night blue. */
export function nighttimeLook(): Look {
  return {
    version: 2,
    lights: [
      aimed("sun", "Moon", "sun", "#a9bcff", 1.6, 140, 50, true),
      aimed("fill", "Fill", "light", "#33457f", 0.5, -40, 20),
      aimed("lamp", "Lamp", "light", "#ffb26b", 1.2, 70, 10),
    ],
    hemisphere: { sky: "#2b3b6b", ground: "#07090f", intensity: 0.35 },
    environment: { kind: "room", intensity: 0.12, rotation: 0 },
    toneMapping: "aces",
    exposure: 1.1,
    contactShadow: false,
    floorShadow: false,
    floorShadowOpacity: 0.4,
    backdrop: gradient("#23315c", "#0e1430", "#04060e"),
  };
}

/** Full looks replace everything. Ids are not stored anywhere (a look is matched by its data), so they may change. */
export const FULL_LOOKS: readonly { id: string; label: string; look: () => Look }[] = [
  { id: "studio", label: "Studio", look: () => studioLook() },
  { id: "lobby", label: "Lobby", look: lobbyLook },
  { id: "menu-s12", label: "Season 12 menu", look: menuS12Look },
  { id: "dramatic", label: "Dramatic", look: dramaticLook },
  { id: "cool", label: "Cool", look: coolLook },
  { id: "warm", label: "Warm", look: warmLook },
  { id: "fullbright", label: "Fullbright", look: fullbrightLook },
  { id: "nighttime", label: "Nighttime", look: nighttimeLook },
];
/** Sun looks move the sun (and turn its shadow and the floor shadow on) over whatever look is in use. */
export const SUN_LOOKS: readonly { id: string; label: string; bearing: number; height: number }[] = [
  { id: "overhead", label: "Overhead", bearing: 32, height: 80 },
  { id: "side", label: "Side light", bearing: 90, height: 25 },
  { id: "backlit", label: "Backlit", bearing: 160, height: 30 },
  { id: "low-sun", label: "Low sun", bearing: -45, height: 12 },
];

// ---------------------------------------------------------------------------------------------------------------------
// Light geometry. Bearing: degrees round the character seen from above, 0 = in front (towards the starting camera),
// 90 = to the viewer's right, ±180 = behind. Height: degrees above the floor.

export function lightAngles(position: readonly number[]): { bearing: number; height: number; distance: number } {
  const [x, y, z] = position, distance = Math.hypot(x, y, z);
  return {
    bearing: THREE.MathUtils.radToDeg(Math.atan2(x, z)),
    height: distance ? THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(y / distance, -1, 1))) : 0,
    distance,
  };
}

export function positionFrom(bearing: number, height: number, distance: number): [number, number, number] {
  const b = THREE.MathUtils.degToRad(bearing), e = THREE.MathUtils.degToRad(height);
  return [distance * Math.cos(e) * Math.sin(b), distance * Math.sin(e), distance * Math.cos(e) * Math.cos(b)];
}

/** A light moved to a bearing and/or height, keeping what is not given and its distance. */
export function movedLight(l: StageLight, change: { bearing?: number; height?: number }): StageLight {
  const now = lightAngles(l.position);
  return { ...l, position: positionFrom(change.bearing ?? now.bearing, change.height ?? now.height, now.distance || KEY_DISTANCE) };
}

/** The heights the panel's Height slider allows for a light (the sun stays above the floor, for its shadow). */
export const heightRange = (l: Pick<StageLight, "role">): [number, number] =>
  l.role === "sun" ? [SUN_HEIGHT_MIN, SUN_HEIGHT_MAX] : [LIGHT_HEIGHT_MIN, LIGHT_HEIGHT_MAX];

// ---------------------------------------------------------------------------------------------------------------------
// Light markers (21 Nov 2026, community request): a bulb for each light and a cone the way it shines, shown in the 3D
// view on request (LightMarkers.tsx), and dragged to move the light.
//
// These lights are directional: like the sun, only their direction matters, not how far away they are (their stored
// distance only sizes the sun's shadow box). Drawn at its real place, 7 m out, a marker would sit behind the camera. So
// every marker sits on one sphere round the character's chest, MARKER_RADIUS out along its light's direction: a "light
// dome". Dragging a marker slides it over that dome, which changes the light's bearing and height and nothing else.

export const MARKER_CENTRE: readonly [number, number, number] = Object.freeze([0, 1, 0]) as unknown as [number, number, number];
export const MARKER_RADIUS = 0.8;

type Vec3 = readonly [number, number, number];
const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): [number, number, number] => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** Where a light's marker sits: on the dome, along the light's direction. */
export function markerPosition(l: Pick<StageLight, "position">, centre: Vec3 = MARKER_CENTRE, radius = MARKER_RADIUS): [number, number, number] {
  const d = unit(l.position);
  return [centre[0] + d[0] * radius, centre[1] + d[1] * radius, centre[2] + d[2] * radius];
}

/**
 * The direction (a unit vector from the dome's centre) under a pointer ray, for dragging a marker over the dome.
 *
 * A ray through a sphere crosses it twice: the near side (facing the camera) and the far side. `side` keeps a marker on
 * the half it was picked up on, so a light behind the character stays behind it while dragged; both points lie under
 * the pointer, so the marker stays under the pointer either way. A ray that misses the sphere takes the point of the
 * sphere's outline nearest to it, so dragging past the edge slides the marker round the rim instead of stopping.
 */
export function directionOnDome(origin: Vec3, direction: Vec3, side: "near" | "far",
  centre: Vec3 = MARKER_CENTRE, radius = MARKER_RADIUS): [number, number, number] {
  const d = unit(direction), oc = sub(origin, centre);
  const along = -dot(oc, d); // how far along the ray its closest approach to the centre is
  const closest: [number, number, number] = [oc[0] + d[0] * along, oc[1] + d[1] * along, oc[2] + d[2] * along];
  const miss2 = dot(closest, closest), r2 = radius * radius;
  if (miss2 >= r2) return unit(closest);
  const half = Math.sqrt(r2 - miss2), t = side === "near" ? along - half : along + half;
  return unit([oc[0] + d[0] * t, oc[1] + d[1] * t, oc[2] + d[2] * t]);
}

/** Which half of the dome a marker is on, seen from the camera. */
export function domeSide(l: Pick<StageLight, "position">, camera: Vec3, centre: Vec3 = MARKER_CENTRE): "near" | "far" {
  return dot(unit(l.position), sub(camera, centre)) >= 0 ? "near" : "far";
}

/** A light turned to shine from `direction` (from the character towards the light): its bearing and height follow,
 *  the height kept within its slider's range, and its distance stays. Straight up or down keeps the bearing. */
export function lightTowards(l: StageLight, direction: Vec3): StageLight {
  const [x, y, z] = unit(direction);
  const [min, max] = heightRange(l);
  const height = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(y, -1, 1))), min, max);
  const bearing = Math.hypot(x, z) < 1e-6 ? lightAngles(l.position).bearing : THREE.MathUtils.radToDeg(Math.atan2(x, z));
  return movedLight(l, { bearing, height });
}

export interface ShadowFrustum { left: number; right: number; top: number; bottom: number; near: number; far: number; bias: number }

/** The frustum the key light has shipped with: ±1.4 × ±1.6 m round the origin, 0.5-20 m deep, bias -0.0002. */
export const REVIEWED_SHADOW_FRUSTUM: Readonly<ShadowFrustum> = Object.freeze({
  left: -1.4, right: 1.4, top: 1.6, bottom: -1.6, near: 0.5, far: 20, bias: -0.0002,
});

// What the fitted frustum has to hold: anything up to CASTER_HEIGHT tall (a hat, raised arms, an emote prop) within
// CASTER_REACH of the point the light looks at, with a margin. FOLLOW_SNAP is the grid the light follows the body on.
const CASTER_HEIGHT = 2.5, CASTER_REACH = 1.0, MARGIN = 0.1;
export const FOLLOW_SNAP = 0.25;

/**
 * The sun's shadow camera: the reviewed one while the sun stands where the reviewed key does (any bearing; same
 * height and distance) and nothing follows the body; otherwise fitted.
 *
 * A directional light's shadow map is a picture taken along the light: one texel per position ACROSS the beam. So the
 * top of a head and the tip of that head's shadow on the floor share one texel; the frustum only has to hold the
 * character, seen from the light, and the floor shadow comes free. Seen from a light at height e, a point h high and
 * d towards the light lands h·cos e - d·sin e up the picture: the asymmetric top and bottom below. At a low sun the head
 * lands high, so the frustum grows upward only.
 *
 * Depth: the shadow tip on the floor lies H·cos²e / sin e beyond the point the light looks at, along the beam; past
 * `far` three treats it as lit, so `far` grows (at 10° the tip is about 14 m past the target). Depth in an orthographic
 * shadow map is stored as a 0..1 fraction of far - near, so the bias is rescaled to keep the reviewed 3.9 mm.
 *
 * `follow`: the light follows the body on a FOLLOW_SNAP grid (travelling emotes): half a grid step of slack all round.
 */
export function shadowFrustum(elevation: number, distance: number, follow: boolean): ShadowFrustum {
  if (!follow && Math.abs(elevation - DEFAULT_SUN_ELEVATION) < 1e-6 && Math.abs(distance - KEY_DISTANCE) < 1e-6)
    return { ...REVIEWED_SHADOW_FRUSTUM };
  const e = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(elevation, SUN_HEIGHT_MIN, 89));
  const slack = follow ? FOLLOW_SNAP * Math.SQRT1_2 : 0;
  const reach = CASTER_REACH + slack, margin = MARGIN + slack * Math.sin(e);
  const width = REVIEWED_SHADOW_FRUSTUM.right + slack;
  const near = REVIEWED_SHADOW_FRUSTUM.near;
  const far = Math.max(REVIEWED_SHADOW_FRUSTUM.far,
    distance + CASTER_HEIGHT * Math.cos(e) ** 2 / Math.sin(e) + reach * Math.cos(e) + 1);
  const reviewedDepth = REVIEWED_SHADOW_FRUSTUM.far - REVIEWED_SHADOW_FRUSTUM.near;
  return {
    left: -width, right: width,
    top: CASTER_HEIGHT * Math.cos(e) + reach * Math.sin(e) + margin,
    bottom: -(reach * Math.sin(e) + margin),
    near, far,
    bias: REVIEWED_SHADOW_FRUSTUM.bias * reviewedDepth / (far - near),
  };
}

/** The body's floor position, snapped to the FOLLOW_SNAP grid and kept within ±3 m (as the share card frames it). */
export function snapFollow(x: number, z: number): [number, number] {
  const snap = (v: number) => Number.isFinite(v) ? Math.round(THREE.MathUtils.clamp(v, -3, 3) / FOLLOW_SNAP) * FOLLOW_SNAP : 0;
  return [snap(x) + 0, snap(z) + 0]; // + 0 turns -0 into 0
}

/** The sun of a look (the first light with the sun role), if any. */
export const sunOf = (look: Look) => look.lights.find(l => l.role === "sun");
/** Whether the sun casts shadows now (on, and its shadow switched on). */
export const sunCasts = (look: Look) => { const sun = sunOf(look); return !!sun && sun.enabled && sun.castShadow; };

/** A new light for "Add light": white, in front and a little to the side, 30° up. */
export function newLight(existing: readonly StageLight[]): StageLight {
  const taken = new Set(existing.map(l => l.id));
  let n = existing.length + 1;
  while (taken.has(`light-${n}`)) n++;
  return light(`light-${n}`, `Light ${n}`, "light", "#ffffff", 1, positionFrom(-60, 30, 7));
}

// ---------------------------------------------------------------------------------------------------------------------
// Colour.

/** Relative luminance of a colour in linear light (three keeps Color in linear sRGB). */
export function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

// ---------------------------------------------------------------------------------------------------------------------
// Stored looks: checked field by field. A field that is missing or out of range takes the default's value without
// discarding the rest, so a look saved by an older or newer version still applies what it can.

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  finite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback;
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

function sanitizeLight(value: unknown, index: number, fallback: StageLight | undefined): StageLight | null {
  const v = obj(value);
  const position = Array.isArray(v.position) && v.position.length === 3 && v.position.every(finite)
    && Math.hypot(...(v.position as number[])) > 1e-6 ? [...v.position] as [number, number, number] : fallback?.position;
  if (!position) return null;
  const role: LightRole = v.role === "sun" ? "sun" : v.role === "light" ? "light" : fallback?.role ?? "light";
  return {
    id: typeof v.id === "string" && v.id ? v.id : fallback?.id ?? `light-${index + 1}`,
    name: typeof v.name === "string" && v.name.trim() ? v.name.slice(0, 32) : fallback?.name ?? `Light ${index + 1}`,
    role,
    type: "directional",
    color: isHex(v.color) ? v.color.toLowerCase() : fallback?.color ?? "#ffffff",
    intensity: clamp(v.intensity, 0, INTENSITY_MAX, fallback?.intensity ?? 1),
    position,
    enabled: typeof v.enabled === "boolean" ? v.enabled : fallback?.enabled ?? true,
    castShadow: role === "sun" && (typeof v.castShadow === "boolean" ? v.castShadow : fallback?.castShadow ?? false),
  };
}

function sanitizeBackdrop(value: unknown, fallback: Backdrop): Backdrop {
  const v = obj(value);
  return {
    inner: isHex(v.inner) ? v.inner.toLowerCase() : fallback.inner,
    middle: isHex(v.middle) ? v.middle.toLowerCase() : fallback.middle,
    outer: isHex(v.outer) ? v.outer.toLowerCase() : fallback.outer,
    ellipse: typeof v.ellipse === "string" && /^ellipse [\d.% ]+at [\d.% ]+$/.test(v.ellipse) ? v.ellipse : fallback.ellipse,
    middleStop: clamp(v.middleStop, 1, 99, fallback.middleStop),
    // Kept even when this build does not know the scene (a newer season, or a newer build's id): the gradient shows
    // instead, and the choice is still there for a build that knows it. Absent stays absent (the default compares equal).
    ...(typeof v.scene === "string" && SCENE_ID.test(v.scene) ? { scene: v.scene } : {}),
  };
}

/** A Look from anything stored (a version-2 look, or a PR #40 first-version setting, converted). */
export function sanitizeLook(value: unknown): Look {
  const v = obj(value);
  if (!Array.isArray(v.lights) && ("sunAzimuth" in v || "sunElevation" in v || "floorShadow" in v || "backdrop" in v)) return fromFirstVersion(v);
  const base = studioLook();
  const lights = Array.isArray(v.lights)
    ? v.lights.slice(0, MAX_LIGHTS).map((l, i) => sanitizeLight(l, i, base.lights.find(b => b.id === obj(l).id)))
      .filter((l): l is StageLight => !!l)
    : base.lights;
  // One sun at most; ids unique.
  let sunSeen = false;
  const ids = new Set<string>();
  for (const l of lights) {
    if (l.role === "sun") { if (sunSeen) { l.role = "light"; l.castShadow = false; } sunSeen = true; }
    while (ids.has(l.id)) l.id += "-2";
    ids.add(l.id);
  }
  const hemisphere = obj(v.hemisphere), environment = obj(v.environment);
  return {
    version: 2,
    lights,
    hemisphere: {
      sky: isHex(hemisphere.sky) ? hemisphere.sky.toLowerCase() : base.hemisphere.sky,
      ground: isHex(hemisphere.ground) ? hemisphere.ground.toLowerCase() : base.hemisphere.ground,
      intensity: clamp(hemisphere.intensity, 0, INTENSITY_MAX, base.hemisphere.intensity),
    },
    environment: {
      kind: environment.kind === "room" || environment.kind === "none" || environment.kind === "softbox" ? environment.kind : base.environment.kind,
      intensity: clamp(environment.intensity, 0, INTENSITY_MAX, base.environment.intensity),
      rotation: clamp(environment.rotation, -180, 180, 0),
    },
    toneMapping: v.toneMapping === "aces" || v.toneMapping === "agx" || v.toneMapping === "neutral" ? v.toneMapping : base.toneMapping,
    exposure: clamp(v.exposure, EXPOSURE_MIN, EXPOSURE_MAX, base.exposure),
    contactShadow: typeof v.contactShadow === "boolean" ? v.contactShadow : base.contactShadow,
    floorShadow: v.floorShadow === true,
    floorShadowOpacity: clamp(v.floorShadowOpacity, 0.05, 1, base.floorShadowOpacity),
    backdrop: sanitizeBackdrop(v.backdrop, base.backdrop),
  };
}

/** PR #40's first settings (sun azimuth relative to the reviewed key, sun height, floor shadow, Studio backdrop id). */
function fromFirstVersion(v: Record<string, unknown>): Look {
  const look = studioLook();
  const sun = look.lights[0];
  const azimuth = finite(v.sunAzimuth) && Math.abs(v.sunAzimuth) <= 180 ? v.sunAzimuth : 0;
  const elevation = finite(v.sunElevation) && v.sunElevation >= SUN_HEIGHT_MIN && v.sunElevation <= SUN_HEIGHT_MAX ? v.sunElevation : null;
  if (azimuth || elevation !== null) {
    const keyBearing = lightAngles(KEY_POSITION).bearing;
    look.lights[0] = elevation === null
      ? { ...sun, position: rotated(KEY_POSITION, azimuth) }
      : movedLight(sun, { bearing: keyBearing + azimuth, height: elevation });
  }
  look.floorShadow = v.floorShadow === true;
  const id = obj(v.backdrop).studio;
  const preset = BACKDROP_PRESETS.find(p => p.id === id);
  if (preset) look.backdrop = { ...preset.backdrop };
  return look;
}

/** KEY-style rotation about the vertical axis (PR #37's Sun slider), exact at 0°. */
export function rotated(position: readonly number[], degrees: number): [number, number, number] {
  const p = new THREE.Vector3(...position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, THREE.MathUtils.degToRad(degrees));
  return [p.x, p.y, p.z];
}

/** Two looks the same (after checking): compared as data. */
export function sameLook(a: Look, b: Look): boolean {
  return JSON.stringify(sanitizeLook(a)) === JSON.stringify(sanitizeLook(b));
}
export const isDefaultLook = (look: Look) => sameLook(look, DEFAULT_LOOK);

/** Which full look this is, if it is one exactly ("Studio", "Lobby"); otherwise null. */
export function fullLookName(look: Look): string | null {
  return FULL_LOOKS.find(f => sameLook(look, f.look()))?.label ?? null;
}

/** A short description for the saved-looks list. */
export function describeLook(look: Look): string {
  const sun = sunOf(look), on = look.lights.filter(l => l.enabled && l.intensity > 0).length;
  const parts = [
    `${on} light${on === 1 ? "" : "s"}`,
    ...(sun ? [`sun ${Math.round(lightAngles(sun.position).bearing)}° / ${Math.round(lightAngles(sun.position).height)}°`] : []),
    ...(look.floorShadow && sunCasts(look) ? ["floor shadow"] : []),
    look.backdrop.scene ? sceneById(look.backdrop.scene)?.label ?? "a scene from a newer version"
      : BACKDROP_PRESETS.find(p => JSON.stringify(p.backdrop) === JSON.stringify(look.backdrop))?.label
        ?? (isSolid(look.backdrop) ? look.backdrop.inner : "custom backdrop"),
  ];
  return parts.join(" · ");
}
