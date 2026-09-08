# Verification matrix — remediation of Codex r1

Findings: `_ops/reviews/the-finals-outfit-verification-matrix-codex-r1.md`
(6 High, 4 Medium, 1 Low, 3 plausible). Branch `codex/material-root-cause`,
reviewed at `426585f`. Nothing pushed.

**Every High is a defect in the plan, not in the implementation.** They were
written by the plan's author and survived his own review of it. Two were verified
independently before this spec was written; the rest were traced to their cited
file and line.

Until H1, H2 and H5 are fixed, **`npm run verify` output must not be used as a
work queue** — 104 of its 117 body-culling failures are the check disagreeing
with the runtime, and an all-black mask currently passes.

---

## H1 — Body culling must mirror the runtime's slot policy

`checks/body-culling.mjs` uses a **blocklist** (`NO_BODY_CONTACT`). The runtime
uses an **allowlist**, and it is already a named constant:

```
src/rig/CharacterRig.ts:501-507
  BODYMASK_SLOTS = { upperBody, outerwear, lowerBody, feet, hands }
```

with `face` registered separately at `:435`. Everything else — `upperBack`,
`lowerBack`, `wrist`, `facialHair`, `nailPolish`, `earrings`, … — never gets a
mask registered, so demanding one is meaningless.

**Fix.** Replace the blocklist with an allowlist of exactly those six slots.
Anything outside it returns `na` with the note `slot never registers a body mask`.

**Do not copy the list into a second place.** Two lists that must agree is how
this defect happened. Extract the slot set to a single module both the runtime
and the check import — a plain `.mjs` or `.json` under `src/lib/` that Vite and
Node can both read — and have `CharacterRig` consume it. If that proves awkward,
say so and stop rather than duplicating with a comment.

**Expected:** body-culling failures fall from 117 to roughly 13.

## H2 — Coverage must be measured on colour, not alpha

`checks/body-culling.mjs` tests `stats.channels.some((c) => c.max > 0)`. That
includes the **alpha** channel, so an entirely black mask with opaque alpha
passes. Verified: `public/models/cosmetics/actionhero-sentinel-gloves.bodymask.png`
has channel maxima `[0, 0, 0, 255]` and currently records `pass`. Codex found
this shape in **42 of 363** mask files.

**Fix.** Test the colour channels only — `stats.channels.slice(0, 3)` — and treat
an all-black mask as `fail` with the note `mask is empty — hides nothing`.

**Expected:** some current body-culling passes become failures. That is the
correct direction; report the new count.

## H5 — Body-culling identity must be slot-sensitive

`inputs.mjs` classifies `bodyCulling` as mesh-scoped and keys it on `gltfPath`
alone, while the check branches on `item.slot`. Verified:
`models/earring/skull-01.glb` is used by **4 items across 3 slots** (`blush`,
`earrings`, `nailPolish`), so the first catalogue occurrence decides the verdict
for all of them — and **reordering the catalogue changes the answer**.

**Fix.** Key `bodyCulling` as `${mesh}|${item.slot}`, exactly as `transform`
already is. Add a test asserting that one mesh used by two slots produces two
distinct keys.

## H3 — Do not seed marks that cannot expire

`seed-census.mjs` writes `colour`, `surface` and `effects` marks carrying a
**`bindings`** hash. Those three aspects have no input declarations in
`inputs.mjs` at all, because they are deliberately out of scope for this plan. So
changing the fitted colour model, region colours or surface tuning expires
nothing — the exact silent non-expiry the matrix exists to prevent.

**Fix.** Store `inputs: null` for seeded human marks, and have `deriveQueue`
treat a null hash as **always stale**. The reviewer's judgement is preserved and
visible, but it can never read as current, which is honest: those verdicts were
made against assets that have since been re-baked.

Add a test: a mark with `inputs: null` derives as `stale`, never `current`.

## H4 — Transform must depend on the attachment configuration

The design says transform depends on "GLB + bone attachment config"
(`_docs/2026-08-13-verification-matrix-design.md`). `inputs.mjs` hashes only the
GLB. The routing heuristic, per-slot bones, head rotation compensation and
ancestor-scale handling all live in `src/rig/CharacterRig.ts` — change any of
them and stale transform verdicts stay current.

