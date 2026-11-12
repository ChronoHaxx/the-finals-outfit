import * as THREE from "three";
import { DeformationRig } from "./DeformationRig";
import { EmoteProps, type AttachBone, type ComponentSpace } from "./EmoteProps";
import { FaceAnimator, type FaceSample } from "./FaceAnimator";
import type { FaceWrapPart } from "./FaceWrap";
import { EmoteSounds } from "./EmoteSounds";
import { SpringBones } from "./SpringBones";
import { frameAt, type PoseCapture, type SharePose } from "../lib/share-pose";

// Showcase animation playback (5 Nov 2026). Plays the game's own front-end clips (outfit-screen idles, slot
// reactions, emotes) on the body's driver skeleton. Every cosmetic follows for free: each one is skinned (or
// rigidly bound) to those same driver bones, so moving a bone moves everything weighted to it.
//
// Clips come from scripts/anim-export/convert-clips.mjs, already in the driver skeleton's local frames. This class
// only schedules them: an AnimationMixer bound to the body scene, crossfades between an idle loop and one-shot
// emotes, and pause (a frozen pose the still-view accumulator can converge on). Stopping fades back to exactly the
// static pose the rig had before: three restores each bone's pre-play value when its last action deactivates.
//
// After each frame's clip, DeformationRig.ts poses the body's *_vpj twist/volume joints the way the game's
// deformation Control Rig does (no clip keys them; left at rest a twisted wrist collapses).
//
// Emote props (EmoteProps.ts) appear on their sockets in the windows the emote's notifies give. Emote sounds
// (EmoteSounds.ts, 12 Nov 2026) follow the same clip clock: every frame they are told the emote's time and whether it
// advances, and keep the game's sound cues in step with it (paused, scrubbed or held: silent).
//
// Transport (10 Nov 2026, the emote timeline): the mixer has two pause switches, three's per-action `paused` (which it
// also sets itself when a clamped one-shot reaches its end) and our `mixer.timeScale`. Only timeScale means "paused"
// here; every hold clears the action's own flag, and "at the end" is read from the time, never from either flag. A
// pause is a hold: the clip in front alone at its time, fades and the clips under it stopped, so a paused frame is
// exactly (clip, time) and a share link can reproduce it. An emote the viewer has paused, scrubbed or stepped is
// "inspected": at its end it stays on the last frame, paused, as a video player does, instead of returning to the idle.
//
// Faces (12 Nov 2026, FaceAnimator.ts): after the clip and the deformation rig, the clips' Face_* curves pose the worn
// head's FACIAL_* bones through the head's own pose asset, as the game's head AnimBlueprint does.
//
// What this does NOT animate (known gaps, see _docs/showcase-animation-2026-11-05/README.md): cloth simulation
// (coat tails, capes, loose straps stay rigid on their bones), effects (Niagara), skeletal props' own animation,
// props tied to a worn cosmetic, and voice lines (vocalization notifies name a gameplay tag the character's voice
// resolves, not a sound asset).

export type ClipKind = "idle" | "react" | "emote";

/** What the game shows with an emote, from its item data and its animation's notifies (build-emote-catalog.mjs). */
export interface EmoteInfo {
  gameId?: string;
  name?: string;
  /** No display name in the game files (the label is derived from the internal id). */
  unnamed?: boolean;
  description?: string;
  rarity?: string | null;
  season?: number | null;
  /** Spawned prop actors and effects (Niagara systems, effect-only actors): not shown by this preview. */
  props?: string[];
  fx?: string[];
  /** Props spawned only while a particular cosmetic is worn. */
  itemProps?: { prop: string; item: string }[];
  /** An emote animation in the game files that no current emote item plays (older or default emotes). */
  unlisted?: boolean;
}

export interface ClipInfo {
  id: string;
  label: string;
  kind: ClipKind;
  loop: boolean;
  duration: number;
  /** Several emotes can share one animation file. */
  file: string;
  bytes: number;
  /** Thumbnail, relative to the set directory. */
  icon?: string;
  /** The game animation (AnimSequence name) the clip was converted from; keys the emote's props. */
  source?: string;
  emote?: EmoteInfo;
}

/** What the facial animation reads from the viewer's rig (CharacterRig.faceMeshes, faceWraps; the worn items' face
 *  masks, SourceAssembly.loadSourceFaceMask). */
export interface FaceSource {
  meshes: readonly THREE.SkinnedMesh[];
  wraps: readonly FaceWrapPart[];
  masks: readonly string[] | Promise<readonly string[]>;
}

