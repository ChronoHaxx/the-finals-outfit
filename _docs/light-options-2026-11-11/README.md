# Lighting and backdrop options (11-13 Nov 2026)

The user's and the community's request: more customisable lighting and backdrop.

- **First version (f98e97e, 12 Nov).** Scope picked by the user on 11 Nov: floor shadow + sun height, Lobby rim hue,
  backdrop presets, a panel with looks, Reset and Undo. Procedural sky skipped. In-game scenes as backdrops went to a
  separate session.
- **Second version (12-13 Nov), this revision.** After trying it the user asked for "color picker for everything",
  no separate Studio/Lobby modes ("bit confusing"), and as much freedom as possible, with Blender-like light editing
  later in the multi-character scene. So the theme toggle is gone: there is one **look** (a list of lights, sky/ground
  fill, reflections, tone mapping, exposure, ground, backdrop), and Studio and Lobby are two ready-made looks in it.

Base: PR #37 (`claude/studio-sun-2026-11-11`, 4ee3244), which added the Sun direction slider.

## What changed

| Piece | Where | Default (= reviewed look) |
|---|---|---|
| The look: lights, fill, reflections, camera, ground, backdrop; checks for stored looks | `src/lib/stage-lighting.ts` | `studioLook(STUDIO_RIG)`, number for number |
| Storage (one key, read-modify-write, lights merged by id) | `src/lib/lighting-store.ts` | automated browsers never read it |
| Panel (sun button in the top row) and the HUD Sun slider | `src/components/LightingPanel.tsx` | |
| Scene from the look: `StageLights`, `SunLight`, `FloorShadow`, tone mapping, backdrop | `CharacterViewer.tsx` | the Canvas no longer remounts on a look change |
| Still view: a light's matrix is a lighting input | `src/rig/StableFrameState.ts` | |

The panel, top to bottom: **Looks** (Studio, Lobby; Overhead, Side light, Backlit, Low sun), **Backdrop** (9 presets,
Solid or Gradient, colour pickers), **Lights** (one card per light: colour, on/off, brightness, direction, height,
remove; the sun alone casts shadows; Add light up to 6), **Ground** (contact shadow, floor shadow and its strength),
**Sky and reflections** (sky and ground colours, strength; reflections Softbox, Room or None, strength, turn),
**Camera** (exposure, tone mapping Neutral, ACES or AgX), **Saved looks** (up to 12), Reset to Studio and Undo. The
button shows the look's name (Studio, Lobby) or Custom.

Settings from the first version and PR #37's stored Sun angle convert on load (the sun turns exactly; the Studio
backdrop carries over).

## Rendering notes (why it is built this way)

- **Shadow map geometry.** A directional light's shadow map is a depth picture taken along the light, one texel per
  position across the beam. A head and the tip of its floor shadow share one texel, so the frustum only has to hold
  the character seen from the light. Seen from a sun at height e, a point h high and d towards the light lands
  h·cos e − d·sin e up the picture: an asymmetric top/bottom that grows upward as the sun drops.
