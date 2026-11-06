# Showcase animation prototype (5 Nov 2026)

The 3D character plays THE FINALS' own front-end animations: the outfit-screen idle loops, the outfit-screen slot
reactions ("check headwear", "check shoes"…) and every Season 12 emote, picked from the game's own icons. Every
equipped cosmetic follows the motion.
This is a reviewable prototype on branch `claude/agitated-northcutt-fbe7d2` (worktree
`.claude/worktrees/agitated-northcutt-fbe7d2`, from `main` = 11b4185). Nothing is committed, pushed or deployed.

Decisions taken with the user: end-to-end build with teaching (gate answered 5 Nov); after seeing the prototype the
user chose **"Idle by default"** (5 Nov, later the same evening). The still pose stays one click away and is
remembered per browser (below). Then **"Fix moving grain first"** and **"Emote picker + icons"** (all emotes, icons,
prop emotes played body-only and marked; props, effects and faces are later phases). On 6 Nov: **"Props next"**, and
the user flagged the **pinching at joints** (a candy-wrapper wrist in Fancy a Cuppa), fixed first by porting the
game's own deformation rig (below).

## How it works

1. **Export (offline, read-only).** `scripts/anim-export/` is a small C# tool on the same CUE4Parse build the shader
   probe uses (no package restore). It mounts the installed game's IoStore containers with the Season 12 community
   mapping and the FModel archive key (never printed), decodes each `AnimSequence` (ACL-compressed; decoded with the
   `CUE4Parse-Natives.dll` FModel already extracted locally) and writes UE bone-local tracks, one sample per authored
   frame, plus the `_3P_MasterSkeleton` and `SK_Body_M` reference poses. Nothing touches the running game.
2. **Convert.** `scripts/anim-export/convert-clips.mjs` turns those tracks into the app body's own bone frames and
   writes compact clips (`public/animations/set-N/*.json`, ignored by git like `public/models/`).
   * The body GLB came through Blender's UEFormat importer, which keeps every bone's axes and only mirrors Y
     (left- to right-handed) and scales cm → m. So the per-bone conversion is exact and needs no fitting:
     position (x, y, z) → (x, −y, z)/100, quaternion (x, y, z, w) → (−x, y, −z, w); the `root` bone adds the
     armature's −90° X turn (Z-up → Y-up).
   * The converter **proves** this instead of assuming it: for every joint it computes
     `P = glbRestLocal · conv(ueRestLocal)⁻¹`. Result: identity for all 91 non-root joints (max element error
     1.45e-5), a pure rotation for `root`. If a future body broke the relation the converter refuses.
   * `SK_Body_M`'s reference pose equals the master skeleton's (max 0.000 cm), so the clips' translations apply
     as authored (UE's `AnimationScaled` retarget ratio is exactly 1 here).
   * Keys that linear/slerp interpolation reproduces within 0.1° / 0.1 mm are dropped; quaternions are int16.
3. **Play.** `src/rig/RigAnimator.ts` builds `THREE.AnimationClip`s on demand and plays them with an
   `AnimationMixer` bound to the body scene (track names resolve to the driver bones, never to a cosmetic glTF's
   own unused bone copies). Idles loop; reactions/emotes play once, cross-fade (0.3 s) and return to the idle, or to
   the still pose when no idle runs. Stopping fades out and deactivates every action, and three restores each
   bone's pre-play value, so the static pose afterwards is exactly the one before.
   * Cosmetics follow for free: skinned items are bound to the same driver bones; source statics are one-bone
     skinned meshes; legacy origin statics sit on bones; source garment-only bones are attached to the driver by
     `rebindSourceSkeleton`. Two legacy-path exceptions are handled **only while animating**
     (`CharacterRig.setAnimationPins`) and restored bit-exactly afterwards:
     legacy body-authored statics under the scene root (e.g. the cowboy hat) are pinned to a bone at their bind
     offset; and a legacy skinned item's own bones (jiggle chains, a legacy head's `FACIAL_*` bones) — which the
     legacy rebind leaves on the cosmetic's unused rest copy — hang from the driver bone their rest parent is named
     after. Without the second, legacy tails/ponytails/faces would tear away from a moving body. Unequip during
     playback still removes and disposes them.
   * Still-view accumulator: while the pose moves every frame it runs in **motion mode** (below); pausing freezes
     the pose and the usual 32-sample accumulation converges again. `?temporal=0` is unchanged (no accumulator).
   * Still renders mid-animation: the animator remembers every bone's static pose as playback starts (and for bones
     an outfit change adds while it plays). The **share card** draws its four views inside
     `RigAnimator.withStillPose` (one synchronous pass, animated pose put back after), so links keep the reviewed
     still-pose card. The developer **Export 3D** holds the still pose for its multi-frame bake (`holdStill`) and
     releases it after; release writes the held animated pose back because three's mixer only writes a bone when its
     blended value changes (a test caught a paused clip staying in the still pose without that).
