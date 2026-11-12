import * as THREE from "three";

/**
 * Viewer-chosen lighting and backdrop (11 Nov 2026, the user's and the community's request): the Studio sun's direction
 * and height, an optional floor that catches the sun's shadow, the Lobby rim lights' hue and a backdrop per theme.
 *
 * Every default is the reviewed look (w157 Studio v2 and the Lobby as shipped): `null` means "the reviewed value,
 * exactly", not a number that happens to be close to it, so a viewer who never touches a control renders the very
 * pixels the visual-diff and audit harnesses compare against. Automated browsers always get DEFAULT_LIGHTING
 * (lighting-store.ts). Pure functions only, so the node tests can check them.
 */
export type SceneTheme = "studio" | "lobby";

export interface LightingSettings {
  /** Degrees round the vertical axis, -180..180; 0 = the reviewed key light. Positive turns it to the viewer's right. */
  sunAzimuth: number;
  /** Degrees above the floor, SUN_ELEVATION_MIN..MAX; null = the reviewed key light's own height (about 51.8°). */
  sunElevation: number | null;
  /** A floor that catches the sun's shadow (Studio). Off = the reviewed look (contact shadow only). */
  floorShadow: boolean;
  /** Lobby rim lights' hue in degrees, 0..360; null = the reviewed blues. */
  lobbyHue: number | null;
  /** Backdrop id per theme (BACKDROPS); "default" = the theme's own reviewed gradient. */
  backdrop: Record<SceneTheme, string>;
}

export const DEFAULT_LIGHTING: LightingSettings = Object.freeze({
  sunAzimuth: 0,
  sunElevation: null,
  floorShadow: false,
  lobbyHue: null,
  backdrop: Object.freeze({ studio: "default", lobby: "default" }) as Record<SceneTheme, string>,
});

export const SUN_ELEVATION_MIN = 10;
export const SUN_ELEVATION_MAX = 85;

// ---------------------------------------------------------------------------------------------------------------------
// The sun (the Studio key light, the one that casts shadows).

/** The reviewed key light (w157 Studio v2). */
export const KEY_POSITION: Readonly<THREE.Vector3> = new THREE.Vector3(2.5, 6, 4);
const KEY_DISTANCE = KEY_POSITION.length(); // 7.63 m: kept whatever the height, so the light only turns
/** The reviewed key light's height above the floor, in degrees (about 51.8°). */
export const DEFAULT_SUN_ELEVATION = THREE.MathUtils.radToDeg(Math.asin(KEY_POSITION.y / KEY_DISTANCE));

/**
 * Where the key light stands, relative to the point it looks at. With the reviewed height (null) this is exactly what
 * PR #37's Sun slider did (KEY_POSITION turned by the azimuth: at 0° it is KEY_POSITION to the last bit). With a
 * chosen height the light keeps its distance and its compass direction and is raised or lowered on that circle.
 */
export function keyLightPosition(azimuth: number, elevation: number | null): [number, number, number] {
  const turned = KEY_POSITION.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, THREE.MathUtils.degToRad(azimuth));
  if (elevation === null) return [turned.x, turned.y, turned.z];
  const e = THREE.MathUtils.degToRad(elevation);
  const ground = Math.hypot(turned.x, turned.z);
  const across = KEY_DISTANCE * Math.cos(e) / ground;
  return [turned.x * across, KEY_DISTANCE * Math.sin(e), turned.z * across];
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
 * The shadow camera for a chosen sun, or the reviewed one when nothing changed (no height chosen, no floor).
 *
 * A directional light's shadow map is a picture taken along the light: one texel per position ACROSS the beam. So the
 * top of a head and the tip of that head's shadow on the floor share one texel; the frustum only has to hold the
 * character, seen from the light, and the floor shadow comes free. Seen from a light at height e, a point h high and
 * d towards the light lands h·cos e - d·sin e up the picture. That is the asymmetric top and bottom below; at a low sun
 * the head lands high, so the frustum grows upward only.
 *
 * Depth: the shadow tip on the floor lies H·cos²e / sin e beyond the point the light looks at, measured along the
 * beam. At 10° that is about 14 m, past the reviewed far plane of 20 m from a light 7.6 m away, and three treats
 * anything past `far` as lit: the tip would be cut off. So `far` grows too. Depth in an orthographic shadow map is
 * stored as a 0..1 fraction of far - near, so the same bias would be a longer distance in a deeper frustum; it is
 * rescaled to keep the reviewed 3.9 mm.
 *
 * `follow`: the light follows the body on a FOLLOW_SNAP grid (travelling emotes), so the frustum gets half a grid step
 * of slack all round.
 */
