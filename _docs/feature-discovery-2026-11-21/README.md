# Feature discovery: "What you can do" (21 Nov 2026)

**Ask:** Shocka's feedback item 9 (`_docs/feedback-shocka-2026-11/README.md`). On 17 Nov Chrono told him the site
should "make it more clear what features the website have". He had missed mobile support, outfits saved in the
browser and sharing a paused emote frame.

**Baseline:** main `0951e1b` (21 Nov), rebased on 22 Nov onto main `96bf586`. The guide describes only what is on
main. #58 (emote speed and face switch), #60 (player number) and #62 (Season 1-2 emotes) merged before this PR and
are described (rows marked 22 Nov below). These open PRs are not: #57 (scene backdrops), #59 (camera views and share),
#61 (light markers and presets), #63 (sharper screenshots and video export) and #45 (preset outfits). #53, #64 and #69
have no new control to describe. Patch notes and `ROADMAP.md` are untouched.

## Finding: share links do not carry the lighting

The brief and the feedback README say the lighting is "kept in share links" and that Shocka "found it already works".
The code says otherwise. `buildShareUrl` (`src/lib/share-url.ts`) writes the outfit code, `bt` (body type) and the pose
keys (`emote`, `t`, `paused`) and nothing else; no code reads lighting from a URL. The lighting lives in
`localStorage["finals-outfit.lighting"]` (`src/lib/lighting-store.ts`). Opening your own link in your own browser
therefore shows your own lighting, which looks like the link kept it. Anyone else gets their own lighting (Studio by
default).

So the guide says plainly: "Lighting is not part of the link: whoever opens it sees the lighting set in their own
browser." Putting the look into the link would be a feature of its own. It fits with feedback item 3 (camera in share
links).

## Inventory of what has shipped (main 0951e1b)

| Feature | Where it is | Guide entry |
|---|---|---|
| Items drawer beside the view; a sheet under it on a phone held upright; search and 3D-status filter | Items tab at the stage edge | `build/items`, `phone/phone-layout` |
| Body types: Masculine, Androgynous (saved and shared) | Body type, under the outfit name | `build/body-type` |
| Player number 10–99, or Own (saved and shared; #60, 22 Nov) | Number, beside Body type | `build/player-number` |
| Randomise (rules-based), lock pieces, Include red; a hand-made outfit is kept | Foot of the outfit | `build/randomise` |
| Report issue (whole outfit or one piece), prefilled GitHub issue | Next to Reset | `build/report` |
| Saved outfits: autosave, up to 100, rename, duplicate, delete with undo | The outfit name | `saved/saved-outfits` |
| Remembered per browser: lighting and looks, emote sound and loop, graphics, drawer | — | `saved/remembered` |
| Share link: outfit + body type + player number, "Include this frame" (pose, paused or playing), link styles | Share outfit | `share/share-link` |
| Link with preview image (four angles) | Link style, in the share panel | `share/share-preview` (only where the preview host is set) |
| Emotes from in-game icons, grouped by season from Season 1 (#62), props, sound (mute, volume), facial animation; search, Complete only | Emotes, right column | `emotes/emotes` |
| Timeline: pause, scrub, step `,` `.`, Loop, close | Bottom of the view while an emote plays | `emotes/timeline` |
| Emote speed ¼×–4× (`<` `>`), Facial animation switch, both remembered; not in links (#58, 22 Nov) | Right column while an emote plays | `emotes/speed-face` |
| Idle and still pose (Animate), Sway | Right column | `emotes/idle` |
| Lighting panel: looks (Studio, Lobby, sun looks, your own), lights, backdrop, ground shadows, exposure | The button named after the look | `look/lighting` |
| Graphics: Auto, quality, anti-aliasing, resolution, FPS counter | Graphics, top right | `look/graphics` |
| Full screen; H or the eye button hides the UI (H, Esc, double-click or double-tap back) | Top right | `capture/full-window` |
| Screenshot: PNG download or copy, backdrop or transparent, ground shadow, up to 3x | Camera button, top right | `capture/screenshot` |
| Touch: drag, pinch, two-finger move, double-tap | — | `phone/phone-camera`, Touch list |
| Chinals mode (45 emotes) | Global \| Chinals switch | `chinals/chinals` (only where the mode is on) |

## What was built

- **The guide** (`src/components/FeatureGuide.tsx`, content in `src/data/feature-guide.ts`). It is a modal dialog in the
  welcome screen's style, listing every feature above with the place of its control. Its "Keys and gestures" list
  covers mouse, keyboard and touch. On a touch screen the phone section and touch list come first. It is a dialog,
  not a route, so opening it never reloads the character.
- **Three ways in, none of them pushy:**
  - a "What you can do" button beside "Enter builder" on the welcome screen;
  - a **Guide** button (a ? icon) at the right end of the top bar, on every page;
  - the `?` key. It is ignored while typing, with a modifier, or over another dialog.
- **Two one-time tips** (`src/lib/hints.ts`, `src/components/HintTag.tsx`):
  - `guide`: once, under the Guide button, after the welcome screen has closed: "Phones, saved outfits, sharing a
    paused pose: see everything the builder can do." With "Show me" and ×.
  - `pause-share`: the first time an emote is paused, above the timeline: "Share outfit can include this frame, so the
    link opens on this exact pose."
  - Each goes for good in this browser when closed, used, or left on screen for 20 s (guide) or 10 s (pause). The
    countdown pauses while the tab is hidden. Playing the emote again only hides the pause tip.
  - Opening the guide by any route also retires the guide tip.
  - The record is one key, `finals-outfit.hints`, read-modify-write in try/catch, so fields another version writes are
    kept. Without storage a dismissal lasts for the page.
  - Automated browsers never see tips, and the guide never opens by itself, so captures are unchanged.
- **Public text:** the guide's strings pass `src/lib/public-text.ts`. A Vite plugin (`feature-guide-text`) checks them
  at build and dev start, with `PUBLIC_TEXT_DENYLIST` in CI, as for the roadmap and the patch notes.

**Phone header:** at 375 px the wordmark's subtitle already wrapped on main, and the extra ? button made the title
wrap and spill out of the header. Below 640 px the nav items are 4 px narrower and the GitHub icon is left out, so the
wordmark now fits on one line at 375 px. GitHub stays from 640 px up, and Report issue still leads there on a phone.

Files touched outside the new ones are kept small: one button in the top bar (`ProjectLinks.tsx`), one button in the
welcome screen (`IntroDialog.tsx`), the tip in `EmoteTimeline.tsx`, and one line each in `main.tsx`, `Icons.tsx` and
`vite.config.ts`. Nothing touches the files #57 changes (`CharacterViewer`, `LightingPanel`, `ScreenshotPanel`,
`AnimationControls`), nor #53's `ROADMAP.md` and `changelog.ts`.

When any of those PRs, or #45 (preset outfits), lands, add its entries to `src/data/feature-guide.ts` in that PR.
