import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { backdropPaint, type Backdrop } from "../lib/stage-lighting";
import type { ScreenshotContext } from "../rig/ViewerScreenshot";
import type { RigAnimator } from "../rig/RigAnimator";
import { FPS, QUALITY, exportName, framePlan, recordVideo, videoSizes, videoSupport,
  type VideoFormat, type VideoProgress, type VideoQuality, type VideoSupport } from "../rig/VideoExport";

// The capture panel's Video tab (21 Nov 2026): the emote in front as a 60 fps video, rendered in this browser
// (rig/VideoExport.ts). The job's state lives in the panel's button (useVideoExport), which stays mounted: the panel
// may close while a long render runs, and the button shows its progress.

// Memory guards. A phone gets at most 1080p frames, smaller GPU tiles, and a smaller ceiling for the finished file (it
// is held in memory, or the browser's blob storage, until saved). A phone is told apart by its primary pointer.
const PHONE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const LOW_MEMORY = PHONE || ((typeof navigator !== "undefined" && (navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8) <= 4;
const MAX_VIDEO_PIXELS = PHONE ? 1920 * 1088 : 3840 * 2176;
export const CAPTURE_TILE = PHONE ? 1024 : 2048;
const MAX_FILE_BYTES = LOW_MEMORY ? 400e6 : 2e9;

const KEY = "finals-outfit.video";
interface VideoChoices { format: VideoFormat; quality: VideoQuality; height: number; sound: boolean }
const DEFAULTS: VideoChoices = { format: "mp4", quality: "standard", height: 1080, sound: true };
function readChoices(): VideoChoices {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VideoChoices>;
    return {
      format: s.format === "mp4" || s.format === "webm" || s.format === "png" ? s.format : DEFAULTS.format,
      quality: s.quality === "draft" || s.quality === "standard" || s.quality === "best" ? s.quality : DEFAULTS.quality,
      height: typeof s.height === "number" && Number.isFinite(s.height) ? s.height : DEFAULTS.height,
      sound: typeof s.sound === "boolean" ? s.sound : DEFAULTS.sound,
    };
  } catch { return DEFAULTS; }
}
function writeChoices(choices: VideoChoices) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...(stored && typeof stored === "object" ? stored : {}), ...choices }));
  } catch { /* not remembered */ }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const megabytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export interface VideoJob {
  running: boolean;
  progress: VideoProgress | null;
  status: string;
  start: (options: { width: number; height: number; format: VideoFormat; quality: VideoQuality; sound: boolean; keepFloor: boolean }) => void;
  cancel: () => void;
}