export interface AnimationManifest {
  formatVersion: 1;
  base?: string; // set directory the clip files live in, relative to the manifest
  defaultIdle: string;
  rarityOrder?: string[];
  clips: ClipInfo[];
  /** Emote props manifest (build-props.mjs), relative to the manifest. */
  props?: string;
  /** Facial animation index (build-face.mjs), relative to the manifest. */
  faces?: string;
  /** Emote sounds manifest (build-emote-sounds.mjs), relative to the manifest. */
  sounds?: string;
  /** Bones the props attach to that the body mesh lacks (animated by the clips), and UE component space. */
  attachBones?: AttachBone[];
  componentSpace?: ComponentSpace;
}

interface ClipData {
  formatVersion: 1;
  id: string;
  frameTime: number;
  qScale: number;
  pScale: number;
  q: [string, number[], number[]][];
  p: [string, number[], number[]][];
  /** The emote's PropAnimSequenceTime curve ([frame keys, seconds], linear): its props' animation time. */
  propTime?: [number[], number[]];
}

/** Seconds into the clip -> the props' animation time, from a clip's PropAnimSequenceTime keys (held at both ends). */
export function propClock(data: Pick<ClipData, "frameTime" | "propTime">): ((time: number) => number) | null {
  if (!data.propTime) return null;
  const [frames, values] = data.propTime;
  const times = frames.map(f => f * data.frameTime);
  return (time: number) => {
    if (time <= times[0]) return values[0];
    for (let i = 1; i < times.length; i++) {
      if (time <= times[i]) return values[i - 1] + (values[i] - values[i - 1]) * (time - times[i - 1]) / (times[i] - times[i - 1]);
    }
    return values[values.length - 1];
  };
}

/** The emote in front, for the timeline (seconds; frames from the clip's own frame time). */
export interface Timeline {
  clip: string;
  time: number;
  duration: number;
  frameTime: number;
  paused: boolean;
}

export interface AnimatorState {
  /** An idle or emote is applied to the skeleton (including while fading back to the static pose). */
  active: boolean;
  /** The pose changes from frame to frame (active and not paused). */
  moving: boolean;
  paused: boolean;
  /** Approximate secondary motion on garment jiggle chains (SpringBones.ts) while the pose moves. */
  sway: boolean;
  /** Emotes and reactions repeat from their first frame instead of returning to the idle (the timeline's Loop). */
  loopEmote: boolean;
  idle: string | null;
  current: string | null; // the clip in front: an emote while it plays, else the idle
  loading: string | null;
  error: string | null;
}

const FADE = 0.3; // seconds; long enough to hide a pose jump, short enough to feel responsive

/** The clips base URL: VITE_ANIMATIONS_BASE when set, else animations/ next to the app. */
export function animationsBaseUrl(): string {
  const base = (import.meta.env.VITE_ANIMATIONS_BASE as string | undefined)?.trim()
    || `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}animations/`;
  return base.replace(/\/?$/, "/");
}

/** The published clip manifest, or null when this deployment ships no clips (the controls then stay hidden). */
export async function loadAnimationManifest(base = animationsBaseUrl()): Promise<{ manifest: AnimationManifest; clipBase: string;
  propsUrl: string | null; facesUrl: string | null; soundsUrl: string | null } | null> {
  let response: Response;
  try { response = await fetch(`${base}manifest.json`); } catch { return null; }
  if (!response.ok) return null;
  let manifest: AnimationManifest;
  try { manifest = await response.json(); } catch { return null; } // an SPA fallback page: no clips published
  if (manifest?.formatVersion !== 1 || !Array.isArray(manifest.clips) || !manifest.clips.length) return null;
  return { manifest, clipBase: base + (manifest.base ?? ""), propsUrl: manifest.props ? base + manifest.props : null,
    facesUrl: manifest.faces ? base + manifest.faces : null, soundsUrl: manifest.sounds ? base + manifest.sounds : null };
}

type PoseRecord = (readonly [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3])[];
function restorePose(pose: PoseRecord): void {
  for (const [o, p, q, s] of pose) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
}

/** The clip the viewer starts once the first outfit has loaded, or null to open in the still pose. The idle is the
 *  default; an explicit ?anim= request wins (also in automated captures); ?anim=0 or ?anim=still opens still, as do
 *  automated browsers (the still-pose harnesses), a reduced-motion system setting and the viewer's remembered choice. */
export function initialClip(options: { anim: string | null; defaultIdle: string; automated: boolean;
  reducedMotion: boolean; savedStill: boolean }): string | null {
  const { anim } = options;
  if (anim === "0" || anim === "still") return null;
  if (anim) return anim;
  if (options.automated || options.reducedMotion || options.savedStill) return null;
  return options.defaultIdle;
}

