import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Vector2 } from "three";
import {
  AA_INFO, ANTI_ALIASING, autoMeasuring, effectiveTier, HITCH, judgeWindow, percentile, renderDpr, RESOLUTION_SCALES, TIER_INFO,
  TIERS, useGraphicsStore, WARMUP_FRAMES, WINDOW_FRAMES, type AntiAliasing, type GraphicsChoice, type ResolutionChoice,
} from "../lib/graphics-quality";
import { scriptSpeedMs } from "../lib/script-speed";

/** What the Auto measurer and the FPS counter read from the still-view accumulator (StableFrameAccumulator.status). */
export interface TemporalStatus {
  motion: boolean; animating: boolean; active: boolean; samples: number; maxSamples: number;
  width: number; height: number; msaa: number; reprojected: boolean;
}
export interface TemporalStatusRef { current: TemporalStatus | null }

/** The screen's device pixel ratio, kept current (browser zoom, a window dragged to another monitor). */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    // A resolution media query matches only the current ratio, so it fires once when the ratio changes; re-arm then.
    let query: MediaQueryList | null = null;
    const arm = () => {
      query?.removeEventListener("change", arm);
      setDpr(window.devicePixelRatio || 1);
      query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
      query?.addEventListener("change", arm);
    };
    arm();
    return () => query?.removeEventListener("change", arm);
  }, []);
  return dpr;
}

/**
 * Canvas child (6 Nov 2026): Auto's frame-time measurer (rules in src/lib/graphics-quality.ts). It only counts frames
 * where the view was moving (a still view stops drawing once converged), skips hidden-tab frames and single hitches,
 * waits until the outfit has loaded (`active`: an outfit still streaming in made a fast desktop step down within
 * seconds, 6 Nov), and ignores WARMUP_FRAMES moving frames after that and after any tier change (shader compiles, new
 * render targets). A resolution picked by hand stops it: stepping the preset would change nothing (10 Nov).
 */
export function AutoGraphics({ status, active, deviceDpr }: { status: TemporalStatusRef; active: boolean; deviceDpr: number }) {
  const gl = useThree(state => state.gl);
  const choice = useGraphicsStore(state => state.choice);
  const measuring = useGraphicsStore(autoMeasuring);
  const tier = useGraphicsStore(effectiveTier);
  const aa = useGraphicsStore(state => state.aa);
  const frames = useRef<number[]>([]);
  const warmup = useRef(WARMUP_FRAMES);
  // The device key: renderer string, pixel ratio and screen size (Auto's result is remembered per device).
  useEffect(() => {
    useGraphicsStore.getState().setDevice(`${rendererName(gl)}|${globalThis.devicePixelRatio ?? 1}|${screen.width}x${screen.height}`);
  }, [gl]);
  useEffect(() => { frames.current = []; warmup.current = WARMUP_FRAMES; }, [tier, choice, active, measuring, aa, deviceDpr]);
  useFrame((_, delta) => {
    const moving = !!status.current && (status.current.motion || status.current.animating);
    if (!active || !measuring || document.hidden || !moving || delta > HITCH) return;
    if (warmup.current > 0) { warmup.current--; return; }
    frames.current.push(delta);
    if (frames.current.length < WINDOW_FRAMES) return;
    const store = useGraphicsStore.getState();
    const next = judgeWindow(store.auto, frames.current, deviceDpr);
    frames.current = [];
    if (next.tier !== store.auto.tier || next.settled !== store.auto.settled || next.cpuBound !== store.auto.cpuBound
      || next.slowWindows !== store.auto.slowWindows || next.previous !== store.auto.previous) store.setAuto(next);
  });
  return null;
}

