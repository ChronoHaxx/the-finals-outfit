import { analyticsAllowed, browserAnalyticsContext } from "./analytics";

// Product analytics (23 Nov 2026): which features people find and use, which cosmetics they pick, and how often links
// are shared. docs/analytics-tracking-plan.md lists every event, why it exists and the decision it informs. An event
// that is not in that file must not be added here.
//
// - Nothing identifies a visitor. No cookies, no stored ids. Requests go out with credentials omitted. The collector
//   (workers/events) makes the daily visitor hash itself, from the request, and only for `app_loaded`.
// - The same gate as the page-view beacon (analyticsAllowed): production only, never with GPC, DNT, automation or the
//   visitor's opt-out. Gated or unconfigured, track() does nothing and costs nothing.
// - Events wait in memory and leave in small batches: when the page is hidden, 15 s after the first waiting event, or
//   at BATCH_MAX. One failed send is dropped, never retried, and nothing here can throw into the app.

/** Every event and its properties. Values are ids from fixed lists, booleans or small numbers: never free text. */
export interface EventProps {
  app_loaded: Record<string, never>;
  share_link_opened: { has_pose: boolean; has_camera: boolean; has_lighting: boolean };
  share_link_created: { kind: "plain" | "preview"; has_pose: boolean; has_camera: boolean; has_lighting: boolean };
  item_equipped: { slot: string; item_id: string };
  in_game_outfit_equipped: { outfit_id: string };
  emote_played: { emote_id: string; mode: "standard" | "chinals" };
  lighting_preset_changed: { kind: "look" | "sun" | "backdrop" | "scene"; preset: string };
  camera_view_saved: Record<string, never>;
  screenshot_exported: { scale: number; transparent: boolean };
  video_exported: { format: "mp4" | "mov" | "webm" | "png_frames"; source: "emote" | "take" };
  tour_offered: Record<string, never>;
  tour_started: { from: "start" | "resume" | "replay"; entry: "welcome" | "guide" };
  tour_completed: Record<string, never>;
  tour_skipped: { stop: string };
  hint_shown: { hint: string };
  hint_used: { hint: string };
  feature_exposed: { feature: string; via: "screen" | "guided" | "used" };
  feature_used: { feature: string };
  error_occurred: { kind: "caught" | "uncaught" };
}
export type EventName = keyof EventProps;
export type FormFactor = "phone" | "tablet" | "desktop";
type Props<E extends EventName> = EventProps[E] extends Record<string, never> ? [] : [EventProps[E]];
type Value = string | number | boolean;
export interface QueuedEvent { e: EventName; p?: Record<string, Value> }

export const APP_ID = "outfit";
export const SCHEMA = 1;
/** Below Analytics Engine's 25 writes per Worker request, so one batch is always one request. */
export const BATCH_MAX = 20;
export const FLUSH_MS = 15_000;
/** Errors are counted, not described, and at most this many per page load (one failure can repeat every frame). */
export const ERROR_LIMIT = 5;

/** The collector's URL, set at build time. Unset (local builds, forks) turns product analytics off. */
export const EVENTS_URL = (import.meta.env?.VITE_EVENTS_URL ?? "").trim(); // no env in node tests
/** The deployed commit, so a change in errors or use can be tied to a release. */
export const BUILD = (import.meta.env?.VITE_BUILD ?? "").trim().slice(0, 7) || "dev";

export type Send = (url: string, body: string) => void;

/** fetch with keepalive survives the page closing, as sendBeacon does, but can leave credentials out. A text/plain
 *  body keeps it a "simple" request, so there is no CORS preflight, and no-cors means the browser needs nothing back. */
const browserSend: Send = (url, body) => {
  try {
    void fetch(url, { method: "POST", body, keepalive: true, credentials: "omit", mode: "no-cors",
      headers: { "Content-Type": "text/plain" } }).catch(() => {});
  } catch {
    try { navigator.sendBeacon?.(url, body); } catch { /* dropped */ }
  }
};

