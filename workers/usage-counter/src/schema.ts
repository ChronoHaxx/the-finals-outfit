// What each app may send (docs/analytics-tracking-plan.md in the-finals-outfit). Shared by every app that posts to this
// collector: one naming scheme (`object_action`, snake_case, past tense; no app name in the event), one envelope.
//
// Values are checked by pattern and length, never against id lists: a catalogue update must not need a collector
// redeploy, and the patterns already keep out free text (no spaces, no slashes, no capitals except camelCase names).
// An event that fails any check is dropped on its own; the rest of its batch is kept.

export type Check = (value: unknown) => boolean;

/** A lowercase id: catalogue items, emotes, features, looks, hints. Long enough for the longest item id (48). */
export const id: Check = v => typeof v === "string" && /^[a-z0-9][a-z0-9_.-]{0,47}$/.test(v);
/** A camelCase code name, such as a slot (`upperBody`). */
export const name: Check = v => typeof v === "string" && /^[a-z][a-zA-Z0-9]{0,23}$/.test(v);
export const bool: Check = v => typeof v === "boolean";
export const int = (min: number, max: number): Check => v => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
export const oneOf = (...values: readonly string[]): Check => v => typeof v === "string" && values.includes(v);

/** Properties in a fixed order: that order is their column (blob5, blob6, ...) in the dataset. At most 4. */
export type EventSpec = readonly (readonly [prop: string, check: Check])[];

export interface AppSpec {
  /** Origins allowed to send for this app (the `Origin` header, exact). */
  origins: readonly string[];
  /** The one event per page load that carries the daily visitor hash (`app_loaded`, or `page_viewed` on a multi-page
   *  site). null: this app's rows never carry one (it counts page loads only, with nothing that links two of them). */
  visitorEvent: string | null;
  /** Whether batches must carry `form_factor` and `build` in the envelope. An app that leaves them out stores them
   *  empty (blob2, blob3). */
  envelope: "full" | "minimal";
  events: Readonly<Record<string, EventSpec>>;
}

export const FORM_FACTORS = ["phone", "tablet", "desktop"] as const;
export const SCHEMA = 1;
export const BATCH_MAX = 20;

const sharePresence = [["has_pose", bool], ["has_camera", bool], ["has_lighting", bool]] as const;

// WuWa VR guide site (github.com/ChronoHaxx/wuwa-vr, docs/TRACKING-PLAN.md, "Registering with the collector"). A
// multi-page site: one app_loaded per page load. Every event carries the page (an id such as "l.ja-guide") and the
// page's language, first, so they share columns blob5 and blob6.
const wuwaLangs = ["en", "zh-Hans", "ja", "ko", "es", "pt-BR", "fr", "de", "ru", "ar", "other"] as const;
const wuwaPage = [["page", id], ["lang", oneOf(...wuwaLangs)]] as const;
/** A YouTube video id: 11 characters, capitals and a leading "-" allowed, so not an `id`. */
const youtube: Check = v => typeof v === "string" && /^(?:[\w-]{11}|other)$/.test(v);

