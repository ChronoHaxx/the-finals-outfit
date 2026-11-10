import { create } from "zustand";

/**
 * Graphics settings (6 Nov 2026, reworked 10 Nov): a quality preset (High / Balanced / Low, or Auto, the default, which
 * picks one from how fast this device actually draws the moving view), an anti-aliasing mode, a resolution override and
 * an FPS counter.
 *
 * Presets. Since 10 Nov every preset averages the moving view with motion vectors (StableFrameAccumulator, VelocityPass):
 * the screen-locked average that Balanced and Low used before smeared anything moving, worst on fine print at 1x pixel
 * density (feedback: garment text ghosted on Low while the idle played). The presets now differ only in how many pixels
 * they draw: High up to 2x pixel density, Balanced up to 1.5x, Low 1x.
 *
 * Auto (rules from a Fable review, 6 Nov): it judges the slow frames, the 95th percentile of frame times, not the
 * average, against a 60 fps target (a 120 Hz screen that holds 60 is fine). It measures only while the view is moving
 * (a still view stops drawing once converged), skips warm-up frames and hidden-tab frames, and within a session it
 * only ever steps down, after two slow windows in a row (a heavy outfit, a phone heating up; one window alone can be
 * a passing spike of background load). A step goes to the next preset that draws fewer pixels on this screen (on a 1x
 * screen all three draw the same, so there is nothing to step to). A step that did not make frames faster means the
 * processor, not the graphics card, is the limit: it is undone and Auto stops lowering the visuals. The result is
 * remembered for this device (renderer, pixel ratio and screen size). A preset the viewer picks by hand always wins and
 * is remembered too; a resolution picked by hand overrides the preset's and Auto stops measuring.
 */
export type GraphicsTier = "high" | "balanced" | "low";
export type GraphicsChoice = "auto" | GraphicsTier;
export const TIERS: readonly GraphicsTier[] = ["high", "balanced", "low"];
export const TIER_INFO: Record<GraphicsTier, { label: string; detail: string; maxDpr: number }> = {
  high: { label: "High", detail: "sharpest, up to 2x pixel density", maxDpr: 2 },
  balanced: { label: "Balanced", detail: "up to 1.5x pixel density", maxDpr: 1.5 },
  low: { label: "Low", detail: "1x pixel density, for slower devices", maxDpr: 1 },
};

/**
 * Anti-aliasing. TAA: jittered samples averaged over time (motion vectors while moving), smooth edges and smooth
 * see-through hair, a little softer. MSAA: 4 samples per pixel on geometry edges, no jitter and no history while
 * moving; see-through hair is dotted while moving and smooths once still. Off: neither, the sharpest and cheapest.
 */
export type AntiAliasing = "taa" | "msaa" | "off";
export const ANTI_ALIASING: readonly AntiAliasing[] = ["taa", "msaa", "off"];
export const AA_INFO: Record<AntiAliasing, { label: string; detail: string }> = {
  taa: { label: "TAA", detail: "Smoothest edges and hair; a little soft while moving" },
  msaa: { label: "MSAA", detail: "Smooth geometry edges, sharp; see-through hair is dotted while moving" },
  off: { label: "Off", detail: "Sharpest and cheapest; jagged edges, dotted see-through hair while moving" },
};

/** Resolution override: "auto" follows the preset; a number is a fraction of the screen's own pixels. */
export type ResolutionChoice = "auto" | number;
export const RESOLUTION_SCALES: readonly number[] = [1, 0.85, 0.75, 0.67, 0.5];
const MIN_DPR = 0.25;

/** Pixel density a preset draws at on a screen of `deviceDpr` (as react-three-fiber's dpr={[1, max]} did). */
export function tierDpr(tier: GraphicsTier, deviceDpr: number): number {
  return Math.min(Math.max(1, deviceDpr), TIER_INFO[tier].maxDpr);
}

