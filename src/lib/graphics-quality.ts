import { create } from "zustand";

/**
 * Graphics setting (6 Nov 2026): High / Balanced / Low, or Auto (the default), which picks a tier from how fast this
 * device actually draws the moving view, the way games offer recommended settings.
 *
 * - High: the moving view's average is reprojected with motion vectors (StableFrameAccumulator, VelocityPass), so hair
 *   and sheer fabric stay smooth while anything moves. Costs one extra geometry pass per moving frame.
 * - Balanced: the view as it shipped before this setting (screen-locked moving average), full sharpness.
 * - Low: Balanced at 1x pixel density, for slower devices.
 *
 * Auto (rules from a Fable review, 6 Nov): it judges the slow frames, the 95th percentile of frame times, not the
 * average, against a 60 fps target (a 120 Hz screen that holds 60 is fine). It measures only while the view is moving
 * (a still view stops drawing once converged), skips warm-up frames and hidden-tab frames, and within a session it
 * only ever steps down, after two slow windows in a row (a heavy outfit, a phone heating up; one window alone can be
 * a passing spike of background load). A step that
 * did not make frames faster means the processor, not the graphics card, is the limit: it is undone and Auto stops
 * lowering the visuals. The result is remembered for this device (renderer, pixel ratio and screen size). A tier the
 * viewer picks by hand always wins and is remembered too.
 */
export type GraphicsTier = "high" | "balanced" | "low";
export type GraphicsChoice = "auto" | GraphicsTier;
export const TIERS: readonly GraphicsTier[] = ["high", "balanced", "low"];
export const TIER_INFO: Record<GraphicsTier, { label: string; detail: string; maxDpr: number; reproject: boolean }> = {
  high: { label: "High", detail: "Smooth hair and sheer fabric while moving (motion vectors), full sharpness", maxDpr: 2, reproject: true },
  balanced: { label: "Balanced", detail: "Full sharpness; moving hair is averaged on screen and can look grainy", maxDpr: 2, reproject: false },
  low: { label: "Low", detail: "Balanced at lower resolution, for slower devices", maxDpr: 1, reproject: false },
};

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

/** Auto's decision after one window of moving frame times (seconds). */
export function judgeWindow(state: AutoState, deltas: readonly number[]): AutoState {
  const p95 = percentile(deltas, 0.95);
  const slow = p95 > SLOW_FACTOR * TARGET_PERIOD;
  if (state.previous) {
    // The step down made frames less than 10% faster: processor-bound. Undo it and stop lowering visuals.
    if (p95 > state.previous.p95 * 0.9) return { tier: state.previous.tier, settled: true, cpuBound: true, slowWindows: 0 };
    const helped: AutoState = { ...state, previous: undefined, settled: true, slowWindows: 0 };
    return slow ? stepDown(helped, p95) : helped;
  }
  if (!slow) return { ...state, settled: true, slowWindows: 0 };
  if (state.cpuBound) return { ...state, settled: true };
  // Two slow windows in a row, also at first: one can be a passing spike of background load (a busy desktop gave one
  // High window a 32.6 ms 95th percentile between smooth ones, 6 Nov), and a step down is remembered for the device.
  const slowWindows = state.slowWindows + 1;
  if (slowWindows < 2) return { ...state, slowWindows };
  return stepDown(state, p95);
}

function stepDown(state: AutoState, p95: number): AutoState {
  const next = TIERS[TIERS.indexOf(state.tier) + 1];
  if (!next) return { ...state, settled: true, slowWindows: 0 };
  return { ...state, tier: next, previous: { tier: state.tier, p95 }, slowWindows: 0 };
}

// Per-viewer convenience (localStorage): the hand-picked tier, and Auto's result for this device. Storage can be
// missing or blocked; every access is guarded and the defaults apply. Writes read the stored object, change their own
// fields and write it back, so fields another version wrote survive.
const KEY = "finals-outfit.graphics";
interface Saved { choice?: GraphicsChoice; auto?: { device: string; tier: GraphicsTier; cpuBound?: boolean } }
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

/** Auto's starting tier before any measurement: phones and tablets (coarse pointer) start at Balanced, the rest High. */
export function initialTier(touch: boolean): GraphicsTier { return touch ? "balanced" : "high"; }

interface GraphicsStore {
  choice: GraphicsChoice;
  auto: AutoState;
  device: string | null;
  setChoice: (choice: GraphicsChoice) => void;
  /** The renderer is known: restore Auto's remembered result for this exact device, if any. */
  setDevice: (device: string) => void;
  setAuto: (auto: AutoState) => void;
}

// Phones and tablets: a coarse primary pointer. (maxTouchPoints alone also counts touchscreen laptops, and headless
// Chrome, which have a mouse or trackpad as their main pointer.)
const TOUCH = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const saved = typeof window === "undefined" ? {} : load();

export const useGraphicsStore = create<GraphicsStore>((set, get) => ({
  choice: isChoice(saved.choice) ? saved.choice : "auto",
  auto: { tier: initialTier(TOUCH), settled: false, cpuBound: false, slowWindows: 0 },
  device: null,
  setChoice: choice => { set({ choice }); save({ choice }); },
  setDevice: device => {
    if (get().device === device) return;
    const remembered = load().auto;
    set(remembered && remembered.device === device && isTier(remembered.tier)
      ? { device, auto: { tier: remembered.tier, settled: true, cpuBound: !!remembered.cpuBound, slowWindows: 0 } }
      : { device });
  },
  setAuto: auto => {
    set({ auto });
    const device = get().device;
    if (device && !auto.previous) save({ auto: { device, tier: auto.tier, cpuBound: auto.cpuBound } });
  },
}));

/** The tier in effect: the viewer's pick, or Auto's. */
export function effectiveTier(state: Pick<GraphicsStore, "choice" | "auto">): GraphicsTier {
  return state.choice === "auto" ? state.auto.tier : state.choice;
}
