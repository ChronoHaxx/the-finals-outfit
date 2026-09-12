# Catalog restoration following user review

This revision supersedes the visibility policy in `public-catalog-2026-09-12.md`.
That document and the original local acceptance artifacts remain historical
evidence of PR #5 at `f28d548ac626ce28d8b37d0c97e54b0033fcd3f6`.

The user found that the public picker had lost nearly all hairstyles and too
many other ordinary cosmetics. The implementation mistakenly used successful
wiki identity matching as a requirement for public visibility: 2,006 items
were excluded, including 183 hairstyles. This was a policy defect; those
assets had not disappeared. The original agent checks passed against that
incorrect requirement. User acceptance of that revision failed during preview.

## Corrected behavior

- All 2,866 catalog entries are available again, including 185 hairstyles.
  Missing or ambiguous wiki identities no longer hide an item or strip it
  from an old shared outfit.
- 860 verified wiki identities retain their public names and provenance.
  Exact exported localization names are available for 994 items in total;
  these overlap with wiki matches. Where neither is known, the previous
  descriptive name remains until a reliable mapping is available.
- Only an affirmative `IsHidden` or `IsUnreleased` flag on an identified wiki
  entry restricts public browsing. Missing/unknown flags do not imply a ban.
  Known restrictions survive a later snapshot losing the matched page.
- The existing 9,495-page wiki snapshot identifies no such restricted entries
  in this 2,866-item clothing catalog. This is not proof that every item was
  released: the two explicitly unreleased wiki records concern equipment.
  No speculative exclusions are added in this recovery.
- Public UI now says the number of cosmetics and that names/previews are being
  improved; it does not describe the full selection as wiki-matched.
- The confusing `3D only` toggle is removed. It only tested whether some preview
  data existed, not whether an item rendered correctly. The requested colour
  status filter remains, combined with category and text search.
- The unlisted/noindex developer entry retains the full original internal
  catalog. Existing shader recovery and permanent share-ID mappings are unchanged.

## Verification and follow-up

The correction has dedicated regressions for restored hairstyles, unmatched
legacy links, exported names, explicit visibility flags and wiki refreshes.
Desktop/mobile browser checks cover the real picker, selection, sharing and
status filters. Current logs and screenshots are kept in the original checkout
under `_docs/public-catalog-correction-2026-09-12/`.

User retesting of this correction is pending. The draft PR must remain unmerged
until affected user checks pass and the user separately authorizes merge.
Astra made this correction; no additional model dispatch or paid API call was
made. Repair token cost is not independently measurable and is not added again
to shared usage totals.
