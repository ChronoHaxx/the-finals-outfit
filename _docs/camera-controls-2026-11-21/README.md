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
| Preview links keep it | `workers/share-preview` | The Worker validates, stores (KV metadata `view`) and returns the view like `bt` and the pose. **Not deployed**: needs the user's yes. Until then preview links drop the view, and the share panel says so. |
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

Filled in below after the checks ran.