4. **UI.** The outfit-screen idle starts by itself once the first outfit has loaded. It stays still instead when
   the viewer last chose the still pose (`localStorage` key `finals-outfit.motion` = `still`, guarded: a blocked or
   empty store just means the default), when the system asks for reduced motion, in automated browsers
   (`navigator.webdriver`: the visual-diff, probe and audit harnesses compare still-pose captures) and with
   `?anim=0`. An explicit `?anim=<clip>` always wins. Under the Studio/Lobby toggle: **Animated** (click to return
   to the still pose, remembered; **Animate** starts the idle again and forgets that choice), **Pause/Resume**, the **Emotes** picker (below), and
   while playing a **Sway · approx.** toggle (below). The controls only appear when `animations/manifest.json`
   exists, so a deployment without clips is unchanged. Capture switches: `?anim=<clip id>` starts a clip after the
   outfit loads; `&animTime=<s>` holds it there, paused; `?anim=0` opens still; `?sway=0` starts with sway off. `window.__rigAnim`
   (play/seek/stop/sway/state) drives scripted captures (`scripts/anim-export/capture.mjs`).

## Stretch: Sway (approximate secondary motion)

A survey of the 3,237 local cosmetic GLBs found **354 with garment-owned "jiggle" bones** (`*_jj`, `*_JJ`, `*_jjr`,
`*_JJRoot`): tails (91), skirt panels (~36 each side), ponytails (29), braids, hat tips, ears, cables, charms. In the
game they are physics bodies (see "What the game does" below); this is a stand-in for that solver.
`src/rig/SpringBones.ts` is a **generic VRM-style spring bone**, labelled "approx." in the UI: per bone a tail point
with inertia (drag), a pull back to the animated rest direction (stiffness), gravity, fixed length; three profiles
(default, stiff skirts, heavy hair), fixed 60 Hz steps; coarse collision against a head sphere and spine/thigh
capsules, applied only to shapes a chain starts outside of (so nothing moves at rest). Off while paused (the still
view converges); reset to the authored rotation before any unpinning.

