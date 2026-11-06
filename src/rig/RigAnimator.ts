import * as THREE from "three";
import { DeformationRig } from "./DeformationRig";
import { EmoteProps, type AttachBone, type ComponentSpace } from "./EmoteProps";
import { SpringBones } from "./SpringBones";

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
// Emote props (EmoteProps.ts) appear on their sockets in the windows the emote's notifies give.
//
// What this does NOT animate (known gaps, see _docs/showcase-animation-2026-11-05/README.md): cloth simulation
// (coat tails, capes, loose straps stay rigid on their bones), facial curves (Face_* expression curves are recorded in
// each clip, not played), effects (Niagara), skeletal props' own animation, and props tied to a worn cosmetic.

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

export interface AnimationManifest {
  formatVersion: 1;
  base?: string; // set directory the clip files live in, relative to the manifest
  defaultIdle: string;
  rarityOrder?: string[];
  clips: ClipInfo[];
  /** Emote props manifest (build-props.mjs), relative to the manifest. */
  props?: string;
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

export interface AnimatorState {
  /** An idle or emote is applied to the skeleton (including while fading back to the static pose). */
  active: boolean;
  /** The pose changes from frame to frame (active and not paused). */
  moving: boolean;
  paused: boolean;
  /** Approximate secondary motion on garment jiggle chains (SpringBones.ts) while the pose moves. */
  sway: boolean;
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
export async function loadAnimationManifest(base = animationsBaseUrl()): Promise<{ manifest: AnimationManifest; clipBase: string; propsUrl: string | null } | null> {
  let response: Response;
  try { response = await fetch(`${base}manifest.json`); } catch { return null; }
  if (!response.ok) return null;
  let manifest: AnimationManifest;
  try { manifest = await response.json(); } catch { return null; } // an SPA fallback page: no clips published
  if (manifest?.formatVersion !== 1 || !Array.isArray(manifest.clips) || !manifest.clips.length) return null;
  return { manifest, clipBase: base + (manifest.base ?? ""), propsUrl: manifest.props ? base + manifest.props : null };
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
  private idleAction: THREE.AnimationAction | null = null;
  private emoteAction: THREE.AnimationAction | null = null;
  // Actions replaced mid-play (an emote picked during another, an idle swapped): still fading out, owned by neither
  // slot. Each is stopped once its weight reaches zero; three would otherwise keep it active (disabled, but bound and
  // ticked every frame) for good, one more per emote clicked, and a frozen seek would show it at its frozen weight.
  private fading = new Set<THREE.AnimationAction>();
  private stopping = false;
  private request = 0; // latest play/stop wins when clip downloads overlap
  private listeners = new Set<() => void>();
  // The static pose of every bone, captured as playback starts (and for bones an outfit change adds while it plays),
  // so a still render (the share card, an export) can be drawn mid-animation. Cleared once the pose is static again.
  private still = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion, THREE.Vector3]>();
  private holding = false;
  private held: PoseRecord | null = null;
  private snapshot: AnimatorState = { active: false, moving: false, paused: false, sway: true, idle: null, current: null, loading: null, error: null };
  /** Rebuilt by the viewer once an outfit pass settles (the chains change with the outfit); reset before unpinning. */
  readonly springs = new SpringBones();
  /** The body's ported deformation rig (null for a body without the helper joints); built when the mixer binds. */
  private deform: DeformationRig | null = null;
  /** Run the deformation rig while animating (?deform=0 turns it off, for comparisons). */
  deformEnabled: boolean;
  /** The props emotes spawn (none when the manifest names no props file). */
  readonly props: EmoteProps;

  constructor(readonly manifest: AnimationManifest, private readonly clipBase: string,
    options: { sway?: boolean; deform?: boolean; propsUrl?: string | null } = {}) {
    this.snapshot.sway = options.sway ?? true;
    this.deformEnabled = options.deform ?? true;
    this.props = new EmoteProps(options.propsUrl ?? null, manifest.attachBones ?? [], manifest.componentSpace ?? null);
  }

