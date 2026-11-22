// Camera views (21 Nov 2026, Shocka's feedback, item 3): where the viewer's camera stands, the point it orbits, and its
// roll, as a share link carries it and a saved outfit keeps it. Free of three.js, so the share-link codec, the
// saved-outfit library and the tests can use it in Node; the viewer's side is src/components/CameraBridge.tsx.
//
//   #/?o=2.36o.1l9&view=0.62_1.42_3.1_0_0.95_0_-8      short link (beside o and any pose)
//   ?look=2.head-1--36o&view=0.62_1.42_3.1_0_0.95_0     readable link (beside look, in the query)
//
// view  the camera's x_y_z, then the orbit target's x_y_z, then an optional roll in degrees. Metres in the viewer's
//       world: y is up, the character stands at the origin facing +z, feet at 0. Positions to the millimetre, roll to a
//       tenth of a degree, positive tilting the camera clockwise (the picture turns anticlockwise). Underscores, so the
//       value needs no escaping in a URL.
//
// A link without view opens on the default framing, exactly as before. The name differs from the ?cam= capture switch
// (scripts/visual-diff) on purpose, as the pose's names do (share-pose.ts): a link tidy-up never touches developer
// switches. The share Worker (workers/share-preview/src/share.ts) validates the same grammar; keep the two in step.

import { builderHashParams } from "./site-mode";
import { cleanName, uniqueName } from "./outfit-library";

export type Vec3 = [number, number, number];

export interface CameraView {
  position: Vec3;
  target: Vec3;
  /** Degrees about the view direction, in (-180, 180]; positive tilts the camera clockwise. */
  roll: number;
}

export const VIEW_PARAM = "view";
/** The viewer's opening framing (CharacterViewer): a little above chest height, 3.6 m out, looking at the waist. */
export const DEFAULT_VIEW: CameraView = { position: [0, 1, 3.6], target: [0, 0.9, 0], roll: 0 };
/** No coordinate beyond this many metres: the stage is a few metres across, and the orbit keeps within 10 m. */
export const COORD_LIMIT = 100;
/** The orbit's distance limits (CharacterViewer's OrbitControls: keep the two in step). */
export const MIN_DISTANCE = 0.05, MAX_DISTANCE = 10;

const NUMBER = String.raw`-?\d{1,3}(?:\.\d{1,3})?`;
const ROLL = String.raw`-?\d{1,3}(?:\.\d)?`;
const GRAMMAR = new RegExp(`^${NUMBER}(?:_${NUMBER}){5}(?:_${ROLL})?$`);

const clampCoord = (value: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, Number.isFinite(value) ? value : 0));
/** Rounded to `decimals`, never "-0" (String(-0) is "0") and never an exponent at these magnitudes. */
const fixed = (value: number, decimals: number) => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale + 0;
};

/** Degrees wrapped into (-180, 180]. */
export function wrapRoll(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 360) + 360) % 360;
  return fixed(wrapped > 180 ? wrapped - 360 : wrapped, 1);
}

/** A view at link precision: coordinates within COORD_LIMIT to the millimetre, roll wrapped to a tenth of a degree. */
export function roundView(view: CameraView): CameraView {
  const coord = (value: number) => fixed(clampCoord(value), 3);
  return {
    position: view.position.map(coord) as Vec3,
    target: view.target.map(coord) as Vec3,
    roll: wrapRoll(view.roll),
  };
}

/** The `view` value: six coordinates, then the roll only when there is one. */
export function formatView(view: CameraView): string {
  const { position, target, roll } = roundView(view);
  return [...position, ...target, ...(roll ? [roll] : [])].map(String).join("_");
}

/** A view from a `view` value: null when there is none or it is malformed (the link then opens as before). */
export function parseView(text: string | null | undefined): CameraView | null {
  if (!text || !GRAMMAR.test(text)) return null;
  const numbers = text.split("_").map(Number);
  if (numbers.slice(0, 6).some(n => Math.abs(n) > COORD_LIMIT) || Math.abs(numbers[6] ?? 0) > 180) return null;
  const view: CameraView = { position: numbers.slice(0, 3) as Vec3, target: numbers.slice(3, 6) as Vec3,
    roll: wrapRoll(numbers[6] ?? 0) };
  return distance(view) < 0.001 ? null : view; // a camera on its own target looks nowhere
}

export const distance = ({ position: p, target: t }: CameraView) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);

export const sameView = (a: CameraView, b: CameraView) => formatView(a) === formatView(b);
export const isDefaultView = (view: CameraView) => sameView(view, DEFAULT_VIEW);

/** The view's link parameter. */
export const viewParams = (view: CameraView): [string, string][] => [[VIEW_PARAM, formatView(view)]];

/** The view in a share URL: the hash route's parameters first (short links), then the query (readable links). */
export function readViewLink(href: string): CameraView | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const route = builderHashParams(url.hash); // #/?… or #/chinals?… (lib/site-mode.ts)
  return (route ? parseView(route.get(VIEW_PARAM)) : null) ?? parseView(url.searchParams.get(VIEW_PARAM));
}

/** A route query without its view, as the Global | Chinals switch keeps it: the link's camera was applied when the
 *  link opened, and the router re-reads the address after the switch, which must not move the camera back. */