/** The export's state, owned by the always-mounted panel button. */
export function useVideoExport(context: RefObject<ScreenshotContext | null>, animator: RigAnimator | null, backdrop: Backdrop): VideoJob {
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []); // the viewer unmounts: stop, and give the clock back
  const start: VideoJob["start"] = ({ width, height, format, quality, sound, keepFloor }) => {
    const ctx = context.current;
    if (!ctx || !animator || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setStatus("");
    setProgress({ phase: "preparing", frame: 0, frames: 0, bytes: 0 });
    const when = stamp();
    void (async () => {
      try {
        const result = await recordVideo(ctx, animator, { format, width, height, quality, keepFloor, sound,
          backdrop: backdropPaint(backdrop), maxTile: CAPTURE_TILE, maxBytes: MAX_FILE_BYTES }, setProgress, abort.signal, when);
        const name = `${exportName(result.clip, when)}.${result.extension}`;
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
        const soundNote = result.sound === "aac" || result.sound === "opus" ? ", with sound" : result.sound === "wav" ? ", sound as WAV" : "";
        const grain = result.samples < QUALITY[quality].samples ? " Some frames kept changing while drawn: a little grain." : "";
        setStatus(`Saved ${name}: ${result.width} × ${result.height}, ${result.frames} frames${soundNote}, ${megabytes(result.blob.size)}.${grain}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") setStatus("Cancelled. Nothing was saved.");
        else {
          console.error("[video]", error);
          setStatus(`Couldn’t make the video: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        controller.current = null;
        setProgress(null);
      }
    })();
  };
  return { running: !!progress, progress, status, start, cancel: () => controller.current?.abort() };
}

const FORMATS: { id: VideoFormat; label: string; detail: string }[] = [
  { id: "mp4", label: "MP4", detail: "On the backdrop, with sound. Plays anywhere: Discord, phones, every video editor." },
  { id: "webm", label: "WebM, transparent", detail: "See-through VP9, with sound. Browsers and OBS show the transparency; Premiere and Resolve ignore it." },
  { id: "png", label: "PNG sequence, transparent", detail: "Every frame as a see-through PNG, plus the sound as WAV, in a .zip. Any editor imports it; the biggest download." },
];

/** The Video tab's form. */
export function VideoTab({ job, animator, stage, keepFloor, onKeepFloor, ready }: {
  job: VideoJob; animator: RigAnimator | null; stage: { width: number; height: number; maxSide: number };
  keepFloor: boolean; onKeepFloor: (keep: boolean) => void; ready: boolean;
}) {
  const [choices, setChoices] = useState(readChoices);
  const [support, setSupport] = useState<VideoSupport | null>(null);
  useEffect(() => { let live = true; void videoSupport().then(s => { if (live) setSupport(s); }); return () => { live = false; }; }, []);
  // Re-read what would be recorded whenever the animator's state changes (an emote picked, ended, paused).
  useSyncExternalStore(listener => animator?.subscribe(listener) ?? (() => {}), () => animator?.state ?? null);
  const clip = animator?.recordable() ?? null;
  const change = (patch: Partial<VideoChoices>) => setChoices(current => { const next = { ...current, ...patch }; writeChoices(next); return next; });

  const sizes = videoSizes(stage.width, stage.height, MAX_VIDEO_PIXELS, stage.maxSide);
  const size = sizes.find(s => s.height === choices.height) ?? [...sizes].reverse().find(s => s.height <= choices.height) ?? sizes[0];
  const available = (format: VideoFormat) => format === "png" || (support ? support[format] : false);
  const format = available(choices.format) ? choices.format : support ? (available("mp4") ? "mp4" : "png") : choices.format;
  const plan = clip ? framePlan(clip) : null;
  const hasSound = !!clip && !!animator?.sounds.hasSound(clip.source);
  const soundPossible = format === "png" || (format === "webm" ? !!support?.opus : !!(support?.aac || support?.opus));
  const transparent = format !== "mp4";
  const running = job.running, progress = job.progress;
  const disabled = !ready || running || !clip || !size || !support || !available(format);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs leading-snug text-fg-muted">
        {clip && plan
          ? <><span className="text-fg">{clip.label}</span> · {plan.duration.toFixed(2)} s · {plan.frames} frames at {FPS} fps{clip.loop ? " (one loop)" : ""}</>
          : "Play an emote, then record it here."}
      </span>
      <div role="radiogroup" aria-label="Video format" className="flex flex-col gap-1.5">
        {FORMATS.map(f => {
          const usable = available(f.id);
          return (
            <button key={f.id} type="button" role="radio" aria-checked={format === f.id} disabled={!usable || running}
              onClick={() => change({ format: f.id })}
              className="flex flex-col items-start gap-0.5 border border-line px-2.5 py-1.5 text-left transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40 aria-checked:border-fg/60 aria-checked:bg-ink-900">
              <span className="text-xs font-semibold">{f.label}</span>
              <span className="text-[11px] leading-snug text-fg-muted">
                {usable || !support ? f.detail : f.id === "webm" ? "This browser can’t encode VP9 video: use Chrome or Edge." : "This browser can’t encode video here: use the PNG sequence."}
              </span>
            </button>
          );
        })}
        <span className="text-[11px] leading-snug text-fg-muted">No MOV: browsers can’t encode ProRes, so the PNG sequence is the transparent format editors take.</span>
      </div>
      {transparent && (
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={keepFloor} disabled={running} onChange={event => onKeepFloor(event.target.checked)}
            className="mt-0.5 size-4 cursor-pointer accent-finals" />
          <span className="flex flex-col">
            <span className="text-xs">Keep ground shadow</span>
          </span>
        </label>
      )}
      {animator?.sounds.available && (
        <label className={`flex items-start gap-2 ${hasSound && soundPossible ? "cursor-pointer" : "opacity-40"}`}>
          <input type="checkbox" checked={choices.sound && hasSound && soundPossible} disabled={running || !hasSound || !soundPossible}
            onChange={event => change({ sound: event.target.checked })} className="mt-0.5 size-4 cursor-pointer accent-finals" />
          <span className="flex flex-col">
            <span className="text-xs">Include sound</span>
            <span className="text-[11px] leading-snug text-fg-muted">{!clip ? "The emote’s own sound effects and music."
              : !hasSound ? "This emote has no sound." : !soundPossible ? "This browser can’t encode sound for this format."
              : "The emote’s own sound effects and music, at the game’s volume."}</span>
          </span>
        </label>
      )}
      <label className="flex items-center justify-between gap-3">
        <span className="hud text-fg-muted">Size</span>
        <select aria-label="Video size" value={size?.height ?? 0} disabled={running} onChange={event => change({ height: Number(event.target.value) })}
          className="select-plain h-8 border border-line bg-ink-900 pl-2.5 text-xs text-fg-muted">
          {sizes.map(s => <option key={s.height} value={s.height}>{s.label} · {s.width} × {s.height}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="hud text-fg-muted">Quality</span>
        <select aria-label="Video quality" value={choices.quality} disabled={running} onChange={event => change({ quality: event.target.value as VideoQuality })}
          className="select-plain h-8 border border-line bg-ink-900 pl-2.5 text-xs text-fg-muted">
          {(Object.keys(QUALITY) as VideoQuality[]).map(q => <option key={q} value={q}>{QUALITY[q].label}</option>)}
        </select>
      </label>
      <span className="-mt-2 text-[11px] leading-snug text-fg-muted">{QUALITY[choices.quality].detail}.</span>
      {running && progress ? (
        <div className="flex flex-col gap-1.5">
          <progress className="h-1.5 w-full accent-finals" max={progress.frames || 1} value={progress.phase === "rendering" ? progress.frame : progress.phase === "finishing" ? progress.frames : 0} />
          <div className="flex items-center justify-between gap-2">
            <span role="status" aria-live="polite" className="text-xs text-fg-muted">
              {progress.phase === "preparing" ? "Preparing…" : progress.phase === "finishing" ? "Encoding…"
                : `Frame ${progress.frame} of ${progress.frames}${progress.bytes ? ` · ${megabytes(progress.bytes)}` : ""}`}
            </span>
            <button type="button" onClick={job.cancel} className="flex h-8 items-center border border-fg/40 px-3 text-xs font-semibold text-fg hover:bg-ink-900">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={disabled}
          onClick={() => size && job.start({ width: size.width, height: size.height, format, quality: choices.quality,
            sound: choices.sound && hasSound && soundPossible, keepFloor })}
          title={!ready ? "Wait for the outfit to finish loading" : !clip ? "Play an emote first" : "Render the emote frame by frame"}
          className="flex h-9 items-center justify-center gap-2 bg-fg px-3 text-xs font-semibold text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
          Record video
        </button>
      )}
      {!running && job.status && <span role="status" aria-live="polite" className="text-xs leading-snug text-fg-muted">{job.status}</span>}
      <span className="text-[11px] leading-snug text-fg-muted">
        Rendered frame by frame on this device, so a slow one just takes longer. The frame is the viewer’s shape (full screen gives
        your monitor’s). Keep this tab in front while it renders.
      </span>
    </div>
  );
}
