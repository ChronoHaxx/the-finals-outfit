// Lighting in share links (22 Nov 2026, Shocka's feedback, item 10). Until now a link carried the outfit, the pose and
// the camera, and the lighting stayed in the sender's browser: whoever opened it saw their own. Now a link can carry the
// look (stage-lighting.ts) too.
//
//   #/?o=2.36o.1l9&view=…&lt=lobby                        an untouched ready-made look: its id (FULL_LOOKS)
//   #/?o=2.36o.1l9&lt=1.e1050.ta.h…_…_….v…….l…             any other look: format 1, then its fields
//
// lt  Either the id of a ready-made look (Studio included, so a link always says which look it shows), or a format
//     number, a dot, and the look's fields. Letters, digits, '.', '_' and '-' only, so the value needs no escaping in a
//     URL and survives every link style. A link without lt opens with the viewer's own lighting, exactly as before.
//
// Format 1: fields separated by '.', each a key letter followed by its values separated by '_'. Every number is an
// integer: thousandths (of a unit, a metre, a degree or a percent). Colours are rrggbb in lowercase, without '#'.
//
//   e<exposure>                       t<tone mapping: n neutral | a ACES | x AgX>
//   h<sky>_<ground>_<intensity>       v<reflections: s softbox | r room | n none>_<intensity>_<turn in degrees>
//   c<contact shadow: 0 | 1>          f<floor shadow: 0 | 1>_<its strength, 0-1>
//   b<centre>[_<middle>_<edge>[_<middle stop %>_<ellipse width %>_<height %>_<centre x %>_<centre y %>]]
//       one colour = a solid backdrop, three = the gradient; the shape, when left out, is 55 / 75 65 at 50 35 (Studio's)
//   s<scene id>                       optional: an in-game scene behind the character (scenes.ts)
//   l<s sun | l light><o: off><c: casts shadow, sun only>_<colour>_<intensity>_<x>_<y>_<z>_<name>
//       one per light, in order, at most MAX_LIGHTS; x y z in millimetres; the name with '-' for each space
//
// Every field but s and l is required, once. Nothing defaults to "whatever Studio is now", so a link keeps meaning the
// same look when a later build recalibrates Studio.
//
// Newer builds and older ones (the user's "writers must not drop fields they don't know"):
// - a newer build adds data only as a new field (a new key letter) or as values after a light's name. This build keeps
//   such fields as the look's `linkExtras`, and such values as the light's: stored with the look, and written back into
//   every link made from it, so a newer build that opens either finds them;
// - a ready-made look this build does not know, or another format, is not shown: the viewer keeps their own lighting
//   and is told why. Nothing about their lighting changes.
// The share Worker (workers/share-preview/src/share.ts) checks only the value's shape (LIGHTING_GRAMMAR) and carries it
// through untouched, so a newer app's links pass through an older Worker. Keep the two grammars in step.

import {
  FULL_LOOKS, MAX_LIGHTS, describeLook, fullLookName, sameLook, sanitizeLook,
  type EnvironmentKind, type Look, type StageLight, type ToneMappingChoice,
} from "./stage-lighting";
import { SCENE_ID } from "./scenes";
import { builderHashParams } from "./site-mode";

export const LIGHTING_PARAM = "lt";
export const LIGHTING_FORMAT = 1;
/** The longest lt value either side accepts. A look of six lights with long names is about 600 characters. */
export const MAX_LIGHTING_LENGTH = 1500;
/** The value's shape: a ready-made look's id, or a format number and its payload. The Worker checks the same. */
export const LIGHTING_GRAMMAR = /^(?:[a-z][a-z0-9-]{0,31}|[1-9][0-9]{0,2}\.[A-Za-z0-9._-]{1,1500})$/;

/** Fields a newer build added, kept as written: a key letter, then letters, digits, '_' and '-'. */
export const EXTRA_FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,199}$/;
/** Values a newer build appended to a light, kept as written. */
export const EXTRA_VALUE = /^[A-Za-z0-9-]{1,64}$/;
export const MAX_EXTRA_FIELDS = 16, MAX_EXTRA_VALUES = 8;

