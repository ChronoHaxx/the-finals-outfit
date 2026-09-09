# Per-item verification matrix — design

Status: **approved in conversation 2026-08-13**; implemented as
`2026-08-13-verification-matrix-plan.md`, with one deliberate deviation below
(the store is path-keyed, not hash-keyed) amended into this design by the
remediation round (`2026-08-13-verification-matrix-remediation.md`).

## The problem this solves

`scripts/visual-diff/verdicts.generated.json` holds 239 scored render-vs-icon
comparisons at a mean of 60.6/100. It has two defects that make it unable to
direct work:

1. **One label per item.** An earring that is mis-rotated *and* the wrong colour
   *and* missing its texture is recorded once, under whichever the reviewer
   thought was worst. So every category count is an undercount, and the question
   "how many items have a culling problem?" cannot be asked at all.
2. **Verdicts never expire.** Nothing ties a verdict to the assets it was made
   against, so a re-bake silently leaves stale marks that still read as current.

Defect 2 is not hypothetical. On 2026-08-12 a verification round produced 23
before/after pairs in which 21 of the "before" images were six-week-old renders
at a different resolution. Nothing in the system could detect it; it was caught
by reading file timestamps by hand.

## Aspects

Eight. The rule for splitting: **two aspects are separate if they are fixed in
different places.** A distinction you cannot act on is not worth tracking.

| Aspect | Decided by | Fix site | Census evidence |
|---|---|---|---|
| Transform | machine | conversion / bone attach | `not-visible`, part of `wrong-mesh` |
| Geometry | machine | conversion / LOD | `wrong-mesh` 11, `missing-part` 12 |
| Body culling | machine | body-hide mask generation | not previously measured |
| UV | machine | conversion | `artifact` 11 |
| Bindings | machine | import / bake | `material-flat`, `emissive-missing`, `missing-print` |
| **Colour** | **human** | bake colour path | `color-wrong` 54 + `color-too-light` 5 |
| **Surface** | **human** | bake ORM + tuning | `material-flat` 7, `metal-grey` 1 |
| **Effects** | **human** | rig emissive path | `emissive-missing` 6 |

Five machine, three human. The split follows a measured property of these
agents: they are reliable at *measuring* and unreliable at *judging*. It is not a
trust setting to be relaxed later.

**Colour gets its own row** because it is 59 of the 135 observed failures — the
largest single thing wrong with the project. Folding it into a general "material"
aspect would hide the main event.

**Bindings** is the measurable half of "material": are the right maps resolved
and non-default. "The albedo is the 1×1 white fallback" is a fact, not an
opinion. Opacity cutouts live here too — the fix is a bound map even though the
symptom is a wrong silhouette.

**Not an aspect: `framing`.** Ten census verdicts are unjudgeable because the
official icon is a hand close-up the body camera cannot frame. That is a property
of the *check*, not the item. It becomes a check status, `not-checkable`, with a
reason — otherwise those items sit unverified forever and pollute every count.

## The verdict record

```json
"casual-longcoat-leather-camo": {
  "colour":  { "mark": "fail", "by": "human", "at": "2026-08-13",
               "inputs": "a3f9…", "note": "reads grey-green, icon is near-black" },
  "culling": { "mark": "pass", "by": "agent", "at": "2026-08-13", "inputs": "7c21…" },
  "effects": { "mark": "n/a",  "by": "agent", "at": "2026-08-13", "inputs": "0000…" }
}
```

Marks: `pass` · `fail` · `n/a` (the item has no such aspect) · `not-checkable` ·
and **absent**, meaning nobody has looked. Absent is the default and is not an
error.

**Storage:** one generated JSON file, same shape and location as today's
`verdicts.generated.json`. **Written only by scripts, never hand-edited.** Human
marks arrive through dev mode, which calls a script. A file that can be edited by
hand starts drifting, and this workspace has already lost a dashboard twice to
hand-maintained state.

### Marks are keyed by the input path, not by item

Most catalog items are colourways of a shared mesh: **2,531 items resolve to 847
distinct meshes**, three skins per mesh on average, over 1,968 distinct baked
material sets.

The mesh-level aspects therefore need **847 checks, not 2,531** — and this needs
no special-casing, because the identity IS the path: mesh-scoped aspects are
stored under the GLB path, and transform and body culling under `GLB|slot`,
since both depend on the slot they are equipped into. Skin-scoped aspects
(bindings) are stored under `GLB|albedo`. Every skin of a shirt shares one
mesh-level verdict automatically; there is no projection layer.

This is a deliberate amendment of the original hash-keyed design, made in the
remediation round. The input hash still lives in the mark — it is the `inputs`
field, and `stale` is still **derived, never stored**: a mark whose recomputed
hash no longer matches is stale, and nothing rewrites the file to record
staleness, so a re-bake does not produce a 2,866-line diff. Path-keying delivers
the same expiry guarantee, is **conservative on a rename** (a renamed mesh reads
as absent, never wrongly current), and is simpler — the key is readable in the
store without recomputing anything. The hash remains the source of staleness;
the path is the source of identity.

