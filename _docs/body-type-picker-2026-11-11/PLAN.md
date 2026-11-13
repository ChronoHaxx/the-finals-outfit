# Body-type picker: reconciliation and plan (11 Nov 2026)

Answers the user's question of 11 Nov: "did we archive it without actually finishing/merging those properly?"

## TLDR

- **Nothing was lost, and the merged parts are on `main`.** No session ever built a picker for visitors: stage 1 put the
  three body types behind a dev-only switch, and stage 2 refreshed garment shapes. The stage-2 tools and docs were
  never PR'd; they are now PR #38.
- **Masculine and Androgynous can ship now.** Feminine needs a decision first, because on today's data it clips in
  some outfits (`feminine-today-vs-fallback.png`).
- **Recommended:** ship the picker with all three, and have Feminine use the pre-Season-12 garment shapes, which fit
  together. Fix it properly later through the S12 item refresh.

## Merged vs outstanding

| Piece | State |
|---|---|
| Stage 1: the three S12 Medium body types (`src/rig/BodyTypePreview.ts`, `?bodyType=`) | **Merged**: PR #21, `0e272b0`, 6 Nov. Dev-only; visitors see Masculine. |
| Stage 2: 178 S12 garment GLBs (garments-only variant) | **Live** since 7 Nov: PR #28, `25c0837`. The checks were waived as relayed. |
| Stage 2 tools and docs (`scripts/body-types/`, `_docs/body-types-s12-refresh-2026-11-06/`) | **PR #38 opened 11 Nov.** Mergeable, 15/15 tests pass, no app code. |
| The S12 body (`SK_Body_M`, `medium_female` +3.65 cm, `push_lower_torso` +0.79 cm) | Not shipped. It needs the body path changed in 12 places. |
| 199 meshes reworked in S12 (geometry, not only morphs) | Not started: the "S12 item refresh". 57 of them may be cheap (same surface, reordered vertices). |
| A visitor picker, share links and saved outfits carrying the body type | **Never built.** It was not in either session's scope. |
| Light / Heavy | Surveyed only (6 Nov). |

The full list of 11 open items is in `_docs/body-types-s12-refresh-2026-11-06/OUTSTANDING.md` (PR #38).

## Why Feminine clips

- A **morph target** is a list of per-vertex offsets stored in the mesh; a weight of 1 adds them all. The body type is
  one morph weight (`medium_female`) applied to every mesh that has it: the body and each garment carry their own
  copy.
- Each garment's `medium_female` was sculpted against the body's `medium_female` of the same season. Season 12
  re-sculpted the body (fuller chest and hips, up to 4.8 cm) and most garments to match it.
- Live now mixes the seasons in two ways:
  - **(a) All-S12 garments on the pre-S12 body.** The corset's arm pokes through the fishnet.
  - **(b) An S12 item next to a pre-S12 item in another slot.** The S12 jeans' waistband rises through a pre-S12 crop
    top. Each item is consistent on its own, so a per-item rule cannot catch it.
- **Masculine is safe:** S12 left the body's `medium_male` unchanged. **Androgynous is safe:** it applies no morph, and
  every season agrees on the unmorphed (bind) shape.

## Feminine routes (the user chooses)

| Route | What visitors see | Work | Note |
|---|---|---|---|
| **A. Pre-S12 Feminine now, S12 refresh later** (recommended) | Feminine with the pre-Season-12 garment shapes. They fit together; cross-slot (b) is gone. | Small/medium: the index gets a `preUrl` for the 178 garments, Feminine loads those files. Masculine and Androgynous download nothing extra. | Shapes are Season 11's, not in-game S12. Defect (a) stays on the corset (it was there before 7 Nov too). 46 S12-only meshes need their own captures. |
| **B. Masculine + Androgynous only, until the refresh** | No Feminine yet. | Smallest: no asset work. | Feminine arrives with the refresh. |
| **C. Fallback with S12 shapes when possible** (the 6 Nov Fable idea) | S12 Feminine when every piece is S12 (about 1 outfit in 10, a rough estimate), otherwise A. | Largest: the S12 body at a new URL or a morph sidecar, a per-outfit decision, reloads when it flips. | Fable (11 Nov) now advises against it: it rarely fires. |
| **D. "May clip" label on today's data** | Clips (a) and (b), also in share cards. | None. | Not recommended. |

The proper fix for every route is the **S12 item refresh**: rebuild the 199 reworked meshes from S12, then ship the S12
body. After it, Feminine uses S12 shapes everywhere. It is a separate, larger task.

## The picker build (the same for every route)

1. **UI:** a Body Type control (Masculine / Feminine / Androgynous, Masculine by default) in the outfit panel. Changing
   it re-resolves the outfit with the new tag, then applies the morph and the socket offsets. Randomise keeps the body
   type.
2. **Switch order:** load the new meshes first, then commit the morph name and the meshes in the same frame. Otherwise
   the old meshes flash in the wrong shape.
3. **Share links:** add `bt=f|a` to the short and readable links (absent = Masculine; an unknown value is ignored and
   never throws). Delete stale `bt` along with `o`, and read it from both the fragment and the query.
4. **Share Worker:** carry `bt` in the Worker (`workers/share-preview`), and deploy it first. Otherwise the card shows
   Feminine and the link opens Masculine. Add `bt` to the client's link-cache key.
5. **Legacy `?outfit=1.` links:** add an optional tolerant string `bodyType`, filtered with `isBodyTypeId`.
6. **Saved outfits** (no outfit may be lost): a top-level optional `bodyType` field; `SCHEMA_VERSION` stays 1. Fable
   found the places that would silently drop it:
   - `KNOWN_FIELDS` / `mergeForWrite`;
   - `sameContent`, so journal replay keeps a body-type-only edit;
   - create, duplicate and both conflict forks;
   - `Draft`, `promoteDraft` and `openFromUrl`, which today compare slots only.
   Old app tabs keep the field, because they preserve unknown fields.
7. **Reserve** a separate archetype field and parameter now, for Light and Heavy.
8. **Export 3D and the share card** render what the viewer shows; check both.

## Review before any PR

- Captures for each body type:
  - cross-slot combinations: S12 lower body × pre-S12 upper body, and the reverse;
  - both hands and sides;
  - idle and at least two emotes.
- The 46 meshes with no pre-S12 file (14 backfill, 32 no-copy).
- The Feminine clavicle offset: it is the S12 value. Compare it with the pre-S12 one on a clavicle attachment.
- Judge at full size. Loss-path tests for saved outfits: a body-type-only edit, then a kill and replay; two tabs; an old
  link; an unknown `bt`.

## Light / Heavy (later phases)

0. **Decide first:** the user's sign-off on mixing builds from the June dump. 1,518 of the 1,878 Light/Heavy meshes
   exist only there.
1. Extract the Light and Heavy skeletons, bodies, class morphs and socket offsets offline. Gate: a bare Light and a bare
   Heavy body with a head, skin pairs and emotes working.
2. A pilot of about 20 items, taken from both the June dump and S12. Reuse Medium-derived data only where topology is
   proven identical.
3. Bulk extraction, then an archetype picker. Muscular (Heavy-only) comes after the first release.

## Consultations

Claude Fable 5.2 (ask-fable, effort high), 11 Nov, thread `df7ee388`, about $1.56. It changed the plan in two ways:
- route A instead of C;
- the eight places where the body type would be silently dropped.
