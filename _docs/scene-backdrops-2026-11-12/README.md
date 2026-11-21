# In-game scenes as backdrops: scope and options (12 Nov 2026)

This is research only, for the user to pick a scope. Nothing was downloaded and nothing in the app changed. The only new
reads were the installed Season 12 game files, read-only through `scripts/shader-probe` (15 s per run), and the June
FModel dump already on disk. The probe output stays outside the repo; `evidence/` keeps counts and sizes only. Fable
reviewed a first draft, and its corrections are folded in (see "Review" at the end).

## Short answer

- **Both scenes are small.**
  - The S12 main-menu stage is 4 meshes and 4 flat planes, about 1,000 triangles.
  - The S12 match-start podium is 14 meshes, about 12,400 unique triangles, and 17 tileable textures.
- **There is no baked lighting to take.** The game lights these rooms live, with dozens of dynamic lights plus DDGI
  (ray-traced light probes). The `_BuiltData` files hold no lightmaps. Whatever we show, we light ourselves, and the
  user's screenshots are the reference, as the item icons are for outfits.
- **The two scenes need different routes.**
  - **The menu is light, not surfaces.** It is a curved screen wall, a light grid, a glitching title LED, an LED floor
    circle and a smoke plane, all self-lit (emissive) and mostly procedural. It barely needs lighting, so draw it live: a
    few planes with ported shaders, in a pass of their own behind the character (option D).
  - **The podium is surfaces lit by bounce light.** It is a tiled room, a tunnel and a metal platform. Rebuild and
    re-light it once in Blender, then ship images: a plate (option A) or a 360° panorama on three's `GroundedSkybox`
    (option B).
- **The June dump is out of date for both scenes.**
  - S12 rebuilt the podium: a new tunnel, glass, a screen and an `IntroPlatform_01` set.
  - S12 rebuilt the menu: `Background/S12_Reforge`.
  - The menu also changes every season and for every event.
  - So any build has to read the installed S12 paks.
- **Leave the real 3D room (option C) for later or never.** Show whole maps only as panoramas at chosen spots.
- **Updated after the user's screenshots (section 0):** the intro is the S12 tunnel. Both scenes are one-sided views from
  a fixed camera, so both need turntable mode. The panorama (B) no longer fits either scene. Recommended now: D for the
  menu, A for the tunnel.
- **P1 is done (section 7).**
  - Both S12 scenes were rebuilt in Blender from the level files, and each matches its screenshot from the game's own
    camera.
  - The menu sensor is 36 mm, so its view is 30° tall.
  - The tunnel camera was solved from the screenshot: 1.97 m high in the lobby, 6.4 m before the tunnel mouth, about 40°
    tall.

## 0. The user's screenshots (12 Nov)

The user sent two images, "something like this".