function rendererName(gl: { getContext: () => WebGLRenderingContext | WebGL2RenderingContext }): string {
  const context = gl.getContext();
  const info = context.getExtension("WEBGL_debug_renderer_info");
  return String(info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
}

// ---- FPS counter (10 Nov 2026) ------------------------------------------------------------------------------------
// The meter is a Canvas child; the overlay is ordinary DOM over the viewer. Readings pass through this small store, so
// a reading twice a second re-renders the overlay only, not the viewer.
export interface FpsReading {
  fps: number; frameMs: number; p95Ms: number; scriptMs: number;
  width: number; height: number; dpr: number; state: string; renderer: string; msaa: number;
}
let reading: FpsReading | null = null;
const listeners = new Set<() => void>();
const publish = (next: FpsReading | null) => { reading = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/**
 * Canvas child: measures frame rate and per-frame JavaScript time. The frame starts at the earliest useFrame (priority
 * -1000); a microtask queued there runs once react-three-fiber's whole frame callback has returned, after the scene was
 * submitted, so the gap is the frame's script time (GPU time is not included; it runs in parallel). A positive priority
 * is avoided on purpose: it would switch off react-three-fiber's own render when the accumulator is not mounted.
 */
export function FpsMeter({ status }: { status: TemporalStatusRef }) {
  const gl = useThree(state => state.gl);
  const samples = useRef({ starts: [] as number[], scripts: [] as number[], since: 0 });
  useEffect(() => () => publish(null), []);
  useFrame(() => {
    const now = performance.now(), s = samples.current;
    s.starts.push(now);
    queueMicrotask(() => s.scripts.push(performance.now() - now));
    if (!s.since) s.since = now;
    if (now - s.since < 500 || s.starts.length < 3) return;
    const deltas = s.starts.slice(1).map((t, i) => t - s.starts[i]);
    const temporal = status.current;
    const size = gl.getDrawingBufferSize(new Vector2());
    publish({
      fps: (deltas.length * 1000) / (now - s.starts[0]),
      frameMs: percentile(deltas, 0.5), p95Ms: percentile(deltas, 0.95), scriptMs: percentile(s.scripts, 0.5),
      width: size.x, height: size.y, dpr: gl.getPixelRatio(), renderer: rendererName(gl), msaa: temporal?.msaa ?? 0,
      state: !temporal?.active ? "direct" : temporal.motion ? (temporal.reprojected ? "moving · motion vectors" : "moving")
        : temporal.animating ? "moving · fresh frames" : temporal.samples < temporal.maxSamples ? `settling ${temporal.samples}/${temporal.maxSamples}` : "still",
    });
    s.starts = [now]; s.scripts = []; s.since = now;
  }, -1000);
  return null;
}

export function FpsOverlay() {
  const current = useSyncExternalStore(subscribe, () => reading, () => null);
  const choice = useGraphicsStore(state => state.choice);
  const tier = useGraphicsStore(effectiveTier);
  const aa = useGraphicsStore(state => state.aa);
  const resolution = useGraphicsStore(state => state.resolution);
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  if (!current) return null;
  const diagnostics = () => [
    "THE FINALS Outfit Builder · graphics diagnostics",
    `Browser: ${navigator.userAgent}`,
    `Renderer: ${current.renderer}`,
    `Screen: ${screen.width}x${screen.height} @ ${window.devicePixelRatio}x`,
    `Canvas: ${current.width}x${current.height} (${current.dpr.toFixed(2)}x)`,
    `Graphics: ${choice === "auto" ? `Auto (${tier})` : tier}, AA ${aa}${current.msaa ? ` ${current.msaa}x` : ""}, resolution ${resolution === "auto" ? "auto" : `${Math.round(resolution * 100)}%`}`,
    `Frames: ${current.fps.toFixed(1)} fps, median ${current.frameMs.toFixed(1)} ms, p95 ${current.p95Ms.toFixed(1)} ms, script ${current.scriptMs.toFixed(1)} ms (${current.state})`,
    `Script speed test: ${scriptSpeedMs().toFixed(1)} ms; WebAssembly: ${typeof WebAssembly === "object" ? "yes" : "no"}`,
  ].join("\n");
  const copy = () => {
    navigator.clipboard?.writeText(diagnostics()).then(() => setCopied("copied"), () => setCopied("failed"))
      ?? setCopied("failed");
    window.setTimeout(() => setCopied(""), 2500);
  };
  return (
    <div className="pointer-events-auto flex flex-col gap-0.5 bg-ink-950/85 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-fg tabular-nums"
      aria-label="Frame rate">
      <span><b className="text-fg">{Math.round(current.fps)} fps</b> · {current.frameMs.toFixed(1)} ms · p95 {current.p95Ms.toFixed(1)}</span>
      <span className="text-fg-muted">script {current.scriptMs.toFixed(1)} ms · {current.width}×{current.height}</span>
      <span className="text-fg-muted">{AA_INFO[aa].label}{current.msaa ? ` ${current.msaa}x` : ""} · {TIER_INFO[tier].label}{choice === "auto" ? " (Auto)" : ""} · {current.state}</span>
      <button type="button" onClick={copy} className="hud mt-1 self-start text-[10px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        title="Copy browser, graphics card and frame-time details, for a bug report">
        {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy diagnostics"}
      </button>
    </div>
  );
}

// ---- The Graphics menu ----------------------------------------------------------------------------------------------

const resolutionLabel = (scale: number) => `${Math.round(scale * 100)}%`;

/**
 * The Graphics button beside the lighting button (6 Nov 2026; a panel since 10 Nov): the quality preset (Auto, showing
 * the preset it chose, or a fixed one), anti-aliasing, a resolution override and the FPS counter. Every choice is saved
 * for this browser (lib/graphics-quality).
 */
export function GraphicsMenu({ deviceDpr }: { deviceDpr: number }) {
  const choice = useGraphicsStore(state => state.choice);
  const auto = useGraphicsStore(state => state.auto);
  const tier = useGraphicsStore(effectiveTier);
  const aa = useGraphicsStore(state => state.aa);
  const resolution = useGraphicsStore(state => state.resolution);
  const showFps = useGraphicsStore(state => state.showFps);
  const { setChoice, setAa, setResolution, setShowFps } = useGraphicsStore.getState();
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const element = root.current?.closest("[data-viewer]");
    if (element) setViewer({ width: element.clientWidth, height: element.clientHeight });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const pixels = (dpr: number) => viewer.width ? ` · ${Math.round(viewer.width * dpr)}×${Math.round(viewer.height * dpr)}` : "";
  const autoDetail = auto.cpuBound ? "kept, because this device is limited by its processor, not graphics" : TIER_INFO[auto.tier].detail;
  const presetDetail = resolution !== "auto" ? "The resolution below is set by hand, so the preset changes nothing."
    : choice === "auto" ? `Auto picked ${TIER_INFO[auto.tier].label} for this device: ${autoDetail}.`
    : `${TIER_INFO[choice].detail[0].toUpperCase()}${TIER_INFO[choice].detail.slice(1)}.`;
  const summary = `${choice === "auto" ? "Auto · " : ""}${TIER_INFO[tier].label}${resolution !== "auto" ? ` · ${resolutionLabel(resolution)}` : ""}`;

  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), so on a phone, where this
    // button sits mid-row, it still opens within the screen.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        className="hud flex h-8 items-center gap-2 bg-ink-950/80 px-3 text-fg transition-colors hover:bg-ink-950"
        title="Graphics settings">
        <span>Graphics</span>
        {/* The summary lives in the panel too: on a narrow stage (a phone, or beside the items drawer) the top row needs
            the room (12 Nov: hide-UI and screenshot buttons). The viewer's overlay frame is the size container. */}
        <span className="hidden whitespace-nowrap text-fg-muted @lg:inline">{summary}</span>
        <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Graphics settings"
          style={viewer.height ? { maxHeight: viewer.height - 56 } : undefined}
          className="absolute right-0 top-9 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">
          <label className="flex flex-col gap-1">
            <span className="hud text-fg-muted">Quality</span>
            <select aria-label="Graphics quality" value={choice} onChange={event => setChoice(event.target.value as GraphicsChoice)}
              className="h-8 cursor-pointer border border-line bg-ink-900 px-2 text-fg outline-none focus-visible:ring-1 focus-visible:ring-fg/60">
              <option value="auto">Auto · {TIER_INFO[auto.tier].label}</option>
              {TIERS.map(option => <option key={option} value={option}>{TIER_INFO[option].label}</option>)}
            </select>
            <span className="text-xs leading-snug text-fg-muted">{presetDetail}</span>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="hud mb-1 text-fg-muted">Anti-aliasing</legend>
            <div className="grid grid-cols-3 border border-line">
              {ANTI_ALIASING.map(mode => (
                <label key={mode} className={`flex h-8 cursor-pointer items-center justify-center text-xs transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-fg/60 ${aa === mode ? "bg-fg text-ink-950" : "bg-ink-900 text-fg hover:bg-ink-950"}`}>
                  <input type="radio" name={`${panelId}-aa`} value={mode} checked={aa === mode} onChange={() => setAa(mode as AntiAliasing)} className="sr-only" />
                  {AA_INFO[mode].label}
                </label>
              ))}
            </div>
            <span className="text-xs leading-snug text-fg-muted">{AA_INFO[aa].detail}.</span>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="hud text-fg-muted">Resolution</span>
            <select aria-label="Render resolution" value={String(resolution)}
              onChange={event => setResolution(event.target.value === "auto" ? "auto" : Number(event.target.value) as ResolutionChoice)}
              className="h-8 cursor-pointer border border-line bg-ink-900 px-2 text-fg outline-none focus-visible:ring-1 focus-visible:ring-fg/60">
              <option value="auto">Auto (from Quality){pixels(renderDpr(tier, "auto", deviceDpr))}</option>
              {RESOLUTION_SCALES.map(scale => (
                <option key={scale} value={String(scale)}>{resolutionLabel(scale)}{pixels(renderDpr(tier, scale, deviceDpr))}</option>
              ))}
            </select>
            <span className="text-xs leading-snug text-fg-muted">Percent of this screen's own pixels. Lower is faster and softer.</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={showFps} onChange={event => setShowFps(event.target.checked)} className="size-4 accent-[var(--color-fg)]" />
            <span>Show FPS counter</span>
          </label>
        </div>
      )}
    </div>
  );
}
