import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { captureView, compositeOver, isBlank, paintBackdrop, screenshotSizes, type ScreenshotContext } from "../rig/ViewerScreenshot";
import { encodePngAsync } from "../lib/png-encode";
import { backdropCss, backdropPaint, type SceneTheme } from "../lib/stage-lighting";
import { CameraIcon } from "./Icons";

// GPU memory while capturing is about 24 bytes per pixel (the accumulator's half-float targets and depth, and the
// image): ~150 MB at the desktop cap, ~60 MB on phones and tablets. A phone is told apart by its primary pointer
// (a touch-screen laptop also reports touch points, and has a laptop's memory).
const PHONE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const MAX_PIXELS = PHONE ? 2_600_000 : 6_300_000;

// The panel's choices, remembered in this browser (read-modify-write: unknown fields survive). View preferences only.
const KEY = "finals-outfit.screenshot";
interface Choices { transparent: boolean; keepFloor: boolean; scale: number }
const DEFAULTS: Choices = { transparent: false, keepFloor: false, scale: 2 };
function readChoices(): Choices {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Choices>;
    return {
      transparent: typeof stored.transparent === "boolean" ? stored.transparent : DEFAULTS.transparent,
      keepFloor: typeof stored.keepFloor === "boolean" ? stored.keepFloor : DEFAULTS.keepFloor,
      scale: typeof stored.scale === "number" && Number.isFinite(stored.scale) ? stored.scale : DEFAULTS.scale,
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

/**
 * Save the view as a PNG (12 Nov 2026): on its backdrop, or with a transparent background (no backdrop, no floor
 * shadow unless kept). Lighting is the screen's (rig/ViewerScreenshot.ts). Built like the Lighting panel: a button in
 * the viewer's top row and a panel anchored to that row.
 */
export function ScreenshotPanel({ context, theme, backdropId, ready }: {
  context: RefObject<ScreenshotContext | null>; theme: SceneTheme; backdropId: string; ready: boolean;
}) {
  const backdrop = backdropCss(theme, backdropId);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState(readChoices);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState({ width: 0, height: 0, maxSide: 4096 });
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

  const save = async () => {
    const ctx = context.current;
    if (!ctx || !size || running) return;
    setRunning(true);
    setStatus("Rendering…");
    // Let the status paint before the synchronous render holds the page. (A playing emote is caught at the frame on
    // screen: the render is synchronous, so no animation step runs inside it.)
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const capture = await captureView(ctx, size.width, size.height, choices);
      if (isBlank(capture.pixels)) throw new Error("Nothing was drawn");
      setStatus("Encoding…");
      const rgba = capture.straight ? capture.pixels
        : compositeOver(capture.pixels, paintBackdrop(capture.width, capture.height, backdropPaint(theme, backdropId)));
      const png = await encodePngAsync(capture.width, capture.height, rgba);
      const name = `finals-outfit-${stamp()}${capture.straight ? "-transparent" : ""}.png`;
      const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Saved ${capture.width} × ${capture.height}${capture.samples < 32 ? " (some grain: the scene kept changing)" : ""}`);
    } catch (error) {
      console.error("[screenshot]", error);
      setStatus(`Couldn’t save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), as the Lighting panel's does.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        aria-label="Screenshot" title="Save a screenshot (PNG)"
        className="hud flex h-8 w-8 items-center justify-center bg-ink-950/80 text-fg transition-colors hover:bg-ink-950">
        <CameraIcon size={15} />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Screenshot"
          className="absolute right-0 top-9 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-3 border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">
          <div className="flex flex-col gap-1.5">
            <span className="hud text-fg-muted">Background</span>
            <div role="radiogroup" aria-label="Background" className="grid grid-cols-2 gap-1.5">
              {([[false, "Backdrop"], [true, "Transparent"]] as const).map(([transparent, label]) => (
                <button key={label} type="button" role="radio" aria-checked={choices.transparent === transparent}
                  onClick={() => change({ transparent })}
                  className="flex h-8 items-center justify-center gap-2 border border-line text-xs transition-colors hover:bg-ink-900 aria-checked:border-fg/60 aria-checked:bg-ink-900">
                  <span aria-hidden="true" className={`size-3 border border-fg/40 ${transparent ? "checker" : ""}`}
                    style={transparent ? undefined : { background: backdrop }} />
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs leading-snug text-fg-muted">{choices.transparent
              ? "PNG with alpha, no backdrop or floor: lay it over anything. Same lighting as on screen."
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
          <button type="button" onClick={save} disabled={!ready || running || !size}
            title={ready ? undefined : "Wait for the outfit to finish loading"}
            className="flex h-9 items-center justify-center gap-2 bg-fg px-3 text-xs font-semibold text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
            <CameraIcon size={14} />{running ? "Saving…" : "Save PNG"}
          </button>
          <span role="status" aria-live="polite" className="min-h-4 text-xs leading-snug text-fg-muted">
            {ready ? status : "Waiting for the outfit to finish loading."}
          </span>
        </div>
      )}
    </div>
  );
}
