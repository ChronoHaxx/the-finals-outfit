# Analytics tracking plan

**Status: approved with changes (23 Nov 2026).** The maintainer delegated the review to a second model. That review
found five privacy defects and several definitions that would mislead on a CV. This revision carries all of them.
Provider, collector and contact route are decided below.

This file lists every product event the app sends, what each one is for, and the decision it informs. An event that
is not in this file must not be sent. To add one, add it here first, with its reason, in the same PR.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Provider | Cloudflare Workers Analytics Engine, behind one self-built collector Worker shared by this app, the portfolio, WuWa VR's site and WuWa Studio | The only free option with a daily-rotating visitor hash and key/value properties. Umami Cloud's salt rotates monthly. Plausible charges for properties. GoatCounter has no properties, so slot and item id would have to be faked as event names |
| Collector | Worker `usage-counter`, dataset `usage_events`. Its code is in `workers/usage-counter/` until it moves to a repo of its own (`ChronoHaxx/usage-counter`) | It serves four apps, so it should not ship on this app's release cycle. It shares nothing with `workers/site` (not its dataset, not its secret) |
| Contact route | GitHub issues on each app's own repository | The data holds nothing tied to a person, so there is nothing to look up or delete on request |

Cloudflare Web Analytics (`src/lib/analytics.ts`) stays for page views, referrers and Core Web Vitals. **The
collector is the source of record for every figure quoted outside this repo.** The two will not match: they count
different things, and blockers affect them differently.

## The questions, and how to report the answers honestly

| Question | Measure | Report it as |
| --- | --- | --- |
| How many people use it | Distinct visitor hashes per UTC day, on `app_loaded` | "about N daily visitors (average) / M (peak)". Approximate, see below |
| How much it is used | Count of `app_loaded` | "N page loads a month". Not "sessions" and not "visits": a reload is a new page load |
| Weekly or monthly unique users | **Not measurable under these rules**, on purpose | Do not derive one. A daily salt cannot recognise a person on two different days. A sum of daily visitors is "visitor-days" |
| Most and least used features | Page loads with `feature_used`, per feature | "used in N% of page loads" |
| Features people never discover | `feature_exposed` ÷ `app_loaded`, then `feature_used` ÷ `feature_exposed` | See Discovery |
| Most popular cosmetics | `item_equipped`, `in_game_outfit_equipped`, `emote_played` | "most picked". A pick is a try-on, not a final outfit |
| Shared links | `share_link_created`, `share_link_opened` | "share links copied" and "page loads from a share link". Link unfurls in Discord and similar apps never run the app, so they are not counted |

**Daily visitors are an estimate.** A shared IP address (an office, a university, some mobile networks) counts
several people once. A phone that changes IP address during the day counts once per address. Visitors with GPC, DNT
or the opt-out on, and visitors with a blocker, are not counted at all. Quote these figures as approximate.

## Rules

- **No identifiers in the browser.** No cookies. Nothing in localStorage, sessionStorage or IndexedDB identifies a
  visitor. No fingerprinting, no session replay, no third-party trackers. The one stored value is the visitor's own
  opt-out (`finals-outfit.analytics` = `"off"`). It is the same for everyone who chooses it, so it identifies no one.
- **No IP addresses stored.** The collector reads the IP address and user agent only to make the visitor hash, and
  only for `app_loaded`. It writes no request headers or bodies to any log: Workers Logs are off and the code logs
  neither.
- **Aggregate values only.** Values are ids from this repo (feature ids, slots, catalogue item ids, emote ids,
  built-in look ids), small fixed lists, booleans or small numbers. The collector checks each one against a pattern
  and a length limit and drops the event otherwise, so free text cannot get through: no names, no error messages, no
  URLs, no share codes.
- **One gate for both tools.** Only the production app sends anything. Localhost, forks, UI previews, the developer
  catalogue and automated browsers never do, and neither does any visitor with Global Privacy Control, Do Not Track
  or the opt-out on (`analyticsAllowed`). The collector also drops requests carrying `Sec-GPC: 1` or `DNT: 1`.
- **Events never depend on stored state.** The wrapper and the exposure observer never read or write the discovery
  and hint records (`finals-outfit.discovery`, `finals-outfit.hints`). "First time" always means first time in this
  page load.

## The visitor hash

For `app_loaded` only, the collector computes `SHA-256(salt ‖ app ‖ IP ‖ user agent)` and keeps the first 64 bits.

- **The salt is random**, one per UTC day. It is never derived from the date: a date-derived salt can be recomputed
  by anyone, and then the hash is only a disguise.
- **The salt is kept in KV and expires one hour after its day ends.** After that, nothing can link a hash back to
  an address, or to the previous day's hash. A daily cron writes the next day's salt in advance, so every Worker
  instance uses the same salt from midnight. Two instances each creating their own salt would count one visitor
  twice.
