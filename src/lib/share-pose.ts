// Poses in share links (10 Nov 2026). People use the viewer as a pose reference, so a shared link can carry the
// animation frame on screen: the clip, the time into it, and whether it was paused there.
//
//   #/?o=2.36o.1l9&emote=ace-pilot&t=1.233&paused=1     short link (the pose rides in the hash route, beside o)
//   ?look=2.head-1--36o&emote=ace-pilot&t=1.233          readable link (beside look, in the query)
//
// emote  the clip id from the animation manifest (a kebab-case slug; idles and reactions have ids too)
// t      seconds into the clip, at most three decimals; frames are derived from the clip's own frame time
// paused "1" holds that frame; without it the clip plays on from t
//
// A link without emote opens exactly as before (the default idle). The names differ from the ?anim= / ?animTime=
// capture switches on purpose: those stay developer tools that a link tidy-up never touches. The share Worker
// (workers/share-preview/src/share.ts) validates the same grammar; keep the two in step.

export interface SharePose {
  /** Clip id from the animation manifest, e.g. "ace-pilot" or "outfit-idle". */
  clip: string;
  /** Seconds into the clip (rounded to milliseconds in links). */
  time: number;
  /** Held on that frame (true) or playing on from it (false). */
  paused: boolean;
}

/** The frame on screen as a share records it, plus what the card's caption says about it. */
export interface PoseCapture extends SharePose {
  label: string;
  /** Frame index (0-based) and the clip's last frame index. */
  frame: number;
  lastFrame: number;
}

export const POSE_KEYS = ["emote", "t", "paused"] as const;
const CLIP = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const TIME = /^\d{1,3}(?:\.\d{1,3})?$/;

/** Seconds as a link writes them: milliseconds, no trailing zeros, never an exponent ("1.233", "0", "12.5"). */
export function formatPoseTime(seconds: number): string {
  const ms = Math.round(Math.min(999.999, Math.max(0, Number.isFinite(seconds) ? seconds : 0)) * 1000);
  return String(ms / 1000);
}

/** The pose's link parameters, in a fixed order. */
export function poseParams(pose: SharePose): [string, string][] {
  const params: [string, string][] = [["emote", pose.clip], ["t", formatPoseTime(pose.time)]];
  if (pose.paused) params.push(["paused", "1"]);
  return params;
}

/** A pose from link parameters: null when there is none or it is malformed (the link then opens as before). A clip
 *  without t starts at its beginning, so a hand-written `&emote=ace-pilot` plays that emote. */
export function readPose(params: URLSearchParams): SharePose | null {
  const clip = params.get("emote");
  if (clip === null || !CLIP.test(clip)) return null;
  const time = params.get("t") ?? "0";
  if (!TIME.test(time)) return null;
  return { clip, time: Number(time), paused: params.get("paused") === "1" };
}

/** The pose in a share URL: the hash route's parameters first (short links), then the query (readable links). */
export function readPoseLink(href: string): SharePose | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const fragment = url.hash.startsWith("#/?") ? readPose(new URLSearchParams(url.hash.slice(3))) : null;
  return fragment ?? readPose(url.searchParams);
}

/** Identity of a pose for "has it changed since it was copied". A playing pose moves every frame, so only its clip
 *  counts; a paused pose is its exact frame. */
export function poseKey(pose: SharePose | null): string {
  if (!pose) return "";
  return pose.paused ? `${pose.clip}@${formatPoseTime(pose.time)}` : `${pose.clip}>`;
}

/** Frame index (0-based, as Unreal counts) of a time, for a clip sampled every `frameTime` seconds. */
export function frameAt(seconds: number, frameTime: number): number {
  return Math.round(seconds / frameTime + 1e-6);
}

// The pose a link asked for, waiting for the viewer: the builder reads the address before the saved-outfits code can
// tidy the link away, and the animation controls apply it once the outfit has loaded. Only a link with a pose sets it;
// the viewer takes it exactly once.
let pending: SharePose | null = null;
const listeners = new Set<() => void>();

export function requestPose(pose: SharePose | null): void {
  if (!pose) return;
  pending = pose;
  listeners.forEach(listener => listener());
}

export function pendingPose(): SharePose | null { return pending; }

export function takePendingPose(): SharePose | null {
  const pose = pending;
  pending = null;
  return pose;
}

export function subscribePendingPose(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
