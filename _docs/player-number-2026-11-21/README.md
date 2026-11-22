# Player (contestant) number — 21 Nov 2026

Shocka's item 6 (`_docs/feedback-shocka-2026-11/README.md`): set your contestant number, or turn it off. PR #60.

## How THE FINALS does it (offline pak reads only)

- **Material.** `M_Character_Layered` has a global scalar `DecalNumber` (master default 32). Each of the eight decal
  slots has `{i}_UseNumber` (a dynamic branch, default 0) and `{i}_Number` (default 8, never overridden, unused by the
  number path). With `UseNumber` on, the slot's UV goes through `MF_CharacterAtlasUV` and samples a ten-cell strip of
  digits, `T_Decal_NumbersAtlas_01`–`12` (several fonts; some have a matching `_M` normal atlas).
- **Preshader** (decoded from `MI_Streetwear_VarsityJacket_SatinCotton_Season7` uniforms):
  - `single = 1 − saturate(floor(N·0.1))`
  - `tens = floor(N·0.1)·0.1`, `ones = fmod(N·0.1, 1)·10·0.1`
  - `0.25·single`, `saturate(1 − single + 0.75)`, `single` (centre a lone digit)
- **Which items.** In the June build, 316 decal slots in 275 MIs have `UseNumber` on with a numbers atlas; 260 of those
  MIs are in the active reconstructed index. Authored values: 32 (most), 12, 14, 24, 62, 68, 96, 10, 5, 8.
- **How the live game picks the digits.** Season 7 added a player-chosen number, shown on outfits and gear and changed
  in Social Settings ([S7 announcement](https://www.reachthefinals.com/patchnotes/s7teaser)). The June paks have it:
  `WBP_SocialOptions` → `PlayerNumber` (`WBP_Molecule_OptionButton_FloatSlider`), bound to `PlayerNumberGameplayOption`,
  text `ID_OPTION_COSMETIC_NUMBER`. The slider's range and any "off" are in game code, not in the paks.

## What the site does

- Our slicer inlines constants and folds `x·0` and `x+0`. For an authored two-digit number the single-digit lanes fold
  away and `tens`/`ones` remain as one instruction's two literal adds. `src/rig/PlayerNumber.ts` finds them (bit-exact
  float32 match plus the `(u·2)·0.1` shape) and reads them from a uniform instead: exact for 10–99.
- Census (`node --import tsx scripts/check-player-number.mjs --only … --authored …`): of 260 materials, 240 bind an
  atlas; 237 matched, every one equal to its authored `DecalNumber`. Unmatched: the one-digit (5, 8) and round (10)
  authored items, which keep their own number.
- Not shipped: **Off** (no game state; would need per-program decal gating from the slicer) and **one-digit numbers**
  (need the folded centring lanes; a re-slice with live lanes).
- The number is part of the outfit: build store `playerNumber`, saved-outfit known field `playerNumber` (kept as
  stored), link `pn=<10–99>`, share Worker stores and echoes `pn` (the client refuses a card link without it).

## Evidence

Local, gitignored: `.claude/evidence/pn-*.png` in the worktree (sleeve and waist strips: authored → 45 → 10 → 99 →
authored; reload at 23; link at 77).
