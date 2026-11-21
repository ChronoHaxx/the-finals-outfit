// Emote playback preferences (21 Nov 2026): the emote speed and the facial animation switch, remembered in this browser
// like the sound's mute and volume (rig/EmoteSounds.ts) and the timeline's Loop.
//
// Speed is a time scale on the emote's own clock, from a quarter speed to four times (RigAnimator.setSpeed). The stops
// are symmetric about 1x in ratio (4 and 1/4, 3 and 1/3, 2 and 1/2, 1.5 and 2/3, 1.25 and 0.8), so normal speed sits in
// the middle of the slider and each step changes the pace by a similar amount. A stored speed is a plain number and is
// read back by clamping, not by matching a stop: a later build with other stops still honours it.
//
// Neither preference rides in share links: a link's pose is a clip and a time (lib/share-pose.ts), the same frame at
// any speed, and both are the viewer's own way of watching, as Loop, Sway and the volume are.
//
// Storage can be missing or blocked (private windows, previews): every access is guarded and the default then applies.
// Separate keys, so older builds simply never read them.

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const EMOTE_SPEEDS: readonly number[] = [0.25, 1 / 3, 0.5, 2 / 3, 0.8, 1, 1.25, 1.5, 2, 3, 4];
export const NORMAL_SPEED_INDEX = EMOTE_SPEEDS.indexOf(1);

/** A speed within 0.25x to 4x (anything else, NaN included, is normal speed). */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/** The slider stop nearest a speed, by ratio (0.3 is nearer 1/3 than 1/4). */
export function speedIndex(speed: number): number {
  const target = Math.log(clampSpeed(speed));
  let best = 0;
  EMOTE_SPEEDS.forEach((stop, i) => { if (Math.abs(Math.log(stop) - target) < Math.abs(Math.log(EMOTE_SPEEDS[best]) - target)) best = i; });
  return best;
}

/** The speed one stop slower (-1) or faster (+1) than `speed`, held at the ends. */
export function stepSpeed(speed: number, direction: -1 | 1): number {
  return EMOTE_SPEEDS[Math.min(EMOTE_SPEEDS.length - 1, Math.max(0, speedIndex(speed) + direction))];
}

/** "0.25×", "0.33×", "1×", "1.25×": at most two decimals, no trailing zeros. */
export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function storage(): Store | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

const SPEED_KEY = "finals-outfit.emote-speed";
const FACE_KEY = "finals-outfit.facial-animation";

/** The remembered emote speed (normal when none, unreadable or out of range). */
export function savedSpeed(store: Store | null = storage()): number {
  try {
    const raw = store?.getItem(SPEED_KEY);
    return raw ? clampSpeed(Number(raw)) : 1;
  } catch { return 1; }
}

/** Remember the emote speed; normal speed removes the key. */
export function saveSpeed(speed: number, store: Store | null = storage()): void {
  try {
    const value = clampSpeed(speed);
    if (value === 1) store?.removeItem(SPEED_KEY); else store?.setItem(SPEED_KEY, String(value));
  } catch { /* the choice just is not remembered */ }
}

/** The remembered facial animation switch: on unless the viewer turned it off. */
export function savedFace(store: Store | null = storage()): boolean {
  try { return store?.getItem(FACE_KEY) !== "off"; } catch { return true; }
}

/** Remember the facial animation switch; on (the default) removes the key. */
export function saveFace(on: boolean, store: Store | null = storage()): void {
  try {
    if (on) store?.removeItem(FACE_KEY); else store?.setItem(FACE_KEY, "off");
  } catch { /* the choice just is not remembered */ }
}

/** The viewer's speed change (slider, reset or < >): applied to the animator, then remembered for the next visit. */
export function setEmoteSpeed(animator: { setSpeed(speed: number): void; readonly state: { speed: number } }, speed: number): void {
  animator.setSpeed(speed);
  saveSpeed(animator.state.speed);
}

/** The viewer's facial animation click: applied, then remembered for the next visit. */
export function setFacialAnimation(animator: { setFace(on: boolean): void }, on: boolean): void {
  animator.setFace(on);
  saveFace(on);
}