/** The canvas pixel density in effect: the hand-picked resolution, or the preset's. */
export function renderDpr(tier: GraphicsTier, resolution: ResolutionChoice, deviceDpr: number): number {
  if (resolution === "auto") return tierDpr(tier, deviceDpr);
  return Math.max(MIN_DPR, deviceDpr * resolution);
}

export const TARGET_PERIOD = 1 / 60; // seconds
export const SLOW_FACTOR = 1.5; // a window is slow when its 95th-percentile frame takes longer than 1.5 x 1/60 s
export const WINDOW_FRAMES = 120; // moving frames per judged window (about 2 s at 60 fps)
export const WARMUP_FRAMES = 60; // moving frames ignored after loading or a tier change (shader compiles, new targets)
export const HITCH = 0.25; // a single frame longer than this is a tab switch or a hitch, not the steady cost

export interface AutoState {
  tier: GraphicsTier;
  /** A smooth window has been judged at this tier, or Auto finished stepping. */
  settled: boolean;
  /** A step down did not help: the limit is the processor, so Auto stops lowering visuals. */
  cpuBound: boolean;
  /** Set right after a step down: the tier it came from and that tier's 95th percentile, to check the step helped. */
  previous?: { tier: GraphicsTier; p95: number };
  slowWindows: number;
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Auto's decision after one window of moving frame times (seconds), on a screen of `deviceDpr` (the default, 2, is a
 * screen where every preset draws a different number of pixels).
 */
export function judgeWindow(state: AutoState, deltas: readonly number[], deviceDpr = 2): AutoState {
  const p95 = percentile(deltas, 0.95);
  const slow = p95 > SLOW_FACTOR * TARGET_PERIOD;
  if (state.previous) {
    // The step down made frames less than 10% faster: processor-bound. Undo it and stop lowering visuals.
    if (p95 > state.previous.p95 * 0.9) return { tier: state.previous.tier, settled: true, cpuBound: true, slowWindows: 0 };
    const helped: AutoState = { ...state, previous: undefined, settled: true, slowWindows: 0 };
    return slow ? stepDown(helped, p95, deviceDpr) : helped;
  }
  if (!slow) return { ...state, settled: true, slowWindows: 0 };
  if (state.cpuBound) return { ...state, settled: true };
  // Two slow windows in a row, also at first: one can be a passing spike of background load (a busy desktop gave one
  // High window a 32.6 ms 95th percentile between smooth ones, 6 Nov), and a step down is remembered for the device.
  const slowWindows = state.slowWindows + 1;
  if (slowWindows < 2) return { ...state, slowWindows };
  return stepDown(state, p95, deviceDpr);
}

function stepDown(state: AutoState, p95: number, deviceDpr: number): AutoState {
  // The next preset that draws fewer pixels on this screen. None (a 1x screen, or already at Low): nothing to lower,
  // which says nothing about the processor, so settle without marking it processor-bound (Fable review, 10 Nov: on a
  // 125-150% Windows screen, High to Balanced changed nothing and was judged "did not help").
  const now = tierDpr(state.tier, deviceDpr);
  const next = TIERS.slice(TIERS.indexOf(state.tier) + 1).find(tier => tierDpr(tier, deviceDpr) < now);
  if (!next) return { ...state, settled: true, slowWindows: 0 };
  return { ...state, tier: next, previous: { tier: state.tier, p95 }, slowWindows: 0 };
}

