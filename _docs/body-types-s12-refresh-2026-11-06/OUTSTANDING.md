# Outstanding and parked items: Season 12 body-type refresh (6 Nov 2026)

Everything still open from this side session, so that archiving it loses nothing. Each item names where its evidence
lives. Paths are relative to this folder unless they start with `public/`, `scripts/` or `.claude/`.

## Decisions and acceptance

1. **The merge variant.**
   - The user approved shipping the S12 body-type refresh. The approval was relayed by the main session (about 19:30
     London, 6 Nov) and is not verified in this session.
   - The approved scope was "179 repointed meshes". The agent recommends the data-only garments-only variant
     (178, live body); see `HANDOFF.md` ("Current recipe").
   - Which variant ships is the user's call.
2. **The guided checks.**
   - The 7 checks in `functional-review.md` are pending. The relayed approval says the option text named them as
     pending, so selecting it waived them.
   - Record that waiver there, verbatim, once the main session confirms the user's words.
3. **The route for feminine** (`route-review-2026-11-06.md`). Recommended: the outfit-level fallback for
   `medium_female` only. Not built. It needs:
   - baked `_s12` targets with normals, including the body's `push_lower_torso`;
   - per-mesh index flags;
   - a test of the atomic name switch.

## Work not done

4. **The S12 body** (`SK_Body_M`) is not in the garments-only merge.
   - It carries `medium_female` (3.65 cm) and `push_lower_torso` (0.79 cm).
   - Shipping it needs the body-path change in 12 places in the live worktree (`HANDOFF.md`).
   - It fixes the live feminine corset poke-through (a7). Until it ships, that stays on dev feminine.
5. **The S12 item refresh for the 199 reworked meshes** (`refused-meshes.md`).
   - The top 5 unlock 143 items.
   - Lead: 57 of them are the same surface in another vertex order, so a permutation-aware proof could turn them into
     morph swaps.
   - 11 changed UV1. They gained or lost a real UV1, as noted by the blender-node-export session in memory
     `s12-bodytype-refresh`.
6. **11 live-derived and 32 no-pre-S12-copy meshes**: probably graftable.
   - Prove positions and indices against the processed live GLB, ignoring the attribute our pipeline changed.
   - Classes are in `public/models/s12-bodytype-refresh-v1/refusal-classes-v1.json`.
7. **Untested review directions:**
   - an S12 top whose `medium_male` moved a lot (football hoodie, 2.55 cm) over pre-S12 pants;
   - the wizard pants (`shrink_pants_under_skirt` changed 1.28 cm, held) under a skirt, in androgynous and masculine.
8. **`SK_Sport_Glasses_M` is gone from the S12 paks.** One item (`sport-helmet-metal-holtow`) stays mixed; its S12
   replacement is not identified.

## Findings to keep

9. **Feminine cross-slot clips with S12 jeans** (b3 tech crop top strap, b4 hoodie rib hem). They appear in both
   variants, on the dev gate only. No per-item rule can stop them; the fallback (item 3) or the refresh (item 5) does.
10. **Harness strap ends** show at the back on feminine. This is the municipal pants' own S12 sculpt, one mesh. It is
    minor and probably what the game shows.
11. **Defects already on live:**
    - a2 tights fleck at the back waistband;
    - a5 body-mask stair-step at the lower back flank;
    - the tank-top hem fleck and the pendant fleck on the necklace (live column of `review-v4a-crops`).

## Where the evidence is

- **Committed:**
  - this folder (README, HANDOFF, route review, refused meshes, functional review, merge patches, census, reports);
  - `scripts/body-types/` (tools and tests).
- **Local data in the root checkout** (ignored, survives archiving):
  - `public/models/s12-bodytype-refresh-v1/`: 937 rebuilds, `index-v1..v4`, `index-v4a/v4b`, proofs, coverage;
  - `scripts/generated/shader-probe/s12-bodytype-refresh-v1/`: raw reads `read-01` (2.3 GB) and `read-02`, logs.
- **Captures copied out of the worktree:** `.claude/evidence/body-types-s12-refresh-2026-11-06-local/`, same relative
  paths: `review-v1*`, `review-v4a*`, pairs, crops, triptychs and logs.
- **The tools the merge recipe runs live on branch `claude/quizzical-hermann-33b51b`.** That branch is committed but not
  pushed. Keep the worktree until the merge is done, or move the tools onto `main` through a PR.
