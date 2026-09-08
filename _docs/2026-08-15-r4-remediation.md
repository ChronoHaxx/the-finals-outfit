# Brief — close the two r4 Mediums on `codex/material-root-cause`

## CONTEXT

Codex's bulk review of `7878c39..66c2738` (`_ops/reviews/the-finals-outfit-bulk-review-codex-r4.md`)
returned **not safe to push** with two Medium findings. This brief closes both so
the nine-commit branch can move.

Read that review first. It is the authority on what is wrong; this brief is the
authority on what to do about it, and on one point where the review asked for
something this repo cannot hold.

**Role inversion, stated so it is not discovered later.** Normally Claude briefs
and Codex reviews the result. Here Codex implements and Claude reviews. That
means the diff gets exactly one reviewer, and that reviewer wrote this brief.
`AGENTS.md` Gate 2 wants *both* parties to verify a Medium fix; that is not
available in this arrangement. Implement accordingly: the usual second pair of
eyes is not coming, so leave the reasoning legible in comments and commit
messages rather than assuming a reviewer will reconstruct it.

## CURRENT STATE

Verified 2026-08-15 against the working tree. Do not re-derive.

- Branch `codex/material-root-cause`, tip **`66c2738`**. Working tree clean apart
  from untracked `scripts/discord-export/`, which is pre-existing — **leave it**.
- At `66c2738`: `npm test` 43/43, `npm run typecheck`, and `npm run build` all
  pass. Codex verified this during r4; treat it as the baseline, not as a claim
  to re-establish before starting.
- `setMeshSide` is at `src/rig/CharacterRig.ts:1289`. It traverses to the mesh by
  uuid, then assigns `m.side` on each material object in place.
- `setMeshVisible` at `:1283` is the sibling action and is **not** affected —
  `visible` lives on the object, not the material.
- `dispose()` is at `:1300`, immediately below. `CharacterRig` already treats
  shared GPU resources as a known hazard: see the comment at `:869`,
  *"textures are shared with phys and dispose() doesn't free them"*, and the
  explicit pre-orphan dispose at `:487`.
- The panel is `src/components/MeshInspector.tsx`. It renders per-material side
  state as an amber `double-sided` badge (`:47-55`) and polls `rig.inspect()` on
  a 1 s interval (`:84-91`), so it re-reads live material state rather than
  holding its own copy.
- Codex scanned all 1,311 generated GLBs: **59 reuse one material across
  multiple primitives or mesh nodes.** `public/models/cosmetics/attachments-ski-blade.glb`
  has two mesh nodes sharing `MI_DualBlades_Skiblades_01_A`.
- **2,474** `*.albedo.webp` files are present on disk under `public/models/cosmetics/`.
- **`FINALS_DUMP` is unset in this checkout.** Re-baking is therefore impossible
  here. Scanning already-baked albedos does not need it.
- `/public/` and `/scripts/generated/` are gitignored. See `.gitignore:1-15`:
  extracted game artwork never enters git, because history cannot be
  un-published. This is the project's hard inherited rule, not a preference.

## GOAL

Two outcomes. They are independent — neither blocks the other.

### 1. The inspector's back-face toggle isolates the mesh it names

Toggling back-face culling on one mesh must not change any other mesh, including
siblings that share a source material. The panel must keep reporting the true
per-mesh side state after such a toggle, so a reader can trust the badge.

The review suggests cloning the selected mesh's material, or holding a per-mesh
side override without touching the shared source. **Either is acceptable — pick
one and say why in the commit.** Whichever you choose, the material lifecycle
has to stay coherent with `dispose()`: this rig already leaks nothing today, and
a fix that introduces an orphaned material per toggle would trade a correctness
bug for a memory one.

Prove it with a regression test: two meshes sharing one material, toggle one,
assert the other is unchanged.

### 2. The white-patch fix becomes reproducible from the repo

Codex asked for the bake input, five renders, and a scan result. **The five
renders cannot be committed** — they are derivatives of extracted artwork and
`/public/` is gitignored for a reason that outranks this review. Do not commit
images, and do not weaken `.gitignore` to make room for them.

What closes the gap instead is a **numeric, re-runnable** artifact: a committed
script that scans the baked albedos for white-patch incidence and prints counts,
plus its output committed as text. Anyone with the assets on disk can then re-run
it and get the same number, which is what reproducibility means here.

The scan needs only the baked outputs, which are present (2,474 of them). It does
**not** need `FINALS_DUMP`. Report the current count and name the items still
flagged, so the "several of the 34 are legitimately white" claim from
`_docs/2026-08-14-white-patches.md` stops being an assertion.

If the honest answer turns out to be that the current on-disk albedos cannot be
attributed to this commit range, **say so in the doc rather than implying they
can.** An accurate "this is the state today, provenance unproven" beats a
confident number.

