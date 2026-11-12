import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { CharacterRig } from "../rig/CharacterRig";
import { initialClip, loadAnimationManifest, RigAnimator, type AnimatorState } from "../rig/RigAnimator";
import { AUTOMATED } from "../lib/automation";
import { pendingPose, subscribePendingPose, takePendingPose } from "../lib/share-pose";
import { setPoseSource } from "../lib/viewer-handle";
import { EmotePicker, missingSummary } from "./EmotePicker";
import { EmoteSoundControl } from "./EmoteSoundControl";

// Showcase animation UI (5 Nov 2026): Animate / Static toggle, pause, and the emote picker (EmotePicker.tsx: every
// emote with its icon, plus outfit-screen reactions and idles). Hidden unless the deployment publishes a clip manifest
// (animations/manifest.json).
//
// The outfit-screen idle plays by default once the first outfit has loaded (the user's call, 5 Nov). It stays still
// when the viewer last chose the still pose (remembered in this browser), when the system asks for reduced motion, and
// in automated browsers: the visual-diff, probe and audit harnesses compare still-pose captures.
//
// URL switches for captures and reviews: ?anim=<clip id> starts that clip once the outfit has loaded, and
// &animTime=<seconds> then holds it at that time, paused (a deterministic mid-motion frame); ?anim=0 opens still;
// ?sway=0 starts with the approximate secondary motion off; ?deform=0 leaves the twist/volume joints at rest (the
// game's deformation rig off, for comparisons).
//
// Share links can carry a pose (10 Nov 2026, lib/share-pose.ts: &emote=<clip>&t=<s>[&paused=1]). The builder hands it
// over before the link is tidied away; it is applied here once the outfit has loaded, instead of the default idle,
// and wins over ?anim=. A paused pose holds its frame; one without paused plays on from it (held still for reduced
// motion and automated browsers). The pose on screen is published for the Share button (lib/viewer-handle.ts).

// Per-viewer convenience: "still" after the viewer stops the idle, removed when they start it again. Storage can be
// missing or blocked (private windows, previews): every access is guarded and the default then applies.
const MOTION_KEY = "finals-outfit.motion";
function savedStill(): boolean {
  try { return window.localStorage.getItem(MOTION_KEY) === "still"; } catch { return false; }
}
function saveMotion(still: boolean): void {
  try {
    if (still) window.localStorage.setItem(MOTION_KEY, "still"); else window.localStorage.removeItem(MOTION_KEY);
  } catch { /* the choice just is not remembered */ }
}

// The timeline's Loop toggle (11 Nov 2026), remembered the same way: "1" while on. Automated browsers ignore it, so
// scripted captures always see an emote end and return to the idle.
const LOOP_KEY = "finals-outfit.emote-loop";
function savedLoop(): boolean {
  if (AUTOMATED) return false;
  try { return window.localStorage.getItem(LOOP_KEY) === "1"; } catch { return false; }
}
/** The viewer's Loop click: loop emotes (or stop looping) and remember it for the next visit. */
export function setEmoteLoop(animator: RigAnimator, on: boolean): void {
  animator.setLoopEmote(on);
  try {
    if (on) window.localStorage.setItem(LOOP_KEY, "1"); else window.localStorage.removeItem(LOOP_KEY);
  } catch { /* the choice just is not remembered */ }
}

const IDLE_STATE: AnimatorState = { active: false, moving: false, paused: false, sway: true, loopEmote: false, idle: null, current: null, loading: null, error: null };

/** The animator, once this deployment's clip manifest has loaded (null: no clips published, or still loading). */
export function useRigAnimator(): RigAnimator | null {
  const [animator, setAnimator] = useState<RigAnimator | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadAnimationManifest().then(loaded => {
      const params = new URLSearchParams(window.location.search);
      // Automated browsers get no sounds at all (no audio device, no downloads): captures stay silent and deterministic.
      if (!cancelled && loaded) setAnimator(new RigAnimator(loaded.manifest, loaded.clipBase,
        { sway: params.get("sway") !== "0", deform: params.get("deform") !== "0", loopEmote: savedLoop(), propsUrl: loaded.propsUrl,
          soundsUrl: AUTOMATED ? null : loaded.soundsUrl }));
    }).catch(error => console.warn("[animation] manifest unavailable", error));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => { animator?.reset(); animator?.sounds.dispose(); }, [animator]);
  return animator;
}

export function useAnimatorState(animator: RigAnimator | null): AnimatorState {
  return useSyncExternalStore(
    listener => animator?.subscribe(listener) ?? (() => {}),
    () => animator?.state ?? IDLE_STATE,
  );
}

/**
 * Capture clock for test rigs (6 Nov 2026), reached through window.__rigAnim.clock. `fixed` replaces each frame's
 * real time step with a fixed one, so a run plays the same poses on every machine and at any frame rate. `steps` counts
 * the animator updates. Once `steps` reaches `freezeAt` the animation holds (no further updates) and the view counts as
 * still, so the still path converges on exactly that pose: a ground-truth frame to score the moving frames against.
 * The defaults (real time, never frozen) leave the app unchanged.
 */
