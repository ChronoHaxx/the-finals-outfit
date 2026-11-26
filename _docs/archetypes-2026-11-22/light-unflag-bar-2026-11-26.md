# Light unflag bar check, 26 Nov 2026 (coordinator's request, after the Light bulk apply; active d750614d)

**Setup:** current main 963d906 on a temporary 5175 server with the root `public/`, `?archetypes=on&reconstructed=1`.
- Outfits: the starting outfit, plus 5 presets that are whole on Medium, one per season 12, 10, 8, 5 and 1, chosen in
  the app with `presetCoverage` and `presetSlots` over the starting outfit.
- Each was shot full-body on Light and Medium. The script is `light-unflag-bar-2026-11-26/capture-script.mjs`; the
  report is `report.json`.
- **Not on Light** counts the pieces the class notice names ("Not on Light yet: …"). All shots were looked at full
  size.

| Outfit | Season | Pieces | Not on Light | Clipping on Light |
|---|---:|---:|---|---|
| Starting outfit | | 4 | **2**: Spectator Standard (T-shirt), Canvas Shoes (sneakers). Jeans are on Light | none |
| Arch Arcadian (`arcadefighter`) | 12 | 8 | **0** (whole) | none |
| Medieval bot (`medievalbot`) | 10 | 6 | **4**: Center of Attention, Oakbound Stride, Splinter Sprinters, Missed the Mark | none (only the bucket helmet shows) |
| Alliance fencer (`alliancefencer`) | 8 | 7 | **4**: Alliance Helmet, Cargos, Gloves, Sneakers | none |
| Cupid (`cupid`) | 5 | 8 | **1**: Lovestriker Tights | none (the single glove is the design; Medium has it too) |
| Arena Ready (`ftue-01-arenaready`) | 1 | 7 | **1**: Low Sneakers | none |

Medium: 0 not on class for all six. 0 console errors in all 12 shots.

**Bar:**
- Not met: the starting outfit is not whole (its T-shirt and sneakers are missing, as APPLY.md expected).
- Mixed: 3 of 5 presets lose at most one piece; Medieval bot and Alliance fencer lose 4 each.
- No clipping anywhere: a missing piece leaves the underwear or bare skin, with the notice naming it.
- Light stays flagged.