// Per-viewer convenience (localStorage): the hand-picked settings, and Auto's result for this device. Storage can be
// missing or blocked; every access is guarded and the defaults apply. Writes read the stored object, change their own
// fields and write it back, so fields another version wrote survive. Auto's result carries a version: the presets
// changed meaning on 10 Nov (all with motion vectors, Balanced at 1.5x), so a result measured before is not reused.
const KEY = "finals-outfit.graphics";
const AUTO_VERSION = 2;
interface SavedAuto { device: string; tier: GraphicsTier; cpuBound?: boolean; version?: number }
interface Saved { choice?: GraphicsChoice; auto?: SavedAuto; aa?: AntiAliasing; resolution?: ResolutionChoice; showFps?: boolean }
function load(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function save(update: Partial<Saved>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify({ ...load(), ...update })); } catch { /* not remembered */ }
}
const isChoice = (value: unknown): value is GraphicsChoice => value === "auto" || TIERS.includes(value as GraphicsTier);
const isTier = (value: unknown): value is GraphicsTier => TIERS.includes(value as GraphicsTier);
const isAntiAliasing = (value: unknown): value is AntiAliasing => ANTI_ALIASING.includes(value as AntiAliasing);
export const isResolution = (value: unknown): value is ResolutionChoice =>
  value === "auto" || (typeof value === "number" && Number.isFinite(value) && value >= 0.25 && value <= 1);

/** Auto's starting tier before any measurement: phones and tablets (coarse pointer) start at Balanced, the rest High. */
export function initialTier(touch: boolean): GraphicsTier { return touch ? "balanced" : "high"; }

/** Auto's remembered result, if it was measured on this device with the current presets. */
export function rememberedAuto(saved: { auto?: SavedAuto }, device: string): AutoState | null {
  const auto = saved.auto;
  if (!auto || auto.device !== device || auto.version !== AUTO_VERSION || !isTier(auto.tier)) return null;
  return { tier: auto.tier, settled: true, cpuBound: !!auto.cpuBound, slowWindows: 0 };
}

interface GraphicsStore {
  choice: GraphicsChoice;
  auto: AutoState;
  device: string | null;
  aa: AntiAliasing;
  resolution: ResolutionChoice;
  showFps: boolean;
  setChoice: (choice: GraphicsChoice) => void;
  /** The renderer is known: restore Auto's remembered result for this exact device, if any. */
  setDevice: (device: string) => void;
  setAuto: (auto: AutoState) => void;
  setAa: (aa: AntiAliasing) => void;
  setResolution: (resolution: ResolutionChoice) => void;
  setShowFps: (showFps: boolean) => void;
}

// Phones and tablets: a coarse primary pointer. (maxTouchPoints alone also counts touchscreen laptops, and headless
// Chrome, which have a mouse or trackpad as their main pointer.)
const TOUCH = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const saved = typeof window === "undefined" ? {} : load();

export const useGraphicsStore = create<GraphicsStore>((set, get) => ({
  choice: isChoice(saved.choice) ? saved.choice : "auto",
  auto: { tier: initialTier(TOUCH), settled: false, cpuBound: false, slowWindows: 0 },
  device: null,
  aa: isAntiAliasing(saved.aa) ? saved.aa : "taa",
  resolution: isResolution(saved.resolution) ? saved.resolution : "auto",
  showFps: saved.showFps === true,
  setChoice: choice => { set({ choice }); save({ choice }); },
  setDevice: device => {
    if (get().device === device) return;
    const remembered = rememberedAuto(load(), device);
    set(remembered ? { device, auto: remembered } : { device });
  },
  setAuto: auto => {
    set({ auto });
    const device = get().device;
    if (device && !auto.previous) save({ auto: { device, tier: auto.tier, cpuBound: auto.cpuBound, version: AUTO_VERSION } });
  },
  setAa: aa => { set({ aa }); save({ aa }); },
  setResolution: resolution => { set({ resolution }); save({ resolution }); },
  setShowFps: showFps => { set({ showFps }); save({ showFps }); },
}));

/** The tier in effect: the viewer's pick, or Auto's. */
export function effectiveTier(state: Pick<GraphicsStore, "choice" | "auto">): GraphicsTier {
  return state.choice === "auto" ? state.auto.tier : state.choice;
}

/** Whether Auto is still choosing: the preset is Auto and no resolution was picked by hand (else a step changes nothing). */
export function autoMeasuring(state: Pick<GraphicsStore, "choice" | "resolution">): boolean {
  return state.choice === "auto" && state.resolution === "auto";
}
