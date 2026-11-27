# Reconstruction release 27 Nov 2026: S12 tier-2 C0-C2, sneakers, w177 panning, Light (flagged)

**Authorization:** the user's "yes, release" in the coordinator session (27 Nov), relayed by the coordinator. It covers the
uploads, this PR, merging it on pass and the live check. It does not cover the gated-Worker redeploy, the share Worker `ar`
deploy, unflagging Light, or the 4 reweighted Light/Heavy rows.

**What ships:** the active `assets.json` **d84f89ae** (skin pairs f15a73a2 unchanged; supported-items 54e8789c, changed
by w177). Live before: b164180c (release 23 Nov, plan v18). Light stays behind `?archetypes=on`. Patch note
`2026-11-27-season-12-refit-2`, with the ROADMAP stamp moved to it.

## The 11 applies and their publish lists
| # | Apply (record) | Index | Publish list | Files |
|---|---|---|---|---|
| 1 | w177 panning, wave 137 (`goal-100-2026-10-11/w177-panning-contract/APPLY-STATUS.md`) | b164180c → 1d778be3 | no list file: folder `reconstructed-w177-panning-v4/` (1 mesh, 5 materials, 5 glsl, 27 bins) | 38 |
| 2 | Light bulk v2 (`archetypes-2026-11-22/light-bulk-apply-2026-11-26.md`) | 1d778be3 → d750614d | `scripts/generated/archetypes/bulk-v2-apply/publish-list.tsv` 01538d47 | 538 |
| 3 | S12 C0 (`s12-refresh-tier2-2026-11-22/c0-run/APPLY-2026-11-26.md`) | d750614d → 441eff47 | `merge-patch-c0.publish.txt` c90bd9f3 | 186 |
| 4 | S12 C0b (`c0-run/C0B-APPLY-2026-11-26.md`) | 441eff47 → 9e2fe5d3 | `merge-patch-c0b.publish.txt` 8d206a14 | 1 |
| 5 | Light starter re-prove (`archetypes-2026-11-22/starter-reprove-apply-2026-11-26.md`) | 9e2fe5d3 → e7cd0b2f | `archetypes/starter-reprove-build/publish-list.tsv` 71366827 | 3 |
| 6 | S12 Sneakers_M (`sneakers-apply/APPLY-2026-11-26.md`) | e7cd0b2f → 0c92ceca | `merge-patch-sneakers.publish.txt` 0bd68436 | 1 |
| 7 | Light proof 3′ (`archetypes-2026-11-22/light-proof3prime-apply-2026-11-26/APPLY.md`) | 0c92ceca → … | `archetypes/proof3prime-apply/publish-list.tsv` 0267310a | 100 |
| 8 | Light +2 (`light-b11-plus2-apply-2026-11-26/APPLY.md`) | 20092d96 → 49134266 | `archetypes/b11-followup-apply/publish-list.tsv` bdcff0dc | 2 |
| 9 | Light T-shirt reshaped (`light-tshirt-reshaped-apply-2026-11-26/APPLY.md`) | 49134266 → … | `archetypes/tshirt-l-apply/publish-list.tsv` 5b4452c0 | 2 |
| 10 | Light gloves (`light-gloves-apply-2026-11-26/APPLY.md`) | f65f6543 → bea41987 | `archetypes/gloves-apply/publish-list.tsv` 0e08ae76 | 1 |
| 11 | S12 C1 (`c1-apply/APPLY-2026-11-27.md`) | bea41987 → 32f5b381 | `merge-patch-c1.publish.txt` 8dcb92ae | 274 |
| 12 | S12 C2 (`c2-apply/APPLY-2026-11-27.md`) | 32f5b381 → d84f89ae | `merge-patch-c2.publish.txt` 0ead4766 | 347 |

That is 12 rows: the coordinator's 11 applies, with C0b counted under C0. The S12 `.publish.txt` lists sit in the tier-2
worktree `angry-darwin-c51aab/scripts/generated/s12-refresh-tier2-v1/<c0-patch-v1|c0b-patch-v2|sneakers-v1|c1-patch-v1|c2-patch-v1>/`.
The Light lists sit in the root's `scripts/generated/archetypes/`.

## Gate
- Plan v19 (`v19-release-20261127`, planSha de1e8c31…, 49,625 files: 20,000 / 20,000 / 9,635) from the root's `public/`.
- Diff against v18 (21ee48ae): 1,493 added, 2 changed (`assets.json`, `supported-items.json`) and 0 removed.
- The added and changed files equal the lists exactly: 914 listed in the coordinator's first message, plus 541 Light (bulk
  v2 538 + starter re-prove 3), plus 38 w177, plus the 2 indexes. Every Light sha matched its list, and no listed file was
  missing. The first run stopped on the 541 unlisted files; the coordinator then confirmed both applies were in the chain
  (`gate-extra-v1.txt`, `expected-lists.tsv`, `plan-diff-v1.json`).

## Hosts
| Setting | Before | After |
|---|---|---|
| RECONSTRUCTION_BASE (control) | dfe1d5e8 | **4a0f9a72** |
| Route leaves | f1fa60b6 / 709a36ca | **e1f6dd73** (173 prefixes) / **c18435c2** (651) |

- Staged with `_docs/release-2026-11-23/tools/stage-asset-shard-reuse.mjs`, hard-linking from the v18 upload folders. The
  shards were 19,174 / 9,608 / 19,347 linked and 823 / 24 / 650 fresh.
- `verify-staged-sample.mjs` passed for each shard. Cloudflare took 363 + 24 + 650 new files.
- Upload folders: `scripts/generated/release-2026-11-27/_assets-upload/v19-release-20261127-reconstruction-00{0,1,2}` in
  the main checkout, written there directly. The plan (34 MB) is beside them.
- Rollback: put back the "Before" hosts (still published).

## Checks (agent, under the user's standing waiver of manual checks)
- The repo shard verifier passes. **All 1,495 added and changed files** were fetched from their routed hosts and pass:
  200, CORS `*`, immutable, and the 720 gzip meshes gunzip to the plan's sha256. All 3 deployments pass the manifest,
  header and 404 checks.
- tsc is clean. Tests: 1171 pass and 8 fail. All 8 are ENOENT on extraction fixtures a worktree lacks, the same 8 as
  before.
- Production build (deploy.yml env): bundle `index-DwW6vpoY.js` carries 4a0f9a72, e1f6dd73, c18435c2 and the note, and no
  dfe1d5e8.
- **Routed scenarios: 25 of 25 real ones pass** (`hosted-browser-v1/report.json`), all hosts used. New this release:
  - w177: Biobrace Hoodie + Spectral Intruders;
  - S12 C0 tee + C0b tall sneakers;
  - S12 C2 tight tech pants.

  A 26th scenario, flagged Light, failed for a test-construction reason. The checker builds the legacy `outfit=1.<json>`
  link, and that form never carries `ar`: `share-url.ts` reads it only beside `o=`/`look=`. It was dropped from the tool.
  `tools/light-two-step.mjs` covers Light instead: with the flag stored, LIGHT and MEDIUM are offered; picking LIGHT loads
  `SK_Body_L.glb` and 5 Light meshes from 4a0f9a72 with no errors (`light-picker.png`).
- Captures looked at full size: the w177 pieces render translucent with their panning print, and the Light body is
  visibly smaller with the S12 tee, jeans and sneakers fitted.