- **The app is part of the hash.** One person gets unrelated hashes on this app and on the portfolio, so the four
  apps' data cannot be joined into one person's browsing.

## Naming scheme (shared by all four apps)

- Event names are `object_action`, snake_case, with the verb in the past tense: `item_equipped`, `share_link_opened`.
- Names do not include the app's name. The envelope carries `app`, so one query can compare apps, for example
  `share_link_created` across all four.
- Property names are snake_case. Values are lowercase ids. Booleans are `true` or `false`, never `"yes"`.
- The collector's allowlist maps each origin to its app, and lists each app's event names and property rules.

**Envelope**, added by the wrapper to every batch:

| Field | Values | Why |
| --- | --- | --- |
| `app` | `outfit` | Which app |
| `schema` | `1` | Bumped when an event's meaning changes |
| `form_factor` | `phone` (under 640 px wide at load), `tablet` (under 1024 px), `desktop` | Lets every event be split by phone and desktop without a session key. Some features exist only on a computer |
| `build` | The deployed commit, 7 characters | Ties a change in errors or use to a release |

The collector adds the time. It adds the visitor hash to `app_loaded` only.

## Events

| Event | Fires when | Properties | Decision it informs |
| --- | --- | --- | --- |
| `app_loaded` | Once per page load, after the gate passes | none | Growth: page loads and daily visitors |
| `share_link_opened` | A page load whose address carries an outfit link, as the app's own link reader (`readOutfitLink`) sees it | `has_pose`, `has_camera`, `has_lighting` | Whether sharing brings people in. The link stays in the address bar until the draft is saved or left, so a reload counts again, and so does the creator opening their own link |
| `share_link_created` | Share outfit copies a link | `kind`: `plain` \| `preview`; `has_pose`, `has_camera`, `has_lighting` | Whether the preview-image Worker earns its upkeep, and whether camera views and poses get shared |
| `item_equipped` | The visitor picks a piece in the slot picker. Not for randomise, in-game outfits, or loading a shared or saved outfit | `slot`; `item_id` | Which items to reconstruct, fix or feature first |
| `in_game_outfit_equipped` | The visitor wears one of the game's outfits | `outfit_id` | Which presets to keep at the top |
| `emote_played` | An emote starts from the picker | `emote_id`; `mode`: `standard` \| `chinals` | Which emotes' props, sound and faces to fix first |
| `lighting_preset_changed` | The visitor picks a look, a sun position, a backdrop colour or an in-game scene | `kind`: `look` \| `sun` \| `backdrop` \| `scene`; `preset`: a built-in id, or `saved` | Which looks to tune; whether saved looks and scenes are used |
| `camera_view_saved` | The visitor saves a camera view | none | Whether saved views are worth their panel space |
| `screenshot_exported` | A PNG is saved | `scale`: 1–4; `transparent` | Which capture options to keep |
| `video_exported` | A video finishes rendering | `format`: `mp4` \| `mov` \| `webm` \| `png_frames`; `source`: `emote` \| `take` | Whether transparent MOV and takes are worth maintaining |
| `tour_offered` | The welcome screen shows the tour button | none | With `tour_started` from the welcome screen: how many decline the tour |
| `tour_started` | The tour starts | `from`: `start` \| `resume` \| `replay`; `entry`: `welcome` \| `guide` | Whether the tour is worth keeping |
| `tour_completed` | The visitor finishes the last stop | none | Whether the tour is the right length |
| `tour_skipped` | The tour ends before its last stop | `stop`: the feature id it ended on | Which stop to shorten or cut |
| `hint_shown` | A nudge appears | `hint`: `pause-share` \| `emote-keys` | Whether nudges are reached at all |
| `hint_used` | What the nudge suggests is done while it shows: Share outfit for `pause-share`; the timeline or speed keys for `emote-keys` | `hint` | Whether a nudge works or should go |
| `feature_exposed` | The first time this page load that a control is shown (see Discovery) | `feature`; `via`: `screen` \| `guided` \| `used` | Which features are hidden |
| `feature_used` | The first time this page load that a control is pressed or changed, or its key is used | `feature` | Most and least used features |
| `error_occurred` | The app catches an error it reports, or an uncaught error or rejection happens. At most 5 per page load | `kind`: `caught` \| `uncaught` | Whether a release broke something (with `build`) |

Cut in review: `player_number_set` (`feature_used: player-number` answers whether it is used; the number picked
decides nothing) and `hint_dismissed` (shown minus used). That leaves 19 events.

## Discovery: exposure against use

`feature_exposed` and `feature_used` use the feature ids in `src/data/feature-guide.ts` (`FEATURES` plus `guide`,
23 ids today). A new feature there is tracked automatically through its `data-feature` attribute.

- **`screen`:** a separate observer (`src/lib/feature-exposure.ts`) sees the control in view for 1 second and usable
  then: not inert, not inside the hidden UI, not behind a modal dialog such as the welcome screen. This is not the
  guide's own "seen" record, which it neither reads nor writes.
