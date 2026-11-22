# Applying the archetype index (for a main-folder session the coordinator assigns)

**Gate (not yet passed):** the 17 Nov proof.
- **Command:** `scripts/archetypes/prove-nov17.py`, output in `scripts/generated/archetypes/nov17-proof-v1/proof.json`.
- **What it does:** re-reads every class package from today's containers, using the 18 Oct run's own probe and
  mapping, then compares package sha256 and `mesh.json`.
- **The rule:** apply only the `proven` meshes. Rebuild the index without the refused ones; the builder needs an
  allow-list option for that. A refused mesh waits for the bulk extraction.

Run in Git Bash, from the main checkout, while no batch is running.

1. **Rebuild against the active index as it is now.** The builder pins `activeSha256`, and main may have moved past
   3f64b2e6:

   ```
   python -I scripts/archetypes/build-archetype-index.py --out scripts/generated/archetypes/apply-<date> --publish-dir reconstructed-archetypes-v1
   ```

   Run it twice and check the two `assets.json` files are byte-identical.
2. **Check the change is additive.** Every original key and value is unchanged, and `itemBodyMasks` entries only gain
   `_L` / `_H` keys. The check script is in this session's record (22 Nov: 58 items gain masks, 173 meshes added).
3. **Back up the active index.** Copy `public/models/reconstructed-assemblies-v1/assets.json` to
   `_docs/archetypes-2026-11-22/before/`, with SHA256SUMS.
4. **Copy the meshes and check the hashes.** Copy each row of `publish-list.tsv` (source, destination, sha256; paths
   relative to `public/models`) into `public/models/reconstructed-archetypes-v1/meshes/`, then check every sha256.
   173 files, 176.6 MB.
5. **Write the new active `assets.json`.** Then re-check: the class bodies load, and `?archetypes=on` shows the Class
   picker. Run `scripts/archetypes/capture-classes.mjs` on a few outfits and look at the shots at full size.
6. **Hosting goes with the next release (coordinator approval).** Stage the `reconstructed-archetypes-v1/` prefix
   with gzip meshes on a leaf, rewrite the control `assets.json`, and add the route prefix. Until then the picker
   offers Light/Heavy only where the index carries them.

The share Worker (`ar` param) deploys separately, also with coordinator approval (live c75c6189). Until it deploys,
the app refuses short links for Light/Heavy instead of dropping the class.
