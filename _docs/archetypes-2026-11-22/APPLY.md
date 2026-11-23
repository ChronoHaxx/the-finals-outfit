# Applying the archetype index (Light) — for the main-folder session the coordinator assigns

**Status:** approved in principle by the coordinator (23 Nov) as a routine step for the user. It is queued after
UsmapGen and run one apply at a time, together with S12 tier-2 batch A, which touches the same `assets.json`. Only
the main-folder session writes `public/models`.

**What it applies:** Light only, 78 meshes. Each passes the index proofs plus the 17 Nov container proof
(`scripts/archetypes/prove-nov17.py`). Heavy stays out, because `SK_Body_H` changed on 17 Nov; the builder refuses a
class whose body is not proven, so Heavy drops out on its own.

## Pinned build (23 Nov 2026)

| Input / output | sha256 |
| --- | --- |
| Active `public/models/reconstructed-assemblies-v1/assets.json` | `3f64b2e6b66a08b38b986fe2674aacdc5c3e0ac2d741fc6d0d8a58c123d2729b` |
| Active `skin-pairs.json` | `f15a73a2a5dfc2f61c3bbd20bf1ea4b9c9e735a64f856ba12310f1e50e1c00a4` |
| 17 Nov proof `nov17-proof-v1/proof.json` | `6406580f9ebb433936f0629a0d7157e412a9a1e40061ec1a9bd5c1e8055d8615` |
| Resulting `assets.json` (apply-v2) | `9055f89ba03689afec67913575b567741ba272f29e8639cd283949ac34fa185f` |
| Its `publish-list.tsv` (78 rows, 71.9 MB) | `aeabd19e31112d50a82610bbcd64374b149bc4430ab431d9662e600391bfbac4` |

The builder is deterministic, so on the pinned inputs the rebuild below must reproduce `9055f89b…` byte for byte. That
is the check that the apply is exactly what was reviewed.

## Steps

Run in Git Bash, from the main checkout, while no batch or other apply is running.

0. **Check the pin.** Run `sha256sum public/models/reconstructed-assemblies-v1/assets.json public/models/reconstructed-assemblies-v1/skin-pairs.json`.
   - Both equal the pins: go to step 1.
   - Either differs (for example S12 batch A landed first): go to **Re-plan** below, then continue from step 2.
1. **Rebuild on the pinned inputs.** The 17 Nov proof is in this branch's `scripts/generated`, which is gitignored, so
   re-prove too:

   ```
   python -I scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/apply-pre --publish-dir reconstructed-archetypes-v1
   python -I scripts/archetypes/prove-nov17.py --report scripts/generated/archetypes/apply-pre/report.json --out scripts/generated/archetypes/nov17-proof-apply
   python -I scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/apply --publish-dir reconstructed-archetypes-v1 --proven scripts/generated/archetypes/nov17-proof-apply/proof.json
   ```

   - Expect `{"light": 78, "heavy": 0} class meshes; 28 refused; classes: ['light']`, with `apply/assets.json` =
     `9055f89b…` and `publish-list.tsv` = `aeabd19e…`.
   - Anything else: stop and report to the coordinator. A fresh proof can only refuse more, for example if the game
     updated again.
2. **Check the change is additive.** Every key and value of the active index is unchanged, `archetypes` holds only
   `light`, and `itemBodyMasks` entries only gain `_L` keys (55 items on 23 Nov).
3. **Back up the active index.** Copy the active `assets.json` and `skin-pairs.json` to
   `_docs/archetypes-2026-11-22/before/`, with SHA256SUMS.
4. **Copy the meshes and check the hashes.** Copy each `publish-list.tsv` row (source, destination, sha256; paths
   relative to `public/models`) into `public/models/reconstructed-archetypes-v1/meshes/`, then check every sha256.
5. **Write the new active `assets.json`.** Then:
   - with `?archetypes=on`, the picker shows Light and Medium only, and Light loads `SK_Body_L`;
   - `node _docs/archetypes-2026-11-22/dev-steps.mjs` (against a dev server on the root checkout) passes;
   - look at a few `capture-classes.mjs --classes light,medium` shots at full size.
6. **Hosting goes with the next release (coordinator approval).** Stage `reconstructed-archetypes-v1/` with gzip meshes
   on a leaf, rewrite the control `assets.json`, and add the route prefix.
7. **Then the share Worker `ar` deploy**, and only after Light is applied and hosted. Send the coordinator one line
   with the plan and the rollback: `npx --yes wrangler@4.131.1 rollback b3c57e95-cb84-4a9c-bf89-f45868aafea3`. The
   Worker source is in this PR; see its README, "Redeploying for archetypes".

## Re-plan (the active index moved since 23 Nov)

The builder reads whatever index is active, and records its sha in `report.json` (`activeSha256`), so re-planning is
the same three commands from step 1 against the new index, plus a review of what changed:

- **Compare the added list with 23 Nov's 78** (`report.json` `added.light` against `apply-v2-pins.json` beside this file, which also holds the 28 refusals).
  - **Fewer meshes is expected and correct** when the other apply repointed a Medium sibling (S12 batch A). Proof 1
    (same build) then refuses that Light mesh, because the staged Light mesh belongs to the old Medium build. Record
    the refused names in this folder.
  - **More meshes cannot happen without a new staging folder.** Stop if it does.
- **If `SK_Body_M` changed** (a body repoint), the Light body loses proof 1 and the whole class drops (`classes: []`).
  Stop and tell the coordinator: Light then needs a fresh read of `SK_Body_L` against the new Medium body.
- **Re-check step 2's additivity against the new active index.** Then record the new pins (active sha, result sha,
  publish-list sha) in a dated section here, and continue from step 3.