- **Far plane.** The floor tip lies H·cos²e / sin e beyond the target along the beam (about 14 m at 10°); past `far`
  three treats it as lit, so the reviewed far of 20 m cut low-sun shadows short (test: "the reviewed frustum would cut
  a low sun's shadow short"). Far grows; the bias (a fraction of far − near) is rescaled to the same 3.9 mm. The
  reviewed frustum is kept exactly whenever the sun keeps the reviewed height and distance (any direction).
- **normalBias on the floor.** The 2 cm lookup offset along the normal would move the floor shadow 2 cm / tan e off the
  feet (11 cm at 10°). The floor casts nothing (no acne possible), so its geometry has no normal attribute and three
  skips the offset for it alone.
- **ContactShadows.** drei renders the scene from y = 0 looking up; the floor sits 2 mm below so it is clipped out of
  that depth picture. Floor: no depth write, renderOrder −1.
- **Travelling emotes.** With the floor on, light and target follow the pelvis on a 0.25 m grid (clamped ±3 m), so
  the frustum moves with the body; each step restarts the still view (not every frame).
- **Light count is compiled into the shaders.** three writes the number of directional lights into every material's
  shader. A light switched off stays mounted at intensity 0 (no recompile); Add, remove and Casts shadow change the
  count and recompile once, which the panel says.
- **Only the sun casts.** Each shadow-casting light renders the scene again into its own map. One caster keeps the cost
  of the reviewed look; other lights shade but cast nothing.
- **Tone mapping and exposure switch live.** react-three-fiber re-applies the Canvas `gl` props each render, so no
  remount (the old theme switch remounted the Canvas, which is what PR #37's "3D view stopped" guard was for; the guard
  stays). The still view's output key includes the tone mapping, so it restarts.
- **Reflections.** PMREM pre-blurs a small scene (the softbox, or three's RoomEnvironment) into the reflection map.
  Turning it sets `scene.environmentRotation` in place; three keeps a reference to that object.
- **Free colours and brightness.** A light's colour multiplies its intensity per channel, and perceived brightness is
  luminance, 0.2126 R + 0.7152 G + 0.0722 B in linear light: pure blue at the same slider value reads about a tenth as
  bright as white. The first version held luminance for the rim hue; with free pickers the brightness slider is the
  user's, so nothing is rescaled.
- **Still view.** A light's world matrix was recorded as a transform, so a sun drag was "reprojectable" (history
  carried over by motion vectors, clamped). Shading and shadows change in place, which motion vectors cannot follow:
  it is now a lighting input and restarts the history. Trade-off: alpha-hashed hair shows grain while dragging a light,
  as it already did for colour changes.

Fable 5.2 reviews (thread 164a2365):
- **First plan** (about $1.88). Found the far-plane cut, the normalBias offset and the travelling-emote frustum exit.
- **Unified look** (about $1.54). Confirmed that shadows enabled with no caster compile the same shaders, and that a
  live tone-mapping switch is safe (so the remount went). Named these traps, all handled:
  - a sun at intensity 0 still casts (casting is now `enabled && castShadow`);
  - `scene.environmentRotation` must be changed in place;
  - the sky/ground light must take props, not `args` (which rebuild it on every picker event);
  - the Studio backdrop's middle stop is not the mix of the outer two, so the look stores it;
  - picker drags need a debounced write;
  - a harness that clicks the old Studio/Lobby button loses that route.

## Agent checks (12-13 Nov 2026)

- `npx tsc -b --noEmit`: PASS.
- `npm test`: 809 tests, 796 pass, 8 fail, 5 skipped. The 8 failures are the known ones that need local
  `public/models/*.glb` fixtures this worktree lacks. Lighting tests: `tests/stage-lighting.test.ts` (9),
  `tests/lighting-store.test.ts` (8) and a light-move case in `tests/rig/stable-frame-reprojectable.test.ts`.
  - The default look equals the reviewed rig number for number; the Lobby look equals the shipped Lobby lights.
  - The frustum test projects real points (a 2.5 m caster within 1 m, and each point's floor-shadow tip) through a
    three.js shadow camera for every height from 10 to 85° in 5° steps, three light distances, five bearings,
    following on and off. A control test shows the reviewed frustum misses a 10° shadow.
  - The store tests cover the loss paths: the first version's settings and saved looks, PR #37's stored angle,
    unknown top-level and per-light fields kept, a removed light removed, Reset and Undo after a reload, the 12-look
    cap refusing (never replacing), another tab's look surviving a delete, blocked storage.
- Production build in headless Chrome (`light-options-test.mjs`, run 6; shots stay local in `shots/`, renders of game
  assets):
  - **Default look unchanged.** Under automation, with a custom look stored in localStorage, this build against main
    43aefec: Studio 102 / 403,000 pixels differ (max 4 levels); the Lobby look against main's Lobby 103 (max 3). The
    same main build against itself (`noise-floor.mjs`): 113 (max 4) and 112 (max 8). The differing pixels are on the
    eyes and neckline (alpha-hashed), as in main against itself.
  - As a person: no page errors. Three lights recoloured (warm sun, blue rim, an added green light) and stored;
    solid and gradient backdrops from the pickers; Room reflections with AgX, then a live switch to ACES; a reload in
    the middle of an exposure drag kept the value (pagehide flush); a saved look; the button reads Custom, then Studio
    after Reset, and Undo restores the custom look and backdrop; the Lobby look, then red rims (Custom); the four sun
    looks; a travelling emote (big-foot, 0.94 m) with the floor following; the phone layout (390 px: no sideways
    scroll, the panel scrolls inside the viewer). All screenshots looked at.
- **Harness moved to the panel.** `scripts/shader-probe/check-integration.mjs` clicked the old "Toggle scene lighting"
  button. It now opens the Lighting panel and applies the Lobby look, then Studio. Those exact steps ran against this
  build under automation: both looks applied, the panel closed, no page errors. The full harness was **not run**. It
  needs a dev server plus the local recovered-shader fixtures, and serving the main checkout's `public/` from this
  worktree hung while Vite indexed it.
- **Not covered:** an additive hologram (M_FloatingHologram) over the floor shadow. The halo tested
  (`attachment-holtowhalohologram-gold`) turned out to be a layered metal. Fable's analysis: the accumulator's output
  passes additive light through only where alpha is 0, so over shadow alpha a an additive glow is capped at a. That
  already happens over the contact shadow today; the floor shadow covers more floor.
- Build gotchas met on the way: Git Bash rewrites `VITE_BASE=/` to `/Program Files/Git/` (use `MSYS_NO_PATHCONV=1`),
  and a build without `VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json` loads no outfit. Ports
  5186, 5187 and 5197 belong to other sessions; these tests used 5198 (this build) and 5207 (main 43aefec).
- Process slip, fixed: one `sed -i` on `CharacterViewer.tsx` stripped its CRLF line endings in the working copy. They
  were restored and the diff checked unchanged; edits since use the Edit tool only.