- **`guided`:** its callout showed, the tour stopped on it, or the Guide's "Show me" framed it.
- **`used`:** a use always counts as an exposure too, so a keyboard shortcut used without seeing the button counts as
  both. Every key named in the guide counts as a use, including I and O for the video range.
- Each fires at most once per feature per page load.

How to read them, for each feature:

- **Exposure rate** = `feature_exposed` ÷ `app_loaded`. Near zero means hidden: people never reach it.
- **Use rate** = `feature_used` ÷ `feature_exposed`. Low with high exposure means seen but not understood or not wanted.
- Exposure is opportunity, not attention. For always-visible controls it is close to every page load, so only the use
  rate means anything there.
- Gated features have smaller audiences: `chinals`, `video-mov` (computers only) and the features whose guide entry
  says what they need first. Compare `video-mov` against desktop page loads only (`form_factor`).
- Returning visitors get quieter callouts (the guide remembers what they used), so `guided` exposures lean towards
  first visits. This is known and accepted.

No session id is needed: each page load contributes at most one of each event per feature.

## Delivery

- **One wrapper:** `track(event, props)` in `src/lib/track.ts`. Types map each event to its properties, so a call
  site cannot send an unlisted event or property. Tests swap in a recording transport.
- **Batching:** events wait in memory and leave as one request when the page is hidden, 15 seconds after the first
  waiting event, or at 20 events. Each request is a `fetch` with `keepalive`, `credentials: "omit"` and a
  `text/plain` body, so it survives the page closing, carries no cookies and needs no CORS preflight. Nothing is
  retried, and nothing here can throw into the app or block it.
- **Size:** the whole change adds 3.4 KB of gzipped JavaScript (measured against `main` on 23 Nov 2026), most of it the
  privacy note's text. No third-party script is loaded.
- **Collector checks:** allowlisted origin, batch of at most 20 (Analytics Engine writes at most 25 points per
  request), body under 16 KB, each event and value checked as above. A per-IP rate limit (60 requests a minute) and a
  bot user-agent filter keep the numbers defensible. Anyone can still post to the collector, so treat a sudden spike
  with suspicion.

## Opt-out and privacy note

- **Opt-out:** a "Don't count my visits" switch in the privacy note. It stores `"off"` and stops both tools. Switching
  it back removes the setting. GPC and DNT already stop both. Switch it on in your own browsers, so your testing does
  not inflate the numbers.
- **The note** (`src/components/PrivacyNote.tsx`) is linked from the Guide sheet and the welcome screen:

  > This site counts how it is used, so I can see which features help and which nobody finds. It sets no cookies and
  > stores nothing that identifies you.
  >
  > **What is recorded:** which features you open and use; which items, emotes and looks you pick; whether you share
  > or export; whether you are on a phone, tablet or computer; and errors, counted but not described. Never anything
  > you type, and never what is in your links.
  >
  > **Tools:** events go to Cloudflare Workers Analytics Engine, through a small counter I run. Page views, the
  > referring site and load times go to Cloudflare Web Analytics.
  >
  > **Daily visitors:** to count visitors without remembering anyone, your IP address and browser are mixed with a
  > random key that is deleted the next day. Your IP address is never stored.
  >
  > **How long:** events are deleted after 3 months. Monthly totals (counts, no individual events) are kept in the
  > project's public documentation. Web Analytics keeps page views for the period in Cloudflare's own limits.
  >
  > **Opt out:** turn on Global Privacy Control or Do Not Track in your browser, or use the switch below.
  >
  > **Questions:** open an issue on GitHub.

**Before the site Worker migration:** `workers/site` sets a session cookie and logs a session id and a salted IP tag
for abuse control. That is outside this plan, but the note's "no cookies" and "never stored" sentences must be
rewritten before that Worker serves the app.

## Volume

A typical page load is about 20–40 events (one `app_loaded`, about 10 exposures, a few uses, items and emotes), sent
in 2–4 requests. Workers Free allows 100,000 Analytics Engine data points a day (checked 23 Nov 2026), so roughly
3,000–5,000 page loads a day across all four apps before the limit. Requests also count against the account's 100,000
Worker requests a day, which the share-preview Worker uses too, and so will the site Worker after the migration. Near
either limit, send exposures as one summary row per page load.

Analytics Engine samples heavy traffic. Counts are `SUM(_sample_interval)`. The report script stops and says so if a
period it reports was sampled, because distinct visitor counts are not reliable then.

## Retention and the metrics snapshot

Analytics Engine keeps events for 3 months. **On the first of each month**, run the report script
(`scripts/usage-report.mjs`) locally with a read-only API token that is never committed, and commit its totals to the
"Metrics snapshot" section of `docs/metrics.md`, with the date range and the queries. Skipping a month loses that
month once it is 3 months old. The figures are copied from the query output, never estimated.
