// Pure parts of the share-preview Worker, kept out of index.ts: workerd treats every named export of the main
// module as an entrypoint, so the main module may export only its handler.

export interface Env {
  SHARES: KVNamespace;
  UPLOAD_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  APP_URL: string; // e.g. https://chronohaxx.github.io/the-finals-outfit/
  ALLOWED_ORIGINS: string; // comma-separated
  UPLOADS_DISABLED?: string; // "1" stops new uploads; existing links keep working
}

export const WIDTH = 1200, HEIGHT = 630, MAX_BYTES = 250_000, TTL_SECONDS = 365 * 24 * 3600;
const ID = /^[0-9A-Za-z]{12}$/;
export const validId = (id: string) => ID.test(id);
// The app's short-link grammar (src/lib/share-url.ts): "2." then up to one code per slot.
const CODE = /^2\.(?:[0-9a-z]{2,5}(?:\.[0-9a-z]{2,5}){0,39})?$/;

export const validCode = (code: string | null): code is string => code !== null && CODE.test(code);

// An animation frame shown with the outfit (10 Nov 2026), in the app's pose grammar (src/lib/share-pose.ts):
// emote=<clip id>&t=<seconds, up to 3 decimals>&paused=1. Identifiers and numbers only, never free text.
export interface Pose { emote: string; t: string; paused: boolean }
const CLIP = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const TIME = /^\d{1,3}(?:\.\d{1,3})?$/;

/** The pose in these parameters: undefined when there is none, null when it is malformed. */
export function readPose(params: URLSearchParams): Pose | null | undefined {
  const emote = params.get("emote"), t = params.get("t"), paused = params.get("paused");
  if (emote === null) return t === null && paused === null ? undefined : null;
  if (!CLIP.test(emote) || (t !== null && !TIME.test(t)) || (paused !== null && paused !== "1")) return null;
  return { emote, t: t ?? "0", paused: paused === "1" };
}

/** The pose's parameters, to follow `o=<code>` in a link ("" without a pose). Validated values need no escaping. */
export const poseQuery = (pose: Pose | undefined) =>
  pose ? `&emote=${pose.emote}&t=${pose.t}${pose.paused ? "&paused=1" : ""}` : "";

/** KV metadata beside the outfit code (absent fields for an outfit without a pose, as before). */
export const poseMetadata = (pose: Pose | undefined): Record<string, string> =>
  pose ? { emote: pose.emote, t: pose.t, ...(pose.paused ? { paused: "1" } : {}) } : {};

/** The pose stored with an entry (entries made before poses have none). */
export function storedPose(metadata: Record<string, unknown> | null | undefined): Pose | undefined {
  const params = new URLSearchParams();
  for (const key of ["emote", "t", "paused"]) if (typeof metadata?.[key] === "string") params.set(key, metadata[key] as string);
  return readPose(params) ?? undefined;
}

// The outfit's body type (12 Nov 2026), in the app's grammar (src/lib/body-type.ts): bt=<a short lowercase code>,
// absent for Masculine. The Worker only stores and carries it; the app decides what a code means.
const BODY_TYPE = /^[a-z]{1,2}$/;

/** The body type code in these parameters: undefined when there is none, null when it is malformed. */
export function readBodyType(params: URLSearchParams): string | null | undefined {
  const bodyType = params.get("bt");
  return bodyType === null ? undefined : BODY_TYPE.test(bodyType) ? bodyType : null;
}

/** The body type's parameter, to follow `o=<code>` in a link ("" for Masculine). Validated values need no escaping. */
export const bodyTypeQuery = (bodyType: string | undefined) => bodyType ? `&bt=${bodyType}` : "";

/** KV metadata beside the outfit code (absent for Masculine, as for every entry made before body types). */
export const bodyTypeMetadata = (bodyType: string | undefined): Record<string, string> => bodyType ? { bt: bodyType } : {};

/** The body type stored with an entry (entries made before body types have none: Masculine). */
export function storedBodyType(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const bodyType = metadata?.bt;
  return typeof bodyType === "string" && BODY_TYPE.test(bodyType) ? bodyType : undefined;
}

// The outfit's archetype (22 Nov 2026), in the app's grammar (src/lib/archetype.ts): ar=<a short lowercase code>,
// absent for Medium. Stored and carried like the body type; the app decides what a code means.
const ARCHETYPE = /^[a-z]{1,2}$/;