const KNOWN_FIELDS = "ethvcfbsl";
const TONE: Record<string, ToneMappingChoice> = { n: "neutral", a: "aces", x: "agx" };
const ENVIRONMENT: Record<string, EnvironmentKind> = { s: "softbox", r: "room", n: "none" };
const letter = (map: Record<string, string>, value: string) => Object.keys(map).find(key => map[key] === value)!;

// The backdrop shape a b field may leave out: Studio's, written here as numbers so it never follows a change to Studio.
const DEFAULT_STOP = 55, DEFAULT_ELLIPSE = [75, 65, 50, 35] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Numbers.

const INTEGER = /^-?(?:0|[1-9][0-9]{0,7})$/;
const UNSIGNED = /^(?:0|[1-9][0-9]{0,7})$/;
const COLOUR = /^[0-9a-f]{6}$/;
const NAME = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** A number as thousandths, never "-0". */
const milli = (value: number) => String(Math.round(value * 1000) + 0);
const fromMilli = (text: string) => Number(text) / 1000;

/** A light's position as the link holds it: within ±1000 m (scaled down whole, so the direction stays) and never so
 *  short that millimetres round it to nothing. */
function linkPosition(position: readonly number[]): [number, number, number] {
  const largest = Math.max(...position.map(Math.abs)), length = Math.hypot(...position);
  const scale = largest > 1000 ? 1000 / largest : length > 0 && length < 0.01 ? 1 / length : 1;
  return position.map(v => v * scale) as [number, number, number];
}

/** "Rim left" -> "Rim-left"; nothing left -> "Light <n>". At most 32 characters. */
function linkName(name: string, index: number): string {
  const slug = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return slug || `Light-${index + 1}`;
}

/** "rim-left" from "Rim left": a light id from its name. */
const idFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "light";

const extrasOf = (value: unknown, grammar: RegExp, max: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && grammar.test(v)).slice(0, max) : [];

// ---------------------------------------------------------------------------------------------------------------------
// Writing.

function ellipseOf(ellipse: string): number[] | null {
  const m = /^ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%$/.exec(ellipse.trim());
  const numbers = m?.slice(1).map(Number);
  return numbers && numbers.every(Number.isFinite) ? numbers : null;
}

function backdropField(look: Look): string {
  const { inner, middle, outer, middleStop, ellipse } = look.backdrop;
  const shape = ellipseOf(ellipse) ?? [...DEFAULT_ELLIPSE];
  const hex = (colour: string) => colour.slice(1).toLowerCase();
  const defaultShape = middleStop === DEFAULT_STOP && shape.every((v, i) => v === DEFAULT_ELLIPSE[i]);
  if (defaultShape && inner === middle && middle === outer) return `b${hex(inner)}`;
  if (defaultShape) return `b${[inner, middle, outer].map(hex).join("_")}`;
  return `b${[...[inner, middle, outer].map(hex), ...[middleStop, ...shape].map(milli)].join("_")}`;
}

function lightField(light: StageLight, index: number): string {
  const flags = `${light.role === "sun" ? "s" : "l"}${light.enabled ? "" : "o"}${light.role === "sun" && light.castShadow ? "c" : ""}`;
  const extras = extrasOf(light.linkExtras, EXTRA_VALUE, MAX_EXTRA_VALUES);
  return `l${[flags, light.color.slice(1).toLowerCase(), milli(light.intensity), ...linkPosition(light.position).map(milli),
    linkName(light.name, index), ...extras].join("_")}`;
}

/** The format-1 payload of a look (without the "1." in front). */
export function lookFields(value: Look): string[] {
  const look = sanitizeLook(value);
  return [
    `e${milli(look.exposure)}`,
    `t${letter(TONE, look.toneMapping)}`,
    `h${[look.hemisphere.sky.slice(1), look.hemisphere.ground.slice(1), milli(look.hemisphere.intensity)].join("_")}`,
    `v${[letter(ENVIRONMENT, look.environment.kind), milli(look.environment.intensity), milli(look.environment.rotation)].join("_")}`,
    `c${look.contactShadow ? 1 : 0}`,
    `f${look.floorShadow ? 1 : 0}_${milli(look.floorShadowOpacity)}`,
    backdropField(look),
    ...(look.backdrop.scene ? [`s${look.backdrop.scene}`] : []),
    ...look.lights.map(lightField),
    ...extrasOf(look.linkExtras, EXTRA_FIELD, MAX_EXTRA_FIELDS).filter(field => !KNOWN_FIELDS.includes(field[0])),
  ];
}

