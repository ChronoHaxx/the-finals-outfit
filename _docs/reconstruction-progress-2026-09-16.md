# 20% reconstruction checkpoint — 16 September 2026

The Medium preview now has **579 of 2,866 cosmetics worked on (20.20%)**.
This is first-pass coverage, not a percentage of visually perfect items or of
the finished project. The separate target remains broadly usable Medium outfits.

| Review state | Items |
| --- | ---: |
| Red: awaiting work | 2,287 |
| Blue: needs polish | 556 |
| Purple: known issue | 22 |
| Green: looks good | 1 |

The advertised source assemblies increased from **214 to 532** since the
previous asset release. All 214 existing entries are preserved. One additional
structurally resolvable Knight Pants item remains deliberately unadvertised.

| Additional source assemblies | Items |
| --- | ---: |
| Upper body | 112 |
| Feet | 77 |
| Hands | 60 |
| Lower body | 24 |
| Headwear | 22 |
| Wrist | 17 |
| Facewear | 3 |
| Earrings | 2 |
| Lower back | 1 |
| Total added | 318 |

## What changed

Clothing, footwear and glove families now use their source meshes and recovered
materials. Shared fixes include instance-specific two-sided surfaces,
conservative coverage where body UVs overlap, and texture-array packing for
materials that otherwise exceed the browser's sampler limit. The latter retains
the original texture bytes, mip levels, colour decoding and wrapping.

The builder now has a visible colour legend, a proportional progress bar and a
roadmap page. Picker filters, the footer and the roadmap share the same status
data. Outfit state survives roadmap navigation and reload. Physics, theme
filters, randomisation and suggestions are planned features, not implemented.

Wiki matching adds 1,386 associations: 122 clear user selections and 1,264 strong
icon matches. The resulting 2,246 wiki associations are naming evidence, not
proof of release or shader quality. Sixty-four competing user choices remain
unresolved. Generic labels such as HAIR retain descriptive style/colour names;
missing wiki entries do not hide otherwise available cosmetics. Permanent item
IDs and share codes are unchanged.

## Verification and limits

Batch acceptance used original source checks, shader arithmetic comparisons,
browser rendering and outfit switching. Later clothing batches include eight
angles per variant, representative idle views, fitting-tag checks, removal and
share-link reloads. The shared sampler repair additionally checked 84 packed
sampling comparisons with zero difference and five unchanged comparison outfits.
These are agent checks, separate from human and native-game acceptance.

Release integration passed 213 JavaScript/TypeScript tests, 142 Python adapter
contracts, TypeScript checking and compatibility for all 2,866 permanent IDs.
The optimized production build also passed nine browser outfit scenarios using
the uploaded Cloudflare assets, including legacy links, body paint, accessories,
Punk Boots and a formerly sampler-limited vest. All artwork requests in those
scenarios used the new host. The hosted manifest covers all 11,721 catalog asset
references; 46 additional header/content checks passed, including CORS, caching,
manifest identity and missing-file behaviour. This is sampled delivery coverage,
not a visual test of every cosmetic.
Browser UI checks passed for the public hair names, exact progress counts,
visible legend, developer-page noindex, item switching/removal, both share
formats after reload, roadmap navigation/reload and a 390-pixel mobile layout.
No page errors or failed asset responses were observed in that UI run.
Sampler tests now carry their small metadata/synthetic fixtures in
`tests/fixtures/reconstructed-samplers`. Adapter contracts use the explicitly
listed cohort metadata and pure validators under `_docs/<batch>/`. Neither test
set contains game texture or mesh bytes. Seven older integration fixtures remain
local, ignored game files; a full `npm test` needs those local assets. PR checks
run the source-only tests for the changed application behaviour.

Known polish includes Punk Boots calf/cuff notches, Streetwear Pants rear-waist
seams, Assault Vest idle wrist seams, Camo Long Coat wrists and older barefoot
Loose Jeans ankle holes. Red Wristband's opposite-cuff gap remains purple. The
previous Rescue, iridescent-sneaker and racing-glove shader deferrals remain.
Other body types, arbitrary combinations, native lighting and physics are not
accepted by this milestone. No item was promoted to green by automated checks.

The pipeline adapters retain their original source-build and baseline guards.
They document completed batches; do not replay their activation stages against
a later active index without preparing and reviewing a new baseline.

## Release and review

Artwork is staged independently as `v6-20-percent-20260916`: 17,619 assets,
approximately 1.88 GB, largest asset 20,403,080 bytes. It uses the existing
Cloudflare Pages project with an immutable deployment hostname. The previous
production asset deployment remains available. The release workflow pins the
asset URL with the source revision so a merge does not depend on a separately
timed repository-variable update. Extracted assets, browser captures, worker
conversations and credentials are excluded from Git.

Before merging, on the PR's exact release build:

- [ ] Open the builder and confirm the colour legend and progress bar are understandable: 556 blue,
  22 purple and one green item out of 2,866.
- [ ] Equip and switch two Punk Boots variants, rotate the outfit, then remove
  them. Materials should remain visible and trouser cuffs should return.
- [ ] Share the outfit using both link formats, reopen and reload each link.
  Open the roadmap, reload, then return to the same outfit.
- [ ] Narrow the window to phone width. Confirm the picker, legend and roadmap
  are reachable without sideways page scrolling.

Human results are pending. A source push and successful CI do not record a
human pass, merge the PR or publish the application. The next reconstruction
candidate is the ten-item Municipal Gloves family.
