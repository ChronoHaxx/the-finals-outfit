import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { effectiveTier, HITCH, judgeWindow, TIER_INFO, TIERS, useGraphicsStore, WARMUP_FRAMES, WINDOW_FRAMES, type GraphicsChoice } from "../lib/graphics-quality";

/** What the Auto measurer needs from the still-view accumulator: whether this frame took the moving path. */
export interface TemporalStatusRef { current: { motion: boolean } | null }

/**
 * Canvas child (6 Nov 2026): Auto's frame-time measurer (rules in src/lib/graphics-quality.ts). It only counts frames
 * where the view was moving (a still view stops drawing once converged), skips hidden-tab frames and single hitches,
 * waits until the outfit has loaded (`active`: an outfit still streaming in made a fast desktop step down within
 * seconds, 6 Nov), and ignores WARMUP_FRAMES moving frames after that and after any tier change (shader compiles, new
 * render targets).
 */
export function AutoGraphics({ status, active }: { status: TemporalStatusRef; active: boolean }) {
  const gl = useThree(state => state.gl);
  const choice = useGraphicsStore(state => state.choice);
  const tier = useGraphicsStore(effectiveTier);
  const frames = useRef<number[]>([]);
  const warmup = useRef(WARMUP_FRAMES);
  // The device key: renderer string, pixel ratio and screen size (Auto's result is remembered per device).
  useEffect(() => {
    const context = gl.getContext();
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
    useGraphicsStore.getState().setDevice(`${renderer}|${globalThis.devicePixelRatio ?? 1}|${screen.width}x${screen.height}`);
  }, [gl]);
  useEffect(() => { frames.current = []; warmup.current = WARMUP_FRAMES; }, [tier, choice, active]);
  useFrame((_, delta) => {
    if (!active || choice !== "auto" || document.hidden || !status.current?.motion || delta > HITCH) return;
    if (warmup.current > 0) { warmup.current--; return; }
    frames.current.push(delta);
    if (frames.current.length < WINDOW_FRAMES) return;
    const store = useGraphicsStore.getState();
    const next = judgeWindow(store.auto, frames.current);
    frames.current = [];
    if (next.tier !== store.auto.tier || next.settled !== store.auto.settled || next.cpuBound !== store.auto.cpuBound
      || next.slowWindows !== store.auto.slowWindows || next.previous !== store.auto.previous) store.setAuto(next);
  });
  return null;
}

/** The Graphics dropdown beside the lighting button: Auto (showing the tier it chose) or a fixed tier. */
export function GraphicsMenu() {
  const choice = useGraphicsStore(state => state.choice);
  const auto = useGraphicsStore(state => state.auto);
  const setChoice = useGraphicsStore(state => state.setChoice);
  const autoDetail = auto.cpuBound ? "kept: this device is limited by its processor, not graphics" : TIER_INFO[auto.tier].detail;
  return (
    <label className="hud flex h-8 items-center gap-2 bg-ink-950/80 pl-3 pr-1 text-fg transition-colors hover:bg-ink-950"
      title={choice === "auto" ? `Auto chose ${TIER_INFO[auto.tier].label}: ${autoDetail}` : TIER_INFO[choice].detail}>
      <span>Graphics</span>
      <select
        aria-label="Graphics quality"
        value={choice}
        onChange={event => setChoice(event.target.value as GraphicsChoice)}
        className="h-7 cursor-pointer bg-transparent pr-1 text-fg outline-none focus-visible:ring-1 focus-visible:ring-fg/60 [&>option]:bg-ink-950"
      >
        <option value="auto">Auto · {TIER_INFO[auto.tier].label}</option>
        {TIERS.map(tier => <option key={tier} value={tier}>{TIER_INFO[tier].label}</option>)}
      </select>
    </label>
  );
}
