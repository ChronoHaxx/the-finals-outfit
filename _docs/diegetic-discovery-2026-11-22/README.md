# The builder shows itself: callouts, a tour, a short Guide, one panel language (22 Nov 2026)

The user's ask (22 Nov): "the features what you can do should be more diegetic and less word slop, maybe be more smart
or a hint when cursor is close to the button or something, or a tour-like guide even. make everything more cohesive
feature wise and parallelism like have great taste and vibes".

The "What you can do" guide (PR #65, 21 Nov) was a full-screen page of paragraphs that said where each control was
("Camera button, top right"). Its one-time tip hung under the Guide button and, on a phone, covered the whole viewer top
row. This change makes the interface point at its own controls instead.

## What a visitor sees

- **Callouts.** Bring a mouse within 28 px of a control you have never pressed and, after a short pause (180 ms), a
  one-line callout names it, says what it does and shows its key. Once you have used it, the callout waits for a direct
  hover (550 ms), like a tooltip. A keyboard focus shows it at once and wires it as the control's description
  (`aria-describedby`, `role="tooltip"`). Esc dismisses it, and you can move the pointer onto it to read it. While the
  pointer is on another control or inside a panel, no neighbouring control is called over. Touch-only screens get no
  pointer callouts.
- **Red corners.** The site's signature cut top-right corner, filled red, marks controls not tried yet. Only three show
  at a time, in tour order. A control loses its corner once its callout has been up for 0.7 s, the tour has stopped on
  it, "Show me" has framed it, or it has been used. The corner is a background image, so it changes no layout.
- **The tour.** Started from the welcome screen ("Take the tour") or the Guide. It has nine stops: Items, In-game
  outfits, Saved outfits, Share outfit, Emotes, Lighting, Capture, Camera, Hide UI. Viewfinder brackets (the
  viewer's own corner marks) glide from control to control and dim the rest. A card beside each control gives its name
  and one line, with Back / Next / Finish, ← / →, and Esc to stop. Nothing is blocked: the dim takes no pointer events.
  Stopping keeps the stop, and the Guide and welcome screen then offer "Resume the tour · Stop 4 of 9". Finishing offers
  "Replay the tour". A control inside the closed items drawer opens the drawer first. A stop whose control is not on
  this page is skipped; on a page with none (the roadmap) the tour pauses instead of ending.
- **The Guide** (top-bar button or ?). A compact sheet: the tour button, then every control as one line grouped by verb
  (Build, Pose, Light, Shoot), each with **Show** (frames the control on the page for a few seconds), then the keys and
  gestures. Tried controls get a tick. A control that only appears in some state says what brings it up ("Play an emote
  to see it").
- **Nudges** tied to a real action, each once per browser:
  - "Frame by frame": the first emote, on a mouse-and-keyboard device. It shows the keys as key caps.
  - "Share this pose": the first pause. It takes over from the keys nudge if both would show.
- **One panel language.** Lighting, Camera, Capture and Graphics share one shell (`src/components/ViewerPanel.tsx`):
  - The trigger is icon + name + chevron. The names collapse to icons on a narrow 3D view; Lighting keeps the look's
    name.
  - Every panel opens with the same header: red bar, icon, name, close button.
  - They share one surface (the `panel` utility) and one short drop as they open (`animate-drop`, off under reduced
    motion).
  - They close the same ways.
  - The Saved outfits and Share popovers and the emote picker use the same header and surface.
- **The top row** groups the square buttons that act at once (Full screen, Hide controls) apart from the four panel
  buttons. The Camera panel got an axes icon, because the viewfinder now means "framing something" (the tour, Show) and
  the camera body stays with Capture. That two-camera pairing had needed a sentence in the old guide.
- **Smaller consistency fixes:**
  - "Animate" keeps its name, with its state in the square, like Facial animation and Sway (it used to flip to
    "Animated").
  - "Sway · approx." became "Sway"; the caveat stays in its tooltip.
  - The emote button's "☺" glyph and the Sun's "☀" became icons.
  - The column's Pause shows only for the idle, because an emote has its own on the timeline.
  - Over-long help lines in the panels are trimmed to one line.
  - The player number joined the guide (its Own toggle needs saying), with the 0–99 range main shipped the same
    evening.

## Where things live

- `src/data/feature-guide.ts`: the single source of every word. To add a feature, give its control one entry (id,
  group, name, one-line verb-first hint, keys, `needs` text for state-bound controls, `noMark` when its label already
  says it all), then call `useFeature("<id>")` on the control. `tests/feature-guide.test.ts` fails if an id is not on
  a control, if a control's id has no entry, or if a hint says where instead of what.
- `src/lib/discovery.ts`: per-browser preferences in localStorage `finals-outfit.discovery`:
  - `used` and `seen` stamps per id, plus the tour's `status` and `stop`.
  - Each write is read, change, write back; unknown fields and values survive, and each id keeps its first time, so two
    tabs merge.
  - Refused storage keeps the state for the page's life.
  - A tour left running comes back paused; an unknown stop restarts it.
  - Automation reads everything as known.
- `src/lib/hints.ts`: one-time nudge records in `finals-outfit.hints` (unchanged format). The retired `guide` id is left
  in place for visitors who have it.
- `src/components/Discovery.tsx`: the layer (callouts, spotlight, tour card, Show me, nudges) and usage tracking. A
  press or change inside a `[data-feature]` element, or its key (H, , . < > ?), counts as use.
- `src/lib/discovery-layout.ts`: placement geometry (pure, tested).
- `src/components/FeatureGuide.tsx`: the Guide sheet and the ? key.

Nothing here touches outfits, saved looks or any other setting. The tour may open the items drawer, which is a
remembered view preference, the same as pressing its tab.

## Traps met

- **Focus and `visibility: hidden`.** The tour card was `visibility: hidden` for the instant before it was measured.
  The tour moves focus into it in that same commit, a hidden element cannot take focus, and so ← / → did nothing. It is
  now off screen with opacity 0 until placed.
- **Synthetic taps are mouse events.** Playwright's `click()` on a touch emulation arrives as `pointerType: "mouse"`.
  The pointer resting on an open panel's button was within 28 px of Animate, which opened a stray callout. Two guards
  fix it: open ground only, and `(any-hover: hover)`.
- **Focus callouts and nudges.** A focus callout (keyboard focus left on Emotes after Esc closed the picker) used to
  outrank a nudge and hide it; both can now show.
- **Native tooltips and names stay.** The project's harness scripts drive the app as a visitor and find controls by
  their `title`, for example `[title="Play an emote"]` (31 uses) and `[title="Lighting and backdrop"]` (21), and by
  `aria-label="Hide UI"`. So every title and accessible name is kept as it was. The first build kept titles only for
  automated browsers and renamed Hide UI to "Hide controls"; both were reverted before merging. While a callout shows,
  it sets aside the titles on its control and inside it, and gives them back after (unless the control set a new one
  meanwhile), so there is never a double tooltip.
- **The release check script.** `scripts/check-production.mjs` fails on main's own build too (it rejects the
  reconstruction shard host): not this change.

## Checks

The checklist and agent result are in [functional-checklist.md](functional-checklist.md). Run the harness with
`node _docs/diegetic-discovery-2026-11-22/discovery-check.mjs <url> <outDir>` against a production build.
