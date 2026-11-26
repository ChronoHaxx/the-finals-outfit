# Light bulk apply, 26 Nov 2026 (APPLY.md "Bulk apply, 538 Light meshes"; on main from b1029f3)

Run from the main checkout. That checkout is on an old branch, so the scripts came from main 963d906
(`scripts/generated/asset-lockdown-worktree/scripts/archetypes`). The coordinator's order applies: after w177
(wave 137), before C0.

- **Inputs:** all five pins match (run.json 2d8b2946, proof 6406580f, reviewed-active b164180c, reviewed result 7ee6ef15,
  publish list 01538d47).
- **Re-pin (coordinator, 26 Nov, case 1):** the active index had moved b164180c → **1d778be3** with wave 137 (w177's 2
  rows). The rule: proceed if the checker shows the same change and no Light row touches those items.
- **Rebuild on 1d778be3** (`light-bulk-apply-2026-11-26.build.log`): `{"light": 538, "heavy": 0} class meshes; 418
  refused; 1206 skipped`. Same counts as on b164180c.
- **Change check** (`compare-apply-delta.py`, output `light-bulk-apply-2026-11-26.delta.json`):
  - reviewed added 3,367 and new added 3,367; altered 0, removed 0;
  - onlyReviewed 0, onlyNew 0, valueDiffers 0, meshesAdded 538, **ok true**.
  - So the w177 rows are untouched; case 2 (drop rows) did not arise.
  - The publish list is 01538d47, equal to its pin.
- **Idle check:** IDLE (`light-bulk-apply-2026-11-26.idle-check.txt`).
- **Backup:** `before-2026-11-26/` has assets.json 1d778be3 and skin-pairs f15a73a2, with SHA256SUMS. (`before/` holds
  the 23 Nov apply's backup and is untouched.)
- **Copy:** 538 rows into `public/models/reconstructed-archetypes-v1/meshes/`. Copied 538, kept 0, 0 sha mismatches
  after, 336,179,404 bytes. Each source was checked against its pin first, and nothing was overwritten.
- **Write:** active `assets.json` **1d778be3 → d750614d** (= `bulk-v2-apply/assets.json`).
  - skin-pairs f15a73a2 is unchanged; the build's re-serialized copy was not copied.
  - supported-items 54e8789c is unchanged.
- **Skips:** `apply-2026-11-26-skipped.tsv` has 1,208 lines (869 heavy, 339 light).
- **Rollback:** restore `before-2026-11-26/assets.json` as the active one. The 538 added meshes are new files under
  `-archetypes-v1/meshes/` and harmless to keep.
- **App check (step 6)** (`light-bulk-apply-2026-11-26-captures/`): current main 963d906 on a temporary 5175 server with
  the root `public/`; `capture-classes.mjs --classes light,medium --cameras full --query archetypes=on`.
  - Every Light shot loads `reconstructed-archetypes-v1/meshes/SK_Body_L.glb` with the light morphs, plus `_L` garment
    meshes (hoodie 5 of 9, cap 8 of 12). 0 console errors in all 12 shots.
  - The skirt outfit's Light shot shows the expected notice, "Not on Light yet: DEPARTURE DAY SKIRT".
  - Looked at full size (hoodie light/medium, cap light): the Light body is slimmer and every garment refits, with no
    clipping or holes.
  - Not checked: the starting outfit's Light jeans and the missing Light sneakers and T-shirt (APPLY.md step 6, bullet
    2).