export function shadowFrustum(elevation: number | null, follow: boolean): ShadowFrustum {
  if (elevation === null && !follow) return { ...REVIEWED_SHADOW_FRUSTUM };
  const e = THREE.MathUtils.degToRad(elevation ?? DEFAULT_SUN_ELEVATION);
  const slack = follow ? FOLLOW_SNAP * Math.SQRT1_2 : 0;
  const reach = CASTER_REACH + slack, margin = MARGIN + slack * Math.sin(e);
  const width = REVIEWED_SHADOW_FRUSTUM.right + slack;
  const near = REVIEWED_SHADOW_FRUSTUM.near;
  const far = Math.max(REVIEWED_SHADOW_FRUSTUM.far,
    KEY_DISTANCE + CASTER_HEIGHT * Math.cos(e) ** 2 / Math.sin(e) + reach * Math.cos(e) + 1);
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

// ---------------------------------------------------------------------------------------------------------------------
// Lobby rim lights.

export interface RimLight { color: string; intensity: number }
/** The Lobby's two rim lights as shipped: the strong back-left blue and the weaker back-right one. */
export const REVIEWED_RIMS: readonly RimLight[] = Object.freeze([
  { color: "#3f6dff", intensity: 2.8 },
  { color: "#2f56ff", intensity: 1.3 },
]);
/** The hue the rim slider shows for the reviewed blues (the strong rim's own hue). */
export const DEFAULT_LOBBY_HUE = hsvOf(REVIEWED_RIMS[0].color).h;
/** A rim can get brighter than shipped by at most this much, however dim its new colour reads (see rimLights). */
export const RIM_MAX_GAIN = 1.25;

/**
 * The Lobby rims for a hue. A light's colour multiplies its intensity, channel by channel, and the eye does not weigh
 * the channels alike: relative luminance is 0.2126 R + 0.7152 G + 0.0722 B in linear light. So the same intensity in
 * yellow reads about five times as bright as the shipped blue. Each rim keeps its own saturation and its small hue
 * offset from the other, takes the new hue, and has its intensity scaled so its luminance (colour × intensity) stays
 * the shipped one. The scale is capped at RIM_MAX_GAIN: the shipped blue is already near the darkest hue there is, and
 * the full match would push violet's blue channel well past anything the Lobby had. null = the shipped rims exactly.
 */
export function rimLights(hue: number | null): RimLight[] {
  if (hue === null) return REVIEWED_RIMS.map(rim => ({ ...rim }));
  return REVIEWED_RIMS.map(rim => {
    const { h, s } = hsvOf(rim.color);
    const offset = h - DEFAULT_LOBBY_HUE;
    const [r, g, b] = hsvToRgb(((hue + offset) % 360 + 360) % 360, s, 1);
    const color = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace); // stored in linear light
    const gain = Math.min(RIM_MAX_GAIN, luminance(new THREE.Color(rim.color)) / luminance(color));
    return { color: `#${color.getHexString(THREE.SRGBColorSpace)}`, intensity: rim.intensity * gain };
  });
}