  /** Fetch the props manifest; the state republishes when it arrives (what each emote shows changes). */
  loadProps(): void {
    void this.props.load().then(() => this.publish({}));
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

  get state(): AnimatorState { return this.snapshot; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    if (event.action !== this.emoteAction) return;
    // An emote ends: return to the idle when one plays, else to the static pose.
    const ended = this.emoteAction;
    this.emoteAction = null;
    this.props.setEmote(null);
    if (this.idleAction) {
      this.idleAction.enabled = true;
      this.idleAction.setEffectiveWeight(1);
      ended.crossFadeTo(this.idleAction.reset().play(), FADE, false);
      this.fading.add(ended);
      // Keep the idle starting from its own first frame, as the game re-enters it.
    } else {
      ended.fadeOut(FADE);
      this.stopping = true;
    }
    this.publish({});
  };

  /** Play an idle (loops, becomes the resting motion) or a one-shot emote/reaction (returns to the idle after). */
  async play(root: THREE.Object3D, id: string): Promise<void> {
    const info = this.info(id);
    if (!info) throw new Error(`Unknown clip ${id}`);
    const request = ++this.request;
    this.publish({ loading: id, error: null });
    let clip: THREE.AnimationClip;
    try {
      // An emote waits for its props too (a failed prop just stays hidden): they must not pop in late.
      [clip] = await Promise.all([this.clip(id), info.loop ? undefined : this.props.prepare(info.source).catch(() => undefined)]);
    } catch (error) {
      if (request === this.request) this.publish({ loading: null, error: `Couldn’t load ${info.label}` });
      throw error;
    }
    if (request !== this.request) return; // superseded while downloading
    const mixer = this.bind(root);
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
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      const previous = this.emoteAction ?? this.idleAction;
      action.reset().play();
      if (previous && previous !== action) previous.crossFadeTo(action, FADE, false); else if (!previous) action.fadeIn(FADE);
      // A replaced emote is done; the idle stays, faded under the emote, to come back when it ends.
      if (this.emoteAction && this.emoteAction !== action) this.fading.add(this.emoteAction);
      this.emoteAction = action;
      this.props.setEmote(info.source, this.propClocks.get(id) ?? null);
      this.props.update(0);
    }
    mixer.timeScale = 1;
    this.publish({ loading: null, paused: false });
  }

  /** Fade back to the static pose. */
  stop(): void {
    ++this.request;
    if (!this.mixer) return;
    for (const action of [this.emoteAction, this.idleAction]) action?.fadeOut(FADE);
    this.props.setEmote(null);
    this.mixer.timeScale = 1;
    this.stopping = true;
    this.publish({ paused: false, loading: null });
  }

  setPaused(paused: boolean): void {
    if (!this.mixer || !this.snapshot.active) return;
    this.mixer.timeScale = paused ? 0 : 1;
    this.publish({ paused });
  }

  /** Capture/test hook: hold the current clip at an exact time (seconds), paused. With sway on, the last 1.5 s are
   *  played through first at 60 Hz so the chains carry the motion that leads into that frame. */
  seek(seconds: number): void {
    const action = this.emoteAction ?? this.idleAction;
    if (!this.mixer || !action) return;
    for (const other of [this.emoteAction, this.idleAction, ...this.fading]) if (other && other !== action) other.stop();
    this.fading.clear();
    action.stopFading().setEffectiveWeight(1);
    const target = Math.max(0, Math.min(seconds, action.getClip().duration));
    const preroll = this.snapshot.sway && this.springs.count ? Math.min(1.5, target) : 0;
    action.time = target - preroll;
    action.paused = false;
    this.mixer.timeScale = 1;
    this.mixer.update(0);
    this.runDeform();
    for (let t = 0; t < preroll - 1e-6; t += 1 / 60) {
      const step = Math.min(1 / 60, preroll - t);
      this.mixer.update(step);
      this.runDeform();
      this.springs.update(step);
    }
    action.time = target; // exact, whatever rounding the steps left
    this.mixer.timeScale = 0;
    this.mixer.update(0);
    this.runDeform();
    this.props.update(action === this.emoteAction ? action.time : null);
    this.publish({ paused: true });
  }

  update(delta: number): void {
    if (!this.mixer) return;
    if (this.holding) { if (this.snapshot.active) this.applyStill(); return; }
    const step = Math.min(delta, 0.1); // a hidden tab must not jump half an emote
    this.mixer.update(step);
    this.runDeform();
    this.props.update(this.emoteAction ? this.emoteAction.time : null);
    for (const action of this.fading) {
      if (action === this.emoteAction || action === this.idleAction) this.fading.delete(action);
      else if (action.getEffectiveWeight() <= 0 || !action.isRunning()) { action.stop(); this.fading.delete(action); }
    }
    if (this.snapshot.sway && this.snapshot.moving) this.springs.update(step);
    if (this.stopping) {
      // Every action has faded to zero weight: deactivate them so three restores the static pose exactly.
      const live = [this.emoteAction, this.idleAction].filter((a): a is THREE.AnimationAction => !!a);
      if (live.every(action => action.getEffectiveWeight() <= 0 || !action.isRunning())) {
        this.mixer.stopAllAction();
        this.fading.clear();
        this.deform?.restore(); // the mixer restores the bones it animated; the rig's joints are put back here
        this.springs.reset(); // before the viewer unpins legacy branches (it reacts to the state published below)
        this.emoteAction = this.idleAction = null;
        this.still.clear();
        this.stopping = false;
        this.publish({ paused: false });
      }
    }
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
    this.props.detach();
    this.mixer = null;
    this.root = null;
    this.idleAction = this.emoteAction = null;
    this.fading.clear();
    this.stopping = false;
    this.still.clear();
    this.held = null; // a new body: the old bones' poses mean nothing (a running hold stays, as its owner expects)
    if (this.snapshot.active || this.snapshot.paused) this.publish({ paused: false });
  }
}
