# Hand-off to the main session: S12 item refresh, tier-1 pilot (13 Nov 2026)

For the session that owns the active index (`public/models/reconstructed-assemblies-v1`). Nothing here has been merged,
published or pushed to the active index. Merge only when the index is idle, **and** after the user's checks or explicit
waiver (`functional-review.md`).

## What the merge does

It repoints 9 garment meshes to their Season 12 rebuilds, as data only. The body stays the pre-S12 file, and no app
code changes.

| Mesh | How it was admitted | Masculine shape change | Items |
|---|---|---:|---|
| `SK_Casual_Tshirt_M` | proof: re-encoded | 0.001 cm | 20 tees |
| `SK_Streetwear_TechGloves_M` | proof: re-encoded | 0.028 cm | 14 gloves |
| `SK_Streetwear_VarsityJacket_M` | proof: re-encoded | 1.363 cm | 12 jackets |
| `SK_Military_SniperPants_M` | proof: re-encoded | 1.434 cm | 8 pants |
| `SK_Casual_Sweater_M` | proof: re-encoded | none | 7 sweaters |
| `SK_StarterSet_TShirt_M` | review: morph set (+`shrink_under_vest`) | none | 13 tees and the USA biker vest |
| `SK_Streetwear_SingleSleeveTop_M` | review: weights (3,632 vertices) | 0.339 cm | 2 tops |
| `SK_Streetwear_HipBag_M` | review: normals + weights | none | 5 bags |
| `SK_Hologram_KneeHologram01_M` | morph-only cascade (released by the sniper pants) | none | 1 |

Result: 81 more items are S12 throughout. "Re-encoded" means S12 only re-ordered or extended the mesh's joint list,
with the same weights by bone name; `skin-by-name-proof-v1.json` has the per-mesh numbers.

## Recipe (Git Bash, from the root checkout `E:\Coding\the-finals-outfit`, while idle)

```bash
W=.claude/worktrees/loving-napier-b93181
A=public/models/reconstructed-assemblies-v1
sha256sum $A/assets.json $A/skin-pairs.json   # must be 7678e698… and f15a73a2…
python -I $W/scripts/body-types/apply-merge-patch.py $W/_docs/s12-refresh-tier1-2026-11-12/merge-patch-pilot-v2.json $A public/models/s12-refresh-tier1-v1/merge-out-pilot-v2 --garments-only
```

What to expect:
- The output reports `meshesRepointed 9`, `skinPairsRewritten 0` and `assetsSha256 431627fc…`, and leaves skin pairs
  unchanged (`f15a73a2…`).
- `git diff --no-index --stat $A/assets.json …/merge-out-pilot-v2/assets.json` shows 18 insertions and 18 deletions:
  a URL and a sha256 line per mesh.
- Back up the active `assets.json`, then swap the new file in your usual way.

If the active index moved, do not apply the patch. Rebuild with the commands in `README.md` ("Rebuild on a moved
index"). Every tool refuses a stale input.

**Publish** the 9 GLBs in `publish-list-pilot-v2.txt` (6.2 MB, all under
`public/models/s12-bodytype-refresh-v1/meshes/`, like the 178 of 6 Nov). The folder matches no `routes` prefix, so it
is served only through the release's rewrite of the control `assets.json` to absolute leaf URLs, as on 6 Nov
(memory `s12-bodytype-refresh`). Check that every repointed URL returns 200 from the leaf after deploy.

## Checks after the merge

- The active `assets.json` hashes to `431627fc…`.
- `skin-by-name-proof.py` on the merged index, into a new file: the 8 admitted meshes are no longer refused (the live
  file is now the S12 file).
- `morph-census.mjs` on the merged index into a new file: still 988 body-type meshes (the pilot removes no
  `medium_*` morph).
- The live worktree's usual test and production checks.
- On 5174, Masculine `casual-tshirt-cotton-black` + `casual-loosejeans-denim-darkblue` should match
  `.claude/evidence/s12-refresh-tier1-2026-11-12-local/idle/s12/a1-tee-x-jeans/masculine-front.png`.
