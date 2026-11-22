import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { CharacterRig } from "../rig/CharacterRig";
import { loadAnimationManifest, RigAnimator, type ClipFileCache } from "../rig/RigAnimator";
import { AUTOMATED } from "../lib/automation";
import { frameClock, clockFrozen } from "../lib/frame-clock";
import { useAnimationBinding, useAnimatorState } from "./useAnimationBinding";
import { EmotePicker, missingSummary } from "./EmotePicker";
import { EmoteSoundControl } from "./EmoteSoundControl";
import { EmoteSpeedControl } from "./EmoteSpeedControl";
import { savedFace, savedSpeed, setFacialAnimation } from "../lib/emote-playback";

// Showcase animation UI (5 Nov 2026): Animate / Static toggle, pause, and the emote picker (EmotePicker.tsx: every
// emote with its icon, plus outfit-screen reactions and idles). Hidden unless the deployment publishes a clip manifest
// (animations/manifest.json).
//
// The outfit-screen idle plays by default once the first outfit has loaded (the user's call, 5 Nov). It stays still
// when the viewer last chose the still pose (remembered in this browser), when the system asks for reduced motion, and
// in automated browsers: the visual-diff, probe and audit harnesses compare still-pose captures. An emote the viewer
// picks while the outfit is still loading stays in front: the idle then starts under it (RigAnimator.playUnder).
//
// URL switches for captures and reviews: ?anim=<clip id> starts that clip once the outfit has loaded, and
// &animTime=<seconds> then holds it at that time, paused (a deterministic mid-motion frame); ?anim=0 opens still;
// ?sway=0 starts with the approximate secondary motion off; ?deform=0 leaves the twist/volume joints at rest (the
// game's deformation rig off, for comparisons); ?face=0 opens with the facial animation off (FaceAnimator.ts) for that
// visit, without changing the viewer's remembered choice.
//
// Emote speed and the facial animation switch (21 Nov 2026, lib/emote-playback.ts): a speed slider while an emote is in
// front (EmoteSpeedControl.tsx) and a Facial animation toggle beside Sway, both remembered in this browser. Automated
// browsers ignore both remembered choices, as they do Loop, so captures stay at normal speed with the face on.
//
// Share links can carry a pose (10 Nov 2026, lib/share-pose.ts: &emote=<clip>&t=<s>[&paused=1]). The builder hands it
// over before the link is tidied away; it is applied here once the outfit has loaded, instead of the default idle,
// and wins over ?anim=. A paused pose holds its frame; one without paused plays on from it (held still for reduced
// motion and automated browsers). The pose on screen is published for the Share button (lib/viewer-handle.ts).

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

/** The animator for a clip set, once its manifest has loaded (null: no clips published there, or still loading).
 *  A new base (Chinals mode, lib/site-mode.ts) disposes the old animator and loads the other set; in between this is
 *  null at once, in the same render, so nothing drives the body with the old set under the new mode. The controls
 *  unmount and mount again, so the new set starts from its own idle (or a link's pose). `clipFiles`: a clip download
 *  cache shared between several characters' animators (a squad); keep it the same object for the hook's lifetime. */
export function useRigAnimator(base: string, clipFiles?: ClipFileCache): RigAnimator | null {
  const [loaded, setLoaded] = useState<{ base: string; animator: RigAnimator } | null>(null);
  useEffect(() => {
    let cancelled = false, created: RigAnimator | null = null;
    loadAnimationManifest(base).then(loaded => {
      const params = new URLSearchParams(window.location.search);
      if (cancelled || !loaded) return;
      created = new RigAnimator(loaded.manifest, loaded.clipBase,
        { sway: params.get("sway") !== "0", deform: params.get("deform") !== "0", loopEmote: savedLoop(),
          speed: AUTOMATED ? 1 : savedSpeed(), propsUrl: loaded.propsUrl, facesUrl: loaded.facesUrl,
          face: params.get("face") !== "0" && (AUTOMATED || savedFace()),
          // Automated browsers get no sounds at all (no audio device, no downloads): captures stay silent and deterministic.
          soundsUrl: AUTOMATED ? null : loaded.soundsUrl, clipFiles });
      setLoaded({ base, animator: created });
    }).catch(error => console.warn("[animation] manifest unavailable", error));
    // dispose(), not reset(): a clip still downloading must not bind the body to a discarded animator when it lands.
    return () => { cancelled = true; created?.dispose(); };
  }, [base, clipFiles]);
  return loaded?.base === base ? loaded.animator : null;
}

