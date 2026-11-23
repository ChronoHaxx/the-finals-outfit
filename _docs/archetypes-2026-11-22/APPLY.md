# Applying the archetype index (for a main-folder session the coordinator assigns)

**Not yet:** the coordinator's direction (22 Nov) keeps everything in the preview index, with no `public/models`
writes, until it says otherwise. Below is the runbook for when it does.

**What it applies:** Light only, 78 meshes. Each passes the index proofs plus the 17 Nov container proof
(`scripts/archetypes/prove-nov17.py`, `scripts/generated/archetypes/nov17-proof-v1/proof.json`, sha 6406580f). Heavy
stays out until `SK_Body_H` has a fresh read: its 17 Nov package differs from the staged one. The builder refuses a
class whose body isn't proven, so Heavy drops out on its own.

Run in Git Bash, from the main checkout, while no batch is running.

1. **Re-prove and rebuild against the active index as it is now.** The builder pins `activeSha256`, and main may have
   moved past 3f64b2e6.

   ```
   python -I scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/apply-<date>-pre --publish-dir reconstructed-archetypes-v1
   python -I scripts/archetypes/prove-nov17.py --report scripts/generated/archetypes/apply-<date>-pre/report.json --out scripts/generated/archetypes/nov17-proof-<date>
   python -I scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/apply-<date> --publish-dir reconstructed-archetypes-v1 --proven scripts/generated/archetypes/nov17-proof-<date>/proof.json
   ```

   Run the last command twice and check the two `assets.json` files are byte-identical. On 22 Nov the result was apply
   `assets.json` 9055f89b…: 78 Light meshes, 0 Heavy, 28 refused.
2. **Check the change is additive.** Every original key and value is unchanged, and `itemBodyMasks` entries only gain
   `_L` keys (55 items on 22 Nov).
3. **Back up the active index.** Copy `public/models/reconstructed-assemblies-v1/assets.json` to
   `_docs/archetypes-2026-11-22/before/`, with SHA256SUMS.
4. **Copy the meshes and check the hashes.** Copy each row of `publish-list.tsv` (source, destination, sha256; paths
   relative to `public/models`) into `public/models/reconstructed-archetypes-v1/meshes/`, then check every sha256.
   78 files, 71.9 MB.
5. **Write the new active `assets.json`.** Then check that `?archetypes=on` shows Light and Medium only, and that the
   Light body loads. Run `scripts/archetypes/capture-classes.mjs --classes light,medium` and look at the shots at full
   size.
6. **Hosting goes with the next release (coordinator approval).** Stage `reconstructed-archetypes-v1/` with gzip meshes
   on a leaf, rewrite the control `assets.json`, and add the route prefix.

**The share Worker (`ar` param)** deploys separately, also with coordinator approval (live b3c57e95 on 23 Nov). Until
it deploys, the app refuses short links for a Light outfit instead of dropping the class. Long links work without it.
