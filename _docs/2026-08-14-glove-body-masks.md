# Every glove body-mask is empty

`scripts/visual-diff/build-garment-masks.mjs` produces a mask that hides nothing
for every item in the `hands` slot, writes it to disk, and reports success.

## Confirmed

**46 of 46 hand pieces fail. No other slot does.** From the verification store:

```
face          29 pass    0 fail
outerwear      6 pass    0 fail
feet          75 pass    2 fail
lowerBody     98 pass    2 fail
upperBody    142 pass    5 fail
hands          0 pass   46 fail      <- 42 empty masks + 4 with no mask at all
```

**The generator reports success while writing nothing.** Re-run live against
`actionhero-sentinelgloves-leather` on 2026-08-14: it printed
`done: 1/1 masks written`, and the file it wrote has channel maxima
`[0, 0, 0, 255]` — 0.00% of the body UV covered. A working piece for comparison:
`casual-basic-tshirt.bodymask.png` covers 18.76%.

**This is why it went unnoticed for months.** The mask exists, is a valid PNG, and
passes any check that asks whether the file is present. Only a check that reads
the pixels can see it, and until 2026-08-13 nothing did.

## The user-visible effect: apparently none — corrected 2026-08-14

**An earlier version of this brief claimed every glove renders the bare hand
through it. That was asserted without looking, and it is false.**

Rendered `actionhero-sentinelgloves-leather` and `casual-rubbergloves-plastic` in
the live app at close range. The rubber glove is clean — it fully encloses the
hand, no skin, no z-fighting. The sentinel glove is also clean as far as culling
goes; it carries a white patch on the back of the hand, but that is a texture or
material defect, **not** poke-through.

So the missing masks may be causing no visible harm at all: a glove that fully
encloses the hand needs nothing hidden underneath it.

**This changes what the work is for.** Fixing the generator is still worth doing —
it writes a file that hides nothing and calls it success, and that dishonesty is
what let the condition persist unexamined. But it should not be sold as a visible
improvement, and it should not be prioritised as one.

It also raises a question worth answering before any fix: **if the coverage is
genuinely zero because the glove encloses the hand, is `hands` simply a slot that
does not need masks?** In which case the correct change is to the *check*, not the
generator — the same shape as Codex r1's finding that the check demanded masks
for slots the runtime never masks.

## NOT established — do not assume

**The cause is unknown.** An offline coverage measurement suggested the glove
mesh sits tens of millimetres from the body's hand, but **that measurement was
invalid and its conclusion is withdrawn**: gloves are skinned and carry the arm
skeleton, so their *bind* pose spans 2.000 m against the body's 1.612 m arm
span. It compared two different poses. The generator measures *posed* positions
in the live app, which is the correct frame, and it also returns zero — but the
reason it returns zero has not been determined.

One thing worth checking early, because it is cheap and would explain the slot
being uniquely affected: `coverAt(0.014)` has a looser-tolerance retry at
`0.022`, and that retry is gated to `slot === "face"`. If hands legitimately need
a larger tolerance they can never reach it. **That is a hypothesis, not a
finding.** Do not implement it as a fix before the instrumentation below shows
the actual coverage numbers.

## Task 1 — make the generator unable to lie

Before diagnosing anything, give the generator a failure signal. This is the
defect that let the other one hide, and it is worth fixing on its own.

- Report, per piece, the covered-vertex count, the tolerance that produced it,
  and the resulting share of the body UV.
- **If coverage is zero, do not write a file.** Print a failure and exit
  non-zero at the end of the run if any piece produced nothing. A missing mask
  is honest — the runtime already 404s and skips it. An empty mask is a lie that
  passes inspection.
- Delete any existing all-black mask it encounters rather than leaving it.

Verify by running it against one glove and one shirt: the shirt reports non-zero
coverage and writes; the glove reports zero and writes nothing.

## Task 2 — find out why hands cover nothing

With Task 1's numbers visible, run the generator across the `hands` slot and
report what it prints. The coverage count at the working tolerance is the
diagnostic. Then answer, with evidence:

- Are any body vertices covered at all, or is the count exactly zero?
- If zero, are the posed glove vertices near the posed body hand at all? Print
  the distance from a sample of body hand vertices to the nearest glove vertex.
- Does the same measurement on a working piece (a shirt) look structurally
  different, or only larger?

**Report the numbers and stop.** Do not implement a fix in the same pass. The
last four rounds of work on this project each turned on a spec whose premise was
wrong, and every one was caught because the implementer reported a measurement
instead of acting on an assumption.

## Constraints

- `npm run dev` must be running; the generator drives the live app.
- Masks are gitignored generated output. Regenerating is safe; the current glove
  masks are worthless, so there is nothing to preserve.
- Do not change the runtime, the catalogue, or any check under
  `scripts/lib/verification/`.
- Do not widen a tolerance to make coverage appear until Task 2 explains why it
  is zero.

## Done when

1. The generator reports coverage per piece and refuses to write an empty mask.
2. A shirt still produces a mask; a glove produces a reported failure.
3. The `hands` coverage numbers are reported, with a stated cause or an explicit
   "cause not yet determined" plus what was ruled out.