**The main-menu home screen** (build CL1439418, the character is the Bull's Eye Barry mannequin):

| Visible | Asset |
| --- | --- |
| A huge blue A mark behind the character: the left triangle and the slash at the top right are its legs, seen through fine LED dots | `T_THEFINALS_01_IconStroke_A` (the A mark with a glow halo; checked by decoding it) on an LED-dot material: the title LED (`LEDTiling`) or the screen wall. P1 finds out which. |
| A regular grid of large white dots | `MI_Frontend_HomeScreenLights` (a light grid with flares) |
| Haze over the floor | `MI_FogPlane_Background`, `MI_FakeFog_03` |
| A thin glowing arc at floor level | the edge of the LED floor circle (`MI_Frontend_FloorLED`, vignette) |
| A dark floor with soft reflections | `MI_MainStageFloor` |

**The intro**, a square image with no HUD and no character:

| Visible | Asset |
| --- | --- |
| A wet, mirror-like tiled floor with gutters | `MI_Floor_IntroPodium_01` (`T_TileFloor_01`) and `MI_Drainage_IntroPodium_01` on `SM_TunnelSegment_IntroPodium_01` |
| Ribbed blue panels with faint A marks | Corrected by P1 (section 7): six `SM_ScreenIntroPodium_01` screens. The A marks are reflections of the end logo. |
| Curved ducts in the ceiling | `SM_CielingAdd_IntroPodium_01` (12.2 × 6 m) |
| A glowing logo with a light bar on each side at the end | The logo is on the end wall, `SM_Glass_IntroPodium_01` with `MI_GlassIntroPodium_01_MPCColors` (`LogoEmissive`). Its background colour comes from the team-colour parameter collection, so blue is one team's colour. The strips are `MI_IntroPodium_Emissive_01` on `SM_TunnelEnd_IntroPodium_01`. (P1 confirmed.) |

So the "arena intro" is the S12 intro tunnel in `G_IntroPodium_01`, not the per-map flyover.

**The game patched on 12 Nov at 12:26 UTC.** The first probe ran on the 29 Oct files, so the scene packages were
probed again on the patched build:
- meshes and textures are identical;
- material-instance parameters are identical;
- master materials changed only in packaging and shader flags;
- the old usmap parsed everything.

Details are in `evidence/patch-2026-11-12-diff.txt`.

**What the screenshots change:**
- **Both views are one-sided, from a fixed camera.**
  - The menu is a stage wall in front of the character, with nothing behind it.
  - The tunnel is about 4.2 m wide, and our orbit camera sits 3.6 m from the character. Orbiting sideways would take the
    camera through the walls, and orbiting round would show the empty back of the menu stage.
  - So both scenes need turntable mode (section 3): the camera stays put and a drag turns the character, as in the game.
    The alternative is orbit limited to about ±30°.
- **The panorama (B) drops out.** A panorama is correct only from the point it was captured at. Its error grows with the
  camera's distance from that point compared with the distance to the walls. Seen from 3.6 m away, walls 2 m from the
  centre would bend badly, and `GroundedSkybox` corrects only the floor.
- **The menu stays D (live stage).** It keeps its animation (glitch, smoke, flicker) and stays sharp at any window size.
  Turntable mode makes it simpler, because the stage is only ever seen from the front.
- **The tunnel becomes A (plate),** rendered inside the tunnel looking at the logo end, as in the screenshot.
  - The floor in the screenshot is a mirror, so a character standing there should reflect in it.
  - A plate can't show that. An optional reflection layer would: the character drawn mirrored under the floor line,
    blurred and faded.
  - It needs care with the still view, because that reflection changes whenever the character moves.
- **The screenshot itself could be the plate,** if the tunnel image is a real in-game frame.
  - First solve its camera from the tunnel's known sizes: segments 4.18 m wide, square tiles and a known vanishing point
    (what fSpy does).
  - That would beat any relight for the look. It needs the image's source, and ideally a wider (16:9 or 21:9) capture at
    full resolution.

## 1. What the two scenes are made of

### Main menu

How the game builds it (June dump, `Maps/MainMenuReforge.umap`):
- It is a persistent level that streams 35 sublevels.
  - 12 are always loaded: character selection, its lighting, the club scene, the backstage and the season backdrop.
  - 23 load on demand: the sponsor scenes, and the Halloween, Lunar and Christmas events.

The S12 backdrop is the blueprint `Maps/Frontend/Background/S12_Reforge/BP_BackgroundStage_S12`, read from the S12
paks:

| Component | Mesh | Material | Size |
| --- | --- | --- | --- |
| BackgroundPlane | `SM_FrontendStage_Wall_01` (260 tris, curved) | `MI_FrontendScreen_Main_S12`: procedural, no textures | scaled ×2, about 16 × 32 × 12 m |
| GridPlaneMesh, LightPlaneMesh | engine Plane | `MI_Frontend_HomeScreenGrid` / `...Lights`: procedural grid and flares | 20 × 20 m each |
| ScreenMesh | engine Plane | `M_Frontend_TitleLED`: THE FINALS logo stroke, LED dots, glitch, channel split | 4 × 4 m |
| SmokePlaneMesh | engine Plane | `MI_FogPlane_Background`: animated smoke | 20 × 10 m |

Also in the folder:
- `SM_BackgroundStage_S12_Circle` and `_Circle_B`: LED floor half-circles, 7.5 × 15 m, 120 tris each, using
  `MI_Frontend_FloorLED`.
- `SM_BackgroundStage_S12_Scaffold`: a 20 m pillar, 508 tris.
- The floor materials `MI_MainStageFloor` (bare metal with a metal-tile normal and a roughness gradient) and
  `MI_BackstageFloor_Reforge`.

Where these sit in S12 needs the S12 level files (step P1 below). In June, the backstage floor was a 56 × 50 m quad.

The menu's lights, post-processing and cameras (June):
- **Lights:** about 40 dynamic lights across the persistent level and `CharacterSelection_Lighting`, plus a sky light.
  The emissive stage doesn't need them; they light the character and the floor.
- **Post-processing:** bloom at intensity 4 with size 64 and a dirt mask, manual exposure, and lens flares.
- **Cameras:** the 41 front-end camera presets are mostly 38 mm at f/4, focused at 3.2 m.
  - The view is about 20° tall if the game keeps UE 5.1's default "16:9 Digital Film" sensor (23.76 × 13.365 mm). It is
    about 30° if it uses "16:9 DSLR" (36 × 20.25 mm). Our viewer's is 35°.
  - The June camera exports override no sensor. P1 reads the S12 cameras and, if needed, the engine config. Fix this
    before matching any screenshot: a 20° screenshot cannot be matched by a 35° render.
  - Teaching point: the depth of field is shallow. A backdrop 8 m behind the character blurs by about 0.12°, about 6 px
    at 1080p in the game's framing, whichever sensor it uses. The game's backdrop is soft on purpose.

Textures the S12 menu needs (measured): 6 of them, mainly the metal floor colour, a 2048² metal-tile normal, the logo
stroke and a noise. As 1024 WebP at quality 85 they total 1.4 MB.

### Match-start intro podium

The level is `Maps/General/G_IntroPodium_01.umap`, played by the level sequences `LS_SquadStage_SquadIntro_*`. S12 adds
`_Reforge` versions of those and `LS_SquadStage_Intro_StepUp`.

The 14 S12 meshes:

| Mesh | Tris | UV sets | Materials |
| --- | ---: | ---: | --- |
| `SM_Intro_Platform_01_Wall_A` | 3,337 | 2 | platform, light bulb, THE FINALS labels |
| `SM_CielingAdd_IntroPodium_01` | 2,928 | 1 | `M_Props_01` |
| `SM_Intro_Platform_01_Fence_B` / `_A` | 1,312 / 1,192 | 2 | platform |
| `SM_TunnelSegment_IntroPodium_01` / `_B` | 862 / 318 | 1 | floor, wall, drainage, ceiling, panel, emissive |
| `SM_Intro_Platform_01_Floor_B` / `_A` | 666 / 628 | 2 | platform, labels |
| `SM_Intro_Platform_01_Stair_A` | 496 | 2 | platform |
| `SM_TunnelEnd_IntroPodium_01` | 400 | 1 | floor, drainage, emissive |
| `SM_ScreenIntroPodium_01` | 142 | 1 | wall, monitor screen |
| `SM_LobbyRoom_IntroPodium_01` | 106 | 1 | floor, wall: a 16.8 × 16.8 × 7 m room |
| `SM_DDGIBox_IntroPodium_01` | 24 | 1 | the box that bounds the DDGI probe volume |
| `SM_Glass_IntroPodium_01` | 2 | 2 | glass with team colours from a material parameter collection |

Materials:
- **Tileable props.** Most use `M_Props_01`, a tileable master. It packs two textures: CR (colour, roughness in alpha)
  and NOH (normal, occlusion, height). It translates directly to three's `MeshStandardMaterial`.
- **The platform** uses `M_4MaterialsByUVOffset`: which UV tile a face sits in picks one of 4 sub-materials. That needs
  a small custom shader.
- **The rest:** the glass, the monitor (a black media texture and an LED pixel mask) and the emissive strips are simple.

Textures: 17, mostly 1024² tileables and trims.
- As 1024 WebP at quality 85 they total 7.7 MB; at 512, 1.8 MB.
- In the game's BC-compressed GPU format they are about 24 MB.

The June version, for structure:
- 34 static-mesh actors, 91 lights (59 spot, 30 point, 2 rect) and 3 DDGI volumes;
- 27 Niagara effects and 72 widget components (the team-name screens);
- 31 level sequences and 8 cine cameras. The cameras are 30 mm at f/0.6-0.7, focused at 2.5 m, so the background is very
  blurred.
- 2 planar reflections.

**Open question for the user:** if the "arena intro" screenshot shows the city or arena itself, it is the per-map flyover
(`LS_<map>_ArenaOverview`, for example `LS_Monaco_01_ArenaOverview`). That is the whole-map tier, not the podium.

### Whole maps, for scale

Monaco in the June dump:
- 157 levels;
- about 32,000 static-mesh components and 4,229 destructible fractured meshes;
- about 4,000 lights and 92 DDGI packages.

The S12 paks have no HLOD proxies (Unreal's low-poly stand-ins for distant buildings), so there is no ready-made light
version.

Exporting a map as a web 3D scene would be a project of its own. Panoramas rendered at chosen spots are the realistic
version of "choose where to stand".

### Baked lighting: none to take

Evidence:
- The June podium `_BuiltData` is 349 bytes, an empty registry.
- The June menu `_BuiltData` is one reflection capture with `CubemapSize` 64. It is 262,485 bytes, which matches
  64² × 6 faces × 8 bytes (RGBA16F) × 4/3 for mips (262,144).
- The podium has 3 `DDGIVolume` actors, and Monaco has 92 DDGI packages.
- S12 has `_BuiltData` for the new Reforge sublevels. P1 confirms what they hold; reflection captures are expected.

Teaching point: DDGI is a grid of light probes that ray tracing updates every frame. THE FINALS needs it because its
buildings get destroyed, and destruction would invalidate any bake. For us, that means the bounce light we see in the
screenshots is not stored anywhere. We have to recompute it ourselves, offline in Blender with Cycles.

That matters for the podium. The menu is mostly self-lit, so it doesn't need it.

## 2. Through our pipeline

**What exists:**
1. The probe's `assets` mode writes `.mesh.json`. Static meshes already work, with every UV set and the vertex colours.
2. `scripts/shader-probe/build-meshes.py` turns that into a glb.
3. gltf-transform applies meshopt and WebP at most 1024 (`convert-meshes.mjs`).
4. The result is staged as an immutable Cloudflare Pages deployment. The stagers already write
   `Access-Control-Allow-Origin: *`.
5. The base URL is pinned in `deploy.yml`, like `ANIMATIONS_BASE`.

**What's missing:**
1. **Reading `.umap`.** The probe only loads `.uasset` packages (`AssetExport.cs`, line 23). It's a small change.
2. **A scene assembler.** It reads the actor transforms, including attach parents, blueprint construction-script
   templates and per-instance overrides.
   - It converts Unreal's frame (centimetres, Z up, left-handed) to glTF's (metres, Y up, right-handed).
   - It writes the scene to a glb, or to a `.blend` for rendering.
3. **Materials.**
   - Podium: `M_Props_01` to Blender or three (unpacking CR and NOH), the 4-materials-by-UV shader, the glass, the
     monitor and the emissive strips.
   - Menu: the 5 procedural emissive masters (screen, grid and lights, LED floor, title LED, smoke) as GLSL, by hand or
     through our HLSL decompile route.
4. **Lighting (podium only).** Re-light in Blender, where Cycles path tracing stands in for DDGI, against the
   screenshot. Then render the plate or panorama.
5. **Effects we skip or fake:** particles, volumetric fog, lens flares, planar reflections and the team-name screens.
   Bloom can be baked into a podium image. For the live menu, an emissive glow can be faked in the shader.

## 3. Four ways to show a scene

| | A: plate | B: panorama | C: 3D room | D: live stage |
| --- | --- | --- | --- | --- |
| **What it is** | One pre-rendered image behind the transparent canvas | A 360° image on three's `GroundedSkybox`: a sphere with a flat floor | Meshes, materials and a baked lightmap | A few emissive planes drawn live, in their own pass, before the character is composited |
| **When you orbit** | Must not orbit (see the turntable mode below) | The room turns; nothing past the floor has parallax | Full parallax | Full parallax; it is real geometry |
| **Download** | ~0.2-0.5 MB (estimate) | ~1-2 MB at 4096 × 2048, ~0.3-0.6 MB at 2048 (estimate) | podium 2.5-10 MB (textures measured at 1.8-7.7 MB, plus mesh and lightmap) | menu ~0.2-1.5 MB (logo, noise and floor textures; measured 1.4 MB at 1024) |
| **GPU memory** | none in WebGL; decoded images still count against the tab | 45 MB at 4096 with mips, 11 MB at 2048 | podium ~23 MB at 512², ~90 MB at 1024² uncompressed | a few MB |
| **Still view** | untouched | the skybox is a mesh, so it gets true motion vectors and reprojects | every mesh joins the per-frame state walk and velocity pass | untouched: drawn outside the accumulator |
| **Animation** | a video loop is possible but costly (see risks) | none | it would restart the still view every frame | free; the game's glitch and smoke can play |
| **Offline work** | rebuild and relight in Blender | rebuild and relight in Blender | the same, plus runtime materials and a lightmap bake | none in Blender; port 5 shaders |
| **Best for** | podium, as a first cut | podium | not worth it yet | menu |
| **Exposure to resale** | images only | images only | ships game meshes, which the mesh gate would have to cover | a few planes and the game's logo textures |

Teaching notes:
- **Why A needs a turntable.** A fixed image stays correct only while the camera does what the image's camera did.
  - Turning round the vertical axis, or sliding sideways, equals the character turning or walking on the plate's floor,
    so those are fine.
  - Changing height or pitch moves the horizon, and dollying changes the perspective of everything near the camera. In
    both cases the feet slide off the plate's floor.
  - Our `OrbitControls` allows all of it: pan is on, there are no pitch limits, and zoom is a dolly.
  - Example: the default camera is at (0, 1.0, 3.6) and looks at (0, 0.9, 0). Dollying 0.6 m closer moves the feet from
    about 425 px to about 509 px below the centre of a 1080p view, while the plate's floor stays put.
  - Zooming by field of view instead is a pure scale about the centre, which the plate can follow exactly.
  - The lights are fixed in the world, so orbiting also swings the key light and the floor shadow against the plate's
    painted lighting.
  - The game avoids all of this: its camera stays put and you turn the character. So in plate mode, fix the camera,
    let a drag turn `rig.root`, and zoom by narrowing the field of view while scaling the plate by the same factor.
  - Turning the root is a transform, which the still view reprojects; turning the lights would restart it every frame.
  - It changes how the viewer feels, so it is the user's call.
- **B's limit is angular resolution.**
  - Our viewer shows 1080 px across 35°, about 31 px per degree. A 4096-wide panorama has about 11 px per degree, so each
    of its texels covers about 2.7 screen pixels.
  - Far away that matches the game's own depth-of-field blur (about 0.12°), so a 4096 panorama with similar blur looks
    right there.
  - At the feet it doesn't. The floor there is in focus and should be sharp. Give the floor near the character its own
    sharper texture.
  - A variant fits the podium's box-shaped room: project the panorama onto a box of the room's size (16.8 × 16.8 × 7 m),
    so the walls and ceiling get real parallax too.
- **Why D suits the menu.** The menu's stage gives off its own light, so there is nothing to bake.
  - Its geometry is a handful of planes, so drawing them live costs almost nothing, and they can animate as in the game.
  - Drawing them outside the accumulator avoids its tone mapping, its history resets and its per-frame scene walk.
  - The work is porting 5 shaders, a good hands-on exercise.
- **C's real cost is not the triangles.** 12,400 triangles is nothing. The cost is:
  - porting the materials;
  - baking the lighting: the podium room meshes have only one UV set, so a lightmap needs new UVs;
  - keeping phones within memory;
  - the still view walking every scene object on every frame.

## 4. How it plugs into the viewer

- **Data.** `Backdrop` in `src/lib/stage-lighting.ts` gains a kind beside today's colour stops:
  - `image`: url, card image, `dark`, and the camera it was rendered from;
  - `panorama`: url, phone url, floor height and radius, and brightness per theme;
  - `stage`: a lazily imported module that builds the live stage.
  - The choices go into `BACKDROPS` and `backdropChoices(theme)`.
  - `LightingPanel.tsx`'s swatch radios show a thumbnail. The label names the season, for example "Season 12 menu".
- **Loading.** Scene code is a dynamic import, fetched only when someone picks a scene. Nothing on the default path
  changes.
- **Studio and Lobby.** The character keeps the theme's reviewed light rig, so item colours stay calibrated.
  - The menu pairs naturally with Lobby. `CharacterViewer.tsx` already describes Lobby as "THE FINALS main-menu inspect
    look".
  - **Lobby has no shadows today.** `shadows` is on only in Studio, and `FloorShadow` and `ContactShadows` live only in
    `StudioLights`. Over a scene, a Lobby character would float. Scene mode needs its own grounding in Lobby: drei's
    `ContactShadows` needs no shadow maps.
- **Tone mapping (teaching point).**
  - A CSS plate is shown exactly as encoded, in sRGB.
  - Anything drawn inside the still view (B, C) goes through its output pass. That applies the theme's curve: Neutral at
    exposure 1.0 in Studio, ACES at 1.05 in Lobby (`StableFrameAccumulator.ts`, around lines 506-519).
  - Setting `material.toneMapped = false` does not escape that pass, which tone-maps everything in its float target.
  - It does work on the direct path (`renderer.render`, line 311), which runs when the still view is off: no
    `EXT_color_buffer_float`, or `StablePreview` not mounted. So test B on both paths.
  - So a panorama needs its brightness set per theme, and Neutral and ACES still differ in contrast.
  - D draws outside that pass, so it chooses its own curve.
- **Panorama: `GroundedSkybox`, not `scene.background`.**
  - three r184 turns an equirectangular `scene.background` into a cube target with faces `image.height` wide. For
    4096 × 2048 that is about 100 MB on top of the source image.
  - `GroundedSkybox` is a `MeshBasicMaterial` on a sphere and samples the 2D image directly.
  - Pixels with no surface get zero motion and are averaged with the same pixel's history while the camera moves, which
    softens and shimmers a background. The skybox is a surface, so it is reprojected correctly instead.
- **D: the backdrop pass.**
  - Draw a separate `THREE.Scene` straight to the canvas just before the still view's output quad.
  - While a stage is set, switch that quad from `NoBlending` to premultiplied "over". Never switch it otherwise: that
    keeps the default pixel-identical.
  - The direct path needs the same treatment. Fable proposed this route; nobody has tested it.
- **Turntable mode** (the user chose it on 12 Nov; it is on only while a scene backdrop is set):
  - **Camera.** It stays at the scene's camera. `OrbitControls` rotate and pan are off. Zoom narrows the field of view;
    for a plate, the plate's CSS scale follows the same factor.
  - **Input.** A drag (or one finger) sets `rig.root.rotation.y`, and the arrow keys do the same for keyboard users.
  - **Lights stay fixed in the world, so fixed to the camera and backdrop.** As the character turns, its lighting
    changes the way it does in the game's menu, and it stays consistent with the backdrop's painted light.
  - **Nothing else moves `rig.root`.** Nothing in `src` writes its transform today (checked 12 Nov), so it stays the
    identity on the default path.
  - **Emote props and emote travel turn with the character.** Props attach to bones under the root (`EmoteProps.attach`
    and `socket`), and emote travel happens inside the skeleton.
  - **The still view keeps working.** A root rotation is a transform, so the still view reprojects it instead of
    restarting.
  - **Share card.** It places its cameras at world angles (front, 35°, 90°, back), so a turned character would show its
    side as the "front". Zero the turn while rendering the card, in the same wrapper that already applies the still pose
    (`PreviewBridge`'s `stillPose`, `RigAnimator.withStillPose`).
  - **Leaving scene mode** sets the rotation back to exactly 0 and restores orbit, so the default view is unchanged
    pixel for pixel.
  - **Not decided yet:** whether the angle survives a scene switch or a reload. Default: reset it to face the camera.
- **Camera for A.**
  - Render the plate from the viewer's default camera: (0, 1.0, 3.6) looking at (0, 0.9, 0), 35° tall.
  - three keeps the vertical field of view and shows more at the sides on wider windows. So fit the plate by height
    (`background-size: auto 100%`, centred), and render it at 21:9 or wider. `cover` would rescale it on wide windows and
    lift the floor off the feet.
- **Still view (`StableFrameState.ts`).**
  - A and D don't touch it, so switching to them restarts nothing.
  - B adds one mesh.
  - C adds every scene object to the per-frame `capture()` walk and to the velocity pass. Merge by material.
  - Animated materials inside it would restart the history every frame, so hair and lace grain would never average out.
- **The sun's shadow (Studio).**
  - `shadowFrustum()` fits the shadow camera round the character (±1.4 m plus the floor reach), so a scene receives the
    character's shadow only near the feet. That is what we want.
  - Scene meshes must not cast shadows: a ceiling would block the sun completely.
  - `ContactShadows` photographs the scene upward from y = 0, within 1.6 m. A scene floor at y = 0 would land in that
    picture and darken the whole contact shadow. Scene floors go below `FloorShadow`'s -2 mm (which also avoids
    z-fighting), or on a layer the contact shadow doesn't see. Test the skybox floor in that capture too.
  - Over an LED floor, a shadow that multiplies the image looks wrong: light sources don't take shadows. Over the
    menu, keep only a soft contact shadow.
- **Share card (`SharePreviewRender.ts`).**
  - Today it paints a radial gradient from the three colour stops. Then it renders 4 offscreen views, at a 30° field of
    view from about 4.25 m and level, over a transparent clear, and feathers them in.
  - Plate: paint a dedicated card plate, with its horizon aligned to the card's views (21 px per degree), instead of
    scaling the viewer's plate to cover. Load it through an `Image` with `crossOrigin`, and fall back to the gradient if
    `toBlob` throws.
  - B, C and D: keep the scene out of the 4 views (a layer), and paint one still behind them. Otherwise each view shows
    a different slice of the room.
- **Hosting.**
  - Scenes get their own immutable deployment, pinned like `ANIMATIONS_BASE`.
  - Keep old scenes forever, because saved looks and share links point at them.

## 5. Risks

- **The default look must stay pixel-identical.**
  - `DEFAULT_LIGHTING.backdrop` stays `"default"`.
  - Automated browsers never read the stored settings (`lighting-store.ts`, `AUTOMATED`).
  - The scene module is never imported unless a scene is chosen.
  - D's change to the output quad applies only while a stage is set.
  - Check it with the same main-vs-branch noise-floor comparison PR #40 used.
- **Catalogue icon comparisons** run on defaults and never see a scene. Don't judge item colours over a scene.
- **Phone memory.**
  - The outfit already loads 63-84 MB. Phones drop the WebGL context under memory pressure, which is what shows "3D view
    stopped".
  - B: 2048 on touch devices, and never `scene.background`.
  - C: textures at 512 or below, or KTX2, which our loader doesn't support yet.
  - Decoded plates and video frames count against the same process memory on iOS, even outside WebGL.
- **Video loops** (if A ever animates):
  - autoplay needs `muted playsinline`, and iOS Low Power Mode blocks it anyway;
  - loop seams hitch, and video colour range can pop against the still poster;
  - dark bloom gradients band in 8-bit 4:2:0 video, so 2-5 MB is optimistic;
  - honour `prefers-reduced-motion`.
  - D avoids all of this for the menu.
- **Holograms over a bright backdrop.** Additive items write alpha 0 and rely on the page adding their light. Over a
  bright part of a plate they will clip. Retest the hologram items over each scene.
- **Season drift.** The menu changes every season and for every event. Label each scene by season, and keep old ones.
- **Saved looks lose an unknown scene id (data loss).** PR #40 has a gap here.
  - `sanitizeLighting` turns an unknown backdrop id into `"default"`.
  - The next write (`merged` in `lighting-store.ts`) then stores `"default"` over the saved id.
  - For colours this is harmless. For scenes it silently drops the choice: an id from a retired season, or one a newer
    build wrote and an older tab then read.
  - The fix: keep the raw id stored and resolve it only at render time. This could also be fixed in PR #40 now.
- **Mixing builds.** Take everything from the S12 paks. Don't mix in June-dump packages.
- **Resale and the asset lockdown.** C ships environment meshes. A and B ship images. D ships a few planes and logo
  textures.

## 6. Proposed phases

| Step | Who | What | Size |
| --- | --- | --- | --- |
| P0 | the user | Screenshots: received 12 Nov; the intro is the tunnel. Turntable decided. Still open: the tunnel image's source and the routes. | — |
| P1 | agent | **Done 12 Nov (section 7).** The probe reads `.umap`. The S12 placements, cameras, sensor and `_BuiltData` contents are known. Both blockouts match the screenshots; the tunnel camera is solved. The `.blend` files and placements stay local. | done, about half a day |
| P2-menu | user or agent | Option D: port the 5 emissive shaders, build the backdrop pass, ground the character in Lobby, add the share-card still and tests. | 2-4 days |
| P2-tunnel | user or agent | Option A. Either solve the screenshot's camera and use a clean in-game frame as the plate, or match materials and lighting in Blender against it and render the plate from inside the tunnel. Optional: the floor reflection layer. | 1-2 days (relight) or about half a day (camera solve), plus about 1 day in the viewer |
| P3 | agent | Turntable mode for scenes, hosting, the release, and the visual-diff check that the default is unchanged. | 1-2 days |
| P4 | — | Option C or whole maps: a separate proposal. | — |

**Doing it yourself versus handing it over** (the user is learning rendering):
- **Most worth doing hands-on:**
  - Porting the menu shaders (D). That is reading a material graph and turning it into GLSL: UVs, masks, emissive
    and time.
  - The podium relight against a screenshot. It builds lighting intuition: key, fill, bounce and exposure.
  - The `GroundedSkybox` hookup. It teaches projection: how a sphere of directions becomes a floor.
- **Worth handing over:** P1's probe and assembler plumbing, and P3's hosting.

**Decisions for the user** (updated after the screenshots):
1. Routes: D (live stage) for the menu and A (plate) for the tunnel, as recommended, or something else?
2. ~~Turntable mode, or orbit limited to about ±30°?~~ **Decided 12 Nov: turntable** ("Yes, turntable"). See section 4.
3. Where is the tunnel image from? If it is an in-game frame, can you capture a wider, full-resolution one with no
   character? Section 7 shows what using it fixes: the camera, and a character spot at the tunnel mouth.
4. ~~Own assembler or a community umap importer?~~ **Settled by P1:** our own assembler works from the probe's JSON, so
   nothing was downloaded.

## 7. P1 results (12 Nov, evening)

The user said "Yes, start P1". The probe gained a `level` mode that reads `.umap` packages, and it read the S12 levels
from the installed paks: 6 levels, 4 blueprints and 5 `_BuiltData` packages, listed with sizes and hashes in
`evidence/s12-levels-p1-v1.json`. Then:
- `tools/assemble_scene.py` turns them into placements (every mesh, light, camera and character spot, in Blender's
  frame);
- `tools/blender_blockout.py` builds the scene in Blender with flat stand-in materials and renders it from the game's
  camera.

**Both blockouts reproduce the user's screenshots.** The comparison sheet is in the shared notes folder, not in the repo,
because it contains game frames. Nothing in the app changed and nothing was downloaded.

**How a level stores a placement** (the model the assembler follows):
- A component's `RelativeLocation`, `RelativeRotation` and `RelativeScale3D` are relative to its `AttachParent`.
- An instance stores only what differs from its template. A blueprint's component template, or the engine's class
  default, supplies the rest.
  - `FrontendCharacter_0` stores no root at all, so the assembler falls back to its capsule.
  - Missing everywhere means the engine default.
- Unreal is left-handed. A placement converts as F·W·F with F = diag(1, −1, 1), as section 2 expects.

### Menu (`MainMenu_S12_None` with `CharacterSelection_*` and `MainMenuReforge`)

**The stage wall is a cyclorama.** `SM_FrontendStage_Wall_01` at ×2 is a half-cylinder of 16 m radius, centred 1.38 m in
front of the stage origin. It wraps the whole view.

**The big A sits behind that wall.**
- The title-LED plane is at 17.9 m, the far side of the wall.
- In the game the wall's screen material lets it show through. The blockout needed the wall at 30% opacity to match.
- So P2 must port that see-through, or the A disappears.

**The other pieces**, by distance from the stage origin:

| Piece | Where |
| --- | --- |
| Fog plane | 3.5 m |
| LED floor half-circle | centred at 4.75 m, radius 7.55 m |
| Smoke plane | 16.3 m |
| Scaffold pillars | 17.25 m, at ±9.65 and ±10.54 m to the sides |
| Light-flare plane | 18.1 m |
| Grid plane | 20.2 m |

**The camera is `CameraLocationPlay_0`: 38 mm at f/4, pitched 4.5° up.**
- It sits at (0.65, 0, 0.79) m plus an offset per archetype: Light +60/+15 cm, Medium +55/+25 cm, Heavy +40/+35 cm
  (forward/up).
- For Medium that is about (1.20, 0, 1.04) m.
- The character, `FrontendCharacter_0`, stands at (4.21, 0, 0), 3.0 m from the camera. Squad members stand at 5-6 m, 1-2 m
  to each side.

**The sensor is 36 mm wide ("16:9 DSLR"), so the view is 29.8° tall.**
- The camera's saved `FieldOfView` (34.72°) is what a 23.76 mm sensor gives at 38 mm.
- The screenshot matches 36 mm instead: the A's outline, the inner triangle, the slash band and the floor line all fit.
- So the game sets the filmback at runtime, and the screenshot wins.
- For scene mode, the viewer's camera should use: 3.0 m from the character, 1.04 m high, 4.5° up, 30° tall. Ours today is
  35°.

**The game lights the character itself:** 25 lights in `CharacterSelection_Lighting`.
- A key: 45 lm at 5600 K.
- Cool rims: 60-70 lm, `A7CBFF`.
- Weak fills.
- Two strong blue side spots: 300-350 lm, `007BFF`.
- RGB projectors under the floor.

That blue side light is a large part of the menu look on the character. Lobby and Studio have none of it, so P2 needs a
scene light preset.

### Tunnel (`G_IntroPodium_01`)

**Layout**, along the tunnel (x forward):

| Piece | Where |
| --- | --- |
| Lobby room | x −16.3 to 6.4 m; 16.8 m wide, 7 m tall |
| Tunnel | from the mouth at 6.4 m to the end wall at 26.4 m; 4.2 m wide |
| Screens, `SM_ScreenIntroPodium_01` | six panels of 4 × 2.95 m, on both sides from 8.0 to 20.25 m |
| Light strips (the emissive section of `SM_TunnelEnd`) | 21.7-24.1 m |
| End wall, `SM_Glass_IntroPodium_01` | a 4.2 × 4 m glass pane at 26.38 m, carrying the logo |
| Ceiling ducts, `SM_CielingAdd` | about 16.8 m |

**This corrects section 0.**
- The ribbed blue panels are the screens. The glass is the logo wall at the end.
- The faint A marks on the side panels are reflections of the end logo and the strips: the game's ray-traced
  reflections.
- A plate gets these reflections for free. A live render would need planar or screen-space reflections.

**The camera was solved from the screenshot** (the fSpy idea, by hand):
- The nearest screen's top and bottom edges land at 505 and 1325 px. The screen is a known 2.95 m tall and starts
  0.12 m up, so the camera is 1.97 m high.
- The screen's two ends are at known distances (8.0 and 12.0 m) and land at 285 and 460 px. From the ratio, the camera is
  at x ≈ 0: in the lobby room, 6.4 m before the mouth, centred (y 0.07 m) and level.
- The view is about 40° tall. That is 27.8 mm if the original frame was 16:9 on a 36 mm sensor.
- Rendered from there, the blockout overlays the screenshot within a few pixels: the screens, strips, end wall, mouth frame
  and ducts.

**What the static level does not show:**
- The shot's camera is a sequence camera. None of the 12 placed cameras is there; the static ones look the other way, at
  the squad stage (x 0-4 m).
- The sequence hides a 1 m plane, `StaticMeshActor_87`, 0.2 m in front of that camera. The blockout skips it.
- Two more pieces are skipped:
  - the end-transition box (`M_TunnelRun_End_Effect`, 5.65 m long);
  - an emissive card in front of the glass.

**What this means for the plate (P2-tunnel):**
- If the in-game frame itself is the plate (decision 3), the camera is fixed at that solved point.
- With a 40° view from 1.97 m, the character's feet show only if the character stands at least 5.4 m away, at the tunnel
  mouth. Seen from there, the character fills about 45% of the frame height.
- A Blender relight can instead put the camera wherever framing wants: for example 3.6 m from a spot just inside the
  mouth, at the viewer's own height.

### Baked lighting, confirmed on S12

There are no lightmaps anywhere.
- The `_BuiltData` packages are reflection captures only. Each capture is 262,144 bytes:

  | Level | Captures |
  | --- | --- |
  | `MainMenuReforge` | 1 |
  | `CharacterSelection_Lighting` | 2 |
  | `MainMenu_BackstageEnvironment_Reforge` | 7 |

- The podium's and the character-selection environment's `_BuiltData` are empty: 372 and 396 bytes.

### Effect on the phases

| Step | Status |
| --- | --- |
| P1 | Done. |
| P2-menu | Placements, camera, sensor and character spot are known. What is left is the shader ports (including the wall's see-through), the backdrop pass and a scene light preset. |
| P2-tunnel | The camera solve, the half-day route, is done. What is left depends on decision 3. |

## 8. P2 (15 Nov): the scenes in the viewer

The user handed P2 over ("Hand it over"). It is built on branch `claude/scene-backdrops-p2-2026-11-15`, stacked on PR #40.
Routes as recommended: D for the menu (a live stage) and A for the tunnel (a plate, relit in Blender).

**Scene mode** (`src/lib/scenes.ts`, `src/components/SceneMode.tsx`):
- **Storage.** A look's backdrop keeps a scene id in `backdrop.scene`; its colour stops stay as the fallback.
  - The fallback shows while the scene loads, if it fails, on the share card, and in an older build.
  - An unknown but well-formed id is kept, not dropped. An older build's write merges it back (`mergedLook`), so a
    newer season's choice survives.
  - That replaces the data-loss gap section 5 found in PR #40's first version.
- **Turntable.** While a scene is shown, the camera stays at the scene's camera (the viewer's default camera, for both
  scenes).
  - A drag or the arrow keys turn `rig.root`; scroll or pinch zooms by field of view.
  - The sway springs feel the turn, as they feel an orbit.
  - Leaving the scene puts the turn back to 0, the camera back where it was, and orbit back on (checked in the browser).
  - The share card and the 3D export run with the character facing forward (`withUpright`, `holdUpright`).
- **The menu look.** "Season 12 menu" is a third ready-made look: the Lobby lights in front of the stage.
- **Default unchanged.**
  - No scene code is loaded unless a scene is picked: both the stage and the menu are lazy chunks.
  - Automated browsers never read stored looks.
  - The new tests (`tests/scenes.test.ts`) check that the default look gains no `scene` key.

**The menu stage** (`src/scenes/s12-menu.tsx`, option D):
- **Its own canvas, behind the viewer's transparent one.** This replaces section 4's plan to change the still view's
  output quad.
  - The browser composites the character over the stage exactly as it does over the CSS gradient.
  - So the still-view accumulator and the default path are untouched.
  - An animated stage never restarts the still view.
  - The cost is a second WebGL context while the stage shows.
- **The pieces are the level's**, placed from P1's numbers, and drawn as code: no game meshes ship.
  - The cyclorama wall, the 24 m "A" plane, the light grid, the smoke, the LED floor half-circle, the haze and the floor.
  - The only game artwork is the A's stroke mask: 14.7 KB as a greyscale WebP.
- **Patterns are written from the materials' parameter values, not decompiled.**
  - The A: `LEDTiling` 360, colour (0, 0.865, 1), 150 scan bands, a glitch with a colour split.
  - The lights: 18.7 across 22 m, colour (0.646, 0.767, 1).
  - The floor LED's rim at the vignette's 0.76, and so on.
- **They were tuned by measuring colours against the user's screenshot:**

  | Region | Stage | Screenshot |
  | --- | --- | --- |
  | A fill | (52, 172, 193) | (26, 169, 187) |
  | Outside the A | (17, 92, 135) | (0, 81, 126) |
  | Haze in the inner triangle | (85, 135, 174) | (89, 137, 173) |
  | Floor | (3, 31, 36) | (4, 41, 54) |

  - The screenshot's dot pitches (7.0 px LEDs, 122 px lights) are both 1.2× the material sizes seen from P1's camera.
  - So that screenshot was taken zoomed in to about 25° tall, not the 30° section 7 assumed.
- **Teaching point: light adds linearly, sRGB doesn't.**
  - three converts each material's output to sRGB inside its shader when drawing straight to the screen.
  - So overlapping glowing layers were summed in sRGB and clipped. The A, the wall and the haze, each right alone, summed
    to (84, 255, 255).
  - The stage now draws into a linear half-float target and converts once (`EffectComposer` → `OutputPass`).
- **The floor's reflection is each glowing layer drawn again, mirrored below the floor line.** That is exactly what a
  mirror shows.
  - The copy is softened: dots averaged, lights widened.
  - It is weighted like a glossy floor (Fresnel): faint looking down, strong at grazing angles.
  - It needs no extra render pass. drei's `MeshReflectorMaterial` was tried first: it is a lit material, and it went
    white here.

**The tunnel plate** (`tools/blender_relight_tunnel.py`, `tools/tonemap_plate.py`, option A):
- **Materials** come from the material instances' values.
  - The `M_Props_01` tiles, concrete and metal: colour multiply, desaturation, roughness × the texture's alpha, tiling.
  - The LED screens and the end glass are lit in the team colour (0.008, 0, 0.391): blue team, which reads indigo on
    screen.
  - The light strips: (0.598, 0.642, 1) × 10.
  - The level's 16 tunnel lights.
  - The end glass's own logo texture was not exported. A stacked logo was composed from `T_THEFINALS_01_Icon_A` and
    the lettering of `T_THEFINALS_01_Logo_A`.
- **Units: 1 lumen = 1 Blender watt; an Unreal emissive value = a Blender emission strength.**
  - A screen's emission integrated over its area comes to about the 150 lm of the rect light the level adds for it,
    which says the mapping is consistent.
  - One exposure, −1.66 EV, was fitted against the user's screenshot, rendered from the camera P1 solved.
- **Tone curve.** Blender's AgX turned the team-blue screens pale cyan.
  - Unreal's ACES curve keeps saturated blue and shifts it violet, which is the game's indigo.
  - So the render leaves Blender as linear light and gets exposure, a bloom and the ACES fit outside Blender.
- **Two bugs found and fixed on the way:**
  - **Slot order.** Blender's glTF importer orders material slots by first use and merges repeated materials. Assigning
    materials by slot number put the drainage material on the walkway. Both Blender tools now match slots by the
    material name the mesh builder writes.
    - P1's blockout colours were partly misassigned by this.
    - Its camera solve used geometry only, so it stands.
  - **Normal convention.** Unreal stores normal maps DirectX style, with green flipped. Read as such, the floor tiles
    each tilt a little and reflect their own offset copy of the logo, as in the game.
- **The plate's camera is the viewer's.**
  - The character stands in the walkway between the first screens (tunnel x 9.5 m).
  - The camera is 3.6 m back, 1.0 m up, aimed at 0.9 m, 35° tall.
  - The plate is 3840 × 1620, wide enough for 21:9.
  - So the plate's floor is the viewer's floor, and the turntable keeps the feet on it.
- **Why not the screenshot itself as the plate:**
  - its camera stands 1.97 m high and 6.4 m before the mouth;
  - a character would have to stand at the mouth to keep its feet in frame;
  - it is square, and it has no room at the sides.
- **Plate v1:**
  - 256 Cycles samples on the GPU (OptiX);
  - tone-mapped at −1.66 EV with bloom 0.25;
  - shipped as `s12-tunnel/plate-v1.webp`, 3840 × 1620 at WebP quality 85 (744 KiB).
  - Full resolution is kept because zoom enlarges the plate up to 2.9× (35° → 12°). 2560 wide would be 390 KiB.

**Checked in the browser (agent checks, dev server, 15 Nov):**
- **Tunnel, desktop and full screen.**
  - The feet stand on the walkway at the expected 89% of the viewer's height. That is where the floor 3.6 m ahead of a
    1 m camera falls in a 35° view.
  - Zooming to 27.5° set the plate to 128.7%, which matches tan 17.5° / tan 13.77°. The feet moved by the same factor.
  - A 157 px drag turned the character about 90° with the plate fixed. Zooming out stopped at 35°.
- **Phone size (375 × 812).**
  - Both scenes render.
  - The plate fits by height, with the feet on the walkway.
  - The chosen scene survived a reload.
  - Touch drag and pinch were not exercised with real touch input.
- **Menu stage, desktop.**
  - Colours as in the table above.
  - Leaving the scene restores the camera, the orbit and a turn of 0.

**21 Nov: rebased onto main.** Main now carries #40 merged, #46 (drawer, full-window viewer, PNG screenshots), #47,
#48 and #55.
- One conflict: the viewer's animator line. The fix kept main's Chinals clip set and the scene lookup.
- Rechecked on the dev server with today's hosts:
  - **Tunnel:** with the drawer open and closed, the viewer, canvas and plate share one rectangle (#46 adds no camera
    view offset), and the feet stay on the walkway.
  - **Turntable:** turns with the camera held.
  - **Menu stage:** renders under the "Season 12 menu" look.
  - **Leaving:** a switch to Studio restores the orbit camera and removes the stage canvas.
- **#46's PNG screenshot** paints the look's colours behind the character, so with a scene it saves the fallback
  colours. Its text now says so instead of "As on screen".
- Typecheck and build pass. The tests: 906 pass and 8 fail, all on GLB fixtures absent from the worktree.

**Not done yet:**
- **Hosting.** The scene files are game artwork and live in the ignored `public/scenes/` for development. Production
  needs a scenes deployment pinned like `ANIMATIONS_BASE`, and the upload needs the user's yes.
  - Without it, a production build falls back to the scene's colours: the plate does not paint, and the stage's
    texture fails into its error boundary.
- **The share card and PNG screenshots** paint the scene's fallback colours, not the scene. Painting a scene still into
  both is one follow-up.
  - For the plate, that needs CORS on the scenes host.
  - For the stage, it needs a capture of its second canvas.
- **The tunnel has no ready-made look.** The character keeps the user's lights, so with Studio it reads warmer than the
  indigo tunnel. A tunnel look (blue rims) would be like "Season 12 menu".
- **Not yet checked:**
  - the second WebGL context's memory on a real phone;
  - holograms over each scene (additive items clip over bright backdrops);
  - the default look measured pixel for pixel. The argument is static: with no scene, nothing new mounts.
  - a human check of the feel.

## Review

Fable (claude-fable-5-2, high effort, thread `b6206dfe`, about $2.27) reviewed the first draft against copies of the
viewer files. Its corrections, each checked against the code before adoption:
- Lobby has no shadows.
- Background pixels are averaged in place, not reset; `GroundedSkybox` reprojects properly. Checked in the resolve
  shader, lines 199-230.
- `scene.background` builds a cube from the panorama. Checked in r184: `new WebGLCubeRenderTarget( image.height )`.
- The plate needs the turntable rules above.
- The menu suits a live backdrop pass better than a Blender render (option D, Fable's suggestion).
- The sensor size is unverified.
- The share card's 30° framing.
- The triangle count in the first short answer was wrong.

Checked since:
- rotating `rig.root` does not conflict with emote root motion or props; see "Turntable mode".

Not yet verified:
- how the skybox floor behaves inside the contact-shadow capture (moot unless B returns);
- D's output-quad change, which nobody has tested.

## Evidence and how to reproduce

- `evidence/s12-scene-assets-v1.json`: every S12 mesh (vertices, triangles, UV sets, size, materials), material instance
  (parent, texture and scalar parameters) and texture (format, size, mips, GPU bytes). Counts only.
- `evidence/s12-probe-request-v1.json`: the 95 packages probed.
- `evidence/june-umap-summaries.txt`: June composition of the podium and menu levels, and the `_BuiltData` sizes.
- `tools/umap_summary.py`: summarises an FModel umap JSON: export types, static meshes, override materials and lights.
  Run it with `python -I -X utf8 tools/umap_summary.py <umap.json> [top-N]`.
- The probe runs (Git Bash, repo root of the main checkout):
  `dotnet scripts/generated/shader-probe/native-nails-source-v1/probe-bin/ShaderProbe.dll assets|textures
  "<Steam>/The Finals/Discovery/Content/Paks" <S12 usmap e5b29e28> <oodle dll> <empty output dir> <request.json>`.
  - The texture WebP sizes were measured by decoding mip 0 (or the 1024 mip) with Pillow's BCn decoder and re-encoding.
  - The S12 package lists come from `scripts/generated/shader-probe/catalog-refresh-20261028/inventory-01/packages.json`.
    It lists `.uasset` only, so no umaps.
- **P1 (12 Nov).** Rebuild the probe from this branch first, then run these in Git Bash. `$G` is a local, ignored output
  folder; `<paks> <usmap> <oodle>` are as above.
  1. Read the levels. The probe's `inventory` mode now also writes `levels.json`.

     `dotnet $G/probe-bin/ShaderProbe.dll level <paks> <usmap> <oodle> $G/levels-v3 <request.json>`

     The request lists the 15 packages in `evidence/s12-levels-p1-v1.json`. A second run over the blueprint templates
     goes to `$G/templates-v1`.
  2. Assemble the placements.

     `python -I -X utf8 tools/assemble_scene.py $G/menu-placement-v2.json MainMenu_S12_None
     CharacterSelection_Environment_Reforge CharacterSelection_Lighting MainMenuReforge --dirs $G/levels-v3
     $G/templates-v1`

     The tunnel uses the same command with `G_IntroPodium_01`.
  3. Build the meshes. The probe's `assets` mode reads the placed meshes, then
     `scripts/shader-probe/build-meshes.py` builds the glbs (36 meshes, about 28.5k triangles).
  4. Render the blockouts.

     `blender -b --factory-startup -P tools/blender_blockout.py -- PLACEMENT MESHES GLBS TEXTURES OUT_PREFIX CONFIG`

     The configs used:
     - menu: camera `CameraLocationPlay_0` with `offset_cm` [55, 0, 25], sensors 36 and 23.76;
     - tunnel: camera `pos` (0, 0.07, 1.97), `target` (26.38, 0.07, 1.97), 27.8 mm on a 20.25 mm sensor (a 16:9
       36 mm frame cropped square), `skip_actors` `StaticMeshActor_87`.
  5. Write the evidence.

     `python -I -X utf8 tools/p1_evidence.py evidence/s12-levels-p1-v1.json $G/levels-v3 <menu placement> <tunnel
     placement>`
- **P2 tunnel plate (15 Nov).** The inputs are P1's tunnel placement, meshes, glbs and decoded textures. The textures
  also need `stacked-logo.png`, composed from `T_THEFINALS_01_Icon_A` and the lettering of `T_THEFINALS_01_Logo_A`.
  1. Render linear light.

     `blender -b --factory-startup -P tools/blender_relight_tunnel.py -- PLACEMENT MESHES_DIR GLB_DIR TEX_DIR
     $G/relight/plate-v1 CONFIG.json`

     The config: camera `pos` (5.9, 0.085, 1.0), `target` (9.5, 0.085, 0.9), `vfov` 35; `resolution` [3840, 1620];
     `samples` 256; `linear` true; `logo_strength` 8; `logo_scale` 1.4; `floor_normal` 0.4.
  2. Tone-map.

     `python -I tools/tonemap_plate.py $G/relight/plate-v1.npy $G/relight/plate-v1.png --exposure -1.66 --bloom 0.25`

     `--fit REF.png` instead of `--exposure` finds the exposure that matches a reference's mean. That was how −1.66
     was found, from the screenshot's camera.
  3. Encode as WebP quality 85, method 6, into `public/scenes/s12-tunnel/plate-v1.webp` (ignored by git).
- **P2 menu stage.** The only file is the A's stroke mask, `public/scenes/s12-menu/icon-stroke-a.webp`. It is the
  decoded `T_THEFINALS_01_IconStroke_A` converted to greyscale (Pillow `convert("L")`), WebP quality 92, method 6.