function buildClip(data: ClipData, name: string): THREE.AnimationClip {
  if (data.formatVersion !== 1) throw new Error(`Unsupported clip format ${data.formatVersion}`);
  const tracks: THREE.KeyframeTrack[] = [];
  const times = (keys: number[]) => Float32Array.from(keys, k => k * data.frameTime);
  for (const [bone, keys, ints] of data.q) {
    const values = new Float32Array(ints.length);
    for (let i = 0; i < ints.length; i += 4) {
      const x = ints[i] / data.qScale, y = ints[i + 1] / data.qScale, z = ints[i + 2] / data.qScale, w = ints[i + 3] / data.qScale;
      const n = Math.hypot(x, y, z, w) || 1; // int16 quantisation leaves a tiny norm error
      values[i] = x / n; values[i + 1] = y / n; values[i + 2] = z / n; values[i + 3] = w / n;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times(keys), values));
  }
  for (const [bone, keys, ints] of data.p)
    tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times(keys), Float32Array.from(ints, v => v / data.pScale)));
  return new THREE.AnimationClip(name, -1, tracks);
}

export class RigAnimator {
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private clips = new Map<string, Promise<THREE.AnimationClip>>(); // by clip id: its name is the id the state reports
  private files = new Map<string, Promise<ClipData>>(); // by file: emotes that share an animation download it once
  private propClocks = new Map<string, (time: number) => number>(); // by clip id, for clips with a prop clock
  private frameTimes = new Map<string, number>(); // by clip id: seconds per frame, from its file
  private idleAction: THREE.AnimationAction | null = null;
  private emoteAction: THREE.AnimationAction | null = null;
  // Actions replaced mid-play (an emote picked during another, an idle swapped): still fading out, owned by neither
  // slot. Each is stopped once its weight reaches zero; three would otherwise keep it active (disabled, but bound and
  // ticked every frame) for good, one more per emote clicked, and a frozen seek would show it at its frozen weight.
  private fading = new Set<THREE.AnimationAction>();
  private stopping = false;
  private request = 0; // latest play/stop wins when clip downloads overlap
  private listeners = new Set<() => void>();
  private poseListeners = new Set<() => void>(); // the held frame moved (seek, scrub, step): no state change
  // The emote in front was paused, scrubbed or stepped by the viewer: it stays on its last frame instead of returning
  // to the idle. Set by the viewer's transport only (a link that plays on from its time still returns to the idle).
  private inspecting = false;
  private seeking = false; // inside hold(): a preroll reaching the clip's end is not the emote ending
  private pendingScrub: number | null = null; // a slider drag's latest time, applied once per frame by update()
  /** The viewer is dragging the timeline: the pose changes every frame (the still view uses its motion path). */
  scrubbing = false;
  // The static pose of every bone, captured as playback starts (and for bones an outfit change adds while it plays),
  // so a still render (the share card, an export) can be drawn mid-animation. Cleared once the pose is static again.
  private still = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion, THREE.Vector3]>();
  private holding = false;
  private held: PoseRecord | null = null;
  private snapshot: AnimatorState = { active: false, moving: false, paused: false, sway: true, loopEmote: false, idle: null, current: null, loading: null, error: null };
  /** Rebuilt by the viewer once an outfit pass settles (the chains change with the outfit); reset before unpinning. */
  readonly springs = new SpringBones();
  /** The body's ported deformation rig (null for a body without the helper joints); built when the mixer binds. */
  private deform: DeformationRig | null = null;
  /** Run the deformation rig while animating (?deform=0 turns it off, for comparisons). */
  deformEnabled: boolean;
  /** The props emotes spawn (none when the manifest names no props file). */
  readonly props: EmoteProps;
  /** The worn head's facial animation (inert when the manifest names no faces index, or with ?face=0). */
  readonly face: FaceAnimator;
  /** The worn head's skinned sections, head-wrapped parts and the worn items' face masks, set by the viewer. */
  private faceSource: (() => FaceSource) | null = null;
  /** The sounds emotes play (silent when the manifest names no sounds file, or none is passed: automated browsers). */
  readonly sounds: EmoteSounds;

  constructor(readonly manifest: AnimationManifest, private readonly clipBase: string,
    options: { sway?: boolean; deform?: boolean; loopEmote?: boolean; propsUrl?: string | null; facesUrl?: string | null;
      face?: boolean; soundsUrl?: string | null } = {}) {
    this.snapshot.sway = options.sway ?? true;
    this.snapshot.loopEmote = options.loopEmote ?? false;
    this.deformEnabled = options.deform ?? true;
    this.props = new EmoteProps(options.propsUrl ?? null, manifest.attachBones ?? [], manifest.componentSpace ?? null);
    this.face = new FaceAnimator(options.face === false ? null : options.facesUrl ?? null);
    // A head's poses arriving while a frame is held: the next update poses it; the still view must draw that frame again.
    this.face.onReady = () => { if (this.snapshot.paused) this.poseListeners.forEach(listener => listener()); };
    this.sounds = new EmoteSounds(options.soundsUrl ?? null);
  }

  /** Where the worn head comes from (the viewer's rig). */
  setFaceSource(source: (() => FaceSource) | null): void {
    this.faceSource = source;
  }

  /** Bind the worn head for facial animation. Call while its bones are still at rest: as playback starts (play() does)
   *  and once an outfit change during playback has settled, after rememberStillPose. Resolves when its poses are ready. */
  bindFace(): Promise<void> {
    const source = this.faceSource?.();
    return this.face.bind(source?.meshes ?? [], source?.wraps ?? [], source?.masks ?? []);
  }

  /** Turn the facial animation on or off (?face=0 compares); off puts the face back to rest. */
  setFace(on: boolean): void {
    this.face.setEnabled(on);
    if (on) this.runFace();
    if (this.snapshot.paused) this.poseListeners.forEach(listener => listener()); // the held frame changed
  }

  /** Pose the face from the clips the mixer is actually running (a stopped action keeps its last weight: skip it). */
  private runFace(): void {
    if (!this.mixer) return;
    const samples: FaceSample[] = [];
    for (const action of new Set([this.emoteAction, this.idleAction, ...this.fading]))
      if (action && action.enabled && action.isScheduled())
        samples.push({ source: this.info(action.getClip().name)?.source, time: action.time, weight: action.getEffectiveWeight() });
    this.face.apply(samples);
  }

  /** Fetch the props manifest; the state republishes when it arrives (what each emote shows changes). */
  loadProps(): void {
    void Promise.all([this.props.load(), this.sounds.load()]).then(() => this.publish({}));
  }

  /** Turn the deformation rig on or off; off puts its joints back to the still pose. */
  setDeform(on: boolean): void {
    this.deformEnabled = on;
    if (!on) this.deform?.restore();
    else if (this.snapshot.active) this.deform?.apply();
  }

  private runDeform(): void {
    if (this.deformEnabled) this.deform?.apply();
  }

  setSway(on: boolean): void {
    if (!on) this.springs.reset();
    this.publish({ sway: on });
  }

  /** Loop emotes (11 Nov 2026): the emote in front, and every emote after it, repeats until turned off, closed or
   *  replaced. Turned off mid-play, it finishes its current pass and returns to the idle as before. */
  setLoopEmote(on: boolean): void {
    this.publish({ loopEmote: on });
    if (this.emoteAction) this.emoteLoop(this.emoteAction);
  }

  /** A one-shot clip's loop mode. Off: once, clamped on its last frame, so "finished" fires (see onFinished). On: three
   *  wraps the clock past the end and never fires "finished"; the props follow the wrapped time (props.update). */
  private emoteLoop(action: THREE.AnimationAction): void {
    if (this.snapshot.loopEmote) action.setLoop(THREE.LoopRepeat, Infinity);
    else action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }

  get state(): AnimatorState { return this.snapshot; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notified on every state change and whenever a held frame moves (a seek, scrub or step while paused). */
  subscribePose(listener: () => void): () => void {
    const unsubscribe = this.subscribe(listener);
    this.poseListeners.add(listener);
    return () => { unsubscribe(); this.poseListeners.delete(listener); };
  }

  private publish(patch: Partial<AnimatorState>) {
    const next = { ...this.snapshot, ...patch };
    next.active = !!(this.idleAction || this.emoteAction);
    next.moving = next.active && !next.paused;
    next.current = this.emoteAction?.getClip().name ?? this.idleAction?.getClip().name ?? null;
    next.idle = this.idleAction?.getClip().name ?? null;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }

  info(id: string): ClipInfo | undefined { return this.manifest.clips.find(c => c.id === id); }

  /** Seconds per frame of a clip (from its file; 1/30, the exporter's rate, until that has loaded). */
  frameTime(id: string): number { return this.frameTimes.get(id) ?? 1 / 30; }

  /** The clip in front: the emote while one is up, else the idle. */
  private front(): THREE.AnimationAction | null { return this.emoteAction ?? this.idleAction; }

  /** The emote in front and where it is, or null without one (the idle alone has no timeline). */
  timeline(): Timeline | null {
    const action = this.emoteAction;
    if (!this.mixer || !action || this.stopping) return null;
    const clip = action.getClip();
    return { clip: clip.name, time: THREE.MathUtils.clamp(this.pendingScrub ?? action.time, 0, clip.duration),
      duration: clip.duration, frameTime: this.frameTime(clip.name), paused: this.snapshot.paused };
  }

  /** The frame a share records: the emote in front, playing or paused, or the idle when paused on it. Null while the
   *  idle simply plays (the default) or nothing does: the share then shows the still pose, as before poses. */
  sharePose(): PoseCapture | null {
    if (!this.mixer || this.stopping || this.holding) return null;
    const action = this.emoteAction ?? (this.snapshot.paused ? this.idleAction : null);
    if (!action) return null;
    const clip = action.getClip(), frameTime = this.frameTime(clip.name);
    const pose: SharePose = { clip: clip.name, time: THREE.MathUtils.clamp(action.time, 0, clip.duration), paused: this.snapshot.paused };
    return { ...pose, label: this.info(clip.name)?.label ?? clip.name,
      frame: frameAt(pose.time, frameTime), lastFrame: frameAt(clip.duration, frameTime) };
  }

  /** A clip's thumbnail URL, if the set has one. */
  iconUrl(info: ClipInfo): string | null { return info.icon ? this.clipBase + info.icon : null; }

  /** Remember the static pose of bones under `root` not seen before. Call before anything moves them: as playback
   *  starts, and after an outfit change during playback (its new garment bones are still at their authored pose). */
  rememberStillPose(root: THREE.Object3D): void {
    root.traverse(o => {
      if ((o as THREE.Bone).isBone && !this.still.has(o)) this.still.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
    });
  }

  /** Run a synchronous draw with every bone in its static pose, then put the animated pose back. With nothing
   *  playing it just draws. The draw must finish before returning: the next frame re-applies the animation. */
  withStillPose<T>(draw: () => T): T {
    if (!this.snapshot.active || !this.still.size) return draw();
    const live = this.livePose();
    this.applyStill();
    this.props.setHidden(true); // a prop belongs to the emote, not the outfit
    try {
      return draw();
    } finally {
      this.props.setHidden(false);
      restorePose(live);
    }
  }

  /** Hold the static pose over several frames (a multi-frame job such as the 3D export, which bakes the outfit as the
   *  still view shows it): applied at once, re-applied every frame, and the clips' clocks stop until released. Release
   *  puts back the pose from the moment of holding. It must: the mixer only writes a bone when its blended value
   *  changes, so a paused or constant clip would otherwise leave the still pose in place. */
  holdStill(on: boolean): void {
    if (on === this.holding) return;
    this.holding = on;
    this.props.setHidden(on);
    if (on) {
      if (!this.snapshot.active) return;
      this.held = this.livePose();
      this.applyStill();
    } else {
      if (this.held) restorePose(this.held);
      this.held = null;
    }
  }

  private livePose(): PoseRecord {
    return [...this.still.keys()].map(o => [o, o.position.clone(), o.quaternion.clone(), o.scale.clone()] as const);
  }

  private applyStill(): void {
    for (const [o, [p, q, s]] of this.still) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
    this.face.restore(); // the same rest for bones the record has; a head that arrived mid-play may not be in it yet
  }

  private clip(id: string): Promise<THREE.AnimationClip> {
    let pending = this.clips.get(id);
    if (!pending) {
      const info = this.info(id);
      if (!info) return Promise.reject(new Error(`Unknown clip ${id}`));
      let data = this.files.get(info.file);
      if (!data) {
        data = fetch(this.clipBase + info.file).then(async response => {
          if (!response.ok) throw new Error(`Clip ${id} request failed (${response.status})`);
          return await response.json() as ClipData;
        });
        data.catch(() => this.files.delete(info.file)); // a failed download may be retried
        this.files.set(info.file, data);
      }
      // Each id gets its own AnimationClip (cheap: the tracks are rebuilt from the shared data), so the playing
      // clip's name is always the emote that was picked, not whichever emote first downloaded the file.
      pending = data.then(json => {
        const clock = propClock(json);
        if (clock) this.propClocks.set(id, clock);
        if (json.frameTime > 0) this.frameTimes.set(id, json.frameTime);
        return buildClip(json, id);
      });
      pending.catch(() => this.clips.delete(id));
      this.clips.set(id, pending);
    }
    return pending;
  }

  /** Bind to the rig's current body scene. A different body (a reload) drops every action on the old one. */
  private bind(root: THREE.Object3D): THREE.AnimationMixer {
    if (this.mixer && this.root === root) return this.mixer;
    this.reset();
    this.root = root;
    // Prop attach bones first: the mixer resolves each track's target node by name once, when an action binds.
    this.props.attach(root);
    this.mixer = new THREE.AnimationMixer(root);
    // Built before anything moves: it keeps the still pose of the joints it drives, to restore them exactly.
    this.deform = DeformationRig.find(root);
    this.mixer.addEventListener("finished", this.onFinished);
    return this.mixer;
  }

  private onFinished = (event: { action: THREE.AnimationAction }) => {
    // Not an end: a preroll inside hold() touching the last frame, or an emote fading out under stop().
    if (event.action !== this.emoteAction || this.seeking || this.stopping) return;
    if (this.inspecting) {
      // Being studied: stay on the last frame, paused (three set its own flag at the clamp; ours is the timeScale). Its
      // sounds end as at a natural end (the pause that follows does not cut them).
      event.action.paused = false;
      this.mixer!.timeScale = 0;
      this.sounds.release();
      this.publish({ paused: true });
      return;
    }
    this.returnFromEmote(true);
    this.publish({});
  };

  /** The emote in front ends: back to the idle when one plays (or ran under it), else to the static pose. `natural`: it
   *  played to its end, so its sounds end as in the game; closed by the viewer, they fade out. */
  private returnFromEmote(natural = false): void {
    const ended = this.emoteAction;
    if (!ended) return;
    this.emoteAction = null;
    this.inspecting = false;
    this.pendingScrub = null;
    this.props.setEmote(null);
    this.sounds.setEmote(null, { ringOut: natural });
    ended.paused = true; // its frame holds while it fades out (the fade runs on the mixer's clock, not the action's)
    if (this.idleAction) {
      this.idleAction.enabled = true;
      this.idleAction.setEffectiveWeight(1);
      // Keep the idle starting from its own first frame, as the game re-enters it.
      ended.crossFadeTo(this.idleAction.reset().play(), FADE, false);
      this.fading.add(ended);
    } else {
      ended.fadeOut(FADE);
      this.stopping = true;
    }
  }

  /** The viewer leaves the emote (the timeline's close button): as if it had ended. */
  leaveEmote(): void {
    if (!this.mixer || !this.emoteAction) return;
    ++this.request;
    this.returnFromEmote();
    this.mixer.timeScale = 1;
    this.publish({ paused: false, loading: null });
  }

  /** Play an idle (loops, becomes the resting motion) or a one-shot emote/reaction (returns to the idle after). */
  async play(root: THREE.Object3D, id: string): Promise<void> {
    const info = this.info(id);
    if (!info) throw new Error(`Unknown clip ${id}`);
    const request = ++this.request;
    this.publish({ loading: id, error: null });
    // The face too (its curves and the worn head's poses; a failure leaves the face at rest): a held frame must not
    // change when they arrive late. Bound now, while the head is at rest or already bound.
    const face = Promise.all([this.bindFace(), this.face.prepareClip(info.source)]);
    let clip: THREE.AnimationClip;
    try {
      // An emote waits for its props and sounds too (a failed one stays hidden or silent): they must not come in late.
      [clip] = await Promise.all([this.clip(id), info.loop ? undefined : this.props.prepare(info.source).catch(() => undefined),
        info.loop ? undefined : this.sounds.prepare(info.source).catch(() => undefined), face]);
    } catch (error) {
      if (request === this.request) this.publish({ loading: null, error: `Couldn’t load ${info.label}` });
      throw error;
    }
    if (request !== this.request) return; // superseded while downloading
    const mixer = this.bind(root);
    this.inspecting = false;
    this.pendingScrub = null;
    if (!this.snapshot.active) { this.still.clear(); this.rememberStillPose(root); } // nothing applied yet: static
    const action = mixer.clipAction(clip);
    this.fading.delete(action); // picked again while it faded out: it is the incoming action now
    action.enabled = true;
    action.setEffectiveTimeScale(1).setEffectiveWeight(1);
    this.stopping = false;
    if (info.loop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      const previous = this.emoteAction ?? this.idleAction;
      if (previous === action) { this.publish({ loading: null, paused: false }); mixer.timeScale = 1; return; }
      action.reset().play();
      if (previous) { previous.crossFadeTo(action, FADE, false); this.fading.add(previous); } else action.fadeIn(FADE);
      if (this.idleAction && this.idleAction !== action && this.idleAction !== previous) {
        this.idleAction.fadeOut(FADE);
        this.fading.add(this.idleAction);
      }
      this.emoteAction = null;
      this.idleAction = action;
      this.props.setEmote(null);
      this.sounds.setEmote(null);
    } else {
      this.emoteLoop(action);
      const previous = this.emoteAction ?? this.idleAction;
      action.reset().play();
      if (previous && previous !== action) previous.crossFadeTo(action, FADE, false); else if (!previous) action.fadeIn(FADE);
      // A replaced emote is done; the idle stays, faded under the emote, to come back when it ends.
      if (this.emoteAction && this.emoteAction !== action) this.fading.add(this.emoteAction);
      this.emoteAction = action;
      this.props.setEmote(info.source, this.propClocks.get(id) ?? null);
      this.props.update(0);
      this.sounds.setEmote(info.source);
    }
    mixer.timeScale = 1;
    this.publish({ loading: null, paused: false });
  }

  /** Fade back to the static pose. */
  stop(): void {
    ++this.request;
    this.inspecting = false;
    this.pendingScrub = null;
    if (!this.mixer) return;
    for (const action of [this.emoteAction, this.idleAction]) action?.fadeOut(FADE);
    this.props.setEmote(null);
    this.sounds.setEmote(null);
    this.mixer.timeScale = 1;
    this.stopping = true;
    this.publish({ paused: false, loading: null });
  }

  /** Pause or resume. A pause is a hold of the frame on screen (see the top of this file); pausing an emote marks it
   *  inspected. Resuming an emote that sits on its last frame plays it again from the start. */
  setPaused(paused: boolean): void {
    const action = this.front();
    if (!this.mixer || !this.snapshot.active || !action || this.stopping) return;
    if (paused) {
      if (action === this.emoteAction) this.inspecting = true;
      this.hold(action.time, false); // no preroll: the chains keep the swing they have
      return;
    }
    this.pendingScrub = null;
    if (action === this.emoteAction && action.time >= action.getClip().duration - 1e-4) action.reset(); // still scheduled
    action.paused = false;
    this.mixer.timeScale = 1;
    this.publish({ paused: false });
  }

  /** Hold the clip in front at a time (seconds), paused. `preroll` (default on): with sway on, the last 1.5 s are
   *  played through first at 60 Hz so the chains carry the motion leading into that frame. `inspect`: the viewer's
   *  own seek (the timeline), which keeps an emote on its last frame at its end. Captures and links leave it off. */
  seek(seconds: number, options: { preroll?: boolean; inspect?: boolean } = {}): void {
    if (options.inspect && this.emoteAction) this.inspecting = true;
    this.hold(seconds, options.preroll ?? true);
  }

  /** A timeline drag: the latest time is held on the next frame without the preroll (one hold per frame, however
   *  many input events arrive). A seek on release settles the chains. */
  scrub(seconds: number): void {
    if (!this.emoteAction) return;
    this.inspecting = true;
    this.pendingScrub = seconds;
    this.poseListeners.forEach(listener => listener());
  }

  /** Step whole frames from the frame on screen (between two frames, one step reaches the next boundary), paused. */
  step(frames: number): void {
    const action = this.front();
    if (!this.mixer || !action || !frames) return;
    const clip = action.getClip(), frameTime = this.frameTime(clip.name);
    const at = (this.pendingScrub ?? action.time) / frameTime;
    const frame = frames > 0 ? Math.floor(at + 1e-3) + frames : Math.ceil(at - 1e-3) + frames;
    this.seek(THREE.MathUtils.clamp(frame * frameTime, 0, clip.duration), { inspect: true });
  }

  private hold(seconds: number, preroll: boolean): void {
    const action = this.front();
    if (!this.mixer || !action) return;
    this.pendingScrub = null;
    this.sounds.cut(); // every pause, seek, scrub and step comes through here: silent at once, not a frame later
    for (const other of [this.emoteAction, this.idleAction, ...this.fading]) if (other && other !== action) other.stop();
    this.fading.clear();
    action.enabled = true;
    action.stopFading().setEffectiveWeight(1);
    const target = Math.max(0, Math.min(seconds, action.getClip().duration));
    const lead = preroll && this.snapshot.sway && this.springs.count ? Math.min(1.5, target) : 0;
    this.seeking = true;
    try {
      action.time = target - lead;
      action.paused = false;
      this.mixer.timeScale = 1;
      this.mixer.update(0);
      this.runDeform();
      for (let t = 0; t < lead - 1e-6; t += 1 / 60) {
        const step = Math.min(1 / 60, lead - t);
        this.mixer.update(step);
        this.runDeform();
        this.springs.update(step);
      }
      action.time = target; // exact, whatever rounding the steps left
      action.paused = false; // three sets it if the lead touched the end of a one-shot
      this.mixer.timeScale = 0;
      this.mixer.update(0);
      this.runDeform();
      this.runFace();
    } finally {
      this.seeking = false;
    }
    this.props.update(action === this.emoteAction ? action.time : null);
    if (this.snapshot.paused) this.poseListeners.forEach(listener => listener());
    else this.publish({ paused: true });
  }

  /** Open a shared pose (lib/share-pose.ts): its clip at its time, held there or playing on. `idle`, for an emote:
   *  the idle to start under it first when none runs (it comes back when the emote ends). Resolves false when the
   *  clip is unknown or the viewer picked something else meanwhile. */
  async openPose(root: THREE.Object3D, pose: SharePose, options: { idle?: string | null; play?: boolean } = {}): Promise<boolean> {
    const info = this.info(pose.clip);
    if (!info) return false;
    if (options.idle && !info.loop && !this.idleAction && this.info(options.idle)) {
      await this.play(root, options.idle);
      if (this.snapshot.idle !== options.idle) return false;
    }
    await this.play(root, pose.clip);
    if (this.front()?.getClip().name !== pose.clip) return false; // superseded: never seek what the viewer chose
    // A link's milliseconds name a frame: land on it exactly (1.233 s at 30 fps is frame 37, 1.2333... s).
    const frameTime = this.frameTime(pose.clip), frames = pose.time / frameTime;
    const time = Math.abs(frames - Math.round(frames)) < 0.02 ? Math.round(frames) * frameTime : pose.time;
    this.seek(time, { inspect: pose.paused });
    if (!pose.paused && options.play !== false) this.setPaused(false);
    return true;
  }

  update(delta: number): void {
    if (!this.mixer) return;
    if (this.holding) { if (this.snapshot.active) this.applyStill(); this.sounds.update(null, false); return; }
    if (this.pendingScrub !== null) this.hold(this.pendingScrub, false);
    const step = Math.min(delta, 0.1); // a hidden tab must not jump half an emote
    this.mixer.update(step);
    this.runDeform();
    this.runFace();
    this.props.update(this.emoteAction ? this.emoteAction.time : null);
    this.updateSounds();
    for (const action of this.fading) {
      if (action === this.emoteAction || action === this.idleAction) this.fading.delete(action);
      else if (action.getEffectiveWeight() <= 0 || !action.isScheduled()) { action.stop(); this.fading.delete(action); }
    }
    if (this.snapshot.sway && this.snapshot.moving) this.springs.update(step);
    if (this.stopping) {
      // Every action has faded to zero weight: deactivate them so three restores the static pose exactly.
      const live = [this.emoteAction, this.idleAction].filter((a): a is THREE.AnimationAction => !!a);
      if (live.every(action => action.getEffectiveWeight() <= 0 || !action.isScheduled())) {
        this.mixer.stopAllAction();
        this.fading.clear();
        this.deform?.restore(); // the mixer restores the bones it animated; the rig's joints are put back here
        this.face.restore(); // and the face's bones (before the viewer unpins a legacy head's branches)
        this.springs.reset(); // before the viewer unpins legacy branches (it reacts to the state published below)
        this.emoteAction = this.idleAction = null;
        this.still.clear();
        this.stopping = false;
        this.publish({ paused: false });
      }
    }
  }

  /** The emote's clock for its sounds, advancing only while it plays (paused, held by a seek or scrubbed: silent). */
  private updateSounds(): void {
    const emote = this.emoteAction;
    const clock = emote && !this.stopping
      ? { time: emote.time, duration: emote.getClip().duration, looping: emote.loop === THREE.LoopRepeat } : null;
    this.sounds.update(clock, !!clock && this.snapshot.moving && this.mixer!.timeScale > 0 && !this.scrubbing);
  }

  /** Drop every action now (no fade): the body is being replaced or the viewer unmounts. */
  reset(): void {
    this.springs.reset();
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.removeEventListener("finished", this.onFinished);
      if (this.root) this.mixer.uncacheRoot(this.root);
    }
    this.deform?.restore();
    this.deform = null;
    this.face.restore(); // the binding stays: the viewer binds again once a new outfit has settled
    this.props.detach();
    this.sounds.setEmote(null);
    this.mixer = null;
    this.root = null;
    this.idleAction = this.emoteAction = null;
    this.fading.clear();
    this.stopping = false;
    this.inspecting = false;
    this.seeking = false;
    this.pendingScrub = null;
    this.still.clear();
    this.held = null; // a new body: the old bones' poses mean nothing (a running hold stays, as its owner expects)
    if (this.snapshot.active || this.snapshot.paused) this.publish({ paused: false });
  }
}
