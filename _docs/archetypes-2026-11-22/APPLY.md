# Applying the archetype index (Light) — for the main-folder session the coordinator assigns

## Bulk apply, 538 Light meshes (decided 25 Nov 2026)

**Decision (coordinator, 25 Nov):** one apply of the whole Light bulk build. It replaces the planned waves W1–W3.
- **Order:** after w177's apply, before S12 batch C's C0.
- **Light stays behind the flag** (`?archetypes=on`).
- **Hosting** goes with the release the coordinator plans after C0.

Run record: [light-bulk/run-2026-11-25/README.md](light-bulk/run-2026-11-25/README.md).

| Pin | sha256 |
| --- | --- |
| Reviewed active `assets.json`, kept as `scripts/generated/archetypes/bulk-v2-build/reviewed-active.json` | `b164180cb6899a9ece4a916bb60bbc2546df9c476aeb90f18ca884108f96ed63` |
| Active `skin-pairs.json` (not written by this apply) | `f15a73a2a5dfc2f61c3bbd20bf1ea4b9c9e735a64f856ba12310f1e50e1c00a4` |
| Reviewed result `bulk-v2-build/assets.json` | `7ee6ef155f6f9dc01777784e0ebd70a144673d86ebc91916cd30eced6f02020d` |
| `bulk-v2-build/publish-list.tsv` (538 rows, 336.2 MB) | `01538d4744d92d63131e53acdf8164662c9dc1fc5d2c0bea1998186dcfffea8c` |
| Run record `light-bulk-v2/run.json` | `2d8b294691e4b33620ceed31521385633ca7d342a258d74e67fdd67eb30d52aa` |
| 17 Nov proof `light-bulk-v2/inputs/nov17-proof-v1.json` | `6406580f9ebb433936f0629a0d7157e412a9a1e40061ec1a9bd5c1e8055d8615` |

**What review covered:** the change from `b164180c` to `7ee6ef15`, all additive:
- +538 mesh entries;
- `_L` mask keys for 147 items;
- 3,367 new leaves, nothing altered or removed (`compare-apply-delta.py`).

w177's apply moves the active index first, so the result sha cannot repeat. What must repeat is the change.

Run in Git Bash from the main checkout, using `scripts/archetypes` from `main` once the run-record PR has merged. No
batch or other apply may be running. `M=scripts/generated/archetypes`.

1. **Check the inputs.** Run `sha256sum $M/light-bulk-v2/run.json $M/light-bulk-v2/inputs/nov17-proof-v1.json $M/bulk-v2-build/reviewed-active.json $M/bulk-v2-build/assets.json $M/bulk-v2-build/publish-list.tsv`.
   Each must equal its pin above. Then record the sha of the active `assets.json`; call it the new active.
2. **Rebuild on the active index:**

   ```
   python -I scripts/archetypes/build-archetype-index.py --staging $M/light-bulk-v2 --live-equal-medium --proven $M/light-bulk-v2/inputs/nov17-proof-v1.json --out $M/bulk-v2-apply --publish-dir reconstructed-archetypes-v1
   ```

   - On `b164180c` it prints `{"light": 538, "heavy": 0} class meshes; 418 refused; 1206 skipped; classes: ['light']`
     and reproduces `7ee6ef15` byte for byte.
   - On a moved index the counts may only move where the other apply touched a Light mesh's Medium. Step 3 decides.
3. **Check the change, then the publish list:**

   ```
   python -I scripts/archetypes/compare-apply-delta.py $M/bulk-v2-build/reviewed-active.json $M/bulk-v2-build/assets.json public/models/reconstructed-assemblies-v1/assets.json $M/bulk-v2-apply/assets.json
   sha256sum $M/bulk-v2-apply/publish-list.tsv
   ```

   - Expect `"ok": true` with `"meshesAdded": 538`, and the publish list equal to `01538d47…`. The list does not
     depend on the active index.
   - Anything else: stop and send the coordinator the checker's output. A mismatch means the other apply touched a
     Medium the Light build depends on, so that row needs review before it ships.
4. **Back up, copy, check, write.** Steps 3–5 of the list below:
   - back up the active `assets.json` and `skin-pairs.json` into `before/`;
   - copy the 538 publish-list rows into `public/models/reconstructed-archetypes-v1/meshes/` and check every sha256;
   - write `$M/bulk-v2-apply/assets.json` as the new active `assets.json`.

   **Do not copy the build's `skin-pairs.json`:** it is a re-serialized copy of the active one (`4d167fb8…`, same
   content).