## CONSTRAINTS

- Work on `codex/material-root-cause`. Commit there.
- Separate commits for the two goals. They are independent findings and a
  reviewer needs to weigh them separately.
- The inspector is DEV-gated (`?inspect=1`) and must stay that way.
- Match the surrounding code. `CharacterRig.ts` carries dense explanatory
  comments on exactly this class of hazard — a fix here without one is
  out of character for the file.
- The scan script goes in `scripts/`, follows the existing `.mjs` conventions,
  and gets a `package.json` entry like its siblings.
- `npm test`, `npm run typecheck` and `npm run build` must all pass at the end.

## DO NOT

- **Do not push.** Not the branch, not a tag, nothing. The review verdict is
  still "not safe to push" and only the human lifts that.
- Do not merge, rebase, force-push, reset, or change branches.
- Do not commit any image, texture, `.webp`, `.glb`, or other extracted or
  derived artwork. Do not add exceptions to `.gitignore` to permit it.
- Do not delete or modify the untracked `scripts/discord-export/` files.
- Do not re-tune `MIN_STDDEV`, `PATTERN_STRENGTH`, or `AO_STRENGTH` — the
  2026-08-14 brief forbade this and the reason still holds: the defect was a
  classification rule, not a magnitude.
- Do not change the region-tint path.
- Do not attempt a third back-face-culling heuristic. Two were measured and
  failed on 2026-08-15 and the README says so explicitly. The real fix is
  reading UE's `TwoSided` flag and it is **out of scope for this brief.**
- Do not touch the verification-matrix code reviewed clean in r3
  (`1387770..7878c39`).
- Do not "fix" the two recorded mesh defects (double-siding at conversion,
  multi-part flattening). They are deliberately recorded-not-fixed.
- Do not edit `_ops/projects.psd1`.

## DONE WHEN

Falsifiable, in the sense that a wrong implementation fails them.

1. A test exists that builds or loads two meshes sharing one material object,
   toggles side on one, and **fails if the other's side changes.** Confirm it
   fails against the old behaviour — a regression test that passes on the bug is
   not a regression test.
2. `attachments-ski-blade.glb` is exercised or replicated as the shared-material
   case, since it is the known concrete instance.
3. Toggling side on a mesh whose material is *not* shared still works, and the
   panel badge reflects it within one poll interval.
4. No material is orphaned per toggle: state explicitly what happens to any
   cloned material on dispose, and back it with code.
5. A committed script scans the baked albedos and prints a white-patch count.
   Running it twice gives the same number.
6. Its output is committed as text, naming the items still flagged, with each
   either confirmed legitimately white or named as still broken.
7. The provenance limit is stated in writing: whether the scanned albedos can be
   attributed to this commit range, and if not, that they cannot.
8. `npm test`, `npm run typecheck`, `npm run build` all pass.
9. `git status` shows no untracked or modified artwork, and
   `scripts/discord-export/` is still untracked and unmodified.

## SETTINGS

| Dial | Value | Why |
|---|---|---|
| Harness | Codex | Human's call this round: Codex implements, Claude reviews. |
| Model | frontier (5.6 Luna) | `OPERATING.md` §9 — never drop tier for work another tier will check. |
| Effort | **high** | Not for importance — for search. The root cause is known and located, but material lifecycle is genuinely open: `dispose()` sits ten lines below the fix, `:869` records that sharing already bit this file once, and cloning interacts with both. Not **max**: max is for a bug with no known cause, and this one has a diagnosis. |
| Speed | Standard | Trades latency, not quality. |
| Approvals | **on-request**, workspace-write | Everything here is reversible on a branch; the one irreversible act is a push, forbidden above. Avoid "Approve for me": per `AGENTS.md` it writes a session file containing only approval verdicts, which makes the real work harder to extract afterwards. |
| Network | not needed | The scan runs on local files. `FINALS_DUMP` is unset, so no bake. |
| Plan gate | none | Not irreversible, and this DO NOT list bounds a small diff rather than guarding silent failure. Standard run: brief → work → diff review. |
| Session | one brief, one session | `OPERATING.md` §9. |

## Handoff checklist

- [ ] Codex given this file's path and `_ops/reviews/the-finals-outfit-bulk-review-codex-r4.md`
- [ ] Settings above applied before the first prompt
- [ ] Two commits on `codex/material-root-cause`, nothing pushed
- [ ] `npm test` / `typecheck` / `build` output pasted back, not summarised
- [ ] **Claude reviews the diff** — fidelity only, and says so, having written this brief
- [ ] Row added to `_ops/routing-log.md`, recording that this ran with one reviewer instead of two
- [ ] `_ops/projects.psd1` `next` line updated by Claude at session end
- [ ] `_ops/refresh-index.ps1` run
