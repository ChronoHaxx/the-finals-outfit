import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { backdropPaint, type Backdrop } from "../lib/stage-lighting";
import type { ScreenshotContext } from "../rig/ViewerScreenshot";
import type { RigAnimator } from "../rig/RigAnimator";
import { FPS, QUALITY, exportName, formatSpeed, framePlan, recordVideo, renderTake, takeExportName, videoSizes, videoSupport,
  type ExportRange, type TakeInput, type VideoFormat, type VideoProgress, type VideoQuality, type VideoSupport } from "../rig/VideoExport";
import { takeSlots } from "../rig/take-slots";
import { moveMark, setRange, useVideoRange } from "../lib/video-range";
import { useFeature } from "../lib/discovery";
import { TakesSection, type TakesState } from "./VideoTakes";

// The capture panel's Video tab (21 Nov 2026): the emote in front as a 60 fps video, rendered in this browser
// (rig/VideoExport.ts). The job's state lives in the panel's button (useVideoExport), which stays mounted: the panel
// may close while a long render runs, and the button shows its progress.
//
// Range, loops and speed (22 Nov 2026): an emote's video covers the timeline's range (typed here or marked there;
// lib/video-range.ts), repeated Loops times, at the emote speed. The defaults are the whole emote, once, at 1x.
//
// Takes (22 Nov 2026, VideoTakes.tsx): the tab records either the emote in front or a take, rendered with the same
// format, size, quality and sound choices.

