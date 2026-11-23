# Apply v10c to the active index (main-folder session)

For the session that owns the active index in the root checkout (`E:\Coding\the-finals-outfit`). The tier-2 session
cannot write the root checkout (worktree guard), so it prepared everything here. Nothing below has been applied,
uploaded or pushed. Do it only while the index is idle, after the coordinator's approval line.

History:
- Batch A v8 (104 garments) was applied on 23 Nov (`b4f28192…`); its record is
  `public/models/s12-refresh-tier2-v1/APPLY-RECORD.md`.
- The Light apply then landed on top. The active index is now `425023bb…`, written as compact JSON on one line.

## What it does

Data only: URL, sha256 and `bodyMaskUrl` values in `assets.json`. The body, skin pairs and app code stay unchanged.

| Change | Meshes | Why |
|---|---:|---|
| Batch B repointed to its S12 rebuild | 10 | FrogShoes, EmpressShoes, DadJeans, TechPants, CordBelt, AnubisMaskRegular, SciFi_Kneepads, PioneerUpper, PioneerTechConsole, DiscoBotGloves |
| Batch B repointed with its S12 body mask | 1 | `SK_Samurai_ClothTop_M`: the S12 mask hides 1 more texel (coordinator, 23 Nov: ship it, game-faithful) |
| Mask only: batch A meshes already on their S12 file get the mask regenerated from that file | 5 | Bandolier (1 texel), SciFi_Gloves (10), CloudBag (23), TechCropTop (1,512), TechCropTopNoBags (1,503) |

- After the apply, **1,423 of 2,074 shown items are Season 12 throughout** (the item rule's effective set on the Light
  census).
- Admitted but still held by the item rule: Cleats (9 items also show a pre-S12 mesh) and DoubleHolsterPants (1).
- Every repointed mesh's package is byte-identical in the 17 Nov containers (`package-proof-1117-v2.json`).
- Every mask that names a repointed mesh was regenerated from the S12 file. All are unchanged except the six above
  (`mask-proof-batchA-v1.json`, `mask-proof-batchB-v1.json`).
- Review: `README.md` → "v10".

## Files (from the tier-2 worktree)

`W=.claude/worktrees/angry-darwin-c51aab`, data in `$W/scripts/generated/s12-refresh-tier2-v1/` (ignored):
- `merge-patch-v10c.json` (sha256 `2fd127a1…`): the patch, pinned to active `425023bb…` and skin pairs `f15a73a2…`;
- `coverage-s12/`: the 6 S12 body masks the patch points at;
- `publish-list-v10c.txt`: 11 GLBs (7.6 MB) and 6 mask PNGs (353 kB);
- proofs behind it: `morph-only-proof-v10.json`, `skin-by-name-proof-v10.json`, `surface-match-proof-v10.json`,
  `morph-census-v10.json`, the mask proofs, `index-v10c/`, `merge-out-v10c/` (the expected result, `b164180c…`).

**Use the worktree's tools** (`$W/scripts/body-types/`) until the v10 tools PR is merged. Main's
`apply-merge-patch.py` refuses a compact index and does not know mask repoints.

## Steps (Git Bash, from the root checkout)

```bash
W=.claude/worktrees/angry-darwin-c51aab
D=$W/scripts/generated/s12-refresh-tier2-v1
T=public/models/s12-refresh-tier2-v1
A=public/models/reconstructed-assemblies-v1
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"

# 0. Copy the new tier-2 data next to batch A's: new files only (/XC /XN /XO), never deletes. Exit code 1 = copied.
cmd //c "robocopy $(cygpath -w $D) $(cygpath -w $T) /E /XJ /XC /XN /XO /NFL /NDL /NP"
sha256sum $T/merge-patch-v10c.json $T/coverage-s12/*.png | cut -c1-16
#    expect 2fd127a1, then 08812047 bb298b4d a44fef80 afe68589 3d5b1504 36a90de5 (Bandolier, ClothTop, SciFi_Gloves,
#    TechCropTopNoBags, TechCropTop, CloudBag)

# 1. Pins: must print 425023bb… and f15a73a2…
sha256sum $A/assets.json $A/skin-pairs.json

# 2. Patched copy into a NEW folder (the tool refuses an existing one, every stale pin, and a mask file that is
#    missing or differs)
$PY $W/scripts/body-types/apply-merge-patch.py $T/merge-patch-v10c.json $A $T/merge-out-v10c-applied --garments-only
#    expect: meshesRepointed 11, bodyMasksRepointed 6, skinPairsRewritten 0, assetsFormat compact, assets b164180c…
$PY $W/_docs/s12-refresh-tier2-2026-11-22/index-diff.py $A/assets.json $T/merge-out-v10c-applied/assets.json
#    expect: 16 meshes changed (10 "sha256 url", 1 "bodyMaskUrl sha256 url", 5 "bodyMaskUrl"), nothing added or
#    removed, no other block changed. (A line diff is useless: the index is one line.)

# 3. Back up the active assets.json, then swap the new one in your usual way (temp file + rename).
mkdir $T/backup-active-425023bb-$(date +%F)
cp $A/assets.json $T/backup-active-425023bb-$(date +%F)/
```

**If step 1 prints another hash**, the index moved. **Do not apply.** Re-plan on the new index. Every input that does
not depend on the index is reused, and every tool refuses stale inputs:

```bash
O=$T TOOLS=$W/scripts/body-types bash $W/_docs/s12-refresh-tier2-2026-11-22/replan.sh v11
```

This reruns the census and the three proofs on the active index (the slow part). It keeps only the admitted
meshes still refused (an applied mesh is live) and writes `index-v11/` and `merge-patch-v11.json`. Then:
- apply that patch as in step 2;
- recount with `index-diff.py`;
- or ask the tier-2 session to do it and re-review.

**Rollback:** copy the backup `assets.json` back over the active one (hash `425023bb…`). To roll back one garment,
restore its `url`/`sha256` (and `bodyMaskUrl`) from the backup in a new copy, the same way.

## Publish (coordinator approval, with the next release)

The 11 GLBs and 6 masks ship like batch A's, on the next release's leaf:
- `stage-assets.mjs` collects every file the active index references, so they are staged once the apply is in.
  Nothing else in `s12-refresh-tier2-v1/` is referenced, so the evidence folder does not ship.
- The release rewrites the control `assets.json` to absolute leaf URLs, mask URLs included.
- After deploy, every repointed URL must return 200 and gunzip to its pinned sha256 (hosted files are gzip bodies
  without `Content-Encoding`).

## Checks after the apply

- Active `assets.json` = `b164180c…`, still compact; skin pairs `f15a73a2…`.
- `morph-only-proof.py` on the new index, into a new file: none of the 11 is refused any more.
- The 6 `bodyMaskUrl`s resolve to `public/models/s12-refresh-tier2-v1/coverage-s12/*.png`.
- On 5174 (or a 5241-style live server), compare with the tier-2 captures by eye:
  - `?outfit=` of `b02-clothtop-dadjeans-cleats` (Masculine, idle 6 s, front) against
    `captures-v10/b-idle-s12/s12/b02-clothtop-dadjeans-cleats/masculine-front.png`;
  - `o03-techcrop-holster` (Androgynous, idle, front) against `captures-v10/masks-idle-s12/s12/o03-techcrop-holster/androgynous-front.png`.