**Turning.** Orbiting the camera left/right counts as turning the character: `SpringBones.turn` carries every tail
point (and its previous position, so velocities carry over) around the character's vertical axis by the camera's
azimuth change, which is what world-space physics sees when the character itself turns, as it does in the game.
Jumps over 0.6 rad in one frame (camera resets) are ignored; flicks are capped at 0.15 rad/frame. Measured with a
real 300 px mouse drag (`scripts/anim-export/turn-check.mjs`, tip distance in the anchor bone's frame): tiger-tail tip
1.5 cm of idle sway, **33 cm** during the turn, 4 cm 1.5 s later; Santa-hat tip 0.1, 4, 2 cm; with sway off all
three are exactly 0. `captures/turn/after-drag.png` shows the tail out to the side after a fast turn.

### What the game does (read from the Season 12 files, 5 Nov)

* The outfit-screen character (`BP_FrontendCharacter`) has `ABP_FrontEndMaster` (no physics nodes) and, on its merged
  mesh, `MergedMeshPhysicsAnimBlueprint = MABP_CharacterMeshMerge_Physics`: two `RigidBody` nodes using the mesh's
  physics asset, one simulating in **WorldSpace** and one in BaseBoneSpace (root, WorldAlpha 0), picked by a bool.
  World-space simulation is why dangling parts swing when the character turns.
* Per item, the dangling parts are bodies in that item's own PhysicsAsset (102 `_M_PhysicsAsset`s): simulated bodies
  on the `*_jj` bones, kinematic body bones as colliders (head, neck, spine_03, pelvis, chest volume joints), joints
  with swing cones and locked twist (e.g. hip chain swing 40/10 degrees, twist locked; braids with cone damping 50;
  the Cute Tech helmet ponytail with a swing position drive). Long coats/skirts have body-only physics assets for
  cloth collision. Other chains use Control Rig jiggle (`RigJiggle_CtrlRig`, lumbar jiggle, `BP_EarringJiggle`).
* Reading those physics assets per item (simulated bones, cone limits, collider capsules) would replace the generic
  profiles here; not done yet.

Not covered: **long coats, capes, dusters** — the long coat has *no* garment bones (its skirt is weighted to the
thighs); the game simulates such sections as cloth, so they stay leg-driven here. No arm/shoulder colliders: a long
ponytail can drape over the shoulder through the shirt in Disco.

## Verification (5 Nov 2026)

Captures (full size, 1382×1540, reviewed by eye): `captures/` (ignored by git, renders of game assets).
`<outfit>/<clip>@<seconds>-<front|side>.png` plus `static-*` baselines; `rigid/`, `sway/`, `sway-v2/`, `sway-v3/`
keep the jiggle-outfit iterations (v1 default params, v2 hair profile, v3 colliders = current).

| Outfit | Clips | Result by eye |
| --- | --- | --- |
| default (Face 01, tee, jeans, canvas shoes) | idle, wave, disco, take-a-bow, kung-fu | body, face, shirt, jeans, shoes follow; fingers animate; feet stay planted |
| long coat (leather black) | take-a-bow, kung-fu, disco | sleeves, collar and the coat's real under-layer follow; skirt bends with the thighs (no cloth sim) |
| big helmet (cow mascot head) | react-head, face-palm, take-a-bow | rides the head exactly |
| hat + hair (cowboy hat, high ponytail) | react-head, disco, take-a-bow | hat and under-hat hair follow the head |
| gloves (Sentinel leather) | wave, clap, react-hands | every finger joint followed |
| full-body suit (deep sea suit) | kung-fu, take-a-bow, flex | deforms with the body; **its trousers render purple in the still pose too** (pre-existing material issue with local assets, not animation) |
| jiggle (tiger tail, Santa hat, ponytail), both paths | take-a-bow, disco, shadow-boxing | rigid → tail sticks out; sway → tail hangs and swings, ponytail hangs in the bow |

Functional checks (browser, scripted): emote returns to idle; Stop restores **all bones bit-exactly** (788 bones on
the reconstructed path; 501 bones+statics on the legacy path, two play/stop cycles with pins and springs); accumulator
inactive while playing, 32/32 samples within 1.5 s of pausing and after Stop; `?temporal=0` plays; legacy hat pin
restores to (0, 1.794, −0.001); unequipping the tail mid-playback removes its pinned branch and shrinks the springs
from 8 to 3. Mixer cost ≈ 0.009 ms/frame; frame time stayed at vsync on desktop. Phone: layout checked at 375×812;
real-phone frame rate **not measured** (animating renders the scene every frame, like orbiting; the converged still
view renders only a quad).

**Idle by default (later, 5 Nov).** In the in-app browser the page opened with the idle running
(`moving: true`, `outfit-idle`, `webdriver: false`, reduced motion off). Live captures while it moves
(`node scripts/anim-export/capture.mjs --moving`, `captures/<outfit>-live/`): default outfit clean; the hat follows
the idle. **Cost found by looking:** with the accumulator stepping aside while moving, alpha-hashed surfaces drew one
dithered sample per frame: the sheer mesh skirt turned to speckle and hair edges went jagged
(`captures/masked-live/zoom-*-live.png` vs `zoom-*-still.png`). Fixed next.

## Moving view: motion mode (fix for the grain, 5 Nov, user's choice "Fix moving grain first")

`StableFrameAccumulator.render(…, moving)` (`StablePreview isMoving`): each frame renders one jittered sample and
blends it into a running average (weight 0.1 once warmed up) after **clamping the previous average to the min/max of
the current sample's 3x3 neighbourhood**: the standard temporal-AA trick that drops history where something moved
away. Motion-mode hashed coverage uses its own threshold (`AlphaHashSampling` motion frame): an **ordered 3-periodic
pattern**, so every 3x3 window holds one threshold per ninth, rotated every frame, with a random position inside the
band per pixel and a per-layer band rotation (stacked cards stay independent). The still path is untouched (its 100
GPU checks pass unchanged); a third target exists only while moving and is released on pause.

What was tried and measured on the way (GPU, `scripts/anim-export/check-motion-resolve.mjs`):

| Variant | Result |
| --- | --- |
| clamp + the still path's random hash | a 10% surface read 0.024: all nine neighbours often uncovered, the clamp erased it |
| clamp only above 0.75 px/frame of measured motion | sparse surfaces fine, but **a slowly swaying arm smeared over several pixels** (seen in `motion-resolve/masked-live/zoom-arm-resolved.png`) |
| interleaved gradient noise | still 17.6% empty 3x3 windows at 10% |
| ordered 3-periodic, one band offset per frame | 0 empty windows ≥ 1/9, but below 1/9 the whole surface blinked out on the same frames; 50% pulsed 4/9 ↔ 5/9 |
| ordered, per-pixel band position, per-layer band offset added after the bands | no blinking, but 0.12 read 0.042 (pixels spilled into the next band) |
| **ordered, per-pixel position, layer offset as band rotation (shipped)** | see below |

Shipped, measured on a hashed plane drifting at idle pace: coverage exact between 1/9 and 8/9 (0.150 / 0.299 / 0.499 /
0.798 for 0.15 / 0.3 / 0.5 / 0.8); grain (variance) 0.25 → 0.006 at 50% (a converged still view: 0.008); frame-to-frame
flicker down ~90%. Outside that band a surface thins or firms but never vanishes or fills solid (0.10 → 0.053,
0.95 → 0.992). An opaque card moving 4 px/frame leaves no trail (< 0.05 alpha behind it) and stays solid; one drifting
0.5 px/frame smears at most 1 px. Motion end gives a still history identical to a fresh one.

By eye (`captures/motion-resolve-v2/`, full size): skirt reads as sheer fabric with the fishnet visible through it,
hair edges soft, the arm edge crisp (`zoom-arm.png`), no trails in Wave / Take a bow, ponytail under the hat smooth.

Tests: `tests/rig/rig-animator.test.ts` (10: + default choice, still draw mid-animation incl. bones added during
playback, hold/release, replaced emotes released, shared animation files) and `tests/rig/spring-bones.test.ts` (5: + turn swing and settle; the collision case shown to
fail without colliders: 0.071 m vs ≥ 0.13 m). Full suite after the emote picker: 657/666 pass; the 8 failures need extracted model fixtures
absent from a fresh worktree (`ENOENT …/public/models/body/SK_Body_M.glb`, ski-blade fixture), unrelated to this
change. `tsc -b` clean; `vite build` clean.

## Emote picker (5 Nov, user's choice "Emote picker + icons")

All 229 Season 12 emote items with the game's own icons. Emotes whose game version spawns a prop or effects play
body-only and say so.

* **Data (offline, read-only).** `scripts/anim-export/build-emote-catalog.mjs` joins the emote inventory (`DA_Emote_*`
  + UI metadata: name, description, rarity, season tag, icon, AnimSequence), each AnimSequence's notifies (exporter
  `json` mode: what the game spawns while the emote plays) and the icons. The exporter gained a `texture` mode
  (CUE4Parse decode, BC7 through the `Detex.dll` FModel already keeps next to its Oodle DLL, PNG via SkiaSharp); the
  builder crops the card and writes 160 px WebP thumbnails (201 distinct, 3 KB each).