/** Relative luminance of a colour in linear light (three keeps Color in linear sRGB). */
export function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** HSV of a #rrggbb colour's sRGB-encoded values (what a colour picker shows), not of linear light. */
function hsvOf(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

// ---------------------------------------------------------------------------------------------------------------------
// Backdrops. The canvas is transparent: the backdrop is the page behind it, a CSS gradient, so it changes nothing in
// the 3D scene (no shader, no restart of the still view). The share card paints the same three stops itself.

export interface BackdropStops { inner: string; middle: string; outer: string }
export interface Backdrop extends BackdropStops { id: string; label: string; /** light chrome reads on it */ dark: boolean }

/** Each theme's reviewed backdrop: the stops the share card paints, and the exact CSS the viewer has always used. */
export const THEME_BACKDROP: Record<SceneTheme, BackdropStops> = {
  studio: { inner: "#f0f3f7", middle: "#dee4eb", outer: "#c5cdd7" },
  lobby: { inner: "#1b2740", middle: "#0a0e17", outer: "#05060a" },
};
const THEME_ELLIPSE: Record<SceneTheme, string> = {
  studio: "ellipse 75% 65% at 50% 35%", // sampled from the icon corners (light grey-blue studio backdrop)
  lobby: "ellipse 70% 60% at 50% 38%",
};
export const THEME_BACKGROUND: Record<SceneTheme, string> = {
  studio: `radial-gradient(${THEME_ELLIPSE.studio}, #f0f3f7 0%, #dee4eb 55%, #c5cdd7 100%)`,
  lobby: `radial-gradient(${THEME_ELLIPSE.lobby}, #1b2740 0%, #0a0e17 58%, #05060a 100%)`,
};

const solid = (id: string, label: string, color: string, dark: boolean): Backdrop =>
  ({ id, label, inner: color, middle: color, outer: color, dark });
/** The choices besides "default". "studio" and "lobby" are the two themes' own gradients, offered in the other theme. */
export const BACKDROPS: readonly Backdrop[] = Object.freeze([
  { id: "studio", label: "Studio grey", ...THEME_BACKDROP.studio, dark: false },
  { id: "lobby", label: "Lobby navy", ...THEME_BACKDROP.lobby, dark: true },
  { id: "dusk", label: "Dusk", inner: "#3a2b52", middle: "#1b1530", outer: "#0b0a14", dark: true },
  { id: "sand", label: "Sand", inner: "#f6eee3", middle: "#e6dccd", outer: "#cfc2ae", dark: false },
  solid("white", "White", "#ffffff", false),
  solid("grey", "Grey", "#8c9199", false),
  solid("charcoal", "Charcoal", "#2b2e33", true),
  solid("black", "Black", "#000000", true),
  solid("green", "Green screen", "#00b140", false),
]);

/** The backdrop choices to offer in a theme: its default first, then the others (its own gradient is the default). */
export function backdropChoices(theme: SceneTheme): Backdrop[] {
  return [{ id: "default", label: "Default", ...THEME_BACKDROP[theme], dark: theme === "lobby" },
    ...BACKDROPS.filter(b => b.id !== theme)];
}

/** The backdrop in effect; an unknown id (a choice later removed) falls back to the theme's default. */
export function resolveBackdrop(theme: SceneTheme, id: string): Backdrop {
  return backdropChoices(theme).find(b => b.id === id) ?? backdropChoices(theme)[0];
}

/** The CSS background for a theme's chosen backdrop: the reviewed string itself for "default". */
export function backdropCss(theme: SceneTheme, id: string): string {
  const b = resolveBackdrop(theme, id);
  if (b.id === "default") return THEME_BACKGROUND[theme];
  if (b.inner === b.middle && b.middle === b.outer) return b.inner;
  const middle = theme === "studio" ? 55 : 58;
  return `radial-gradient(${THEME_ELLIPSE[theme]}, ${b.inner} 0%, ${b.middle} ${middle}%, ${b.outer} 100%)`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings from storage, and looks.

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Settings from anything stored: each field is checked on its own, and a field that is missing or out of range takes
 * its default without discarding the others (a look saved by an older or newer version still applies what it can).
 */
export function sanitizeLighting(value: unknown): LightingSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const backdrop = (v.backdrop && typeof v.backdrop === "object" ? v.backdrop : {}) as Record<string, unknown>;
  const backdropId = (theme: SceneTheme) => {
    const id = backdrop[theme];
    return typeof id === "string" && backdropChoices(theme).some(b => b.id === id) ? id : "default";
  };
  return {
    sunAzimuth: finite(v.sunAzimuth) && Math.abs(v.sunAzimuth) <= 180 ? Math.round(v.sunAzimuth) : 0,
    sunElevation: finite(v.sunElevation) && v.sunElevation >= SUN_ELEVATION_MIN && v.sunElevation <= SUN_ELEVATION_MAX
      ? Math.round(v.sunElevation) : null,
    floorShadow: v.floorShadow === true,
    lobbyHue: finite(v.lobbyHue) && v.lobbyHue >= 0 && v.lobbyHue <= 360 ? Math.round(v.lobbyHue) % 360 : null,
    backdrop: { studio: backdropId("studio"), lobby: backdropId("lobby") },
  };
}

export function sameLighting(a: LightingSettings, b: LightingSettings): boolean {
  return a.sunAzimuth === b.sunAzimuth && a.sunElevation === b.sunElevation && a.floorShadow === b.floorShadow
    && a.lobbyHue === b.lobbyHue && a.backdrop.studio === b.backdrop.studio && a.backdrop.lobby === b.backdrop.lobby;
}

export const isDefaultLighting = (settings: LightingSettings) => sameLighting(settings, DEFAULT_LIGHTING);

/** Ready-made looks: each changes only the fields it names. */
export interface BuiltInLook { id: string; label: string; theme: SceneTheme; patch: Partial<LightingSettings> }
export const BUILT_IN_LOOKS: readonly BuiltInLook[] = Object.freeze([
  { id: "overhead", label: "Overhead", theme: "studio", patch: { sunAzimuth: 0, sunElevation: 80, floorShadow: true } },
  { id: "side", label: "Side light", theme: "studio", patch: { sunAzimuth: 90, sunElevation: 25, floorShadow: true } },
  { id: "backlit", label: "Backlit", theme: "studio", patch: { sunAzimuth: 160, sunElevation: 30, floorShadow: true } },
  { id: "low-sun", label: "Low sun", theme: "studio", patch: { sunAzimuth: -45, sunElevation: 12, floorShadow: true } },
  { id: "blue", label: "Blue", theme: "lobby", patch: { lobbyHue: null } },
  { id: "red", label: "Red", theme: "lobby", patch: { lobbyHue: 0 } },
  { id: "gold", label: "Gold", theme: "lobby", patch: { lobbyHue: 42 } },
  { id: "green", label: "Green", theme: "lobby", patch: { lobbyHue: 135 } },
  { id: "violet", label: "Violet", theme: "lobby", patch: { lobbyHue: 275 } },
] as BuiltInLook[]);

/** A short description of a look, for the saved-looks list. */
export function describeLighting(s: LightingSettings): string {
  const parts = [
    `Sun ${s.sunAzimuth}°${s.sunElevation === null ? "" : ` / ${s.sunElevation}° high`}`,
    ...(s.floorShadow ? ["floor shadow"] : []),
    ...(s.lobbyHue === null ? [] : [`rim ${s.lobbyHue}°`]),
    ...(["studio", "lobby"] as const).filter(t => s.backdrop[t] !== "default").map(t => resolveBackdrop(t, s.backdrop[t]).label),
  ];
  return parts.join(" · ");
}
