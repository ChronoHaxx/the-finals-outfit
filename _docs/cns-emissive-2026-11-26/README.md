# CNS emissive parts missing against their icons (26 Nov 2026)

The visual-diff route audit (PR #99, `_docs/visual-diff-route-audit-2026-11-25/`, rows 16 and 22) found two CNS items
that still fail against their icons on the site's route:
- `military-rebreather-rubber-cns` (Pingjammer): the LED "CNS" visor is missing;
- `samurai-facemask-base-cns` (Grin Dream Residue): the cyan circuits are missing.

**Neither is a renderer defect, so this PR changes no rendering code.**
- The rebreather is drawn as the game defines it today. Season 12 removed the visor from this item; the icon still
  shows the old version.
- The samurai mask's cyan is the CNS Glitch overlay. The 11 Nov decision 5 dropped it, and it is already purple.

This PR adds a review note for the rebreather so the picker explains the difference, plus this record.

## Live and local agree

The live site (chronohaxx.github.io, index `dfe1d5e8`) and this branch on a dev server against the deploy.yml hosts
draw the same thing:
- Pingjammer: the rebreather alone.
- The samurai mask: the black mask without the cyan grid.
- `__sourceAssembly` lists the same parts on both: `SM_Military_Rebreather` only, and `SM_Samurai_FaceMask` plus
  `SM_Samurai_FaceMaskGlitch`. The glitch mesh is then dropped by the index's `glitchOverlayParts: "drop"` gate.

Sheets (icon | live | branch): `evidence/rebreather-cns.jpg`, `evidence/samurai-cns.jpg`.

## Cause 1: the rebreather lost its visor in Season 12

| Build | `DA_Military_Rebreather_Rubber_CNS` | Source |
|---|---|---|
| Pre-S12 | 2 visual parts: `SM_Military_Rebreather` plus `SM_VaporWaveGlasses`, with overrides `MI_Streetwear_VaporWaveGlasses_Plastic_CNS` (frame) and `MI_Character_PanningHologram_CNS_Visor` (lens) | `_docs/goal-100-2026-10-11/w116-s12-definition-refresh/apply-v1/before/items/military-rebreather-rubber-cns.json` (DA sha `960621C6…`) |
| S12 12.00 | 1 part, the rebreather only. w116 refreshed the stored definition to it on 2 Nov; w116's README lists "the rebreather losing its vaporwave glasses" | w116 `drift-v1` (`differs`: MaterialOverrides, VisualParts), then `verify-v1` (identical) |
| 17 Nov (installed) | 1 part, identical to the stored definition | `evidence/drift-17nov-build.json`: today's offline read, patched usmap v1 `f36b7c4f`, "Mounted 32 containers; 399699 files" |

- The visor is now its own eyewear item, `streetwear-vaporwaveglasses-plastic-cns` (`DA_Streetwear_VaporWaveGlasses_Plastic_CNS`).
  - It carries the same two overrides on `SM_VaporWaveGlasses`.
  - Its icon is the same black frame with the "CNS" LED text: `evidence/cns-visor-is-its-own-item.jpg`.
  - The game's CNS preset outfit wears both items (`src/data/preset-outfits.json`).
- The rebreather's icon predates the split, so it still shows the visor.
- Drawing the visor on Pingjammer would contradict the current game data, so the site is right as it is.

**The visor's own item is red and untracked.** `streetwear-vaporwaveglasses-plastic-cns` is in the source catalog
but not in `supported-items.json`. It has no cosmetics model, so the site draws nothing for it. It is in none of the
goal pool's red lists (`red-ids-2026-11-11-late.json`, `red-census-v6.json`, `hold-index-v17.json`).

Route to reconstruct it:
- The frame, `MI_Streetwear_VaporWaveGlasses_Plastic_CNS`, is a 4Layers MI, so it has a supported root.
- The lens, `MI_Character_PanningHologram_CNS_Visor`, is the hard part. w60 (`w60-panninghologram/REPORT.md`) put it
  in **program A**, together with the AlfaActa visor and the EsportKZ and Pulsar goggles. It is not in program B, the
  one w177 builds (`VaporWaveVisor_CNS`, Ospuze).
  - On S12 that family looks like w177's next in line, `6189f27e`, the TranslucentGreyTransmittance trio. It needs a
    non-additive contract (w177 README).
  - That match is an inference from w60's grouping on the older build. Confirm the program hash at the source stage.
- So: add the item to the red pool, and batch it with the `6189f27e` contract after w177 is applied.

## Cause 2: the samurai mask's cyan is the CNS Glitch overlay (purple by decision)

- `samurai-facemask-base-cns` has two parts: `SM_Samurai_FaceMask`, with `MI_Samurai_FaceMask_Base_CNS` (8Layers, no
  emissive), and `SM_Samurai_FaceMaskGlitch`.
- The glitch mesh is in the live index's `glitchOverlayMeshes`, and `glitchOverlayParts: "drop"` removes it.
  - This is decision 5 (`signoffs-2026-11-11.json`): "CNS Glitch items are drawn without the glitch effect, as
    purple".
  - Record: `_docs/goal-100-2026-10-11/w175-cns-glitch/README.md`, wave 136 promote.
- `src/data/reconstruction-reviews.json` already marks the item `issue` (purple) with that note.
- The purple sibling `-cnspurple` binds the glitch slot to `MI_CNSSamuraiGlitch`, whose root is `M_CNS_Glitch`.
  `cns-sibling-icons.jpg` shows the two masks carry the same grid in cyan and purple.
- On this item the glitch slot has no override, and our export has no default material for the static glitch mesh.
  Even the cyan binding is unknown.

**No faithful fix exists in-repo.** To do one:
1. The user would have to reopen decision 5.
2. `M_CNS_Glitch` needs a contract: BLEND_TranslucentGreyTransmittance, TLM_VolumetricDirectional, distortion and an
   RGB split. It is the parked 14-row wall in `remaining-master-walls`.
3. An offline read of `SM_Samurai_FaceMaskGlitch`'s StaticMaterials would recover the cyan binding.

## This PR

- `src/data/reconstruction-reviews.json`: `military-rebreather-rubber-cns` gets a `polish` record. Its note says the
  icon shows the pre-S12 visor and names the eyewear item that now carries it. The status stays blue, as before: the
  default for an item in the index is "Needs visual polish".
- `capture.mjs` and `check-note.mjs`: the captures and the tile check below. URLs go through `viewerUrl()`.
- No index, `public/models` or host change. No deploy.

## Agent-run functional checklist (26 Nov 2026, branch `claude/cns-emissive-2026-11-26`)

Setup: a dev server on this branch, port 5231, with the deploy.yml hosts as `VITE_*`. The live run used
https://chronohaxx.github.io/the-finals-outfit. Head `head-face-23-base`. Facewear camera (0, 1.71, 0.55) → (0, 1.68, 0).

- [x] **Startup:** `/` answers 200, and every capture reached `__rigIdle`. 0 page errors, 0 failed requests.
- [x] **Pingjammer, front-on:** the navy rebreather, straps and canisters, and no visor. It matches the live site and
  the S12 definition. The icon's visor is explained above.
- [x] **Grin Dream Residue, front-on:** the black samurai mask with teeth, without the cyan grid. It matches the live
  site and stays purple by decision 5.
- [x] **KCP rebreather unchanged:** the black rebreather with the eye patch's glowing pale-blue logo, the same as live
  (`evidence/kcp-unchanged.jpg`).
- [x] **Another emissive item unchanged:** the hacker goggles' green LED slit glows the same as live
  (`evidence/emissive-goggles-unchanged.jpg`). The gas mask was captured too; it has no emissive and matches live.
- [x] **The new note shows:** in the Facewear picker the equipped PINGJAMMER tile's badge has
  `data-reconstruction-status="polish"` and aria-label "3D preview: Icon differs by a game change …". Live still shows
  "Needs visual polish · Medium reconstruction in progress".
- [x] Tests: `tests/public-catalog.test.ts` and `tests/reconstruction-progress.test.ts` pass, 13/13.

Not covered: human acceptance; phones; Light/Heavy archetypes. The note is data only, so no render path changed.