* **What the notifies say.** 162 of 229 emotes spawn a prop actor on a socket (`prop_01`, `weapon_root`, a hand…);
  93 have effects (Niagara systems, or effect-only actors named `*_FX_Prop` / `*VFX*`); 2 spawn an extra prop only
  with a matching cosmetic (Cupid's wings with the angel wings); **33 spawn nothing**: those play complete here
  (apart from sound and face). Every notify's start, duration, socket and offset is kept in `emote-catalog.json`
  (`scripts/generated/anim-export/emotes-3/`) for the props phase.
* **Names** are the game's. The 36 flag emotes share "Flag Wave: {0}" (the game fills in the country); the builder
  fills it from the item id. 12 emotes have no display name (label from the id), and some names look internal
  (`RockingChair_S12`, `OspuzePromote_Kraken`): the files do not say which are on sale.
* **Clips: set-3** (active). 190 animations: 174 used by emotes plus 16 from set-1. Variants share one file (gold
  versions and others), downloaded once: `RigAnimator` caches the data per file and builds each emote's clip under its
  own id, so the state reports the emote that was picked. 8 set-1 emotes that no current item plays (Wave, Clap, Flex,
  Shadow boxing…) sit under **More** as "unlisted"; 5 set-1 emotes became catalog entries with the game's ids
  (`take-a-bow` = Center Stage; `disco` is now C'est la vie and the old one is `disco-00` Funky Fresh; `kung-fu` →
  `kung-fu-tiger`, `robot`, `vampire-dance`). set-2 (same, before the flag-name fix) stays on disk, unused.
* **UI** (`src/components/EmotePicker.tsx`). An **Emotes** button under Animate, showing the playing emote's icon and
  name. Emotes are grouped by season (newest first), then by rarity, each with a rarity bar and a `PROP`/`FX` badge.
  There is a search (name or description), a **Complete only** filter, and a details line ("Not shown: prop (Ace
  Pilot Wings) and effects"). While a prop emote plays with the picker closed, the same line shows under the button.
  **More** holds the idles, the reactions and the unlisted emotes.
  * Desktop: the picker docks beside the viewer, over the catalog column. Inside the viewer it hid the character
    (`captures/picker-before-fixes/desktop-1-open-covering-character.png`).
  * Phone: a sheet under the sticky 3D stage, so the character stays visible.
  * Esc or × closes it and returns focus to the button. Thumbnails load lazily: 43–68 of 201 load when it opens.

Found by looking, and fixed:

* Four different emotes captured after RocketSurf all showed RocketSurf's frozen frame
  (`captures/picker-before-fixes/emotes-frozen-crossfade-sheet.png`). A replaced emote's action kept fading out
  while owned by neither slot, so `seek` (the capture hook) froze the mixer mid-crossfade with it at full weight.
  In normal use it was never stopped: three keeps a faded-out action bound and ticks it every frame, one more for each
  distinct emote clicked. Replaced actions are now tracked and stopped once their weight reaches zero, and `seek`
  drops them. The new test fails without the fix (3 actions bound instead of 2).
* A third line of a long name peeked into the tile's padding (a line clamp clips at the padding edge); the padding now
  sits outside the clamp, and tiles are 4 to a row.
* Since the motion-mode change, ANGLE's D3D compiler warned "potentially uninitialized variable" (X4000) on every
  alpha-hashed program, caused by the early returns. The function now has one exit. The 100 still and 38 motion GPU
  checks give the same numbers.

Captures, all checked by eye at full size:

* `captures/picker/`: desktop and phone, showing open, search, complete-only, playing, More, and the closed picker
  with a prop emote.
* `captures/emotes-set-3/`: 8 emotes, front and side, plus contact sheets.
* Each emote takes its own pose (sword swing, frog crouch, howl, dance, guitar strum, flag wave, wings pose). Shirt,
  jeans and shoes follow.
* Lily Leaper's deepest squat shows a small sock sliver at the left ankle.
* RocketSurf floated in mid-air: its board was the missing prop (shown since 6 Nov, see Emote props).

Sizes: 190 clip files are 12–224 KB gzipped (median 70 KB), each downloaded only when played. The 201 thumbnails
total 669 KB. The manifest is 197 KB raw (20 KB gzipped) and loads at startup; it could be slimmed by moving the
descriptions out.

## Joint deformation: the game's own rig, ported (6 Nov, the user's pinching report)

**Symptom.** A twisted wrist collapsed into a candy wrapper (Fancy a Cuppa); elbows and knees thinned when bent.
**Cause.** The body has 30 `*_vpj` helper joints (forearm twist, elbow/knee volume, upper-arm twist, chest, thigh).
No clip keys them: in the game a post-process Control Rig poses them every frame. Left at rest, linear blend skinning
averages a wrist turned 90° with a forearm that is not, and the mesh pinches.

**Source.** `SK_CharacterMeshMergeTarget_CtrlRig`, run by `MABP_CharacterMeshMerge` after the pose is copied. Its
cooked RigVM bytecode was dumped with the exporter's `json` mode and disassembled
(`scripts/anim-export/disasm-rigvm.mjs`; register names come from the VM's own memory tables, literals from
`Default__RigVMMemory_Literal`). The rules, ported to `src/rig/DeformationRig.ts`:

* Forearm twist: aim `lowerarm_vpj_01` at the hand, then spread the twist over `vpj_04/03/02/01` at 1, 0.8, 0.5, 0.2.
* Elbow/knee volume: push `elbow_vpj` / `knee_vpj` out by the bend angle (yaw of the joint's local delta, clamped
  0–180° / 0–90°) times the rig's own per-side gains.
* Upper arm: two aims (towards the elbow, up-vector from `spine_03`), twist shared 0.6 / 0.3.
* Chest: aim at `spine_03` with the clavicle as up. Thighs: front/back volume from how far the knee swings,
  remapped as the rig does, plus the thigh roll.
* Determinism: every frame starts from the still pose (`restore()`), as the game starts from a fresh pose, so a
  paused frame is bit-identical and the still-view accumulator converges.

**Evidence.** Before/after pairs at full size in [captures/deform/](captures/deform/) (forearm front and side in Fancy
a Cuppa, elbow in Flex, knee in Frog): the candy wrapper is gone, elbow and knee keep their volume. Stopping restores
all 397 bones exactly (worst difference 0). `tests/rig/deformation-rig.test.ts` (needs the body GLB, `BODY_GLB=…`):
bind pose unchanged, a 90° hand twist spreads 18/45/72/90° on both sides, a 90° elbow moves `elbow_vpj` √2·0.09 m,
hyper-extension clamps to 0, repeated runs are identical. `?deform=0` turns the rig off for comparison.

**Approximate / not ported.** The thigh front/back aim uses a custom node (`EmbarkSphericalAim`) with no source;
approximated as a swing towards the knee. The left `thigh_roll_vpj` really sits 11° off its bind pose in the game's
rig (a slip in the rig, kept: a tiny pop as an animation starts). The lumbar pendulum and clavicle-attachment branches
are not ported.

## Emote props (6 Nov, the user's choice "Props next")

The emotes now show what they spawn: guitars, swords, the teddy bear, the rocket board, the notepad and pen, wings,
dragons, a judge's gavel and verdict, hologram partners in two-person emotes. 174 prop actors are built; the picker's
"Not shown" line now lists only what is still missing (effects, and the few props below).

**How the game does it** (read from the files):
* A `AnimNotifyState_DiscoverySpawnProp` on the emote's sequence spawns a prop actor (`BP_Emote_*_Prop`) at its start,
  attaches it to a socket and destroys it at its end. Most sockets are `prop_01` / `weapon_root`, bones the body mesh
  lacks: they hang under `spine_03` through `weapon_buffer`, and every emote clip animates them (at rest `prop_01`
  sits 1.25 m below `spine_03`, at the character's feet).
* A prop actor is a blueprint: a native `Mesh` component plus SCS children (static or skeletal meshes, Niagara).
* Skeletal props run an AnimBlueprint that evaluates exactly one sequence. 28 of them use a SequenceEvaluator at an
  explicit time, `PropAnimTime`, which the **emote sets through its float curve `PropAnimSequenceTime`**: the Ace Pilot
  wings unfold to 0.22 s and hold, the teddy follows the emote clock, the dragon starts 1.4 s in.
* Two-person emotes spawn a hologram stand-in (`SK_EmoteProxyCharacter`, unlit translucent) that copies the pose of an
  invisible master-skeleton mesh running the AnimBlueprint (leader pose).

**Pipeline.**
1. `AnimExport mesh` (new mode): the highest LOD of each prop mesh as raw UE data (`.mesh.json` + `.mesh.bin`), with
   material slots resolved from the mesh itself. `json`/`texture` modes fetch the material instances, their parents
   and textures. `export` with `"skeleton": "*"` decodes each prop sequence on its own skeleton, and now samples
   float curves per frame (`curveValues`).
2. `scripts/anim-export/build-props.mjs` writes one self-contained GLB per actor plus `props.json` (sockets, per-emote
   windows, per-actor clock and space, notes). Every transform and vertex gets the body's mirror ((x, −y, z)/100,
   quaternion (−x, y, −z, w)); triangle winding is checked against the vertex normals (agreement > 90% on all 201
   meshes, none flipped: UE's clockwise front faces become counter-clockwise under the mirror, three's convention).
   Materials: `M_EmoteProps`-family `CR` (colour + roughness) and `NOH`/`NOM` (normal XY, occlusion, metallic) are
   repacked into glTF baseColor, ORM and a normal map with Z rebuilt and green flipped (UE normal maps are green-down).
3. `convert-clips.mjs` keeps the `weapon_buffer`/`prop_01`/`weapon_root` tracks (listed as `attachBones`) and ships
   the emote's `PropAnimSequenceTime` curve (`propTime`).
4. `src/rig/EmoteProps.ts` adds the attach bones under the body **before** the mixer binds (three resolves track
   targets by name once), loads an emote's props while its clip downloads, shows each in its window on its socket,
   and sets each animated prop's own mixer to `curve(emote time)` (or time since spawn): set, not stepped, so a paused
   frame repeats exactly. Props hide for still-pose draws (share card, 3D export).

**Found by looking, fixed** (each from the data, with the evidence in the builder's comments):
* Wings exploded into streaks: their skeleton's root carries scale 100 (an import leftover) that is not part of the
  skinning frame (bones at 136 m, vertices at 1.1–1.6 m; bind pose hides it). The builder picks the frame that puts
  the bones inside the mesh, and divides tracks keyed at 100× rest.
* The hologram leader's `AnimToPlay` is a leftover: UE only uses it in single-node mode (all proxies had played
  Wrestling).
* Six props (map, notepad, judge's paper, spyglass, figurine, turret) key their root 80–174 cm out, **in character
  space**: the notepad's root at 3.3 s lands within 2 cm of `prop_01` in the hand. Those hang from the character
  (props.json `space: "component"`), not the socket.
* `M_Invisible` sections (the game's "hide this" material: a fan's spare blades, placeholder statues) are left out.

**Evidence** (full-size, looked at): [captures/props/](captures/props/): guitar in both hands, katana grip, flag pole,
rocket under the feet mid-ride, wings spread and held as in the icon, teddy hugged, dragon on the arm, fan,
notepad and pen, spyglass on a treasure chest, GUILTY verdict and gavel, Luchador backbreaker and Knighted with
hologram partners, the turret patted on top. Tests: `tests/rig/emote-props.test.ts` (window, sockets, both clocks,
hiding, detach, the curve, the picker's summary) and an animator test that attach bones are driven by the clip.

**Not shown or approximate:**
* Effects (Niagara: sparks, smoke, the Ace Pilot glow), sound, and physics on release.
* Props that depend on the worn cosmetic (`CustomizationItemSpecificDiscoverySpawnProp`) and the country on a flag
  (the flag shows THE FINALS banner); flags do not wave (cloth).
* Weapon-style AnimBlueprints with no sequence (bows, cyber blades, foils) stay in their reference pose.
* 46 materials outside the `CR`+`NOx` family are approximations (layered weapon skins, feathers, LED screens,
  glass, the hologram guessed as unlit translucent cyan); listed in props.json `approximateMaterials`.
* Size: 174 GLBs, 59 MB in total, loaded per emote (median 231 KB, largest 1.8 MB). Not yet meshopt-compressed.

## Published (6 Nov, the user's "Yes, publish")

- **Host:** `https://cd858839.the-finals-outfit-assets.pages.dev/`. This is an immutable Cloudflare Pages preview
  deployment on the `the-finals-outfit-assets` project, branch alias `anim-1106-showcase`, made with wrangler 4.131.1.
  It holds the pointer `manifest.json`, `set-5/` and `props-7/`, plus a `_headers` file with CORS `*` and immutable
  caching, the same as `scripts/stage-assets.mjs`. In total: 569 files, 103 MB.
- **Wiring:** `deploy.yml` sets `ANIMATIONS_BASE` and passes it to both builds as `VITE_ANIMATIONS_BASE`. A later
  clip set needs a new deployment and a new hash, never an overwrite (the files are cached for a year).
- **Receipts in `publish/`:**
  - `deployment-anim.json`: all 568 files byte-identical, headers checked, a missing file returns 404;
  - `prod-check.json`: a production build played a prop emote from the host;
  - `upload-anim.log`;
  - the two scripts that produced these.
- **How to republish:**
  1. Stage into a new folder (`manifest.json` + `set-N/` + `props-N/` + `_headers`).
  2. In PowerShell or Git Bash, from that folder's parent, run
     `node <wrangler 4.131.1>/bin/wrangler.js pages deploy <folder> --project-name the-finals-outfit-assets --branch
     <alias> --commit-dirty=true`.
  3. Run `node _docs/showcase-animation-2026-11-05/publish/verify-hosted.mjs <folder> <host>/` from the worktree root.

## Known gaps

* **Facial animation**: every clip carries 37 `Face_*` expression curves (blink, jaw, brows…). The heads have 305
  `FACIAL_*` bones and no expression morphs; each head has a pose asset (`Head_Face_NN_Base_PoseAsset`,
  `Head_HeadMaster_Base_PoseAsset`) that maps curve weights to facial bone poses. Playing them needs those pose
  assets exported and blended. Faces stay neutral.
* **Cloth simulation** (coats, capes, robes, dresses without jiggle bones) is not reproduced; those parts follow
  their skin weights only and can clip legs in deep poses.
* **Volume-preservation joints**: ported (above); the thigh front/back aim is approximate and two rig branches are
  not ported.
* **Effects and sound** are not played (93 emotes spawn effects); props are, except those listed in the props
  section. Each emote's "Not shown" line says what is missing.
* Spring settings are generic, not the game's; no arm colliders.
* Moving view: surfaces below about 11% opacity (the faintest hair-strand fringe) thin out while moving and
  near-solid ones (above ~89%) firm up; fast motion falls back towards a single sample near moving edges (no motion
  vectors). Real-phone cost of the extra resolve pass (9 taps) and third half-float target not measured.
* Hosting: clips are game data and are ignored by git like `public/models/`. A deployment shows the controls only
  if a manifest is served from `VITE_ANIMATIONS_BASE` (default `animations/`); publishing clips needs your OK.
  A local `npm run build` copies `public/animations/` into `dist/`; the CI deploy builds from a clean checkout.

## Files

App: `src/rig/RigAnimator.ts`, `src/rig/SpringBones.ts`, `src/rig/DeformationRig.ts`, `src/rig/EmoteProps.ts`,
`src/components/AnimationControls.tsx`, `src/components/EmotePicker.tsx` (new);
`src/rig/CharacterRig.ts` (`animationRoot`, `setAnimationPins`), `src/components/CharacterViewer.tsx` (4 insertions),
`src/components/StablePreview.tsx` (`isMoving`), `src/rig/StableFrameAccumulator.ts` (motion mode),
`src/rig/AlphaHashSampling.ts` (motion-frame threshold), `src/rig/SharePreviewRender.ts` (`stillPose`),
`src/components/OutfitExportPanel.tsx` (holds the still pose; now stacked under the animation controls in one
right-hand column instead of overlapping them on the developer catalog). Tooling: `scripts/anim-export/` (exporter
with `export`/`list`/`json`/`texture`/`mesh`/`api` modes (`MeshDump.cs`, `Api.cs`), converter, `build-emote-catalog.mjs`,
`build-props.mjs`, `survey-props.mjs`, `disasm-rigvm.mjs`, `capture-deform.mjs`, `clips.json` (base list),
`requests.json`, `capture.mjs` incl. `--moving` and the `props`/`propsSpace` sets, `capture-picker.mjs`,
`turn-check.mjs`, `check-motion-resolve.mjs`; `scripts/shader-probe/check-temporal-preview.mjs` gained
`TEMPORAL_BASE`/`TEMPORAL_OUT` overrides). Research dumps (ignored, `scripts/generated/anim-export/research/`): package list, property JSON
of the front-end blueprints, physics assets, control rigs, emote data assets, emote inventory, prop actors, meshes,
materials, textures, prop AnimBlueprints, skeletons and sequences. Tests: `tests/rig/rig-animator.test.ts`,
`tests/rig/spring-bones.test.ts`, `tests/rig/deformation-rig.test.ts` (+ `body-skeleton-fixture.ts`),
`tests/rig/emote-props.test.ts`.
Checklist: [functional-checklist.md](functional-checklist.md).

## Clips (Season 12 build)

**set-5 + props-7** (active, 6 Nov): the same 245 clips (from export run-d, which adds sampled curves), now with
the prop attach bones and the `PropAnimSequenceTime` clock on 33 files; props-7 is the props build. Earlier sets and
prop builds stay on disk (set-4: attach bones without the clock; props-1…6: the fixes above, in order); the previous
pointers are kept in `scripts/generated/anim-export/manifest-pointer-*.json`.

**set-3** (5 Nov): 245 clips over 190 files. It holds 229 catalog emotes plus 16 set-1 clips (3 idles, 5
reactions, 8 unlisted emotes). The largest root travel is RocketSurf's 0.30 m; no clip is additive. Details are in
the Emote picker section.

**set-1** (first prototype): 21 clips: 3 outfit-screen idles, 5 outfit reactions, 13 emotes without props. No clip moves the root; idle loop
seams ≤ 0.14°. Sizes 29–304 KB raw, **30–110 KB gzipped** (idle 98 KB; all 21 = 1.1 MB gzipped), loaded on demand.
The June dump's lobby idle (`HM_Frontend_Play_L_Medium_Idle_00`) and the Menu/CharacterSelect Medium idles are no
longer in the Season 12 build; the outfit-screen idles (`HM_Frontend_Outfit_L_Idle_01/02`) are, and suit an outfit
builder better anyway.

## Commands

All from the worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\agitated-northcutt-fbe7d2`; each works in
Git Bash or PowerShell unless marked.

```bash
dotnet build scripts/anim-export -c Release
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll export "C:/Program Files (x86)/Steam/steamapps/common/The Finals/Discovery/Content/Paks" "E:/Coding/the-finals-outfit/scripts/generated/shader-probe/tools/5.7.4-1432394+discovery_12.00.x-Discovery.usmap" "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/.data/oodle-data-shared.dll" scripts/generated/anim-export/run-b scripts/anim-export/requests.json "$APPDATA/FModel/AppSettings.json"
node scripts/anim-export/convert-clips.mjs --run scripts/generated/anim-export/run-b --body E:/Coding/the-finals-outfit/public/models/body/SK_Body_M.glb --out public/animations/set-N --activate
# Emote catalog (set-3): sequence notifies, icons, catalog + clip list, export, convert
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll json "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/json-emote-seqs "@scripts/generated/anim-export/research/targets-emote-seqs.txt" "$APPDATA/FModel/AppSettings.json"
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll texture "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/emote-icons-2 "@scripts/generated/anim-export/research/targets-emote-icons.txt" "$APPDATA/FModel/AppSettings.json"
node scripts/anim-export/build-emote-catalog.mjs --research scripts/generated/anim-export/research --icons scripts/generated/anim-export/research/emote-icons-2 --out scripts/generated/anim-export/emotes-3
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll export "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/run-c scripts/generated/anim-export/emotes-3/requests.json "$APPDATA/FModel/AppSettings.json"
node scripts/anim-export/convert-clips.mjs --run scripts/generated/anim-export/run-c --body ../../../public/models/body/SK_Body_M.glb --out public/animations/set-3 --clips scripts/generated/anim-export/emotes-3/clips.json --activate
node scripts/anim-export/capture.mjs --only=emotes
node scripts/anim-export/capture-picker.mjs
# Deformation rig: disassemble, capture before/after, body-backed tests
node scripts/anim-export/disasm-rigvm.mjs scripts/generated/anim-export/research/json-ctrlrig/<path>/SK_CharacterMeshMergeTarget_CtrlRig.json > scripts/generated/anim-export/research/ctrlrig-disasm.txt
node scripts/anim-export/capture-deform.mjs
BODY_GLB=../../../public/models/body/SK_Body_M.glb npx tsx --test tests/rig/deformation-rig.test.ts
# Props (6 Nov): survey, meshes, materials (repeat json + targets until no parent is missing), textures, prop
# sequences, emote clips with curves, build, convert, activate
node scripts/anim-export/survey-props.mjs --json scripts/generated/anim-export/research/json-prop-actors --out scripts/generated/anim-export/research/prop-survey.json
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll mesh "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/prop-meshes-2 "@scripts/generated/anim-export/research/targets-prop-meshes.txt" "$APPDATA/FModel/AppSettings.json"
node scripts/anim-export/build-props.mjs targets
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll json "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/json-prop-material-parents-N "@scripts/generated/anim-export/research/targets-prop-material-parents.txt" "$APPDATA/FModel/AppSettings.json"
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll texture "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/prop-textures "@scripts/generated/anim-export/research/targets-prop-textures.txt" "$APPDATA/FModel/AppSettings.json"
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll export "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/research/prop-anims-2 scripts/generated/anim-export/research/prop-anim-requests.json "$APPDATA/FModel/AppSettings.json"
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll export "<paks>" "<usmap>" "<oodle.dll>" scripts/generated/anim-export/run-d scripts/generated/anim-export/emotes-3/requests.json "$APPDATA/FModel/AppSettings.json"
node scripts/anim-export/build-props.mjs build --catalog scripts/generated/anim-export/emotes-3/emote-catalog.json --out public/animations/props-N
node scripts/anim-export/convert-clips.mjs --run scripts/generated/anim-export/run-d --body ../../../public/models/body/SK_Body_M.glb --out public/animations/set-N --clips scripts/generated/anim-export/emotes-3/clips.json --activate --props public/animations/props-N
node scripts/anim-export/capture.mjs --only=props
node scripts/anim-export/capture.mjs --only=propsSpace
node _docs/showcase-animation-2026-11-05/serve-5181.mjs
node scripts/anim-export/capture.mjs
node scripts/anim-export/capture.mjs --moving --only=masked
node scripts/anim-export/turn-check.mjs
TEMPORAL_BASE=http://127.0.0.1:5181 node scripts/anim-export/check-motion-resolve.mjs
TEMPORAL_BASE=http://127.0.0.1:5181 TEMPORAL_OUT=scripts/generated/anim-export/temporal-check node scripts/shader-probe/check-temporal-preview.mjs
dotnet scripts/anim-export/bin/Release/net10.0/AnimExport.dll json "C:/Program Files (x86)/Steam/steamapps/common/The Finals/Discovery/Content/Paks" "E:/Coding/the-finals-outfit/scripts/generated/shader-probe/tools/5.7.4-1432394+discovery_12.00.x-Discovery.usmap" "C:/Users/ChronoHax/Downloads/c515634f862cc7387d845d327dac2f85a1456104/Output/.data/oodle-data-shared.dll" scripts/generated/anim-export/research/json-N "@scripts/generated/anim-export/research/targets.txt" "$APPDATA/FModel/AppSettings.json"
```

(`<paks>`, `<usmap>` and `<oodle.dll>` are the three paths in the first `export` line. `$APPDATA` and the
`VAR=value command` prefix are Git Bash syntax; in PowerShell use `$env:APPDATA` and set
`$env:TEMPORAL_BASE='http://127.0.0.1:5181'` on its own line first.) `AnimExport list … <regex> <AppSettings>` prints
matching package paths in the installed build. `requests.json` is generated from `clips.json`.

Workspace notes: `node_modules` in this worktree is a **junction** (link only) to
`scripts/generated/release-2026-11-05/node_modules`, which has exactly main's dependency set; remove it with
`cmd /c rmdir node_modules` (PowerShell or cmd), never a recursive delete. The dev server
(`serve-5181.mjs`, port 5181) reads the root checkout's `public/` read-only, in memory for JSON (the reason is in the
script), and keeps Vite's cache in `scripts/generated/vite-cache/5181`. The main session's 5174 server is untouched.