export const frameClock = { fixed: null as number | null, freezeAt: Infinity, steps: 0, frozenMoving: false };
export const clockFrozen = () => frameClock.steps >= frameClock.freezeAt;
/** Frozen but still drawn as moving (`frozenMoving`): what the moving view converges to on a pose that holds. */
export const clockHeldStill = () => clockFrozen() && !frameClock.frozenMoving;

// Orbiting the camera counts as turning the character for the sway springs (SpringBones.turn), as the game turns
// the character itself. A jump larger than this in one frame is a camera reset, not a turn; a fast flick is capped.
const TELEPORT = 0.6, MAX_TURN = 0.15; // radians per frame

/** Canvas child: advances the mixer each frame, before the priority-1 still-view render draws it. */
export function AnimationFrameDriver({ animator }: { animator: RigAnimator }) {
  const lastAzimuth = useRef<number | null>(null);
  useFrame(({ camera, controls }, delta) => {
    if (clockFrozen()) return;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const azimuth = Math.atan2(camera.position.x - (target?.x ?? 0), camera.position.z - (target?.z ?? 0));
    const last = lastAzimuth.current;
    lastAzimuth.current = azimuth;
    if (last !== null && animator.state.sway && animator.state.moving) {
      const change = Math.atan2(Math.sin(azimuth - last), Math.cos(azimuth - last)); // wrapped to (-pi, pi]
      if (Math.abs(change) < TELEPORT) animator.springs.turn(THREE.MathUtils.clamp(change, -MAX_TURN, MAX_TURN));
    }
    animator.update(frameClock.fixed ?? delta);
    frameClock.steps++;
  });
  return null;
}

