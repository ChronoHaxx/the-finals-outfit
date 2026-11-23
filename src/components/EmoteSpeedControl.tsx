import type { CSSProperties } from "react";
import type { RigAnimator } from "../rig/RigAnimator";
import { EMOTE_SPEEDS, formatSpeed, NORMAL_SPEED_INDEX, setEmoteSpeed, speedIndex } from "../lib/emote-playback";
import { useFeature } from "../lib/discovery";

// Emote speed (21 Nov 2026, lib/emote-playback.ts): a slider from a quarter speed to four times, shown with the animation
// controls while an emote or reaction is in front (the idle keeps normal speed). Like the sound control it sits in the
// column, not in the timeline, so the frame slider keeps its width on a phone. The value beside it reads the speed and,
// away from normal speed, puts it back to 1× when clicked. < and > step it while the timeline shows (EmoteTimeline.tsx),
// as in video players. Remembered in this browser.

export function EmoteSpeedControl({ animator, speed }: { animator: RigAnimator; speed: number }) {
  const index = speedIndex(speed);
  const normal = index === NORMAL_SPEED_INDEX;
  const last = EMOTE_SPEEDS.length - 1;
  const feature = useFeature("emote-speed", "Emote speed ( < slower, > faster )");
  return (
    <div role="group" aria-label="Emote speed" {...feature}
      className="hud flex h-7 items-center gap-2 bg-ink-950/80 pl-2.5 text-fg-muted pointer-coarse:h-9">
      <span aria-hidden="true">Speed</span>
      <input type="range" min={0} max={last} step={1} value={index} aria-label="Emote speed"
        aria-valuetext={`${Number(speed.toFixed(2))} times normal speed`}
        onChange={event => setEmoteSpeed(animator, EMOTE_SPEEDS[Number(event.target.value)])}
        className="timeline-range w-20 cursor-pointer" style={{ "--played": `${(index / last) * 100}%` } as CSSProperties} />
      <button type="button" disabled={normal} onClick={() => setEmoteSpeed(animator, 1)}
        aria-label={normal ? "Normal speed" : `${formatSpeed(speed)}: back to normal speed`}
        title={normal ? "Normal speed" : "Back to normal speed"}
        className={`h-full min-w-11 px-2 text-right tabular-nums normal-case transition-colors disabled:cursor-default ${normal ? "" : "text-finals hover:bg-ink-950"}`}>
        {formatSpeed(speed)}
      </button>
    </div>
  );
}
