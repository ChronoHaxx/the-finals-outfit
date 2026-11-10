import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RigAnimator } from "../rig/RigAnimator";
import { frameAt } from "../lib/share-pose";
import { useAnimatorState } from "./AnimationControls";
import { CloseIcon, FrameStepIcon, PauseIcon, PlayIcon } from "./Icons";

// The emote timeline (10 Nov 2026): people use the viewer as a pose reference, so an emote can be paused, dragged
// through and stepped a frame at a time, and the frame shared (ShareBuild.tsx records it).
//
// Shown along the bottom of the viewer while an emote or reaction is in front (the idle alone has none). The slider
// counts whole frames of the clip's own frame time (frame 0 is the first, as Unreal counts). A drag holds the frame
// under the thumb once per rendered frame without the sway preroll (RigAnimator.scrub); letting go seeks properly, so
// the swinging chains settle into the motion that leads to that frame. , and . step a frame back or on, as in video
// players, whenever focus is not in a text field.
//
// Pausing, dragging or stepping marks the emote "inspected": at its end it stays on the last frame instead of returning
// to the idle; play from there starts it again; the close button goes back to the idle.

/** Keys typed into a field are the field's. Sliders, buttons and boxes do not take , or . themselves. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA" || element.tagName === "SELECT") return true;
  return element.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "submit"].includes((element as HTMLInputElement).type);
}

const SETTLE_MS = 200; // after the last drag or key-repeat step, the still view goes back to converging

export function EmoteTimeline({ animator }: { animator: RigAnimator }) {
  const state = useAnimatorState(animator);
  const timeline = animator.timeline();
  const visible = timeline !== null;
  const [, redraw] = useState(0);
  const range = useRef<HTMLInputElement>(null);
  const settle = useRef(0);

  // Follow the clock once per animation frame while shown: playing moves it every frame; a drag, step or seek moves it
  // while paused. Only a change of the shown millisecond re-renders.
  useEffect(() => {
    if (!visible) return;
    let frame = 0, shown = "";
    const tick = () => {
      const now = animator.timeline();
      const key = now ? `${now.clip}:${Math.round(now.time * 1000)}:${now.paused}` : "";
      if (key !== shown) { shown = key; redraw(n => n + 1); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animator, visible]);

  // While the frame changes in quick succession the still view treats the pose as moving (its running average)
  // instead of restarting from one grainy sample every frame.
  const scrubbing = () => {
    animator.scrubbing = true;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => { animator.scrubbing = false; }, SETTLE_MS);
  };
  useEffect(() => () => { window.clearTimeout(settle.current); animator.scrubbing = false; }, [animator]);

  // , and . step a frame, as in video players.
  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => {
      if ((event.key !== "," && event.key !== ".") || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented
        || typing(event.target)) return;
      event.preventDefault();
      if (event.repeat) scrubbing();
      animator.step(event.key === "," ? -1 : 1);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [animator, visible]);

  // Letting go of the slider (and every keyboard step on it): a proper seek, with the sway preroll. React's onChange
  // fires per input event; the native change event fires on commit.
  useEffect(() => {
    const slider = range.current;
    if (!slider) return;
    const commit = () => {
      const now = animator.timeline();
      if (now) animator.seek(Number(slider.value) * now.frameTime, { inspect: true });
    };
    slider.addEventListener("change", commit);
    return () => slider.removeEventListener("change", commit);
  }, [animator, visible]);

  if (!timeline) return null;
  const info = animator.info(timeline.clip);
  const label = info?.label ?? timeline.clip;
  const lastFrame = Math.max(1, frameAt(timeline.duration, timeline.frameTime));
  const frame = Math.min(lastFrame, frameAt(timeline.time, timeline.frameTime));
  const seconds = timeline.time.toFixed(2);
  const paused = state.paused;
  const button = "grid size-8 shrink-0 place-items-center text-fg transition-colors hover:bg-ink-800 disabled:opacity-40 pointer-coarse:size-10";

  return (
    <div role="group" aria-label={`${label} timeline`}
      className="pointer-events-auto flex h-10 w-full min-w-0 items-center gap-0.5 border-l-2 border-finals bg-ink-950/85 px-1 pointer-coarse:h-12">
      <button type="button" className={button} onClick={() => animator.setPaused(!paused)}
        aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause on this frame"}>
        {paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      <button type="button" className={button} onClick={() => animator.step(-1)} disabled={frame <= 0 && paused}
        aria-label="Previous frame" title="Previous frame ( , )">
        <FrameStepIcon />
      </button>
      <input ref={range} type="range" min={0} max={lastFrame} step={1} value={frame}
        aria-label={`${label}: frame`} aria-valuetext={`Frame ${frame} of ${lastFrame}, ${seconds} seconds`}
        onChange={event => { scrubbing(); animator.scrub(Number(event.target.value) * timeline.frameTime); redraw(n => n + 1); }}
        className="timeline-range mx-1 min-w-0 flex-1 cursor-pointer"
        style={{ "--played": `${(frame / lastFrame) * 100}%` } as CSSProperties} />
      <button type="button" className={button} onClick={() => animator.step(1)} disabled={frame >= lastFrame && paused}
        aria-label="Next frame" title="Next frame ( . )">
        <FrameStepIcon forward />
      </button>
      <span className="hud shrink-0 px-1.5 text-right tabular-nums text-fg-muted" aria-hidden="true">
        <span className="text-fg normal-case">{seconds}&thinsp;s</span>
        <span className="block text-fg-dim">{frame}&thinsp;/&thinsp;{lastFrame}</span>
      </span>
      <button type="button" className={`${button} text-fg-muted`} onClick={() => animator.leaveEmote()}
        aria-label="Close the emote" title="Back to the idle">
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
