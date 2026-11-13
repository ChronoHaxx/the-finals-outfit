import { useSyncExternalStore, type CSSProperties } from "react";
import { DEFAULT_SETTINGS, type EmoteSounds } from "../rig/EmoteSounds";
import { SpeakerIcon } from "./Icons";

// Emote sound control (12 Nov 2026, rig/EmoteSounds.ts): beside Pause and Animated while an emote with sound is in front.
// The speaker mutes and unmutes; on a mouse screen a slim slider sets the volume (phones have their own buttons). Both
// are remembered in this browser. It sits with the animation toggles, not in the timeline, so the frame slider keeps
// its width on a phone.
//
// Sound is on by default: it only ever follows a click, because browsers keep audio locked until the first click or tap
// (an emote a link opens plays silently until then). Before that first gesture this very click is what unlocks audio
// (EmoteSounds listens on the page), so it must not also mute.

function useSoundState(sounds: EmoteSounds) {
  // A string snapshot (useSyncExternalStore compares by identity): the settings and whether audio is unlocked yet.
  const key = useSyncExternalStore(listener => sounds.subscribe(listener),
    () => `${sounds.settings.muted}:${sounds.settings.volume}:${sounds.unlocked}`);
  const [muted, volume, unlocked] = key.split(":");
  return { muted: muted === "true", volume: Number(volume), unlocked: unlocked === "true" };
}

// The look of the Pause and Animated buttons beside it, square.
const BUTTON = "hud grid size-8 place-items-center bg-ink-950/80 text-fg transition-colors hover:bg-ink-950";

export function EmoteSoundControl({ sounds }: { sounds: EmoteSounds }) {
  const { muted, volume, unlocked } = useSoundState(sounds);
  const silent = muted || volume === 0;
  const shown = muted ? 0 : volume;
  const title = !unlocked && !silent ? "Sound starts with your first click or tap" : silent ? "Turn the emote's sound on" : "Mute the emote's sound";
  return (
    <div role="group" aria-label="Emote sound" className="flex">
      <button type="button" className={`${BUTTON} ${silent ? "text-fg-muted" : ""}`}
        aria-pressed={!silent} aria-label="Sound" title={title}
        onClick={() => {
          if (!unlocked && !silent) return;
          if (silent && volume === 0) sounds.setVolume(DEFAULT_SETTINGS.volume); else sounds.setMuted(!muted);
        }}>
        <SpeakerIcon muted={silent} />
      </button>
      <span className="flex h-8 items-center bg-ink-950/80 pr-2.5 pointer-coarse:hidden">
        <input type="range" min={0} max={1} step={0.05} value={shown} aria-label="Sound volume"
          aria-valuetext={`${Math.round(shown * 100)}%`} title="Volume"
          onChange={event => sounds.setVolume(Number(event.target.value))}
          className="timeline-range w-16 cursor-pointer" style={{ "--played": `${shown * 100}%` } as CSSProperties} />
      </span>
    </div>
  );
}