/** The lt value of a look: a ready-made look's id when it is one exactly, otherwise format 1. Two looks that draw the
 *  same in a link have the same value, so this is also how "is that the look already on screen" is answered. */
export function lightingCode(look: Look): string {
  const preset = FULL_LOOKS.find(full => sameLook(look, full.look()));
  return preset ? preset.id : `${LIGHTING_FORMAT}.${lookFields(look).join(".")}`;
}

/** The lighting's link parameter. */
export const lightingParams = (code: string): [string, string][] => [[LIGHTING_PARAM, code]];

/** What the share panel says about a look: "Lobby", or "Custom · 3 lights · sun 54° / 54° · Season 12 menu". */
export const lightingLabel = (look: Look) => fullLookName(look) ?? `Custom · ${describeLook(look)}`;

// ---------------------------------------------------------------------------------------------------------------------
// Reading.

export type LightingRead =
  /** A look to show. `preset` is the ready-made look's name when the link named one. */
  | { kind: "look"; code: string; look: Look; preset: string | null }
  /** A ready-made look or format this build does not know (a newer build's): the viewer's own lighting stays. */
  | { kind: "unknown"; code: string }
  /** Not a lighting value at all, or a broken one. */
  | { kind: "invalid"; code: string };

const fail = (code: string): LightingRead => ({ kind: "invalid", code });

/** Reads an lt value. Strict about shape: a field that is missing, repeated or malformed refuses the whole look, so a
 *  damaged link never shows a look its sender did not make. Numbers out of range are brought within it, as a stored
 *  look's are (stage-lighting.ts sanitizeLook). */
export function parseLighting(code: string): LightingRead {
  if (code.length > MAX_LIGHTING_LENGTH + 4 || !LIGHTING_GRAMMAR.test(code)) return fail(code);
  if (/^[a-z]/.test(code)) {
    const preset = FULL_LOOKS.find(full => full.id === code);
    return preset ? { kind: "look", code, look: preset.look(), preset: preset.label } : { kind: "unknown", code };
  }
  const dot = code.indexOf(".");
  if (Number(code.slice(0, dot)) !== LIGHTING_FORMAT) return { kind: "unknown", code };
  const look = parseFormat1(code.slice(dot + 1).split("."));
  return look ? { kind: "look", code, look, preset: null } : fail(code);
}

function parseFormat1(fields: string[]): Look | null {
  const seen = new Map<string, string[]>();
  const lights: StageLight[] = [];
  const linkExtras: string[] = [];
  for (const field of fields) {
    if (!EXTRA_FIELD.test(field)) return null;
    const key = field[0], values = field.slice(1).split("_");
    if (key === "l") {
      const light = parseLight(values, lights.length);
      if (!light || lights.length >= MAX_LIGHTS) return null;
      lights.push(light);
    } else if (KNOWN_FIELDS.includes(key)) {
      if (seen.has(key)) return null;
      seen.set(key, values);
    } else {
      if (linkExtras.length >= MAX_EXTRA_FIELDS) return null;
      linkExtras.push(field);
    }
  }
  if ([...KNOWN_FIELDS].some(key => key !== "s" && key !== "l" && !seen.has(key))) return null;
  if (lights.filter(light => light.role === "sun").length > 1) return null;

  const [exposure] = values(seen.get("e")!, [UNSIGNED]) ?? [];
  const [tone] = values(seen.get("t")!, [/^[nax]$/]) ?? [];
  const hemisphere = values(seen.get("h")!, [COLOUR, COLOUR, UNSIGNED]);
  const environment = values(seen.get("v")!, [/^[srn]$/, UNSIGNED, INTEGER]);
  const [contact] = values(seen.get("c")!, [/^[01]$/]) ?? [];
  const floor = values(seen.get("f")!, [/^[01]$/, UNSIGNED]);
  const backdrop = parseBackdrop(seen.get("b")!);
  const scene = seen.get("s");
  if (exposure === undefined || !tone || !hemisphere || !environment || contact === undefined || !floor || !backdrop) return null;
  if (scene && (scene.length !== 1 || !SCENE_ID.test(scene[0]))) return null;

  const raw = {
    version: 2,
    lights,
    hemisphere: { sky: `#${hemisphere[0]}`, ground: `#${hemisphere[1]}`, intensity: fromMilli(hemisphere[2]) },
    environment: { kind: ENVIRONMENT[environment[0]], intensity: fromMilli(environment[1]), rotation: fromMilli(environment[2]) },
    toneMapping: TONE[tone],
    exposure: fromMilli(exposure),
    contactShadow: contact === "1",
    floorShadow: floor[0] === "1",
    floorShadowOpacity: fromMilli(floor[1]),
    backdrop: { ...backdrop, ...(scene ? { scene: scene[0] } : {}) },
    ...(linkExtras.length ? { linkExtras } : {}),
  };
  const look = sanitizeLook(raw);
  // sanitizeLook drops a light it cannot place: the link would then show fewer lights than its sender had.
  return look.lights.length === lights.length ? look : null;
}

