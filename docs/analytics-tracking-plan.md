# Analytics tracking plan

**Status: draft for the maintainer's sign-off (23 Nov 2026). Nothing below is instrumented yet.**

This file lists every product event the app may send, what each one is for, and the decision it informs. An event
that is not in this file must not be sent. To add one, add it here first, with its reason, in the same PR.

Cloudflare Web Analytics (`src/lib/analytics.ts`, README "Monitoring and visitor analytics") stays as it is. It
counts page views and Core Web Vitals, but it cannot record events, so it cannot answer the questions below.

## The questions

| Question | Answered by |
| --- | --- |
| How many people use it: daily, weekly and monthly visitors, and sessions | `app_loaded` (sessions), plus the collector's daily visitor hash |
| Which features are used most and least | `feature_used` |
| Which features people never discover | `feature_exposed` compared with `feature_used` |
| Which cosmetics are most popular | `item_equipped`, `in_game_outfit_equipped`, `emote_played` |
| How often shared links are created and opened | `share_link_created`, `share_link_opened` |

## Rules

- **No identifiers in the browser.** No cookies. Nothing in localStorage, sessionStorage or IndexedDB identifies a
  visitor. No fingerprinting, no session replay, no third-party trackers. The one stored value is the opt-out
  setting (below), and it identifies nothing.
- **No IP addresses stored.** The collector reads the request's IP only to make the daily visitor hash, then drops it.
- **Aggregate values only.** Property values are ids from fixed lists in this repo (feature ids, slots, catalogue
  item ids, emote ids, built-in look ids), booleans or small numbers. Never free text: no outfit, look or view names,
  no error messages, no URLs, no share codes.
- **The same gate as today.** Events are sent only by the production app. They are never sent by localhost, forks, UI
  previews, the developer catalogue or automated browsers, or when the visitor has Global Privacy Control or Do Not
  Track on (`analyticsAllowed`). They are also never sent after the visitor opts out in the app.
- **Events never depend on stored state.** The wrapper does not read the discovery or hint records
  (`finals-outfit.discovery`, `finals-outfit.hints`). "First time" always means first time in this page load.

## Definitions

- **Session:** one page load. Without a stored identifier, a reload is a new session. Sessions = count of `app_loaded`.
- **Daily visitor:** the collector hashes the request's IP address and user agent with a salt for that UTC day. The
  salt is random (never derived from the date), shared by all four apps' events for that day, and deleted after
  48 hours. The hash is attached to `app_loaded` only, so feature events carry no visitor key.
- **Weekly and monthly visitors.** A daily salt cannot recognise the same person on two different days. A weekly or
  monthly figure is the sum of daily visitors, so a person counts once for every day they visit. Report it as
  "visitor-days" or "monthly visits". Do not call it "unique users".

## Naming scheme (shared with the portfolio, WuWa VR and WuWa Studio)

- Event names are `object_action`, snake_case, with the verb in the past tense: `item_equipped`, `share_link_opened`.
- Names do not include the app's name. The envelope carries `app`, so a query can compare all apps,
  for example `share_link_created` across every app.
- Property names are snake_case. Values are lowercase ids. Booleans are `true`/`false`, never `"yes"`.
- Each app keeps its own copy of this table, and the collector's allowlist is built from all four.

Envelope, added by the wrapper to every event: `app` (`"outfit"`) and `schema` (`1`). The collector adds the time.

## Events

