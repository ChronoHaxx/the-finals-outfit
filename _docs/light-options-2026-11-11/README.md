# Lighting and backdrop options (11-12 Nov 2026)

The user's and the community's request: more customisable lighting and backdrop. Scope picked by the user on
11 Nov: floor shadow + sun height, Lobby rim colour (hue wheel, brightness held), backdrop colours, a Lighting panel
with looks, Reset and Undo. Procedural sky skipped for now. In-game scenes as backdrops (the match-intro arena, the
main-menu background, later whole maps) are a separate follow-up, pending the user's screenshots.

Base: PR #37 (`claude/studio-sun-2026-11-11`, 4ee3244), which added the Sun direction slider.

## What changed

| Piece | Where | Default (= reviewed look) |
|---|---|---|
| Settings, maths, backdrops, looks | `src/lib/stage-lighting.ts` | `null`/`false`/`"default"` mean the reviewed value exactly |
| Storage (one key, read-modify-write) | `src/lib/lighting-store.ts` | automated browsers never read it |
| Sun height, fitted shadow camera, body follow | `KeyLight` in `CharacterViewer.tsx` | reviewed ±1.4 × ±1.6 m, far 20, bias -0.0002 |
| Floor shadow (`ShadowMaterial`) | `FloorShadow` in `CharacterViewer.tsx` | off (not mounted) |
| Lobby rim hue | `rimLights` + `LobbyLights` | shipped #3f6dff / #2f56ff |
| Backdrop per theme | CSS behind the transparent canvas; share card stops | the existing gradients, same strings |
| Panel | `src/components/LightingPanel.tsx` (sun button in the top row) | |
| Still view | `StableFrameState`: a light's matrix is a lighting input | |

## Rendering notes (why it is built this way)

- **Shadow map geometry.** A directional light's shadow map is a depth picture taken along the light, one texel per
  position across the beam. A head and the tip of its floor shadow share one texel, so the frustum only has to hold
  the character seen from the light. Seen from a sun at height e, a point h high and d towards the light lands
  h·cos e − d·sin e up the picture: an asymmetric top/bottom that grows upward as the sun drops.
- **Far plane.** The floor tip lies H·cos²e / sin e beyond the target along the beam (about 14 m at 10°); past `far`
  three treats it as lit, so the reviewed far of 20 m cut low-sun shadows short (test: "the reviewed frustum would cut
  a low sun's shadow short"). Far grows; the bias (a fraction of far − near) is rescaled to the same 3.9 mm.
- **normalBias on the floor.** The 2 cm lookup offset along the normal would move the floor shadow 2 cm / tan e off the
  feet (11 cm at 10°). The floor casts nothing (no acne possible), so its geometry has no normal attribute and three
  skips the offset for it alone.
- **ContactShadows.** drei renders the scene from y = 0 looking up; the floor sits 2 mm below so it is clipped out of
  that depth picture. Floor: no depth write, renderOrder −1.
- **Travelling emotes.** With the floor on, light and target follow the pelvis on a 0.25 m grid (clamped ±3 m), so
  the frustum moves with the body; each step restarts the still view (not every frame).
- **Rim brightness.** Light colour multiplies intensity per channel; luminance is 0.2126 R + 0.7152 G + 0.0722 B in
  linear light, so yellow at the blue's intensity reads ~5× brighter. Intensity is scaled to hold the shipped
  luminance, capped at 1.25× (the blue is already near the darkest hue; the full match would push violet's blue
  channel far past anything the Lobby had).
- **Still view.** A light's world matrix was recorded as a transform, so a sun drag was "reprojectable" (history
  carried over by motion vectors, clamped). Shading and shadows change in place, which motion vectors cannot follow:
  it is now a lighting input and restarts the history. Trade-off: alpha-hashed hair shows grain while dragging a light,
  as it already did for colour changes.

Plan reviewed by Fable 5.2 before building (thread 164a2365, about $1.88): it found the far-plane cut, the normalBias
offset and the travelling-emote frustum exit, and suggested the asymmetric frustum and the rim gain cap.

## Agent checks (12 Nov 2026)

- `npx tsc -b --noEmit`: PASS.
- `npm test`: 806 tests, 793 pass, 8 fail, 5 skipped. The 8 failures are the known ones that need local
  `public/models/*.glb` fixtures this worktree lacks. New tests: `tests/stage-lighting.test.ts` (7),
  `tests/lighting-store.test.ts` (7) and a light-move case in `tests/rig/stable-frame-reprojectable.test.ts`.
  - The frustum test projects real points (a 2.5 m caster within 1 m, and each point's floor-shadow tip) through a
    three.js shadow camera for every height from 10 to 85° in 5° steps, 5 azimuths, following on and off. A control
    test shows the reviewed frustum misses a 10° shadow.
  - The store tests cover the loss paths: PR #37's stored angle, unknown fields kept, Undo after a reload, the 12-look
    cap refusing (never replacing), another tab's look surviving a delete, a stale backdrop in a look, blocked storage.
- Production build in headless Chrome (`light-options-test.mjs`; shots stay local in `shots/`, renders of game assets):
  - **Default look unchanged.** Under automation, with a custom look stored in localStorage, this build against main
    43aefec: Studio 92 / 403,000 pixels differ (max 5 levels), Lobby 121 (max 8). The same main build against itself
    (`noise-floor.mjs`): 113 (max 4) and 112 (max 8). The differing pixels are on the eyes and neckline (alpha-hashed),
    as in main against itself. The backdrop CSS is the same string.
  - As a person: no page errors. Floor shadow at the reviewed sun, the four Studio looks, a 10° sun with and without
    the floor, five backdrops, five Lobby rim hues, the Lobby on the Studio grey backdrop, a travelling emote with the
    floor on, the phone layout (390 px: no sideways scroll, panel within the viewer). All screenshots looked at.
  - Saved look and settings survive a reload. Reset returns the reviewed look and the backdrop string, keeps the
    replaced look; Undo restores it.
- **Not covered:** an additive hologram (M_FloatingHologram) over the floor shadow. The halo tested
  (`attachment-holtowhalohologram-gold`) turned out to be a layered metal; it reads the same over the shadow. Fable's
  analysis: the accumulator's output passes additive light through only where alpha is 0, so over shadow alpha a an
  additive glow is capped at a. That already happens over the contact shadow today; the floor shadow covers more floor.
- Build gotchas met on the way: Git Bash rewrites `VITE_BASE=/` to `/Program Files/Git/` (use `MSYS_NO_PATHCONV=1`),
  and a build without `VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json` loads no outfit. Ports
  5186/5187 were in use by other sessions; the tests used 5196 (this build) and 5197 (main 43aefec).