// The animator state hook lives with the binding (one import direction); re-exported for existing importers.
export { useAnimatorState } from "./useAnimationBinding";

// The test clock lives in lib/frame-clock.ts (shared with the animation binding); re-exported for existing importers.
export { frameClock, clockFrozen, clockHeldStill } from "../lib/frame-clock";

// Orbiting the camera counts as turning the character for the sway springs (SpringBones.turn), as the game turns
// the character itself. A jump larger than this in one frame is a camera reset, not a turn; a fast flick is capped.
const TELEPORT = 0.6, MAX_TURN = 0.15; // radians per frame

/** Canvas child: advances the mixer each frame, before the priority-1 still-view render draws it. */
/** `yaw`: the character's own turn (scene turntable mode), which turns it against the camera just as orbiting does. */
export function AnimationFrameDriver({ animator, yaw }: { animator: RigAnimator; yaw?: () => number }) {
  const lastAzimuth = useRef<number | null>(null);
  useFrame(({ camera, controls }, delta) => {
    if (clockFrozen()) return;
    stepAnimator(animator, camera, controls, yaw?.() ?? 0, lastAzimuth, delta);
    frameClock.steps++;
  });
  return null;
}

/** One character's frame: the camera's turn round it swings its springs, then its mixer advances. `yaw`: the
 *  character's own turn about the vertical axis; `lastAzimuth`: this character's memory between frames. A frame
 *  driver calls it for each of its characters, then counts one frame (frameClock.steps). */
export function stepAnimator(animator: RigAnimator, camera: THREE.Camera, controls: unknown, yaw: number,
  lastAzimuth: { current: number | null }, delta: number): void {
  const target = (controls as { target?: THREE.Vector3 } | null)?.target;
  const azimuth = Math.atan2(camera.position.x - (target?.x ?? 0), camera.position.z - (target?.z ?? 0)) - yaw;
  const last = lastAzimuth.current;
  lastAzimuth.current = azimuth;
  // (A video export records through its own fixed camera: orbiting meanwhile turns nothing.)
  if (last !== null && animator.state.sway && animator.state.moving && !animator.recording) {
    const change = Math.atan2(Math.sin(azimuth - last), Math.cos(azimuth - last)); // wrapped to (-pi, pi]
    if (Math.abs(change) < TELEPORT) animator.springs.turn(THREE.MathUtils.clamp(change, -MAX_TURN, MAX_TURN));
  }
  animator.update(frameClock.fixed ?? delta);
}

/** Overlay controls, plus the rig-side bookkeeping (bone pins for legacy statics) that follows the animator. */
export function AnimationControls({ animator, rig, ready, busy, studio }: {
  animator: RigAnimator; rig: CharacterRig; ready: boolean; busy: boolean; studio: boolean;
}) {
  const state = useAnimatorState(animator);
  // The rig-side bookkeeping for this character (useAnimationBinding.ts); the builder's is the primary one.
  const { play, stop } = useAnimationBinding({ animator, rig, ready, busy, primary: true });
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
    // When the column is short only the emote picker gives way: everything else keeps its height (shrink-0), while the
    // picker and this block that holds it may shrink (shrink!).
    <div ref={controls} className="flex min-h-0 shrink! flex-col items-end gap-1.5 *:shrink-0">
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
      {state.active && emote && <EmoteSpeedControl animator={animator} speed={state.speed} />}
      {state.active && animator.face.available && (
        <button type="button" className={`${button} h-7 px-2.5 text-fg-muted`} aria-pressed={state.face}
          title={state.face ? "Facial animation: the game's own expressions on the face. Turn it off to keep the face at rest."
            : "The face stays at rest. Turn on the game's own facial expressions."}
          onClick={() => setFacialAnimation(animator, !state.face)}>
          <span aria-hidden="true" className={`size-2 ${state.face ? "bg-fg-muted" : "border border-fg/50"}`} />
          Facial animation
        </button>
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
