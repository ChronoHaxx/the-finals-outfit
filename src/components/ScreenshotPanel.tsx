import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { captureView, isBlank, screenshotSizes, SCREENSHOT_SUPERSAMPLE, type ScreenshotContext } from "../rig/ViewerScreenshot";
import type { RigAnimator } from "../rig/RigAnimator";
import { encodePngAsync } from "../lib/png-encode";
import { backdropCss, backdropPaint, type Backdrop } from "../lib/stage-lighting";
import { sceneById } from "../lib/scenes";
import { CameraIcon, CopyIcon, VideoIcon } from "./Icons";
import { CAPTURE_TILE, VideoTab, useVideoExport } from "./VideoCapture";

// The output image: GPU memory is bounded by the capture's tile (CAPTURE_TILE), so this budget is for the image itself,
// its read-back and its PNG encoding (a few bytes per pixel, several copies): ~25 MB per copy at the desktop cap, ~10
// MB on phones and tablets. A phone is told apart by its primary pointer (a touch-screen laptop also reports touch
// points, and has a laptop's memory).
const PHONE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const MAX_PIXELS = PHONE ? 2_600_000 : 6_300_000;

// The panel's choices, remembered in this browser (read-modify-write: unknown fields survive). View preferences only.
const KEY = "finals-outfit.screenshot";
type Tab = "image" | "video";
interface Choices { transparent: boolean; keepFloor: boolean; scale: number; tab: Tab }
const DEFAULTS: Choices = { transparent: false, keepFloor: false, scale: 2, tab: "image" };
function readChoices(): Choices {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Choices>;
    return {
      transparent: typeof stored.transparent === "boolean" ? stored.transparent : DEFAULTS.transparent,
      keepFloor: typeof stored.keepFloor === "boolean" ? stored.keepFloor : DEFAULTS.keepFloor,
      scale: typeof stored.scale === "number" && Number.isFinite(stored.scale) ? stored.scale : DEFAULTS.scale,
      tab: stored.tab === "video" ? "video" : "image",
    };
  } catch { return DEFAULTS; }
}
function writeChoices(choices: Choices) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...(stored && typeof stored === "object" ? stored : {}), ...choices }));
  } catch { /* not remembered */ }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// Copy to the clipboard (15 Nov 2026): offered where the browser can put a PNG there (a secure page with ClipboardItem;
// browsers that can say which types they take must list image/png).
const CAN_COPY = typeof window !== "undefined" && window.isSecureContext && typeof ClipboardItem !== "undefined"
  && typeof navigator.clipboard?.write === "function"
  && (typeof ClipboardItem.supports !== "function" || ClipboardItem.supports("image/png"));

type Output = "save" | "copy";

/**
 * Capture the view (12 Nov 2026): a PNG on its backdrop or with a transparent background (no backdrop, no floor shadow
 * unless kept), saved or copied to the clipboard (15 Nov), 2x supersampled (21 Nov); or the emote in front as a video
 * (21 Nov, VideoCapture.tsx). Lighting is the screen's (rig/ViewerScreenshot.ts). Built like the Lighting panel: a button
 * in the viewer's top row and a panel anchored to that row. A video keeps rendering with the panel closed; the button
 * then shows its progress.
 */