| Event | Fires when | Properties | Why it exists | Decision it informs |
| --- | --- | --- | --- | --- |
| `app_loaded` | Once per page load, after the gate passes | `entry`: `direct` \| `share_link`; `form_factor`: `phone` \| `tablet` \| `desktop` (viewport width at load: under 640 px, under 1024 px, wider) | Sessions and daily visitors | Growth; how much phone layout work is worth |
| `share_link_opened` | A page load whose address carries a shared outfit (`o=`) | `has_pose`, `has_camera`, `has_lighting` | Share opens | Whether sharing brings people in, and which share extras matter |
| `share_link_created` | Share outfit copies a link | `kind`: `plain` \| `preview`; `has_pose`, `has_camera`, `has_lighting` | Shares, and camera views shared | Whether the preview-image Worker earns its upkeep |
| `item_equipped` | The visitor picks a piece in the slot picker. Not for randomise, in-game outfits, or loading a shared or saved outfit | `slot` (a `SLOTS` id); `item_id` (catalogue id) | Item popularity from deliberate choices | Which items to reconstruct, fix or feature first |
| `in_game_outfit_equipped` | The visitor wears one of the game's outfits | `outfit_id` | Preset popularity | Which presets to keep at the top of the list |
| `emote_played` | An emote starts from the picker | `emote_id`; `mode`: `standard` \| `chinals` | Emote popularity | Which emotes' props, sound and faces to fix first |
| `lighting_preset_changed` | The visitor picks a look, a sun position or a backdrop | `kind`: `look` \| `sun` \| `backdrop`; `preset`: a built-in id (`FULL_LOOKS`, `SUN_LOOKS`, `BACKDROP_PRESETS`), or `saved` \| `shared` | Which looks are used | Which looks to tune, and whether saved looks are used |
| `camera_view_saved` | The visitor saves a camera view | none | Camera saves | Whether saved views are worth their panel space |
| `player_number_set` | The contestant number changes | `mode`: `number` \| `own` (each piece's own number); `number` (0–99, only when `mode` is `number`) | Number feature use | Whether the number feature is used |
| `screenshot_exported` | A PNG is saved | `scale`: `1` \| `2` \| `3`; `transparent` | Export use | Which capture options to keep |
| `video_exported` | A video finishes rendering | `format`: `mp4` \| `mov` \| `webm` \| `png_frames`; `source`: `emote` \| `take` | Video and MOV exports | Whether transparent MOV and takes are worth maintaining |
| `tour_offered` | The welcome screen shows the tour button | none | Tour exposure | Declined = offered − started |
| `tour_started` | The tour starts | `from`: `start` \| `resume` \| `replay`; `entry`: `welcome` \| `guide` | Tour starts | Whether the tour is worth keeping |
| `tour_completed` | The visitor finishes the last stop | none | Tour completions | Whether the tour is the right length |
| `tour_skipped` | The tour ends before its last stop | `stop`: the feature id it ended on | Where people leave | Which stop to shorten or cut |
| `hint_shown` | A nudge appears | `hint`: `pause-share` \| `emote-keys` | Hint exposure | Whether nudges are reached at all |
| `hint_used` | The nudge's feature is used while the nudge shows | `hint` | Hint conversion | Whether a nudge works or should go |
| `hint_dismissed` | The nudge is closed without using the feature | `hint` | Hint fatigue | Whether a nudge is annoying |
| `feature_exposed` | The first time this page load that a control is shown (see Discovery) | `feature`; `via`: `screen` \| `callout` \| `tour` \| `guide` \| `used` | Discovery | Which features are hidden |
| `feature_used` | The first time this page load that a control is pressed or changed, or its key is used | `feature` | Feature use | Most and least used features |
| `error_occurred` | The app catches an error, or an uncaught error or rejection happens. At most 5 per page load | none (count only) | Stability | Whether a release broke something |

## Discovery: exposure against use

`feature_exposed` and `feature_used` use the feature ids in `src/data/feature-guide.ts` (`FEATURES` plus `guide`,
23 ids today). A new feature there is tracked automatically through its `data-feature` attribute.

- **Exposed** means the control was on screen and usable for at least 1 second: in view, not inert, not inside the
  hidden UI. It is also exposed when its callout showed, the tour stopped on it, or the Guide's "Show me" framed it.
  A use also counts as an exposure (`via: used`), so a keyboard shortcut used without seeing the button still
  counts as both.
- Each fires at most once per feature per page load, so both counts are per session.

How to read them for each feature:

| Pattern | Meaning | Typical action |
| --- | --- | --- |
| Exposure near zero | Hidden: people never reach it (most `needs` features sit behind another step) | Move it, or surface it with a nudge |
| High exposure, low use | Seen but not understood, or not wanted | Relabel it, explain it, or cut it |
| High exposure, high use | Working | Leave it |

Use rate = sessions with `feature_used` ÷ sessions with `feature_exposed`. No session id is needed, because each
session contributes at most one of each event.

## Delivery

- **One wrapper:** `track(event, props)` in `src/lib/track.ts`. Types map each event name to its properties, so a
  call site cannot send an unlisted event or property. In tests a stub records calls instead of sending them.
- **Batching:** events wait in memory and are sent as one beacon when the page is hidden (`visibilitychange`), every
  15 seconds while events are waiting, or at 20 events. Each beacon is a `navigator.sendBeacon` with a `text/plain`
  body, so there is no CORS preflight request. Nothing is retried, and the wrapper never throws or blocks the app.
- **Size:** the wrapper adds well under 1 KB gzipped and loads no third-party script.
- **Collector checks:** the collector accepts only allowlisted origins, event names and property values, and drops
  anything else. Each request writes at most 25 data points, which is Analytics Engine's per-request limit.

## Opt-out and privacy note

- **Opt-out:** a "Don't count my visits" switch in the privacy note. It stores `finals-outfit.analytics = "off"` in
  localStorage and also stops the Cloudflare Web Analytics beacon. GPC and DNT already stop both. The maintainer
  should switch it on in his own browsers, so his testing doesn't inflate the numbers.
- **Draft note** (linked from the Guide sheet and the welcome screen):

  > **Privacy.** This site counts how it is used, so I can see which features help and which nobody finds. It uses
  > no cookies and stores nothing that identifies you. When you use it, it records which features you open and use,
  > which items, emotes and looks you pick, and whether you share or export. It never records anything you type or
  > the contents of your links. To count daily visitors, your IP address and browser are mixed with a random key that
  > is thrown away every day; your IP address is never stored. The data stays on Cloudflare for 3 months, then is
  > deleted. To opt out, turn on Global Privacy Control or Do Not Track in your browser, or use the switch below.
  > Questions: open an issue on GitHub.

## Volume

A typical session is about 20–40 events: one `app_loaded`, about 10 exposures, a few uses, items and emotes, sent
in 2–4 beacons. Workers Free allows 100,000 Analytics Engine data points a day (checked 23 Nov 2026), which is
roughly 3,000–5,000 sessions a day before the limit. Beacons also count against the account's 100,000 Worker
requests a day. The share-preview Worker uses the same allowance, and so will the site Worker after the migration.
If traffic gets near either limit, send exposures as one summary row per session.

## Retention and the metrics snapshot

Analytics Engine keeps data for 3 months. After 2–4 weeks of data, a report script, run locally with a read-only
API token that is never committed, will query monthly visits, sessions, the top and bottom 5 features, and share
opens. The figures go into a "Metrics snapshot" section of this repo's docs, with the date range and the query used.
They are copied from the query output, never estimated.

## Open decisions

1. **Provider:** Workers Analytics Engine is recommended (the reasons are in the PR description). It should match
   what the portfolio and the WuWa apps use.
2. **Where the collector lives:** one shared Worker serving all four apps, either in this repo (`workers/events/`)
   or in a repo of its own.
3. **Contact route in the note:** GitHub issues, or an email address.
