# Camera controls (21 Nov 2026)

Shocka's feedback, item 3 (`_docs/feedback-shocka-2026-11/README.md`, held in the main checkout):

1. Share links keep the camera position and target, "so other people can try to improve your screenshot".
2. Save camera positions, at least for the session and ideally with the outfit; recall them in one click.
3. Show the camera's coordinates and let the user type XYZ (and the target).
4. Camera rotation (roll), if it fits the orbit controls cleanly.

## What was built

| Ask | Where | How |
|---|---|---|
| Links keep the camera | `src/lib/camera-view.ts`, `share-url.ts`, `ShareBuild.tsx`, `open-link.ts` | `view=x_y_z_tx_ty_tz[_roll]` rides last in the short (hash) and readable (query) links. Omitted when the camera is on the default framing. "Include camera view" in the share panel leaves it out. The 4-angle card is unchanged. |
| Preview links keep it | `workers/share-preview` | The Worker validates, stores (KV metadata `view`) and returns the view like `bt` and the pose. Deployed 21 Nov 20:30 London, version `773a350e` (rollback `f9f734a6`); live since 22:01 inside `efb3af6b`, which adds #60's `pn` (rollback `773a350e`). Checks in the Worker README. If a Worker without it ever serves, preview links drop the view and the share panel says so. |
| Saved views | `camera-view.ts` (list rules), `outfit-library.ts` (`cameraViews` field), `useSavedOutfits.ts` (actions) | Up to 20 views per outfit, saved into the outfit record as you go (journal, then IndexedDB). Rename, delete with Undo (tombstone). Views of other saved outfits are listed for recall. |
| Coordinates | `CameraPanel.tsx`, `CameraBridge.tsx` | A viewfinder button in the viewer's top row. Camera and Looking-at X/Y/Z follow the camera live; typing applies on Enter or leaving the field; arrows nudge 1 cm (Shift 10 cm); Escape reverts. |
| Roll | `CameraBridge.tsx` | A slider (-180..180°, 0.5° steps) and Level. Applied after OrbitControls' update each frame, from scratch, so it never accumulates. |

## Design notes

**Why `view`, not `cam`.** `?cam=` is the visual-diff harness's dev switch (CharacterViewer `readDevParams`). The pose's
names were chosen apart from the dev switches for the same reason: link tidying (`cleanUrl`) must never remove a
developer switch, and a readable link puts its parameters in the query, where `?cam=` lives.

**Grammar.** Underscores separate the numbers, so the value needs no percent-escaping in either link style (commas
became `%2C` through `URLSearchParams`). Millimetres and tenths of a degree. Coordinates are capped at 100 m and the
camera may not sit on its target. The Worker checks the shape only (numbers, not text); the app checks ranges when a
link opens.

**Roll and OrbitControls.** drei's OrbitControls (three-stdlib) call `update()` every frame at priority -1, which ends
in `camera.lookAt(target)` with the world up. Roll is therefore applied at priority 0, after that and before the
still-view render at priority 1: `lookAt(target)`, then `rotateZ(-roll)`. It is recomputed each frame, so nothing
builds up, and roll 0 leaves the controls' frame untouched (default view pixel-identical). The controls' change
detection copies the quaternion inside `update()`, before the roll, so a rolled camera does not fire change events
every frame. Orbiting still swings around the world's vertical; panning follows the tilted picture because the controls
pan along the camera's own matrix columns. Changing `camera.up` instead was rejected: three-stdlib recomputes its orbit
basis from `up` each update, so the whole orbit would tilt.

**Stopping inertia on a jump.** three-stdlib keeps its damping deltas in closures, so they cannot be zeroed from
outside. Placing a view runs one `update()` with damping off (spending what is left of a drag), then sets the target
and position and updates again, all before the next frame is drawn.

**PR #57 (scene backdrops).** Its turntable mode switches the OrbitControls off and pins the camera. This code never
imports #57; it treats "controls disabled" as "camera locked": the panel's fields, Save view and recall are disabled
with a note, a link's view waits until the controls are back on, no roll is applied (the plate stays exact), and a
share leaves the view out. `CameraBridge` is mounted above `<OrbitControls>` so the two PRs do not touch the same lines.

**Saved views and the "never lose work" rules.**
- The record field `cameraViews` is added without a schema bump, like `bodyType`. Older builds keep it as an unknown
  field: their writes delete only their own known fields from the stored copy before overlaying theirs
  (`mergeForWrite`). Checked against the shipped library (main `0951e1b`) in a one-off script (see Evidence).