/** The archetype code in these parameters: undefined when there is none, null when it is malformed. */
export function readArchetype(params: URLSearchParams): string | null | undefined {
  const archetype = params.get("ar");
  return archetype === null ? undefined : ARCHETYPE.test(archetype) ? archetype : null;
}

/** The archetype's parameter, to follow the body type in a link ("" for Medium). Validated values need no escaping. */
export const archetypeQuery = (archetype: string | undefined) => archetype ? `&ar=${archetype}` : "";

/** KV metadata beside the outfit code (absent for Medium, as for every entry made before archetypes). */
export const archetypeMetadata = (archetype: string | undefined): Record<string, string> => archetype ? { ar: archetype } : {};

/** The archetype stored with an entry (entries made before archetypes have none: Medium). */
export function storedArchetype(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const archetype = metadata?.ar;
  return typeof archetype === "string" && ARCHETYPE.test(archetype) ? archetype : undefined;
}

// The outfit's player number (21 Nov 2026), in the app's grammar (src/lib/player-number.ts): pn=<0..99> (one digit
// since 22 Nov 2026; no leading zero), absent when each piece shows its own number. Stored and carried like the body
// type; the app decides what it renders.
const PLAYER_NUMBER = /^(?:[0-9]|[1-9][0-9])$/;

/** The player number in these parameters: undefined when there is none, null when it is malformed. */
export function readPlayerNumber(params: URLSearchParams): string | null | undefined {
  const value = params.get("pn");
  return value === null ? undefined : PLAYER_NUMBER.test(value) ? value : null;
}

/** The player number's parameter, to follow the body type in a link ("" without one). Validated values need no escaping. */
export const playerNumberQuery = (playerNumber: string | undefined) => playerNumber ? `&pn=${playerNumber}` : "";

/** KV metadata beside the outfit code (absent without a number, as for every entry made before player numbers). */
export const playerNumberMetadata = (playerNumber: string | undefined): Record<string, string> =>
  playerNumber ? { pn: playerNumber } : {};

/** The player number stored with an entry (entries made before player numbers have none). */
export function storedPlayerNumber(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const value = metadata?.pn;
  return typeof value === "string" && PLAYER_NUMBER.test(value) ? value : undefined;
}

// The camera the link opens on (21 Nov 2026), in the app's grammar (src/lib/camera-view.ts):
// view=<x>_<y>_<z>_<target x>_<target y>_<target z>[_<roll>], metres to the millimetre, roll to a tenth of a degree.
// Numbers only, never free text. The card does not change with it; the app checks the ranges when it opens the link.
const VIEW = /^-?\d{1,3}(?:\.\d{1,3})?(?:_-?\d{1,3}(?:\.\d{1,3})?){5}(?:_-?\d{1,3}(?:\.\d)?)?$/;

/** The camera view in these parameters: undefined when there is none, null when it is malformed. */
export function readView(params: URLSearchParams): string | null | undefined {
  const view = params.get("view");
  return view === null ? undefined : VIEW.test(view) ? view : null;
}

/** The view's parameter, to follow the pose in a link ("" without one). Validated values need no escaping. */
export const viewQuery = (view: string | undefined) => view ? `&view=${view}` : "";

/** KV metadata beside the outfit code (absent without a view, as for every entry made before camera views). */
export const viewMetadata = (view: string | undefined): Record<string, string> => view ? { view } : {};

/** The view stored with an entry (entries made before camera views have none: the default framing). */
export function storedView(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const view = metadata?.view;
  return typeof view === "string" && VIEW.test(view) ? view : undefined;
}

// The lighting the link opens with (22 Nov 2026), in the app's grammar (src/lib/share-lighting.ts): lt=<a ready-made
// look's id> (e.g. lobby) or lt=<format>.<fields> (letters, digits, '.', '_' and '-'). The Worker checks only that shape
// and carries the value through untouched, so a look written by a newer app (a new ready-made look, a new format, new
// fields) passes through this Worker; the app decides what a value means. Never free text, and no escaping needed.
const LIGHTING = /^(?:[a-z][a-z0-9-]{0,31}|[1-9][0-9]{0,2}\.[A-Za-z0-9._-]{1,1500})$/;

