# Light markers, dragging lights, and more looks (21 Nov 2026)

Shocka's lighting asks (item 4 of `_docs/feedback-shocka-2026-11/README.md`), on top of the Lighting panel from PR #40:

1. A toggle that shows each light in the 3D view: a bulb where it is and a cone the way it shines. Never in
   screenshots, share cards or exports.
2. Move lights more directly, by dragging the bulb, with the panel's Direction, Height and Brightness controls in step.
3. More ready-made looks: Dramatic, Cool, Warm, Fullbright and Nighttime, and one that mimics the Season 12 main menu.

**Stacked on PR #57** (scene backdrops). #57 already adds a "Season 12 menu" look (the Lobby lights in front of its live
menu stage). This change keeps that look and its scene and gives it the menu's own character lights, measured from the
level, instead of Lobby's. It also teaches #57's turntable to leave a dragged bulb alone. Nothing here duplicates #57.

## What changed

| Piece | Where |
|---|---|
| New looks; the S12 menu look's measured lights; the light dome and its drag maths (pure functions) | `src/lib/stage-lighting.ts` |
| `markers` (Show lights), stored beside the look, never in it; `selected` (not stored) | `src/lib/lighting-store.ts` |
| Bulbs, cones, labels and the drag | `src/components/LightMarkers.tsx` (new) |
| The overlay layer and the capture camera helper | `src/rig/ViewerOverlay.ts` (new) |
| Screenshot camera never sees the overlay layer | `src/rig/ViewerScreenshot.ts` |
| Still view's motion pass skips overlay materials | `src/rig/VelocityPass.ts` |
| A pointer a bulb has taken is ignored by the turntable | `src/lib/pointer-claims.ts` (new), `src/components/SceneMode.tsx` |
| Toggle, the picked light's card, the panel staying open while working in the 3D view | `src/components/LightingPanel.tsx` |
| Mounting (hidden with the UI, H) | `src/components/CharacterViewer.tsx` |

The default Studio look is untouched (number for number, `tests/stage-lighting.test.ts`), the markers start off, and
automated browsers start with them off and never store the choice. With the markers off nothing new is in the scene.

## How it works (and why)

**These lights are directional.** Like the sun, only their direction matters; the stored position is 7 m out and only
sizes the sun's shadow box. Drawn at its real place a marker would sit behind the camera. So every marker sits on one
sphere round the character's chest (centre 1 m up, radius 0.8 m), out along its light's direction: a *light dome*.

**Dragging.** A press on a bulb casts a ray from the camera through the pointer and intersects it with the dome. A ray
crosses a sphere twice, the half facing the camera and the half behind; the bulb stays on the half it was picked up on,
so a rim light behind the character stays behind it, and both crossings lie under the pointer, so the bulb follows the
pointer either way. A ray that misses the sphere takes the nearest point of its outline, so dragging past the edge
slides the bulb round the rim. The hit becomes the light's bearing and height, clamped to its slider's range, through
the store's ordinary `edit`: the same path as the sliders, so the sliders follow a drag and a slider moves the bulb,
and the look is saved exactly as a slider change is (within 300 ms, flushed on page hide).

**Input order.** r3f and three's OrbitControls listen on the same element, r3f first, so the bulb's pointerdown
switches the orbit off before the orbit sees the press, and puts it back as it was on release (off stays off in a
scene). #57's turntable listens on the canvas and hears the press first; it ignores a pointer a bulb has claimed.

**Never in a picture.** The markers live on three.js layer 30 only, and a camera draws only the layers it has switched
on. The live camera switches layer 30 on while the markers are shown. The share card draws from new cameras (layer 0
only), the contact shadow and the sun's shadow map use their own cameras, and the 3D export writes the character's own
objects. The screenshot copies the live camera, layers included, so it switches layer 30 off on its copy
(`withoutOverlays`). The labels are DOM, and pictures are drawn from the 3D scene only. H (hide UI) unmounts them, so a
clean view for the system's own screenshot tool has none either.

