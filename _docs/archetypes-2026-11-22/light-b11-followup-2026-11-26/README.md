# b11 follow-up on Light: +2 applied, the gloves need the fresh-pair rule (26 Nov 2026)

**Asked by:** the coordinator, 26 Nov. 4 rows passed proof 3′ in the 3′ run but failed currency (no 17 Nov proof row),
so they were read fresh from the 17 Nov containers (b11) and given a small follow-up patch after 3′.

**Status:**
- The +2 patch is built and reviewed on the post-3′ index. The coordinator chose to apply it now (option a); the
  main-folder session applies it.
- `SK_Racing_Gloves_L` (the Alliance fencer's gloves) needs the fresh-pair rule in this PR. Once it is merged, the
  gloves go as a 1-row patch on the index active then.
- Nothing here writes `public/models`.

## The read

`scripts/generated/archetypes/light-bulk-v3/` (a new run folder, so `light-bulk-v2/run.json` `3a3cc3f4…` and the 3′
patch's shas stay as they are):
- control: 24/24 byte-identical, guard 0;
- batch 11: 12/12 packages (M/L/H of the 4 rows), map `f36b7c4f…`, guard 0, 12 GLBs;
- `run.json` `09066166b3a677b43dc62a49db5a43c368297e98d195ad7a6bffb180d9121957`.

## The +2 patch

```
M=scripts/generated/archetypes   # in the main checkout
python -I scripts/archetypes/build-archetype-index.py --staging $M/light-bulk-v3 --staging $M/light-bulk-v2 \
    --live-equal-medium --same-surface-permuted --proven $M/light-bulk-v2/inputs/nov17-proof-v1.json \
    --out $M/b11-followup-build --publish-dir reconstructed-archetypes-v1
```

Print line: `{"light": 2, "heavy": 0} class meshes; 296 refused; 1864 skipped`.

| Pin | sha256 |
| --- | --- |
| Active `assets.json` (copy: `b11-followup-build/reviewed-active.json`) | `20092d96d5fe36406fc448c49e9195b8564c1e2d3b851f7ffc7eca78bf7641a9` |
| Result `b11-followup-build/assets.json` | `49134266aa221652db71678d68c90c6d27a45a6b726581ecf846a62e396ccea8` |
| `publish-list.tsv` (2 rows) | `bdcff0dc306ce4faa8f13bbfeab46cfed88d4e82666ff0fe1424db8c4dd56b01` |

**The change:** 11 leaves added, nothing altered or removed, 2 meshes:

| Mesh | GLB | Proofs | Items on Light |
| --- | --- | --- | --- |
| `SK_Sport_ClimbingBandolier_L` | `ff9b58f0…` | 1 bytes, 3′ (2 flipped triangles, gap 4.9e-9 m) | 4 newly build: `sport-climbingbandolier-canvas` and its alfaacta, engimo and greenblack variants |
| `SK_Casual_HippieNecklaceChainLong_L` | `6467fb3a…` | 1′ live-equal, 3′ | inert: its crop top still lacks `FrontTieCropTopSleeves_L` |

**Not in it:**
- `SK_Casual_HeadPhonesAntennaPart_L`: its Medium changed in the game on 17 Nov (the fresh M fails proof 1′). It needs a
  Medium refresh first.
- `SK_Racing_Gloves_L`: refused, "not current in the 17 Nov containers: no proof row". See below.

**Captures** ([capture.mjs](capture.mjs), through the read-only overlay; Masculine, Light against Medium, 10 shots, 0
errors). On Light, the bandolier (plain and AlfaActa; front, back and side) is the same as on Medium: rope colour,
carabiners, quickdraws, the strap over the shoulder and the pad on the back. On Light it rests on bare skin, because the
T-shirt was not on Light yet. Nothing else is left off.

## Why the gloves were refused: the builder's order

- The live `SK_Racing_Gloves_M` (`4ef9280b…`) is byte-identical to the 18 Oct S11 read.
- Proof 1 takes a byte match first, so the builder paired the live Medium with the 18 Oct `SK_Racing_Gloves_L`. That
  read has no 17 Nov proof row, so currency refused it.
- The fresh b11 pair was never tried. It passes: the fresh `SK_Racing_Gloves_M` (`be1bf1da…`) is live-equal (proof 1′),
  and the fresh Light passes proof 3′.

**The fresh-pair rule** (`build-archetype-index.py`, with `--live-equal-medium` and `--proven`):
- It applies only where the byte-matched read's class sibling is not current.
- A fresh `--staging` read of the same Medium then stands in, only if it is live-equal to the served Medium (proof 1′).
  A fresh read is never byte-identical, so proof 1′ is the bar every fresh row already meets.
- The class sibling read beside it then takes every proof: 2–5 (3 or 3′), the slots, the fitting morphs and the
  registries.
- Otherwise the row stays refused for currency, exactly as before. `report.json` `freshPair` and `fresh-pair.tsv`
  record every attempt and its verdict.

**Tests** (`FreshPairForAStaleSibling`, 6):
- a stale sibling with a fresh live-equal pair joins from the fresh run, with the fresh Medium's morph difference
  recorded;
- a current sibling keeps its own read, and is not an attempt;
- a fresh Medium that is not live-equal never pairs;
- no fresh Medium, or no fresh Light beside it: the currency refusal stands;
- the fresh Light still takes every proof (a renamed slot is refused);
- without `--live-equal-medium` the rule is off.

Mutations caught: dropping the live-equal check, dropping the currency condition, or proving the fresh Light against the
byte-matched Medium each fail a test.

**Record per used pair:** the fresh and live Medium shas, and the largest difference proof 1′ measured on positions, UVs,
normals and inverse binds beside each epsilon (`report.json` `freshPair`, and the mesh's own `freshPair` block;
`fresh-pair.tsv`).

## Dry run on the active index (f65f6543, after the +2 and T-shirt_L applies)

Main's builder against this branch, the same flags as the +2 build, outputs diffed (`$M/fresh-pair-baseline`,
`$M/fresh-pair-dryrun`; read-only, between the main-folder session's E: jobs):
- **32 fresh-pair attempts; 2 used:** `SK_Racing_Gloves_L` and `_H`.
  - `_L` is added.
  - `_H` passes, but its class body is not proven, so it stays skipped.
- **The other 30 keep their currency refusal:**
  - 29 have no fresh read of the Medium;
  - `HeadPhonesAntennaPart_L`'s fresh Medium is not live-equal ("medium changed in the game").
- **The index changes by exactly one row:** the `SK_Racing_Gloves_L` entry, plus 3 `itemBodyMasks` keys (ArenaSecurity,
  Holtow, BlackOrange) pointing at their Medium's existing masks, as the 3′ rows do. No other row or section changes.
- **Margins**, fresh `be1bf1da…` against live `4ef9280b…`: positions 0, UVs 0, normals 0, inverse binds 3.6e-15 (0% of
  each epsilon). The reads differ only in bytes.
- **The dry run's pins:**
  - assets `bea41987f68482854a14b85abf4b430fd64dfd8d78317c8625f4134faa533274`;
  - publish list `0e08ae763be8b947c8c1027f1e9ce52d580a0d197029e6d03027a45e466f763b`, 1 row: GLB `8017302b…`.

**The 1-row patch:** after this merges, on the index active then, with the same command as the +2 build.
