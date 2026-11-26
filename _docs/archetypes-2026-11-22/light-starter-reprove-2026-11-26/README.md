# Light starter re-prove on the C0/C0b index (26 Nov 2026): patch ready, not applied

**Asked by:** the coordinator, 26 Nov. Rebuild and prove `SK_Casual_BasicTshirt_L` and `SK_Casual_TallSneakers_L`
against the current Medium meshes in active `9e2fe5d3`, then produce a merge patch with captures.

**Rules:** the standing rules, unchanged. Proof 1′ is live-equal; proof 1″ is not implemented yet and not used. Nothing
here wrote `public/models` or the active index.

## Result

- **TallSneakers_L: proven and in the patch.** C0b swapped the live Medium to `cff3a74c`, which is byte-identical to
  the b01 staged Medium. So proof 1 (same build) holds outright, and proofs 2–6 pass.
- **BasicTshirt_L: refused by proof 3 ("same surface").** The fresh b10 Medium is byte-identical to the live C0 Medium
  `47ccc034`, so proof 1 holds. The game's Season 12 Light T-shirt, however, is a separate export of the surface:
  - the same 1,662 vertices with the same UV0 per vertex, but in a different order;
  - 38 of 2,744 triangles split the other way (a local re-triangulation, same winding);
  - UV1 within 0.0078.

  The Heavy matches the Light exactly. On 18 Oct (Season 11) all three classes had identical indices and UVs. The
  current rule refuses it; see "Proposal" below.
- **Two more rows pass the existing proofs** on the fresh b10 read and are in the build:
  - `SK_Cowboy_HandCloth_L`, so the 5 `cowboy-handcloth-*` items join Light;
  - `SK_Space_SpaceHeroineBracers_L`, which is inert until `SpaceHeroineTop_L` joins, because the item needs both.

  Leaving them out would mean filtering the builder's output, so they stay in the one deterministic build. The
  coordinator decides.

## Fresh read b10 (approved 25 Nov; slot agreed with local_602c33b0)

- **What was read:** Medium, Light and Heavy for all 45 bulk follow-ups (`light-fixwave-plan/requests/b10.json`,
  `976bf8a1…`).
- **Outcome:** 135 packages read and 135 GLBs converted. Map v1 `f36b7c4f`, guard exit 0, nothing missing, 23 s.
- **Run record:** `light-bulk-v2/run.json` is now `3a3cc3f47f27d59ad69300f2c04045deac5d924ba163f48cc6edbc16eeb54213`
  (b01–b10).

## Patch pins

| Pin | sha256 |
| --- | --- |
| Active `assets.json` (reviewed; copy kept as `scripts/generated/archetypes/starter-reprove-build/reviewed-active.json`) | `9e2fe5d329a1744fbcf9f7ffb7c0af841dc5b6622d6f48e21cb1f12bc41e3905` |
| Active `skin-pairs.json`: keep it, never copy the build's re-serialized `4d167fb8…` | `f15a73a2a5dfc2f61c3bbd20bf1ea4b9c9e735a64f856ba12310f1e50e1c00a4` |
| Result `starter-reprove-build/assets.json` | `e7cd0b2fb0c2e5e4845fd9094a5873518ca5c807e4634327535e58795e4ccfd2` |
| `starter-reprove-build/publish-list.tsv` (3 rows) | `71366827a92bf891ef447d0eeac1a9f7880b1946666101545b7f2284d0a1eb46` |
| Run record `light-bulk-v2/run.json` | `3a3cc3f47f27d59ad69300f2c04045deac5d924ba163f48cc6edbc16eeb54213` |
| 17 Nov proof `light-bulk-v2/inputs/nov17-proof-v1.json` | `6406580f9ebb433936f0629a0d7157e412a9a1e40061ec1a9bd5c1e8055d8615` |

**The change** ([delta.json](delta.json), `compare-apply-delta.py`):
- 3 mesh entries, 15 added leaves, nothing altered or removed;
- no item gains `_L` mask keys;
- the `archetypes` record is unchanged.

Print line: `{"light": 3, "heavy": 0} class meshes; 501 refused; 1658 skipped; classes: ['light']`.

The 3 meshes, all from `light-bulk-v2/source-glb`:

| Mesh | sha256 |
| --- | --- |
| `SK_Casual_TallSneakers_L` | `7168f734…` |
| `SK_Cowboy_HandCloth_L` | `049aaf93…` |
| `SK_Space_SpaceHeroineBracers_L` | `990449b2…` |

**Apply:** as [APPLY.md](../APPLY.md) "Bulk apply", with these pins. `M=scripts/generated/archetypes`.
1. Rebuild with the same command and `--out $M/starter-reprove-apply`.
2. Run `compare-apply-delta.py $M/starter-reprove-build/reviewed-active.json $M/starter-reprove-build/assets.json
   <active> $M/starter-reprove-apply/assets.json`. It must print `"ok": true` with `meshesAdded: 3`.
