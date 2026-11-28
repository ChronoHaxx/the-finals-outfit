# Own-weights route: the starter sneakers and T-shirt on Light (28 Nov 2026)

**Asked by:** the user ("yes", 28 Nov, in the coordinator session) to the 4 rows the 26 Nov UV-tile census held:
`SK_Sneakers_L/_H` and `SK_StarterSet_TShirt_L/_H`. Only Light can go live, since Heavy is not public. The coordinator
asked for own-weight captures in idle and emotes, and for the body-mask choice as 2–3 options with images.

## The rule (`build-archetype-index.py --own-weights NAME[,NAME]`)

Each of these rows is its Medium sibling's surface at the class scale, in the same vertex order. One UV0 island sits 4
tiles away, and the skin is the game's own reweight. Proofs 3 and 3′ refuse it, so for listed rows only, the route
replaces proof 3 with `own_weights_surface`:
- **The same mesh:** the same primitives, indices and material slots. Positions are within 1e-5 m and normals within
  1e-4 of the class-scaled Medium.
- **UV0:** a whole-tile shift per vertex, within one stored half-float step at that magnitude. No triangle may span two
  shifts, and the class may read only tiles the Medium already reads.
- **UV1:** within 1/1024.
- **Joints:** as the reshaped route checks them.
- **Weights:** recorded (vertices reweighted, the largest difference in u8 steps), not gated.

The GLB is served as the game wrote it, raw tiles included, as S12 C0b serves the Medium's. It keeps the Medium's body
masks, as proof 3 and 3′ rows do.

**Tests:** 10 new ones (70 OK). Removing the straddle guard, the tile guard, the listed-only condition or the registry
refusal each makes a test fail.

## Dry run on the active index `d84f89ae…`

Run from this branch's builder against the main checkout's `public/models` (read only). It used the flags of every Light
patch since 26 Nov, plus `--own-weights SK_Sneakers_L,SK_Sneakers_H,SK_StarterSet_TShirt_L,SK_StarterSet_TShirt_H`.
A baseline without `--own-weights` ran beside it.

| Row | Verdict | Shift | UV0 residual | UV1 | Reweighted | Max u8 steps | Index |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| `SK_Sneakers_L` | pass | one island, +4 tiles in U, 92 vertices | 1.0 fp16 step | 9.8e-4 | 1,014 of 1,390 | 23 | **added** |
| `SK_StarterSet_TShirt_L` | pass | one island, +4 tiles in U, 218 vertices | 1.0 fp16 step | 6.1e-5 | 1,251 of 1,761 | 15 | **added** |
| `SK_Sneakers_H` | pass | the same | | | 1,014 | 23 | skipped: class body not proven |
| `SK_StarterSet_TShirt_H` | pass | the same | | | 1,251 | 15 | skipped: class body not proven |

- **Against the baseline, the index changes by exactly the 2 Light entries,** plus `itemBodyMasks` keys pointing at their
  Medium's existing masks.
- **Positions:** 4.8e-8 m (sneakers) and 3.9e-7 m (T-shirt) from the class-scaled Medium. Normals are identical.
- **The live Medium GLBs are byte-identical to the reads paired here** (`b292ec21…`, `8dbda7bf…`), so the 26 Nov census
  still holds.
- **Outside this route:** the baseline itself adds 13 Light rows the active index lacks. Their Medium siblings were
  repointed by the S12 C1/C2 applies, so they now pass proofs 1 and 3/3′ under main's rules. They are their own
  follow-up ("Light after C1/C2"), not part of this route.

## Captures (`capture.mjs`, through the read-only overlay)

The setup:
- the app from the worktree (vite on 5181);
- the overlay on 5199, serving the main checkout's `public/` with the dry run's index and meshes;
- emotes from the live animations host.

The poses:
- the outfit-screen idle;
- Tornado Warning at 2.2 s (the kick) and 3.6 s (the landing), for the feet and ankles;
- Sun's Out, Guns Out at 3.0 s (the flex), for the torso and shoulders.

64 shots, Light against Medium, 0 console errors. Each item builds on Light, with no class notice, except one:
- **`starterset-sneakers-leather-redpanda` stays off Light, named "Low Sneakers".** That item also wears
  `SK_Socks_Quarter_M`, which has no Light mesh yet. The same pair is why Arena Ready's Low Sneakers are off Light. Those
  variants need `SK_Socks_Quarter_L` too.

**What the shots show:**
- **T-shirt (black, idle, kick and flex; front, back and side):** on Light it moves as the Medium does.
  - The sleeves follow the raised arms.
  - The neckline and hem sit as on Medium.
  - No skin shows through, and no gap opens at the shoulders or the hem.
  - The logo and the shifted island's texture land as on Medium.
- **Sneakers (black leather, nylon):** the texture is as on Medium on every island, the shifted one included (laces,
  sole, leather). The shoes follow the feet through the kick and the landing.
  - **The starting outfit's jeans cover the collar**, so these shots cannot show the ankle, where a mask gap would
    appear. A bare-ankle capture (shorts) follows when the heavy slot is free.

## The body-mask choice

In bind pose these meshes are the Medium's surface scaled (within 5e-8 m), and the Light body is the Medium body scaled.
So a mask projected for Light would reproduce the Medium's. The real choice is:
1. **The Medium's mask**, as more than 100 Light rows already use. This is what the dry run does. The captures show no
   gap for the T-shirt; the sneakers wait on the bare-ankle shots.
2. **A trimmed mask**, keeping a little more skin under the garment where motion opens a gap. Only needed if the captures
   show one.
3. **Keep them off Light** for now.
