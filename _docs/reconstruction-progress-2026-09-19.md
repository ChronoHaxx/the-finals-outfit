# Reconstruction checkpoint — 19 September 2026

The full 2,866-item developer catalog now has **1,077 touched items (37.58%)**,
up from 579 (20.20%) in the previous release. That is 498 additional items with
an implemented first pass. The status counts are 1,789 awaiting work, 1,054 needing
polish, 22 known issues and one accepted review. These are review-state counts,
not a claim that 37.58% of every game's feature or every outfit is perfect.

The source index advertises 1,030 complete assemblies, up from 532. All 532
previously advertised IDs remain available. One additional structurally ready
assembly remains unadvertised; source readiness alone is insufficient to expose
an item. The unchanged skin-pair set supplies the other reconstructed choices.

## What this release changes

- Shared ordinary and multipart family runners now own extraction, freezing,
  source checks, shader checks, indexing and review preparation. Ordinary new
  families use manifests instead of another copied implementation.
- Reuse requires complete source/build/input provenance. Existing mesh and
  material entries are preserved. A tag change permits mask reuse only when a
  fresh fitted-mask derivation is byte-identical. Changed masks stay blocked.
- Fitted conservative coverage can restore exposed body pixels that the older
  zero-fitting mask hid. This is derived preview coverage, not recovered native
  game culling. Its documented pose, body, sampling and outfit limits remain.
- Source placement rules accept fully authored numeric identity offsets as
  no-ops. Incomplete, non-identity and unsupported offsets remain unresolved.
- The exact authored `PushJacket.bandolier_squeeze` tag can drive its matching
  morph. Other PushJacket tags remain unsupported.
- Capture framing and outfit checks now verify the intended view and all
  multipart bindings, in addition to switching, removal and restoration.

The final 13-item batch covers four TurtleNeck, three Casual Hoodie, three
Oversized Sweater and three Jeans Jacket variants. It passed 252 actual shader
GPU cases and 202 agent-reviewed captures: variant front/back, representative
eight-angle A and idle, gloves, coat replacement, sling, restoration, mask
controls and active full outfits. Earlier cohorts retain their own frozen
source and acceptance evidence; this last batch's figures do not describe the
whole release.

## Release integrity

The app retains the existing public names, visibility decisions, permanent share
IDs and review labels. Shared-code regression checks are accompanied by optimized
browser tests against the actual published assets. Extracted assets, rendered
screenshots, private worker payloads and model-session logs remain outside Git.
The hosted release contains only the active dependency closure, not all local
experiments. Both asset origins are immutable and pinned with the code revision.

The unfinished material-slot case-matching patch is excluded. Tall Boots needing
that patch, families with changed-mask reuse failures and unresolved fitting
cases remain deferred. Native-game comparison, human functional acceptance,
all outfit combinations, Light/Heavy, physics and remaining material effects
are separate work. Agent evidence does not tick the user's acceptance checklist.

## Next sequence

1. Finish and review material-slot case matching; prove it on the held Tall Boots.
2. Continue the screened ordinary queue with shared family manifests.
3. Use actual mesh slots and source defaults to qualify multipart blockers.
4. Prioritize shared material and attachment fixes by confirmed item counts.
5. Measure usable Medium outfits alongside coverage, then finish exceptions,
   fine polish, other body types, physics and discovery features.

Runner contracts: [ordinary families](../scripts/shader-probe/family-runner.md)
and [multipart families](../scripts/shader-probe/multipart-family.md).