/** The lighting in these parameters: undefined when there is none, null when it is malformed. */
export function readLighting(params: URLSearchParams): string | null | undefined {
  const lighting = params.get("lt");
  return lighting === null ? undefined : LIGHTING.test(lighting) ? lighting : null;
}

/** The lighting's parameter, to follow the view in a link ("" without one). Validated values need no escaping. */
export const lightingQuery = (lighting: string | undefined) => lighting ? `&lt=${lighting}` : "";

/** KV metadata beside the outfit code (absent without lighting, as for every entry made before shared lighting). */
export const lightingMetadata = (lighting: string | undefined): Record<string, string> => lighting ? { lt: lighting } : {};

/** The lighting stored with an entry (entries made before shared lighting have none: the viewer's own lighting). */
export function storedLighting(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const lighting = metadata?.lt;
  return typeof lighting === "string" && LIGHTING.test(lighting) ? lighting : undefined;
}

/** Workers KV keeps at most this many bytes of metadata per entry (the JSON of it). A long look with a long pose and a
 *  full outfit can pass it; such an upload is refused before anything is stored, and the app shares the plain link. */
export const MAX_METADATA_BYTES = 1024;
export const metadataBytes = (metadata: Record<string, string>) => new TextEncoder().encode(JSON.stringify(metadata)).length;

/** Width and height of a JPEG from its first SOF marker, or null when the bytes are not a well-formed JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    if (marker === 0xda) return null; // scan before any frame header
    i += 2 + length;
  }
  return null;
}

export function newId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  while (id.length < 12) for (const byte of crypto.getRandomValues(new Uint8Array(16)))
    if (byte < 248 && id.length < 12) id += alphabet[byte % 62]; // 248 = 4 * 62: no modulo bias
  return id;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const appLink = (env: Env, code: string | null, pose?: Pose, bodyType?: string, playerNumber?: string, view?: string,
  lighting?: string, archetype?: string) =>
  `${env.APP_URL}${code ? `#/?o=${code}${bodyTypeQuery(bodyType)}${archetypeQuery(archetype)}${playerNumberQuery(playerNumber)}${poseQuery(pose)}${viewQuery(view)}${lightingQuery(lighting)}` : ""}`;

export function previewPage(env: Env, self: string, image: string | null, code: string | null, pose?: Pose,
  bodyType?: string, playerNumber?: string, view?: string, lighting?: string, archetype?: string): string {
  // A pose, a body type, a player number, a camera view, the lighting and the archetype belong to an outfit.
  if (!code) { pose = undefined; bodyType = undefined; playerNumber = undefined; view = undefined; lighting = undefined;
    archetype = undefined; }
  const app = appLink(env, code, pose, bodyType, playerNumber, view, lighting, archetype);
  const title = code ? "THE FINALS outfit" : "the-finals-outfit";
  const posed = pose ? `, ${pose.paused ? "frozen" : "caught"} ${pose.t} s into an emote` : "";
  const meta = [
    ["og:site_name", "the-finals-outfit"], ["og:type", "website"], ["og:title", title],
    ["og:description", `A look made in the fan-made THE FINALS outfit builder${posed}. Open it to turn it around in 3D.`],
    ["og:url", self],
    ...(image ? [["og:image", image], ["og:image:width", String(WIDTH)], ["og:image:height", String(HEIGHT)],
      ["og:image:type", "image/jpeg"], ["og:image:alt", `The outfit from the front, three-quarter, side and back${pose ? ", mid-emote" : ""}`]] : []),
  ].map(([property, content]) => `<meta property="${property}" content="${escape(content)}">`);
  const twitter = [["twitter:card", image ? "summary_large_image" : "summary"], ["twitter:title", title],
    ...(image ? [["twitter:image", image]] : [])].map(([name, content]) => `<meta name="${name}" content="${escape(content)}">`);
  // No meta refresh: some crawlers follow it and would read the app's generic tags instead of these.
  // noindex: each share page is a per-person redirect, not a page to rank; link-preview bots ignore it.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#5b8def">
${[...meta, ...twitter].join("\n")}
<script>location.replace(${JSON.stringify(app).replace(/</g, "\\u003c")})</script></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0e;color:#e5e5e5;padding:2rem">
<a style="color:#93c5fd" href="${escape(app)}">Open this outfit in the builder</a></body></html>`;
}