// Memory guards. A phone gets at most 1080p frames, smaller GPU tiles, and a smaller ceiling for the finished file (it
// is held in memory, or the browser's blob storage, until saved). A phone is told apart by its primary pointer.
const PHONE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const LOW_MEMORY = PHONE || ((typeof navigator !== "undefined" && (navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8) <= 4;
const MAX_VIDEO_PIXELS = PHONE ? 1920 * 1088 : 3840 * 2176;
export const CAPTURE_TILE = PHONE ? 1024 : 2048;
const MAX_FILE_BYTES = LOW_MEMORY ? 400e6 : 2e9;

const KEY = "finals-outfit.video";
type VideoSource = "emote" | "take";
interface VideoChoices { format: VideoFormat; quality: VideoQuality; height: number; sound: boolean; loops: number; source: VideoSource }
const DEFAULTS: VideoChoices = { format: "mp4", quality: "standard", height: 1080, sound: true, loops: 1, source: "emote" };
export const MAX_LOOPS = 20;
function readChoices(): VideoChoices {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VideoChoices>;
    return {
      format: s.format === "mp4" || s.format === "webm" || s.format === "mov" || s.format === "png" ? s.format : DEFAULTS.format,
      quality: s.quality === "draft" || s.quality === "standard" || s.quality === "best" ? s.quality : DEFAULTS.quality,
      height: typeof s.height === "number" && Number.isFinite(s.height) ? s.height : DEFAULTS.height,
      sound: typeof s.sound === "boolean" ? s.sound : DEFAULTS.sound,
      loops: typeof s.loops === "number" && Number.isInteger(s.loops) && s.loops >= 1 && s.loops <= MAX_LOOPS ? s.loops : DEFAULTS.loops,
      source: s.source === "take" ? "take" : DEFAULTS.source,
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

type JobOptions = { width: number; height: number; format: VideoFormat; quality: VideoQuality; sound: boolean; keepFloor: boolean };

export interface VideoJob {
  running: boolean;
  progress: VideoProgress | null;
  status: string;
  start: (options: JobOptions & { range?: Partial<ExportRange> }) => void;
  /** Render a take (`load` gives it); `onDone` once its file is saved (the take is marked rendered, never deleted). */
  startTake: (load: () => Promise<TakeInput | null>, options: JobOptions, onDone: () => void) => void;
  cancel: () => void;
}

/** The export's state, owned by the always-mounted panel button. */
export function useVideoExport(context: RefObject<ScreenshotContext | null>, animator: RigAnimator | null, backdrop: Backdrop): VideoJob {
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []); // the viewer unmounts: stop, and give the clock back
  // One job at a time (both draw through the same renderer): render, save the file, say what was saved.
  const run = (work: (ctx: ScreenshotContext, animator: RigAnimator, signal: AbortSignal, when: string) =>
    Promise<{ blob: Blob; extension: string; frames: number; width: number; height: number; sound: string | null; samples: number; name: string }>,
    quality: VideoQuality, onDone?: () => void) => {
    const ctx = context.current;
    if (!ctx || !animator || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setStatus("");
    setProgress({ phase: "preparing", frame: 0, frames: 0, bytes: 0 });
    const when = stamp();
    void (async () => {
      try {
        const result = await work(ctx, animator, abort.signal, when);
        const name = `${result.name}.${result.extension}`;
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
        onDone?.();
        const soundNote = result.sound === "aac" || result.sound === "opus" || result.sound === "pcm" ? ", with sound" : result.sound === "wav" ? ", sound as WAV" : "";
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
  const settings = ({ format, width, height, quality, keepFloor, sound }: JobOptions) =>
    ({ format, width, height, quality, keepFloor, sound, backdrop: backdropPaint(backdrop), maxTile: CAPTURE_TILE, maxBytes: MAX_FILE_BYTES });
  const start: VideoJob["start"] = options => run(async (ctx, rig, signal, when) => {
    const result = await recordVideo(ctx, rig, { ...settings(options), range: options.range }, setProgress, signal, when);
    return { ...result, name: exportName(result.clip, when) };
  }, options.quality);
  const startTake: VideoJob["startTake"] = (load, options, onDone) => run(async (ctx, rig, signal, when) => {
    const take = await load();
    if (!take) throw new Error("This take is gone (discarded in another tab?)");
    const stage = takeSlots.stage;
    if (!stage) throw new Error("The 3D view isn’t ready");
    const result = await renderTake(ctx, rig, stage, take, settings(options), setProgress, signal, when);
    return { ...result, name: takeExportName(take.meta, when) };
  }, options.quality, onDone);
  return { running: !!progress, progress, status, start, startTake, cancel: () => controller.current?.abort() };
}

const FORMATS: { id: VideoFormat; label: string; detail: string }[] = [
  { id: "mp4", label: "MP4", detail: "On the backdrop, with sound. Plays anywhere: Discord, phones, every video editor." },
  { id: "mov", label: "MOV, transparent (lossless)", detail: "QuickTime Animation with alpha, every pixel exact, sound as PCM. For Premiere Pro, After Effects and DaVinci Resolve. Big: about 35 MB a second at 1080p." },
  { id: "webm", label: "WebM, transparent", detail: "See-through VP9, with sound. Browsers and OBS show the transparency; Premiere and Resolve ignore it." },
  { id: "png", label: "PNG sequence, transparent", detail: "Every frame as a see-through PNG, plus the sound as WAV, in a .zip. Any editor imports it as an image sequence." },
];
/** Formats written here in JavaScript, with no browser encoder behind them (so their sound needs none either). */
const ownEncoder = (format: VideoFormat) => format === "png" || format === "mov";

/** The Video tab's form. */
export function VideoTab({ job, animator, stage, keepFloor, onKeepFloor, ready, takes, onRecordTake }: {
  job: VideoJob; animator: RigAnimator | null; stage: { width: number; height: number; maxSide: number };
  keepFloor: boolean; onKeepFloor: (keep: boolean) => void; ready: boolean; takes: TakesState; onRecordTake: () => void;
}) {
  const takeFeature = useFeature("video-record", "Record a take: what you do in the viewer, rendered at 60 fps");
  const movFeature = useFeature("video-mov", "Lossless see-through MOV for video editors");
  const [choices, setChoices] = useState(readChoices);
  const [support, setSupport] = useState<VideoSupport | null>(null);
  useEffect(() => { let live = true; void videoSupport().then(s => { if (live) setSupport(s); }); return () => { live = false; }; }, []);
  // Re-read what would be recorded whenever the animator's state changes (an emote picked, ended, paused).
  useSyncExternalStore(listener => animator?.subscribe(listener) ?? (() => {}), () => animator?.state ?? null);
  const clip = animator?.recordable() ?? null;
  const change = (patch: Partial<VideoChoices>) => setChoices(current => { const next = { ...current, ...patch }; writeChoices(next); return next; });
  // The range belongs to the emote in front (the idle has no timeline: it records whole loops).
  const timeline = animator?.timeline() ?? null;
  const ranged = clip && timeline && timeline.clip === clip.clip ? timeline : null;
  const range = useVideoRange(ranged?.clip, ranged?.duration ?? 0, ranged?.frameTime);
  const exportRange: Partial<ExportRange> = { ...(range ?? {}), loops: choices.loops, speed: clip?.speed ?? 1 };

  const sizes = videoSizes(stage.width, stage.height, MAX_VIDEO_PIXELS, stage.maxSide);
  const size = sizes.find(s => s.height === choices.height) ?? [...sizes].reverse().find(s => s.height <= choices.height) ?? sizes[0];
  const available = (format: VideoFormat) => format === "png" || (format === "mov" ? !PHONE : support ? support[format] : false);
  const format = available(choices.format) ? choices.format : support ? (available("mp4") ? "mp4" : "png") : choices.format;
  const plan = clip ? framePlan(clip, FPS, exportRange) : null;
  const hasSound = !!clip && !!animator?.sounds.hasSound(clip.source);
  const soundPossible = ownEncoder(format) || (format === "webm" ? !!support?.opus : !!(support?.aac || support?.opus));
  const transparent = format !== "mp4";
  const running = job.running, progress = job.progress;
  const taking = choices.source === "take";
  const disabled = !ready || running || !clip || !size || !support || !available(format) || !!takes.recording;
  const renderTakeNow = (id: string) => {
    if (!size || !ready || !support || !available(format)) return;
    job.startTake(() => takes.input(id), { width: size.width, height: size.height, format, quality: choices.quality,
      sound: choices.sound && soundPossible, keepFloor }, () => takes.rendered(id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="What to record" className="grid grid-cols-2 gap-1.5">
        {([["emote", "Emote"], ["take", "Take"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={choices.source === id} disabled={running}
            onClick={() => change({ source: id })} {...(id === "take" ? takeFeature : {})}
            className="flex h-8 items-center justify-center gap-2 border border-line text-xs transition-colors hover:bg-ink-900 disabled:opacity-40 aria-checked:border-fg/60 aria-checked:bg-ink-900">
            {id === "take" && <span aria-hidden="true" className={`size-2 rounded-full bg-finals ${takes.recording ? "motion-safe:animate-pulse" : ""}`} />}
            {label}
          </button>
        ))}
      </div>
      {taking ? (
        <TakesSection takes={takes} busy={running || !ready} onRecord={onRecordTake} onRender={renderTakeNow} />
      ) : (<>
      <span className="text-xs leading-snug text-fg-muted">
        {clip && plan
          ? <><span className="text-fg">{clip.label}</span> · {plan.duration.toFixed(2)} s · {plan.frames} frames at {FPS} fps{clip.loop && plan.loops === 1 ? " (one loop)" : ""}
            {(range || plan.loops > 1 || plan.speed !== 1) && <span className="block">
              {range ? `Clip ${range.from.toFixed(2)}–${range.to.toFixed(2)} s` : clip.loop ? "Whole loops" : "The whole emote"}
              {plan.loops > 1 ? `, ${plan.loops} times` : ""}{plan.speed !== 1 ? `, at ${formatSpeed(plan.speed)} speed (the emote speed)` : ""}
            </span>}</>
          : "Play an emote, then record it here."}
      </span>
      {ranged && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="hud mr-auto text-fg-muted">Range</span>
            <NumberField label="Video start (seconds)" value={range?.from ?? 0} min={0} max={ranged.duration} decimals={2} disabled={running}
              onCommit={t => setRange(ranged.clip, moveMark(range, "from", t, ranged.duration, ranged.frameTime))} />
            <span className="text-fg-muted">to</span>
            <NumberField label="Video end (seconds)" value={range?.to ?? ranged.duration} min={0} max={ranged.duration} decimals={2} disabled={running}
              onCommit={t => setRange(ranged.clip, moveMark(range, "to", t, ranged.duration, ranged.frameTime))} />
            <span className="text-fg-muted">s</span>
            <button type="button" disabled={!range || running} onClick={() => setRange(ranged.clip, null)}
              className="h-8 border border-line px-2 text-xs text-fg-muted hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40">Whole</button>
          </div>
          <span className="text-[11px] leading-snug text-fg-muted">{PHONE ? (range ? "The part of the emote the video records." : "The whole emote. Type times to record a part of it.")
            : range ? "Also on the timeline: drag its red markers, or press I and O at a frame."
            : "The whole emote. Type times here, or turn on Video range on the timeline."}</span>
        </div>
      )}
      <label className="flex items-center justify-between gap-3">
        <span className="hud text-fg-muted">Loops</span>
        <NumberField label="Loops" value={choices.loops} min={1} max={MAX_LOOPS} decimals={0} disabled={running}
          onCommit={n => change({ loops: Math.round(n) })} />
      </label>
      </>)}
      <div role="radiogroup" aria-label="Video format" className="flex flex-col gap-1.5">
        {FORMATS.map(f => {
          const usable = available(f.id);
          return (
            <button key={f.id} type="button" role="radio" aria-checked={format === f.id} disabled={!usable || running}
              onClick={() => change({ format: f.id })} {...(f.id === "mov" ? movFeature : {})}
              className="flex flex-col items-start gap-0.5 border border-line px-2.5 py-1.5 text-left transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40 aria-checked:border-fg/60 aria-checked:bg-ink-900">
              <span className="text-xs font-semibold">{f.label}</span>
              <span className="text-[11px] leading-snug text-fg-muted">
                {usable || (!support && !ownEncoder(f.id)) ? f.detail
                  : f.id === "mov" ? "On a computer only: the files are too big for a phone. The PNG sequence works here."
                  : f.id === "webm" ? "This browser can’t encode VP9 video: use Chrome or Edge." : "This browser can’t encode video here: use the PNG sequence."}
              </span>
            </button>
          );
        })}
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
        <label className={`flex items-start gap-2 ${(taking || hasSound) && soundPossible ? "cursor-pointer" : "opacity-40"}`}>
          <input type="checkbox" checked={choices.sound && (taking || hasSound) && soundPossible} disabled={running || !(taking || hasSound) || !soundPossible}
            onChange={event => change({ sound: event.target.checked })} className="mt-0.5 size-4 cursor-pointer accent-finals" />
          <span className="flex flex-col">
            <span className="text-xs">Include sound</span>
            <span className="text-[11px] leading-snug text-fg-muted">{!soundPossible ? "This browser can’t encode sound for this format."
              : taking ? "The emotes’ own sound effects and music, at the game’s volume."
              : !clip ? "The emote’s own sound effects and music."
              : !hasSound ? "This emote has no sound." : "The emote’s own sound effects and music, at the game’s volume."}</span>
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
      ) : taking ? null : (
        <button type="button" disabled={disabled}
          onClick={() => size && job.start({ width: size.width, height: size.height, format, quality: choices.quality,
            sound: choices.sound && hasSound && soundPossible, keepFloor, range: exportRange })}
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

/** A number typed in full before it applies: on Enter or leaving the field, clamped; anything else reverts. */
function NumberField({ label, value, min, max, decimals, disabled, onCommit }: {
  label: string; value: number; min: number; max: number; decimals: number; disabled?: boolean; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null); // null: not being edited, shows the value
  const commit = () => {
    if (text === null) return;
    const n = Number(text);
    setText(null);
    if (text.trim() !== "" && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
  };
  return (
    <input type="number" inputMode="decimal" aria-label={label} min={min} max={max} step="any" disabled={disabled}
      value={text ?? value.toFixed(decimals)} onChange={event => setText(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") commit(); else if (event.key === "Escape") setText(null); }}
      className="h-8 w-16 border border-line bg-ink-900 px-2 text-right text-xs tabular-nums text-fg disabled:opacity-40" />
  );
}