**Fix.** Add `src/rig/CharacterRig.ts` to the transform input set. This
over-approximates — any rig edit expires every transform mark — and that is the
correct trade: the design's rule is that an aspect depends on everything that
could invalidate it. A mark that fails to expire is a silent wrong answer; one
that expires too eagerly costs a re-run.

## H6 — Geometry must count triangles, not primitives

`checks/geometry.mjs` counts every primitive's vertices or indices as triangles
without checking primitive mode, so a `LINES` or `POINTS` primitive passes the
"renderable triangles" test.

**Fix.** Skip primitives whose mode is not `TRIANGLES` (glTF mode `4`) when
counting, and fail if no triangle primitive exists at all.

Codex's wider point — that geometry cannot detect a *missing part*, only an empty
or absurdly-scaled mesh — is correct and **out of scope**. Do not attempt a
per-part coverage check here. Note the limitation in the file's header comment
instead, so the next reader does not over-trust it.

---

## Mediums

**M1 — the normal flip reaches no shipped asset.** `convert-meshes.mjs:134` skips
any GLB already using `EXT_meshopt_compression`, and all 1,311 generated GLBs
already are, so re-running the converter applies nothing. **This is the
shipping-critical finding and it is not in scope here** — it needs a re-conversion
or migration path and its own verification. Record it; do not fix it in this pass.

**M2 — bindings validates existence, not readability.** Only the albedo is
decoded; a zero-byte or corrupt normal/ORM/cutout/emissive passes. **Fix:** run
`sharp().metadata()` on each referenced map and fail on any that will not decode.

**M3 — the store is path-keyed, the design says hash-keyed.** Real divergence,
and the **design is the thing to change, not the code.** Path-keying with the
hash stored inside the mark delivers the same expiry guarantee, is conservative
on a rename (the mark reads absent rather than wrongly current), and is simpler.
**Fix:** amend the design doc to describe what was built, and say why.

**M4 — `MIN_STDDEV = 2` may reject legitimate flat materials.** Poker glasses, a
wedding veil and Sentinel boots fail purely on low albedo variance, and a solid
plastic or metal surface can legitimately be near-uniform. **Do not retune the
threshold to make them pass** — that is guessing. Change the mark for this
condition from `fail` to a distinct `needs-human` note in the report, and leave
the 13 for art review.

**L1 — body-culling hashes the body mesh it never reads**, so an unrelated body
edit expires every mark. **Fix:** drop `SK_Body_M.glb` from the input set; add
the shared slot-policy module from H1 instead.

---

## Out of scope, recorded so it is not lost

- The head-static reparent equation at `src/rig/CharacterRig.ts:378-386` — `bwp`
  is decomposed and never used, and the local position is rotated and scaled
  without first subtracting the bone world position, though the comment claims
  "world pos = bone + offset". Codex declined to confirm it without a posed
  runtime assertion, and cannot audit it anyway because it wrote the commit.
  **Needs a third party and a runtime test, not a code read.**
- Restoring the suppression constants (`normalStrength` 0, `roughFloor`,
  `AO_STRENGTH` 0.25, `PATTERN_STRENGTH` 0.92). Still the highest-value visible
  change, still blocked behind M1 — there is no point measuring a normal-map
  change against assets the flip never reached.

## Done when

1. `npm test` passes, with new tests for H2, H3 and H5 that were **confirmed red**
   against the current checks before the fix.
2. `npm run verify -- --dry` runs clean, and the new per-aspect counts are
   reported alongside the old ones.
3. Body-culling failures are 55 rather than 117 — 13 meshes with no mask under
   the allowlist (H1) plus 42 masks found empty by H2 — and the new H2 failures
   are listed by name.
4. `CHECK_VERSION` is bumped for every aspect whose logic changed —
   `bodyCulling`, `geometry`, `transform`, `bindings` (M2) — so existing verdicts
   expire rather than being inherited from a check that no longer exists.
5. No threshold is widened to make anything green. If a check fails broadly after
   a fix, report it and stop.