A variation that changes only its material inherits every mesh-level verdict and
carries its own colour, surface, bindings and effects marks. Adding a new
colourway of an existing mesh costs four checks, not eight.

Rejected alternative: one file per item under `_docs/`. Better merge behaviour,
but 2,866 files, no easier to query, and this is a single-author repo.

## Expiry — the mechanism that makes a mark honest

Each aspect declares the files it depends on. `inputs` is a hash over exactly
those. Recompute; if it moved, the mark becomes **stale** and the item re-enters
the queue.

| Aspect | Depends on |
|---|---|
| Transform | GLB + bone attachment config |
| Geometry | GLB |
| Body culling | GLB + body mesh + the item's body-hide mask |
| UV | GLB |
| Bindings | baked texture set + emissive / cutout paths |
| Colour | baked albedo + region colours + the fitted colour model |
| Surface | baked ORM + tuning constants |
| Effects | emissive map + effect parameters |

Re-baking a coat expires its colour and surface marks and leaves geometry and UV
standing, because the mesh did not change. Re-verify what moved, not everything.

**Consequence to accept up front:** when lighting calibration lands, *every*
colour and surface mark in the matrix expires simultaneously. That is correct,
and it is the reason lighting must be calibrated before anyone marks anything.

## Culling is two problems

**Body culling** — body poking through clothes; feet inside shoes, legs through
trousers. Per mesh, machine-decidable, **and it is already half-built**:
`CharacterRig` maps any equipped item to a `<name>.bodymask.png` sibling and
discards the body texels it covers, and **392 such masks exist, covering 363 of
the 847 distinct meshes (43%)**. So this is neither a feature gap nor a research
problem — it is 484 meshes without a generated mask, plus no check that the
existing ones are correct. In the matrix.

**Garment-vs-garment clipping** — a coat sleeve through an undersuit. A property
of a combination, with no per-item answer. Sampled across common pairings,
tracked separately from the per-item matrix.

**The game ships the rules for both.** `scripts/customization.generated.json`,
already extracted, holds 3,559 entries of which 3,193 carry `hideSlots`, 1,412
carry `hideMesh` (18 distinct tags), and 2,273 carry `shape` — deformation rules
such as `ShrinkWrap.shrink_gloves_under_jacket` and
`PushInsideClothes.push_lower_torso`. None is consumed; `model.hides` is
populated on 0 of 2,866 items. The first half of this work is import and wiring
against a closed vocabulary, not reverse-engineering.

## The batch loop

```
recompute hashes  →  queue of absent/stale marks
       │
       ├─ machine aspects ─→ automated checks close them, no human involved
       │
       └─ human aspects ──→ batched BY ASPECT: ~40 items + their icons, side by side
                                     │
                             human marks pass/fail
                                     │
                         failures group by aspect → work order to Codex
                                     │
                              fix → re-bake → hashes move → marks expire
```

**The queue is derived, never maintained.** "What should I work on" is a query.

**Batch by aspect, not by item.** Judging forty colours in one pass is far faster
than judging one item's colour, then its surface, then its effects — and a wrong
colour is obvious next to thirty-nine others in a way it is not alone. Once
agent marks earn trust, add an exception-only filter so passes are not shown.

**The payoff is the last hop.** Codex stops receiving "improve the materials" and
starts receiving "these 41 named items fail colour; here are their renders,
icons and source parameters." That is a brief with a definition of done, which
every round to date has lacked.

## Priority — the first run is otherwise unusable

Hash-keying already cuts this hard — 847 meshes × 4 mesh aspects plus 1,968
baked sets × 4 material aspects is about **11,000 marks, not the 23,000 a
naive per-item count suggests.** Still far too many to start with, and most
would be spent on items nobody equips. Seed in this order:

1. The **239 items already scored** — migrate the existing census verdicts in as
   a starting position rather than discarding work already done.
2. Items appearing in **shared outfit links** — evidence of what is actually used.
3. Everything else, on demand.

## Out of scope

- Lighting calibration. Prerequisite, not part of this. See README roadmap item 0.
- The dev-mode UI. This spec defines the data and the loop; the surface for
  marking is roadmap item 2 and needs its own design.
- Animated effects. A still frame cannot verify motion and the official icons are
  static, so no ground truth exists in any source held. Needs its own statuses
  (`static-verified` / `motion-unverified` / `motion-approved`) — deferred.

## Open question for the plan

`n/a` and `not-checkable` must be *derived*, not marked by hand, or they become a
way to make the queue look shorter. Deriving `n/a` is easy — an item with no
emissive binding has no effects aspect. Deriving `not-checkable` is not, since it
depends on the icon's framing. Left to the implementation plan.