export function ScreenshotPanel({ context, backdrop, ready, animator }: {
  context: RefObject<ScreenshotContext | null>; backdrop: Backdrop; ready: boolean; animator: RigAnimator | null;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState(readChoices);
  const [running, setRunning] = useState<Output | null>(null);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState({ width: 0, height: 0, maxSide: 4096 });
  const [viewerHeight, setViewerHeight] = useState(0); // the panel scrolls inside the viewer, as the Lighting panel does
  const video = useVideoExport(context, animator, backdrop);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const change = (patch: Partial<Choices>) => setChoices(current => {
    const next = { ...current, ...patch };
    writeChoices(next);
    return next;
  });

  useEffect(() => {
    if (!open) return;
    const viewer = root.current?.closest("[data-viewer]");
    if (viewer) setViewerHeight(viewer.clientHeight);
    const canvas = context.current?.gl.domElement;
    if (canvas) setStage({ width: canvas.clientWidth, height: canvas.clientHeight,
      maxSide: context.current!.gl.capabilities.maxTextureSize });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, context]);

  const sizes = screenshotSizes(stage.width, stage.height, MAX_PIXELS, stage.maxSide);
  // The remembered scale if it fits this stage, else the largest that does up to it.
  const size = sizes.find(s => s.scale === choices.scale) ?? [...sizes].reverse().find(s => s.scale <= choices.scale) ?? sizes[0];
  const busy = !!running || video.running; // one capture at a time: both draw through the same renderer

  // Render and encode the PNG. Waits a frame first so the status paints before the synchronous render holds the page.
  // (A playing emote is caught at the frame on screen: the render is synchronous, so no animation step runs inside it.)
  const render = async (ctx: ScreenshotContext, width: number, height: number) => {
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const capture = await captureView(ctx, width, height, { transparent: choices.transparent, keepFloor: choices.keepFloor,
      backdrop: backdropPaint(backdrop), maxTile: CAPTURE_TILE });
    if (isBlank(capture.pixels)) throw new Error("Nothing was drawn");
    setStatus("Encoding…");
    const png = await encodePngAsync(capture.width, capture.height, capture.pixels);
    return { capture, blob: new Blob([png as BlobPart], { type: "image/png" }) };
  };

  // Not async itself: a copy must start its clipboard write inside the click (browsers allow it only during a user
  // gesture), so it hands the clipboard a promised PNG now and the render fills it in.
  const run = (output: Output) => {
    const ctx = context.current;
    if (!ctx || !size || busy) return;
    setRunning(output);
    setStatus("Rendering…");
    const job = render(ctx, size.width, size.height);
    const copied = output === "copy"
      ? navigator.clipboard.write([new ClipboardItem({ "image/png": job.then(result => result.blob) })]) : null;
    copied?.catch(() => { /* reported below, through the await */ });
    void (async () => {
      try {
        const { capture, blob } = await job;
        const dimensions = `${capture.width} × ${capture.height}`;
        if (copied) {
          await copied;
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `finals-outfit-${stamp()}${capture.straight ? "-transparent" : ""}.png`;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        setStatus(`${copied ? `Copied ${dimensions} to the clipboard` : `Saved ${dimensions}`}${capture.samples < capture.wantedSamples ? " (some grain: the scene kept changing)" : ""}`);
      } catch (error) {
        console.error("[screenshot]", error);
        const blocked = error instanceof DOMException && error.name === "NotAllowedError";
        setStatus(output === "copy"
          ? `Couldn’t copy: ${blocked ? "the browser didn’t allow the clipboard. Save PNG works instead." : error instanceof Error ? error.message : String(error)}`
          : `Couldn’t save: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setRunning(null);
      }
    })();
  };

  const percent = video.progress?.frames ? Math.floor(100 * video.progress.frame / video.progress.frames) : 0;
  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), as the Lighting panel's does.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        aria-label={video.running ? `Capture: recording video, ${percent}%` : "Capture"}
        title={video.running ? "Recording a video: open to see progress or cancel" : "Save a screenshot or an emote video"}
        className={`hud flex h-8 items-center justify-center gap-1.5 bg-ink-950/80 text-fg transition-colors hover:bg-ink-950 ${video.running ? "px-2.5" : "w-8"}`}>
        {video.running ? <><span aria-hidden="true" className="size-2 rounded-full bg-finals motion-safe:animate-pulse" />{percent}%</> : <CameraIcon size={15} />}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Capture"
          style={viewerHeight ? { maxHeight: viewerHeight - 56 } : undefined}
          className="absolute right-0 top-9 z-30 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">
          <div role="tablist" aria-label="Capture type" className="grid grid-cols-2 gap-1.5">
            {([["image", "Image", CameraIcon], ["video", "Video", VideoIcon]] as const).map(([tab, label, Icon]) => (
              <button key={tab} type="button" role="tab" aria-selected={choices.tab === tab} onClick={() => change({ tab })}
                className="flex h-8 items-center justify-center gap-2 border border-line text-xs transition-colors hover:bg-ink-900 aria-selected:border-fg/60 aria-selected:bg-ink-900">
                <Icon size={14} />{label}
              </button>
            ))}
          </div>
          {choices.tab === "video" ? (<>
            {/* An in-game scene (scenes.ts) is drawn outside this canvas, so an MP4 gets the scene's colours instead. */}
            {sceneById(backdrop.scene) && <span className="text-xs leading-snug text-fg-muted">
              MP4 is on the scene’s colours: the scene itself isn’t in videos yet.</span>}
            <VideoTab job={video} animator={animator} stage={stage} keepFloor={choices.keepFloor}
              onKeepFloor={keepFloor => change({ keepFloor })} ready={ready && !running} />
          </>) : (<>
            <div className="flex flex-col gap-1.5">
              <span className="hud text-fg-muted">Background</span>
              <div role="radiogroup" aria-label="Background" className="grid grid-cols-2 gap-1.5">
                {([[false, "Backdrop"], [true, "Transparent"]] as const).map(([transparent, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={choices.transparent === transparent}
                    onClick={() => change({ transparent })}
                    className="flex h-8 items-center justify-center gap-2 border border-line text-xs transition-colors hover:bg-ink-900 aria-checked:border-fg/60 aria-checked:bg-ink-900">
                    <span aria-hidden="true" className={`size-3 border border-fg/40 ${transparent ? "checker" : ""}`}
                      style={transparent ? undefined : { background: backdropCss(backdrop) }} />
                    {label}
                  </button>
                ))}
              </div>
              {/* An in-game scene (scenes.ts) is drawn outside this canvas, so the PNG gets the scene's colours instead. */}
              <span className="text-xs leading-snug text-fg-muted">{choices.transparent
                ? "PNG with alpha, no backdrop or floor: lay it over anything. Same lighting as on screen."
                : sceneById(backdrop.scene)
                  ? "On the scene’s colours: the scene itself isn’t in screenshots yet."
                  : "As on screen, with the backdrop."}</span>
            </div>
            {choices.transparent && (
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={choices.keepFloor} onChange={event => change({ keepFloor: event.target.checked })}
                  className="mt-0.5 size-4 cursor-pointer accent-finals" />
                <span className="flex flex-col">
                  <span>Keep ground shadow</span>
                  <span className="text-xs leading-snug text-fg-muted">The soft shadow under the feet, as see-through black.</span>
                </span>
              </label>
            )}
            <label className="flex items-center justify-between gap-3">
              <span className="hud text-fg-muted">Size</span>
              <select aria-label="Screenshot size" value={size?.scale ?? 1} onChange={event => change({ scale: Number(event.target.value) })}
                className="select-plain h-8 border border-line bg-ink-900 pl-2.5 text-xs text-fg-muted">
                {sizes.map(s => <option key={s.scale} value={s.scale}>
                  {Number.isInteger(s.scale) ? `${s.scale}×` : "Fit"} · {s.width} × {s.height}
                </option>)}
              </select>
            </label>
            <span className="-mt-2 text-xs leading-snug text-fg-muted">
              Drawn at {SCREENSHOT_SUPERSAMPLE}× that size and scaled down, for clean edges and fine detail.
            </span>
            <div className={`grid gap-1.5 ${CAN_COPY ? "grid-cols-2" : ""}`}>
              {CAN_COPY && (
                <button type="button" onClick={() => run("copy")} disabled={!ready || busy || !size}
                  title={ready ? "Copy the image to the clipboard, to paste it anywhere" : "Wait for the outfit to finish loading"}
                  className="flex h-9 items-center justify-center gap-2 border border-fg/40 px-3 text-xs font-semibold text-fg hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40">
                  <CopyIcon size={14} />{running === "copy" ? "Copying…" : "Copy"}
                </button>
              )}
              <button type="button" onClick={() => run("save")} disabled={!ready || busy || !size}
                title={ready ? "Download the PNG" : "Wait for the outfit to finish loading"}
                className="flex h-9 items-center justify-center gap-2 bg-fg px-3 text-xs font-semibold text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
                <CameraIcon size={14} />{running === "save" ? "Saving…" : "Save PNG"}
              </button>
            </div>
            <span role="status" aria-live="polite" className="min-h-4 text-xs leading-snug text-fg-muted">
              {!ready ? "Waiting for the outfit to finish loading." : video.running ? "A video is rendering; screenshots wait for it." : status}
            </span>
          </>)}
        </div>
      )}
    </div>
  );
}