/** Overlay controls, plus the rig-side bookkeeping (bone pins for legacy statics) that follows the animator. */
export function AnimationControls({ animator, rig, ready, busy, studio }: {
  animator: RigAnimator; rig: CharacterRig; ready: boolean; busy: boolean; studio: boolean;
}) {
  const state = useAnimatorState(animator);
  // While anything plays: pin legacy root-level statics and stranded legacy bone branches to the driver, then collect
  // the jiggle chains for sway. A finished outfit pass may have added new ones. (The animator resets the springs
  // itself before it publishes "inactive", so a swung chain is never unpinned mid-swing.)
  useEffect(() => {
    if (!ready || busy) return;
    rig.setAnimationPins(state.active);
    const root = rig.animationRoot();
    if (state.active && root) animator.rememberStillPose(root); // bones a mid-playback outfit change added
    if (state.active && state.sway) {
      animator.springs.rebuild(root);
      // Paused: the rebuilt chains hang at rest. Hold the same frame again, with the preroll, so they carry the
      // motion leading into it (also settles a link's pose that arrived while its outfit was still changing).
      if (animator.state.paused) {
        const at = animator.timeline()?.time ?? animator.sharePose()?.time;
        if (at !== undefined) animator.seek(at);
      }
    }
  }, [animator, rig, ready, busy, state.active, state.sway]);
  useEffect(() => () => { animator.springs.reset(); rig.setAnimationPins(false); }, [animator, rig]);
  const prepare = (root: THREE.Object3D) => {
    rig.setAnimationPins(true);
    if (animator.state.sway) animator.springs.rebuild(root);
  };

  // The first motion once the outfit has loaded: a link's pose, else the default idle (see the top of this file) or
  // ?anim=<id>&animTime=<s>. One effect decides, so the two can never both start. A pose arriving later (a link opened
  // inside the app) is applied the same way. window.__rigAnim is for scripted captures.
  const started = useRef(false);
  const linkPose = useSyncExternalStore(subscribePendingPose, pendingPose);
  useEffect(() => {
    if (!ready || busy) return;
    const pose = takePendingPose();
    if (pose && !animator.info(pose.clip)) console.warn(`[animation] the link's pose names an unknown clip "${pose.clip}"`);
    const posed = pose && animator.info(pose.clip) ? pose : null;
    if (!posed && started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = initialClip({ anim: params.get("anim"), defaultIdle: animator.manifest.defaultIdle, automated: AUTOMATED,
      reducedMotion, savedStill: savedStill() });
    const root = rig.animationRoot();
    if (!root) return;
    if (posed) {
      prepare(root);
      // The idle runs under an emote when the viewer would be animating anyway, so it comes back when the emote ends.
      animator.openPose(root, posed, { idle: id === animator.manifest.defaultIdle ? id : null, play: !reducedMotion && !AUTOMATED })
        .catch(error => console.error(error));
      return;
    }
    const time = Number(params.get("animTime"));
    if (!id || !animator.info(id)) return;
    prepare(root);
    animator.play(root, id).then(() => { if (params.has("animTime") && Number.isFinite(time)) animator.seek(time); })
      .catch(error => console.error(error));
  }, [animator, rig, ready, busy, linkPose]);
  // The frame on screen, for the Share button (outside the canvas).
  useEffect(() => {
    setPoseSource({ capture: () => animator.sharePose(), subscribe: listener => animator.subscribePose(listener) });
    return () => setPoseSource(null);
  }, [animator]);
  useEffect(() => {
    const host = window as unknown as { __rigAnim?: unknown };
    host.__rigAnim = {
      animator,
      play: async (id: string, time?: number) => {
        const root = rig.animationRoot();
        if (!root) throw new Error("Body not loaded");
        prepare(root);
        await animator.play(root, id);
        if (time !== undefined) animator.seek(time);
      },
      seek: (time: number) => animator.seek(time),
      stop: () => animator.stop(),
      sway: (on: boolean) => animator.setSway(on),
      deform: (on: boolean) => animator.setDeform(on),
      state: () => animator.state,
      clock: frameClock,
    };
    return () => { delete host.__rigAnim; };
  }, [animator, rig]);

  // The viewer's own clicks: remember still vs. animated for the next visit.
  const play = (id: string) => {
    const root = rig.animationRoot();
    if (!root) return;
    // Starting an idle loop means "animated"; an emote from the still pose returns to it, so it changes nothing.
    if (animator.info(id)?.loop) saveMotion(false);
    prepare(root);
    animator.play(root, id).catch(error => console.error(error));
  };
  const stop = () => { saveMotion(true); animator.stop(); };
  const [picking, setPicking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const closePicker = () => { setPicking(false); trigger.current?.focus({ preventScroll: true }); };
  const disabled = !ready;
  const button = "hud flex h-8 items-center gap-2 bg-ink-950/80 px-3 text-fg transition-colors hover:bg-ink-950 disabled:opacity-50";
  const loadingLabel = state.loading ? animator.info(state.loading)?.label : null;
  const emote = state.current && state.current !== state.idle ? animator.info(state.current) : undefined;
  const emoteIcon = emote ? animator.iconUrl(emote) : null;
  // Said while it plays, whether or not the picker is open: the preview shows the body only.
  const missing = state.moving && emote ? missingSummary(emote, animator.props) : null;

  return (
    <div ref={controls} className="flex min-h-0 flex-col items-end gap-1.5">
      <div className="flex gap-1.5">
        {emote && animator.sounds.hasSound(emote.source) && <EmoteSoundControl sounds={animator.sounds} />}
        {state.active && (
          <button type="button" className={button} disabled={disabled}
            aria-pressed={state.paused} title={state.paused ? "Resume the animation" : "Freeze this frame"}
            onClick={() => animator.setPaused(!state.paused)}>
            <span aria-hidden="true">{state.paused ? "▶" : "❚❚"}</span>
            {state.paused ? "Resume" : "Pause"}
          </button>
        )}
        <button type="button" className={button} disabled={disabled}
          aria-pressed={state.active}
          title={state.active ? "Return to the still pose" : "Play the outfit-screen idle"}
          onClick={() => state.active ? stop() : play(animator.manifest.defaultIdle)}>
          <span aria-hidden="true" className={`size-2.5 ${state.active ? "bg-finals" : "border border-fg/60"}`} />
          {state.active ? "Animated" : "Animate"}
        </button>
      </div>
      <button ref={trigger} type="button" className={`${button} max-w-44`} disabled={disabled}
        aria-expanded={picking} aria-haspopup="dialog" title="Play an emote"
        onClick={() => picking ? closePicker() : setPicking(true)}>
        {emoteIcon
          ? <img src={emoteIcon} alt="" width={20} height={20} className="-ml-1.5 size-5 object-cover" />
          : <span aria-hidden="true" className="text-[11px] leading-none">☺</span>}
        <span className="truncate">{emote ? emote.label : "Emotes"}</span>
      </button>
      {picking && <EmotePicker animator={animator} state={state} onPlay={play} onClose={closePicker}
        anchor={controls.current?.closest<HTMLElement>("[data-viewer]") ?? null} />}
      {missing && !picking && (
        <span className={`hud max-w-56 px-1 text-right normal-case tracking-[0.04em] ${studio ? "text-ink-700" : "text-fg-muted"}`}>{missing}</span>
      )}
      {state.active && (
        <button type="button" className={`${button} h-7 px-2.5 text-fg-muted`} aria-pressed={state.sway}
          title="Approximate sway for tails, ponytails, skirt panels and charms: generic spring bones, not the game's own physics. Long coats and capes stay rigid (the game simulates them as cloth)."
          onClick={() => animator.setSway(!state.sway)}>
          <span aria-hidden="true" className={`size-2 ${state.sway ? "bg-fg-muted" : "border border-fg/50"}`} />
          Sway · approx.
        </button>
      )}
      {(loadingLabel || state.error) && (
        <span role="status" className={`hud px-1 ${studio ? "text-ink-700" : "text-fg-muted"}`}>
          {state.error ?? `Loading ${loadingLabel}…`}
        </span>
      )}
    </div>
  );
}
