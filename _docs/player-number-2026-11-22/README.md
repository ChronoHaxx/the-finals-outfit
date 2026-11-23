# Player number: one digit, and why there is no Off (22 Nov 2026)

Shocka's item 6 asked for two things PR #60 (`_docs/player-number-2026-11-21/`) left out: single-digit numbers and
turning the number off. This PR ships 0–9 the game's way, and no Off, because the game has none.

## How the game prints one digit (offline reads only)

The shipped SM5 pixel shader of `MI_Casual_BasicTshirt_Cotton_EsportAlliance` (coverage-sprint-a-01 export,
`*.basepass-pixel.dxbc.asm` lines 126–144, with the binding report's names) runs `MF_CharacterAtlasUV` like this:

```
k     = single * -0.05 + 0.1                 mul/add on cb3[4].x  (single = 1 - saturate(floor(N * 0.1)))
uc    = clamp(u, cb3[3].x, cb3[3].y)         lo = 0.25 * single, hi = saturate(1 - single + 0.75)
base  = uc * 2 * 0.1
left  = base + tens,  right = (base + ones) - k
sel   = saturate(floor(uc + 0.5) + single)
atlas = (right - left) * sel + left          then sample the ten-cell digit strip at (atlas, v)
```

- **Two digits** (single = 0): u covers the whole decal, tens on the left half, ones on the right. This is the
  route PR #60 shipped.
- **One digit** (single = 1): u is clamped to the middle half, the right cell is forced on and shifted by 0.05
  instead of 0.1. The lone ones digit prints **centred at one cell's width**. Outside the middle half, the clamp
  holds the cell's edge column, which is the glyph's empty margin. The decal's coverage test uses the unclamped u, so
  the box itself does not change.
- **0** is a digit like the others: single = 1, ones = 0, a centred 0.
- Embark's Season 7 post agrees: "Some want to be #1, others prefer to rock double digits"
  ([S7 teaser](https://www.reachthefinals.com/patchnotes/s7teaser)).

## Why there is no Off

- The setting is `GameplayOption.Social.PlayerNumber`, a `PlayerCosmeticNumberOption`, in `DA_OptionRepository`
  (June dump). It is a script class whose range lives in game code. The pak exports no defaults for it.
- Its only text: `ID_OPTION_COSMETIC_NUMBER` "Set Cosmetic Number", and `_DESC` "This number will appear on any
  cosmetics that display numbers (for example, jerseys or other numbered items)." No UI string table has a
  hide/none/off string for it. `ST_Customization` adds only the label "Player Number".
- The material cannot hide it either. `{i}_UseNumber` is a per-item static switch in the MI. Every DecalNumber lands
  on one of the strip's ten glyph cells; the strip has no blank cell.
- With `UseNumber` off, the slot samples the raw strip ("0123456789" squeezed into the box), not nothing.
- Closest faithful option: **Own**, each piece's printed number as in its icon, which is already the default. A
  viewer-only "Hide number" would be an invented state. It was put to the coordinator and is not in this PR.

## What the site does now

- `src/rig/PlayerNumber.ts` finds the arithmetic above **by its shape**, not by its literals, because the slicer
  folds every lane (an authored 5 has no tens add, an authored 10 no ones add). It accepts both max/min spellings: plain,
  and the newer `(isnan(x) ? b : isnan(b) ? x : max(x, b))`. It checks that everything the clamp feeds belongs to the
  site. Then it rewrites six expressions to read `uRecoveredPlayerNumber` (tens, ones, lo, hi) and
  `uRecoveredPlayerNumberCentre` (k, single). The authored number stays bit-exact; any other number runs the game's
  arithmetic.
- Census (`node --import tsx scripts/check-player-number.mjs`, active index, 22 Nov):
  - 294 of 294 numbered programs match. The three the old route refused now follow the pick:
    `MI_Casual_ShirtRolledUpSleeves_Cotton_Adventurer` (5), `MI_Sport_BaseballJersey_Cotton` (8) and
    `MI_Pirate_PoetShirtWithVest_Silk` (10). The other 291 read the same numbers as before.
  - Behaviour: on a 41-step u grid, every original program prints its authored number exactly as the assembly does. Every
    rewrite prints 0, 5, 7, 10, 32, 99 and its authored number bit-exactly as the assembly does (float32, Direct3D
    max/min).
- The picker takes 0–99 (Own stays the default). Saved outfits already kept any number. Links write `pn=0`–`pn=99`
  with no leading zero, and `07`, `100` and `-1` are refused. The share Worker's allow-list is the same.

## Provenance: the programs the live site serves (22 Nov)

The coordinator asked for proof that the lanes come from the shipped programs, not from the June dump, which is a
different build.
- **Live identity** (`node _docs/player-number-2026-11-22/live-identity.mjs`, read-only GETs): the live index on
  a70ffa7f names each material by its shard URL. All 3,725 keys resolve to the same paths as the local index. All 294
  numbered programs (manifest and GLSL) served today are byte-identical to the copies the census checked.
- **Assembly trace** (`node --import tsx scripts/check-player-number-provenance.mjs --reports <list> --root <repo>`):
  - For each of the 294 programs it finds the SM5 assembly the program was sliced from, matched by
    `assemblySha256` among the local shader-probe exports.
  - It follows every rewritten site's data flow through that assembly. The checked chain: clamp max/min, ×2, ×0.1,
    the tens/ones adds, round_ni, add_sat, the right-cell subtraction, and k's mul/add.
  - It checks each operand against that export's own binding report (`// cb3[i].c = <preshader expression>`).
  - Result: 294 of 294 programs and 339 of 339 sites read exactly the DecalNumber lanes lo, hi, tens, ones and single,
    with k = single × −0.05 + 0.1. None differ.
  - Negative control: expecting hi where lo is read flags all 294.
- The June dump was used only for the option's class and strings (the Off question), as evidence.

## Evidence

- Census reports: run the command above (writes nothing without `--out`).
- Production-build captures: `node _docs/player-number-2026-11-22/prod-steps.mjs` (see `functional-checklist.md`);
  screenshots in `scripts/generated/player-number/prod/shots` (gitignored).