export function withoutView(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(VIEW_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// ---------------------------------------------------------------------------------------------------------------------
// The view a link asked for, waiting for the viewer's camera (as share-pose.ts does for poses). The address is read
// before the saved-outfits code can tidy the link away; the viewer applies it once its camera can move.

let pending: CameraView | null = null;
const pendingListeners = new Set<() => void>();

export function requestView(view: CameraView | null): void {
  if (!view) return;
  pending = view;
  pendingListeners.forEach(listener => listener());
}

export function pendingView(): CameraView | null { return pending; }

export function takePendingView(): CameraView | null {
  const view = pending;
  pending = null;
  return view;
}

export function subscribePendingView(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}

// ---------------------------------------------------------------------------------------------------------------------
// The live camera, for controls outside the 3D canvas (the camera panel, the share button). The viewer publishes a
// handle while it is mounted (CameraBridge) and reports every change.

export interface CameraHandle {
  /** The camera now, at link precision. */
  get(): CameraView;
  /** Moves the camera there. False while something else holds the camera still. */
  set(view: CameraView): boolean;
  /** True while the camera cannot be moved by hand: OrbitControls are off (a scene backdrop's fixed camera). */
  locked(): boolean;
}

let handle: CameraHandle | null = null;
const cameraListeners = new Set<() => void>();

export function setCameraHandle(next: CameraHandle | null): void {
  handle = next;
  notifyCamera();
}

export function getCameraHandle(): CameraHandle | null { return handle; }

/** The viewer calls this whenever the camera moved (an orbit frame, a typed value, a recalled view, the roll). */
export function notifyCamera(): void {
  cameraListeners.forEach(listener => listener());
}

export function subscribeCamera(listener: () => void): () => void {
  cameraListeners.add(listener);
  return () => { cameraListeners.delete(listener); };
}

/** What a share would record now: the live view when the camera is free and not on the default framing, else null. */
export function shareableView(): CameraView | null {
  if (!handle || handle.locked()) return null;
  const view = handle.get();
  return isDefaultView(view) ? null : view;
}

// ---------------------------------------------------------------------------------------------------------------------
// Views saved with an outfit (the saved-outfit record's `cameraViews`, src/lib/outfit-library.ts). The stored list is
// kept exactly as written: an entry this version cannot read stays in the list untouched, an entry it changes keeps
// fields it does not know, and a deletion is a tombstone (`deletedAt`) so an older copy cannot bring it back.

/** Live views an outfit keeps at most. Saving past it is refused, never an eviction. */
export const VIEW_CAP = 20;

export interface SavedView extends CameraView {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredView extends SavedView { deletedAt?: number }

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n));

function readStoredView(raw: unknown): StoredView | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || !isVec3(raw.position) || !isVec3(raw.target)) return undefined;
  const view: StoredView = {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "View",
    position: raw.position, target: raw.target,
    roll: typeof raw.roll === "number" ? wrapRoll(raw.roll) : 0,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
  if (typeof raw.deletedAt === "number") view.deletedAt = raw.deletedAt;
  return view;
}

const entries = (list: unknown): unknown[] => Array.isArray(list) ? list : [];

/** The views an outfit shows, oldest first. Unreadable entries and tombstones are skipped (and kept in storage). */
export function liveViews(list: unknown): SavedView[] {
  return entries(list).flatMap(raw => {
    const view = readStoredView(raw);
    if (!view || view.deletedAt !== undefined) return [];
    const { id, name, position, target, roll, createdAt, updatedAt } = view;
    return [{ id, name, position, target, roll, createdAt, updatedAt }];
  });
}

/** True when the list holds a deleted view with this id (what Undo can bring back). */
export const hasDeletedView = (list: unknown, id: string) =>
  entries(list).some(raw => readStoredView(raw)?.id === id && readStoredView(raw)?.deletedAt !== undefined);

/** False when the stored value is not a list (written by some newer format): this version then never rewrites it. */
export const viewsWritable = (list: unknown) => list === undefined || Array.isArray(list);

/** The list with a new view at the end, or null at VIEW_CAP. */
export function withViewAdded(list: unknown, view: CameraView, options: { id: string; now: number; name?: string }): unknown[] | null {
  const live = liveViews(list);
  if (live.length >= VIEW_CAP) return null;
  const name = cleanName(options.name ?? "") || uniqueName("View", live.map(v => v.name), { numberFirst: true });
  const { position, target, roll } = roundView(view);
  const entry: StoredView = { id: options.id, name, position, target, roll, createdAt: options.now, updatedAt: options.now };
  return [...entries(list), entry];
}

/** Changes one entry by id, keeping every field it carries (read, change, write back). */
function withEntry(list: unknown, id: string, change: (entry: Record<string, unknown>) => Record<string, unknown>): unknown[] {
  return entries(list).map(raw => isObject(raw) && raw.id === id ? change({ ...raw }) : raw);
}

export function withViewRenamed(list: unknown, id: string, name: string, now: number): unknown[] {
  const clean = cleanName(name);
  if (!clean) return entries(list);
  return withEntry(list, id, entry => ({ ...entry, name: clean, updatedAt: now }));
}

/** A tombstone: the entry stays, marked deleted, so Undo can bring it back and no older copy can. */
export function withViewDeleted(list: unknown, id: string, now: number): unknown[] {
  return withEntry(list, id, entry => ({ ...entry, deletedAt: now, updatedAt: now }));
}

/** Undo of a deletion, or null when the outfit is at VIEW_CAP again. */
export function withViewRestored(list: unknown, id: string, now: number): unknown[] | null {
  if (liveViews(list).length >= VIEW_CAP) return null;
  return withEntry(list, id, entry => {
    const next: Record<string, unknown> = { ...entry, updatedAt: now };
    delete next.deletedAt;
    return next;
  });
}