5. **Record the apply.** Add a dated section here with:
   - the new active sha and the result sha;
   - the checker's output;
   - the apply's `skipped.tsv`, copied as `apply-<date>-skipped.tsv`.
6. **Check in the app** with `?archetypes=on`:
   - the Light picker loads `SK_Body_L`;
   - the starting outfit wears the Light jeans, while the Light sneakers and T-shirt are still missing (expected);
   - a few full-size `capture-classes.mjs --classes light,medium` shots of items that gained `_L` meshes.
7. **Hosting and the share Worker's `ar` deploy** go with the coordinator's release, as in steps 6–7 below.

**Expected afterwards on Light:**
- items 960 → 1,974 of 2,953;
- presets whole 6 → 32;
- presets losing at most one piece 15 → 147, of 352.

The flag stays on until the bar is met.

## History: the 23 Nov apply (done; Light is in the active index since then)

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

   - Expect `{"light": 78, "heavy": 0} class meshes; 28 refused; <N> skipped; classes: ['light']`, with
     `apply/assets.json` = `9055f89b…` and `publish-list.tsv` = `aeabd19e…`. (The 23 Nov builder printed no skip count.)
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
the same three commands from step 1 against the new index, plus a review of what changed.

The builder (from the follow-up PR to #83) puts every class mesh the item definitions name in exactly one list:
- `added`;
- `refused`, where a proof failed;
- `skipped`, with a reason and the Medium mesh behind it.

It prints a count per reason and writes `skipped.tsv` beside `publish-list.tsv`. It stops if a mesh lands in no
list or in two. The print line is now `{…} class meshes; N refused; N skipped; classes: […]`.

- **Compare the added list with 23 Nov's 78** (`report.json` `added.light` against `apply-v2-pins.json` beside this
  file, which also holds the 28 refusals). Every name that left `added` or `refused` must now be in `report.json`
  `skipped`, with its reason. Stop if one is in neither.
  - **Fewer meshes is expected and correct** when the other apply repointed a Medium sibling (S12 batch A). Proof 1
    (same build) can no longer hold, because the staged Light mesh belongs to the old Medium build. The builder skips
    it as `medium sibling repointed`, with the live URL and sha it found.
  - **More meshes cannot happen without a new staging folder.** Stop if it does.
- **Record the skips in the apply record.** Copy `skipped.tsv` into this folder as `apply-<date>-skipped.tsv`, beside
  the new pins. In the dated section, list the names that left the 23 Nov set and their reasons.
- **If `SK_Body_M` changed** (a body repoint), the Light body loses proof 1 and the whole class drops (`classes: []`).
  Stop and tell the coordinator: Light then needs a fresh read of `SK_Body_L` against the new Medium body.
- **Re-check step 2's additivity against the new active index.** Then record the new pins (active sha, result sha,
  publish-list sha) in a dated section here, and continue from step 3.

### Expected re-plan on b4f28192 (computed read-only, 23 Nov)

On active `assets.json` `b4f28192ced46b8d445bfc988b2779066e9f5f038e28d73beb475e71afffb92f` (S12 batch A v8), with the
17 Nov proof `6406580f…`:

- The print line: `{"light": 63, "heavy": 0} class meshes; 25 refused; 2074 skipped; classes: ['light']`.
- `assets.json` `425023bb9cef392b4154adcd41624a870ae76713ccd8ba98b149aae893c832d7`.
- `publish-list.tsv` `5df7361ef5e80933c3dbe459611c41dbfb89c846199a9b7fe39e618b43e1fbe4` (63 rows, 61.3 MB).
- 50 items gain `_L` mask entries.
- **15 Light meshes leave the 23 Nov 78**, all `medium sibling repointed` to `s12-bodytype-refresh-v1`. They are
  waiting for an S12-matched `_L` read; the names are in README.md, "Re-plan on the S12 batch A index".
- **3 of the 28 refusals become skips** for the same reason (`CrossPromo_NRSuit_L`, `Space_AstroPilotGloves_H`,
  `Streetwear_BoilerSuitTorso_L`), so refused falls to 25.

The old builder gave the same `assets.json` and publish list, without the skip record.

**Later applies (Light already in the index).** Before 23 Nov's fix, a run on an index that already carried Light
refused the class ("class body not proven"), because `SK_Body_L` was skipped as already indexed, and dropped every new
Light mesh with it. The builder now re-proves the applied body and reports `classes.light.alreadyApplied: true`. On
`b164180c…` such a run is a no-op: its `assets.json` is byte-identical to the active one. If the run on the apply day
differs from these values, the active index has moved again: re-plan from there.