**The still view.** The markers draw over everything, as editors draw gizmos, at half strength while a light is on the
far side of the character. Their materials are marked `viewerOverlay`, which the motion pass (VelocityPass) skips, so a
bulb never stands in for the surface behind it when the view reprojects. Bulb colours are divided by the exposure, so a
bulb shows its light's colour whatever the exposure; outlines are dark on a light backdrop and light on a dark one.

**The panel.** While the markers are shown, a press in the 3D view does not close the panel, so its sliders can be
watched following a drag, and picking a bulb opens and highlights that light's card.

## The Season 12 menu light, measured

The menu level `CharacterSelection_Lighting` has 25 lights round the menu character. Read from the level's own
properties (main checkout `scripts/generated/scene-backdrops-p1/levels-v3/`), only four reach the character: the others
are switched off in the level (`bAffectsWorld` false), at 0 lm or a few hundredths of a lumen, or under the floor and
aimed sideways. (The P1 evidence JSON lists positions in Blender's frame, left and right mirrored; the raw level is the
source here.)

Each is turned into a direction seen from the character's chest (1.1 m up; bearing + to the viewer's right) and a
strength there, lumens / distance² times Unreal's cone falloff (squared, between the inner and outer cone) and radius
falloff ((1 − (d/R)⁴)²):

| Light | Unreal | Direction | At the chest |
|---|---|---|---|
| Key | spot, 45 lm, 5600 K, radius 2.9 m | 54° right, 54° up | 0.4 (3.7 at the head: the radius fades it from the head down) |
| Blue side | spot, 350 lm, #007BFF | 116° left (behind), 9° up | 11.0 |
| Back light | point, 50 lm, #EDF3F9, radius 7.5 m | 155° left (behind), 8° up | 9.7 |
| Under fill | spot, 10 lm, #DADAFF | in front, 21° below | 2.6 |

So the menu character is mostly lit from behind on the left, blue and white, with a warm key on the face. A directional
light has no falloff, so the key is set between its head and chest values. The level's sky light (an HDRI) and the
stage's blue glow are the hemisphere. The absolute brightness and the exposure are set by eye: the game's auto-exposure
is not in the level. The look keeps #57's stage as its backdrop, ACES tone mapping, and no ground shadows (a shadow
multiplying an LED floor looks wrong, #57 section 8).

## The other looks

Set by eye on the default outfit, each a full look (lights, sky and ground, reflections, tone mapping, backdrop), like
Studio and Lobby:

- **Dramatic:** one hard key from the side and front (60° right, 30° up) with its shadow, so half the face is in
  shadow, and a cool rim; almost no fill; near black.
- **Cool:** a pale blue key, blue fill and rim, Softbox reflections, true-colour tone mapping, slate backdrop.
- **Warm:** a low golden sun (22° up) with its floor shadow, a warm fill and an orange rim, on sand.
- **Fullbright:** no lights at all: an even white sky and ground light and Softbox reflections, no shadows. Every part
  of an outfit visible, colours flat, like the games' "fullbright" view.
- **Nighttime:** moonlight from behind, a dim blue fill and a warm lamp low on the right, on night blue.

## A fix to #57's scene storage

Leaving a scene for a look without one (any ready-made look, or a colour) kept `backdrop.scene` in storage: the store
merges stored fields back so an older build cannot drop a field it does not know, and that also kept the field this
build had just removed. On the next reload (or another tab's change) the scene came back, under the new look's lights.
Now the backdrop fields this build knows (`scene`) are removed from storage when the written look has none; fields it
does not know are still kept (`lighting-store.ts` `OPTIONAL_BACKDROP_FIELDS`, and tests in `lighting-store.test.ts` and
`scenes.test.ts`, whose older test had pinned the old behaviour).

## Checks

See `functional-review.md` for the user's checklist and the agent results.