interface State {
  url: string;
  /** Read once, at the first event: the layout the page opened in. */
  formFactor: () => FormFactor;
  send: Send;
  allowed: () => boolean;
  queue: QueuedEvent[];
  once: Set<string>;
  errors: number;
  timer: ReturnType<typeof setTimeout> | null;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

const fresh = (): State => ({
  url: EVENTS_URL, send: browserSend, formFactor: () => formFactor(window.innerWidth), allowed: () => analyticsAllowed(browserAnalyticsContext()),
  queue: [], once: new Set(), errors: 0, timer: null,
  setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer),
});
let state = fresh();
let envelope: { app: string; schema: number; form_factor: FormFactor; build: string } | null = null;
// The gate is read once per page: GPC, DNT and the address do not change while it is open. Opting out does, so
// setAnalyticsOptOut clears this.
let gate: boolean | null = null;
const enabled = () => state.url !== "" && (gate ??= safe(state.allowed, false));

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Whether this page sends anything: lets observers that would only feed track() stay off entirely. */
export const trackingEnabled = (): boolean => enabled();

/** Records an event. Does nothing when analytics are off; never throws. */
export function track<E extends EventName>(event: E, ...props: Props<E>): void {
  if (!enabled()) return;
  // The layout the page opened in (the first event is app_loaded), not whatever it was rotated to by the first send.
  envelope ??= { app: APP_ID, schema: SCHEMA, form_factor: safe(state.formFactor, "desktop"), build: BUILD };
  const p = props[0] as Record<string, Value | undefined> | undefined;
  const clean = p ? Object.fromEntries(Object.entries(p).filter((entry): entry is [string, Value] => entry[1] !== undefined)) : undefined;
  state.queue.push(clean && Object.keys(clean).length ? { e: event, p: clean } : { e: event });
  if (state.queue.length >= BATCH_MAX) flush();
  else if (!state.timer) state.timer = state.setTimer(flush, FLUSH_MS);
}

/** Records an event at most once per page load under `key`, e.g. the first use of a feature. Nothing is stored:
 *  a reload starts again, so a count of these is a count of sessions. */
export function trackOnce<E extends EventName>(key: string, event: E, ...props: Props<E>): void {
  if (!enabled() || state.once.has(key)) return;
  state.once.add(key);
  track(event, ...props);
}

/** Counts an error, up to ERROR_LIMIT per page load. Never sends what the error was: a message can hold a URL, an
 *  outfit code or a file path. "caught" is a failure the app noticed and handled; "uncaught" reached the window. */
export function trackError(kind: "caught" | "uncaught" = "caught"): void {
  if (!enabled() || state.errors >= ERROR_LIMIT) return;
  state.errors++;
  track("error_occurred", { kind });
}

/** Sends what is waiting, in batches of at most BATCH_MAX. */
export function flush(): void {
  if (state.timer) { state.clearTimer(state.timer); state.timer = null; }
  while (state.queue.length) {
    const events = state.queue.splice(0, BATCH_MAX);
    const body = JSON.stringify({ ...envelope, events });
    try { state.send(state.url, body); } catch { /* dropped: analytics never break the app */ }
  }
}

/** Under 640 px wide is a phone, under 1024 px a tablet; the same split the layout uses. */
export const formFactor = (width: number): FormFactor => width < 640 ? "phone" : width < 1024 ? "tablet" : "desktop";

let started = false;
/** Once per page: sends what is waiting whenever the page is hidden (the last chance on phones), and counts uncaught
 *  errors. Call after the first events are queued or before; order does not matter. */
export function startTracking(): void {
  if (started || typeof window === "undefined" || !enabled()) return;
  started = true;
  const hidden = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", flush);
  window.addEventListener("error", () => trackError("uncaught"));
  window.addEventListener("unhandledrejection", () => trackError("uncaught"));
}

/** Re-reads the gate after the visitor opts out (or back in). Opting out drops anything waiting, so nothing from this
 *  page is sent afterwards. */
export function onOptOutChanged(): void {
  gate = null;
  if (enabled()) return;
  state.queue = [];
  if (state.timer) { state.clearTimer(state.timer); state.timer = null; }
}

/** For tests: a fresh page with a recording transport. */
export function resetTrackingForTests(options: Partial<Pick<State, "url" | "send" | "allowed" | "formFactor" | "setTimer" | "clearTimer">> = {}): void {
  if (state.timer) state.clearTimer(state.timer);
  state = { ...fresh(), url: "https://events.example/e", formFactor: () => "desktop", ...options };
  gate = null;
  envelope = null;
}
