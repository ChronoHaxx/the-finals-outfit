# Reconstruction release 23-24 Nov 2026: S12 tier-2 batch A + v10c, Light (flagged)

**What ships:** the active index `assets.json` b164180c (skin pairs f15a73a2, unchanged). That is:
- S12 tier-2 batch A: 104 garments (`publish-list-batchA-v8.txt`, record `public/models/s12-refresh-tier2-v1/APPLY-RECORD.md`);
- v10c: 11 garments and 6 S12 body masks (`publish-list-v10c.txt`);
- Light: 63 meshes under the new `archetypes` key (publish list 5df7361e, record
  `_docs/archetypes-2026-11-22/REPLAN-2026-11-23.md`). The picker stays behind `?archetypes=on` (coordinator, 23 Nov).
- Patch note `2026-11-23-season-12-refit`; ROADMAP review stamp moved to it.

Index chain: 3f64b2e6 (live since #67) → b4f28192 (S12 A) → 425023bb (Light) → b164180c (v10c).

## Hosts (uploaded 23-24 Nov, coordinator approval 23 Nov)
| Setting | Host |
|---|---|
| RECONSTRUCTION_BASE (control) | `dfe1d5e8` |
| Route leaves | `f1fa60b6` (218 prefixes), `709a36ca` (602 prefixes) |
| ASSETS / MODELS / ANIMATIONS / CHINALS / SCENES | unchanged from main |

- Plan `v18-release-20261123`, planSha `21ee48ae…`, 48,132 files (20,000 / 20,000 / 8,142), from the main checkout's
  `public/`. Against the live plan v4 (07d91060): **184 added = exactly the three publish lists**, 1 changed
  (`assets.json`), 0 removed (`plan-diff-v1.json`).
- Cloudflare took 179 + 7 + 4 new files (`wrangler-*.log`): the new files, the manifests and the rewritten controls.
- Rollback: `deploy.yml` RECONSTRUCTION_BASE + `src/data/reconstruction-routes.json` back to a70ffa7f / b0a014e6 /
  deabf49d (still published).

## Staging by hard link (new this release)
The shared E: drive ran at about 7 MB/s under other sessions' load. A plain `stage-asset-shard.mjs` reads the 16 GB source twice
and writes it once, which would have taken hours. `tools/stage-asset-shard-reuse.mjs` hard-links every file whose row in
the 21 Nov v17 staging pins the same source and encoding. Gzip level 9 is deterministic, so the bytes are identical.
Only the 185 new or changed files and the manifests are encoded fresh. The manifest layout is unchanged.
`tools/verify-staged-sample.mjs` checked membership, every size, every fresh file, and a random linked sample re-encoded from source. Wrangler's
upload counts then confirmed that no linked file differed from what Cloudflare already held.

## Checks (agent, under the user's standing waiver of manual checks)
- `shard-validation-v1.json`: the repo verifier (`validate-asset-shards.mjs`), PASS.
- `hosted-files-v1.json`: all 185 added and changed files fetched from the host the runtime routes them to: 200, CORS `*`,
  immutable cache, bytes = manifest row, and gzip meshes (178, no Content-Encoding) gunzip to the plan's sha256. 0 failed.
- `check-deployment-v1-00N.json`: manifest, headers and 404 for all three deployments, PASS.
- tsc clean. Tests 1128 pass and 8 fail, all ENOENT on extraction fixtures that a worktree does not have (same 8 on
  unchanged main; `release-tests-v2.summary.txt`).
- Production build (`tools/build-release.mjs`, the deploy.yml env): bundle `index-H_TJShBS.js` carries dfe1d5e8,
  f1fa60b6, 709a36ca and the patch note, and no a70ffa7f.
- Routed browser scenarios (`tools/check-production-routed.mjs`, `hosted-browser-v1/report.json`): **22/22**, all 5 hosts
  used, every request on its routed host. The 4 added this release are S12 batch A (tech crop top + cloud bag + bangles),
  v10c (cloth top + dad jeans + disco-bot gloves; pioneer top + tech pants + frog shoes), and earrings on Face 09.
  Captures looked at full size: the garments render clean, and the hoops sit on both ears of Face 09.

## Where the files are
- Upload folders: `scripts/generated/release-2026-11-23/_assets-upload/v18-release-20261123-reconstruction-00{0,1,2}`
  in the main checkout (hard links; the content survives removal of the release worktree).
- Plan (32 MB, not committed): `scripts/generated/release-2026-11-23/shard-plan-v1.json` beside them.
