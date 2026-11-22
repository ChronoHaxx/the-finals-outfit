import { useEffect, useRef, useSyncExternalStore } from "react";
import type * as THREE from "three";
import type { CharacterRig } from "../rig/CharacterRig";
import { initialClip, type AnimatorState, type RigAnimator } from "../rig/RigAnimator";
import { AUTOMATED } from "../lib/automation";
import { modelUrl } from "../lib/assets";
import { loadSourceFaceMask } from "../rig/SourceAssembly";
import { warmForDraw } from "../rig/EmoteProps";
import { pendingPose, subscribePendingPose, takePendingPose } from "../lib/share-pose";
import { getPreviewScene, setPoseSource } from "../lib/viewer-handle";
import { isChinalsClip } from "../lib/site-mode";
import { frameClock } from "../lib/frame-clock";

// The rig-side bookkeeping that follows one character's animator (moved out of AnimationControls, 21 Nov 2026,
// multi-character design Phase 1.2, so every character on a scene can run it without the builder's overlay UI):
// bone pins for legacy statics, sway chains, the still pose, the facial animation's head, prop warm-up, and the
// first motion once the outfit has loaded.
//
// `primary`: the builder's one character. Only it takes a share link's pose, remembers the still/animated choice for
// the next visit, publishes the frame on screen for the Share button and exposes window.__rigAnim to test rigs.

// Per-viewer convenience: "still" after the viewer stops the idle, removed when they start it again. Storage can be
// missing or blocked (private windows, previews): every access is guarded and the default then applies.
const MOTION_KEY = "finals-outfit.motion";
export function savedStill(): boolean {
  try { return window.localStorage.getItem(MOTION_KEY) === "still"; } catch { return false; }
}
function saveMotion(still: boolean): void {
  try {
    if (still) window.localStorage.setItem(MOTION_KEY, "still"); else window.localStorage.removeItem(MOTION_KEY);
  } catch { /* the choice just is not remembered */ }
}

const IDLE_STATE: AnimatorState = { active: false, moving: false, paused: false, sway: true, loopEmote: false, speed: 1, face: true,
  idle: null, current: null, loading: null, error: null };

/** The animator's state for React (moved from AnimationControls.tsx, which re-exports it). */
export function useAnimatorState(animator: RigAnimator | null): AnimatorState {
  return useSyncExternalStore(
    listener => animator?.subscribe(listener) ?? (() => {}),
    () => animator?.state ?? IDLE_STATE,
  );
}

export interface AnimationBinding {
  /** The viewer's own play click (an idle loop remembers "animated" for the builder's character). */
  play(id: string): void;
  /** The viewer's own stop click (remembers "still" for the builder's character). */
  stop(): void;
}

export function useAnimationBinding({ animator, rig, ready, busy, primary }: {
  animator: RigAnimator; rig: CharacterRig; ready: boolean; busy: boolean; primary: boolean;
}): AnimationBinding {
  const state = useAnimatorState(animator);
  // While anything plays: pin legacy root-level statics and stranded legacy bone branches to the driver, then collect
  // the jiggle chains for sway. A finished outfit pass may have added new ones. (The animator resets the springs
  // itself before it publishes "inactive", so a swung chain is never unpinned mid-swing.)
  useEffect(() => {
    if (!ready || busy) return;
    rig.setAnimationPins(state.active);
    const root = rig.animationRoot();
    if (state.active && root) animator.rememberStillPose(root); // bones a mid-playback outfit change added
    // The worn head, for the facial animation: bound while its bones are still at rest (just recorded above).
    if (state.active) void animator.bindFace();
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
  useEffect(() => {
    // Props are compiled and uploaded while their emote loads, not on their first frame (EmoteProps.warmForDraw): a
    // 100-200 ms first draw stalls the motion, and the sounds already scheduled ahead of it come out early. The viewer
    // publishes its renderer and scene once the outfit has loaded; before that a prop just warms on first draw.
    animator.props.setWarmer(object => {
      const view = getPreviewScene();
      return view ? warmForDraw(view.gl, view.scene, object) : Promise.resolve();
    });
    return () => animator.props.setWarmer(null);
  }, [animator]);
  useEffect(() => {
    // The face masks come from the worn items' definitions (the same files the outfit is assembled from).
    const assembly = modelUrl("models/reconstructed-assembly-v2");
    animator.setFaceSource(() => ({ meshes: rig.faceMeshes(), wraps: rig.faceWraps(),
      masks: Promise.all(rig.equippedItemIds().map(id => loadSourceFaceMask(id, assembly).catch(() => null)))
        .then(list => list.filter((m): m is string => !!m)) }));
    return () => animator.setFaceSource(null);
  }, [animator, rig]);
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
    if (!primary) return; // a link's pose and the remembered still/animated choice are the builder's character's
    if (!ready || busy) return;
    // A Chinals emote's pose (cn-…) that this set lacks: the builder is switching to Chinals mode, or saying the mode
    // is off here, and the pose waits for the Chinals set (taken there). Nothing starts meanwhile.
    const waiting = pendingPose();
    if (waiting && !animator.info(waiting.clip) && isChinalsClip(waiting.clip)) return;
    const pose = takePendingPose();
    if (pose && !animator.info(pose.clip)) console.warn(`[animation] the link's pose names an unknown clip "${pose.clip}"`);
    const posed = pose && animator.info(pose.clip) ? pose : null;
    if (!posed && started.current) return;
    // The emote button works from the body's load, before the outfit has: a clip the viewer picked meanwhile is their
    // latest choice and stays in front (21 Nov 2026: the idle used to replace it here once the outfit finished).
    const viewerFirst = !started.current && (animator.state.active || animator.state.loading !== null);
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = initialClip({ anim: params.get("anim"), defaultIdle: animator.manifest.defaultIdle, automated: AUTOMATED,
      reducedMotion, savedStill: savedStill() });
    const root = rig.animationRoot();
    if (!root) return;
    if (viewerFirst) {
      // The idle the viewer would be animating with goes under it, so their emote ends into it as if they had waited.
      if (id && animator.info(id)?.loop) animator.playUnder(root, id).catch(error => console.error(error));
      return;
    }
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
  }, [animator, rig, ready, busy, linkPose, primary]);
  // The frame on screen, for the Share button (outside the canvas).
  useEffect(() => {
    if (!primary) return;
    setPoseSource({ capture: () => animator.sharePose(), subscribe: listener => animator.subscribePose(listener) });
    return () => setPoseSource(null);
  }, [animator, primary]);
  useEffect(() => {
    if (!primary) return;
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
      face: (on: boolean) => animator.setFace(on),
      state: () => animator.state,
      clock: frameClock,
    };
    return () => { delete host.__rigAnim; };
  }, [animator, rig, primary]);

  // The viewer's own clicks: remember still vs. animated for the next visit.
  const play = (id: string) => {
    const root = rig.animationRoot();
    if (!root) return;
    // Starting an idle loop means "animated"; an emote from the still pose returns to it, so it changes nothing.
    if (primary && animator.info(id)?.loop) saveMotion(false);
    prepare(root);
    animator.play(root, id).catch(error => console.error(error));
  };
  const stop = () => { if (primary) saveMotion(true); animator.stop(); };
  return { play, stop };
}
