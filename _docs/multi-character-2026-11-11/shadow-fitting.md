# Shadow fitting for a group (Phase 2.5, 22 Nov 2026), a short study note

Code: `groupShadowFrustum` in `src/lib/stage-lighting.ts`, used by `SunLight` in `src/components/ViewerStage.tsx`.
Tests: `tests/stage-lighting.test.ts`. One test checks that 60 random groups × 4 sun heights keep every caster inside
the shadow map.

## How a shadow map works

- The sun is a directional light. three.js renders the scene once from the sun through an **orthographic camera**: a
  box of width × height metres, looking down the beam. Each of the map's N × N texels stores one depth, the distance
  to the nearest thing the sun hits there.
- When the camera draws the floor, each floor point is projected into that map. The point is in shadow if something
  nearer the sun was recorded in its texel.
- A texel is the smallest unit the shadow can resolve. Its size on the ground is **frustum size ÷ N**: metres per texel.
  The shadow's edge can only move in steps of one texel. The soft-shadow filter blurs over a few texels, so the
  penumbra is a few texels wide too. A low sun stretches every texel along the floor by about 1 / sin(elevation).

## Why a tighter frustum is sharper

N is fixed: 2048 on desktop, 1024 on touch devices (`mapSize` in `ViewerStage.tsx`). Every metre the box spans beyond
what casts a shadow wastes texels on empty floor, and the texels that land on the characters get bigger.

Measured with the default key light (from `KEY_POSITION`), at the Phase 2 spots 1.2 m apart:

| Contestants | Frustum (m) | mm per texel, desktop (2048) | mm per texel, touch (1024) |
| --- | --- | --- | --- |
| 1 | 2.80 × 3.20 (today's reviewed box, unchanged) | 1.37 × 1.56 | 2.73 × 3.13 |
| 2 | 3.82 × 3.82 | 1.86 × 1.86 | 3.73 × 3.73 |
| 3 | 4.84 × 4.32 | 2.36 × 2.11 | 4.72 × 4.22 |

The alternative is one fixed box big enough for any arrangement, say a 4 m square of floor plus a character's reach,
roughly 6.8 m wide. That would make even a single character about 3.3 mm per texel, 2.4× coarser than today. That is
the reason to fit the box to the group.

## How the box is fitted

1. Give each contestant a box: 1.4 m either side (the reviewed half-width: arms, props) and 2.5 m tall (a hat, raised
   arms, an emote prop).
2. Turn the floor positions into the sun camera's axes. With sun bearing b, three's `lookAt` gives the camera's x
   axis as (cos b, 0, −sin b):
   - across the beam: a = x·cos b − z·sin b;
   - along the beam, toward the sun: d = x·sin b + z·cos b.
3. Left and right are the smallest and largest a, each widened by 1.4 m.
4. Top and bottom. A point at height h and distance d along the beam lands at y = h·cos e − d·sin e (e = sun
   elevation), so:
   - the head of the furthest-back contestant sets the top;
   - the feet of the nearest one set the bottom.
5. Far. The floor shadow of a 2.5 m caster ends 2.5·cos e / sin e beyond its feet, so far reaches the furthest
   shadow tip. Near goes as close as the nearest caster allows.
6. Depth is stored as a fraction of (far − near). The depth bias, which stops a surface shadowing itself ("acne"), is
   rescaled by the same ratio, so it stays the same distance in metres.
7. With one contestant all of this collapses to today's frustum exactly (a test checks it to 1e-9). The builder's
   shadows do not change.

## Traps

- **Refit on release, never mid-drag (Phase 3).** A new frustum changes every shadow texel, which resets the still
  view's accumulation (`StableFrameState`). Refitting at every pointer move would keep the picture from settling.
- **drei `ContactShadows` cannot be moved off the origin.** Its blurred result is drawn on a plane that does not move
  with its own shadow camera, so an offset draws the blob beside the characters (seen: 2 m to the side). It stays at
  the origin, scaled symmetrically to cover the group.
- Phones pay twice: half the texels (1024), and two contestants already double the texel size of one.

## Test yourself

If the third contestant moved 3 m straight away from the sun, along the beam, what would happen to the box's width,
its height and its far plane? (Answer: the height and the far plane grow, because only d changes; the width stays
the same, because a does not.)