/** The values when each matches its grammar, in number and order; otherwise null. */
function values(list: string[], grammars: RegExp[]): string[] | null {
  return list.length === grammars.length && list.every((v, i) => grammars[i].test(v)) ? list : null;
}

function parseBackdrop(list: string[]) {
  const colours = list.slice(0, list.length === 1 ? 1 : 3);
  if (![1, 3, 8].includes(list.length) || !colours.every(c => COLOUR.test(c))) return null;
  const shape = list.slice(3);
  if (!shape.every(v => UNSIGNED.test(v))) return null;
  const [stop, rx, ry, cx, cy] = shape.length ? shape.map(fromMilli) : [DEFAULT_STOP, ...DEFAULT_ELLIPSE];
  const [inner, middle, outer] = colours.length === 1 ? [colours[0], colours[0], colours[0]] : colours;
  return { inner: `#${inner}`, middle: `#${middle}`, outer: `#${outer}`, middleStop: stop,
    ellipse: `ellipse ${rx}% ${ry}% at ${cx}% ${cy}%` };
}

function parseLight(list: string[], index: number): StageLight | null {
  const known = values(list.slice(0, 7), [/^(?:s|l)o?$|^so?c$/, COLOUR, UNSIGNED, INTEGER, INTEGER, INTEGER, NAME]);
  const extras = list.slice(7);
  if (!known || extras.length > MAX_EXTRA_VALUES || !extras.every(v => EXTRA_VALUE.test(v)) || known[6].length > 32) return null;
  const [flags, colour, intensity, x, y, z, slug] = known;
  const position = [x, y, z].map(fromMilli) as [number, number, number];
  if (Math.hypot(...position) < 1e-6) return null;
  const sun = flags[0] === "s", name = slug.replace(/-/g, " ");
  return {
    id: sun ? "sun" : idFrom(name) || `light-${index + 1}`,
    name, role: sun ? "sun" : "light", type: "directional", color: `#${colour}`,
    intensity: fromMilli(intensity), position, enabled: !flags.includes("o"), castShadow: sun && flags.endsWith("c"),
    ...(extras.length ? { linkExtras: extras } : {}),
  };
}

/** The lighting in a share URL: the hash route's parameters first (short links), then the query (readable links).
 *  Null when the link has none. */
export function readLightingLink(href: string): LightingRead | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const route = builderHashParams(url.hash); // #/?… or #/chinals?… (lib/site-mode.ts)
  const code = route?.get(LIGHTING_PARAM) ?? url.searchParams.get(LIGHTING_PARAM);
  return code === null ? null : parseLighting(code);
}

/** A route query without its lighting, as the Global | Chinals switch keeps it: the link's lighting was offered when
 *  the link opened, and the router re-reads the address after the switch, which must not offer it again. */
export function withoutLighting(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(LIGHTING_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
