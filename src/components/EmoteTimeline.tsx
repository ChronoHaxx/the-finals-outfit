import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { RigAnimator } from "../rig/RigAnimator";
import { frameAt } from "../lib/share-pose";
import { setEmoteSpeed, stepSpeed } from "../lib/emote-playback";
import { clampRange, getRange, moveMark, setRange, useVideoRange, type VideoRange } from "../lib/video-range";
import { setEmoteLoop, useAnimatorState } from "./AnimationControls";
import { useFeature } from "../lib/discovery";
import { nudge } from "./Discovery";
import { CloseIcon, FrameStepIcon, LoopIcon, PauseIcon, PlayIcon } from "./Icons";

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
//
// Loop (11 Nov 2026): the emote repeats from its first frame until Loop is turned off (it then finishes the pass and
// returns to the idle), the close button, or another pick. It applies to every later emote too, and is remembered in
// this browser.
//
// Speed (21 Nov 2026): the slider sits with the animation controls (EmoteSpeedControl.tsx); here < and > step it, as
// Shift+, and Shift+. do in video players. The frame counter and the slider are clip time, the same at any speed.
//
// Share a paused frame (21 Nov 2026): regular visitors had not found it, so the first pause shows a one-time nudge above
// the bar; and the first emote, with a keyboard, says which keys step and speed it (22 Nov). Both are the discovery
// layer's nudges (Discovery.tsx, words in src/data/feature-guide.ts), each shown once in this browser.
//
// Video range (22 Nov 2026): Range marks the part of the emote a video records (lib/video-range.ts). Its two markers
// sit above the track, so the playhead stays draggable under them; I and O move them to the frame on screen, as in
// video editors. The Video tab shows the same range as typed times. Off is the whole emote. On a touch screen the bar
// has no room for them (the track would shrink to a sliver under two markers), so phones set the range by its times.

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
  const slider = useRef<HTMLInputElement>(null);
  const settle = useRef(0);
  const feature = useFeature("timeline");
  const rangeFeature = useFeature("video-range");
  const range = useVideoRange(timeline?.clip, timeline?.duration ?? 0, timeline?.frameTime);
  // One-time nudges, at the moment each is useful: a pause (share this frame), a first emote with a keyboard (the keys).
  useEffect(() => {
    if (!visible) return;
    if (state.paused) nudge("pause-share");
    else if (window.matchMedia("(pointer: fine)").matches) nudge("emote-keys");
  }, [visible, state.paused]);

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

  // , and . step a frame; < and > change the speed, as in video players.
  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || typing(event.target)) return;
      if (event.key === "<" || event.key === ">") {
        event.preventDefault();
        setEmoteSpeed(animator, stepSpeed(animator.state.speed, event.key === "<" ? -1 : 1));
        return;
      }
      if (event.key === "i" || event.key === "I" || event.key === "o" || event.key === "O") {
        const now = animator.timeline();
        if (!now) return;
        event.preventDefault();
        const current = clampRange(getRange(now.clip), now.duration, now.frameTime);
        setRange(now.clip, moveMark(current, event.key.toLowerCase() === "i" ? "from" : "to", now.time, now.duration, now.frameTime));
        return;
      }
      if (event.key !== "," && event.key !== ".") return;
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
    const input = slider.current;
    if (!input) return;
    const commit = () => {
      const now = animator.timeline();
      if (now) animator.seek(Number(input.value) * now.frameTime, { inspect: true });
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [animator, visible]);

  if (!timeline) return null;
  const info = animator.info(timeline.clip);
  const label = info?.label ?? timeline.clip;
  const lastFrame = Math.max(1, frameAt(timeline.duration, timeline.frameTime));
  const frame = Math.min(lastFrame, frameAt(timeline.time, timeline.frameTime));
  const seconds = timeline.time.toFixed(2);
  const paused = state.paused;
  const button = "grid size-8 shrink-0 place-items-center text-fg transition-colors hover:bg-ink-800 disabled:opacity-40 pointer-coarse:size-10";

  return (<>
    <div role="group" aria-label={`${label} timeline`} {...feature}
      className="pointer-events-auto flex h-10 w-full min-w-0 items-center gap-0.5 border-l-2 border-finals bg-ink-950/85 px-1 pointer-coarse:h-12">
      <button type="button" className={button} onClick={() => animator.setPaused(!paused)}
        aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause on this frame"}>
        {paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      <button type="button" className={button} onClick={() => animator.step(-1)} disabled={frame <= 0 && paused}
        aria-label="Previous frame" title="Previous frame ( , )">
        <FrameStepIcon />
      </button>
      <div className="relative mx-1 flex h-full min-w-0 flex-1 items-center">
        <input ref={slider} type="range" min={0} max={lastFrame} step={1} value={frame}
          aria-label={`${label}: frame`} aria-valuetext={`Frame ${frame} of ${lastFrame}, ${seconds} seconds`}
          onChange={event => { scrubbing(); animator.scrub(Number(event.target.value) * timeline.frameTime); redraw(n => n + 1); }}
          className="timeline-range w-full min-w-0 cursor-pointer"
          style={{ "--played": `${(frame / lastFrame) * 100}%` } as CSSProperties} />
        {range && <div className="contents pointer-coarse:hidden">
          <RangeMarks clip={timeline.clip} range={range} duration={timeline.duration} frameTime={timeline.frameTime} />
        </div>}
      </div>
      <button type="button" className={button} onClick={() => animator.step(1)} disabled={frame >= lastFrame && paused}
        aria-label="Next frame" title="Next frame ( . )">
        <FrameStepIcon forward />
      </button>
      <span className="hud shrink-0 px-1.5 text-right tabular-nums text-fg-muted" aria-hidden="true">
        <span className="text-fg normal-case">{seconds}&thinsp;s</span>
        <span className="block text-fg-dim">{frame}&thinsp;/&thinsp;{lastFrame}</span>
      </span>
      <button type="button" className={`${button} pointer-coarse:hidden ${range ? "text-finals" : "text-fg-muted"}`} {...rangeFeature}
        onClick={() => setRange(timeline.clip, range ? null : { from: 0, to: timeline.duration })}
        aria-pressed={!!range} aria-label="Video range"
        title={range ? `Video range ${range.from.toFixed(2)}–${range.to.toFixed(2)} s: click for the whole emote` : "Mark the part a video records ( I start, O end )"}>
        <RangeIcon />
      </button>
      <button type="button" className={`${button} ${state.loopEmote ? "text-finals" : "text-fg-muted"}`}
        onClick={() => setEmoteLoop(animator, !state.loopEmote)} aria-pressed={state.loopEmote} aria-label="Loop"
        title={state.loopEmote ? "Looping: play once instead" : "Loop the emote"}>
        <LoopIcon />
      </button>
      <button type="button" className={`${button} text-fg-muted`} onClick={() => animator.leaveEmote()}
        aria-label="Close the emote" title="Back to the idle">
        <CloseIcon size={12} />
      </button>
    </div>
  </>);
}

const RangeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M5 3H3v10h2M11 3h2v10h-2" /><path d="M6.5 8h3" strokeDasharray="1.5 1.5" />
  </svg>
);

// The native thumb is 10 px wide (index.css, timeline-range), so a value sits 5 px in from either end at 0 and 1.
const THUMB = 10;
const at = (fraction: number) => `calc(${THUMB / 2}px + ${fraction} * (100% - ${THUMB}px))`;

/** The video range's two markers over the timeline's track, the parts outside it shaded. Each marker's grab tab sits
 *  above the track (the playhead stays draggable); it drags, or steps by frame with the arrow keys (Shift: 10). */
function RangeMarks({ clip, range, duration, frameTime }: { clip: string; range: VideoRange; duration: number; frameTime: number }) {
  const box = useRef<HTMLDivElement>(null);
  const fraction = (t: number) => duration > 0 ? t / duration : 0;
  const move = (end: "from" | "to", time: number) => setRange(clip, moveMark(range, end, time, duration, frameTime));
  const drag = (end: "from" | "to") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const f = Math.min(1, Math.max(0, (event.clientX - rect.left - THUMB / 2) / Math.max(1, rect.width - THUMB)));
      move(end, f * duration);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = (event.shiftKey ? 10 : 1) * frameTime;
      const keys: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
      if (event.key in keys) move(end, range[end] + keys[event.key]);
      else if (event.key === "Home") move(end, 0);
      else if (event.key === "End") move(end, duration);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
  });
  const mark = (end: "from" | "to") => (
    <div role="slider" tabIndex={0} aria-label={end === "from" ? "Video start" : "Video end"} aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={Number(duration.toFixed(3))} aria-valuenow={Number(range[end].toFixed(3))}
      aria-valuetext={`${range[end].toFixed(2)} seconds`} title={`${end === "from" ? "Video starts" : "Video ends"} at ${range[end].toFixed(2)} s: drag, or press ${end === "from" ? "I" : "O"} at a frame`}
      {...drag(end)}
      className="group absolute top-0 z-10 flex h-[11px] w-3 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none pointer-coarse:h-4 pointer-coarse:w-5"
      style={{ left: at(fraction(range[end])) }}>
      <span aria-hidden="true" className={`h-full w-2 bg-finals group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-fg ${end === "from" ? "rounded-tl-sm" : "rounded-tr-sm"}`} />
    </div>
  );
  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-ink-950/70" style={{ width: at(fraction(range.from)) }} />
      <div aria-hidden="true" className="absolute inset-y-0 right-0 bg-ink-950/70" style={{ left: at(fraction(range.to)) }} />
      {(["from", "to"] as const).map(end => (
        <span key={`line-${end}`} aria-hidden="true" className="absolute inset-y-[22%] w-px -translate-x-1/2 bg-finals" style={{ left: at(fraction(range[end])) }} />
      ))}
      <div className="pointer-events-auto">{mark("from")}{mark("to")}</div>
    </div>
  );
}