export const APPS: Readonly<Record<string, AppSpec>> = {
  // THE FINALS outfit builder (github.com/ChronoHaxx/the-finals-outfit).
  outfit: {
    origins: ["https://chronohaxx.github.io"],
    visitorEvent: "app_loaded",
    envelope: "full",
    events: {
      app_loaded: [],
      share_link_opened: sharePresence,
      share_link_created: [["kind", oneOf("plain", "preview")], ...sharePresence],
      item_equipped: [["slot", name], ["item_id", id]],
      in_game_outfit_equipped: [["outfit_id", id]],
      emote_played: [["emote_id", id], ["mode", oneOf("standard", "chinals")]],
      lighting_preset_changed: [["kind", oneOf("look", "sun", "backdrop", "scene")], ["preset", id]],
      camera_view_saved: [],
      screenshot_exported: [["scale", int(1, 4)], ["transparent", bool]],
      video_exported: [["format", oneOf("mp4", "mov", "webm", "png_frames")], ["source", oneOf("emote", "take")]],
      tour_offered: [],
      tour_started: [["from", oneOf("start", "resume", "replay")], ["entry", oneOf("welcome", "guide")]],
      tour_completed: [],
      tour_skipped: [["stop", id]],
      hint_shown: [["hint", id]],
      hint_used: [["hint", id]],
      feature_exposed: [["feature", id], ["via", oneOf("screen", "guided", "used")]],
      feature_used: [["feature", id]],
      error_occurred: [["kind", oneOf("caught", "uncaught")]],
    },
  },
  "wuwa-vr": {
    origins: ["https://chronohaxx.github.io"],
    visitorEvent: "app_loaded",
    envelope: "full",
    events: {
      app_loaded: wuwaPage,
      download_clicked: [...wuwaPage, ["asset", oneOf("installer", "portable_zip", "release_notes", "previous_release", "source", "other")],
        ["placement", oneOf("header", "hero", "closing", "guide", "page", "other")]],
      guide_section_reached: [...wuwaPage, ["section", id]],
      outbound_link_clicked: [...wuwaPage, ["target", oneOf("github_issues", "github_repo", "youtube", "kofi", "uevr_docs", "game", "other")]],
      feedback_draft_used: [...wuwaPage, ["action", oneOf("copied", "opened_github", "other")], ["kind", oneOf("bug", "feature", "language", "other")]],
      faq_opened: [...wuwaPage, ["question", id]],
      shortcut_searched: [...wuwaPage, ["result", oneOf("found", "none", "other")]],
      video_played: [...wuwaPage, ["video", youtube], ["placement", oneOf("feature", "grid", "story", "other")]],
      language_chosen: [...wuwaPage, ["to", oneOf(...wuwaLangs)], ["via", oneOf("menu", "suggestion", "other")]],
      controls_card_used: [...wuwaPage, ["pad", oneOf("xbox", "ps", "vr", "other")], ["action", oneOf("switched", "saved_image", "other")]],
    },
  },
};

export interface Envelope { app: string; form_factor: string; build: string }
export interface CheckedEvent { event: string; values: string[] }

/** The batch's envelope, or null when the batch is not for an app this origin may send for. */
export function readEnvelope(body: unknown, origin: string | null): (Envelope & { events: unknown[] }) | null {
  if (!body || typeof body !== "object") return null;
  const { app, schema, form_factor, build, events } = body as Record<string, unknown>;
  if (typeof app !== "string" || !Object.hasOwn(APPS, app) || !origin || !APPS[app].origins.includes(origin)) return null;
  if (schema !== SCHEMA) return null;
  // Both are optional for a "minimal" app, but never malformed when present.
  const full = APPS[app].envelope === "full";
  if ((full || form_factor !== undefined) && !oneOf(...FORM_FACTORS)(form_factor)) return null;
  if ((full || build !== undefined) && (typeof build !== "string" || !/^(?:[0-9a-f]{7}|dev)$/.test(build))) return null;
  if (!Array.isArray(events) || events.length === 0 || events.length > BATCH_MAX) return null;
  return { app, form_factor: (form_factor as string | undefined) ?? "", build: (build as string | undefined) ?? "", events };
}

/** One event (`{ e, p? }`) checked against its app's spec: its name and its values as strings in column order, or
 *  null. */
export function checkEvent(app: string, raw: unknown): CheckedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const { e, p } = raw as { e?: unknown; p?: unknown };
  const events = APPS[app]?.events;
  if (typeof e !== "string" || !events || !Object.hasOwn(events, e)) return null;
  const spec = events[e];
  const props = p === undefined ? {} : p;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const given = Object.keys(props);
  // Exactly the listed properties: an extra one is a bug or a probe, either way not stored.
  if (given.length !== spec.length || !given.every(key => spec.some(([prop]) => prop === key))) return null;
  const values: string[] = [];
  for (const [prop, check] of spec) {
    const value = (props as Record<string, unknown>)[prop];
    if (!check(value)) return null;
    values.push(String(value));
  }
  return { event: e, values };
}