- The stored list is kept exactly as written. Entries this version cannot read stay in place and are never shown;
  changing an entry spreads the stored object, so unknown fields survive; deletion is a tombstone (`deletedAt`).
  A non-list value (some future format) is round-tripped and never rewritten (Save view says why).
- `cameraViews` counts as content (`sameContent`), so a journal replay never settles a view-only change away.
- Saving a view clears `generated`: the outfit is hand work now, so Randomise and Reset make a new outfit instead of
  replacing it in place.
- On an unsaved shared-link draft, the first saved view promotes it to a saved outfit, as a hand edit does. At the
  100-outfit cap the view stays on the draft (this visit only) and a toast says so; nothing is evicted.
- 20 live views per outfit; saving past it is refused with a message, never an eviction.
- Undo after switching outfits restores the view on its own outfit, not the one on screen.

Known limit: a build from before this change that replays a crash journal written by this build (a downgrade after a
killed tab) compares outfits without `cameraViews` and can settle a view-only change. The stored copy is untouched;
only that unflushed view change is lost. It needs a downgrade and a crash together.

## Evidence

The build, test and real-app checks of 21 Nov are in PR #59's description.

### Scene mode with PR #57 merged (22 Nov 2026)

Build: this branch `22d086d` merged with #57's head `8e93a1c` (clean merge, scratch commit `71ff654`, not pushed),
`tsc -b` and `vite build` PASS, served by `vite preview --base /` with the deploy hosts and #57's scenes host
`1d367244`. Run in Playwright's Chromium (navigator.webdriver masked, so stored preferences behave as for a visitor).
The camera was read from the renderer each frame through three.js's `__THREE_DEVTOOLS__` hook, added to the scratch
`index.html` only; "tilt" below is the angle between the drawn camera and an upright camera looking at the same target.