3. The publish list must equal `71366827…`.
4. Copy the 3 meshes, check their hashes, write the index, and record it.

## Captures (unapplied patch, viewed through a read-only overlay)

[capture.mjs](capture.mjs) runs the app from a worktree. A read-only overlay server answers for the main checkout's
`public/`, except the patched `assets.json` and the 3 new meshes. Edge headless, `archetypes=on`, 1500×1100. The PNGs
are local in `scripts/generated/archetypes/starter-reprove-build/captures/`, and the per-shot notices and errors are in
[captures-report.json](captures-report.json).

| Shot | Light notice | Verdict, read at full size |
| --- | --- | --- |
| Starting outfit, front/side/back | "Not on Light yet: SPECTATOR STANDARD" (the T-shirt only; the sneakers have joined) | Jeans and canvas sneakers fit the Light body; the bare torso is where the T-shirt is missing. No clipping. |
| Starting outfit, feet: Light vs Medium | — | Same canvas, soles, laces and tag; the Light pair is smaller. |
| Alliance TallSneakers, feet: Light vs Medium | T-shirt only | The Alliance chevron lands in the same place on both. The print reads `floor(uv0.x)`, so the raw tiles route it correctly, with no smearing. |
| HandCloth, Light vs Medium | T-shirt only | The bandage wraps the same hand on both. One hand is the design. |

Console: 0 errors in 11 of 12 shots. The Medium Alliance side shot logged one `ERR_CONNECTION_REFUSED`, from a host
outside the overlay. It rendered normally; it is one of the shots read above.

## Proposal for the coordinator: proof 3′, "same surface up to vertex order"

Proof 3 compares the Light mesh with the staged Medium exactly, in order. Census of every Light refusal on this build
([refusal-surface-census.tsv](refusal-surface-census.tsv); vertex match by UV0, triangles under the mapping):

| Light vs Medium | Meshes | What it means |
| --- | ---: | --- |
| reordered only | 82 | Same UV0 per vertex and the same triangles under the mapping. 37 differ in vertex order only, 35 in joint-list order only, 4 in both. In 6 the material-slot names don't match the index: a real refusal that stays. |
| re-triangulated ≤ 5% | 17 | As above, but a few quads are split the other way. The T-shirt: 38 of 2,744 triangles. |
| UV0 differs | 115 | Really reshaped. They need their own masks; not proposed. |
| vertex or primitive count differs | 31 | Really reshaped; not proposed. |

**What "same surface" protects is still met.** Every Light vertex samples the same texture coordinates, so the item's
materials apply. Body masks are body-UV textures. Nothing at runtime indexes garment vertices (the 25 Nov evidence in
`light-fixwave/PLAN.md`).

**Sketch, if you want it:** 1″'s bijection and by-name skin conditions, applied to proof 3, plus:
- re-triangulation allowed up to a stated fraction, with the same winding;
- UV1 within a stated epsilon;
- slot names kept exact.

That could admit up to about 76 + 17 Light meshes. Nothing is built until you decide.

## Weak presets: what would complete them (list only; nothing built)

| Preset | Missing on Light | What it waits on |
| --- | --- | --- |
| Starting outfit | T-shirt | Proof 3′ with re-triangulation (above), or the reshaped route (own masks) |
| Alliance fencer | Sneakers | **This patch** |
| | Gloves (`SK_Racing_Gloves_L`) | "Reordered only": proof 3′ |
| | Cargos (`SK_Streetwear_TightTechPants_L`) | Its Medium changed in the game. S12 batch C **C2** refreshes TightTechPants_M; re-prove after. |
| | Helmet (`sport-fencermask-led-alliance`) | Not a Light row: the Medium mesh `SK_Sport_FencerMask_M` is missing from the index ("missing preserved source mesh") |
| Cupid | Lovestriker Tights (`winter-skipants-nylon-valentines`) | Its `SK_Streetwear_UtilityBelt_L` part: the Medium changed in the game. S12 **C1** refreshes UtilityBelt_M; re-prove after. |
| Arena Ready | Low Sneakers (`SK_Sneakers_L`) | Its Medium changed: the UVs differ at the 2⁻⁹ step, probably the old wrap convention. A C0b-style mesh-only refresh of `SK_Sneakers_M` from the 17 Nov read would unblock it. |
| Medieval bot | Torso, legs, shoes (`meta-bot*-wood`) and the arrow | Not Light rows: these items are not in the reconstructed index (`supported-items.json` has no entry), so they need importing first |

None of the 30 fix-wave rows touches these presets.
