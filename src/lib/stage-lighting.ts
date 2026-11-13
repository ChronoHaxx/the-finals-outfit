import * as THREE from "three";
import { STUDIO_LIGHTING_V2, STUDIO_RIG_V1, STUDIO_RIG_V2 } from "../rig/StudioLighting";

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

/** Full looks replace everything. */
export const FULL_LOOKS: readonly { id: string; label: string; look: () => Look }[] = [
  { id: "studio", label: "Studio", look: () => studioLook() },
  { id: "lobby", label: "Lobby", look: lobbyLook },
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
    BACKDROP_PRESETS.find(p => JSON.stringify(p.backdrop) === JSON.stringify(look.backdrop))?.label
      ?? (isSolid(look.backdrop) ? look.backdrop.inner : "custom backdrop"),
  ];
  return parts.join(" · ");
}