| Check | Result |
|---|---|
| Free camera before the scene: typed (1.2, 1, 3), roll 30, Save view | Camera at (1.2, 1, 3), tilt 30.00°; "View 1" saved and pressed |
| Intro tunnel scene (plate) on | Camera exactly at the scene camera (0, 1, 3.6) → (0, 0.9, 0), fov 35, tilt 0.00° in 5 samples; picture level against the plate |
| Camera panel in the scene | Note "The camera is fixed while a scene backdrop is shown…"; fields, Roll, Level, Reset camera, recall and Save view disabled; panel stays open on canvas presses |
| Drag and wheel in the scene | Drag turned the character, camera unchanged; wheel narrowed fov 35 → 27.5 with no dolly; tilt 0 |
| Share in the scene | Copied link `#/?o=…` has no `view`; no "Include camera view" option shown |
| Leave the scene (Studio grey) | Back at (1.2, 1, 3), tilt 30.00°, fov 35; panel enabled, "View 1" pressed |
| Fresh load of a `view=-1.5_1.2_2.5_0_1_0_-10` link with the tunnel scene stored | Scene camera, tilt 0, while the view waits; leaving the scene applies it: (-1.5, 1.2, 2.5) → (0, 1, 0), tilt 10.00°, Roll -10 |
| Season 12 menu scene (stage canvas) with roll -10 held | Viewer camera at the scene camera, tilt 0; leaving restores (-1.5, 1.2, 2.5) with tilt 10 |
| Console | 0 errors (three's Clock deprecation warning only) |

Seen while checking, both wording only: in a scene the panel's Roll shows the roll that comes back afterwards (30°)
while the picture is level, and the panel's footer still says share links open on the camera you see, though a
scene's links leave the camera out. Both fixed in the merge below.

### Merge with main `137c920` and the checklist under the waiver (22 Nov 2026)

main gained #60 (player number), #62, #63, #65 (feature guide), #66, #67 and #57 (scenes). Merged as `59656eb`:

- Links, the preview upload and link tidying carry `pn` and `view` together, in the live Worker's order
  `o, bt, pn, pose, view`. Saved outfits keep both `playerNumber` and `cameraViews`.
- `workers/share-preview/src` and `tests/share-preview-worker.test.ts` come from `claude/share-worker-pn-view-2026-11-21`
  (`91a22dd`, the build deployed as `efb3af6b`); `git diff 91a22dd -- workers/share-preview/src` is empty, so main
  matches the live Worker and no deploy is needed.
- Patch note re-dated `2026-11-22-camera-controls` and placed first; the roadmap is reviewed after it. Feature guide:
  a "Camera position and saved views" entry, and the share entry mentions the camera.
- Camera panel: while a scene holds the camera, Roll reads 0 (the picture as drawn), the note says the view and roll
  come back, and the footer says links leave the camera out.

The checklist below (the PR's steps 1-6, run by the agent on a production build because the user waived manual checks
on 22 Nov) found one defect: the Roll row was a `<label>`, which names and clicks its first control, the Level button.
The button's accessible name was "Roll 20° 20°", and clicking the word Roll or the readout levelled the shot. The row is
now a `div` (the slider has its own name).

Run 22 Nov 2026 12:10-12:18 London, on the tree of `59656eb` plus the Roll-row fix: `tsc -b` PASS; `npm run build`
with the deploy hosts PASS (roadmap and public-text checks; no local denylist); `check:catalog-split` PASS; `npm test`
1017 pass, 8 fail, 6 skipped (the 8 are the known missing `public/models` and ski-blade GLB fixtures); the share,
saved-outfit, camera, player-number, roadmap, guide and scene suites 126/126. Real app: `vite preview` of that build,
Playwright Chromium, webdriver masked, storage cleared first, the preview Worker blocked so nothing was uploaded.

| Step | Result |
|---|---|
| Welcome screen | Latest patch note is "Camera controls", 22 Nov |
| 1. Orbit with the panel open | (0, 1, 3.6) → (-3.135, 1.795, 1.531) as the drag moves; panel stays open |
| 2. Reset, type Y 1.65, Z 1.2, Looking at Y 1.55; Roll 20; orbit; Level | Head shot; picture tilts; tilt steady while orbiting; Level → 0 and upright. Clicking the Roll caption no longer levels; the button's name is "Level" |
| 3. Save view, Reset camera, recall, rename, delete, Undo | Recall returns to (-0.786, 1.65, 0.906), roll 20, pressed; "Tilted head"; deleted with Undo; restored |
| 4. Reload (navigation type `reload`) | "Tilted head" listed; recall gives the same view |
| 5. Share → Short link; fresh browser context; untick | `#/?o=…&pn=42&view=-0.786_1.65_0.906_0_1.55_0_20`; the fresh context opens the same outfit, number 42, same camera and roll; unticking drops `view` |
| 6. Randomise (new outfit) | "Views from other outfits (1)": "Tilted head · Outfit 1", recalls |
| Tunnel scene with the roll-20 view held | Scene camera (0, 1, 3.6), Roll 0°, new note and footer; Save view, Reset camera, Level disabled. Leaving restores roll 20 and "Share links open on the camera you see." |
| Console | One error: the blocked preview upload (intended). Warnings: three's texture-units false alarm, Clock deprecation, a shader `isnan` note |

Not run: the phone layout, and an end-to-end preview-image share (it would store a real entry on the live Worker).

### Second merge: main `d31db11` (#61 light markers, #72 patch notes), 22 Nov 2026

Text conflicts only (patch notes, roadmap, guide): the camera note stays first, the roadmap is reviewed after it, the
guide keeps #63's "Emote video" and this PR's "Camera position and saved views". The patch note now calls the capture
button the camera button, as the other public text does.

#61 lets you drag a light's bulb in the view, and switches the OrbitControls off for the drag. This PR read "controls
off" as "camera fixed", so mid-drag the camera panel showed the scene note and Roll 0° over a still-tilted picture, and
in a scene the drag would have let the roll back onto the scene camera. `CameraBridge` now re-reads "fixed" only while
no tool holds the pointer (`anyPointerClaimed()` in `lib/pointer-claims.ts`), so a drag keeps whatever state the camera
had before it.

Checked 22 Nov 12:22-12:24 London on a production build of this merge (Playwright, Worker blocked): Studio, Show
lights, camera at (0, 1, 6) with Roll 20°, camera panel open. Dragging the rim bulb moved the light; mid-drag the panel
read Roll 20°, no note, footer "open on the camera you see", camera unchanged, picture still tilted. In the tunnel scene
the same drag kept Roll 0°, the note, the scene camera (0, 1, 3.6) and a level picture; leaving the scene restored
(0, 1, 6) with Roll 20°. `tsc -b`, build, catalog split PASS; `npm test` 1026 pass, the same 8 fixture failures,
6 skipped; the affected suites 126/126.
